import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML } from './utils.js';
import { DAYS } from './config.js'; 

let globalStations = [];
let globalShifts = [];
let globalCustomThemes = [];
let globalScheduleData = {};

// Caching och optimering
let lastWeatherFetchTime = 0;
let cachedWeatherHtml = "";
let lastDataSnapshot = ""; // Förhindrar onödiga DOM-omritningar

// Spara statisk konfiguration så vi slipper hämta den var 15:e sekund
let cachedConfig = {
    settings: null,
    message: null,
    weatherConfig: null,
    lastConfigFetch: 0
};

function getWeatherIcon(code) {
    if (code === 0) return '☀️'; 
    if (code === 1 || code === 2) return '🌤️'; 
    if (code === 3) return '☁️'; 
    if (code === 45 || code === 48) return '🌫️'; 
    if (code >= 51 && code <= 67) return '🌧️'; 
    if (code >= 71 && code <= 86) return '❄️'; 
    if (code >= 95) return '⛈️'; 
    return '🌡️';
}

export async function initDisplay() {
    const urlParams = new URLSearchParams(window.location.search);
    const displayToken = urlParams.get('token');
    
    if (!displayToken) {
        document.body.innerHTML = "<h1 style='color:red; text-align:center; padding-top:10%;'>Åtkomst nekad. Display-nyckel saknas i URL:en.</h1>";
        return;
    }

    globalCustomThemes = await fetchData('custom_themes') || [];

    async function updateDisplay() {
        try {
            const now = new Date();
            const tzoffset = now.getTimezoneOffset() * 60000;
            const todayStr = (new Date(now.getTime() - tzoffset)).toISOString().slice(0, 10);
            
            // 1. OPTIMERING: Kolla om vi behöver hämta inställningar (var 5:e minut)
            const fetchConfig = (now.getTime() - cachedConfig.lastConfigFetch > 300000);
            
            // 2. Hämta allting från vår nya batch-endpoint i ett enda svep!
            const bundleData = await fetchData('display_bundle', `&start_date=${todayStr}&end_date=${todayStr}&include_config=${fetchConfig}`);
            
            if (!bundleData) return; // Avbryt om servern inte svarar

            let stations = bundleData.stations;
            let shifts = bundleData.shifts;
            let scheduleRaw = bundleData.schedule;

            // Om vi bad om inställningarna, spara ner dem i cache-minnet
            if (fetchConfig) {
                cachedConfig.settings = bundleData.settings;
                cachedConfig.message = bundleData.message;
                cachedConfig.weatherConfig = bundleData.weather_config;
                cachedConfig.lastConfigFetch = now.getTime();
            }

            globalStations = Array.isArray(stations) ? stations : [];
            globalShifts = Array.isArray(shifts) ? shifts : [];

            globalScheduleData = {};
            if (Array.isArray(scheduleRaw)) {
                scheduleRaw.forEach(row => {
                    if (!row.is_published) return; 
                    const key = `${row.station_id}_${row.shift_id}`;
                    if (!globalScheduleData[key]) globalScheduleData[key] = [];
                    globalScheduleData[key].push(row);
                });
            }

            // 2. SNAPSHOT-LOGIK: Kolla om datan är ändrad sedan förra sekunden
            // Vi skapar en sträng av schemat, platser, pass och meddelande
            const currentSnapshot = JSON.stringify({
                sch: globalScheduleData, 
                st: globalStations, 
                sh: globalShifts, 
                msg: cachedConfig.message?.text
            });

            // Avbryt uppritningen om ingenting har ändrats (Sparar CPU & undviker blinkningar)
            if (currentSnapshot === lastDataSnapshot && !fetchConfig) {
                // Vi vill dock fortfarande uppdatera väder & klocka nedanför
            } else {
                // Spara det nya snapshotet
                lastDataSnapshot = currentSnapshot;

                // --- Rita upp DOM:en bara om den är ändrad ---
                const iso = getISOWeek(now);
                const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
                const titleEl = document.getElementById('mainTitle');
                if(titleEl) titleEl.innerText = `Vi som jobbar ${DAYS[dayIndex]} ${now.getDate()}/${now.getMonth() + 1} (v.${iso.week})`;

                renderGrid();

                const msgBox = document.getElementById('messageBox'); // Antar att denna existerar i HTML eller Marquee
                const mqContainer = document.getElementById('marqueeContainer');
                if (mqContainer) {
                    if (cachedConfig.message && cachedConfig.message.show && cachedConfig.message.text) {
                        document.getElementById('marqueeText').innerText = cachedConfig.message.text;
                        mqContainer.style.display = 'block';
                    } else {
                        mqContainer.style.display = 'none';
                    }
                }

                // Tema
                if (cachedConfig.settings && cachedConfig.settings.theme && cachedConfig.settings.theme !== 'light') {
                    const t = globalCustomThemes.find(x => x.id === cachedConfig.settings.theme);
                    let styleEl = document.getElementById('custom-theme-style');
                    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'custom-theme-style'; document.head.appendChild(styleEl); }
                    if (t && styleEl.innerHTML !== t.css) styleEl.innerHTML = t.css;
                } else {
                    const styleEl = document.getElementById('custom-theme-style');
                    if (styleEl) styleEl.remove();
                }
            } // Slut på snapshot-if

            // --- VÄDER HANTERING (Körs oavsett snapshot, men har egen cooldown) ---
            if (cachedConfig.weatherConfig && cachedConfig.weatherConfig.latitude && cachedConfig.weatherConfig.longitude) {
                const nowMs = Date.now();
                if (nowMs - lastWeatherFetchTime > 900000 || cachedWeatherHtml === "") { 
                    try {
                        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${cachedConfig.weatherConfig.latitude}&longitude=${cachedConfig.weatherConfig.longitude}&current_weather=true`);
                        if (weatherRes.ok) {
                            const weatherData = await weatherRes.json();
                            if (weatherData && weatherData.current_weather) {
                                const temp = Math.round(weatherData.current_weather.temperature);
                                const code = weatherData.current_weather.weathercode;
                                const icon = getWeatherIcon(code);
                                cachedWeatherHtml = `${icon} ${temp}°C`;
                                lastWeatherFetchTime = nowMs;
                            }
                        }
                    } catch(err) {
                        console.error("Kunde inte hämta väder:", err);
                    }
                }
                
                const weatherEl = document.getElementById('weatherWidget');
                if (weatherEl && cachedWeatherHtml) {
                    weatherEl.innerHTML = `<span style="font-size: 0.6em; color: var(--sub-text, #666); margin-right: 8px; text-transform: uppercase;">${escapeHTML(cachedConfig.weatherConfig.name)}</span> ${cachedWeatherHtml}`;
                }
            }

        } catch (e) {
            console.error("Kunde inte uppdatera display:", e);
        }
    }
    
    // Starta cykeln
    await updateDisplay();
    setInterval(updateDisplay, 60000); // 60 sekunder
    
    // Klockan uppdateras separat för att vara exakt på sekunden
    setInterval(() => {
        const now = new Date();
        const clk = document.getElementById('clock');
        if(clk) clk.innerText = now.toLocaleTimeString('sv-SE', {hour: '2-digit', minute:'2-digit'});
    }, 1000);
}

function renderGrid() {
    const cont = document.getElementById('mainContainer');
    if(!cont) return;

    let html = `<div class="time-header-row"><div></div>${globalShifts.map(s => `<div class="time-header">${escapeHTML(s.label)}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        if(st.is_spacer) { html += `<div class="display-row spacer-row"></div>`; return; }
        
        const contrast = isLight(st.color) ? '#000' : '#fff';
        html += `<div class="display-row" style="--station-color:${escapeHTML(st.color)}; --contrast-color:${contrast};"><div class="station-label">${escapeHTML(st.name)}</div>`;
        
        globalShifts.forEach(sh => {
            const key = `${st.id}_${sh.id}`;
            const assignments = globalScheduleData[key] || [];
            
            const val = assignments.map(a => a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim()).join(' / ');
            
            html += `<div class="shift-card ${val?'':'empty'}" data-label="${escapeHTML(sh.label)}">${escapeHTML(val)}</div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML } from './utils.js';
import { DAYS } from './config.js'; 

let globalStations = [];
let globalShifts = [];
let globalCustomThemes = [];
let globalScheduleData = {};

// Variabler för att inte spamma väder-API:et i onödan
let lastWeatherFetchTime = 0;
let cachedWeatherHtml = "";

// Hjälpfunktion för att översätta WMO väderkoder till Emojis
function getWeatherIcon(code) {
    if (code === 0) return '☀️'; // Klart
    if (code === 1 || code === 2) return '🌤️'; // Halvklart
    if (code === 3) return '☁️'; // Mulet
    if (code === 45 || code === 48) return '🌫️'; // Dimma
    if (code >= 51 && code <= 67) return '🌧️'; // Regn/Duggregn
    if (code >= 71 && code <= 86) return '❄️'; // Snö
    if (code >= 95) return '⛈️'; // Åska
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
            
            // Hämta även weather_config från databasen
            const [stations, shifts, scheduleRaw, settings, msg, weatherConfig] = await Promise.all([
                fetchData('stations'),
                fetchData('shifts'),
                fetchData('schedule', `&start_date=${todayStr}&end_date=${todayStr}`),
                fetchData('settings'),
                fetchData('message'),
                fetchData('weather_config')
            ]);

            globalStations = Array.isArray(stations) ? stations : [];
            globalShifts = Array.isArray(shifts) ? shifts : [];

            globalScheduleData = {};
            if (Array.isArray(scheduleRaw)) {
                scheduleRaw.forEach(row => {
                    // Skärmen ritar ENDAST ut publicerade pass
                    if (!row.is_published) return; 
                    const key = `${row.station_id}_${row.shift_id}`;
                    if (!globalScheduleData[key]) globalScheduleData[key] = [];
                    globalScheduleData[key].push(row);
                });
            }

            // Rubrik
            const iso = getISOWeek(now);
            const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
            const titleEl = document.getElementById('mainTitle');
            if(titleEl) titleEl.innerText = `Vi som jobbar ${DAYS[dayIndex]} ${now.getDate()}/${now.getMonth() + 1} (v.${iso.week})`;

            renderGrid();

            // Meddelande
            const msgBox = document.getElementById('messageBox');
            if (msgBox) {
                if (msg && msg.show && msg.text) {
                    msgBox.innerText = msg.text;
                    msgBox.style.display = 'block';
                } else {
                    msgBox.style.display = 'none';
                }
            }

            // --- VÄDER HANTERING ---
            if (weatherConfig && weatherConfig.latitude && weatherConfig.longitude) {
                const nowMs = Date.now();
                // Uppdatera vädret max var 15:e minut (900 000 ms) för att spara nätverk
                if (nowMs - lastWeatherFetchTime > 900000 || cachedWeatherHtml === "") { 
                    try {
                        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${weatherConfig.latitude}&longitude=${weatherConfig.longitude}&current_weather=true`);
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
                        console.error("Kunde inte hämta väder från Open-Meteo:", err);
                    }
                }
                
                // Skriv ut vädret och staden i gränssnittet
                const weatherEl = document.getElementById('weatherWidget');
                if (weatherEl && cachedWeatherHtml) {
                    weatherEl.innerHTML = `<span style="font-size: 0.6em; color: var(--sub-text, #666); margin-right: 8px; text-transform: uppercase;">${escapeHTML(weatherConfig.name)}</span> ${cachedWeatherHtml}`;
                }
            }

            // Tema
            if (settings && settings.theme && settings.theme !== 'light') {
                const t = globalCustomThemes.find(x => x.id === settings.theme);
                let styleEl = document.getElementById('custom-theme-style');
                if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'custom-theme-style'; document.head.appendChild(styleEl); }
                if (t && styleEl.innerHTML !== t.css) styleEl.innerHTML = t.css;
            } else {
                const styleEl = document.getElementById('custom-theme-style');
                if (styleEl) styleEl.remove();
            }

        } catch (e) {
            console.error("Kunde inte uppdatera display:", e);
        }
    }
    
    await updateDisplay();
    setInterval(updateDisplay, 15000); // Uppdatera schemat var 15:e sekund
    
    // Klocka
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
            
            // Prioriterar display_name om det finns, annars förnamn + efternamn
            const val = assignments.map(a => a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim()).join(' / ');
            
            html += `<div class="shift-card ${val?'':'empty'}" data-label="${escapeHTML(sh.label)}">${escapeHTML(val)}</div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

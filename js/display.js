import { fetchData } from './service.js';
import { getISOWeek, isLight } from './utils.js';
import { DEFAULT_STATIONS, DEFAULT_SHIFTS, DAYS } from './config.js';

let lastSnap = "";
let globalStations = [];
let globalShifts = [];
let globalScheduleData = {};

export function initDisplay() {
    // Starta klockan direkt
    setInterval(() => {
        const el = document.getElementById('clock');
        if(el) el.innerText = new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'});
    }, 1000);

    // Initialisera väder (dynamiskt)
    initWeather();

    refreshLoop();
}

async function refreshLoop() {
    await refresh();
    setInterval(refresh, 15000);
}

async function refresh() {
    try {
        let pub = await fetchData('schedule_published');
        if(!pub || !Object.keys(pub).length) pub = await fetchData('schedule');
        const [sets, msg, themes, stations, shifts] = await Promise.all([fetchData('settings'), fetchData('message'), fetchData('custom_themes'), fetchData('config_stations'), fetchData('config_shifts')]);
        
        const snap = JSON.stringify({s:pub, t:sets?.theme, m:msg, st:stations, sh:shifts});
        if(snap === lastSnap) return; lastSnap = snap;
        
        globalScheduleData = pub || {};
        globalStations = (Array.isArray(stations) && stations.length) ? stations : DEFAULT_STATIONS;
        globalShifts = (Array.isArray(shifts) && shifts.length) ? shifts : DEFAULT_SHIFTS;

        if (sets?.theme && sets.theme !== 'light') {
            const theme = (themes||[]).find(t => t.id === sets.theme);
            if(theme) { const style = document.createElement('style'); style.innerHTML = theme.css; document.head.appendChild(style); }
        }

        const mq = document.getElementById('marqueeContainer');
        if(mq) { mq.style.display = (msg?.show && msg?.text) ? 'block' : 'none'; if(msg?.text) document.getElementById('marqueeText').innerText = msg.text; }

        const now = new Date(), iso = getISOWeek(now), today = DAYS[now.getDay()===0 ? 6 : now.getDay()-1];
        const titleEl = document.getElementById('mainTitle');
        if(titleEl) titleEl.innerText = `Vi som jobbar ${today} ${now.getDate()}/${now.getMonth()+1} (v.${iso.week})`;
        
        renderGrid(today, iso);
    } catch (e) { console.error("Display Error", e); }
}

function renderGrid(today, iso) {
    const cont = document.getElementById('mainContainer');
    if (!cont) return;
    const cols = (globalShifts.length > 0) ? globalShifts.length : 3;
    const gridStyle = `style="display:grid; grid-template-columns: 220px repeat(${cols}, 1fr); gap:1.5vw;"`;
    let html = `<div class="time-header-row" ${gridStyle}><div></div>${globalShifts.map(s => `<div class="time-header">${s.label}</div>`).join('')}</div>`;
    globalStations.forEach(st => {
        if(st.isSpacer) { html += `<div class="display-row" style="grid-column:1/-1; height:4vh;"></div>`; return; }
        const contrast = isLight(st.color) ? '#000' : '#fff';
        const vars = `style="--station-color:${st.color}; --contrast-color:${contrast};"`;
        html += `<div class="display-row" ${gridStyle}><div class="station-label" ${vars}>${st.name}</div>`;
        globalShifts.forEach(sh => {
            const key = `y${iso.year}w${iso.week}-${today}-${st.name}-${sh.time}`;
            const val = globalScheduleData[key] || "";
            html += `<div class="shift-card ${val?'':'empty'}">${val}</div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

// NY: DYNAMISK VÄDERFUNKTION
async function initWeather() {
    let wDiv = document.getElementById('weatherWidget');
    if (!wDiv) {
        // Skapa elementet om det saknas (för säkerhets skull)
        wDiv = document.createElement('div');
        wDiv.id = 'weatherWidget';
        const clock = document.getElementById('clock');
        if (clock && clock.parentNode) clock.parentNode.insertBefore(wDiv, clock);
    }

    const fetchW = async () => {
        try {
            // Hämta sparad config eller kör default
            let config = await fetchData('weather_config');
            if (!config || !config.latitude) {
                config = { latitude: "65.82", longitude: "21.69", name: "BODEN" };
            }

            const url = `https://api.open-meteo.com/v1/forecast?latitude=${config.latitude}&longitude=${config.longitude}&current_weather=true`;
            const res = await fetch(url);
            const data = await res.json();
            
            const temp = Math.round(data.current_weather.temperature);
            const cityName = config.name.toUpperCase();
            
            wDiv.innerHTML = `${cityName}: ${temp}°C`; 
        } catch (e) { console.error("Ingen väderdata", e); }
    };
    fetchW(); setInterval(fetchW, 900000); 
}

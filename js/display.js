import { fetchData } from './service.js';
import { getISOWeek, isLight } from './utils.js';
import { DEFAULT_STATIONS, DEFAULT_SHIFTS, DAYS } from './config.js';

let lastSnap = "";
let globalStations = [];
let globalShifts = [];
let globalScheduleData = {};

export function initDisplay() {
    setInterval(() => { const el = document.getElementById('clock'); if(el) el.innerText = new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'}); }, 1000);
    initWeatherBoden();
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

async function initWeatherBoden() {
    let wDiv = document.getElementById('weatherWidget');
    if (!wDiv) return;
    const fetchW = async () => { try { const url = 'https://api.open-meteo.com/v1/forecast?latitude=65.82&longitude=21.69&current_weather=true'; const res = await fetch(url); const data = await res.json(); wDiv.innerHTML = `BODEN: ${Math.round(data.current_weather.temperature)}°C`; } catch (e) {} };
    fetchW(); setInterval(fetchW, 900000); 
}

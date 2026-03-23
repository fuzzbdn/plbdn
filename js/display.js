import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML } from './utils.js';
import { DEFAULT_STATIONS, DEFAULT_SHIFTS, DAYS } from './config.js';

let lastSnap = "";
let globalStations = [];
let globalShifts = [];
let globalScheduleData = {};

let lastWeatherFetch = 0;
let lastWeatherConfig = ""; 

export function initDisplay() {
    setInterval(() => {
        const el = document.getElementById('clock');
        if(el) el.innerText = new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'});
    }, 1000);

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
        
        const [sets, msg, themes, stations, shifts, weatherConf] = await Promise.all([
            fetchData('settings'), 
            fetchData('message'), 
            fetchData('custom_themes'), 
            fetchData('config_stations'), 
            fetchData('config_shifts'),
            fetchData('weather_config')
        ]);
        
        const snap = JSON.stringify({s:pub, t:sets?.theme, m:msg, st:stations, sh:shifts});
        
        globalScheduleData = pub || {};
        globalStations = (Array.isArray(stations) && stations.length) ? stations : DEFAULT_STATIONS;
        globalShifts = (Array.isArray(shifts) && shifts.length) ? shifts : DEFAULT_SHIFTS;

        if(snap !== lastSnap) {
            lastSnap = snap;
            
            if (sets?.theme && sets.theme !== 'light') {
                const theme = (themes||[]).find(t => t.id === sets.theme);
                if(theme) { 
                    const oldStyle = document.getElementById('dynamic-theme-style');
                    if(oldStyle) oldStyle.remove();
                    
                    const style = document.createElement('style'); 
                    style.id = 'dynamic-theme-style';
                    style.innerHTML = theme.css; 
                    document.head.appendChild(style); 
                }
            } else {
                 const oldStyle = document.getElementById('dynamic-theme-style');
                 if(oldStyle) oldStyle.remove();
            }

            const mq = document.getElementById('marqueeContainer');
            if(mq) { mq.style.display = (msg?.show && msg?.text) ? 'block' : 'none'; if(msg?.text) document.getElementById('marqueeText').innerText = msg.text; }

            const now = new Date(), iso = getISOWeek(now), today = DAYS[now.getDay()===0 ? 6 : now.getDay()-1];
            const titleEl = document.getElementById('mainTitle');
            if(titleEl) titleEl.innerText = `Vi som jobbar ${today} ${now.getDate()}/${now.getMonth()+1} (v.${iso.week})`;
            
            renderGrid(today, iso);
        }

        await handleWeatherUpdate(weatherConf);

    } catch (e) { console.error("Display Error", e); }
}

async function handleWeatherUpdate(config) {
    let wDiv = document.getElementById('weatherWidget');
    if (!wDiv) {
        wDiv = document.createElement('div');
        wDiv.id = 'weatherWidget';
        const clock = document.getElementById('clock');
        if (clock && clock.parentNode) clock.parentNode.insertBefore(wDiv, clock);
    }

    const city = config?.name || "BODEN";
    const lat = config?.latitude || "65.82";
    const long = config?.longitude || "21.69";
    const currentConfigStr = `${city}-${lat}-${long}`;
    const now = Date.now();

    if (currentConfigStr !== lastWeatherConfig || (now - lastWeatherFetch) > 900000) {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${long}&current_weather=true`;
            const res = await fetch(url);
            const data = await res.json();
            const temp = Math.round(data.current_weather.temperature);
            wDiv.innerHTML = `${escapeHTML(city).toUpperCase()}: ${temp}°C`; 
            lastWeatherFetch = now;
            lastWeatherConfig = currentConfigStr;
        } catch (e) { console.error("Väderfel:", e); }
    }
}

function renderGrid(today, iso) {
    const cont = document.getElementById('mainContainer');
    if (!cont) return;
    
    let html = `<div class="time-header-row"><div></div>${globalShifts.map(s => `<div class="time-header">${escapeHTML(s.label)}</div>`).join('')}</div>`;
    
    globalStations.forEach(st => {
        if(st.isSpacer) { 
            html += `<div class="display-row spacer-row"></div>`; 
            return; 
        }
        
        const contrast = isLight(st.color) ? '#000' : '#fff';
        const vars = `style="--station-color:${escapeHTML(st.color)}; --contrast-color:${contrast};"`;
        
        html += `<div class="display-row" ${vars}><div class="station-label">${escapeHTML(st.name)}</div>`;
        
        globalShifts.forEach(sh => {
            const key = `y${iso.year}w${iso.week}-${today}-${st.name}-${sh.time}`;
            const val = globalScheduleData[key] || "";
            const safeVal = escapeHTML(val); // XSS Skydd!
            
            html += `<div class="shift-card ${safeVal?'':'empty'}" data-label="${escapeHTML(sh.label)}">${safeVal}</div>`;
        });
        
        html += `</div>`;
    });
    cont.innerHTML = html;
}

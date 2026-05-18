import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML } from './utils.js';
import { DAYS } from './config.js'; 

let globalStations = [];
let globalShifts = [];
let globalCustomThemes = [];
let globalScheduleData = {};

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
            
            const [stations, shifts, scheduleRaw, settings, msg] = await Promise.all([
                fetchData('stations'),
                fetchData('shifts'),
                fetchData('schedule', `&start_date=${todayStr}&end_date=${todayStr}`),
                fetchData('settings'),
                fetchData('message')
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
    setInterval(updateDisplay, 15000); // Uppdatera var 15:e sekund
    
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
            
            // FIX: Prioriterar display_name om det finns, annars förnamn + efternamn
            const val = assignments.map(a => a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim()).join(' / ');
            
            html += `<div class="shift-card ${val?'':'empty'}" data-label="${escapeHTML(sh.label)}">${escapeHTML(val)}</div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

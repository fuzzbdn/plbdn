import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML } from './utils.js';
import { DEFAULT_STATIONS, DEFAULT_SHIFTS, DAYS } from './config.js';

let globalScheduleData = {};
let globalUserList = [];
let globalStations = [];
let globalShifts = [];
let selectedWeek = 0;
let selectedYear = 0;
let currentDayIndex = 0;
let isWeeklyView = false;

export async function initUser() {
    // Säkerställ att de är inloggade
    if (!sessionStorage.getItem('jwtToken')) window.location.href = "index.html";

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Användare');
    
    try {
        const [users, published, stations, shifts] = await Promise.all([
            fetchData('users'),
            fetchData('schedule_published'),
            fetchData('config_stations'),
            fetchData('config_shifts')
        ]);

        globalUserList = Array.isArray(users) ? users : [];
        globalStations = (Array.isArray(stations) && stations.length) ? stations : DEFAULT_STATIONS;
        globalShifts = (Array.isArray(shifts) && shifts.length) ? shifts : DEFAULT_SHIFTS;
        globalScheduleData = published || {}; 

    } catch (e) {
        console.error("Kunde inte hämta data:", e);
    }

    const picker = document.getElementById('userDatePicker');
    picker.value = new Date().toISOString().split('T')[0];
    picker.onchange = (e) => updateGrid(e.target.value);
    
    document.getElementById('prevDayBtn').onclick = () => changeDate(-1);
    document.getElementById('nextDayBtn').onclick = () => changeDate(1);

    function changeDate(days) {
        const d = new Date(picker.value);
        d.setDate(d.getDate() + days);
        const newDateStr = d.toISOString().split('T')[0];
        picker.value = newDateStr;
        updateGrid(newDateStr);
    }

    updateGrid(picker.value);
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };

    const toggleBtn = document.getElementById('toggleUserViewBtn');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            isWeeklyView = !isWeeklyView;
            const dayCont = document.getElementById('scheduleContainer');
            const weekCont = document.getElementById('weeklyContainer');
            
            if (isWeeklyView) {
                dayCont.style.display = 'none';
                weekCont.style.display = 'block';
                toggleBtn.innerText = "📆 Byt till Dagsvy";
                toggleBtn.style.backgroundColor = "#455a64";
                renderWeeklyView();
            } else {
                dayCont.style.display = 'grid';
                weekCont.style.display = 'none';
                toggleBtn.innerText = "📅 Byt till Veckovy";
                toggleBtn.style.backgroundColor = "#0277bd";
                renderDayGrid();
            }
        };
    }
}

function updateGrid(dateStr) {
    const d = new Date(dateStr);
    const iso = getISOWeek(d);
    selectedWeek = iso.week; 
    selectedYear = iso.year;
    currentDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    
    document.getElementById('currentDateDisplay').innerText = `${DAYS[currentDayIndex]} v.${selectedWeek}, ${selectedYear}`;
    
    if (isWeeklyView) renderWeeklyView(); else renderDayGrid();
}

function renderDayGrid() {
    const cont = document.getElementById('scheduleContainer');
    const dayName = DAYS[currentDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;

    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${escapeHTML(s.time)}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        if(st.isSpacer) { html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; return; }
        
        const contrast = isLight(st.color) ? '#000' : '#fff';
        
        // FIX: Vi lägger till '--station-color' så CSS:en kan hämta rätt färg till korten
        html += `<div class="station-row" style="--station-color:${escapeHTML(st.color)};">
                    <div class="station-label" style="background-color:${escapeHTML(st.color)}; color:${contrast};">${escapeHTML(st.name)}</div>`;
        
        globalShifts.forEach(sh => {
            const key = `${prefix}${st.name}-${sh.time}`;
            const val = globalScheduleData[key] || "";
            
            // FIX: Lade till 'data-label' så mobilen kan skriva ut "Förmiddag" bredvid namnet
            html += `<div class="shift-block ${val?'':'empty'}" data-label="${escapeHTML(sh.label)}">
                        <span class="shift-text">${escapeHTML(val)}</span>
                     </div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

function renderWeeklyView() {
    const cont = document.getElementById('weeklyContainer');
    let html = '<div class="weekly-grid"><div class="weekly-header-row"><div class="weekly-user-name">Personal</div>';
    DAYS.forEach(day => html += `<div>${day}</div>`);
    html += `</div>`;

    const sortedUsers = [...globalUserList].sort();
    
    sortedUsers.forEach(user => {
        html += `<div class="weekly-user-row"><div class="weekly-user-name">${escapeHTML(user)}</div>`;
        
        DAYS.forEach(day => {
            const prefix = `y${selectedYear}w${selectedWeek}-${day}-`;
            let userAssignments = [];

            Object.keys(globalScheduleData).forEach(key => {
                if (key.startsWith(prefix) && (globalScheduleData[key] || "").split('/').map(n=>n.trim()).includes(user)) {
                    const remainder = key.replace(prefix, '');
                    globalStations.forEach(st => {
                        if(st.isSpacer) return;
                        globalShifts.forEach(sh => {
                            if (`${st.name}-${sh.time}` === remainder) userAssignments.push({station: st.name, color: st.color, shiftLabel: sh.label});
                        });
                    });
                }
            });

            html += `<div class="weekly-cell">`;
            if (userAssignments.length === 0) {
                html += `<span class="free-text">Ledig</span>`;
            } else {
                userAssignments.forEach(a => {
                    const bg = a.color;
                    const fg = isLight(bg) ? '#000' : '#fff';
                    let shortLabel = a.shiftLabel.toLowerCase() === 'förmiddag' ? 'FM' : (a.shiftLabel.toLowerCase() === 'eftermiddag' ? 'EM' : a.shiftLabel);
                    html += `<div class="weekly-badge" style="background:${escapeHTML(bg)}; color:${fg};">${escapeHTML(a.station)} <span style="opacity:0.8; font-weight:normal;">(${escapeHTML(shortLabel)})</span></div>`;
                });
            }
            html += `</div>`;
        });
        html += `</div>`; 
    });
    html += '</div>'; 
    cont.innerHTML = html;
}

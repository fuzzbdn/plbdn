import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML } from './utils.js';
import { DAYS } from './config.js'; // <-- Fixen är här! Bara DAYS importeras nu

let globalScheduleData = {};
let globalUserList = [];
let globalStations = [];
let globalShifts = [];
let selectedWeek = 0;
let selectedYear = 0;
let currentDayIndex = 0;
let isWeeklyView = false;
let datesOfWeek = [];

function getDatesOfWeek(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const dates = [];
    for (let i=0; i<7; i++) {
        const temp = new Date(monday);
        temp.setDate(monday.getDate() + i);
        const tzoffset = temp.getTimezoneOffset() * 60000;
        dates.push((new Date(temp.getTime() - tzoffset)).toISOString().slice(0, 10));
    }
    return dates;
}

export async function initUser() {
    if (!sessionStorage.getItem('jwtToken')) {
        window.location.href = "index.html";
        return;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Användare');

    try {
        const [users, stations, shifts] = await Promise.all([
            fetchData('users'),
            fetchData('stations'),
            fetchData('shifts')
        ]);
        globalUserList = Array.isArray(users) ? users : [];
        globalStations = Array.isArray(stations) ? stations : [];
        globalShifts = Array.isArray(shifts) ? shifts : [];
    } catch (e) {
        console.error("Kunde inte hämta data:", e);
    }

    const picker = document.getElementById('userDatePicker');
    picker.value = new Date().toISOString().split('T')[0];
    picker.onchange = (e) => updateGrid(e.target.value);

    document.getElementById('prevDayBtn').onclick = () => changeDate(-1);
    document.getElementById('nextDayBtn').onclick = () => changeDate(1);

    function changeDate(days) {
        if(!picker.value) return;
        const d = new Date(picker.value);
        d.setDate(d.getDate() + days);
        const tzoffset = d.getTimezoneOffset() * 60000;
        picker.value = (new Date(d.getTime() - tzoffset)).toISOString().slice(0, 10);
        updateGrid(picker.value);
    }

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
            } else {
                dayCont.style.display = 'grid';
                weekCont.style.display = 'none';
                toggleBtn.innerText = "📅 Byt till Veckovy";
                toggleBtn.style.backgroundColor = "#0277bd";
            }
            renderViews();
        };
    }

    updateGrid(picker.value);
}

async function updateGrid(dateStr) {
    const d = new Date(dateStr);
    const iso = getISOWeek(d);
    selectedWeek = iso.week;
    selectedYear = iso.year;
    currentDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    datesOfWeek = getDatesOfWeek(dateStr);

    const dateDisplay = document.getElementById('currentDateDisplay');
    if(dateDisplay) {
        dateDisplay.innerText = `${DAYS[currentDayIndex]} v.${selectedWeek}, ${selectedYear}`;
    }

    // Hämta schema från V2 databasen
    const scheduleRaw = await fetchData('schedule', `&start_date=${datesOfWeek[0]}&end_date=${datesOfWeek[6]}`);

    globalScheduleData = {};
    if (Array.isArray(scheduleRaw)) {
        scheduleRaw.forEach(row => {
            // Användare ska BARA se publicerade pass (is_published = true)
            if (!row.is_published) return;

            const localDate = row.work_date.split('T')[0];
            const key = `${localDate}_${row.station_id}_${row.shift_id}`;
            if (!globalScheduleData[key]) globalScheduleData[key] = [];
            globalScheduleData[key].push(row);
        });
    }

    renderViews();
}

function renderViews() {
    if (isWeeklyView) renderWeeklyView(); 
    else renderDayGrid();
}

function renderDayGrid() {
    const cont = document.getElementById('scheduleContainer');
    if(!cont) return;
    const currentDateStr = datesOfWeek[currentDayIndex];

    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${escapeHTML(s.time_range || s.label)}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        if(st.is_spacer) { html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; return; }

        const contrast = isLight(st.color) ? '#000' : '#fff';
        html += `<div class="station-row" style="--station-color:${escapeHTML(st.color)};">
                    <div class="station-label" style="background-color:${escapeHTML(st.color)}; color:${contrast};">${escapeHTML(st.name)}</div>`;

        globalShifts.forEach(sh => {
            const key = `${currentDateStr}_${st.id}_${sh.id}`;
            const assignments = globalScheduleData[key] || [];

            // Slå ihop alla namn som är bokade på passet med ett snedstreck
            let val = assignments.map(a => `${a.first_name} ${a.last_name||''}`.trim()).join(' / ');

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
    if(!cont) return;
    let html = '<div class="weekly-grid"><div class="weekly-header-row"><div class="weekly-user-name">Personal</div>';
    DAYS.forEach(day => html += `<div>${day}</div>`);
    html += `</div>`;

    globalUserList.forEach(user => {
        const fullName = `${user.first_name} ${user.last_name||''}`.trim();
        html += `<div class="weekly-user-row"><div class="weekly-user-name">${escapeHTML(fullName)}</div>`;

        for (let i = 0; i < 7; i++) {
            const dateStr = datesOfWeek[i];
            let userAssignments = [];

            Object.keys(globalScheduleData).forEach(key => {
                if (key.startsWith(dateStr)) {
                    const rowAssignments = globalScheduleData[key];
                    const assignment = rowAssignments.find(a => a.user_id === user.id);
                    if (assignment) {
                        const st = globalStations.find(s => s.id === assignment.station_id);
                        const sh = globalShifts.find(s => s.id === assignment.shift_id);
                        if (st && sh) userAssignments.push({station: st.name, color: st.color, shiftLabel: sh.label});
                    }
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
        }
        html += `</div>`;
    });
    html += '</div>';
    cont.innerHTML = html;
}

import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML, buildWeeklyGridHTML } from './utils.js'; 
import { DAYS } from './config.js';

let allScheduleRows = [];
let globalUserList = [];
let globalStations = [];
let globalShifts = [];
let showOnlyMe = false;
let datesToShow = []; 
let selectedWeek = 0;
let selectedYear = 0;
let currentDayIndex = 0;
let isWeeklyView = false;
let currentSelectedDateStr = '';

export async function initUserView() {
    const userId = localStorage.getItem('userId');
    const name = localStorage.getItem('adminName');

    if (!localStorage.getItem('jwtToken')) {
        window.location.href = "index.html"; return;
    }

    if (!userId) {
        localStorage.clear();
        alert("Systemet har uppdaterats! Vänligen logga in på nytt för att se ditt personliga schema.");
        window.location.href = "index.html";
        return;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (name || 'Användare');
    document.getElementById('logoutBtn').onclick = () => { localStorage.clear(); window.location.href = "index.html"; };

    const filterBtn = document.getElementById('toggleMyScheduleBtn');
    if (filterBtn) {
        filterBtn.onclick = () => {
            showOnlyMe = !showOnlyMe;
            filterBtn.innerText = showOnlyMe ? "👥 Visa alla pass" : "👤 Visa endast mitt";
            filterBtn.style.backgroundColor = showOnlyMe ? "#455a64" : "#4CAF50";
            
            const toggleBtn = document.getElementById('toggleViewBtn');
            
            if (showOnlyMe) {
                isWeeklyView = true;
                document.getElementById('scheduleContainer').style.display = 'none';
                document.getElementById('userWeeklyContainer').style.display = 'block';
                if (toggleBtn) toggleBtn.style.display = 'none';
            } else {
                if (toggleBtn) {
                    toggleBtn.style.display = 'inline-block';
                    toggleBtn.innerText = isWeeklyView ? "📆 Byt till Dagsvy" : "📅 Byt till Veckovy";
                    toggleBtn.style.backgroundColor = isWeeklyView ? "#455a64" : "#0277bd";
                }
            }
            
            const picker = document.getElementById('userDatePicker');
            updateGrid(picker.value);
        };
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

    const toggleBtn = document.getElementById('toggleViewBtn');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            isWeeklyView = !isWeeklyView;
            const dayCont = document.getElementById('scheduleContainer');
            const weekCont = document.getElementById('userWeeklyContainer');
            if (isWeeklyView) {
                dayCont.style.display = 'none'; weekCont.style.display = 'block';
                toggleBtn.innerText = "📆 Byt till Dagsvy"; toggleBtn.style.backgroundColor = "#455a64";
            } else {
                dayCont.style.display = 'grid'; weekCont.style.display = 'none';
                toggleBtn.innerText = "📅 Byt till Veckovy"; toggleBtn.style.backgroundColor = "#0277bd";
            }
            renderViews();
        };
    }

    try {
        const [users, stations, shifts] = await Promise.all([
            fetchData('users'),
            fetchData('stations'),
            fetchData('shifts')
        ]);
        globalUserList = users || [];
        globalStations = stations || [];
        globalShifts = shifts || [];
        
        await updateGrid(picker.value);
    } catch (e) {
        console.error("Fel vid hämtning av data", e);
    }
}

async function updateGrid(dateStr) {
    currentSelectedDateStr = dateStr; 
    const d = new Date(dateStr);
    const iso = getISOWeek(d);
    selectedWeek = iso.week;
    selectedYear = iso.year;
    currentDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;

    datesToShow = [];

    if (showOnlyMe) {
        for(let i=0; i<7; i++) {
            const temp = new Date(d);
            temp.setDate(d.getDate() + i);
            const tzoffset = temp.getTimezoneOffset() * 60000;
            datesToShow.push((new Date(temp.getTime() - tzoffset)).toISOString().split('T')[0]);
        }
        document.getElementById('currentDateDisplay').innerText = `Mitt schema (7 dagar framåt)`;
    } else {
        const start = new Date(d);
        start.setDate(d.getDate() - currentDayIndex);
        for(let i=0; i<7; i++) {
            const temp = new Date(start);
            temp.setDate(start.getDate() + i);
            const tzoffset = temp.getTimezoneOffset() * 60000;
            datesToShow.push((new Date(temp.getTime() - tzoffset)).toISOString().split('T')[0]);
        }
        document.getElementById('currentDateDisplay').innerText = `${DAYS[currentDayIndex]} v.${selectedWeek}, ${selectedYear}`;
    }

    const scheduleRaw = await fetchData('schedule', `&start_date=${datesToShow[0]}&end_date=${datesToShow[6]}`);
    allScheduleRows = Array.isArray(scheduleRaw) ? scheduleRaw.filter(r => r.is_published) : [];

    renderViews();
}

function renderViews() {
    if (isWeeklyView) renderWeeklyView();
    else renderDailyView();
}

function renderDailyView() {
    const cont = document.getElementById('scheduleContainer');
    if(!cont) return;

    const currentDateStr = currentSelectedDateStr; 
    const myId = localStorage.getItem('userId');

    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${escapeHTML(s.time_range || s.label)}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        if(st.is_spacer) { html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; return; }

        const contrast = isLight(st.color) ? '#000' : '#fff';
        const styles = `background-color:${escapeHTML(st.color)}; color:${contrast}; --station-color:${escapeHTML(st.color)};`;

        html += `<div class="station-row"><div class="station-label" style="${styles}">${escapeHTML(st.name)}</div>`;

        globalShifts.forEach(sh => {
            let assignedRows = allScheduleRows.filter(r =>
                r.work_date.split('T')[0] === currentDateStr &&
                r.station_id === st.id &&
                r.shift_id === sh.id
            );

            if (showOnlyMe) {
                assignedRows = assignedRows.filter(r => String(r.user_id) === String(myId));
            }

            const hasUsers = assignedRows.length > 0;
            const textVal = assignedRows.map(a => a.display_name || `${a.first_name} ${a.last_name||''}`.trim()).join(' / ');
            
            html += `
            <div class="shift-block ${hasUsers?'':'empty'}" style="pointer-events: none;">
                <span class="shift-text">${escapeHTML(textVal)}</span>
            </div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

function renderWeeklyView() {
    const cont = document.getElementById('userWeeklyContainer');
    if (!cont) return;

    const myId = localStorage.getItem('userId');
    
    let usersToShow = showOnlyMe 
        ? globalUserList.filter(u => String(u.id) === String(myId))
        : globalUserList;

    if (usersToShow.length === 0 && showOnlyMe) {
        usersToShow.push({ id: myId, display_name: localStorage.getItem('adminName'), first_name: '', last_name: '' });
    }

    const getAssignments = (userId, dateStr) => {
        const assignments = allScheduleRows.filter(r => String(r.user_id) === String(userId) && r.work_date.split('T')[0] === dateStr);
        
        return assignments.map(a => {
            const st = globalStations.find(s => s.id === a.station_id);
            const sh = globalShifts.find(s => s.id === a.shift_id);
            if (st && sh) {
                return { stationName: st.name, stationColor: st.color, shiftLabel: sh.label };
            }
            return null;
        }).filter(Boolean);
    };

    cont.innerHTML = buildWeeklyGridHTML(usersToShow, datesToShow, getAssignments, showOnlyMe, DAYS);
}

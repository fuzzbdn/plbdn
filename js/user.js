import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML } from './utils.js';
import { DAYS } from './config.js';

let allScheduleRows = [];
let globalUserList = [];
let globalStations = [];
let globalShifts = [];
let showOnlyMe = false;
let datesOfWeek = [];
let selectedWeek = 0;
let selectedYear = 0;
let currentDayIndex = 0;
let isWeeklyView = false;

export async function initUserView() {
    const userId = sessionStorage.getItem('userId');
    const name = sessionStorage.getItem('adminName');

    if (!sessionStorage.getItem('jwtToken')) {
        window.location.href = "index.html"; return;
    }

    // --- VIKTIG SÄKERHETSSPÄRR ---
    // Om vi gjorde en uppdatering och du inte har loggat ut/in sedan dess, saknar vi ditt ID.
    if (!userId) {
        sessionStorage.clear();
        alert("Systemet har uppdaterats med personliga scheman! Vänligen logga in på nytt.");
        window.location.href = "index.html";
        return;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (name || 'Användare');
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href = "index.html"; };

    // --- FILTER KNAPPEN ---
    const filterBtn = document.getElementById('toggleMyScheduleBtn');
    if (filterBtn) {
        filterBtn.onclick = () => {
            showOnlyMe = !showOnlyMe;
            filterBtn.innerText = showOnlyMe ? "👥 Visa alla pass" : "👤 Visa endast mitt";
            filterBtn.style.backgroundColor = showOnlyMe ? "#455a64" : "#4CAF50";
            renderViews();
        };
    }

    // --- DATUMVÄLJAREN ---
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

    // --- BYTA VY ---
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
    const d = new Date(dateStr);
    const iso = getISOWeek(d);
    selectedWeek = iso.week;
    selectedYear = iso.year;
    currentDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;

    // Räkna ut datum för hela veckan baserat på valt datum
    const start = new Date(d);
    start.setDate(d.getDate() - currentDayIndex);
    datesOfWeek = [];
    for(let i=0; i<7; i++) {
        const temp = new Date(start);
        temp.setDate(start.getDate() + i);
        const tzoffset = temp.getTimezoneOffset() * 60000;
        datesOfWeek.push((new Date(temp.getTime() - tzoffset)).toISOString().split('T')[0]);
    }

    document.getElementById('currentDateDisplay').innerText = `${DAYS[currentDayIndex]} v.${selectedWeek}, ${selectedYear}`;

    // Hämta hela veckans schema från databasen
    const scheduleRaw = await fetchData('schedule', `&start_date=${datesOfWeek[0]}&end_date=${datesOfWeek[6]}`);
    
    // Vi sparar schemat som en rak lista, men sorterar bort allt opublicerat!
    allScheduleRows = Array.isArray(scheduleRaw) ? scheduleRaw.filter(r => r.is_published) : [];

    renderViews();
}

function renderViews() {
    if (isWeeklyView) renderWeeklyView();
    else renderDailyView();
}

// --- RITA UPP DAGSVYN (READ ONLY) ---
function renderDailyView() {
    const cont = document.getElementById('scheduleContainer');
    if(!cont) return;

    const currentDateStr = datesOfWeek[currentDayIndex];
    const myId = sessionStorage.getItem('userId');

    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${escapeHTML(s.time_range || s.label)}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        if(st.is_spacer) { html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; return; }

        const contrast = isLight(st.color) ? '#000' : '#fff';
        const styles = `background-color:${escapeHTML(st.color)}; color:${contrast}; --station-color:${escapeHTML(st.color)};`;

        html += `<div class="station-row"><div class="station-label" style="${styles}">${escapeHTML(st.name)}</div>`;

        globalShifts.forEach(sh => {
            // Hitta de som är inbokade på denna station/pass idag
            let assignedRows = allScheduleRows.filter(r =>
                r.work_date.split('T')[0] === currentDateStr &&
                r.station_id === st.id &&
                r.shift_id === sh.id
            );

            // Filtrera om användaren klickat på "Visa Endast Mitt"
            if (showOnlyMe) {
                assignedRows = assignedRows.filter(r => String(r.user_id) === String(myId));
            }

            const hasUsers = assignedRows.length > 0;
            const textVal = assignedRows.map(a => a.display_name || `${a.first_name} ${a.last_name||''}`.trim()).join(' / ');
            const safeVal = escapeHTML(textVal);

            // Ritan upp ett fryst/låst pass-kort utan knappar
            html += `
            <div class="shift-block ${hasUsers?'':'empty'}" style="pointer-events: none;">
                <span class="shift-text">${safeVal}</span>
            </div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

// --- RITA UPP VECKOVYN ---
function renderWeeklyView() {
    const cont = document.getElementById('userWeeklyContainer');
    if (!cont) return;

    const myId = sessionStorage.getItem('userId');

    let usersToShow = showOnlyMe
        ? globalUserList.filter(u => String(u.id) === String(myId))
        : globalUserList;

    // Om Super-Admin testar filtret, finns dennes ID normalt sett inte i globalUserList.
    // Vi skapar då ett temporärt "Dummy-objekt" så att man kan förhandsgranska sina pass ändå.
    if (usersToShow.length === 0 && showOnlyMe) {
        usersToShow.push({
            id: myId,
            display_name: sessionStorage.getItem('adminName'),
            first_name: sessionStorage.getItem('adminName'),
            last_name: ''
        });
    }

    let html = '<div class="weekly-grid"><div class="weekly-header-row"><div class="weekly-user-name">Personal</div>';
    DAYS.forEach(day => html += `<div>${day}</div>`);
    html += `</div>`;

    usersToShow.forEach(user => {
        const nameToShow = user.display_name || `${user.first_name} ${user.last_name || ''}`.trim();
        html += `<div class="weekly-user-row"><div class="weekly-user-name">${escapeHTML(nameToShow)}</div>`;

        for (let i = 0; i < 7; i++) {
            const dateStr = datesOfWeek[i];
            
            // Hitta användarens pass för just denna dag
            const assignments = allScheduleRows.filter(r => String(r.user_id) === String(user.id) && r.work_date.split('T')[0] === dateStr);

            html += `<div class="weekly-cell">`;
            if (assignments.length === 0) {
                html += `<span class="free-text">Ledig</span>`;
            } else {
                assignments.forEach(a => {
                    const st = globalStations.find(s => s.id === a.station_id);
                    const sh = globalShifts.find(s => s.id === a.shift_id);
                    if(st && sh) {
                        const bg = st.color;
                        const fg = isLight(bg) ? '#000' : '#fff';
                        let shortLabel = sh.label.toLowerCase() === 'förmiddag' ? 'FM' : (sh.label.toLowerCase() === 'eftermiddag' ? 'EM' : sh.label);
                        html += `<div class="weekly-badge" style="background:${escapeHTML(bg)}; color:${fg};">${escapeHTML(st.name)} <span style="opacity:0.8; font-weight:normal;">(${escapeHTML(shortLabel)})</span></div>`;
                    }
                });
            }
            html += `</div>`;
        }
        html += `</div>`;
    });
    html += '</div>';
    cont.innerHTML = html;
}

import { fetchData, apiAction } from './service.js';
import { getISOWeek, isLight, escapeHTML, buildWeeklyGridHTML, showToast } from './utils.js'; 
import { DAYS } from './config.js';

// ==========================================
// TILLSTÅND (State)
// ==========================================
export const userState = {
    allScheduleRows: [],
    globalUserList: [],
    globalStations: [],
    globalShifts: [],
    globalAbsences: [], 
    showOnlyMe: false,
    datesToShow: [], 
    selectedWeek: 0,
    selectedYear: 0,
    currentDayIndex: 0,
    isWeeklyView: false,
    currentSelectedDateStr: ''
};

// ==========================================
// INITIALISERING
// ==========================================
export async function initUserView() {
    const userId = localStorage.getItem('userId');
    const name = localStorage.getItem('adminName');

    // Kosmetisk tidig kontroll: Den riktiga tokenen ligger säkert i en HttpOnly-cookie.
    // Det verkliga skyddet ligger i att API:et kastar ut användaren (401) om cookien saknas/är ogiltig.
    if (!userId) {
        localStorage.clear();
        showToast("Systemet har uppdaterats! Vänligen logga in på nytt.", "info");
        setTimeout(() => window.location.replace("index.html"), 2000);
        return;
    }

    // Mobil-detektering för initial vy
    if (window.innerWidth <= 850) {
        userState.showOnlyMe = true;
        userState.isWeeklyView = true;
    } else {
        userState.showOnlyMe = false;
        userState.isWeeklyView = false;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (name || 'Användare');
    
    // Säker utloggning (rensar cookie på servern)
    document.getElementById('logoutBtn').onclick = async () => { 
        await apiAction('logout', {});
        localStorage.clear(); 
        window.location.replace("index.html"); 
    };

    // Ladda grunddata med robust felhantering
    try {
        const results = await Promise.allSettled([
            fetchData('users'),
            fetchData('stations'),
            fetchData('shifts'),
            fetchData('absences')
        ]);

        if (results.some(r => r.status === 'fulfilled' && r.value?.status === 401)) {
            return; // service.js hanterar omdirigeringen vid 401
        }

        const getResultData = (index, resourceName) => {
            const res = results[index];
            if (!res || res.status === 'rejected' || !res.value?.success) {
                console.error(`Kunde inte ladda ${resourceName}`);
                return []; // Fallback till tom array
            }
            return res.value.data;
        };

        userState.globalUserList = getResultData(0, 'personal');
        userState.globalStations = getResultData(1, 'stationer');
        userState.globalShifts = getResultData(2, 'arbetspass');
        userState.globalAbsences = getResultData(3, 'frånvaro');
        
    } catch (e) {
        console.error("Kritiskt fel vid hämtning av data", e);
        showToast("Systemdata kunde inte laddas. Prova att uppdatera sidan.", "error");
        return;
    }

    setupEventListeners();

    const picker = document.getElementById('userDatePicker');
    picker.value = new Date().toISOString().split('T')[0];
    updateGrid(picker.value);
}

// ==========================================
// EVENT LISTENERS & UI-UPPDATERINGAR
// ==========================================
function setupEventListeners() {
    const filterBtn = document.getElementById('toggleMyScheduleBtn');
    const toggleBtn = document.getElementById('toggleViewBtn');
    const picker = document.getElementById('userDatePicker');

    // Initiera UI baserat på start-state
    updateToggleButtonsUI();

    if (filterBtn) {
        filterBtn.onclick = () => {
            userState.showOnlyMe = !userState.showOnlyMe;
            
            if (userState.showOnlyMe) {
                userState.isWeeklyView = true;
            }
            
            updateToggleButtonsUI();
            updateGrid(picker.value);
        };
    }

    if (toggleBtn) {
        toggleBtn.onclick = () => {
            userState.isWeeklyView = !userState.isWeeklyView;
            updateToggleButtonsUI();
            renderViews();
        };
    }

    picker.onchange = (e) => updateGrid(e.target.value);
    document.getElementById('prevDayBtn').onclick = () => changeDate(-1);
    document.getElementById('nextDayBtn').onclick = () => changeDate(1);
}

function updateToggleButtonsUI() {
    const filterBtn = document.getElementById('toggleMyScheduleBtn');
    const toggleBtn = document.getElementById('toggleViewBtn');
    const dayCont = document.getElementById('scheduleContainer');
    const weekCont = document.getElementById('userWeeklyContainer');

    if (filterBtn) {
        filterBtn.innerText = userState.showOnlyMe ? "👥 Visa alla pass" : "👤 Visa endast mitt";
        // TODO: Överväg att lyfta ut dessa färger till CSS-klasser (.btn-active / .btn-inactive) i en framtida uppdatering.
        filterBtn.style.backgroundColor = userState.showOnlyMe ? "#455a64" : "#4CAF50";
    }

    if (toggleBtn) {
        if (userState.showOnlyMe) {
            toggleBtn.style.display = 'none';
        } else {
            toggleBtn.style.display = 'inline-block';
            toggleBtn.innerText = userState.isWeeklyView ? "📆 Byt till Dagsvy" : "📅 Byt till Veckovy";
            toggleBtn.style.backgroundColor = userState.isWeeklyView ? "#455a64" : "#0277bd";
        }
    }

    if (dayCont && weekCont) {
        if (userState.isWeeklyView) {
            dayCont.style.display = 'none';
            weekCont.style.display = 'block';
        } else {
            dayCont.style.display = 'grid';
            weekCont.style.display = 'none';
        }
    }
}

// ==========================================
// DATUM OCH DATALADDNING
// ==========================================
function changeDate(days) {
    const picker = document.getElementById('userDatePicker');
    if(!picker.value) return;
    
    const d = new Date(picker.value);
    d.setDate(d.getDate() + days);
    
    const tzoffset = d.getTimezoneOffset() * 60000;
    picker.value = (new Date(d.getTime() - tzoffset)).toISOString().slice(0, 10);
    updateGrid(picker.value);
}

async function updateGrid(dateStr) {
    userState.currentSelectedDateStr = dateStr; 
    const d = new Date(dateStr);
    const iso = getISOWeek(d);
    
    userState.selectedWeek = iso.week;
    userState.selectedYear = iso.year;
    userState.currentDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;

    userState.datesToShow = [];

    if (userState.showOnlyMe) {
        for(let i=0; i<7; i++) {
            const temp = new Date(d);
            temp.setDate(d.getDate() + i);
            const tzoffset = temp.getTimezoneOffset() * 60000;
            userState.datesToShow.push((new Date(temp.getTime() - tzoffset)).toISOString().split('T')[0]);
        }
        document.getElementById('currentDateDisplay').innerText = `Mitt schema (7 dagar framåt)`;
    } else {
        const start = new Date(d);
        start.setDate(d.getDate() - userState.currentDayIndex);
        for(let i=0; i<7; i++) {
            const temp = new Date(start);
            temp.setDate(start.getDate() + i);
            const tzoffset = temp.getTimezoneOffset() * 60000;
            userState.datesToShow.push((new Date(temp.getTime() - tzoffset)).toISOString().split('T')[0]);
        }
        document.getElementById('currentDateDisplay').innerText = `${DAYS[userState.currentDayIndex]} v.${userState.selectedWeek}, ${userState.selectedYear}`;
    }

    const scheduleRaw = await fetchData('schedule', { 
        start_date: userState.datesToShow[0], 
        end_date: userState.datesToShow[6] 
    });
    
    // Säkerställer att vi hanterar det strukturerade svaret { success, data }
    userState.allScheduleRows = (scheduleRaw?.success && Array.isArray(scheduleRaw.data)) 
        ? scheduleRaw.data.filter(r => r.is_published) 
        : [];

    renderViews();
}

// ==========================================
// RENDERING
// ==========================================
function renderViews() {
    if (userState.isWeeklyView) renderWeeklyView();
    else renderDailyView();
}

function renderDailyView() {
    const cont = document.getElementById('scheduleContainer');
    if(!cont) return;

    const currentDateStr = userState.currentSelectedDateStr; 
    const myId = localStorage.getItem('userId');

    let html = `<div class="header-row"><div></div>${userState.globalShifts.map(s => `<div>${escapeHTML(s.time_range || s.label)}</div>`).join('')}</div>`;

    userState.globalStations.forEach(st => {
        if(st.is_spacer) { html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; return; }

        const contrast = isLight(st.color) ? '#000' : '#fff';
        const styles = `background-color:${escapeHTML(st.color)}; color:${contrast}; --station-color:${escapeHTML(st.color)};`;

        html += `<div class="station-row"><div class="station-label" style="${styles}">${escapeHTML(st.name)}</div>`;

        userState.globalShifts.forEach(sh => {
            let assignedRows = userState.allScheduleRows.filter(r =>
                r.work_date.split('T')[0] === currentDateStr &&
                r.station_id === st.id &&
                r.shift_id === sh.id
            );

            if (userState.showOnlyMe) {
                assignedRows = assignedRows.filter(r => String(r.user_id) === String(myId));
            }

            const hasUsers = assignedRows.length > 0;
            const textVal = assignedRows.map(a => a.display_name || `${a.first_name} ${a.last_name||''}`.trim()).join(' / ');
            
            html += `
            <div class="shift-block ${hasUsers?'':'empty'}" data-label="${escapeHTML(sh.time_range || sh.label)}" style="pointer-events: none;">
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

    cont.setAttribute('data-only-me', userState.showOnlyMe);
    const myId = localStorage.getItem('userId');
    
    let usersToShow = userState.showOnlyMe 
        ? userState.globalUserList.filter(u => String(u.id) === String(myId))
        : userState.globalUserList;

    if (usersToShow.length === 0 && userState.showOnlyMe) {
        usersToShow.push({ id: myId, display_name: localStorage.getItem('adminName'), first_name: '', last_name: '' });
    }

    const getAssignments = (userId, dateStr) => {
        const assignments = userState.allScheduleRows.filter(r => String(r.user_id) === String(userId) && r.work_date.split('T')[0] === dateStr);
        
        return assignments.map(a => {
            const st = userState.globalStations.find(s => s.id === a.station_id);
            const sh = userState.globalShifts.find(s => s.id === a.shift_id);
            if (st && sh) {
                return { stationName: st.name, stationColor: st.color, shiftLabel: sh.time_range || sh.label };
            }
            return null;
        }).filter(Boolean);
    };

    const getAbsence = (userId, dateStr) => {
        return userState.globalAbsences.find(a => 
            String(a.user_id) === String(userId) && 
            dateStr >= a.start_date.split('T')[0] && 
            dateStr <= a.end_date.split('T')[0]
        );
    };

    cont.innerHTML = buildWeeklyGridHTML(usersToShow, userState.datesToShow, getAssignments, userState.showOnlyMe, DAYS, getAbsence);
}

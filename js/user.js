/**
 * ============================================================================
 * USERS.JS
 * Hanterar gränssnittet för vanliga användare/personal (Mitt Schema).
 * Denna fil laddar in schemat i skrivskyddat läge och låter personalen växla 
 * mellan att se bara sina egna pass eller hela arbetsgruppens schema.
 * ============================================================================
 */

import { fetchData, apiAction } from './service.js';
import { getISOWeek, isLight, escapeHTML, buildWeeklyGridHTML, showToast } from './utils.js';
import { DAYS } from './config.js';

// ==========================================
// TILLSTÅND (State)
// ==========================================
/**
 * Håller koll på applikationens nuvarande tillstånd.
 * Används för att rendera om gränssnittet utan att behöva göra nya API-anrop hela tiden.
 */
export const userState = {
    allScheduleRows: [],     // Alla publicerade pass för aktuell period
    globalUserList: [],      // Alla anställda
    globalStations: [],      // Alla arbetsstationer
    globalShifts: [],        // Alla arbetspass (tider)
    globalAbsences: [],      // All frånvaro
    showOnlyMe: false,       // Om true, dölj kollegor
    datesToShow: [],         // Array med datumsträngar som just nu visas
    selectedWeek: 0,
    selectedYear: 0,
    currentDayIndex: 0,
    isWeeklyView: false,     // Om true, visa veckomallen. Om false, visa dagsvyn.
    currentSelectedDateStr: ''
};

// ==========================================
// INITIALISERING
// ==========================================
/**
 * Startar upp användarvyn, hämtar all nödvändig grunddata och sätter upp gränssnittet.
 * Kastar ut användaren om de inte är inloggade.
 */
export async function initUserView() {
    const userId = localStorage.getItem('userId');
    const name = localStorage.getItem('adminName');

    // Säkerhetskontroll: Har användaren ett giltigt ID i webläsaren?
    if (!userId) {
        localStorage.clear();
        showToast("Systemet har uppdaterats! Vänligen logga in på nytt.", "info");
        setTimeout(() => globalThis.location.replace("index.html"), 2000);
        return;
    }

    // Adaptiv layout: Tvinga "Mitt Schema" och veckovy på mobila enheter
    if (globalThis.innerWidth <= 850) {
        userState.showOnlyMe = true;
        userState.isWeeklyView = true;
    } else {
        userState.showOnlyMe = false;
        userState.isWeeklyView = false;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (name || 'Användare');

    document.getElementById('logoutBtn').onclick = async () => {
        await apiAction('logout', {});
        localStorage.clear();
        globalThis.location.replace("index.html");
    };

    // Hämta grunddata från servern (parallellt för snabbhet)
    try {
        const results = await Promise.allSettled([
            fetchData('users'),
            fetchData('stations'),
            fetchData('shifts'),
            fetchData('absences')
        ]);

        // Om API:et svarar med 401 (Obehörig) avbryter vi (hanteras ofta redan av service.js)
        if (results.some(r => r.status === 'fulfilled' && r.value?.status === 401)) {
            return;
        }

        // Hjälpfunktion för att plocka ut datan säkert från Promise.allSettled
        const getResultData = (index, resourceName) => {
            const res = results[index];
            if (res?.status === 'rejected' || !res?.value?.success) {
                console.error(`Kunde inte ladda ${resourceName}`);
                return [];
            }
            return res.value.data;
        };

        userState.globalUserList  = getResultData(0, 'personal');
        userState.globalStations  = getResultData(1, 'stationer');
        userState.globalShifts    = getResultData(2, 'arbetspass');
        userState.globalAbsences  = getResultData(3, 'frånvaro');

    } catch (e) {
        console.error("Kritiskt fel vid hämtning av data", e);
        showToast("Systemdata kunde inte laddas. Prova att uppdatera sidan.", "error");
        return;
    }

    setupEventListeners();

    // Sätt kalendern till dagens datum och ladda schemat
    const picker = document.getElementById('userDatePicker');
    picker.value = new Date().toISOString().split('T')[0];
    updateGrid(picker.value);
}

// ==========================================
// EVENT LISTENERS & UI-UPPDATERINGAR
// ==========================================
/**
 * Kopplar händelser till knapparna i gränssnittet (Byt vy, Filtrera).
 */
function setupEventListeners() {
    const filterBtn = document.getElementById('toggleMyScheduleBtn');
    const toggleBtn = document.getElementById('toggleViewBtn');
    const picker = document.getElementById('userDatePicker');

    updateToggleButtonsUI();

    if (filterBtn) {
        filterBtn.onclick = () => {
            userState.showOnlyMe = !userState.showOnlyMe;
            // Tvinga veckovy om man väljer "Mitt schema" (eftersom dagsvy för en person är onödig)
            if (userState.showOnlyMe) userState.isWeeklyView = true;
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

/**
 * Uppdaterar text och färg på "Visa endast mitt" / "Visa alla pass" knappen.
 */
function updateFilterButton(btn) {
    if (!btn) return;
    btn.innerText = userState.showOnlyMe ? "👥 Visa alla pass" : "👤 Visa endast mitt";
    btn.style.backgroundColor = userState.showOnlyMe ? "#455a64" : "#4CAF50";
}

/**
 * Uppdaterar text och färg på knappen som byter mellan Veckovy och Dagsvy.
 */
function updateToggleButton(btn) {
    if (!btn) return;
    // Dölj knappen helt om vi tittar på "Mitt schema", eftersom den vyn alltid är en veckovy
    if (userState.showOnlyMe) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = 'inline-block';
    btn.innerText = userState.isWeeklyView ? "📆 Byt till Dagsvy" : "📅 Byt till Veckovy";
    btn.style.backgroundColor = userState.isWeeklyView ? "#455a64" : "#0277bd";
}

/**
 * Växlar synligheten på HTML-behållarna beroende på vald vy.
 */
function updateContainerVisibility(dayCont, weekCont) {
    if (!dayCont || !weekCont) return;
    if (userState.isWeeklyView) {
        dayCont.style.display = 'none';
        weekCont.style.display = 'block';
    } else {
        dayCont.style.display = 'grid';
        weekCont.style.display = 'none';
    }
}

/**
 * Anropar alla UI-uppdateringsfunktioner samtidigt.
 */
function updateToggleButtonsUI() {
    updateFilterButton(document.getElementById('toggleMyScheduleBtn'));
    updateToggleButton(document.getElementById('toggleViewBtn'));
    updateContainerVisibility(
        document.getElementById('scheduleContainer'),
        document.getElementById('userWeeklyContainer')
    );
}

// ==========================================
// DATUM OCH DATALADDNING
// ==========================================
/**
 * Hoppar framåt eller bakåt i tiden och laddar om schemat.
 * @param {number} days - Antal dagar att hoppa (t.ex. 1 eller -1).
 */
function changeDate(days) {
    const picker = document.getElementById('userDatePicker');
    if (!picker.value) return;

    const d = new Date(picker.value);
    d.setDate(d.getDate() + days);

    const tzoffset = d.getTimezoneOffset() * 60000;
    picker.value = (new Date(d.getTime() - tzoffset)).toISOString().slice(0, 10);
    updateGrid(picker.value);
}

/**
 * Beräknar en array med 7 datumsträngar beroende på vilken vy som är aktiv.
 * Om "Visa bara mig" är aktivt: 7 dagar rullande framåt från valt datum.
 * Om "Visa alla" är aktivt: Klassisk Måndag-Söndag vecka.
 * 
 * @param {Date} baseDate - Basdatumet som beräkningen utgår från.
 * @returns {Array<string>} En array med 7 datum (YYYY-MM-DD).
 */
function calculateDatesToShow(baseDate) {
    const dates = [];
    const start = new Date(baseDate);

    // Om vi vill visa kalenderveckan, backa till måndagen
    if (!userState.showOnlyMe) {
        start.setDate(baseDate.getDate() - userState.currentDayIndex);
    }

    for (let i = 0; i < 7; i++) {
        const temp = new Date(start);
        temp.setDate(start.getDate() + i);
        const tzoffset = temp.getTimezoneOffset() * 60000;
        dates.push((new Date(temp.getTime() - tzoffset)).toISOString().split('T')[0]);
    }

    return dates;
}

/**
 * Hämtar och ritar upp schemat för valt datum (och framåt).
 * @param {string} dateStr - Datumet i format YYYY-MM-DD.
 */
async function updateGrid(dateStr) {
    userState.currentSelectedDateStr = dateStr;
    const d = new Date(dateStr);
    const iso = getISOWeek(d);

    userState.selectedWeek = iso.week;
    userState.selectedYear = iso.year;
    userState.currentDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;

    userState.datesToShow = calculateDatesToShow(d);

    // Uppdatera sidhuvudets datumtext
    if (userState.showOnlyMe) {
        document.getElementById('currentDateDisplay').innerText = `Mitt schema (7 dagar framåt)`;
    } else {
        document.getElementById('currentDateDisplay').innerText = `${DAYS[userState.currentDayIndex]} v.${userState.selectedWeek}, ${userState.selectedYear}`;
    }

    // Hämta schema från databasen för de 7 beräknade dagarna
    const scheduleRaw = await fetchData('schedule', {
        start_date: userState.datesToShow[0],
        end_date: userState.datesToShow[6]
    });

    // En vanlig användare får BARA se pass som administratören har markerat som "Publicerade"
    userState.allScheduleRows = (scheduleRaw?.success && Array.isArray(scheduleRaw.data))
        ? scheduleRaw.data.filter(r => r.is_published)
        : [];

    renderViews();
}

// ==========================================
// RENDERING
// ==========================================
/**
 * Bestämmer vilken vy som ska ritas (Dag eller Vecka).
 */
function renderViews() {
    if (userState.isWeeklyView) renderWeeklyView();
    else renderDailyView();
}

/**
 * Ritar ut dagsvyn (stationer på Y-axeln, tider på X-axeln).
 */
function renderDailyView() {
    const cont = document.getElementById('scheduleContainer');
    if (!cont) return;

    const currentDateStr = userState.currentSelectedDateStr;
    const myId = localStorage.getItem('userId');

    const shiftHeaders = userState.globalShifts.map(s => `<div>${escapeHTML(s.time_range || s.label)}</div>`).join('');
    let html = `<div class="header-row"><div></div>${shiftHeaders}</div>`;

    userState.globalStations.forEach(st => {
        if (st.is_spacer) { 
            html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; 
            return; 
        }

        const contrast = isLight(st.color) ? '#000' : '#fff';
        const styles = `background-color:${escapeHTML(st.color)}; color:${contrast}; --station-color:${escapeHTML(st.color)};`;

        html += `<div class="station-row"><div class="station-label" style="${styles}">${escapeHTML(st.name)}</div>`;

        userState.globalShifts.forEach(sh => {
            // Hitta pass som matchar dag, station och skift
            let assignedRows = userState.allScheduleRows.filter(r =>
                r.work_date.split('T')[0] === currentDateStr &&
                r.station_id === st.id &&
                r.shift_id === sh.id
            );

            // Filtrera om användaren klickat på "Visa bara mitt"
            if (userState.showOnlyMe) {
                assignedRows = assignedRows.filter(r => String(r.user_id) === String(myId));
            }

            const hasUsers = assignedRows.length > 0;
            const textVal = assignedRows.map(a => a.display_name || `${a.first_name} ${a.last_name || ''}`.trim()).join(' / ');

            html += `
            <div class="shift-block ${hasUsers ? '' : 'empty'}" data-label="${escapeHTML(sh.time_range || sh.label)}" style="pointer-events: none;">
                <span class="shift-text">${escapeHTML(textVal)}</span>
            </div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

/**
 * Ritar ut veckovyn med hjälp av verktygsfunktionen `buildWeeklyGridHTML`.
 */
function renderWeeklyView() {
    const cont = document.getElementById('userWeeklyContainer');
    if (!cont) return;

    cont.dataset.onlyMe = userState.showOnlyMe;
    const myId = localStorage.getItem('userId');

    // Bestäm vilka personalrader vi ska rita ut
    let usersToShow = userState.showOnlyMe
        ? userState.globalUserList.filter(u => String(u.id) === String(myId))
        : userState.globalUserList;

    // Fallback: Om användaren inte har något registrerat pass ännu, visa i alla fall deras rad
    if (usersToShow.length === 0 && userState.showOnlyMe) {
        usersToShow.push({ id: myId, display_name: localStorage.getItem('adminName'), first_name: '', last_name: '' });
    }

    // Funktion för att koppla ihop användarens id och ett datum med deras pass
    const getAssignments = (userId, dateStr) => {
        const assignments = userState.allScheduleRows.filter(r =>
            String(r.user_id) === String(userId) && r.work_date.split('T')[0] === dateStr
        );
        
        return assignments.map(a => {
            const st = userState.globalStations.find(s => s.id === a.station_id);
            const sh = userState.globalShifts.find(s => s.id === a.shift_id);
            if (st && sh) {
                return { stationName: st.name, stationColor: st.color, shiftLabel: sh.time_range || sh.label };
            }
            return null;
        }).filter(Boolean); // Rensar bort ogiltiga pass
    };

    // Funktion för att kolla om användaren är registrerad som frånvarande detta datum
    const getAbsence = (userId, dateStr) => {
        return userState.globalAbsences.find(a =>
            String(a.user_id) === String(userId) &&
            dateStr >= a.start_date.split('T')[0] &&
            dateStr <= a.end_date.split('T')[0]
        );
    };

    cont.innerHTML = buildWeeklyGridHTML(usersToShow, userState.datesToShow, getAssignments, userState.showOnlyMe, DAYS, getAbsence);
}

import { fetchData, apiAction } from './service.js';
import { showToast, showConfirm, getISOWeek, isLight, escapeHTML, buildWeeklyGridHTML } from './utils.js'; // Importerar bygg-funktionen
import { DAYS } from './config.js';

let globalScheduleData = {}; 
let globalUserList = [];
let globalStations = [];
let globalShifts = [];
let selectedWeek = 0;
let selectedYear = 0;
let currentAdminDayIndex = 0;
let isWeeklyView = false;
let datesOfWeek = [];
let hasUnpublishedChanges = false;

// Returnerar det namn som ska visas i gränssnittet
function getFriendlyName(u) {
    if (u.display_name) return u.display_name;
    if (u.first_name) return `${u.first_name} ${u.last_name || ''}`.trim();
    return u.username;
}

// Hämtar en array med alla 7 datum för veckan som ett visst datum tillhör
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

export async function initAdmin() {
    // Säkerhetskontroll: Endast Admins och Super-Admins kommer in
    if (sessionStorage.getItem('userRole') !== 'admin' && sessionStorage.getItem('userRole') !== 'superadmin') {
        window.location.href = "user.html"; return;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    
    // --- SUPER-ADMIN: Hantera arbetsplats-rullgardinen ---
    if (sessionStorage.getItem('userRole') === 'superadmin') {
        const saContainer = document.getElementById('superAdminContainer');
        if (saContainer) saContainer.style.display = 'flex';
        loadWorkplaces();
    }
    
    async function loadWorkplaces() {
        const workplaces = await fetchData('workplaces');
        const select = document.getElementById('workplaceSelect');
        if (workplaces && select) {
            select.innerHTML = workplaces.map(w => `<option value="${w.id}">${escapeHTML(w.name)}</option>`).join('');
            const active = sessionStorage.getItem('activeWorkplace') || 'default';
            select.value = active;
            select.onchange = (e) => {
                sessionStorage.setItem('activeWorkplace', e.target.value);
                window.location.reload(); 
            };
        }
    }
    
    // Hämta grunddata från databasen
    try {
        const [users, stations, shifts] = await Promise.all([
            fetchData('users'), fetchData('stations'), fetchData('shifts')
        ]);
        globalUserList = Array.isArray(users) ? users : [];
        globalStations = Array.isArray(stations) ? stations : [];
        globalShifts = Array.isArray(shifts) ? shifts : [];
    } catch (e) {
        showToast("Fel vid hämtning av grunddata", "error");
    }

    // Sätt dagens datum i datumväljaren
    const picker = document.getElementById('adminDatePicker');
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

    // Publicera-knappen
    document.getElementById('publishBtn').onclick = async () => {
        const currentDateStr = datesOfWeek[currentAdminDayIndex];
        let start = currentDateStr, end = currentDateStr;
        let msg = `Vill du publicera dagens schema (${currentDateStr}) till displayen?`;

        if (isWeeklyView) {
            start = datesOfWeek[0]; end = datesOfWeek[6];
            msg = "Vill du publicera hela veckans schema till displayen?";
        }

        if(await showConfirm(msg)) { 
            const res = await apiAction('publish_schedule', { start_date: start, end_date: end });
            if (res.success) {
                showToast("Schemat är publicerat!", "success"); 
                updateGrid(picker.value);
            } else {
                showToast("Kunde inte publicera", "error");
            }
        }
    };

    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };
    
    // Hantera Drag and Drop
    window.handleDrop = async (e) => {
        e.preventDefault(); 
        const date = e.currentTarget.getAttribute('data-date');
        const stationId = e.currentTarget.getAttribute('data-station');
        const shiftId = e.currentTarget.getAttribute('data-shift');
        const userId = e.dataTransfer.getData("user_id"); 
        
        if (!userId) return;
        await apiAction('assign_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
        updateGrid(picker.value);
    };

    // Hantera klick (Ta bort kryss) och "skriv in namn" i schemat
    const scheduleContainer = document.getElementById('scheduleContainer');
    if (scheduleContainer) {
        scheduleContainer.addEventListener('click', async (e) => {
            if (e.target.classList.contains('clear-btn')) {
                const date = e.target.getAttribute('data-date');
                const stationId = e.target.getAttribute('data-station');
                const shiftId = e.target.getAttribute('data-shift');
                const key = `${date}_${stationId}_${shiftId}`;
                
                const assignments = globalScheduleData[key] || [];
                for (let a of assignments) {
                    await apiAction('remove_shift', { date, user_id: a.user_id, station_id: stationId, shift_id: shiftId });
                }
                updateGrid(picker.value);
            }

            if (e.target.classList.contains('add-user-btn')) {
                const date = e.target.getAttribute('data-date');
                const stationId = e.target.getAttribute('data-station');
                const shiftId = e.target.getAttribute('data-shift');
                manualAdd(e, date, stationId, shiftId);
            }
        });

        // Autocomplete när man skriver
        scheduleContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('shift-text')) showAutocomplete(e.target);
        });

        // Spara när man klickar utanför textrutan
        scheduleContainer.addEventListener('focusout', (e) => {
            if (e.target.classList.contains('shift-text')) {
                setTimeout(async () => {
                    const date = e.target.getAttribute('data-date');
                    const stationId = e.target.getAttribute('data-station');
                    const shiftId = e.target.getAttribute('data-shift');
                    await syncShiftTextToDB(date, stationId, shiftId, e.target.innerText);
                }, 150); 
            }
        });
    }

    setupSidebarAddUser();

    // Hantera Växling mellan Dag och Veckovy
    const toggleBtn = document.getElementById('toggleViewBtn');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            isWeeklyView = !isWeeklyView;
            const dayCont = document.getElementById('scheduleContainer');
            const weekCont = document.getElementById('weeklyContainer');
            if (isWeeklyView) {
                dayCont.style.display = 'none'; weekCont.style.display = 'block';
                toggleBtn.innerText = "📆 Byt till Dagsvy"; toggleBtn.style.backgroundColor = "#455a64";
            } else {
                dayCont.style.display = 'grid'; weekCont.style.display = 'none';
                toggleBtn.innerText = "📅 Byt till Veckovy"; toggleBtn.style.backgroundColor = "#0277bd";
            }
            renderViews();
            updatePublishBanner();
        };
    }

    updateGrid(picker.value);
}

// Synkar manuellt inskriven text med databasen ("Ancha-metoden")
async function syncShiftTextToDB(date, stationId, shiftId, text) {
    const key = `${date}_${stationId}_${shiftId}`;
    const currentAssignments = globalScheduleData[key] || [];
    
    // Rensa gamla pass
    for (let a of currentAssignments) {
        await apiAction('remove_shift', { date, user_id: a.user_id, station_id: stationId, shift_id: shiftId });
    }

    const names = text.split('/').map(n => n.trim()).filter(n => n.length > 0);
    for (let name of names) {
        let u = globalUserList.find(u => getFriendlyName(u).toLowerCase() === name.toLowerCase());
        if (!u) {
            // Om användaren inte finns, skapa den i databasen automatiskt
            await apiAction('quick_add_user', { fullName: name });
            const newUsers = await fetchData('users');
            if (newUsers) globalUserList = newUsers;
            u = globalUserList.find(u => getFriendlyName(u).toLowerCase() === name.toLowerCase());
        }
        if (u) {
            await apiAction('assign_shift', { date, user_id: u.id, station_id: stationId, shift_id: shiftId });
        }
    }
    updateGrid(document.getElementById('adminDatePicker').value);
}

// Laddar schemat för hela den aktuella veckan
async function updateGrid(dateStr) {
    const d = new Date(dateStr);
    const iso = getISOWeek(d);
    selectedWeek = iso.week; 
    selectedYear = iso.year;
    currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    datesOfWeek = getDatesOfWeek(dateStr);
    
    document.getElementById('currentDateDisplay').innerText = `${DAYS[currentAdminDayIndex]} v.${selectedWeek}, ${selectedYear}`;
    
    const scheduleRaw = await fetchData('schedule', `&start_date=${datesOfWeek[0]}&end_date=${datesOfWeek[6]}`);
    globalScheduleData = {};

    if (Array.isArray(scheduleRaw)) {
        scheduleRaw.forEach(row => {
            const localDate = row.work_date.split('T')[0];
            const key = `${localDate}_${row.station_id}_${row.shift_id}`;
            if (!globalScheduleData[key]) globalScheduleData[key] = [];
            globalScheduleData[key].push(row);
        });
    }

    renderViews();
    updatePublishBanner();
}

// Visar en varningsbanner om man har opublicerade ändringar
function updatePublishBanner() {
    hasUnpublishedChanges = false;
    const currentDateStr = datesOfWeek[currentAdminDayIndex];

    Object.values(globalScheduleData).forEach(assignments => {
        assignments.forEach(row => {
            if (!row.is_published) {
                const localDate = row.work_date.split('T')[0];
                if (isWeeklyView || localDate === currentDateStr) {
                    hasUnpublishedChanges = true;
                }
            }
        });
    });

    const banner = document.getElementById('publishReminderBanner');
    if (banner) {
        if (hasUnpublishedChanges) banner.classList.remove('hidden');
        else banner.classList.add('hidden');
    }
}

function renderViews() {
    if (isWeeklyView) renderWeeklyView(); 
    else renderAdminGrid();
    renderRoster();
}

// Ritar upp Dagsvyn (Grid) för editering
function renderAdminGrid() {
    const cont = document.getElementById('scheduleContainer');
    if(!cont) return;

    const currentDateStr = datesOfWeek[currentAdminDayIndex];
    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${escapeHTML(s.time_range || s.label)}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        if(st.is_spacer) { html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; return; }
        
        const contrast = isLight(st.color) ? '#000' : '#fff';
        const styles = `background-color:${escapeHTML(st.color)}; color:${contrast}; --station-color:${escapeHTML(st.color)};`; 
        
        html += `<div class="station-row"><div class="station-label" style="${styles}">${escapeHTML(st.name)}</div>`;
        
        globalShifts.forEach(sh => {
            const key = `${currentDateStr}_${st.id}_${sh.id}`;
            const assignments = globalScheduleData[key] || [];
            const hasUsers = assignments.length > 0;
            
            const textVal = assignments.map(a => getFriendlyName(a)).join(' / ');
            const safeVal = escapeHTML(textVal);
            
            html += `
            <div class="shift-block ${hasUsers?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event)" data-date="${currentDateStr}" data-station="${st.id}" data-shift="${sh.id}">
                <span class="shift-text" contenteditable="true" data-date="${currentDateStr}" data-station="${st.id}" data-shift="${sh.id}">${safeVal}</span>
                <div class="shift-controls">
                    <button class="add-user-btn" data-date="${currentDateStr}" data-station="${st.id}" data-shift="${sh.id}" title="Lägg till">+</button>
                    ${hasUsers ? `<button class="clear-btn" data-date="${currentDateStr}" data-station="${st.id}" data-shift="${sh.id}">×</button>` : ''}
                </div>
            </div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

// Hanterar rullgardinsmenyn som dyker upp när man klickar på [+] i schemat
function manualAdd(e, date, stationId, shiftId) {
    e.stopPropagation();
    const existing = document.getElementById('quick-dropdown');
    if (existing) existing.remove();

    const block = e.target.closest('.shift-block'); 
    const sortedUsers = [...globalUserList].sort((a,b) => getFriendlyName(a).localeCompare(getFriendlyName(b)));
    
    const menu = document.createElement('div');
    menu.id = 'quick-dropdown';
    menu.className = 'dropdown-menu';
    menu.style.top = 'calc(100% + 2px)'; 
    menu.style.left = '0';

    let html = sortedUsers.map(u => `<div class="dropdown-item user-select-btn" data-id="${u.id}">${escapeHTML(getFriendlyName(u))}</div>`).join('');
    html += `<div class="dropdown-item manual-btn" style="color:#0277bd; font-weight:bold; background:#e3f2fd;">+ Skriv in eget namn...</div>`;
    menu.innerHTML = html;
    
    block.appendChild(menu);

    menu.addEventListener('click', async (evt) => {
        if (evt.target.classList.contains('user-select-btn')) {
            const userId = evt.target.getAttribute('data-id');
            await apiAction('assign_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
            menu.remove();
            updateGrid(document.getElementById('adminDatePicker').value);
        } else if (evt.target.classList.contains('manual-btn')) {
            menu.remove();
            setTimeout(async () => {
                const name = prompt("Ange namn:");
                if (name) {
                    await apiAction('quick_add_user', { fullName: name });
                    const users = await fetchData('users');
                    globalUserList = users || [];
                    const newUser = globalUserList.find(u => getFriendlyName(u).toLowerCase() === name.trim().toLowerCase());
                    if (newUser) {
                        await apiAction('assign_shift', { date, user_id: newUser.id, station_id: stationId, shift_id: shiftId });
                    }
                    updateGrid(document.getElementById('adminDatePicker').value);
                }
            }, 50);
        }
    });
    
    document.addEventListener('click', function closeMenu(evt) { 
        if (!menu.contains(evt.target)) menu.remove(); 
    }, { once: true });
}

// Förslår namn medan du skriver
function showAutocomplete(element) {
    closeAutocomplete(); 
    const text = element.innerText;
    const parts = text.split('/');
    const currentPart = parts[parts.length - 1].trim();
    if (currentPart.length === 0) return;

    const matches = globalUserList.filter(u => getFriendlyName(u).toLowerCase().startsWith(currentPart.toLowerCase()));
    if (matches.length === 0) return;

    const block = element.closest('.shift-block'); 
    const dropdown = document.createElement('div');
    dropdown.id = 'autocomplete-dropdown';
    dropdown.className = 'dropdown-menu'; 
    dropdown.style.top = 'calc(100% + 2px)'; 
    dropdown.style.left = '0';

    matches.forEach(match => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerText = getFriendlyName(match);
        
        item.onmousedown = (evt) => { 
            evt.preventDefault(); 
            parts[parts.length - 1] = parts.length > 1 ? " " + getFriendlyName(match) : getFriendlyName(match);
            element.innerText = parts.join(' / ').trim();
            closeAutocomplete();
            element.blur(); 
        };
        dropdown.appendChild(item);
    });
    
    block.appendChild(dropdown);
}

function closeAutocomplete() {
    const existing = document.getElementById('autocomplete-dropdown');
    if (existing) existing.remove();
}

document.addEventListener('click', (e) => {
    if (!e.target.classList.contains('shift-text')) closeAutocomplete();
});

// ==========================================
// DRY REFACTORING: Använd vår gemensamma HTML-byggare för veckovyn
// ==========================================
function renderWeeklyView() {
    const cont = document.getElementById('weeklyContainer');
    if(!cont) return;

    // Skapa en funktion som plockar fram rätt pass baserat på användare och datum.
    // Vi formaterar datan exakt så som buildWeeklyGridHTML förväntar sig.
    const getAssignments = (userId, dateStr) => {
        let userAssignments = [];
        Object.keys(globalScheduleData).forEach(key => {
            if (key.startsWith(dateStr)) {
                const rowAssignments = globalScheduleData[key];
                const assignment = rowAssignments.find(a => String(a.user_id) === String(userId));
                if (assignment) {
                    const st = globalStations.find(s => s.id === assignment.station_id);
                    const sh = globalShifts.find(s => s.id === assignment.shift_id);
                    if (st && sh) {
                        userAssignments.push({ stationName: st.name, stationColor: st.color, shiftLabel: sh.label });
                    }
                }
            }
        });
        return userAssignments;
    };

    // Anropa vår gemensamma funktion (Skicka "false" för att inte skriva ut datumrubriker)
    cont.innerHTML = buildWeeklyGridHTML(globalUserList, datesOfWeek, getAssignments, false, DAYS);
}

// Ritar upp personal-listan till vänster
function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if(!list) return;
    
    const currentDateStr = datesOfWeek[currentAdminDayIndex];
    const workingTodayUserIds = new Set();
    
    // Hitta vilka som jobbar idag (för att gråa ut dem)
    Object.keys(globalScheduleData).forEach(k => { 
        if(k.startsWith(currentDateStr)) { 
            globalScheduleData[k].forEach(a => workingTodayUserIds.add(a.user_id));
        }
    });

    const sortedUsers = [...globalUserList].sort((a, b) => {
        const aBusy = workingTodayUserIds.has(a.id);
        const bBusy = workingTodayUserIds.has(b.id);
        if (aBusy === bBusy) {
            const nameA = getFriendlyName(a);
            const nameB = getFriendlyName(b);
            return nameA.localeCompare(nameB);
        }
        return aBusy ? 1 : -1; 
    });

    list.innerHTML = sortedUsers.map(u => {
        const isAssigned = workingTodayUserIds.has(u.id);
        const assignedClass = isAssigned ? 'assigned' : '';
        const safeName = escapeHTML(getFriendlyName(u));
        return `<div class="draggable-item ${assignedClass}" draggable="true" ondragstart="event.dataTransfer.setData('user_id','${u.id}')">${safeName} <button class="remove-user-btn" data-fullname="${safeName}">×</button></div>`;
    }).join('');
    
    list.querySelectorAll('.remove-user-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const name = e.target.getAttribute('data-fullname');
            if(await showConfirm(`Ta bort ${name} från databasen?`)){
                const res = await apiAction('remove_user', { fullName: name });
                if (res.success) {
                    showToast("Personal borttagen", "info");
                    globalUserList = await fetchData('users') || [];
                    renderViews();
                } else {
                    showToast("Kunde inte ta bort användaren", "error");
                }
            }
        };
    });
}

function setupSidebarAddUser() {
    const btn = document.getElementById('sidebarAddBtn');
    const inp = document.getElementById('sidebarNewName');
    if(btn && inp) { 
        btn.onclick = async () => {
            const newName = inp.value.trim();
            if(newName){
                const res = await apiAction('quick_add_user', { fullName: newName });
                if (res.success) {
                    showToast("Personal tillagd i databasen", "success");
                    inp.value = '';
                    globalUserList = await fetchData('users') || [];
                    renderViews();
                    updatePublishBanner();
                } else {
                    showToast("Kunde inte lägga till personal", "error");
                }
            }
        }; 
        inp.onkeydown = e => { if(e.key==='Enter') btn.click(); } 
    }
}

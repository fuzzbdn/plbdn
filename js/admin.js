import { fetchData, apiAction } from './service.js';
import { showToast, showConfirm, getISOWeek, isLight, escapeHTML } from './utils.js';
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

function getFriendlyName(u) {
    if (u.display_name) return u.display_name;
    if (u.first_name) return `${u.first_name} ${u.last_name || ''}`.trim();
    return u.username;
}

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
        const localISOTime = (new Date(temp.getTime() - tzoffset)).toISOString().slice(0, 10);
        dates.push(localISOTime);
    }
    return dates;
}

export async function initAdmin() {
    if (sessionStorage.getItem('userRole') !== 'admin') {
        window.location.href = "user.html"; return;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    
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

    document.getElementById('publishBtn').onclick = async () => {
        if(await showConfirm("Vill du publicera veckans schema till displayen?")) { 
            const res = await apiAction('publish_schedule', { start_date: datesOfWeek[0], end_date: datesOfWeek[6] });
            if (res.success) {
                showToast("Schemat är publicerat!", "success"); 
                updateGrid(picker.value);
            } else {
                showToast("Kunde inte publicera", "error");
            }
        }
    };

    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };
    
    // Drag and Drop-hantering
    window.handleDrop = async (e) => {
        e.preventDefault(); 
        const date = e.currentTarget.getAttribute('data-date');
        const stationId = e.currentTarget.getAttribute('data-station');
        const shiftId = e.currentTarget.getAttribute('data-shift');
        const userId = e.dataTransfer.getData("user_id"); 
        
        if (!userId) return;

        const key = `${date}_${stationId}_${shiftId}`;
        const existing = globalScheduleData[key] || [];
        if (existing.some(u => u.user_id == userId)) return; 

        const res = await apiAction('assign_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
        if (res.success) updateGrid(picker.value);
    };

    // Global lyssnare för schemat (Klick & Dropdown)
    const scheduleContainer = document.getElementById('scheduleContainer');
    if (scheduleContainer) {
        scheduleContainer.addEventListener('click', async (e) => {
            
            // 1. Ta bort en person (Krysset på pillret)
            if (e.target.classList.contains('clear-user-btn')) {
                const date = e.target.getAttribute('data-date');
                const stationId = e.target.getAttribute('data-station');
                const shiftId = e.target.getAttribute('data-shift');
                const userId = e.target.getAttribute('data-user');
                
                const res = await apiAction('remove_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
                if (res.success) updateGrid(picker.value);
            }

            // 2. Öppna Rullgardinsmenyn (Gröna Plus-knappen)
            if (e.target.classList.contains('add-user-btn')) {
                const btn = e.target;
                const container = btn.parentElement;
                const date = btn.getAttribute('data-date');
                const stationId = btn.getAttribute('data-station');
                const shiftId = btn.getAttribute('data-shift');

                // Stäng eventuella andra öppna menyer först
                document.querySelectorAll('.autocomplete-input').forEach(inp => inp.style.display = 'none');
                document.querySelectorAll('.autocomplete-dropdown').forEach(dd => dd.style.display = 'none');
                document.querySelectorAll('.add-user-btn').forEach(b => b.style.display = 'block');

                // Dölj knappen och förbered menyn
                btn.style.display = 'none';

                let input = container.querySelector('.autocomplete-input');
                let dropdown = container.querySelector('.autocomplete-dropdown');

                if (!input) {
                    // Skapa sökfältet och rullgardinsmenyn
                    input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'autocomplete-input';
                    input.placeholder = 'Sök / Lägg till...';
                    
                    dropdown = document.createElement('div');
                    dropdown.className = 'autocomplete-dropdown';

                    container.appendChild(input);
                    container.appendChild(dropdown);

                    // Hjälpfunktion för att spara till databasen
                    const assignUser = async (userId) => {
                        input.disabled = true;
                        const res = await apiAction('assign_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
                        if (res.success) updateGrid(document.getElementById('adminDatePicker').value);
                    };

                    const createUserAndAssign = async (name) => {
                        input.disabled = true;
                        const addRes = await apiAction('quick_add_user', { fullName: name });
                        if (addRes.success) {
                            const newUsers = await fetchData('users');
                            globalUserList = newUsers || [];
                            const matchedUser = globalUserList.find(u => getFriendlyName(u).toLowerCase() === name.toLowerCase());
                            if (matchedUser) await assignUser(matchedUser.id);
                        } else {
                            showToast("Kunde inte skapa", "error");
                            input.disabled = false;
                        }
                    };

                    // Ritar ut namnen i listan
                    const renderList = () => {
                        dropdown.innerHTML = '';
                        const val = input.value.trim().toLowerCase();
                        
                        // Filtrera på det man skriver
                        const filtered = globalUserList.filter(u => getFriendlyName(u).toLowerCase().includes(val));
                        
                        filtered.forEach(u => {
                            const item = document.createElement('div');
                            item.className = 'autocomplete-item';
                            item.textContent = getFriendlyName(u);
                            item.onmousedown = (e) => { e.preventDefault(); assignUser(u.id); }; // onmousedown förhindrar att menyn stängs för tidigt
                            dropdown.appendChild(item);
                        });

                        // Om namnet inte finns, visa "Skapa ny"
                        if (val && !filtered.some(u => getFriendlyName(u).toLowerCase() === val)) {
                            const item = document.createElement('div');
                            item.className = 'autocomplete-item new-user';
                            item.innerHTML = `➕ Skapa "<b>${escapeHTML(input.value)}</b>"`;
                            item.onmousedown = (e) => { e.preventDefault(); createUserAndAssign(input.value.trim()); };
                            dropdown.appendChild(item);
                        }
                    };

                    input.addEventListener('input', renderList);

                    // Om man trycker Enter
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            const val = input.value.trim();
                            if(!val) return;
                            const exactMatch = globalUserList.find(u => getFriendlyName(u).toLowerCase() === val.toLowerCase());
                            if(exactMatch) assignUser(exactMatch.id);
                            else createUserAndAssign(val);
                        } else if (e.key === 'Escape') {
                            input.blur();
                        }
                    });

                    // Stäng menyn om man klickar utanför
                    input.addEventListener('blur', () => {
                        setTimeout(() => {
                            input.style.display = 'none';
                            dropdown.style.display = 'none';
                            btn.style.display = 'block';
                        }, 150);
                    });
                }

                input.style.display = 'block';
                dropdown.style.display = 'block';
                input.value = '';
                input.disabled = false;
                input.focus();
                input.dispatchEvent(new Event('input')); // Ladda in hela listan direkt
            }
        });
    }

    setupSidebarAddUser();

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
        };
    }

    updateGrid(picker.value);
}

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
    hasUnpublishedChanges = false;

    if (Array.isArray(scheduleRaw)) {
        scheduleRaw.forEach(row => {
            const localDate = row.work_date.split('T')[0];
            const key = `${localDate}_${row.station_id}_${row.shift_id}`;
            if (!globalScheduleData[key]) globalScheduleData[key] = [];
            globalScheduleData[key].push(row);
            if (!row.is_published) hasUnpublishedChanges = true;
        });
    }

    renderViews();
    
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
            
            let usersHtml = assignments.map(a => {
                const nameToShow = getFriendlyName(a); 
                return `
                <span class="assigned-user-pill">
                    ${escapeHTML(nameToShow)}
                    <button class="clear-user-btn" data-date="${currentDateStr}" data-station="${st.id}" data-shift="${sh.id}" data-user="${a.user_id}">×</button>
                </span>`;
            }).join('');
            
            html += `
            <div class="shift-block ${hasUsers?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event)" data-date="${currentDateStr}" data-station="${st.id}" data-shift="${sh.id}" data-label="${escapeHTML(sh.label)}">
                <div class="shift-users-container">${usersHtml}</div>
                <div class="shift-controls" style="position:relative;">
                    <button class="add-user-btn" data-date="${currentDateStr}" data-station="${st.id}" data-shift="${sh.id}">+</button>
                </div>
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
        const nameToShow = getFriendlyName(user);
        html += `<div class="weekly-user-row"><div class="weekly-user-name">${escapeHTML(nameToShow)}</div>`;
        
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
                        if (st && sh) userAssignments.push({ station: st.name, color: st.color, shiftLabel: sh.label });
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

function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if(!list) return;
    
    const currentDateStr = datesOfWeek[currentAdminDayIndex];
    const workingTodayUserIds = new Set();
    
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
        const nameToShow = getFriendlyName(u); 
        const safeName = escapeHTML(nameToShow);
        
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
                } else {
                    showToast("Kunde inte lägga till personal", "error");
                }
            }
        }; 
        inp.onkeydown = e => { if(e.key==='Enter') btn.click(); } 
    }
}

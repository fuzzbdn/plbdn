import { fetchData, saveData } from './service.js';
import { showToast, showConfirm, getISOWeek, isLight, escapeHTML } from './utils.js';
import { DEFAULT_STATIONS, DEFAULT_SHIFTS, DAYS } from './config.js';

let globalScheduleData = {};
let publishedDataSnapshot = {};
let globalUserList = [];
let globalStations = [];
let globalShifts = [];
let selectedWeek = 0;
let selectedYear = 0;
let currentAdminDayIndex = 0;
let isWeeklyView = false; // Status för veckovyn

export async function initAdmin() {
    // --- SÄKERHETSFIX 1: Stoppa obehöriga från att nå admin-sidan ---
    if (sessionStorage.getItem('userRole') !== 'admin') {
        window.location.href = "user.html";
        return;
    }
    // -----------------------------------------------------------------

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    
    try {
        const [users, draft, published, old, stations, shifts] = await Promise.all([
            fetchData('users'),
            fetchData('schedule_draft'),
            fetchData('schedule_published'),
            fetchData('schedule'),
            fetchData('config_stations'),
            fetchData('config_shifts')
        ]);

        globalUserList = Array.isArray(users) ? users : [];
        globalStations = (Array.isArray(stations) && stations.length) ? stations : DEFAULT_STATIONS;
        globalShifts = (Array.isArray(shifts) && shifts.length) ? shifts : DEFAULT_SHIFTS;
        
        publishedDataSnapshot = published || {}; 

        if(!draft || !Object.keys(draft).length) {
            globalScheduleData = (published && Object.keys(published).length) ? published : (old || {});
        } else {
            globalScheduleData = draft;
        }

    } catch (e) {
        console.error("Kunde inte hämta data:", e);
        showToast("Fel vid hämtning av data", "error");
    }

    document.getElementById('publishBtn').onclick = async () => {
        if(await showConfirm("Vill du publicera schemat till displayen?")) { 
            await saveData('schedule_published', globalScheduleData); 
            publishedDataSnapshot = JSON.parse(JSON.stringify(globalScheduleData));
            checkPublishStatus();
            showToast("Schemat är publicerat!", "success"); 
        }
    };

    const picker = document.getElementById('adminDatePicker');
    picker.value = new Date().toISOString().split('T')[0];
    picker.onchange = (e) => updateGrid(e.target.value);
    
    const prevBtn = document.getElementById('prevDayBtn');
    const nextBtn = document.getElementById('nextDayBtn');
    
    if(prevBtn && nextBtn) {
        prevBtn.onclick = () => changeDate(-1);
        nextBtn.onclick = () => changeDate(1);
    }

    function changeDate(days) {
        const currentVal = picker.value;
        if(!currentVal) return;
        const d = new Date(currentVal);
        d.setDate(d.getDate() + days);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const newDateStr = `${yyyy}-${mm}-${dd}`;
        picker.value = newDateStr;
        updateGrid(newDateStr);
    }

    updateGrid(picker.value);
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };
    setupSidebarAddUser();
    
    const scheduleContainer = document.getElementById('scheduleContainer');
    if (scheduleContainer) {
        scheduleContainer.addEventListener('focusout', (e) => {
            if (e.target.classList.contains('shift-text')) {
                saveShift(e.target.getAttribute('data-key'), e.target.innerText);
            }
        });

        // --- LYSNAR PÅ INMATNING FÖR AUTOCOMPLETE ---
        scheduleContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('shift-text')) {
                showAutocomplete(e.target);
            }
        });

        scheduleContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('add-user-btn')) {
                manualAdd(e, e.target.getAttribute('data-key'));
            } else if (e.target.classList.contains('clear-btn')) {
                saveShift(e.target.getAttribute('data-key'), '');
            }
        });
    }

    const userListEl = document.getElementById('draggableUserList');
    if(userListEl) {
        userListEl.addEventListener('click', (e) => {
            if(e.target.classList.contains('remove-user-btn')) {
                removeUser(e.target.getAttribute('data-user'));
            }
        });
    }
    
    window.handleDrop = handleDrop;

    // --- LOGIK FÖR KNAPPEN ATT BYTA VY ---
    const toggleBtn = document.getElementById('toggleViewBtn');
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
                renderAdminGrid();
            }
        };
    }
}

function updateGrid(dateStr) {
    const d = new Date(dateStr);
    const iso = getISOWeek(d);
    selectedWeek = iso.week; 
    selectedYear = iso.year;
    currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    
    const dateDisplay = document.getElementById('currentDateDisplay');
    if(dateDisplay) {
        dateDisplay.innerText = `${DAYS[currentAdminDayIndex]} v.${selectedWeek}, ${selectedYear}`;
    }
    
    // Välj vilken vy som ska ritas om
    if (isWeeklyView) {
        renderWeeklyView();
    } else {
        renderAdminGrid();
    }
    
    renderRoster();
    checkPublishStatus();
}

function renderAdminGrid() {
    const cont = document.getElementById('scheduleContainer');
    if(!cont) return;

    const dayName = DAYS[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;

    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${escapeHTML(s.time)}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        if(st.isSpacer) { 
            html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; 
            return; 
        }
        
        const contrast = isLight(st.color) ? '#000' : '#fff';
        const styles = `background-color:${escapeHTML(st.color)}; color:${contrast}; --station-color:${escapeHTML(st.color)};`; 
        
        html += `<div class="station-row"><div class="station-label" style="${styles}">${escapeHTML(st.name)}</div>`;
        
        globalShifts.forEach(sh => {
            const key = `${prefix}${st.name}-${sh.time}`;
            const val = globalScheduleData[key] || "";
            const safeVal = escapeHTML(val);
            const safeKey = escapeHTML(key);
            
// Ändra denna del inuti renderAdminGrid() i admin.js
html += `
<div class="shift-block ${safeVal?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event)" data-key="${safeKey}" data-label="${escapeHTML(sh.label)}">
    <span class="shift-text" contenteditable="true" data-key="${safeKey}">${safeVal}</span>
    <div class="shift-controls">
        <button class="add-user-btn" data-key="${safeKey}" title="Lägg till">+</button>
        ${safeVal ? `<button class="clear-btn" data-key="${safeKey}">×</button>`:''}
    </div>
</div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

// --- DEN NYA VECKOVYN ---
function renderWeeklyView() {
    const cont = document.getElementById('weeklyContainer');
    if(!cont) return;

    let html = '<div class="weekly-grid">';
    
    // Bygg tabellhuvudet (Personal + Dagar)
    html += `<div class="weekly-header-row"><div class="weekly-user-name">Personal</div>`;
    DAYS.forEach(day => {
        html += `<div>${day}</div>`;
    });
    html += `</div>`;

    // Sortera personal i bokstavsordning
    const sortedUsers = [...globalUserList].sort();
    
    sortedUsers.forEach(user => {
        html += `<div class="weekly-user-row">`;
        html += `<div class="weekly-user-name">${escapeHTML(user)}</div>`;
        
        DAYS.forEach(day => {
            const prefix = `y${selectedYear}w${selectedWeek}-${day}-`;
            let userAssignments = [];

            // Gå igenom hela schemat efter denna persons pass för denna dag
            Object.keys(globalScheduleData).forEach(key => {
                if (key.startsWith(prefix)) {
                    const cellValue = globalScheduleData[key] || "";
                    const usersInCell = cellValue.split('/').map(n => n.trim());
                    
                    if (usersInCell.includes(user)) {
                        const remainder = key.replace(prefix, ''); // "Boden-Förmiddag"
                        let foundStation = null;
                        let foundShift = null;
                        
                        globalStations.forEach(st => {
                            if(st.isSpacer) return;
                            globalShifts.forEach(sh => {
                                if (`${st.name}-${sh.time}` === remainder) {
                                    foundStation = st; foundShift = sh;
                                }
                            });
                        });

                        if (foundStation && foundShift) {
                            userAssignments.push({
                                station: foundStation.name,
                                color: foundStation.color,
                                shiftLabel: foundShift.label
                            });
                        }
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
                    
                    // Korta ner FM/EM för att spara plats
                    let shortLabel = a.shiftLabel;
                    if(shortLabel.toLowerCase() === 'förmiddag') shortLabel = 'FM';
                    if(shortLabel.toLowerCase() === 'eftermiddag') shortLabel = 'EM';
                    
                    html += `<div class="weekly-badge" style="background:${escapeHTML(bg)}; color:${fg};">
                        ${escapeHTML(a.station)} <span style="opacity:0.8; font-weight:normal;">(${escapeHTML(shortLabel)})</span>
                    </div>`;
                });
            }
            html += `</div>`;
        });
        
        html += `</div>`; // Stäng weekly-user-row
    });

    html += '</div>'; // Stäng weekly-grid
    cont.innerHTML = html;
}

function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if(!list) return;
    
    const dayName = DAYS[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;
    const work = new Set();
    
    Object.keys(globalScheduleData).forEach(k => { 
        if(k.startsWith(prefix) && globalScheduleData[k]) { 
            globalScheduleData[k].split('/').forEach(n => work.add(n.trim())); 
        }
    });

    const sortedUsers = [...globalUserList].sort((a, b) => {
        const aBusy = work.has(a);
        const bBusy = work.has(b);
        if (aBusy === bBusy) return a.localeCompare(b);
        return aBusy ? 1 : -1; 
    });

    list.innerHTML = sortedUsers.map(u => {
        const isAssigned = work.has(u);
        const assignedClass = isAssigned ? 'assigned' : '';
        const safeU = escapeHTML(u);
        return `<div class="draggable-item ${assignedClass}" draggable="true" ondragstart="event.dataTransfer.setData('text','${safeU}')">${safeU} <button class="remove-user-btn" data-user="${safeU}">×</button></div>`;
    }).join('');
}

function checkPublishStatus() {
    const banner = document.getElementById('publishReminderBanner');
    if (!banner) return;
    const dayName = DAYS[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;
    let currentViewChanged = false;
    const val = (v) => (v || "").trim();
    const relevantKeys = new Set();
    
    Object.keys(globalScheduleData).forEach(k => { if(k.startsWith(prefix)) relevantKeys.add(k); });
    Object.keys(publishedDataSnapshot).forEach(k => { if(k.startsWith(prefix)) relevantKeys.add(k); });

    for (const key of relevantKeys) {
        if (val(globalScheduleData[key]) !== val(publishedDataSnapshot[key])) {
            currentViewChanged = true; break;
        }
    }

    if (currentViewChanged) { banner.classList.remove('hidden'); } else { banner.classList.add('hidden'); }
}

async function saveShift(k, v) { 
    globalScheduleData[k] = v.trim(); 
    await saveData('schedule_draft', globalScheduleData); 
    checkPublishStatus();
    if (isWeeklyView) renderWeeklyView(); else renderAdminGrid(); 
    renderRoster(); 
}

async function handleDrop(e) { 
    e.preventDefault(); 
    const k = e.currentTarget.getAttribute('data-key');
    const n = e.dataTransfer.getData("text"); 
    let c = globalScheduleData[k] || ""; 
    if(!c.includes(n)) await saveShift(k, c ? c + " / " + n : n); 
}

function manualAdd(e, key) {
    e.stopPropagation();
    const existing = document.getElementById('quick-dropdown');
    if (existing) existing.remove();

    const dayName = DAYS[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;
    const busyUsers = new Set();
    
    Object.keys(globalScheduleData).forEach(k => { 
        if(k.startsWith(prefix) && globalScheduleData[k]) { 
            globalScheduleData[k].split('/').forEach(n => busyUsers.add(n.trim())); 
        }
    });
    
    const availableUsers = globalUserList.filter(u => !busyUsers.has(u)).sort();
    const menu = document.createElement('div');
    menu.id = 'quick-dropdown';
    menu.className = 'dropdown-menu';
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY + 10}px`;

    let html = availableUsers.length > 0 
        ? availableUsers.map(u => `<div class="dropdown-item user-select-btn" data-key="${escapeHTML(key)}" data-user="${escapeHTML(u)}">${escapeHTML(u)}</div>`).join('') 
        : `<div class="dropdown-item disabled">Ingen ledig</div>`;
    
    html += `<div class="dropdown-item manual-btn" data-key="${escapeHTML(key)}">+ Skriv in eget namn...</div>`;
    menu.innerHTML = html;
    document.body.appendChild(menu);

    menu.addEventListener('click', (evt) => {
        if (evt.target.classList.contains('user-select-btn')) {
            selectUser(evt.target.getAttribute('data-key'), evt.target.getAttribute('data-user'));
        } else if (evt.target.classList.contains('manual-btn')) {
            selectUserManual(evt.target.getAttribute('data-key'));
        }
    });
    
    document.addEventListener('click', function closeMenu(evt) { 
        if (!menu.contains(evt.target)) menu.remove(); 
    }, { once: true });
}

async function selectUser(key, name) {
    const currentVal = globalScheduleData[key] || "";
    const newVal = currentVal ? currentVal + " / " + name : name;
    const menu = document.getElementById('quick-dropdown');
    if(menu) menu.remove();
    await saveShift(key, newVal);
}

async function selectUserManual(key) {
    const menu = document.getElementById('quick-dropdown');
    if(menu) menu.remove();
    setTimeout(async () => {
        const name = prompt("Ange namn:");
        if (name) {
            const currentVal = globalScheduleData[key] || "";
            const newVal = currentVal ? currentVal + " / " + name : name;
            await saveShift(key, newVal);
        }
    }, 50);
}

function setupSidebarAddUser() {
    const btn = document.getElementById('sidebarAddBtn');
    const inp = document.getElementById('sidebarNewName');
    if(btn && inp) { 
        btn.onclick = async () => {
            if(inp.value){
                globalUserList.push(inp.value);
                globalUserList.sort();
                await saveData('users', globalUserList);
                showToast("Personal tillagd", "success");
                inp.value='';
                if (isWeeklyView) renderWeeklyView();
                renderRoster();
            }
        }; 
        inp.onkeydown = e => { if(e.key==='Enter') btn.click(); } 
    }
}

async function removeUser(u) { 
    if(await showConfirm('Ta bort '+u+'?')){
        globalUserList = globalUserList.filter(user => user !== u);
        await saveData('users', globalUserList);
        showToast("Personal borttagen", "info");
        if (isWeeklyView) renderWeeklyView();
        renderRoster();
    } 
}

// =========================================
// AUTOCOMPLETE FUNKTIONER FÖR SCHEMAT
// =========================================

function showAutocomplete(element) {
    closeAutocomplete(); // Stäng eventuell tidigare meny

    const text = element.innerText;
    
    // Dela upp texten vid snedstreck (/) ifall flera personer redan är inlagda i samma pass
    const parts = text.split('/');
    const currentPart = parts[parts.length - 1].trim();

    // Om rutan är tom eller vi inte har skrivit någon bokstav än, visa ingen meny
    if (currentPart.length === 0) return;

    // Leta efter personal vars namn börjar på bokstäverna vi skrivit (oberoende av versaler)
    const matches = globalUserList.filter(u => u.toLowerCase().startsWith(currentPart.toLowerCase()));

    // Om vi inte hittar någon matchning, avbryt
    if (matches.length === 0) return;

    // Skapa och positionera rullgardinsmenyn under textrutan
    const rect = element.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.id = 'autocomplete-dropdown';
    dropdown.className = 'dropdown-menu'; 
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + window.scrollY}px`; 
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '10000';
    dropdown.style.maxHeight = '200px';
    dropdown.style.overflowY = 'auto';

    // Lägg till de matchande namnen i menyn
    matches.forEach(match => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerText = match;
        
        // När man klickar på ett namn i menyn
        item.onclick = (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            
            // Ersätt den påbörjade texten med det valda namnet
            parts[parts.length - 1] = parts.length > 1 ? " " + match : match;
            const newText = parts.join(' / ').trim();
            
            element.innerText = newText;
            
            // Spara passet direkt
            saveShift(element.getAttribute('data-key'), newText);
            closeAutocomplete();
        };
        dropdown.appendChild(item);
    });

    document.body.appendChild(dropdown);
}

function closeAutocomplete() {
    const existing = document.getElementById('autocomplete-dropdown');
    if (existing) existing.remove();
}

// Stäng menyn automatiskt om användaren klickar någon annanstans på skärmen
document.addEventListener('click', (e) => {
    if (!e.target.classList.contains('shift-text')) {
        closeAutocomplete();
    }
});

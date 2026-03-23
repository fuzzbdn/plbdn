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

export async function initAdmin() {
    // FIX: Tog bort escapeHTML här eftersom .innerText används
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
    
    // FIX: Event Delegation för att slippa inline JavaScript (onclick)
    const scheduleContainer = document.getElementById('scheduleContainer');
    if (scheduleContainer) {
        // Lyssnar efter när man klickar utanför en redigerad textruta (Sparar passet)
        scheduleContainer.addEventListener('focusout', (e) => {
            if (e.target.classList.contains('shift-text')) {
                saveShift(e.target.getAttribute('data-key'), e.target.innerText);
            }
        });

        // Lyssnar efter klick på Plus-knappen och Kryss-knappen i rutnätet
        scheduleContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('add-user-btn')) {
                manualAdd(e, e.target.getAttribute('data-key'));
            } else if (e.target.classList.contains('clear-btn')) {
                saveShift(e.target.getAttribute('data-key'), '');
            }
        });
    }

    // Lyssnar efter klick på Ta-bort-kryss i personalistan
    const userListEl = document.getElementById('draggableUserList');
    if(userListEl) {
        userListEl.addEventListener('click', (e) => {
            if(e.target.classList.contains('remove-user-btn')) {
                removeUser(e.target.getAttribute('data-user'));
            }
        });
    }
    
    // Gör handleDrop tillgänglig globalt då den triggas från ondrop
    window.handleDrop = handleDrop;
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
    
    renderAdminGrid();
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
            
            // FIX: Bara data-attribut istället för onclick/onblur
            html += `
            <div class="shift-block ${safeVal?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event)" data-key="${safeKey}">
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
        // FIX: Data-attribut för removeUser
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
    renderAdminGrid(); 
    renderRoster(); 
}

// FIX: Använder currentTarget och läser från data-key
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

    // FIX: Data-attribut för att undvika "O'Brian"-kraschen
    let html = availableUsers.length > 0 
        ? availableUsers.map(u => `<div class="dropdown-item user-select-btn" data-key="${escapeHTML(key)}" data-user="${escapeHTML(u)}">${escapeHTML(u)}</div>`).join('') 
        : `<div class="dropdown-item disabled">Ingen ledig</div>`;
    
    html += `<div class="dropdown-item manual-btn" data-key="${escapeHTML(key)}">+ Skriv in eget namn...</div>`;
    menu.innerHTML = html;
    document.body.appendChild(menu);

    // FIX: Händelselyssnare för klick i menyn
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
        renderRoster();
    } 
}

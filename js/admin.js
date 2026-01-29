import { fetchData, saveData } from './service.js';
import { showToast, showConfirm, getISOWeek, isLight } from './utils.js';
import { DEFAULT_STATIONS, DEFAULT_SHIFTS, DAYS } from './config.js';

let globalScheduleData = {};
let globalUserList = [];
let globalStations = [];
let globalShifts = [];
let selectedWeek = 0;
let selectedYear = 0;
let currentAdminDayIndex = 0;

/* =========================================
   5. ADMIN PLANERING
   ========================================= */
export async function initAdmin() {
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    
    // ... (Din kod för att hämta data: draft, published, old osv) ...
    let draft = await fetchData('schedule_draft');
    const published = await fetchData('schedule_published');
    const old = await fetchData('schedule');
    if(!draft || !Object.keys(draft).length) draft = (published && Object.keys(published).length) ? published : old;
    globalScheduleData = draft || {};

    // Publicera-knapp
    document.getElementById('publishBtn').onclick = async () => {
        if(await showConfirm("Vill du publicera schemat till displayen?")) { 
            await saveData('schedule_published', globalScheduleData); 
            showToast("Schemat är publicerat!", "success"); 
        }
    };

    // Datumväljare
    const picker = document.getElementById('adminDatePicker');
    picker.value = new Date().toISOString().split('T')[0];
    
    // När datumet ändras manuellt i kalendern
    picker.onchange = (e) => updateGrid(e.target.value);
    
    // --- NYTT: Koppla pilarna till funktion ---
    document.getElementById('prevDayBtn').onclick = () => changeDate(-1);
    document.getElementById('nextDayBtn').onclick = () => changeDate(1);

    function changeDate(days) {
        const currentVal = picker.value;
        if(!currentVal) return;
        
        // Skapa datumobjekt
        const d = new Date(currentVal);
        // Lägg till/dra ifrån dagar
        d.setDate(d.getDate() + days);
        
        // Formatera till YYYY-MM-DD (hanterar tidszoner säkert)
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const newDateStr = `${yyyy}-${mm}-${dd}`;
        
        // Uppdatera input-fältet och kör uppdatering
        picker.value = newDateStr;
        updateGrid(newDateStr);
    }
    // ------------------------------------------

    // Kör en första uppdatering
    updateGrid(picker.value);

    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };
    
    setupSidebarAddUser();
}

function updateGrid(dateStr) {
    const d = new Date(dateStr);
    const iso = getISOWeek(d);
    selectedWeek = iso.week; 
    selectedYear = iso.year;
    currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    
    document.getElementById('currentDateDisplay').innerText = `${DAYS[currentAdminDayIndex]} v.${selectedWeek}, ${selectedYear}`;
    renderAdminGrid();
    renderRoster();
}

function renderAdminGrid() {
    const cont = document.getElementById('scheduleContainer');
    if(!cont) return;

    const dayName = DAYS[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;

    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${s.time}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        if(st.isSpacer) { 
            html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; 
            return; 
        }
        const contrast = isLight(st.color) ? '#000' : '#fff';
        const styles = `background-color:${st.color}; color:${contrast}; --station-color:${st.color};`; 
        
        html += `<div class="station-row"><div class="station-label" style="${styles}">${st.name}</div>`;
        globalShifts.forEach(sh => {
            const key = `${prefix}${st.name}-${sh.time}`;
            const val = globalScheduleData[key] || "";
            html += `<div class="shift-block ${val?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event,'${key}')"><span class="shift-text" contenteditable="true" onblur="saveShift('${key}', this.innerText)">${val}</span><div class="shift-controls"><button class="add-user-btn" onclick="manualAdd(event, '${key}')" title="Lägg till">+</button>${val ? `<button class="clear-btn" onclick="saveShift('${key}', '')">&times;</button>`:''}</div></div>`;
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
    Object.keys(globalScheduleData).forEach(k => { if(k.startsWith(prefix) && globalScheduleData[k]) { globalScheduleData[k].split('/').forEach(n => work.add(n.trim())); }});
    const sortedUsers = [...globalUserList].sort((a, b) => { const aBusy = work.has(a); const bBusy = work.has(b); if (aBusy === bBusy) return a.localeCompare(b); return aBusy ? 1 : -1; });
    list.innerHTML = sortedUsers.map(u => `<div class="draggable-item ${work.has(u) ? 'assigned' : ''}" draggable="true" ondragstart="event.dataTransfer.setData('text','${u}')">${u} <button class="remove-user-btn" onclick="removeUser('${u}')">&times;</button></div>`).join('');
}

async function saveShift(k, v) { globalScheduleData[k] = v.trim(); await saveData('schedule_draft', globalScheduleData); renderAdminGrid(); renderRoster(); }
async function handleDrop(e, k) { e.preventDefault(); const n = e.dataTransfer.getData("text"); let c = globalScheduleData[k] || ""; if(!c.includes(n)) await saveShift(k, c ? c + " / " + n : n); }
function manualAdd(e, key) {
    e.stopPropagation(); const existing = document.getElementById('quick-dropdown'); if (existing) existing.remove();
    const dayName = DAYS[currentAdminDayIndex]; const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;
    const busyUsers = new Set(); Object.keys(globalScheduleData).forEach(k => { if(k.startsWith(prefix) && globalScheduleData[k]) { globalScheduleData[k].split('/').forEach(n => busyUsers.add(n.trim())); }});
    const availableUsers = globalUserList.filter(u => !busyUsers.has(u)).sort();
    const menu = document.createElement('div'); menu.id = 'quick-dropdown'; menu.className = 'dropdown-menu'; menu.style.left = `${e.pageX}px`; menu.style.top = `${e.pageY + 10}px`;
    let html = availableUsers.length > 0 ? availableUsers.map(u => `<div class="dropdown-item" onclick="selectUser('${key}', '${u}')">${u}</div>`).join('') : `<div class="dropdown-item disabled">Ingen ledig</div>`;
    html += `<div class="dropdown-item manual" onclick="selectUserManual('${key}')">+ Skriv in eget namn...</div>`;
    menu.innerHTML = html; document.body.appendChild(menu);
    document.addEventListener('click', function closeMenu(evt) { if (!menu.contains(evt.target)) menu.remove(); }, { once: true });
}
async function selectUser(key, name) { const currentVal = globalScheduleData[key] || ""; const newVal = currentVal ? currentVal + " / " + name : name; const menu = document.getElementById('quick-dropdown'); if(menu) menu.remove(); await saveShift(key, newVal); }
async function selectUserManual(key) { const menu = document.getElementById('quick-dropdown'); if(menu) menu.remove(); setTimeout(async () => { const name = prompt("Ange namn:"); if (name) { const currentVal = globalScheduleData[key] || ""; const newVal = currentVal ? currentVal + " / " + name : name; await saveShift(key, newVal); } }, 50); }
function setupSidebarAddUser() { const btn = document.getElementById('sidebarAddBtn'), inp = document.getElementById('sidebarNewName'); if(btn && inp) { btn.onclick = async () => { if(inp.value){ globalUserList.push(inp.value); globalUserList.sort(); await saveData('users', globalUserList); showToast("Personal tillagd", "success"); inp.value=''; renderRoster(); }}; inp.onkeydown = e => { if(e.key==='Enter') btn.click(); } } }
async function removeUser(u) { if(await showConfirm('Ta bort '+u+'?')){ globalUserList = globalUserList.filter(user => user !== u); await saveData('users', globalUserList); showToast("Personal borttagen", "info"); renderRoster(); } }

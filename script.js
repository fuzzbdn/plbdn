/* =========================================
   1. KONFIGURATION & GLOBALA VARIABLER
   ========================================= */
const DEFAULT_STATIONS = [
    { name: "Björkliden", color: "#ffb74d" },
    { name: "Kiruna",     color: "#fff176" },
    { name: "Bastuträsk", color: "#e57373" },
    { name: "Boden",      color: "#81c784" },
    { name: "Gällivare",  color: "#64b5f6" },
    { name: "Älvsbyn",    color: "#e0e0e0" },
    { isSpacer: true },
    { name: "Info",       color: "#f06292" },
    { name: "PL",         color: "#0277bd" }
];
const DEFAULT_SHIFTS = [
    { label: "Förmiddag",  time: "06:30 - 14:00" },
    { label: "Eftermiddag", time: "14:00 - 21:15" },
    { label: "Natt",        time: "21:15 - 06:30" }
];
const days = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];

let globalStations = [], globalShifts = [];
let selectedWeek = 0, selectedYear = 0, currentAdminDayIndex = 0;
let globalScheduleData = {}, globalUserList = [];
let globalCustomThemes = []; 

let editingStationIndex = null;
let editingShiftIndex = null;
let editingAdminId = null;
let dragSrcStationEl = null;

/* =========================================
   2. HJÄLPFUNKTIONER (Toast, API)
   ========================================= */
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = type === 'error' ? '❌' : (type === 'info' ? 'ℹ️' : '✅');
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { if(container.contains(toast)) container.removeChild(toast); }, 300);
    }, 3000);
}

async function fetchData(type) {
    try {
        const headers = {};
        const token = sessionStorage.getItem('jwtToken');
        if (token && type === 'admins') headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`/api/data-api?type=${type}`, { headers });
        if (!res.ok) throw new Error();
        return await res.json();
    } catch (e) { return null; }
}

async function saveData(type, data) {
    if(type.startsWith('schedule')) globalScheduleData = data;
    if(type === 'config_stations') globalStations = data;
    if(type === 'config_shifts') globalShifts = data;
    if(type === 'custom_themes') globalCustomThemes = data;

    const token = sessionStorage.getItem('jwtToken');
    if (!token) { 
        showToast("Sessionen utlöpt. Logga in igen.", "error"); 
        setTimeout(() => window.location.href="index.html", 2000);
        return; 
    }
    try {
        await fetch('/api/data-api', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` },
            body: JSON.stringify({ type, data })
        });
        return true;
    } catch (e) { return false; }
}

function isLight(color) { 
    if(!color) return true;
    const h = color.replace('#','');
    const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
    return ((r*299 + g*587 + b*114)/1000) >= 128;
}

// DYNAMISK TEMA-HANTERARE
async function applyTheme(themeId) {
    const isAdmin = (document.body.id === 'page-admin' || document.body.id === 'page-settings');
    const oldStyle = document.getElementById('dynamic-theme-style');
    if(oldStyle) oldStyle.remove();

    if (!themeId || themeId === 'light') return;

    if (globalCustomThemes.length === 0) {
        globalCustomThemes = await fetchData('custom_themes') || [];
    }
    const customTheme = globalCustomThemes.find(t => t.id === themeId);

    if (customTheme) {
        if (!isAdmin || document.body.id === 'page-login') {
            const style = document.createElement('style');
            style.id = 'dynamic-theme-style';
            style.textContent = customTheme.css;
            document.head.appendChild(style);
        }
    }
}

/* =========================================
   3. INIT & AUTH
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const pageId = document.body.id;
    if (pageId === 'page-login') { initLogin(); return; }
    if (pageId === 'page-reset') { initReset(); return; }

    const [users, settings, dbStations, dbShifts, themes] = await Promise.all([
        fetchData('users'), 
        fetchData('settings'), 
        fetchData('config_stations'), 
        fetchData('config_shifts'),
        fetchData('custom_themes')
    ]);

    globalUserList = Array.isArray(users) ? users : [];
    globalStations = (Array.isArray(dbStations) && dbStations.length > 0) ? dbStations : DEFAULT_STATIONS;
    globalShifts = (Array.isArray(dbShifts) && dbShifts.length > 0) ? dbShifts : DEFAULT_SHIFTS;
    globalCustomThemes = Array.isArray(themes) ? themes : [];

    if (settings?.theme) applyTheme(settings.theme);

    if (pageId === 'page-admin') { if(checkAuth()) initAdmin(); }
    else if (pageId === 'page-settings') { if(checkAuth()) initSettings(settings); }
    else if (pageId === 'page-display') { initDisplay(); }
});

function checkAuth() {
    if (!sessionStorage.getItem('jwtToken')) { window.location.href="index.html"; return false; }
    return true;
}

function initLogin() {
    fetchData('settings').then(s => { 
        if(s?.theme) {
            fetchData('custom_themes').then(t => {
                globalCustomThemes = t || [];
                applyTheme(s.theme);
            });
        }
    });
    const loginBtn = document.getElementById('loginBtn');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');
    const doLogin = async () => {
        try {
            const res = await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'login', username:userIn.value.trim(), password:passIn.value.trim()}) });
            const d = await res.json();
            if(d.success) {
                sessionStorage.setItem('jwtToken', d.token); sessionStorage.setItem('adminUser', d.user); sessionStorage.setItem('adminName', d.name);
                window.location.href = "admin.html";
            } else showToast("Fel användarnamn eller lösenord", "error");
        } catch(e) { showToast("Serverfel vid inloggning", "error"); }
    };
    if(loginBtn) loginBtn.onclick = doLogin;
    const handleEnter = (e) => { if(e.key==='Enter') doLogin(); };
    if(userIn) userIn.onkeydown = handleEnter;
    if(passIn) passIn.onkeydown = handleEnter;
    const forgotLink = document.getElementById('forgotPassLink');
    if(forgotLink) forgotLink.onclick = (e) => { e.preventDefault(); document.getElementById('loginForm').style.display='none'; document.getElementById('forgotForm').style.display='block'; };
    const resetBtn = document.getElementById('sendResetBtn');
    if(resetBtn) resetBtn.onclick = async () => {
        const email = document.getElementById('resetEmailInput').value;
        if(!email) return showToast("Ange e-post", "info");
        await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'request_reset', email}) });
        showToast("Om e-posten finns har en länk skickats.", "success"); setTimeout(() => window.location.reload(), 2000);
    };
}

function initReset() {
    const t = new URLSearchParams(window.location.search).get('token');
    if(!t) return;
    document.getElementById('resetSubmitBtn').onclick = async () => {
        const p1 = document.getElementById('newPassInput').value;
        const p2 = document.getElementById('confirmPassInput').value;
        if(p1!==p2) return showToast("Lösenorden matchar ej", "error");
        const res = await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'perform_reset', token:t, newPassword:p1}) });
        if(res.ok) { showToast("Lösenord ändrat!", "success"); window.location.href="index.html"; } else showToast("Kunde inte återställa", "error");
    };
}

/* =========================================
   4. SETTINGS
   ========================================= */
async function initSettings(currentSettings) {
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    const themeSelect = document.getElementById('themeSelect');
    const themeNameIn = document.getElementById('customThemeName');
    const themeCssIn = document.getElementById('customThemeCSS');
    const themeIdIn = document.getElementById('customThemeId');
    const editSelect = document.getElementById('editThemeSelect');

    function populateThemeDropdowns() {
        const current = themeSelect.value || (currentSettings?.theme || 'light');
        themeSelect.innerHTML = `<option value="light">Ljus (Standard)</option>` + 
                                globalCustomThemes.map(t => `<option value="${t.id}">✨ ${t.name}</option>`).join('');
        themeSelect.value = current;
        if(editSelect) {
            editSelect.innerHTML = '<option value="">-- Välj tema att redigera --</option>' + 
                globalCustomThemes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
        }
    }
    populateThemeDropdowns();

    document.getElementById('saveThemeBtn').onclick = async () => {
        await saveData('settings', { theme: themeSelect.value });
        showToast("Tema aktiverat!", "success");
    };

    if(editSelect) {
        editSelect.onchange = () => {
            const t = globalCustomThemes.find(x => x.id === editSelect.value);
            if (t) { themeNameIn.value = t.name; themeCssIn.value = t.css; themeIdIn.value = t.id; }
        };
        document.getElementById('clearThemeEditorBtn').onclick = () => { themeIdIn.value = ""; themeNameIn.value = ""; themeCssIn.value = ""; editSelect.value = ""; };
        document.getElementById('saveCustomThemeBtn').onclick = async () => {
            if(!themeNameIn.value || !themeCssIn.value) return showToast("Fyll i namn och CSS", "error");
            const id = themeIdIn.value || 'theme_' + Date.now();
            const newTheme = { id: id, name: themeNameIn.value, css: themeCssIn.value };
            const index = globalCustomThemes.findIndex(t => t.id === id);
            if(index >= 0) globalCustomThemes[index] = newTheme; else globalCustomThemes.push(newTheme);
            await saveData('custom_themes', globalCustomThemes);
            showToast("Tema sparat!", "success");
            document.getElementById('clearThemeEditorBtn').click(); populateThemeDropdowns();
        };
        document.getElementById('deleteThemeBtn').onclick = async () => {
            const id = editSelect.value;
            if(!id) return;
            if(confirm("Radera detta tema?")) {
                globalCustomThemes = globalCustomThemes.filter(t => t.id !== id);
                await saveData('custom_themes', globalCustomThemes);
                if(themeSelect.value === id) { themeSelect.value = 'light'; await saveData('settings', { theme: 'light' }); }
                showToast("Tema raderat", "info"); document.getElementById('clearThemeEditorBtn').click(); populateThemeDropdowns();
            }
        };
    }
    
    initStationsSettings(); initShiftsSettings(); initAdminSettings();
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };
    
    const msgIn = document.getElementById('displayMessageInput');
    const msgCheck = document.getElementById('showMessageCheckbox');
    const msg = await fetchData('message');
    if(msg) { msgIn.value = msg.text||""; msgCheck.checked = msg.show||false; }
    document.getElementById('saveMessageBtn').onclick = async () => {
        await saveData('message', { text: msgIn.value, show: msgCheck.checked });
        showToast("Meddelande uppdaterat!", "success");
    };
}

function initStationsSettings() {
    const stName = document.getElementById('newStationName');
    const stColor = document.getElementById('newStationColor');
    const stBtn = document.getElementById('addStationBtn');
    const stCancel = document.getElementById('cancelStationEditBtn');

    window.handleStationDragStart = (e) => {
        dragSrcStationEl = e.target.closest('.draggable-station');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', dragSrcStationEl.innerHTML);
        dragSrcStationEl.classList.add('dragging');
    };
    window.handleStationDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; };
    window.handleStationDrop = async (e) => {
        e.stopPropagation();
        const targetEl = e.target.closest('.draggable-station');
        if (dragSrcStationEl && targetEl && dragSrcStationEl !== targetEl) {
            const oldIndex = parseInt(dragSrcStationEl.dataset.index);
            const newIndex = parseInt(targetEl.dataset.index);
            const movedItem = globalStations.splice(oldIndex, 1)[0];
            globalStations.splice(newIndex, 0, movedItem);
            await saveData('config_stations', globalStations);
            renderStations(); 
        }
        return false;
    };

    const renderStations = () => {
        const cont = document.getElementById('stationListContainer');
        if(!Array.isArray(globalStations)) globalStations = DEFAULT_STATIONS;
        cont.innerHTML = globalStations.map((st, i) => {
            const dragAttr = `draggable="true" ondragstart="handleStationDragStart(event)" ondragover="handleStationDragOver(event)" ondrop="handleStationDrop(event)" data-index="${i}"`;
            if(st.isSpacer) return `<div class="draggable-station" ${dragAttr} style="background:#f9f9f9; color:#888;"><div style="display:flex; align-items:center;"><span class="drag-handle">☰</span><i>--- Mellanrum ---</i></div><button class="list-btn" onclick="deleteStation(${i})">🗑️</button></div>`;
            return `<div class="draggable-station" ${dragAttr}><div style="display:flex; align-items:center; gap:10px;"><span class="drag-handle">☰</span><div style="width:20px; height:20px; background:${st.color}; border-radius:50%; border:1px solid #ccc;"></div><strong>${st.name}</strong></div><div><button class="list-btn" onclick="startEditStation(${i})">✏️</button><button class="list-btn" onclick="deleteStation(${i})">🗑️</button></div></div>`;
        }).join('');
    };

    window.startEditStation = (i) => {
        editingStationIndex = i; stName.value = globalStations[i].name; stColor.value = globalStations[i].color;
        stBtn.innerText = "💾"; stBtn.style.background = "#2196F3"; stCancel.style.display = "block";
    };
    const resetSt = () => { editingStationIndex = null; stName.value = ""; stBtn.innerText = "+"; stBtn.style.background = ""; stCancel.style.display = "none"; };
    stCancel.onclick = resetSt;

    stBtn.onclick = async () => {
        if(!stName.value) return showToast("Ange namn", "info");
        const item = { name: stName.value, color: stColor.value };
        if(editingStationIndex !== null) globalStations[editingStationIndex] = item; else globalStations.push(item);
        await saveData('config_stations', globalStations);
        showToast("Sparat", "success"); resetSt(); renderStations();
    };
    document.getElementById('addSpacerBtn').onclick = async () => { globalStations.push({ isSpacer: true }); await saveData('config_stations', globalStations); renderStations(); };
    window.deleteStation = async (i) => { if(confirm("Ta bort?")) { globalStations.splice(i, 1); await saveData('config_stations', globalStations); renderStations(); }};
    renderStations();
}

function initShiftsSettings() {
    const shLabel = document.getElementById('newShiftLabel'), shTime = document.getElementById('newShiftTime');
    const shBtn = document.getElementById('addShiftBtn'), shCancel = document.getElementById('cancelShiftEditBtn');

    const renderShifts = () => {
        const cont = document.getElementById('shiftListContainer');
        if(!Array.isArray(globalShifts)) globalShifts = DEFAULT_SHIFTS;
        cont.innerHTML = globalShifts.map((sh, i) => `<div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #eee;"><div><strong>${sh.label}</strong> <span style="color:#666;">(${sh.time})</span></div><div><button class="list-btn" onclick="startEditShift(${i})">✏️</button><button class="list-btn" onclick="deleteShift(${i})">🗑️</button></div></div>`).join('');
    };
    window.startEditShift = (i) => { editingShiftIndex = i; shLabel.value = globalShifts[i].label; shTime.value = globalShifts[i].time; shBtn.innerText = "Spara"; shBtn.style.background = "#2196F3"; shCancel.style.display = "block"; };
    const resetSh = () => { editingShiftIndex = null; shLabel.value = ""; shTime.value = ""; shBtn.innerText = "Lägg till Pass"; shBtn.style.background = ""; shCancel.style.display = "none"; };
    shCancel.onclick = resetSh;
    shBtn.onclick = async () => { if(!shLabel.value) return; const item = { label: shLabel.value, time: shTime.value }; if(editingShiftIndex !== null) globalShifts[editingShiftIndex] = item; else globalShifts.push(item); await saveData('config_shifts', globalShifts); showToast("Sparat", "success"); resetSh(); renderShifts(); };
    window.deleteShift = async (i) => { if(confirm("Ta bort?")) { globalShifts.splice(i, 1); await saveData('config_shifts', globalShifts); renderShifts(); }};
    renderShifts();
}

// ----------------------------------------------------------------------------------
// ADMIN-HANTERING
// ----------------------------------------------------------------------------------
function initAdminSettings() {
    const admBtn = document.getElementById('addAdminBtn');
    const admCancel = document.getElementById('cancelAdminEditBtn');
    const admUser = document.getElementById('newAdminUser');
    const admPass = document.getElementById('newAdminPass');
    const admFirst = document.getElementById('newAdminFirstName');
    const admLast = document.getElementById('newAdminLastName');
    const admEmail = document.getElementById('newAdminEmail');

    const renderAdmins = async () => {
        let admins = await fetchData('admins');
        if(!Array.isArray(admins)) admins = [];
        document.getElementById('adminListContainer').innerHTML = admins.map(a => `
            <div style="padding:8px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <span>${a.first_name||''} ${a.last_name||''} (${a.username})</span>
                <div>
                    <button class="list-btn" onclick='startEditAdmin(${JSON.stringify(a).replace(/'/g,"&#39;")})'>✏️</button>
                    <button class="list-btn" onclick="deleteAdmin('${a.username}')">🗑️</button>
                </div>
            </div>`).join('');
    };

    window.startEditAdmin = (u) => {
        editingAdminId = u.id; 
        admUser.value = u.username; 
        admFirst.value = u.first_name||""; 
        admLast.value = u.last_name||""; 
        admEmail.value = u.email||"";
        admPass.placeholder = "Nytt lösen (valfritt)"; 
        admPass.value = "";
        admBtn.innerText = "💾"; 
        admBtn.style.background = "#2196F3"; 
        admCancel.style.display = "block";
    };

    const resetAdm = () => { 
        editingAdminId = null; 
        admUser.value = ""; 
        admPass.value = ""; 
        admFirst.value = ""; 
        admLast.value = ""; 
        admEmail.value = ""; 
        admPass.placeholder = "Lösenord"; 
        admBtn.innerText = "+"; 
        admBtn.style.background = ""; 
        admCancel.style.display = "none"; 
    };
    admCancel.onclick = resetAdm;

    admBtn.onclick = async () => {
        const u = admUser.value, p = admPass.value;
        if(!u) return showToast("Användarnamn krävs", "error");
        
        const action = editingAdminId ? 'edit_admin' : 'add_admin';
        if(action === 'add_admin' && !p) return showToast("Lösenord krävs", "error");
        
        await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, 
            body: JSON.stringify({
                action, 
                username:u, 
                password:p, 
                firstName:admFirst.value, 
                lastName:admLast.value, 
                email:admEmail.value, 
                id:editingAdminId
            }) 
        });
        showToast(editingAdminId ? "Admin uppdaterad" : "Admin tillagd", "success");
        resetAdm(); renderAdmins();
    };

    window.deleteAdmin = async(u) => { 
        if(confirm("Ta bort admin?")) {
            await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, body: JSON.stringify({action:'remove_admin', username:u}) }); 
            showToast("Admin borttagen", "info");
            renderAdmins(); 
        }
    };
    renderAdmins();
}

/* =========================================
   5. ADMIN PLANERING
   ========================================= */
async function initAdmin() {
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    let draft = await fetchData('schedule_draft');
    const published = await fetchData('schedule_published');
    const old = await fetchData('schedule');
    if(!draft || !Object.keys(draft).length) draft = (published && Object.keys(published).length) ? published : old;
    globalScheduleData = draft || {};

    document.getElementById('publishBtn').onclick = async () => {
        if(confirm("Publicera?")) { await saveData('schedule_published', globalScheduleData); showToast("Schemat är publicerat!", "success"); }
    };
    const picker = document.getElementById('adminDatePicker');
    picker.value = new Date().toISOString().split('T')[0];
    picker.onchange = (e) => updateGrid(e.target.value);
    
    function updateGrid(dateStr) {
        const d = new Date(dateStr);
        const iso = getISOWeek(d);
        selectedWeek = iso.week; selectedYear = iso.year;
        currentAdminDayIndex = d.getDay()===0?6:d.getDay()-1;
        document.getElementById('currentDateDisplay').innerText = `${days[currentAdminDayIndex]} v.${selectedWeek}, ${selectedYear}`;
        renderAdminGrid();
    }
    updateGrid(picker.value);
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };
    
    // EXPORTKNAPPAR
    document.getElementById('exportBtn').onclick = generateImage;
    document.getElementById('printBtn').onclick = () => {
        const pc = document.getElementById('print-container') || document.createElement('div');
        pc.id = 'print-container';
        if(!document.body.contains(pc)) document.body.appendChild(pc);
        
        pc.innerHTML = getScheduleHtmlForPrint();
        window.print();
        setTimeout(() => pc.innerHTML='', 1000);
    };
    
    setupSidebarAddUser();
}

// ------------------------------------------------------------------
// RENDER ADMIN GRID (Här tog vi bort grå bakgrund på spacer)
// ------------------------------------------------------------------
function renderAdminGrid() {
    const cont = document.getElementById('scheduleContainer');
    renderRoster();
    if(!cont) return;

    const dayName = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;

    if(!Array.isArray(globalShifts) || !globalShifts.length) globalShifts = DEFAULT_SHIFTS;
    if(!Array.isArray(globalStations) || !globalStations.length) globalStations = DEFAULT_STATIONS;

    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${s.time}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        if(st.isSpacer) { 
            // HÄR ÄR ÄNDRINGEN: Tog bort 'background:#f5f5f5'
            html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; 
            return; 
        }
        
        const contrast = isLight(st.color) ? '#000' : '#fff';
        const styles = `background-color:${st.color}; color:${contrast}; --station-color:${st.color};`; 
        
        html += `<div class="station-row"><div class="station-label" style="${styles}">${st.name}</div>`;
        globalShifts.forEach(sh => {
            const key = `${prefix}${st.name}-${sh.time}`;
            const val = globalScheduleData[key] || "";
            html += `
            <div class="shift-block ${val?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event,'${key}')">
                <span class="shift-text" contenteditable="true" onblur="saveShift('${key}', this.innerText)">${val}</span>
                <div class="shift-controls">
                    <button class="add-user-btn" onclick="manualAdd(event, '${key}')" title="Lägg till">+</button>
                    ${val ? `<button class="clear-btn" onclick="saveShift('${key}', '')">&times;</button>`:''}
                </div>
            </div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

window.manualAdd = (e, key) => {
    e.stopPropagation();
    const existing = document.getElementById('quick-dropdown');
    if (existing) existing.remove();

    const day = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${day}-`;
    const busyUsers = new Set();
    Object.keys(globalScheduleData).forEach(k => { if(k.startsWith(prefix) && globalScheduleData[k]) { globalScheduleData[k].split('/').forEach(n => busyUsers.add(n.trim())); }});
    const availableUsers = globalUserList.filter(u => !busyUsers.has(u));
    availableUsers.sort();

    const menu = document.createElement('div');
    menu.id = 'quick-dropdown';
    menu.className = 'dropdown-menu';
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY + 10}px`;

    let html = '';
    if (availableUsers.length > 0) {
        html += availableUsers.map(u => `<div class="dropdown-item" onclick="selectUser('${key}', '${u}')">${u}</div>`).join('');
    } else {
        html += `<div class="dropdown-item disabled">Ingen ledig</div>`;
    }
    html += `<div class="dropdown-item manual" onclick="selectUserManual('${key}')">+ Skriv in eget namn...</div>`;
    menu.innerHTML = html;
    document.body.appendChild(menu);
    document.addEventListener('click', function closeMenu(evt) { if (!menu.contains(evt.target)) menu.remove(); }, { once: true });
};

window.selectUser = async (key, name) => {
    const currentVal = globalScheduleData[key] || "";
    const newVal = currentVal ? currentVal + " / " + name : name;
    const menu = document.getElementById('quick-dropdown');
    if(menu) menu.remove();
    await saveShift(key, newVal);
};

window.selectUserManual = async (key) => {
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
};

function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if(!list) return;
    const day = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${day}-`;
    const work = new Set();
    Object.keys(globalScheduleData).forEach(k => { if(k.startsWith(prefix) && globalScheduleData[k]) { globalScheduleData[k].split('/').forEach(n => work.add(n.trim())); }});
    const sortedUsers = [...globalUserList].sort((a, b) => {
        const aBusy = work.has(a);
        const bBusy = work.has(b);
        if (aBusy === bBusy) return a.localeCompare(b);
        return aBusy ? 1 : -1; 
    });
    list.innerHTML = sortedUsers.map(u => {
        const isAssigned = work.has(u);
        const assignedClass = isAssigned ? 'assigned' : '';
        return `<div class="draggable-item ${assignedClass}" draggable="true" ondragstart="event.dataTransfer.setData('text','${u}')">${u} <button class="remove-user-btn" onclick="removeUser('${u}')">&times;</button></div>`;
    }).join('');
}

async function saveShift(k, v) { globalScheduleData[k] = v.trim(); await saveData('schedule_draft', globalScheduleData); renderAdminGrid(); }
async function handleDrop(e, k) { e.preventDefault(); const n = e.dataTransfer.getData("text"); let c = globalScheduleData[k]||""; if(!c.includes(n)) await saveShift(k, c?c+" / "+n:n); }

/* =========================================
   6. DISPLAY
   ========================================= */
let lastSnap="";
function initDisplay() {
    setInterval(()=>document.getElementById('clock').innerText=new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'}),1000);
    const refresh = async () => {
        let pub = await fetchData('schedule_published');
        if(!pub || !Object.keys(pub).length) pub = await fetchData('schedule');
        const [sets, msg, themes] = await Promise.all([fetchData('settings'), fetchData('message'), fetchData('custom_themes')]);
        
        globalCustomThemes = themes || [];
        const snap = JSON.stringify({s:pub, t:sets?.theme, m:msg});
        if(snap === lastSnap) return; lastSnap=snap;
        globalScheduleData = pub || {};

        if(sets?.theme) applyTheme(sets.theme);
        const mq = document.getElementById('marqueeContainer');
        if(mq) { mq.style.display=(msg?.show&&msg?.text)?'block':'none'; if(msg?.text) document.getElementById('marqueeText').innerText=msg.text; }

        const now = new Date(), iso = getISOWeek(now), today = days[now.getDay()===0?6:now.getDay()-1];
        document.getElementById('mainTitle').innerText = `Vi som jobbar ${today} ${now.getDate()}/${now.getMonth()+1} (v.${iso.week})`;
        
        const cont = document.getElementById('mainContainer');
        if(!Array.isArray(globalShifts) || !globalShifts.length) globalShifts = DEFAULT_SHIFTS;
        if(!Array.isArray(globalStations) || !globalStations.length) globalStations = DEFAULT_STATIONS;

        let html = `<div class="time-header-row"><div></div>${globalShifts.map(s => `<div class="time-header">${s.label}</div>`).join('')}</div>`;
        globalStations.forEach(st => {
            if(st.isSpacer) { html += `<div class="display-row" style="grid-column:1/-1; height:4vh;"></div>`; return; }
            const contrast = isLight(st.color) ? '#000' : '#fff';
            const vars = `style="--station-color:${st.color}; --contrast-color:${contrast};"`;
            html += `<div class="display-row"><div class="station-label" ${vars}>${st.name}</div>`;
            globalShifts.forEach(sh => {
                const key = `y${iso.year}w${iso.week}-${today}-${st.name}-${sh.time}`;
                const val = globalScheduleData[key] || "";
                html += `<div class="shift-card ${val?'':'empty'}">${val}</div>`;
            });
            html += `</div>`;
        });
        cont.innerHTML = html;
    };
    refresh(); setInterval(refresh, 15000);
}

/* =========================================
   7. EXPORT & PRINT & ÖVRIGT
   ========================================= */
function getScheduleHtmlForPrint() {
    const dateText = document.getElementById('currentDateDisplay').innerText;
    const day = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${day}-`;
    const shifts = (Array.isArray(globalShifts)&&globalShifts.length)?globalShifts:DEFAULT_SHIFTS;
    const stations = (Array.isArray(globalStations)&&globalStations.length)?globalStations:DEFAULT_STATIONS;

    let html = `<div style="font-family:sans-serif; padding:20px;"><div style="text-align:center; margin-bottom:20px;"><h1 style="font-size:24px; margin:0;">Bemanningsschema - ${dateText}</h1></div>
    <div style="display:grid; grid-template-columns:150px repeat(${shifts.length},1fr); gap:10px; text-align:center; font-weight:bold; margin-bottom:10px;">
    <div></div>${shifts.map(s=>`<div style="border:1px solid #000; padding:5px; background:#ddd;">${s.label}<br><span style="font-size:0.8em; font-weight:normal;">${s.time}</span></div>`).join('')}</div>`;

    stations.forEach(st => {
        if(st.isSpacer) { html += `<div style="grid-column:1/-1; height:30px;"></div>`; return; }
        const bg = st.color, fg = isLight(bg)?'#000':'#fff';
        html += `<div style="display:grid; grid-template-columns:150px repeat(${shifts.length},1fr); gap:10px; margin-bottom:10px;">
            <div style="background:${bg}; color:${fg}; font-weight:bold; padding:10px; display:flex; align-items:center; justify-content:center; border:1px solid #000;">${st.name}</div>`;
        shifts.forEach(sh => {
            const val = globalScheduleData[`${prefix}${st.name}-${sh.time}`] || "";
            html += `<div style="display:flex; align-items:center; justify-content:center; text-align:center; min-height:50px; padding:5px; font-weight:bold; border:1px solid #000; background:#fff;">${val}</div>`;
        });
        html += `</div>`;
    });
    return html + `</div>`;
}

function generateImage() {
    const btn=document.getElementById('exportBtn'), txt=btn.innerText; 
    btn.innerText="Genererar...";
    const div=document.createElement('div'); 
    div.style.cssText="position:absolute; top:-9999px; left:0; width:1400px; background:#fff;";
    div.innerHTML=getScheduleHtmlForPrint(); 
    document.body.appendChild(div);

    if(typeof html2canvas==='undefined') {
        showToast("Ladda om sidan först!", "error");
        btn.innerText = txt;
        return;
    }

    html2canvas(div,{scale:2}).then(c=>{
        const a=document.createElement('a'); 
        a.download=`Schema-${days[currentAdminDayIndex]}.jpg`; 
        a.href=c.toDataURL('image/jpeg',0.9); 
        a.click();
        document.body.removeChild(div); 
        btn.innerText=txt;
    }).catch(e => {
        console.error(e);
        showToast("Fel vid bildgenerering", "error");
        btn.innerText=txt;
        document.body.removeChild(div);
    });
}

function getISOWeek(d) { const date=new Date(d.getTime()); date.setHours(0,0,0,0); date.setDate(date.getDate()+3-(date.getDay()+6)%7); const w1=new Date(date.getFullYear(),0,4); return {week:1+Math.round(((date.getTime()-w1.getTime())/86400000-3+(w1.getDay()+6)%7)/7), year:date.getFullYear()}; }

function setupSidebarAddUser() {
    const btn=document.getElementById('sidebarAddBtn'), inp=document.getElementById('sidebarNewName');
    if(btn&&inp) { 
        btn.onclick=async()=>{
            if(inp.value){
                globalUserList.push(inp.value);
                globalUserList.sort();
                await saveData('users',globalUserList);
                showToast("Personal tillagd", "success");
                inp.value='';
                renderRoster();
            }
        }; 
        inp.onkeydown=e=>{if(e.key==='Enter')btn.click();} 
    }
}

async function removeUser(u) { 
    if(confirm('Ta bort '+u+'?')){
        globalUserList=globalUserList.filter(user=>user!==u);
        await saveData('users',globalUserList);
        showToast("Personal borttagen", "info");
        renderRoster();
    } 
}

/* =========================================
   VÄDER-WIDGET (BODEN)
   ========================================= */
async function initWeatherBoden() {
    let wDiv = document.getElementById('weatherWidget');
    if (!wDiv) {
        wDiv = document.createElement('div');
        wDiv.id = 'weatherWidget';
        const clock = document.getElementById('clock');
        if (clock && clock.parentNode) clock.parentNode.insertBefore(wDiv, clock);
    }
    const fetchWeather = async () => {
        try {
            const url = 'https://api.open-meteo.com/v1/forecast?latitude=65.82&longitude=21.69&current_weather=true';
            const res = await fetch(url);
            const data = await res.json();
            const temp = Math.round(data.current_weather.temperature);
            wDiv.innerHTML = `BODEN: ${temp}°C`; 
        } catch (e) { console.error("Ingen väderdata", e); }
    };
    fetchWeather();
    setInterval(fetchWeather, 900000); 
}
if (document.body.id === 'page-display') setTimeout(initWeatherBoden, 1000);


// ===========================================
// GLOBAL FUNKTION FÖR FLIKAR (SETTINGS)
// ===========================================
window.openTab = function(tabId) {
    // 1. Dölj alla flikar
    const allPanes = document.querySelectorAll('.tab-pane');
    allPanes.forEach(pane => {
        pane.classList.remove('active');
        // Lägg till display:none inline för säkerhets skull om CSS fallerar
        pane.style.display = 'none';
    });

    // 2. Avmarkera alla knappar
    const allBtns = document.querySelectorAll('.tab-btn');
    allBtns.forEach(btn => {
        btn.classList.remove('active');
    });

    // 3. Visa vald flik
    const targetPane = document.getElementById(tabId);
    if (targetPane) {
        targetPane.classList.add('active');
        targetPane.style.display = 'block';
    } else {
        console.error("Hittade inte fliken med ID:", tabId);
    }

    // 4. Markera knappen som aktiv
    // Vi kollar vilken knapp som triggade eventet
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
};


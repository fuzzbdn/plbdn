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

let editingStationIndex = null;
let editingShiftIndex = null;
let editingAdminId = null;

/* =========================================
   2. API & SPARANDE
   ========================================= */
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

    const token = sessionStorage.getItem('jwtToken');
    if (!token) { alert("Logga in igen."); window.location.href="index.html"; return; }

    try {
        await fetch('/api/data-api', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` },
            body: JSON.stringify({ type, data })
        });
        return true;
    } catch (e) { showToast("Kunde inte spara."); return false; }
}

function applyTheme(themeName) {
    if (document.body.id === 'page-admin' || document.body.id === 'page-settings') return;
    document.body.classList.remove('theme-dark','theme-jul','theme-pask','theme-matrix');
    if (themeName && themeName !== 'light') document.body.classList.add(`theme-${themeName}`);
}

/* =========================================
   3. INIT
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const pageId = document.body.id;
    if (pageId === 'page-login') { initLogin(); return; }
    if (pageId === 'page-reset') { initReset(); return; }

    const [users, settings, dbStations, dbShifts] = await Promise.all([
        fetchData('users'), fetchData('settings'), fetchData('config_stations'), fetchData('config_shifts')
    ]);

    globalUserList = Array.isArray(users) ? users : [];
    globalStations = (Array.isArray(dbStations) && dbStations.length > 0) ? dbStations : DEFAULT_STATIONS;
    globalShifts = (Array.isArray(dbShifts) && dbShifts.length > 0) ? dbShifts : DEFAULT_SHIFTS;

    if (settings?.theme) applyTheme(settings.theme);

    if (pageId === 'page-admin') { if(checkAuth()) initAdmin(); }
    else if (pageId === 'page-settings') { if(checkAuth()) initSettings(settings); }
    else if (pageId === 'page-display') { initDisplay(); }
});

function checkAuth() {
    if (!sessionStorage.getItem('jwtToken')) { window.location.href="index.html"; return false; }
    return true;
}

/* =========================================
   4. LOGIN (Uppdaterad med Toast)
   ========================================= */
function initLogin() {
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
            } else showToast("Fel användarnamn eller lösenord!");
        } catch(e) { showToast("Serverfel - försök igen senare"); }
    };

    if(loginBtn) loginBtn.onclick = doLogin;
    
    const handleEnter = (e) => { if(e.key==='Enter') doLogin(); };
    if(userIn) userIn.onkeydown = handleEnter;
    if(passIn) passIn.onkeydown = handleEnter;

    const forgotLink = document.getElementById('forgotPassLink');
    if(forgotLink) forgotLink.onclick = (e) => { 
        e.preventDefault(); 
        document.getElementById('loginForm').style.display='none'; 
        document.getElementById('forgotForm').style.display='block'; 
    };
    
    const backLink = document.getElementById('backToLoginLink');
    if(backLink) backLink.onclick = (e) => { 
        e.preventDefault(); 
        document.getElementById('forgotForm').style.display='none'; 
        document.getElementById('loginForm').style.display='block'; 
    };
    
    const resetBtn = document.getElementById('sendResetBtn');
    if(resetBtn) resetBtn.onclick = async () => {
        const email = document.getElementById('resetEmailInput').value;
        if(!email) return showToast("Ange e-postadress");
        
        await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'request_reset', email}) });
        showToast("Återställningslänk skickad!");
        
        setTimeout(() => { window.location.reload(); }, 2000);
    };
}

function initReset() {
    const t = new URLSearchParams(window.location.search).get('token');
    if(!t) return;
    document.getElementById('resetSubmitBtn').onclick = async () => {
        const p1 = document.getElementById('newPassInput').value;
        const p2 = document.getElementById('confirmPassInput').value;
        if(p1!==p2) return showToast("Lösenorden matchar inte");
        const res = await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'perform_reset', token:t, newPassword:p1}) });
        if(res.ok) {
            showToast("Lösenord ändrat! Logga in.");
            setTimeout(() => { window.location.href="index.html"; }, 1500);
        } else {
            showToast("Kunde inte återställa.");
        }
    };
}

/* =========================================
   5. INSTÄLLNINGAR (TOAST & FIXAR)
   ========================================= */
async function initSettings(currentSettings) {
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');

    // TEMA
    const themeSelect = document.getElementById('themeSelect');
    if(currentSettings?.theme) themeSelect.value = currentSettings.theme;
    
    document.getElementById('saveThemeBtn').onclick = async () => {
        await saveData('settings', { theme: themeSelect.value });
        showToast("Tema sparat!"); // Feedback
    };

    // MEDDELANDE
    const msgIn = document.getElementById('displayMessageInput');
    const msgCheck = document.getElementById('showMessageCheckbox');
    const msg = await fetchData('message');
    if(msg) { msgIn.value = msg.text||""; msgCheck.checked = msg.show||false; }
    
    document.getElementById('saveMessageBtn').onclick = async () => {
        await saveData('message', { text: msgIn.value, show: msgCheck.checked });
        showToast("Meddelande uppdaterat!"); // Feedback
    };

    // --- PLATSER (STATIONER) ---
    const stName = document.getElementById('newStationName');
    const stColor = document.getElementById('newStationColor');
    const stBtn = document.getElementById('addStationBtn');
    const stCancel = document.getElementById('cancelStationEditBtn');
    let draggedItemIndex = null;

    const renderStations = () => {
        const cont = document.getElementById('stationListContainer');
        if(!Array.isArray(globalStations)) globalStations = DEFAULT_STATIONS;
        
        cont.innerHTML = globalStations.map((st, i) => {
            const dragHandle = `<span style="cursor:grab; font-size:1.2rem; margin-right:10px; color:#888;">☰</span>`;
            const content = st.isSpacer 
                ? `<i>--- Mellanrum ---</i>` 
                : `<div style="display:flex; align-items:center; gap:10px;"><div style="width:20px; height:20px; background:${st.color}; border-radius:50%; border:1px solid #ccc;"></div><strong>${st.name}</strong></div>`;
            const editBtn = st.isSpacer ? '' : `<button class="list-btn" onclick="startEditStation(${i})">✏️</button>`;

            return `
                <div class="station-list-item" 
                     draggable="true" 
                     data-index="${i}"
                     ondragstart="handleStationDragStart(event, ${i})"
                     ondragover="handleStationDragOver(event)"
                     ondrop="handleStationDrop(event, ${i})"
                     style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee; align-items:center; background:${st.isSpacer ? '#fff' : '#f9f9f9'}; ${st.isSpacer ? 'color:#888;' : ''}">
                    <div style="display:flex; align-items:center;">
                        ${dragHandle}
                        <span style="margin-left:5px;">${content}</span>
                    </div>
                    <div>
                        ${editBtn}
                        <button class="list-btn" onclick="deleteStation(${i})">🗑️</button>
                    </div>
                </div>`;
        }).join('');
    };

    // DRAG-N-DROP LOGIK
    window.handleStationDragStart = (e, index) => { draggedItemIndex = index; e.dataTransfer.effectAllowed = 'move'; e.target.style.opacity = '0.5'; };
    window.handleStationDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    window.handleStationDrop = async (e, targetIndex) => {
        e.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === targetIndex) return;
        const itemToMove = globalStations[draggedItemIndex];
        globalStations.splice(draggedItemIndex, 1);
        globalStations.splice(targetIndex, 0, itemToMove);
        draggedItemIndex = null;
        await saveData('config_stations', globalStations);
        renderStations();
    };

    window.startEditStation = (i) => {
        editingStationIndex = i;
        stName.value = globalStations[i].name;
        stColor.value = globalStations[i].color;
        stBtn.innerText = "💾"; // Ikon för spara
        stBtn.style.background = "#2196F3";
        stCancel.style.display = "block"; // Visa kryss
    };

    const resetSt = () => {
        editingStationIndex = null; stName.value = ""; stBtn.innerText = "+"; stBtn.style.background = "";
        stCancel.style.display = "none";
    };
    stCancel.onclick = resetSt;

    stBtn.onclick = async () => {
        if(!stName.value) return showToast("Ange ett namn!");
        const item = { name: stName.value, color: stColor.value };
        if(editingStationIndex !== null) {
            globalStations[editingStationIndex] = item;
            showToast("Plats uppdaterad!");
        } else {
            globalStations.push(item);
            showToast("Plats tillagd!");
        }
        await saveData('config_stations', globalStations);
        resetSt();
        renderStations();
    };

    document.getElementById('addSpacerBtn').onclick = async () => {
        globalStations.push({ isSpacer: true });
        await saveData('config_stations', globalStations);
        renderStations();
        showToast("Mellanrum tillagt");
    };

    window.deleteStation = async (i) => {
        if(!confirm("Ta bort?")) return;
        globalStations.splice(i, 1);
        await saveData('config_stations', globalStations);
        renderStations();
        showToast("Borttaget");
    };
    renderStations();

    // --- PASS (SHIFTS) ---
    const shLabel = document.getElementById('newShiftLabel');
    const shTime = document.getElementById('newShiftTime');
    const shBtn = document.getElementById('addShiftBtn');
    const shCancel = document.getElementById('cancelShiftEditBtn');

    const renderShifts = () => {
        if(!Array.isArray(globalShifts)) globalShifts = DEFAULT_SHIFTS;
        document.getElementById('shiftListContainer').innerHTML = globalShifts.map((sh, i) => `
            <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #eee;">
                <div><strong>${sh.label}</strong> <span style="color:#666;">(${sh.time})</span></div>
                <div>
                    <button class="list-btn" onclick="startEditShift(${i})">✏️</button>
                    <button class="list-btn" onclick="deleteShift(${i})">🗑️</button>
                </div>
            </div>`).join('');
    };

    window.startEditShift = (i) => {
        editingShiftIndex = i;
        shLabel.value = globalShifts[i].label;
        shTime.value = globalShifts[i].time;
        shBtn.innerText = "Spara";
        shBtn.style.background = "#2196F3";
        shCancel.style.display = "block";
    };

    const resetSh = () => {
        editingShiftIndex = null; shLabel.value = ""; shTime.value = ""; shBtn.innerText = "Lägg till Pass"; shBtn.style.background = "";
        shCancel.style.display = "none";
    };
    shCancel.onclick = resetSh;

    shBtn.onclick = async () => {
        if(!shLabel.value || !shTime.value) return showToast("Fyll i allt!");
        const item = { label: shLabel.value, time: shTime.value };
        if(editingShiftIndex !== null) globalShifts[editingShiftIndex] = item;
        else globalShifts.push(item);
        await saveData('config_shifts', globalShifts);
        resetSh();
        renderShifts();
        showToast("Pass sparat!");
    };

    window.deleteShift = async (i) => {
        if(!confirm("Ta bort?")) return;
        globalShifts.splice(i, 1);
        await saveData('config_shifts', globalShifts);
        renderShifts();
    };
    renderShifts();

    // --- ADMINS ---
    const admBtn = document.getElementById('addAdminBtn');
    const admCancel = document.getElementById('cancelAdminEditBtn');
    const admUser = document.getElementById('newAdminUser');
    const admPass = document.getElementById('newAdminPass');
    const admFirst = document.getElementById('newAdminFirstName');
    const admLast = document.getElementById('newAdminLastName');
    const admEmail = document.getElementById('newAdminEmail');

    const renderAdmins = async () => {
        let admins = await fetchData('admins');
        if (!Array.isArray(admins)) admins = [];
        document.getElementById('adminListContainer').innerHTML = admins.map(a => {
            const json = JSON.stringify(a).replace(/"/g, '&quot;');
            return `
            <div style="padding:8px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <span>${a.first_name||''} ${a.last_name||''} (${a.username})</span>
                <div>
                    <button class="list-btn" onclick="startEditAdmin(${json})">✏️</button>
                    <button class="list-btn" onclick="deleteAdmin('${a.username}')">🗑️</button>
                </div>
            </div>`;
        }).join('');
    };

    window.startEditAdmin = (u) => {
        editingAdminId = u.id;
        admUser.value = u.username;
        admFirst.value = u.first_name || "";
        admLast.value = u.last_name || "";
        admEmail.value = u.email || "";
        admPass.placeholder = "Nytt lösen (valfritt)";
        admPass.value = "";
        admBtn.innerText = "💾";
        admBtn.style.background = "#2196F3";
        admCancel.style.display = "block";
    };

    const resetAdm = () => {
        editingAdminId = null; admUser.value = ""; admPass.value = ""; admFirst.value = ""; admLast.value = ""; admEmail.value = "";
        admPass.placeholder = "Lösenord"; admBtn.innerText = "+"; admBtn.style.background = ""; admCancel.style.display = "none";
    };
    admCancel.onclick = resetAdm;

    admBtn.onclick = async () => {
        const u = admUser.value, p = admPass.value;
        if(!u) return showToast("Användarnamn krävs");
        const action = editingAdminId ? 'edit_admin' : 'add_admin';
        if(action === 'add_admin' && !p) return showToast("Lösenord krävs");

        await fetch('/api/data-api', { 
            method:'POST', 
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, 
            body: JSON.stringify({action, username:u, password:p, firstName:admFirst.value, lastName:admLast.value, email:admEmail.value, id:editingAdminId}) 
        });
        resetAdm();
        renderAdmins();
        showToast("Admin sparad!");
    };

    window.deleteAdmin = async(u) => { 
        if(confirm("Ta bort?")) await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, body: JSON.stringify({action:'remove_admin', username:u}) });
        renderAdmins(); 
    };
    renderAdmins();

    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };
}

/* =========================================
   6. ADMIN PLANERING
   ========================================= */
async function initAdmin() {
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');

    let draft = await fetchData('schedule_draft');
    const published = await fetchData('schedule_published');
    const old = await fetchData('schedule');
    if(!draft || Object.keys(draft).length===0) draft = (published && Object.keys(published).length>0) ? published : old;
    globalScheduleData = draft || {};

    document.getElementById('publishBtn').onclick = async () => {
        if(confirm("Publicera?")) { 
            await saveData('schedule_published', globalScheduleData); 
            showToast("Publicerat!"); 
        }
    };

    const picker = document.getElementById('adminDatePicker');
    picker.value = new Date().toISOString().split('T')[0];
    picker.onchange = (e) => updateGrid(e.target.value);
    
    function updateGrid(dateStr) {
        const d = new Date(dateStr + "T12:00:00"); 
        const iso = getISOWeek(d);
        selectedWeek = iso.week; selectedYear = iso.year;
        currentAdminDayIndex = d.getDay()===0?6:d.getDay()-1;
        document.getElementById('currentDateDisplay').innerText = `${days[currentAdminDayIndex]} v.${selectedWeek}, ${selectedYear}`;
        renderAdminGrid();
    }
    updateGrid(picker.value);

    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };
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
        if(st.isSpacer) { html += `<div class="station-row" style="grid-column:1/-1; height:30px; background:#fff;"></div>`; return; }
        
        html += `<div class="station-row"><div class="station-label" style="background-color:${st.color}; color:${isLight(st.color)?'#000':'#fff'}">${st.name}</div>`;
        globalShifts.forEach(sh => {
            const key = `${prefix}${st.name}-${sh.time}`;
            const rawVal = globalScheduleData[key] || "";
            const val = escapeHtml(rawVal);

            html += `<div class="shift-block ${val?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event,'${key}')">
                <span class="shift-text" contenteditable="true" onblur="saveShift('${key}', this.innerText)">${val}</span>
                ${val ? `<button class="clear-btn" onclick="saveShift('${key}', '')">&times;</button>`:''}</div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

function isLight(color) {
    if(!color) return true;
    const h = color.replace('#','');
    const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
    return ((r*299 + g*587 + b*114)/1000) >= 128;
}

function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if(!list) return;
    const day = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${day}-`;
    const work = new Set();
    Object.keys(globalScheduleData).forEach(k => { if(k.startsWith(prefix) && globalScheduleData[k]) globalScheduleData[k].split('/').forEach(n=>work.add(n.trim())); });
    list.innerHTML = globalUserList.filter(u=>!work.has(u)).map(u => 
        `<div class="draggable-item" draggable="true" ondragstart="event.dataTransfer.setData('text','${u}')">${u} <button class="remove-user-btn" onclick="removeUser('${u}')">&times;</button></div>`).join('');
}

async function saveShift(k, v) { globalScheduleData[k] = v.trim(); await saveData('schedule_draft', globalScheduleData); renderAdminGrid(); }

async function handleDrop(e, k) { 
    e.preventDefault(); 
    const n = e.dataTransfer.getData("text"); 
    let c = globalScheduleData[k]||""; 
    const currentUsers = c ? c.split(' / ').map(u => u.trim()) : [];
    if(!currentUsers.includes(n)) { await saveShift(k, c ? c + " / " + n : n); }
}

/* =========================================
   7. DISPLAY & ÖVRIGT
   ========================================= */
function generateImage() {
    const btn=document.getElementById('exportBtn'), txt=btn.innerText; btn.innerText="Genererar...";
    const div=document.createElement('div'); div.style.cssText="position:absolute; top:-9999px; left:0; width:1200px; background:#fff;";
    div.innerHTML=getScheduleHtmlForPrint(); document.body.appendChild(div);
    if(typeof html2canvas==='undefined') return alert("Ladda om sidan");
    html2canvas(div,{scale:2}).then(c=>{
        const a=document.createElement('a'); a.download=`Schema-${days[currentAdminDayIndex]}.jpg`; a.href=c.toDataURL('image/jpeg',0.9); a.click();
        document.body.removeChild(div); btn.innerText=txt;
    });
}
function getISOWeek(d) { const date=new Date(d.getTime()); date.setHours(0,0,0,0); date.setDate(date.getDate()+3-(date.getDay()+6)%7); const w1=new Date(date.getFullYear(),0,4); return {week:1+Math.round(((date.getTime()-w1.getTime())/86400000-3+(w1.getDay()+6)%7)/7), year:date.getFullYear()}; }
function setupSidebarAddUser() {
    const btn=document.getElementById('sidebarAddBtn'), inp=document.getElementById('sidebarNewName');
    if(btn&&inp) { btn.onclick=async()=>{if(inp.value){globalUserList.push(inp.value);globalUserList.sort();await saveData('users',globalUserList);inp.value='';renderRoster();}}; inp.onkeydown=e=>{if(e.key==='Enter')btn.click();} }
}
async function removeUser(u) { if(confirm('Ta bort '+u+'?')){globalUserList=globalUserList.filter(user=>user!==u);await saveData('users',globalUserList);renderRoster();} }
function escapeHtml(text) { return text ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : ""; }
function getScheduleHtmlForPrint() { return document.getElementById('scheduleContainer').innerHTML; } 

/* =========================================
   8. TOAST NOTIFICATION FUNKTION
   ========================================= */
function showToast(message) {
    let x = document.getElementById("toast");
    if(!x) {
        x = document.createElement("div");
        x.id = "toast";
        x.className = "toast";
        document.body.appendChild(x);
    }
    x.innerText = message;
    x.className = "toast show";
    setTimeout(function(){ x.className = x.className.replace("show", ""); }, 3000);
}

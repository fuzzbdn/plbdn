/* =========================================
   1. KONFIGURATION & GLOBALA VARIABLER
   ========================================= */

// Standardvärden (används om inget finns i databasen än)
const DEFAULT_STATIONS = [
    { name: "Björkliden", color: "#ffb74d" },
    { name: "Kiruna",     color: "#fff176" },
    { name: "Bastuträsk", color: "#e57373" },
    { name: "Boden",      color: "#81c784" },
    { name: "Gällivare",  color: "#64b5f6" },
    { name: "Älvsbyn",    color: "#e0e0e0" },
    { name: "Info",       color: "#f06292" },
    { name: "PL",         color: "#0277bd" }
];

const DEFAULT_SHIFTS = [
    { label: "Förmiddag",  time: "06:30 - 14:00" },
    { label: "Eftermiddag", time: "14:00 - 21:15" },
    { label: "Natt",        time: "21:15 - 06:30" }
];

const days = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];

// Dessa fylls nu på från databasen
let globalStations = [];
let globalShifts = [];

let selectedWeek = 0, selectedYear = 0, currentAdminDayIndex = 0;
let globalScheduleData = {}, globalUserList = [];
let editingAdminId = null; 

/* =========================================
   2. KOMMUNIKATION MED SERVER (API)
   ========================================= */
async function fetchData(type) {
    try {
        const headers = {};
        if (type === 'admins') {
            const token = sessionStorage.getItem('jwtToken');
            if (token) headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(`/api/data-api?type=${type}`, { headers });
        if (!res.ok) throw new Error('Fetch failed');
        return await res.json();
    } catch (e) {
        // Returnera null vid fel så vi kan hantera fallbacks
        return null; 
    }
}

async function saveData(type, data) {
    // Uppdatera minnet direkt
    if(type === 'schedule' || type === 'schedule_draft' || type === 'schedule_published') globalScheduleData = data;
    if(type === 'config_stations') globalStations = data;
    if(type === 'config_shifts') globalShifts = data;
    
    const token = sessionStorage.getItem('jwtToken');
    if (!token) {
        alert("Sessionen har gått ut. Logga in igen.");
        window.location.href = "index.html";
        return;
    }

    try {
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ type, data })
        });
        if (!res.ok) throw new Error("Unauthorized");
        return true;
    } catch (e) {
        alert("Kunde inte spara.");
        return false;
    }
}

function applyTheme(themeName) {
    if (document.body.id === 'page-admin' || document.body.id === 'page-settings') return;
    const themes = ['theme-dark', 'theme-jul', 'theme-pask', 'theme-matrix'];
    document.body.classList.remove(...themes);
    if (themeName && themeName !== 'light') {
        document.body.classList.add(`theme-${themeName}`);
    }
}

/* =========================================
   3. INITIERING (ROUTING)
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const pageId = document.body.id;

    if (pageId === 'page-login') { initLogin(); return; }
    if (pageId === 'page-reset') { initReset(); return; }

    // HÄMTA KONFIGURATIONER
    const [users, settings, dbStations, dbShifts] = await Promise.all([
        fetchData('users'), 
        fetchData('settings'),
        fetchData('config_stations'),
        fetchData('config_shifts')
    ]);

    // VIKTIG FIX: Kontrollera att det vi fått faktiskt är en lista (Array).
    // Om databasen returnerar {} (tomt objekt) måste vi använda defaults.
    globalUserList = Array.isArray(users) ? users : [];
    
    globalStations = (Array.isArray(dbStations) && dbStations.length > 0) 
        ? dbStations 
        : DEFAULT_STATIONS;

    globalShifts = (Array.isArray(dbShifts) && dbShifts.length > 0) 
        ? dbShifts 
        : DEFAULT_SHIFTS;

    if (settings && settings.theme) applyTheme(settings.theme);

    if (pageId === 'page-admin') {
        if (!checkAuth()) return;
        initAdmin();
    } else if (pageId === 'page-settings') {
        if (!checkAuth()) return;
        initSettings(settings);
    } else if (pageId === 'page-display') {
        initDisplay();
    }
});

function checkAuth() {
    if (!sessionStorage.getItem('jwtToken')) {
        window.location.href = "index.html";
        return false;
    }
    return true;
}

/* =========================================
   4. LOGIN & RESET
   ========================================= */
function initLogin() {
    const loginBtn = document.getElementById('loginBtn');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');
    const toForgot = document.getElementById('forgotPassLink');
    const toLogin = document.getElementById('backToLoginLink');
    const resetBtn = document.getElementById('sendResetBtn');
    const resetEmail = document.getElementById('resetEmailInput');

    const doLogin = async () => {
        try {
            const res = await fetch('/api/data-api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', username: userIn.value.trim(), password: passIn.value.trim() })
            });
            const data = await res.json();
            if (data.success) {
                sessionStorage.setItem('jwtToken', data.token); 
                sessionStorage.setItem('adminUser', data.user);
                sessionStorage.setItem('adminName', data.name);
                window.location.href = "admin.html";
            } else alert("Fel uppgifter!");
        } catch (e) { alert("Serverfel"); }
    };

    if(loginBtn) loginBtn.onclick = doLogin;
    if(passIn) passIn.onkeydown = (e) => { if(e.key === 'Enter') doLogin(); };

    if(toForgot) toForgot.onclick = (e) => { e.preventDefault(); document.getElementById('loginForm').style.display='none'; document.getElementById('forgotForm').style.display='block'; };
    if(toLogin) toLogin.onclick = (e) => { e.preventDefault(); document.getElementById('forgotForm').style.display='none'; document.getElementById('loginForm').style.display='block'; };

    if(resetBtn) resetBtn.onclick = async () => {
        if(!resetEmail.value) return alert("Ange e-post");
        resetBtn.innerText = "SKICKAR...";
        await fetch('/api/data-api', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'request_reset', email: resetEmail.value}) });
        alert("Om e-posten finns har en länk skickats (kolla loggen för test).");
        resetBtn.innerText = "ÅTERSTÄLL";
    };
}

function initReset() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if(!token) return document.getElementById('resetMessage').innerText = "Ingen token.";
    
    document.getElementById('resetSubmitBtn').onclick = async () => {
        const p1 = document.getElementById('newPassInput').value;
        const p2 = document.getElementById('confirmPassInput').value;
        if(p1!==p2) return alert("Matchar ej");
        const res = await fetch('/api/data-api', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'perform_reset', token, newPassword: p1}) });
        if(res.ok) window.location.href = "index.html";
        else alert("Fel.");
    };
}

/* =========================================
   5. INSTÄLLNINGSSIDA (FIXAD)
   ========================================= */
async function initSettings(currentSettings) {
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName') || 'Admin');

    // --- TEMA & MEDDELANDE ---
    const themeSelect = document.getElementById('themeSelect');
    if(themeSelect && currentSettings?.theme) themeSelect.value = currentSettings.theme;
    document.getElementById('saveThemeBtn').onclick = () => saveData('settings', { theme: themeSelect.value });

    const msgIn = document.getElementById('displayMessageInput');
    const msgCheck = document.getElementById('showMessageCheckbox');
    const msg = await fetchData('message');
    if(msg) { msgIn.value = msg.text||""; msgCheck.checked = msg.show||false; }
    document.getElementById('saveMessageBtn').onclick = () => saveData('message', { text: msgIn.value, show: msgCheck.checked });

    // --- HANTERA PLATSER (STATIONER) ---
    const stNameIn = document.getElementById('newStationName');
    const stColorIn = document.getElementById('newStationColor');
    const stList = document.getElementById('stationListContainer');

    const renderStations = () => {
        // Kontrollera att globalStations verkligen är en array innan map
        if (!Array.isArray(globalStations)) globalStations = DEFAULT_STATIONS;
        
        stList.innerHTML = globalStations.map((st, idx) => `
            <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #eee; align-items:center;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:20px; height:20px; background:${st.color}; border-radius:50%; border:1px solid #ccc;"></div>
                    <strong>${st.name}</strong>
                </div>
                <button onclick="deleteStation(${idx})" style="border:none; background:none; cursor:pointer;">🗑️</button>
            </div>
        `).join('');
    };
    
    document.getElementById('addStationBtn').onclick = async () => {
        if(!stNameIn.value) return alert("Ange namn");
        globalStations.push({ name: stNameIn.value, color: stColorIn.value });
        await saveData('config_stations', globalStations);
        stNameIn.value = "";
        renderStations();
    };
    window.deleteStation = async (idx) => {
        if(!confirm("Ta bort plats?")) return;
        globalStations.splice(idx, 1);
        await saveData('config_stations', globalStations);
        renderStations();
    };
    renderStations();

    // --- HANTERA PASS (SHIFTS) ---
    const shLabelIn = document.getElementById('newShiftLabel');
    const shTimeIn = document.getElementById('newShiftTime');
    const shList = document.getElementById('shiftListContainer');

    const renderShifts = () => {
        if (!Array.isArray(globalShifts)) globalShifts = DEFAULT_SHIFTS;

        shList.innerHTML = globalShifts.map((sh, idx) => `
            <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #eee;">
                <div><strong>${sh.label}</strong> <span style="color:#666; font-size:0.85em;">(${sh.time})</span></div>
                <button onclick="deleteShift(${idx})" style="border:none; background:none; cursor:pointer;">🗑️</button>
            </div>
        `).join('');
    };

    document.getElementById('addShiftBtn').onclick = async () => {
        if(!shLabelIn.value || !shTimeIn.value) return alert("Fyll i både etikett och tid");
        globalShifts.push({ label: shLabelIn.value, time: shTimeIn.value });
        await saveData('config_shifts', globalShifts);
        shLabelIn.value = ""; shTimeIn.value = "";
        renderShifts();
    };
    window.deleteShift = async (idx) => {
        if(!confirm("Ta bort pass?")) return;
        globalShifts.splice(idx, 1);
        await saveData('config_shifts', globalShifts);
        renderShifts();
    };
    renderShifts();

    // --- ADMINS ---
    const adminList = document.getElementById('adminListContainer');
    const renderAdmins = async () => {
        let admins = await fetchData('admins');
        if (!Array.isArray(admins)) admins = [];
        adminList.innerHTML = admins.map(a => `
            <div style="padding:5px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
                <span>${a.first_name||''} ${a.last_name||''} (${a.username})</span>
                <button onclick="delAdm('${a.username}')">🗑️</button>
            </div>`).join('');
    };
    document.getElementById('addAdminBtn').onclick = async () => {
        const u = document.getElementById('newAdminUser').value;
        const p = document.getElementById('newAdminPass').value;
        const f = document.getElementById('newAdminFirstName').value;
        const l = document.getElementById('newAdminLastName').value;
        const e = document.getElementById('newAdminEmail').value;
        if(!u || !p) return alert("Användarnamn/Lösenord krävs");
        await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, body: JSON.stringify({action:'add_admin', username:u, password:p, firstName:f, lastName:l, email:e}) });
        renderAdmins();
    };
    window.delAdm = async(u) => { 
        if(confirm("Ta bort?")) await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, body: JSON.stringify({action:'remove_admin', username:u}) });
        renderAdmins(); 
    };
    renderAdmins();
    
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };
}

/* =========================================
   6. ADMIN (PLANERING)
   ========================================= */
async function initAdmin() {
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');

    let draft = await fetchData('schedule_draft');
    const published = await fetchData('schedule_published');
    const oldLegacy = await fetchData('schedule');
    
    // Säkerställ att vi inte kraschar om vi får {}
    if(!draft || Object.keys(draft).length === 0) draft = (published && Object.keys(published).length > 0) ? published : oldLegacy;
    globalScheduleData = draft || {}; 

    document.getElementById('publishBtn').onclick = async () => {
        if(confirm("Publicera?")) {
            await saveData('schedule_published', globalScheduleData);
            alert("Publicerat!");
        }
    };

    const picker = document.getElementById('adminDatePicker');
    picker.value = new Date().toISOString().split('T')[0];
    picker.onchange = (e) => updateGrid(e.target.value);
    
    function updateGrid(dateStr) {
        const d = new Date(dateStr);
        const iso = getISOWeek(d);
        selectedWeek = iso.week; selectedYear = iso.year;
        currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
        document.getElementById('currentDateDisplay').innerText = `${days[currentAdminDayIndex]} v.${selectedWeek}, ${selectedYear}`;
        renderAdminGrid();
    }
    updateGrid(picker.value);

    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href = "index.html"; };
    document.getElementById('exportBtn').onclick = generateImage;
    
    document.getElementById('printBtn').onclick = () => {
        const printContainer = document.getElementById('print-container') || document.createElement('div');
        printContainer.id = 'print-container';
        if(!document.body.contains(printContainer)) document.body.appendChild(printContainer);
        printContainer.innerHTML = getScheduleHtmlForPrint();
        window.print();
        setTimeout(() => printContainer.innerHTML = '', 1000);
    };
    
    setupSidebarAddUser();
}

function renderAdminGrid() {
    const container = document.getElementById('scheduleContainer');
    renderRoster();
    if(!container) return;

    const dayName = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;

    // Säkerställ att globalShifts och globalStations är laddade
    if (!Array.isArray(globalShifts) || globalShifts.length === 0) globalShifts = DEFAULT_SHIFTS;
    if (!Array.isArray(globalStations) || globalStations.length === 0) globalStations = DEFAULT_STATIONS;

    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${s.label}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        html += `<div class="station-row">
            <div class="station-label" style="background-color:${st.color}; color:${isLight(st.color)?'#000':'#fff'}">${st.name}</div>`;
        
        globalShifts.forEach((shift) => {
            const key = `${prefix}${st.name}-${shift.time}`;
            const val = globalScheduleData[key] || "";
            
            html += `<div class="shift-block ${val?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event, '${key}')">
                     <span class="shift-text" contenteditable="true" onblur="saveShift('${key}', this.innerText)">${val}</span>
                     ${val ? `<button class="clear-btn" onclick="saveShift('${key}', '')">&times;</button>` : ''}
                     </div>`;
        });
        html += `</div>`;
    });
    container.innerHTML = html;
}

function isLight(color) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128;
}

function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if(!list) return;
    const dayName = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;
    const working = new Set();
    Object.keys(globalScheduleData).forEach(k => {
        if(k.startsWith(prefix) && globalScheduleData[k]) globalScheduleData[k].split('/').forEach(n=>working.add(n.trim()));
    });
    list.innerHTML = globalUserList.filter(u => !working.has(u)).map(u => 
        `<div class="draggable-item" draggable="true" ondragstart="event.dataTransfer.setData('text', '${u}')">
            ${u} <button class="remove-user-btn" onclick="removeUser('${u}')">&times;</button>
        </div>`
    ).join('');
}

async function saveShift(key, val) {
    globalScheduleData[key] = val.trim();
    await saveData('schedule_draft', globalScheduleData);
    renderAdminGrid();
}

async function handleDrop(e, key) {
    e.preventDefault();
    const name = e.dataTransfer.getData("text");
    let c = globalScheduleData[key] || "";
    if(c.includes(name)) return;
    await saveShift(key, c ? c+" / "+name : name);
}

/* =========================================
   7. DISPLAY-SIDAN
   ========================================= */
let lastSnap = "";
function initDisplay() {
    setInterval(() => document.getElementById('clock').innerText=new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'}), 1000);

    const refresh = async () => {
        let pub = await fetchData('schedule_published');
        const oldLegacy = await fetchData('schedule'); 
        if(!pub || Object.keys(pub).length===0) pub = oldLegacy;

        const [sets, msg] = await Promise.all([fetchData('settings'), fetchData('message')]);
        
        const snap = JSON.stringify({s:pub, t:sets?.theme, m:msg});
        if(snap === lastSnap) return;
        lastSnap = snap;
        globalScheduleData = pub || {};

        if(sets?.theme) applyTheme(sets.theme);
        const mq = document.getElementById('marqueeContainer');
        if(mq) { mq.style.display = (msg?.show && msg?.text) ? 'block' : 'none'; if(msg?.text) document.getElementById('marqueeText').innerText = msg.text; }

        const now = new Date();
        const iso = getISOWeek(now);
        const today = days[now.getDay()===0?6:now.getDay()-1];
        document.getElementById('mainTitle').innerText = `Vi som jobbar ${today} ${now.getDate()}/${now.getMonth()+1} (v.${iso.week})`;

        const cont = document.getElementById('mainContainer');
        
        // Säkra listor även för display
        if (!Array.isArray(globalShifts) || globalShifts.length === 0) globalShifts = DEFAULT_SHIFTS;
        if (!Array.isArray(globalStations) || globalStations.length === 0) globalStations = DEFAULT_STATIONS;

        let html = `<div class="time-header-row"><div></div>${globalShifts.map(s => `<div class="time-header">${s.label}</div>`).join('')}</div>`;

        globalStations.forEach(st => {
            html += `<div class="display-row">
                <div class="station-label" style="background-color:${st.color}; color:${isLight(st.color)?'#000':'#fff'}">${st.name}</div>`;
            globalShifts.forEach(shift => {
                const key = `y${iso.year}w${iso.week}-${today}-${st.name}-${shift.time}`;
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
   8. EXPORT & PRINT
   ========================================= */
function getScheduleHtmlForPrint() {
    const dayName = days[currentAdminDayIndex];
    const dateText = document.getElementById('currentDateDisplay').innerText;
    
    // Säkra listor
    const shiftsToUse = (Array.isArray(globalShifts) && globalShifts.length > 0) ? globalShifts : DEFAULT_SHIFTS;
    const stationsToUse = (Array.isArray(globalStations) && globalStations.length > 0) ? globalStations : DEFAULT_STATIONS;

    let html = `
        <div style="font-family: sans-serif; padding: 20px;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="font-size: 24px; margin: 0;">Bemanningsschema - ${dateText}</h1>
            </div>
            <div style="display: grid; grid-template-columns: 150px repeat(${shiftsToUse.length}, 1fr); gap: 10px; text-align: center; font-weight: bold; margin-bottom: 10px;">
                <div></div>
                ${shiftsToUse.map(s => `<div style="border:1px solid #000; padding:5px; background:#ddd;">${s.label}<br><span style="font-size:0.8em; font-weight:normal;">${s.time}</span></div>`).join('')}
            </div>
    `;

    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;

    stationsToUse.forEach(st => {
        const bg = st.color;
        const fg = isLight(bg) ? '#000' : '#fff';
        
        html += `<div style="display: grid; grid-template-columns: 150px repeat(${shiftsToUse.length}, 1fr); gap: 10px; margin-bottom: 10px;">
            <div style="background-color:${bg}; color:${fg}; font-weight:bold; padding:10px; display:flex; align-items:center; justify-content:center; border:1px solid #000;">${st.name}</div>`;
            
        shiftsToUse.forEach(shift => {
            const key = `${prefix}${st.name}-${shift.time}`;
            const val = globalScheduleData[key] || "";
            html += `<div style="display:flex; align-items:center; justify-content:center; text-align:center; min-height:50px; padding:5px; font-weight:bold; border:1px solid #000; background:#fff;">${val}</div>`;
        });
        html += `</div>`;
    });
    
    return html + `</div>`;
}

function generateImage() {
    const btn = document.getElementById('exportBtn');
    const txt = btn.innerText;
    btn.innerText = "Genererar...";
    
    const div = document.createElement('div');
    div.style.position = 'absolute'; div.style.top = '-9999px'; div.style.left = '0'; div.style.width = '1200px'; div.style.background = '#fff';
    div.innerHTML = getScheduleHtmlForPrint();
    document.body.appendChild(div);

    if (typeof html2canvas === 'undefined') return alert("Ladda om sidan");

    html2canvas(div, { scale: 2 }).then(c => {
        const a = document.createElement('a');
        a.download = `Schema-${days[currentAdminDayIndex]}.jpg`;
        a.href = c.toDataURL('image/jpeg', 0.9);
        a.click();
        document.body.removeChild(div);
        btn.innerText = txt;
    });
}

function getISOWeek(d) {
    const date = new Date(d.getTime()); date.setHours(0,0,0,0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const w1 = new Date(date.getFullYear(), 0, 4);
    return { week: 1 + Math.round(((date.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7), year: date.getFullYear() };
}
function setupSidebarAddUser() {
    const btn=document.getElementById('sidebarAddBtn'), inp=document.getElementById('sidebarNewName');
    if(btn&&inp) {
        const add=async()=>{if(inp.value){globalUserList.push(inp.value);globalUserList.sort();await saveData('users',globalUserList);inp.value='';renderRoster();}};
        btn.onclick=add; inp.onkeydown=e=>{if(e.key==='Enter')add();};
    }
}
async function removeUser(u) { if(confirm('Ta bort '+u+'?')){globalUserList=globalUserList.filter(user=>user!==u);await saveData('users',globalUserList);renderRoster();} }

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
   2. HJÄLPFUNKTIONER (Toast, Modal, API)
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

function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const msgEl = document.getElementById('confirmMessage');
        const btnYes = document.getElementById('btnConfirmYes');
        const btnNo = document.getElementById('btnConfirmNo');

        // Om modalen saknas i HTML (t.ex. på settings-sidan om den glömts), använd vanlig confirm
        if(!modal) { resolve(confirm(message)); return; }

        msgEl.innerText = message;
        modal.classList.add('show');

        const handleYes = () => { cleanup(); resolve(true); };
        const handleNo = () => { cleanup(); resolve(false); };

        function cleanup() {
            modal.classList.remove('show');
            btnYes.removeEventListener('click', handleYes);
            btnNo.removeEventListener('click', handleNo);
        }

        btnYes.addEventListener('click', handleYes);
        btnNo.addEventListener('click', handleNo);
    });
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
        showToast("Sessionen utlöpt.", "error"); 
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

    try {
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
        else if (pageId === 'page-display') { 
            initDisplay(); 
            initWeatherBoden(); 
        }
    } catch (err) {
        console.error("Init Error:", err);
    }
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
    
    const [draft, published, old] = await Promise.all([
        fetchData('schedule_draft'),
        fetchData('schedule_published'),
        fetchData('schedule')
    ]);
    let dataToUse = draft;
    if (!dataToUse || Object.keys(dataToUse).length === 0) {
        dataToUse = published && Object.keys(published).length > 0 ? published : old;
    }
    globalScheduleData = dataToUse || {};

    const themeSelect = document.getElementById('themeSelect');
    const editSelect = document.getElementById('editThemeSelect');
    const previewBox = document.getElementById('themePreviewBox'); 

    function populateThemeDropdowns() {
        const current = themeSelect.value || (currentSettings?.theme || 'light');
        themeSelect.innerHTML = `<option value="light">Ljus (Standard)</option>` + 
                                globalCustomThemes.map(t => `<option value="${t.id}">✨ ${t.name}</option>`).join('');
        themeSelect.value = current;
        updatePreviewBox(current);

        if(editSelect) {
            editSelect.innerHTML = '<option value="">-- Välj tema att redigera --</option>' + 
                globalCustomThemes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
        }
    }

    function updatePreviewBox(themeId) {
        if (!previewBox) return;
        let bg = '#f4f4f9';
        let text = '#333333';
        
        if (themeId && themeId !== 'light') {
            const t = globalCustomThemes.find(x => x.id === themeId);
            if (t && t.css) {
                const bgMatch = t.css.match(/--bg-color\s*:\s*([^;}]+)/);
                const textMatch = t.css.match(/--text-color\s*:\s*([^;}]+)/);
                if (bgMatch) bg = bgMatch[1].trim();
                if (textMatch) text = textMatch[1].trim();
            }
        }
        previewBox.style.backgroundColor = bg;
        previewBox.style.color = text;
    }

    themeSelect.onchange = (e) => {
        updatePreviewBox(e.target.value);
    };

    populateThemeDropdowns();

    document.getElementById('saveThemeBtn').onclick = async () => {
        await saveData('settings', { theme: themeSelect.value });
        showToast("Tema aktiverat!", "success");
    };

    if(editSelect) {
        const themeNameIn = document.getElementById('customThemeName');
        const themeCssIn = document.getElementById('customThemeCSS');
        const themeIdIn = document.getElementById('customThemeId');

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
            if(await showConfirm("Radera detta tema?")) {
                globalCustomThemes = globalCustomThemes.filter(t => t.id !== id);
                await saveData('custom_themes', globalCustomThemes);
                if(themeSelect.value === id) { themeSelect.value = 'light'; await saveData('settings', { theme: 'light' }); }
                showToast("Tema raderat", "info"); document.getElementById('clearThemeEditorBtn').click(); populateThemeDropdowns();
            }
        };
    }
    
    initStationsSettings(); 
    initShiftsSettings(); 
    initAdminSettings();
    initExportTab();

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
            if(st.isSpacer) return `<div class="draggable-station" ${dragAttr} style="background:#f9f9f9; color:#888;"><div class="list-info-left"><span class="drag-handle">☰</span><i>--- Mellanrum ---</i></div><div class="list-actions-right"><button class="list-btn" onclick="deleteStation(${i})">🗑️</button></div></div>`;
            return `<div class="draggable-station" ${dragAttr}><div class="list-info-left"><span class="drag-handle">☰</span><div style="width:20px; height:20px; background:${st.color}; border-radius:50%; border:1px solid #ccc; flex-shrink:0;"></div><strong>${st.name}</strong></div><div class="list-actions-right"><button class="list-btn" onclick="startEditStation(${i})">✏️</button><button class="list-btn" onclick="deleteStation(${i})">🗑️</button></div></div>`;
        }).join('');
    };

    window.startEditStation = (i) => {
        editingStationIndex = i; stName.value = globalStations[i].name; stColor.value = globalStations[i].color;
        stBtn.innerText = "💾"; stBtn.style.background = "#2196F3"; stCancel.style.display = "inline-flex";
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
    window.deleteStation = async (i) => { if(await showConfirm("Ta bort?")) { globalStations.splice(i, 1); await saveData('config_stations', globalStations); renderStations(); }};
    renderStations();
}

function initShiftsSettings() {
    const shLabel = document.getElementById('newShiftLabel'), shTime = document.getElementById('newShiftTime');
    const shBtn = document.getElementById('addShiftBtn'), shCancel = document.getElementById('cancelShiftEditBtn');

    const renderShifts = () => {
        const cont = document.getElementById('shiftListContainer');
        if(!Array.isArray(globalShifts)) globalShifts = DEFAULT_SHIFTS;
        cont.innerHTML = globalShifts.map((sh, i) => `
        <div class="shift-list-item">
            <div class="list-info-left">
                <strong>${sh.label}</strong> 
                <span style="color:#666; margin-left:5px;">(${sh.time})</span>
            </div>
            <div class="list-actions-right">
                <button class="list-btn" onclick="startEditShift(${i})">✏️</button>
                <button class="list-btn" onclick="deleteShift(${i})">🗑️</button>
            </div>
        </div>`).join('');
    };
    window.startEditShift = (i) => { editingShiftIndex = i; shLabel.value = globalShifts[i].label; shTime.value = globalShifts[i].time; shBtn.innerText = "Spara"; shBtn.style.background = "#2196F3"; shCancel.style.display = "inline-flex"; };
    const resetSh = () => { editingShiftIndex = null; shLabel.value = ""; shTime.value = ""; shBtn.innerText = "Lägg till Pass"; shBtn.style.background = ""; shCancel.style.display = "none"; };
    shCancel.onclick = resetSh;
    shBtn.onclick = async () => { if(!shLabel.value) return; const item = { label: shLabel.value, time: shTime.value }; if(editingShiftIndex !== null) globalShifts[editingShiftIndex] = item; else globalShifts.push(item); await saveData('config_shifts', globalShifts); showToast("Sparat", "success"); resetSh(); renderShifts(); };
    window.deleteShift = async (i) => { if(await showConfirm("Ta bort?")) { globalShifts.splice(i, 1); await saveData('config_shifts', globalShifts); renderShifts(); }};
    renderShifts();
}

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
            <div class="admin-list-item">
                <div class="list-info-left">
                    <strong>${a.username}</strong>
                    <span style="color:#666; margin-left:5px; font-size:0.9em;">
                        (${a.first_name||''} ${a.last_name||''})
                    </span>
                </div>
                <div class="list-actions-right">
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
        admBtn.innerText = "Spara"; 
        admBtn.style.background = "#2196F3"; 
        admCancel.style.display = "inline-flex";
    };

    const resetAdm = () => { 
        editingAdminId = null; 
        admUser.value = ""; 
        admPass.value = ""; 
        admFirst.value = ""; 
        admLast.value = ""; 
        admEmail.value = ""; 
        admPass.placeholder = "Lösenord"; 
        admBtn.innerText = "Spara / Skapa konto"; 
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
        if(await showConfirm("Ta bort admin?")) {
            await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, body: JSON.stringify({action:'remove_admin', username:u}) }); 
            showToast("Admin borttagen", "info");
            renderAdmins(); 
        }
    };
    renderAdmins();
}

/* =========================================
   UTSKRIFTS & EXPORT-FUNKTIONER (SETTINGS)
   ========================================= */
function initExportTab() {
    const startIn = document.getElementById('printStartDate');
    const endIn = document.getElementById('printEndDate');
    const today = new Date().toISOString().split('T')[0];
    if(startIn) startIn.value = today;
    if(endIn) endIn.value = today;

    const btnToday = document.getElementById('btnSetToday');
    if(btnToday) btnToday.onclick = () => { startIn.value = today; endIn.value = today; };

    const btnWeek = document.getElementById('btnSetWeek');
    if(btnWeek) btnWeek.onclick = () => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
        d.setDate(diff); 
        startIn.value = d.toISOString().split('T')[0];
        d.setDate(d.getDate() + 6); 
        endIn.value = d.toISOString().split('T')[0];
    };

    const btnNextWeek = document.getElementById('btnSetNextWeek');
    if(btnNextWeek) btnNextWeek.onclick = () => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff + 7);
        startIn.value = d.toISOString().split('T')[0];
        d.setDate(d.getDate() + 6);
        endIn.value = d.toISOString().split('T')[0];
    };

    const doPrint = document.getElementById('doPrintBtn');
    if(doPrint) doPrint.onclick = () => {
        const sDate = new Date(startIn.value);
        const eDate = new Date(endIn.value);
        if (sDate > eDate) return showToast("Startdatum måste vara före slutdatum", "error");

        const printContainer = document.getElementById('print-container') || document.createElement('div');
        printContainer.id = 'print-container';
        if(!document.body.contains(printContainer)) document.body.appendChild(printContainer);
        
        let htmlContent = "";
        let loopDate = new Date(sDate);

        while (loopDate <= eDate) {
            htmlContent += generateSingleDayPrintHtml(new Date(loopDate));
            loopDate.setDate(loopDate.getDate() + 1);
        }

        printContainer.innerHTML = htmlContent;
        window.print();
        setTimeout(() => printContainer.innerHTML = '', 1000);
    };

    const doImage = document.getElementById('doImageBtn');
    if(doImage) doImage.onclick = async () => {
        const sDate = new Date(startIn.value);
        const eDate = new Date(endIn.value);
        if (sDate > eDate) return showToast("Startdatum måste vara före slutdatum", "error");

        if(typeof html2canvas === 'undefined') {
            return showToast("html2canvas saknas. Ladda om sidan.", "error");
        }

        const originalBtnText = doImage.innerText;
        doImage.innerText = "Genererar...";
        
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.top = '-9999px';
        tempContainer.style.left = '0';
        tempContainer.style.width = '1200px'; 
        tempContainer.style.backgroundColor = '#ffffff';
        document.body.appendChild(tempContainer);

        let loopDate = new Date(sDate);
        let count = 0;

        while (loopDate <= eDate) {
            tempContainer.innerHTML = generateSingleDayPrintHtml(new Date(loopDate), true);
            await new Promise(r => setTimeout(r, 100));
            try {
                const canvas = await html2canvas(tempContainer, { scale: 2 });
                const link = document.createElement('a');
                const dateStr = loopDate.toLocaleDateString('sv-SE');
                link.download = `Schema-${dateStr}.jpg`;
                link.href = canvas.toDataURL('image/jpeg', 0.9);
                link.click();
                count++;
                await new Promise(r => setTimeout(r, 500));
            } catch (err) {
                console.error(err);
                showToast("Fel vid bildgenerering: " + err, "error");
            }
            loopDate.setDate(loopDate.getDate() + 1);
        }

        document.body.removeChild(tempContainer);
        doImage.innerText = originalBtnText;
        showToast(`Klar! ${count} bild(er) nedladdade.`, "success");
    };
}

function generateSingleDayPrintHtml(dateObj, forImage = false) {
    const iso = getISOWeek(dateObj);
    const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1; 
    const dayName = days[dayIndex];
    const dateStr = dateObj.toLocaleDateString('sv-SE');
    const prefix = `y${iso.year}w${iso.week}-${dayName}-`;

    const shifts = (Array.isArray(globalShifts) && globalShifts.length) ? globalShifts : DEFAULT_SHIFTS;
    const stations = (Array.isArray(globalStations) && globalStations.length) ? globalStations : DEFAULT_STATIONS;

    const style = forImage ? 'padding:20px; font-family:sans-serif; background:#fff;' : 'page-break-after: always; padding: 20px; font-family: sans-serif;';
    
    let html = `<div class="print-page" style="${style}">`;
    html += `<div style="text-align:center; margin-bottom:20px;"><h2 style="margin:0;">${dayName} ${dateStr}</h2><span style="font-size:0.9em; color:#666;">Vecka ${iso.week}, ${iso.year}</span></div>`;
    html += `<div style="display:grid; grid-template-columns:150px repeat(${shifts.length}, 1fr); gap:0; border:1px solid #000; border-bottom:none;"><div style="background:#ddd; border-right:1px solid #000; padding:5px;"></div>${shifts.map(s => `<div style="background:#ddd; border-right:1px solid #000; padding:5px; text-align:center; font-weight:bold;">${s.time}<br><span style="font-size:0.8em; font-weight:normal;">${s.label}</span></div>`).join('')}</div>`;
    html += `<div style="border:1px solid #000; border-top:none;">`;
    
    stations.forEach(st => {
        if (st.isSpacer) { html += `<div style="height:15px; background:#f0f0f0; border-top:1px solid #000;"></div>`; return; }
        const bg = st.color, fg = isLight(bg) ? '#000' : '#fff';
        html += `<div style="display:grid; grid-template-columns:150px repeat(${shifts.length}, 1fr); border-top:1px solid #000;"><div style="background:${bg}; color:${fg}; padding:10px; font-weight:bold; border-right:1px solid #000; display:flex; align-items:center;">${st.name}</div>`;
        shifts.forEach((sh, index) => {
            const key = `${prefix}${st.name}-${sh.time}`;
            const val = globalScheduleData[key] || "";
            const borderRight = index === shifts.length - 1 ? '' : 'border-right:1px solid #000;';
            html += `<div style="padding:5px; display:flex; align-items:center; justify-content:center; text-align:center; font-weight:bold; font-size:0.9rem; ${borderRight}">${val}</div>`;
        });
        html += `</div>`;
    });
    return html + `</div></div>`;
}

/* =========================================
   6. DISPLAY (DYNAMISK LAYOUT + FELHANTERING)
   ========================================= */
let lastSnap="";
function initDisplay() {
    setInterval(()=>document.getElementById('clock').innerText=new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'}),1000);
    const refresh = async () => {
        try {
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
            if (!cont) return;

            // FIX: Hämta standardvärden om listorna är tomma för att undvika layout-krasch
            if(!Array.isArray(globalShifts) || !globalShifts.length) globalShifts = DEFAULT_SHIFTS;
            if(!Array.isArray(globalStations) || !globalStations.length) globalStations = DEFAULT_STATIONS;

            // SAFETY: Om det mot förmodan ändå är tomt (fetch fail), sätt default
            const cols = (globalShifts.length > 0) ? globalShifts.length : 3;
            const gridStyle = `style="display:grid; grid-template-columns: 220px repeat(${cols}, 1fr); gap:1.5vw;"`;

            let html = `<div class="time-header-row" ${gridStyle}><div></div>${globalShifts.map(s => `<div class="time-header">${s.label}</div>`).join('')}</div>`;
            globalStations.forEach(st => {
                if(st.isSpacer) { html += `<div class="display-row" style="grid-column:1/-1; height:4vh;"></div>`; return; }
                const contrast = isLight(st.color) ? '#000' : '#fff';
                const vars = `style="--station-color:${st.color}; --contrast-color:${contrast};"`;
                html += `<div class="display-row" ${gridStyle}><div class="station-label" ${vars}>${st.name}</div>`;
                globalShifts.forEach(sh => {
                    const key = `y${iso.year}w${iso.week}-${today}-${st.name}-${sh.time}`;
                    const val = globalScheduleData[key] || "";
                    html += `<div class="shift-card ${val?'':'empty'}">${val}</div>`;
                });
                html += `</div>`;
            });
            cont.innerHTML = html;
        } catch (e) { 
            console.error("Display Error", e); 
            // Försök visa felmeddelande om möjligt
            const cont = document.getElementById('mainContainer');
            if(cont) cont.innerHTML = `<h3 style="text-align:center; color:red;">Kunde inte ladda schemat.</h3>`;
        }
    };
    refresh(); setInterval(refresh, 15000);
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

/* =========================================
   FLIK-HANTERARE
   ========================================= */
window.openTab = function(tabId) {
    const allPanes = document.querySelectorAll('.tab-pane');
    allPanes.forEach(pane => {
        pane.classList.remove('active');
        pane.style.display = 'none';
    });
    const allBtns = document.querySelectorAll('.tab-btn');
    allBtns.forEach(btn => {
        btn.classList.remove('active');
    });
    const targetPane = document.getElementById(tabId);
    if (targetPane) {
        targetPane.classList.add('active');
        targetPane.style.display = 'block';
    }
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
};

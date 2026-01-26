/* =========================================
   1. KONFIGURATION & GLOBALA VARIABLER
   ========================================= */
const stations = [
    { name: "Björkliden", class: "color-bjorkliden" },
    { name: "Kiruna",     class: "color-kiruna" },
    { name: "Bastuträsk", class: "color-bastutrask" },
    { name: "Boden",      class: "color-boden" },
    { name: "Gällivare",  class: "color-gallivare" },
    { name: "Älvsbyn",    class: "color-alvsbyn" },
    { name: "Info",       class: "color-info" },
    { name: "PL",         class: "color-pl" }
];
const dbTimes = ["06:30 - 14:00", "14:00 - 21:15", "21:15 - 06:30"];
const displayTimes = ["Förmiddag", "Eftermiddag", "Natt"];
const days = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];

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
        if (type === 'users' || type === 'admins') return [];
        if (type === 'settings') return { theme: 'light' };
        if (type === 'message') return { text: '', show: false };
        return {};
    }
}

async function saveData(type, data) {
    if(type === 'schedule') globalScheduleData = data;
    const token = sessionStorage.getItem('jwtToken');
    if (!token) {
        alert("Sessionen har gått ut. Logga in igen.");
        window.location.href = "index.html";
        return;
    }
    try {
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
   3. INITIERING
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const pageId = document.body.id;

    if (pageId === 'page-login') { initLogin(); return; }
    if (pageId === 'page-reset') { initReset(); return; } // NY SIDHANTERARE

    const [schedule, users, settings] = await Promise.all([
        fetchData('schedule'), fetchData('users'), fetchData('settings')
    ]);
    globalScheduleData = schedule;
    globalUserList = users;

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
   4. LOGIN & GLÖMT LÖSENORD
   ========================================= */
function initLogin() {
    // Login-element
    const loginView = document.getElementById('loginForm');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');
    const loginBtn = document.getElementById('loginBtn');
    
    // Forgot-element
    const forgotView = document.getElementById('forgotForm');
    const resetEmailIn = document.getElementById('resetEmailInput');
    const resetBtn = document.getElementById('sendResetBtn');
    
    // Länkar
    const toForgotLink = document.getElementById('forgotPassLink');
    const toLoginLink = document.getElementById('backToLoginLink');

    // -- LOGGA IN --
    const doLogin = async () => {
        const password = passIn.value.trim();
        const username = userIn.value.trim();
        try {
            const res = await fetch('/api/data-api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', username, password })
            });
            const data = await res.json();
            if (data.success) {
                sessionStorage.setItem('jwtToken', data.token); 
                sessionStorage.setItem('adminUser', data.user);
                sessionStorage.setItem('adminName', data.name);
                window.location.href = "admin.html";
            } else { alert("Fel användarnamn eller lösenord!"); }
        } catch (e) { alert("Kunde inte nå servern."); }
    };

    if(loginBtn) loginBtn.onclick = doLogin;
    if(passIn) passIn.onkeydown = (e) => { if(e.key === 'Enter') doLogin(); };

    // -- VÄXLA VYER --
    if(toForgotLink) {
        toForgotLink.onclick = (e) => {
            e.preventDefault();
            loginView.style.display = 'none';
            forgotView.style.display = 'block';
        };
    }
    if(toLoginLink) {
        toLoginLink.onclick = (e) => {
            e.preventDefault();
            forgotView.style.display = 'none';
            loginView.style.display = 'block';
        };
    }

    // -- SKICKA ÅTERSTÄLLNINGSLÄNK --
    if(resetBtn) {
        resetBtn.onclick = async () => {
            const email = resetEmailIn.value.trim();
            if(!email) return alert("Ange din e-postadress.");
            
            resetBtn.innerText = "SKICKAR...";
            try {
                const res = await fetch('/api/data-api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'request_reset', email })
                });
                const data = await res.json();
                if(data.success) {
                    alert("En återställningslänk har genererats i systemloggen.");
                    resetEmailIn.value = "";
                    toLoginLink.click(); // Gå tillbaka
                } else {
                    alert("Kunde inte skicka.");
                }
            } catch(e) { console.error(e); }
            resetBtn.innerText = "ÅTERSTÄLL";
        };
    }
}

/* =========================================
   5. ÅTERSTÄLLNINGSSIDA (RESET.HTML)
   ========================================= */
function initReset() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    const newPass = document.getElementById('newPassInput');
    const confirmPass = document.getElementById('confirmPassInput');
    const submitBtn = document.getElementById('resetSubmitBtn');
    const msg = document.getElementById('resetMessage');

    if(!token) {
        if(msg) msg.innerText = "Fel: Ingen kod hittades i länken.";
        if(submitBtn) submitBtn.disabled = true;
        return;
    }

    if(submitBtn) {
        submitBtn.onclick = async () => {
            const p1 = newPass.value.trim();
            const p2 = confirmPass.value.trim();
            
            if(!p1) return alert("Ange ett lösenord");
            if(p1 !== p2) return alert("Lösenorden matchar inte");

            submitBtn.innerText = "SPARAR...";
            
            try {
                const res = await fetch('/api/data-api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'perform_reset', token, newPassword: p1 })
                });
                const data = await res.json();
                
                if(data.success) {
                    msg.style.color = "#4CAF50";
                    msg.innerText = "Lösenordet har ändrats! Du skickas till login...";
                    setTimeout(() => window.location.href = "index.html", 2000);
                } else {
                    msg.style.color = "red";
                    msg.innerText = data.error || "Något gick fel (länken kan vara gammal).";
                    submitBtn.innerText = "FÖRSÖK IGEN";
                }
            } catch(e) {
                console.error(e);
                msg.innerText = "Serverfel.";
            }
        };
    }
}

/* =========================================
   6. INSTÄLLNINGSSIDA (MED E-POST)
   ========================================= */
async function initSettings(currentSettings) {
    const displayName = sessionStorage.getItem('adminName') || sessionStorage.getItem('adminUser') || 'Admin';
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + displayName;

    // ... Tema & Meddelande (samma som förut) ...
    const themeSelect = document.getElementById('themeSelect');
    const saveThemeBtn = document.getElementById('saveThemeBtn');
    if(themeSelect && currentSettings?.theme) themeSelect.value = currentSettings.theme;
    if(saveThemeBtn) {
        saveThemeBtn.onclick = async () => {
            if(await saveData('settings', { theme: themeSelect.value })) {
                saveThemeBtn.innerText = "Sparat!";
                setTimeout(() => saveThemeBtn.innerText = "Spara Tema", 2000);
            }
        };
    }

    const msgInput = document.getElementById('displayMessageInput');
    const showCheck = document.getElementById('showMessageCheckbox');
    const msgBtn = document.getElementById('saveMessageBtn');
    const currentMsg = await fetchData('message');
    if(currentMsg) { msgInput.value = currentMsg.text || ""; showCheck.checked = currentMsg.show || false; }
    if(msgBtn) {
        msgBtn.onclick = async () => {
            if(await saveData('message', { text: msgInput.value, show: showCheck.checked })) {
                msgBtn.innerText = "Sparat!";
                setTimeout(() => msgBtn.innerText = "Uppdatera", 2000);
            }
        };
    }

    // --- ADMIN LISTA ---
    const listContainer = document.getElementById('adminListContainer');
    const actionBtn = document.getElementById('addAdminBtn');
    
    // Inputs (inklusive Email)
    const inputFirst = document.getElementById('newAdminFirstName');
    const inputLast = document.getElementById('newAdminLastName');
    const inputEmail = document.getElementById('newAdminEmail'); // NYTT
    const inputUser = document.getElementById('newAdminUser');
    const inputPass = document.getElementById('newAdminPass');

    const renderAdmins = async () => {
        listContainer.innerHTML = "Laddar...";
        const admins = await fetchData('admins');
        
        if(admins.length === 0) {
            listContainer.innerHTML = "<p style='padding:10px; color:#888;'>Inga admins hittades.</p>";
            return;
        }

        listContainer.innerHTML = admins.map(a => {
            const fullName = (a.first_name || a.last_name) 
                ? `<strong>${a.first_name || ''} ${a.last_name || ''}</strong>` 
                : `<em style="color:#888;">(Inget namn)</em>`;
            const userJson = JSON.stringify(a).replace(/"/g, '&quot;');

            // Visa även e-post i listan lite snyggt
            const emailDisplay = a.email ? `<span style="font-size:0.8rem; color:#888;"> | ${a.email}</span>` : "";

            return `
            <div class="admin-list-item" style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:1rem;">${fullName}</div>
                    <div style="font-size:0.85rem; color:#666;">@${a.username} ${emailDisplay}</div>
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="remove-user-btn" style="color:#2196F3;" onclick="startEditAdmin(${userJson})" title="Redigera">✏️</button>
                    <button class="remove-user-btn" onclick="deleteAdmin('${a.username}')" title="Ta bort">🗑️</button>
                </div>
            </div>
            `;
        }).join('');
    };

    if(actionBtn) {
        actionBtn.onclick = async () => {
            const firstName = inputFirst.value.trim();
            const lastName = inputLast.value.trim();
            const email = inputEmail.value.trim(); // NYTT
            const username = inputUser.value.trim();
            const password = inputPass.value.trim();

            if(!username) return alert("Användarnamn krävs!");

            const token = sessionStorage.getItem('jwtToken');
            const action = editingAdminId ? 'edit_admin' : 'add_admin';
            
            const bodyData = { 
                action, username, password, firstName, lastName, email, // Skicka med email
                id: editingAdminId 
            };

            if(action === 'add_admin' && !password) return alert("Lösenord krävs för ny användare!");

            const res = await fetch('/api/data-api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(bodyData)
            });

            if(res.ok) {
                resetForm();
                renderAdmins();
            } else { alert("Kunde inte spara."); }
        };
    }

    window.startEditAdmin = (user) => {
        editingAdminId = user.id;
        inputFirst.value = user.first_name || "";
        inputLast.value = user.last_name || "";
        inputEmail.value = user.email || ""; // Ladda in e-post
        inputUser.value = user.username || "";
        inputPass.value = ""; 
        inputPass.placeholder = "Nytt lösen (valfritt)";
        
        actionBtn.innerText = "💾";
        actionBtn.style.backgroundColor = "#2196F3";

        if(!document.getElementById('cancelEditBtn')) {
            const cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancelEditBtn';
            cancelBtn.innerText = "❌";
            cancelBtn.className = "sidebar-add-btn";
            cancelBtn.style.backgroundColor = "#999";
            cancelBtn.onclick = resetForm;
            actionBtn.parentNode.appendChild(cancelBtn);
        }
    };

    function resetForm() {
        editingAdminId = null;
        inputFirst.value = "";
        inputLast.value = "";
        inputEmail.value = "";
        inputUser.value = "";
        inputPass.value = "";
        inputPass.placeholder = "Lösenord";
        
        actionBtn.innerText = "+";
        actionBtn.style.backgroundColor = "#4CAF50";
        const cancel = document.getElementById('cancelEditBtn');
        if(cancel) cancel.remove();
    }

    window.deleteAdmin = async (username) => {
        if(!confirm(`Ta bort admin ${username}?`)) return;
        const token = sessionStorage.getItem('jwtToken');
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ action: 'remove_admin', username })
        });
        if(res.ok) renderAdmins();
        else alert("Kunde inte ta bort.");
    };

    renderAdmins();

    document.getElementById('logoutBtn').onclick = () => {
        sessionStorage.clear();
        window.location.href = "index.html";
    };
}

/* =========================================
   7. ÖVRIGA FUNKTIONER (Admin & Display)
   Samma som förut...
   ========================================= */
function initAdmin() {
    const displayName = sessionStorage.getItem('adminName') || sessionStorage.getItem('adminUser') || 'Admin';
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + displayName;
    // ... resten av koden är samma som i tidigare script.js ...
    const picker = document.getElementById('adminDatePicker');
    const dateDisplay = document.getElementById('currentDateDisplay');
    if(picker) {
        picker.value = new Date().toISOString().split('T')[0];
        picker.onchange = (e) => updateGrid(e.target.value);
        updateGrid(picker.value);
    }
    function updateGrid(dateStr) {
        const d = new Date(dateStr);
        const iso = getISOWeek(d);
        selectedWeek = iso.week;
        selectedYear = iso.year;
        currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
        if(dateDisplay) dateDisplay.innerText = `${days[currentAdminDayIndex]} v.${selectedWeek}, ${selectedYear}`;
        renderAdminGrid();
    }
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href = "index.html"; };
    setupSidebarAddUser();
    document.getElementById('printBtn').onclick = () => window.print();
    document.getElementById('exportBtn').onclick = generateImage;
}
function renderAdminGrid() {
    const container = document.getElementById('scheduleContainer');
    renderRoster();
    if(!container) return;
    const dayName = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-`;
    let html = `<div class="header-row"><div></div>${dbTimes.map(t => `<div>${t}</div>`).join('')}</div>`;
    stations.forEach(st => {
        html += `<div class="station-row ${st.class}"><div class="station-label">${st.name}</div>`;
        dbTimes.forEach((time, idx) => {
            if ((st.name === "Info" || st.name === "PL") && idx === 2) { html += `<div></div>`; return; }
            const key = `${prefix}${dayName}-${st.name}-${time}`;
            const val = globalScheduleData[key] || "";
            html += `<div class="shift-block ${val?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event, '${key}')"><span class="shift-text" contenteditable="true" onblur="saveShift('${key}', this.innerText)">${val}</span>${val ? `<button class="clear-btn" onclick="saveShift('${key}', '')">&times;</button>` : ''}</div>`;
        });
        html += `</div>`;
    });
    container.innerHTML = html;
}
function initDisplay() {
    setInterval(() => { const el = document.getElementById('clock'); if(el) el.innerText = new Date().toLocaleTimeString('sv-SE', {hour:'2-digit', minute:'2-digit'}); }, 1000);
    const refreshData = async () => {
        const [data, settings, message] = await Promise.all([fetchData('schedule'), fetchData('settings'), fetchData('message')]);
        globalScheduleData = data;
        if(settings && settings.theme) applyTheme(settings.theme);
        const marqueeContainer = document.getElementById('marqueeContainer');
        const marqueeText = document.getElementById('marqueeText');
        if(marqueeContainer && marqueeText) {
            if(message && message.show && message.text) {
                marqueeContainer.style.display = 'block';
                if(marqueeText.innerText !== message.text) marqueeText.innerText = message.text;
            } else { marqueeContainer.style.display = 'none'; }
        }
        const now = new Date();
        const iso = getISOWeek(now);
        const todayName = days[now.getDay() === 0 ? 6 : now.getDay() - 1];
        const title = document.getElementById('mainTitle');
        if(title) title.innerText = `Vi som jobbar ${todayName} ${now.getDate()}/${now.getMonth()+1} (v.${iso.week})`;
        const container = document.getElementById('mainContainer');
        if(!container) return;
        let html = `<div class="time-header-row"><div></div>${displayTimes.map(t => `<div class="time-header">${t}</div>`).join('')}</div>`;
        stations.forEach(st => {
            html += `<div class="display-row ${st.class}"><div class="station-label">${st.name}</div>`;
            dbTimes.forEach((time, idx) => {
                if ((st.name === "Info" || st.name === "PL") && idx === 2) return;
                const key = `y${iso.year}w${iso.week}-${todayName}-${st.name}-${time}`;
                const val = data[key] || "";
                html += `<div class="shift-card ${val?'':'empty'}">${val}</div>`;
            });
            html += `</div>`;
        });
        container.innerHTML = html;
    };
    refreshData();
    setInterval(refreshData, 10000);
}
function getISOWeek(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    const week = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return { week, year: date.getFullYear() };
}
async function saveShift(key, val) { globalScheduleData[key] = val.trim(); await saveData('schedule', globalScheduleData); renderAdminGrid(); }
function handleDrop(e, key) { e.preventDefault(); const name = e.dataTransfer.getData("text"); let current = globalScheduleData[key] || ""; if(current) current += " / " + name; else current = name; saveShift(key, current); }
function renderRoster() { const list = document.getElementById('draggableUserList'); if(!list) return; list.innerHTML = globalUserList.map(u => `<div class="draggable-item" draggable="true" ondragstart="event.dataTransfer.setData('text', '${u}')">${u} <button class="remove-user-btn" onclick="removeUser('${u}')">&times;</button></div>`).join(''); }
async function removeUser(u) { if(confirm('Ta bort ' + u + '?')) { globalUserList = globalUserList.filter(user => user !== u); await saveData('users', globalUserList); renderRoster(); } }
function setupSidebarAddUser() { const btn = document.getElementById('sidebarAddBtn'); const inp = document.getElementById('sidebarNewName'); if(btn && inp) { const add = async () => { if(inp.value) { globalUserList.push(inp.value); globalUserList.sort(); await saveData('users', globalUserList); inp.value = ''; renderRoster(); } }; btn.onclick = add; inp.onkeydown = e => { if(e.key==='Enter') add(); }; } }
function generateImage() { const btn = document.getElementById('exportBtn'); btn.innerText = "Genererar..."; html2canvas(document.getElementById('scheduleContainer')).then(canvas => { const a = document.createElement('a'); a.download = 'schema.jpg'; a.href = canvas.toDataURL(); a.click(); btn.innerText = "📷 Spara som bild"; }); }

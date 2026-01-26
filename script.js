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

/* =========================================
   2. KOMMUNIKATION MED SERVER (API)
   ========================================= */

// Hämta data (Publikt)
async function fetchData(type) {
    try {
        const headers = {};
        // Om vi hämtar admins måste vi skicka token
        if (type === 'admins') {
            const token = sessionStorage.getItem('jwtToken');
            if (token) headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(`/api/data-api?type=${type}`, { headers });
        if (!res.ok) throw new Error('Fetch failed');
        return await res.json();
    } catch (e) {
        console.error(e);
        if (type === 'users') return [];
        if (type === 'admins') return [];
        if (type === 'settings') return { theme: 'light' };
        return {};
    }
}

// Spara data (Kräver Token)
async function saveData(type, data) {
    if(type === 'schedule') globalScheduleData = data;
    
    const token = sessionStorage.getItem('jwtToken'); // Vi hämtar JWT-token nu
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
    } catch (e) {
        console.error("Save failed:", e);
        alert("Kunde inte spara. Logga in igen.");
    }
}

/* =========================================
   3. TEMA & INIT
   ========================================= */
function applyTheme(themeName) {
    if (document.body.id === 'page-admin') return;
    const themes = ['theme-dark', 'theme-jul', 'theme-pask', 'theme-matrix'];
    document.body.classList.remove(...themes);
    if (themeName && themeName !== 'light') {
        document.body.classList.add(`theme-${themeName}`);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const pageId = document.body.id;

    if (pageId === 'page-login') {
        initLogin();
        return;
    }

    const [schedule, users, settings] = await Promise.all([
        fetchData('schedule'), fetchData('users'), fetchData('settings')
    ]);
    globalScheduleData = schedule;
    globalUserList = users;

    if (settings && settings.theme) applyTheme(settings.theme);

    if (pageId === 'page-admin') {
        if (!sessionStorage.getItem('jwtToken')) {
            window.location.href = "index.html";
            return;
        }
        initAdmin(settings);
    } else if (pageId === 'page-display') {
        initDisplay();
    }
});

/* =========================================
   4. LOGIN (SÄKER JWT)
   ========================================= */
function initLogin() {
    const btn = document.getElementById('loginBtn');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');

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
                // Spara JWT-token (inte lösenordet)
                sessionStorage.setItem('jwtToken', data.token); 
                sessionStorage.setItem('adminUser', data.user);
                window.location.href = "admin.html";
            } else {
                alert("Fel användarnamn eller lösenord!");
            }
        } catch (e) {
            alert("Kunde inte nå servern.");
        }
    };

    if(btn) btn.onclick = doLogin;
    if(passIn) passIn.onkeydown = (e) => { if(e.key === 'Enter') doLogin(); };
}

/* =========================================
   5. ADMIN-HANTERING (SÄKER)
   ========================================= */
function setupAdminManagement() {
    const adminBtn = document.getElementById('manageAdminsBtn');
    if (!adminBtn) return;

    adminBtn.onclick = async () => {
        const token = sessionStorage.getItem('jwtToken');
        
        // Hämta lista
        let currentAdmins = await fetchData('admins');
        const listText = currentAdmins.map(a => `- ${a.username}`).join('\n');
        
        const action = prompt(`ADMINS:\n${listText}\n\nSkriv 'ny' eller namnet på den du vill radera.`);
        if (!action) return;

        if (action.toLowerCase() === 'ny') {
            const username = prompt("Användarnamn:");
            const password = prompt("Lösenord:");
            if (!username || !password) return;

            // Anropa API för att skapa (Hashas på servern)
            const res = await fetch('/api/data-api', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ action: 'add_admin', username, password })
            });
            
            if (res.ok) alert("Admin skapad!");
            else alert("Fel: Kunde inte skapa (kanske finns namnet redan?)");
        } 
        else {
            if (confirm(`Radera ${action}?`)) {
                const res = await fetch('/api/data-api', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ action: 'remove_admin', username: action })
                });
                if(res.ok) alert("Raderad.");
                else alert("Kunde inte radera.");
            }
        }
    };
}

/* =========================================
   6. ADMIN OCH DISPLAY LOGIK (Resten är oförändrat)
   ========================================= */
function initAdmin(settings) {
    const userDisplay = document.getElementById('currentUserDisplay');
    if(userDisplay) userDisplay.innerText = "Inloggad: " + (sessionStorage.getItem('adminUser') || 'Admin');

    setupAdminManagement();

    // Temaväljare
    const themeSelect = document.getElementById('themeSelect');
    const saveThemeBtn = document.getElementById('saveThemeBtn');
    if(themeSelect && settings?.theme) themeSelect.value = settings.theme;

    if(saveThemeBtn) {
        saveThemeBtn.onclick = async () => {
            await saveData('settings', { theme: themeSelect.value });
            saveThemeBtn.innerText = "Sparat!";
            setTimeout(() => saveThemeBtn.innerText = "Spara tema", 2000);
        };
    }

    // Datumväljare
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

    document.getElementById('logoutBtn').onclick = () => {
        sessionStorage.clear();
        window.location.href = "index.html";
    };
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
            html += `<div class="shift-block ${val?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event, '${key}')">
                     <span class="shift-text" contenteditable="true" onblur="saveShift('${key}', this.innerText)">${val}</span>
                     ${val ? `<button class="clear-btn" onclick="saveShift('${key}', '')">&times;</button>` : ''}
                     </div>`;
        });
        html += `</div>`;
    });
    container.innerHTML = html;
}

function initDisplay() {
    setInterval(() => {
        const el = document.getElementById('clock');
        if(el) el.innerText = new Date().toLocaleTimeString('sv-SE', {hour:'2-digit', minute:'2-digit'});
    }, 1000);

    const refreshData = async () => {
        const [data, settings] = await Promise.all([fetchData('schedule'), fetchData('settings')]);
        globalScheduleData = data;
        if(settings && settings.theme) applyTheme(settings.theme);

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

async function saveShift(key, val) {
    globalScheduleData[key] = val.trim();
    await saveData('schedule', globalScheduleData);
    renderAdminGrid();
}

function handleDrop(e, key) {
    e.preventDefault();
    const name = e.dataTransfer.getData("text");
    let current = globalScheduleData[key] || "";
    if(current) current += " / " + name;
    else current = name;
    saveShift(key, current);
}

function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if(!list) return;
    list.innerHTML = globalUserList.map(u => 
        `<div class="draggable-item" draggable="true" ondragstart="event.dataTransfer.setData('text', '${u}')">
            ${u} <button class="remove-user-btn" onclick="removeUser('${u}')">&times;</button>
        </div>`
    ).join('');
}

async function removeUser(u) {
    if(confirm('Ta bort ' + u + '?')) {
        globalUserList = globalUserList.filter(user => user !== u);
        await saveData('users', globalUserList);
        renderRoster();
    }
}

function setupSidebarAddUser() {
    const btn = document.getElementById('sidebarAddBtn');
    const inp = document.getElementById('sidebarNewName');
    if(btn && inp) {
        const add = async () => {
            if(inp.value) {
                globalUserList.push(inp.value);
                globalUserList.sort();
                await saveData('users', globalUserList);
                inp.value = '';
                renderRoster();
            }
        };
        btn.onclick = add;
        inp.onkeydown = e => { if(e.key==='Enter') add(); };
    }
}

function generateImage() {
    const btn = document.getElementById('exportBtn');
    btn.innerText = "Genererar...";
    html2canvas(document.getElementById('scheduleContainer')).then(canvas => {
        const a = document.createElement('a');
        a.download = 'schema.jpg';
        a.href = canvas.toDataURL();
        a.click();
        btn.innerText = "📷 Spara som bild";
    });
}

/* =========================================
   1. KONFIGURATION & GLOBALA VARIABLER
   ========================================= */
const USE_CLOUD_DB = true; 

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

let selectedWeek = 0;
let selectedYear = 0;
let currentAdminDayIndex = 0;

let globalScheduleData = {};
let globalUserList = []; 

/* =========================================
   2. DATA-API (FETCH & SAVE)
   ========================================= */
async function fetchData(type) {
    try {
        const response = await fetch(`/api/data-api?type=${type}`);
        if (!response.ok) throw new Error('Kunde inte hämta data');
        return await response.json();
    } catch (error) {
        console.error(`Fetch error (${type}):`, error);
        return type === 'users' ? [] : (type === 'settings' ? { theme: 'light' } : {});
    }
}

async function saveData(type, data) {
    if (type === 'schedule') globalScheduleData = data;
    if (type === 'users') globalUserList = data;

    try {
        const currentUser = sessionStorage.getItem('adminUser') || 'unknown';
        const response = await fetch('/api/data-api', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User': currentUser 
            },
            body: JSON.stringify({ type: type, data: data })
        });
        if (!response.ok) throw new Error("Serverfel vid sparning");
    } catch (e) {
        console.error("Save failed", e);
    }
}

/* =========================================
   3. TEMA-HANTERING (FIXAD)
   ========================================= */
function applyTheme(themeName) {
    const knownThemes = ['theme-dark', 'theme-jul', 'theme-pask', 'theme-matrix'];
    // Ta bort alla befintliga temaklasser från body
    document.body.classList.remove(...knownThemes);
    
    // Om temat inte är ljust, lägg till klassen
    if (themeName && themeName !== 'light') {
        document.body.classList.add(`theme-${themeName}`);
    }
    console.log("Tema applicerat:", themeName);
}

/* =========================================
   4. INITIERING (DOM CONTENT LOADED)
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const bodyId = document.body.id;

    // 1. Inloggningssidan
    if (bodyId === 'page-login') {
        initLogin();
        return;
    }

    // 2. Ladda all data och applicera tema direkt
    try {
        const [schedule, users, settings] = await Promise.all([
            fetchData('schedule'),
            fetchData('users'),
            fetchData('settings')
        ]);
        
        globalScheduleData = schedule || {};
        globalUserList = users || [];
        
        if (settings && settings.theme) {
            applyTheme(settings.theme);
        }
    } catch (err) {
        console.error("Initieringsfel:", err);
    }

    // 3. Välj vy baserat på Body ID
    if (bodyId === 'page-admin') {
        if (sessionStorage.getItem('isLoggedIn') !== 'true') { 
            window.location.href = "index.html"; 
            return; 
        }
        initAdmin();
    } else if (bodyId === 'page-display') {
        initDisplay();
    }
});

/* =========================================
   5. ADMIN-PANEL LOGIK
   ========================================= */
function initAdmin() {
    const userDisplay = document.getElementById('currentUserDisplay');
    if (userDisplay) userDisplay.innerText = `Inloggad: ${sessionStorage.getItem('adminUser')}`;
    
    setupDatePicker();
    setupSidebarAddUser();
    initThemeSelector();
    setupAdminManagement();

    // Koppla logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            sessionStorage.clear();
            window.location.href = "index.html";
        };
    }
    
    // Koppla exportknappar
    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.onclick = printSchedule;
    
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.onclick = generateScheduleImage;
}

// Datumväljaren i Headern
function setupDatePicker() {
    const picker = document.getElementById('adminDatePicker');
    const display = document.getElementById('currentDateDisplay');
    if (!picker) return;

    // Standardvärde: Idag
    picker.value = new Date().toISOString().split('T')[0];

    const update = (dateStr) => {
        const d = new Date(dateStr);
        
        // Räkna ut ISO-vecka
        const t = new Date(d.valueOf());
        t.setHours(0,0,0,0);
        t.setDate(t.getDate() + 3 - (t.getDay() + 6) % 7);
        const week1 = new Date(t.getFullYear(), 0, 4);
        selectedWeek = 1 + Math.round(((t.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
        selectedYear = t.getFullYear();
        
        currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
        
        if (display) {
            display.innerText = `${days[currentAdminDayIndex]} vecka ${selectedWeek}, ${selectedYear}`;
        }
        renderAdminGrid();
    };

    picker.addEventListener('change', (e) => update(e.target.value));
    update(picker.value);
}

// Rendera själva rutnätet
function renderAdminGrid() {
    const container = document.getElementById('scheduleContainer');
    if (!container) return;
    
    renderRoster();
    const dayName = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-`;

    let html = `
        <div class="header-row" style="display:grid; grid-template-columns:150px 1fr 1fr 1fr; gap:12px; text-align:center; font-weight:bold; margin-bottom:15px; color:#666;">
            <div></div>
            ${dbTimes.map(t => `<div>${t}</div>`).join('')}
        </div>
    `;

    stations.forEach(st => {
        html += `<div class="station-row ${st.class}">
            <div class="station-label">${st.name}</div>`;

        dbTimes.forEach((time, idx) => {
            if ((st.name === "Info" || st.name === "PL") && idx === 2) {
                html += `<div></div>`;
                return;
            }
            const key = `${prefix}${dayName}-${st.name}-${time}`;
            const val = globalScheduleData[key] || "";
            html += `
                <div class="shift-block ${val ? '' : 'empty'}" 
                     ondragover="event.preventDefault()" 
                     ondrop="handleDrop(event, '${key}')">
                    <span class="shift-text" contenteditable="true" onblur="updateShift('${key}', this.innerText)">${val}</span>
                    <div class="admin-tools">
                        ${val ? `<button class="clear-btn" onclick="updateShift('${key}', '')">&times;</button>` : ''}
                    </div>
                </div>`;
        });
        html += `</div>`;
    });
    container.innerHTML = html;
}

/* =========================================
   6. PERSONAL & INTERAKTION
   ========================================= */
function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if (!list) return;

    list.innerHTML = globalUserList.map(user => `
        <div class="draggable-item" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', '${user}')">
            <span>${user}</span>
            <button class="remove-user-btn" onclick="removeUser('${user}')">&times;</button>
        </div>
    `).join('');
}

async function updateShift(key, value) {
    globalScheduleData[key] = value.trim();
    await saveData('schedule', globalScheduleData);
    renderAdminGrid();
}

function handleDrop(e, key) {
    e.preventDefault();
    const name = e.dataTransfer.getData("text/plain");
    let current = globalScheduleData[key] || "";
    const newVal = current ? `${current} / ${name}` : name;
    updateShift(key, newVal);
}

function setupSidebarAddUser() {
    const btn = document.getElementById('sidebarAddBtn');
    const input = document.getElementById('sidebarNewName');
    if (!btn || !input) return;
    
    const add = () => {
        const name = input.value.trim();
        if (name && !globalUserList.includes(name)) {
            globalUserList.push(name);
            globalUserList.sort((a,b) => a.localeCompare(b, 'sv'));
            saveData('users', globalUserList);
            input.value = '';
            renderRoster();
        }
    };
    btn.onclick = add;
    input.onkeydown = (e) => { if (e.key === 'Enter') add(); };
}

async function removeUser(name) {
    if (confirm(`Ta bort ${name} permanent?`)) {
        globalUserList = globalUserList.filter(u => u !== name);
        await saveData('users', globalUserList);
        renderRoster();
    }
}

/* =========================================
   7. TEMAVÄLJARE (FIXAD LOGIK)
   ========================================= */
async function initThemeSelector() {
    const select = document.getElementById('themeSelect');
    const saveBtn = document.getElementById('saveThemeBtn');
    if (!select || !saveBtn) return;

    saveBtn.onclick = async () => {
        const theme = select.value;
        await saveData('settings', { theme: theme });
        applyTheme(theme); // Denna rad aktiverar temat direkt
        
        const originalText = saveBtn.innerText;
        saveBtn.innerText = "Sparat!";
        setTimeout(() => saveBtn.innerText = originalText, 2000);
    };
}

/* =========================================
   8. EXPORT & UTSKRIFT
   ========================================= */
function printSchedule() { window.print(); }

function generateScheduleImage() {
    const btn = document.getElementById('exportBtn');
    if (!btn) return;
    const originalText = btn.innerText;
    btn.innerText = "Genererar...";
    
    const container = document.getElementById('scheduleContainer');
    html2canvas(container, { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Schema-${days[currentAdminDayIndex]}.jpg`;
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        link.click();
        btn.innerText = originalText;
    }).catch(err => {
        console.error(err);
        btn.innerText = "Fel vid export";
    });
}

/* =========================================
   9. LOGIN & AUTH
   ========================================= */
function initLogin() {
    const loginBtn = document.getElementById('loginBtn');
    const usernameInput = document.getElementById('usernameInput'); 
    const passwordInput = document.getElementById('passwordInput');
    if (!loginBtn) return;

    const performLogin = async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        if (!username || !password) return;

        try {
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', username, password })
            });
            const result = await response.json();
            if (result.success) {
                sessionStorage.setItem('adminUser', result.user);
                sessionStorage.setItem('isLoggedIn', 'true');
                window.location.href = "admin.html";
            } else { alert("Fel användarnamn eller lösenord"); }
        } catch (e) { console.error(e); }
    };
    loginBtn.onclick = performLogin;
}

function setupAdminManagement() {
    const adminBtn = document.getElementById('manageAdminsBtn');
    if (!adminBtn) return;
    adminBtn.onclick = async () => {
        const action = prompt("Hantera Admins: Skriv 'ny' eller 'radera'");
        if (action === 'ny') {
            const username = prompt("Användarnamn:"), password = prompt("Lösenord:");
            await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', username, password }) });
        }
    };
}

/* =========================================
   10. DISPLAY (SKÄRMVISNING)
   ========================================= */
function initDisplay() {
    // Klocka
    setInterval(() => {
        const clock = document.getElementById('clock');
        if (clock) clock.innerText = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }, 1000);

    const loadData = async () => {
        const [data, settings] = await Promise.all([fetchData('schedule'), fetchData('settings')]);
        globalScheduleData = data;
        if (settings && settings.theme) applyTheme(settings.theme);
        
        const now = new Date();
        const todayName = days[now.getDay() === 0 ? 6 : now.getDay() - 1];
        
        const container = document.getElementById('mainContainer');
        if (!container) return;

        let html = `<div class="time-header-row"><div></div>${displayTimes.map(t => `<div class="time-header">${t}</div>`).join('')}</div>`;

        stations.forEach(st => {
            html += `<div class="display-row ${st.class}"><div class="station-label">${st.name}</div>`;
            dbTimes.forEach((time, idx) => {
                if ((st.name === "Info" || st.name === "PL") && idx === 2) return;
                const iso = getISOWeekAndYear(now);
                const key = `y${iso.year}w${iso.week}-${todayName}-${st.name}-${time}`;
                const val = data[key] || "";
                html += `<div class="shift-card ${val ? '' : 'empty'}">${val}</div>`;
            });
            html += `</div>`;
        });
        container.innerHTML = html;
    };
    loadData();
    setInterval(loadData, 15000);
}

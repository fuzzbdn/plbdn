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
let globalSettings = {}; // Håller koll på temat

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
    if (type === 'settings') globalSettings = data;

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
   3. TEMA-FUNKTIONER
   ========================================= */
function applyTheme(themeName) {
    // VIKTIGT: Vi applicerar BARA temat om vi är på display-sidan.
    // Admin-sidan ska alltid vara standard (Ljus).
    if (document.body.id !== 'page-display') return;

    const knownThemes = ['theme-dark', 'theme-jul', 'theme-pask', 'theme-matrix'];
    document.body.classList.remove(...knownThemes);
    
    if (themeName && themeName !== 'light') {
        document.body.classList.add(`theme-${themeName}`);
    }
}

function getISOWeekAndYear(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const week = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return { week: week, year: d.getFullYear() };
}

/* =========================================
   4. INITIERING
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const bodyId = document.body.id;

    if (bodyId === 'page-login') {
        initLogin();
        return;
    }

    // Ladda all data
    try {
        const [schedule, users, settings] = await Promise.all([
            fetchData('schedule'),
            fetchData('users'),
            fetchData('settings')
        ]);
        
        globalScheduleData = schedule || {};
        globalUserList = users || [];
        globalSettings = settings || { theme: 'light' };
        
        // Applicera temat direkt (men funktionen applyTheme stoppar det om vi är på Admin)
        if (globalSettings.theme) {
            applyTheme(globalSettings.theme);
        }
    } catch (err) {
        console.error("Init fel:", err);
    }

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
   5. ADMIN-LOGIK
   ========================================= */
function initAdmin() {
    const userDisplay = document.getElementById('currentUserDisplay');
    if (userDisplay) userDisplay.innerText = `Inloggad: ${sessionStorage.getItem('adminUser')}`;
    
    setupDatePicker();
    setupSidebarAddUser();
    initThemeSelector(); // Sätter upp dropdownen
    setupAdminManagement();

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = () => { sessionStorage.clear(); window.location.href = "index.html"; };
    
    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.onclick = printSchedule;
    
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.onclick = generateScheduleImage;
}

function setupDatePicker() {
    const picker = document.getElementById('adminDatePicker');
    const display = document.getElementById('currentDateDisplay');
    if (!picker) return;

    picker.value = new Date().toISOString().split('T')[0];

    const update = (dateStr) => {
        const d = new Date(dateStr);
        const iso = getISOWeekAndYear(d);
        
        selectedWeek = iso.week;
        selectedYear = iso.year;
        
        let dayIdx = d.getDay(); 
        currentAdminDayIndex = (dayIdx === 0) ? 6 : dayIdx - 1;
        
        if (display) display.innerText = `${days[currentAdminDayIndex]} vecka ${selectedWeek}, ${selectedYear}`;
        renderAdminGrid();
    };

    picker.addEventListener('change', (e) => update(e.target.value));
    update(picker.value);
}

function renderAdminGrid() {
    const container = document.getElementById('scheduleContainer');
    if (!container) return;
    
    renderRoster();
    const dayName = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-`;

    let html = `
        <div class="header-row">
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
   6. ROSTER & DATA
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
   7. TEMAVÄLJARE (Admin-sidan)
   ========================================= */
async function initThemeSelector() {
    const select = document.getElementById('themeSelect');
    const saveBtn = document.getElementById('saveThemeBtn');
    if (!select || !saveBtn) return;

    // Sätt dropdown till det nuvarande temat (så man ser vad som är aktivt)
    if (globalSettings.theme) {
        select.value = globalSettings.theme;
    }

    saveBtn.onclick = async () => {
        const theme = select.value;
        // Spara till databasen
        await saveData('settings', { theme: theme });
        
        // Vi kör INTE applyTheme() här, för vi vill inte ändra admin-sidan.
        // Display-sidan kommer plocka upp ändringen nästa gång den uppdaterar.
        
        const originalText = saveBtn.innerText;
        saveBtn.innerText = "Sparat till Display!";
        setTimeout(() => saveBtn.innerText = originalText, 2000);
    };
}

/* =========================================
   8. EXPORT
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
   9. AUTH & MISC
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
   10. DISPLAY (Visar temat)
   ========================================= */
function initDisplay() {
    setInterval(() => {
        const clock = document.getElementById('clock');
        if (clock) clock.innerText = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }, 1000);

    const loadData = async () => {
        const [data, settings] = await Promise.all([fetchData('schedule'), fetchData('settings')]);
        globalScheduleData = data;
        
        // HÄR applicerar vi temat, eftersom vi är på display-sidan
        if (settings && settings.theme) applyTheme(settings.theme);
        
        const now = new Date();
        const iso = getISOWeekAndYear(now);
        const todayName = days[now.getDay() === 0 ? 6 : now.getDay() - 1];
        
        const title = document.getElementById('mainTitle');
        if (title) {
            title.innerText = `Vi som jobbar ${todayName} ${now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' })} (v.${iso.week})`;
        }

        const container = document.getElementById('mainContainer');
        if (!container) return;

        let html = `<div class="time-header-row"><div></div>${displayTimes.map(t => `<div class="time-header">${t}</div>`).join('')}</div>`;

        stations.forEach(st => {
            html += `<div class="display-row ${st.class}"><div class="station-label">${st.name}</div>`;
            dbTimes.forEach((time, idx) => {
                if ((st.name === "Info" || st.name === "PL") && idx === 2) return;
                
                const key = `y${iso.year}w${iso.week}-${todayName}-${st.name}-${time}`;
                const val = data[key] || "";
                html += `<div class="shift-card ${val ? '' : 'empty'}">${val}</div>`;
            });
            html += `</div>`;
        });
        container.innerHTML = html;
    };
    
    loadData();
    setInterval(loadData, 15000); // Uppdaterar var 15:e sekund
}

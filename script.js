/* =========================================
   1. KONFIGURATION & DATA
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
   3. HJÄLPFUNKTIONER (DATUM & TEMA)
   ========================================= */
function getISOWeekAndYear(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const week = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return { week: week, year: d.getFullYear() };
}

function applyTheme(themeName) {
    const knownThemes = ['theme-dark', 'theme-jul', 'theme-pask', 'theme-matrix'];
    document.body.classList.remove(...knownThemes);
    if (themeName && themeName !== 'light') {
        document.body.classList.add(`theme-${themeName}`);
    }
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

    // Ladda data
    const [schedule, users, settings] = await Promise.all([
        fetchData('schedule'),
        fetchData('users'),
        fetchData('settings')
    ]);
    
    globalScheduleData = schedule;
    globalUserList = users;
    if (settings && settings.theme) applyTheme(settings.theme);

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

function initAdmin() {
    const userDisplay = document.getElementById('currentUserDisplay');
    if (userDisplay) userDisplay.innerText = `Inloggad: ${sessionStorage.getItem('adminUser')}`;
    
    setupDatePicker();
    setupSidebarAddUser();
    initThemeSelector();
    setupAdminManagement();

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            sessionStorage.clear();
            window.location.href = "index.html";
        };
    }
    
    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.onclick = printSchedule;
    
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.onclick = generateScheduleImage;
}

/* =========================================
   5. DATEPICKER & RENDERING
   ========================================= */
function setupDatePicker() {
    const picker = document.getElementById('adminDatePicker');
    const display = document.getElementById('currentDateDisplay');
    if (!picker) return;

    // Sätt dagens datum som standard
    picker.value = new Date().toISOString().split('T')[0];

    const update = (dateStr) => {
        const d = new Date(dateStr);
        const iso = getISOWeekAndYear(d);
        selectedWeek = iso.week;
        selectedYear = iso.year;
        currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
        
        if (display) {
            display.innerText = `${days[currentAdminDayIndex]} vecka ${selectedWeek}, ${selectedYear}`;
        }
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

function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if (!list) return;

    const used = new Set();
    const prefix = `y${selectedYear}w${selectedWeek}-${days[currentAdminDayIndex]}-`;
    Object.keys(globalScheduleData).forEach(key => {
        if (key.startsWith(prefix)) {
            const val = globalScheduleData[key];
            if (val) val.split(" / ").forEach(n => { if (n.trim()) used.add(n.trim()); });
        }
    });

    list.innerHTML = globalUserList.map(user => `
        <div class="draggable-item ${used.has(user) ? 'is-busy' : ''}" 
             draggable="true" 
             ondragstart="event.dataTransfer.setData('text/plain', '${user}')">
            <span>${user} ${used.has(user) ? '✓' : ''}</span>
            <button class="remove-user-btn" onclick="removeUser('${user}')">&times;</button>
        </div>
    `).join('');
}

/* =========================================
   6. INTERAKTION
   ========================================= */
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
    if (!btn) return;
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
   7. EXPORT
   ========================================= */
function getScheduleHtmlForPrint() {
    const datePicker = document.getElementById('adminDatePicker');
    const displayDate = datePicker ? new Date(datePicker.value).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' }) : "";
    
    const COLOR_MAP = {
        "color-bjorkliden": { solid: "#ffb300", trans: "rgba(255, 179, 0, 0.15)", text: "#000" },
        "color-kiruna":     { solid: "#fff176", trans: "rgba(255, 241, 118, 0.25)", text: "#000" },
        "color-bastutrask": { solid: "#e53935", trans: "rgba(229, 57, 53, 0.15)", text: "#fff" },
        "color-boden":      { solid: "#7cb342", trans: "rgba(124, 179, 66, 0.15)", text: "#fff" },
        "color-gallivare":  { solid: "#64b5f6", trans: "rgba(100, 181, 246, 0.15)", text: "#000" },
        "color-alvsbyn":    { solid: "#bdbdbd", trans: "rgba(189, 189, 189, 0.20)", text: "#000" },
        "color-info":       { solid: "#ec407a", trans: "rgba(236, 64, 122, 0.15)", text: "#fff" },
        "color-pl":         { solid: "#0277bd", trans: "rgba(2, 119, 189, 0.15)", text: "#fff" }
    };

    let html = `
        <div style="font-family: 'Inter', sans-serif; padding:20px; background:white; color:black;">
            <h1 style="text-align:center;">Vi som jobbar ${days[currentAdminDayIndex]} ${displayDate} (v.${selectedWeek})</h1>
            <div style="display:grid; grid-template-columns: 150px 1fr 1fr 1fr; gap:10px; font-weight:bold; text-align:center; margin-bottom:15px; border-bottom:2px solid #eee;">
                <div></div>${displayTimes.map(t => `<div>${t}</div>`).join('')}
            </div>
    `;

    stations.forEach(st => {
        const c = COLOR_MAP[st.class];
        html += `<div style="display:grid; grid-template-columns: 150px 1fr 1fr 1fr; gap:10px; margin-bottom:10px;">
            <div style="background:${c.solid}; color:${c.text}; padding:10px; border-radius:4px; font-weight:bold; text-align:center;">${st.name}</div>`;
        dbTimes.forEach((time, idx) => {
            if ((st.name === "Info" || st.name === "PL") && idx === 2) return;
            const key = `y${selectedYear}w${selectedWeek}-${days[currentAdminDayIndex]}-${st.name}-${time}`;
            const val = globalScheduleData[key] || "";
            html += `<div style="background:${val ? c.trans : '#fff'}; border:1px solid #eee; border-radius:4px; padding:10px; text-align:center; min-height:40px; color:black;">${val}</div>`;
        });
        html += `</div>`;
    });
    return html + `</div>`;
}

function printSchedule() {
    const container = document.getElementById('print-container');
    if (container) {
        container.innerHTML = getScheduleHtmlForPrint();
        window.print();
    }
}

function generateScheduleImage() {
    const btn = document.getElementById('exportBtn');
    const originalText = btn.innerText;
    btn.innerText = "Genererar...";
    
    const temp = document.createElement('div');
    Object.assign(temp.style, { position: 'absolute', top: '-9999px', width: '1200px', background: '#fff' });
    temp.innerHTML = getScheduleHtmlForPrint();
    document.body.appendChild(temp);

    html2canvas(temp, { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Schema-${days[currentAdminDayIndex]}-v${selectedWeek}.jpg`;
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        link.click();
        document.body.removeChild(temp);
        btn.innerText = originalText;
    }).catch(e => {
        console.error(e);
        btn.innerText = "Fel vid export";
    });
}

/* =========================================
   8. ADMIN TOOLS & AUTH
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
            } else { alert("Fel inloggning"); }
        } catch (e) { console.error(e); }
    };
    loginBtn.onclick = performLogin;
}

async function initThemeSelector() {
    const select = document.getElementById('themeSelect');
    const saveBtn = document.getElementById('saveThemeBtn');
    if (!select || !saveBtn) return;

    saveBtn.onclick = async () => {
        const theme = select.value;
        await saveData('settings', { theme });
        applyTheme(theme);
        saveBtn.innerText = "Sparat!";
        setTimeout(() => saveBtn.innerText = "Spara tema", 2000);
    };
}

function setupAdminManagement() {
    const adminBtn = document.getElementById('manageAdminsBtn');
    if (!adminBtn) return;
    adminBtn.onclick = async () => {
        const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) });
        const admins = await res.json();
        const action = prompt(`Admins:\n${admins.map(a => a.username).join('\n')}\n\nSkriv 'ny' eller 'radera'`);
        if (action === 'ny') {
            const username = prompt("Användarnamn:"), password = prompt("Lösenord:");
            await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', username, password }) });
        }
    };
}

/* =========================================
   9. DISPLAY
   ========================================= */
function initDisplay() {
    setInterval(() => {
        const clock = document.getElementById('clock');
        if (clock) clock.innerText = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }, 1000);

    const loadData = async () => {
        const [data, settings] = await Promise.all([fetchData('schedule'), fetchData('settings')]);
        globalScheduleData = data;
        if (settings && settings.theme) applyTheme(settings.theme);
        
        const now = new Date(), iso = getISOWeekAndYear(now);
        const todayName = days[now.getDay() === 0 ? 6 : now.getDay() - 1];
        
        const title = document.getElementById('mainTitle');
        if (title) title.innerText = `Vi som jobbar ${todayName} ${now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' })} (v.${iso.week})`;

        const container = document.getElementById('mainContainer');
        if (!container) return;

        let html = `<div class="time-header-row"><div></div>${displayTimes.map(t => `<div class="time-header">${t}</div>`).join('')}</div>`;

        stations.forEach(st => {
            html += `<div class="display-row ${st.class}"><div class="station-label">${st.name}</div>`;
            dbTimes.forEach((time, idx) => {
                if ((st.name === "Info" || st.name === "PL") && idx === 2) return;
                const key = `y${iso.year}w${iso.week}-${todayName}-${st.name}-${time}`, val = data[key] || "";
                html += `<div class="shift-card ${val ? '' : 'empty'}">${val}</div>`;
            });
            html += `</div>`;
        });
        container.innerHTML = html;
    };
    loadData();
    setInterval(loadData, 10000);
}

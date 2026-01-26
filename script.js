/* =========================================
   1. KONFIGURATION & VAR
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

// Hämta data (Kräver INGET lösenord - Publikt)
async function fetchData(type) {
    try {
        const res = await fetch(`/api/data-api?type=${type}`);
        if (!res.ok) throw new Error('Fetch failed');
        return await res.json();
    } catch (e) {
        console.error(e);
        return (type === 'users') ? [] : (type === 'settings' ? { theme: 'light' } : {});
    }
}

// Spara data (Kräver lösenord - Admin)
async function saveData(type, data) {
    // Spara lokalt först för snabb respons i UI
    if(type === 'schedule') globalScheduleData = data;
    
    const token = sessionStorage.getItem('authToken'); // Hämta sparad token
    if (!token) {
        alert("Du är utloggad. Logga in igen.");
        window.location.href = "index.html";
        return;
    }

    try {
        await fetch('/api/data-api', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // Skicka med lösenordet
            },
            body: JSON.stringify({ type, data })
        });
    } catch (e) {
        console.error("Save failed:", e);
        alert("Kunde inte spara till databasen.");
    }
}

/* =========================================
   3. TEMA-FUNKTIONER
   ========================================= */
function applyTheme(themeName) {
    // Admin-sidan ska ALLTID vara ljus/standard
    if (document.body.id === 'page-admin') return;

    const themes = ['theme-dark', 'theme-jul', 'theme-pask', 'theme-matrix'];
    document.body.classList.remove(...themes);
    if (themeName && themeName !== 'light') {
        document.body.classList.add(`theme-${themeName}`);
    }
}

/* =========================================
   4. INITIERING
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const pageId = document.body.id;

    if (pageId === 'page-login') {
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

    // Applicera tema (Display-sidan påverkas här)
    if (settings && settings.theme) applyTheme(settings.theme);

    if (pageId === 'page-admin') {
        if (!sessionStorage.getItem('authToken')) {
            window.location.href = "index.html";
            return;
        }
        initAdmin(settings);
    } else if (pageId === 'page-display') {
        initDisplay();
    }
});

/* =========================================
   5. LOGIN (INDEX.HTML)
   ========================================= */
function initLogin() {
    const btn = document.getElementById('loginBtn');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');

    const doLogin = async () => {
        const password = passIn.value.trim();
        const username = userIn.value.trim();
        
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'login', username, password })
        });
        
        const data = await res.json();
        if (data.success) {
            sessionStorage.setItem('authToken', password); // Spara token i minnet
            sessionStorage.setItem('adminUser', username);
            window.location.href = "admin.html";
        } else {
            alert("Fel lösenord!");
        }
    };

    if(btn) btn.onclick = doLogin;
    if(passIn) passIn.onkeydown = (e) => { if(e.key === 'Enter') doLogin(); };
}

/* =========================================
   6. ADMIN-SIDAN
   ========================================= */
function initAdmin(settings) {
    const userDisplay = document.getElementById('currentUserDisplay');
    if(userDisplay) userDisplay.innerText = "Inloggad: " + (sessionStorage.getItem('adminUser') || 'Admin');

    // Temaväljare
    const themeSelect = document.getElementById('themeSelect');
    const saveThemeBtn = document.getElementById('saveThemeBtn');
    
    // Sätt dropdown till nuvarande värde från DB
    if(themeSelect && settings?.theme) themeSelect.value = settings.theme;

    if(saveThemeBtn) {
        saveThemeBtn.onclick = async () => {
            const newTheme = themeSelect.value;
            await saveData('settings', { theme: newTheme });
            
            const oldText = saveThemeBtn.innerText;
            saveThemeBtn.innerText = "Sparat till DB!";
            setTimeout(() => saveThemeBtn.innerText = oldText, 2000);
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

    // Knappar
    document.getElementById('logoutBtn').onclick = () => {
        sessionStorage.clear();
        window.location.href = "index.html";
    };
    setupSidebarAddUser();
    
    // Export
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
            
            html += `<div class="shift-block ${val?'':'empty'}" 
                     ondragover="event.preventDefault()" 
                     ondrop="handleDrop(event, '${key}')">
                     <span class="shift-text" contenteditable="true" onblur="saveShift('${key}', this.innerText)">${val}</span>
                     ${val ? `<button class="clear-btn" onclick="saveShift('${key}', '')">&times;</button>` : ''}
                     </div>`;
        });
        html += `</div>`;
    });
    container.innerHTML = html;
}

/* =========================================
   7. DISPLAY-SIDAN
   ========================================= */
function initDisplay() {
    // Uppdatera klockan
    setInterval(() => {
        const el = document.getElementById('clock');
        if(el) el.innerText = new Date().toLocaleTimeString('sv-SE', {hour:'2-digit', minute:'2-digit'});
    }, 1000);

    const refreshData = async () => {
        // Hämta nytt data från databasen
        const [data, settings] = await Promise.all([
            fetchData('schedule'), 
            fetchData('settings')
        ]);
        
        globalScheduleData = data;
        
        // Uppdatera temat om det ändrats i DB
        if(settings && settings.theme) applyTheme(settings.theme);

        // Rendera schemat
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
    setInterval(refreshData, 10000); // Kollar databasen var 10:e sekund
}

/* =========================================
   HJÄLPFUNKTIONER
   ========================================= */
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

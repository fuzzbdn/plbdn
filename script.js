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
   3. HJÄLPFUNKTIONER
   ========================================= */
function getISOWeekAndYear(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const week = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return { week: week, year: d.getFullYear() };
}

function getUsedUsersForDay(dayName, prefix) {
    const used = new Set();
    const searchPrefix = prefix + dayName + "-";
    Object.keys(globalScheduleData).forEach(key => {
        if (key.startsWith(searchPrefix)) {
            const val = globalScheduleData[key];
            if (val) val.split(" / ").forEach(n => { if (n.trim()) used.add(n.trim()); });
        }
    });
    return used;
}

/* =========================================
   4. INITIERING & DATEPICKER
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const bodyId = document.body.id;

    if (bodyId === 'page-login') {
        initLogin();
        return;
    }

    [globalScheduleData, globalUserList] = await Promise.all([
        fetchData('schedule'),
        fetchData('users')
    ]);

    if (bodyId === 'page-admin') {
        if (sessionStorage.getItem('isLoggedIn') !== 'true') { window.location.href = "index.html"; return; }
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

    document.getElementById('logoutBtn').addEventListener('click', () => {
        sessionStorage.clear();
        window.location.href = "index.html";
    });
    document.getElementById('printBtn').addEventListener('click', printSchedule);
    document.getElementById('exportBtn').addEventListener('click', generateScheduleImage);
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
        currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
        if (display) display.innerText = `${days[currentAdminDayIndex]} vecka ${selectedWeek}, ${selectedYear}`;
        renderAdminGrid();
    };

    picker.addEventListener('change', (e) => update(e.target.value));
    update(picker.value);
}

/* =========================================
   5. RENDERING (ADMIN GRID & ROSTER)
   ========================================= */
function renderAdminGrid() {
    const container = document.getElementById('scheduleContainer');
    if (!container) return;
    
    renderRoster();
    const dayName = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-`;

    let html = `
        <div class="header-row">
            <div></div>
            ${dbTimes.map(t => `<div class="time-header-item">${t}</div>`).join('')}
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

    const used = getUsedUsersForDay(days[currentAdminDayIndex], `y${selectedYear}w${selectedWeek}-`);
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
   6. INTERAKTION (UPPDATERA, LÄGG TILL, TA BORT)
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
   7. EXPORT (BILD & UTSKRIFT)
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
        <div style="font-family: 'Inter', sans-serif; padding:20px;">
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
            const val = globalScheduleData[`y${selectedYear}w${selectedWeek}-${days[currentAdminDayIndex]}-${st.name}-${time}`] || "";
            html += `<div style="background:${val ? c.trans : '#fff'}; border:1px solid #eee; border-radius:4px; padding:10px; text-align:center; min-height:40px;">${val}</div>`;
        });
        html += `</div>`;
    });
    return html + `</div>`;
}

function printSchedule() {
    const container = document.getElementById('print-container');
    container.innerHTML = getScheduleHtmlForPrint();
    window.print();
}

function generateScheduleImage() {
    const btn = document.getElementById('exportBtn');
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
        btn.innerText = "📷 Spara som bild";
    });
}

/* =========================================
   8. ÖVRIG FUNKTIONALITET (LOGIN, TEMA, ADMINS)
   ========================================= */
// (Här inkluderar du dina befintliga initLogin, initThemeSelector, setupAdminManagement funktioner)

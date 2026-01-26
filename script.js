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
   2. DATA-API (SCHEMAN & PERSONAL)
   ========================================= */

async function fetchData(type) {
    if (!USE_CLOUD_DB) {
        let key = type === 'schedule' ? 'shiftData' : (type === 'users' ? 'userList' : 'siteSettings');
        const local = localStorage.getItem(key);
        return local ? JSON.parse(local) : (type === 'users' ? [] : {});
    }
    
    try {
        const response = await fetch(`/api/data-api?type=${type}`);
        if (!response.ok) throw new Error('Kunde inte hämta data');
        return await response.json();
    } catch (error) {
        console.error(`Fetch error (${type}):`, error);
        if (type === 'users') return [];
        if (type === 'settings') return { theme: 'light' };
        return {};
    }
}

async function saveData(type, data) {
    if (type === 'schedule') globalScheduleData = data;
    if (type === 'users') globalUserList = data;

    if (!USE_CLOUD_DB) {
        let key = type === 'schedule' ? 'shiftData' : (type === 'users' ? 'userList' : 'siteSettings');
        localStorage.setItem(key, JSON.stringify(data));
        return;
    }

    if (sessionStorage.getItem('isLoggedIn') !== 'true') {
        console.warn("Ej inloggad, sparar inte till molnet.");
        return;
    }

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
        alert("Kunde inte spara ändringar till servern.");
    }
}

/* =========================================
   3. HJÄLPFUNKTIONER
   ========================================= */
function getScheduleData() { return globalScheduleData; }
function getUsers() { return globalUserList; }

function getCurrentDayIndex() {
    let day = new Date().getDay(); 
    return day === 0 ? 6 : day - 1;
}

function getISOWeekAndYear(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const week = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return { week: week, year: d.getFullYear() };
}

function getUsedUsersForDay(dayName, prefix) {
    const data = getScheduleData();
    const used = new Set();
    const searchPrefix = prefix ? prefix + dayName + "-" : dayName + "-";

    Object.keys(data).forEach(key => {
        if (key.startsWith(searchPrefix)) {
            const val = data[key];
            if (val) {
                val.split(" / ").forEach(n => {
                    if (n.trim()) used.add(n.trim());
                });
            }
        }
    });
    return used;
}

/* =========================================
   4. INITIERING (MAIN ENTRY POINT)
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const bodyId = document.body.id;

    if (bodyId === 'page-login') {
        initLogin();
        return;
    }

    if (USE_CLOUD_DB) {
        try {
            [globalScheduleData, globalUserList] = await Promise.all([
                fetchData('schedule'),
                fetchData('users')
            ]);
        } catch (e) { console.log("Init data fetch failed"); }
    } else {
        globalScheduleData = await fetchData('schedule');
        globalUserList = await fetchData('users');
    }

    if (bodyId === 'page-admin') {
        if (sessionStorage.getItem('isLoggedIn') !== 'true') {
             window.location.href = "index.html"; 
             return;
        }
        initLogout(); 
        initAdmin();
        initThemeSelector(); 
        setupAdminManagement(); 
    } 
    else if (bodyId === 'page-display') {
        initDisplay();
    }
    
    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.addEventListener('click', printSchedule);

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', generateScheduleImage);
});

/* =========================================
   5. LOGIN & AUTH
   ========================================= */
function initLogin() {
    const loginBtn = document.getElementById('loginBtn');
    const usernameInput = document.getElementById('usernameInput'); 
    const passwordInput = document.getElementById('passwordInput');

    if (!loginBtn || !passwordInput || !usernameInput) return;

    const performLogin = async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        
        if (!username || !password) {
            alert("Ange både användarnamn och lösenord.");
            return;
        }

        const originalText = loginBtn.innerText;
        loginBtn.innerText = "Verifierar...";
        loginBtn.disabled = true;

        try {
            const response = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: 'login', 
                    username: username, 
                    password: password 
                })
            });

            const result = await response.json();

            if (result.success) {
                sessionStorage.setItem('adminUser', result.user);
                sessionStorage.setItem('isLoggedIn', 'true');
                window.location.href = "admin.html";
            } else {
                alert("Fel användarnamn eller lösenord!");
                passwordInput.value = "";
                passwordInput.style.borderColor = "#ff6b6b";
                setTimeout(() => passwordInput.style.borderColor = "#333", 1000);
            }

        } catch (error) {
            console.error("Login error:", error);
            alert("Kunde inte nå servern.");
        } finally {
            loginBtn.innerText = originalText;
            loginBtn.disabled = false;
        }
    };

    loginBtn.addEventListener('click', (e) => { e.preventDefault(); performLogin(); });
    passwordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') performLogin(); });
    usernameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') performLogin(); });
}

function initLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (!logoutBtn) return;

    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('isLoggedIn');
        sessionStorage.removeItem('adminUser');
        window.location.href = "index.html";
    });
}

/* =========================================
   6. ADMIN - FUNKTIONALITET
   ========================================= */

function setupAdminManagement() {
    const adminBtn = document.getElementById('manageAdminsBtn');
    if (!adminBtn) return;

    adminBtn.addEventListener('click', async () => {
        const currentUser = sessionStorage.getItem('adminUser');
        
        let admins = [];
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list' })
            });
            admins = await res.json();
        } catch(e) { 
            alert("Kunde inte hämta listan.");
            return;
        }
        
        let listString = admins.map(a => `- ${a.username}`).join('\n');
        let userAction = prompt(`HANTERA ADMINS:\n${listString}\n\nSkriv 'ny' för att skapa, 'radera' för att ta bort.`);

        if (!userAction) return;

        if (userAction.toLowerCase() === 'ny') {
            const newUser = prompt("Ange nytt användarnamn:");
            const newPass = prompt("Ange lösenord:");
            if (newUser && newPass) {
                const res = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'add', username: newUser, password: newPass })
                });
                const result = await res.json();
                if (result.success) alert(`Admin ${newUser} skapad!`);
                else alert("Kunde inte skapa. (Finns namnet redan?)");
            }
        } 
        else if (userAction.toLowerCase() === 'radera' || userAction.toLowerCase() === 'ta bort') {
            const delUser = prompt("Vilken användare ska tas bort?");
            if (delUser) {
                if (delUser.toLowerCase() === currentUser.toLowerCase()) {
                    alert("Du kan inte radera dig själv!");
                    return;
                }
                const res = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'remove', username: delUser })
                });
                if (res.ok) alert(`Admin ${delUser} borttagen.`);
                else alert("Kunde inte ta bort användaren.");
            }
        }
    });
}

window.onclick = function(event) {
    if (!event.target.closest('.dropdown-container')) closeAllDropdowns();
}

function closeAllDropdowns() {
    const dropdowns = document.getElementsByClassName("dropdown-menu");
    for (let i = 0; i < dropdowns.length; i++) {
        dropdowns[i].classList.remove('show');
    }
}

function initAdmin() {
    const userDisplay = document.getElementById('currentUserDisplay');
    const loggedInUser = sessionStorage.getItem('adminUser');
    
    if (userDisplay && loggedInUser) {
        userDisplay.innerText = `Inloggad: ${loggedInUser}`;
    }

    setupDatePicker(); 
    setupSidebarAddUser(); 
    renderAdminGrid();
}

function setupDatePicker() {
    const datePicker = document.getElementById('adminDatePicker');
    const dateDisplay = document.getElementById('currentDateDisplay');
    
    if (!datePicker) return;

    const today = new Date();
    datePicker.value = today.toISOString().split('T')[0];

    const updateFromPicker = (dateValue) => {
        const selectedDate = new Date(dateValue);
        const iso = getISOWeekAndYear(selectedDate);
        
        selectedWeek = iso.week;
        selectedYear = iso.year;
        
        let dayIdx = selectedDate.getDay(); 
        currentAdminDayIndex = (dayIdx === 0) ? 6 : dayIdx - 1;

        if (dateDisplay) {
            // Snyggare formatering för rubriken
            dateDisplay.innerHTML = `${days[currentAdminDayIndex]} <span style="color:#888; font-weight:400;">vecka ${selectedWeek}, ${selectedYear}</span>`;
        }

        renderAdminGrid();
    };

    datePicker.addEventListener('change', (e) => updateFromPicker(e.target.value));
    updateFromPicker(datePicker.value);
}

async function initThemeSelector() {
    const select = document.getElementById('themeSelect');
    const saveBtn = document.getElementById('saveThemeBtn');
    
    if (!select || !saveBtn) return;

    try {
        const settings = await fetchData('settings'); 
        if (settings && settings.theme) {
            select.value = settings.theme;
        }
    } catch(e) { }

    select.addEventListener('change', () => {
        saveBtn.innerText = "Spara tema";
        saveBtn.style.backgroundColor = ""; 
        saveBtn.style.color = "";
    });

    saveBtn.addEventListener('click', async () => {
        const newTheme = select.value;
        const currentSettings = (await fetchData('settings')) || {};
        
        currentSettings.theme = newTheme;
        await saveData('settings', currentSettings);
        
        saveBtn.innerText = "Sparat!";
        saveBtn.style.backgroundColor = "#4CAF50"; 
        saveBtn.style.color = "#fff";
        
        setTimeout(() => {
            if (saveBtn.innerText === "Sparat!") {
                saveBtn.innerText = "Spara tema";
                saveBtn.style.backgroundColor = "";
                saveBtn.style.color = "";
            }
        }, 2000);
    });
}

function setupSidebarAddUser() {
    const addBtn = document.getElementById('sidebarAddBtn');
    const input = document.getElementById('sidebarNewName');

    function addUser() {
        const name = input.value.trim();
        if (name) {
            let users = [...getUsers()]; 
            if (!users.some(u => u.toLowerCase() === name.toLowerCase())) {
                users.push(name);
                users.sort((a, b) => a.localeCompare(b, 'sv'));
                saveData('users', users);
                input.value = '';
                renderRoster(); 
            } else {
                alert('Namnet finns redan i listan!');
            }
        }
    }
    if (addBtn && input) {
        addBtn.onclick = addUser;
        input.onkeydown = (e) => { if (e.key === 'Enter') addUser(); };
    }
}

function renderRoster() {
    const listContainer = document.getElementById('draggableUserList');
    if (!listContainer) return; 
    
    listContainer.innerHTML = '';
    const allUsers = getUsers();
    
    const dayName = days[currentAdminDayIndex];
    const weekPrefix = `y${selectedYear}w${selectedWeek}-`;
    const usedUsers = getUsedUsersForDay(dayName, weekPrefix);

    if (allUsers.length === 0) {
        listContainer.innerHTML = '<div style="padding:10px; color:#888; font-size:0.9rem;">Listan är tom.</div>';
        return;
    }

    allUsers.forEach(user => {
        const isBusy = usedUsers.has(user);
        
        const div = document.createElement('div');
        div.className = `draggable-item ${isBusy ? 'is-busy' : ''}`;
        
        const nameSpan = document.createElement('span');
        nameSpan.innerText = user;
        if (isBusy) {
            div.title = "Redan inbokad denna dag";
            nameSpan.innerText += " ✓";
        }
        div.appendChild(nameSpan);

        const delBtn = document.createElement('button');
        delBtn.innerHTML = "&times;";
        delBtn.className = "remove-user-btn";
        delBtn.title = "Ta bort permanent";
        
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Ta bort ${user} permanent från listan?`)) {
                const newUsers = getUsers().filter(u => u !== user);
                saveData('users', newUsers);
                renderRoster(); 
            }
        };

        div.appendChild(delBtn);
        div.draggable = true; 

        div.ondragstart = (e) => {
            e.dataTransfer.setData("text/plain", user);
            e.dataTransfer.effectAllowed = "copy";
        };

        listContainer.appendChild(div);
    });
}

function renderAdminGrid() {
    const container = document.getElementById('scheduleContainer');
    if (!container) return;
    container.innerHTML = '';
    
    renderRoster(); 

    const scheduleData = getScheduleData();
    const dayName = days[currentAdminDayIndex];
    const weekPrefix = `y${selectedYear}w${selectedWeek}-`;

    const headerRow = document.createElement('div');
    headerRow.className = 'header-row';
    headerRow.innerHTML = '<div>Station</div>';
    dbTimes.forEach(time => {
        const th = document.createElement('div');
        th.innerText = time;
        headerRow.appendChild(th);
    });
    container.appendChild(headerRow);

    stations.forEach(station => {
        const row = document.createElement('div');
        row.className = `station-row ${station.class}`;
        
        const label = document.createElement('div');
        label.className = 'station-label';
        label.innerText = station.name;
        row.appendChild(label);

        dbTimes.forEach((time, index) => {
            if ((station.name === "Info" || station.name === "PL") && index === 2) return; 

            const block = document.createElement('div');
            block.className = 'shift-block'; 
            
            const key = `${weekPrefix}${dayName}-${station.name}-${time}`;
            const currentText = scheduleData[key] || "";
            if (!currentText.trim()) block.classList.add('empty');

            // Innehåll för rutan
            block.innerHTML = `
                <div class="shift-text" contenteditable="true">${currentText}</div>
                <div class="admin-tools">
                    <button class="clear-btn" title="Rensa">&times;</button>
                </div>
            `;
            
            // Logik för editering och rensning (Behåll din befintliga event-logik här)
            // ...
            
            row.appendChild(block);
        });
        container.appendChild(row);
    });
}
/* =========================================
   7. DISPLAY LOGIK
   ========================================= */
function initDisplay() {
    updateClock();
    loadDisplayData();
    updateDisplayTheme(); 

    setInterval(updateClock, 60000);
    
    if (USE_CLOUD_DB) {
        setInterval(async () => {
            try {
                globalScheduleData = await fetchData('schedule');
                loadDisplayData();
                updateDisplayTheme(); 
            } catch (e) { console.error("Update fail", e); }
        }, 10000); 
    }
}

async function updateDisplayTheme() {
    try {
        const settings = await fetchData('settings');
        const activeTheme = (settings && settings.theme) ? settings.theme : 'light';
        const knownThemes = ['theme-dark', 'theme-jul', 'theme-pask', 'theme-matrix'];
        
        const body = document.body;
        knownThemes.forEach(themeClass => body.classList.remove(themeClass));

        if (activeTheme !== 'light') {
            body.classList.add(`theme-${activeTheme}`);
        }
    } catch (e) { console.error("Kunde inte hämta tema", e); }
}

function updateClock() {
    const clockEl = document.getElementById('clock');
    if (clockEl) {
        clockEl.innerText = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }
}

function loadDisplayData() {
    let todayIndex = getCurrentDayIndex();
    if (todayIndex < 0) todayIndex = 0; 
    const todayName = days[todayIndex];
    const data = getScheduleData();
    const now = new Date();
    const iso = getISOWeekAndYear(now);
    const container = document.getElementById('mainContainer');
    if (!container) return;
    
    const titleEl = document.getElementById('mainTitle');
    if (titleEl) {
        titleEl.innerText = `Vi som jobbar ${todayName} ${now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' })} (v.${iso.week})`;
    }
    
    container.innerHTML = '';
    const headerRow = document.createElement('div');
    headerRow.className = 'time-header-row';
    headerRow.appendChild(document.createElement('div')); 
    displayTimes.forEach(t => {
        const div = document.createElement('div');
        div.className = 'time-header';
        div.innerText = t;
        headerRow.appendChild(div);
    });
    container.appendChild(headerRow);

    stations.forEach(station => {
        const row = document.createElement('div');
        row.className = `display-row ${station.class}`;
        const stDiv = document.createElement('div');
        stDiv.className = 'station-label'; 
        stDiv.innerText = station.name;
        row.appendChild(stDiv);

        dbTimes.forEach((dbTime, index) => {
            if ((station.name === "Info" || station.name === "PL") && index === 2) return;
            const key = `y${iso.year}w${iso.week}-${todayName}-${station.name}-${dbTime}`;
            const name = data[key];
            const card = document.createElement('div');
            card.className = 'shift-card'; 
            if (!name || !name.trim()) card.classList.add('empty');
            else card.innerText = name;
            row.appendChild(card);
        });
        container.appendChild(row);
    });
}

/* =========================================
   8. EXPORT & UTSKRIFT
   ========================================= */

function printSchedule() {
    let printContainer = document.getElementById('print-container');
    if (!printContainer) {
        printContainer = document.createElement('div');
        printContainer.id = 'print-container';
        document.body.appendChild(printContainer);
    }
    printContainer.innerHTML = getScheduleHtmlForPrint();
    window.print();
}

function generateScheduleImage() {
    const exportBtn = document.getElementById('exportBtn');
    const originalText = exportBtn.innerText;
    exportBtn.innerText = "Genererar bild..."; 

    const tempContainer = document.createElement('div');
    tempContainer.id = "temp-export-container";
    Object.assign(tempContainer.style, {
        position: 'absolute', top: '-9999px', left: '0', width: '1600px', 
        backgroundColor: '#fff', padding: '40px', fontFamily: "'Inter', sans-serif"
    });

    tempContainer.innerHTML = getScheduleHtmlForPrint();
    document.body.appendChild(tempContainer);

    if (typeof html2canvas === 'undefined') {
        alert("html2canvas saknas.");
        exportBtn.innerText = originalText;
        return;
    }

    html2canvas(tempContainer, { scale: 2, useCORS: true }).then(canvas => {
        const activeDayName = days[currentAdminDayIndex];
        const link = document.createElement('a');
        link.download = `Schema-${activeDayName}-v${selectedWeek}.jpg`; 
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        link.click();
        
        document.body.removeChild(tempContainer);
        exportBtn.innerText = originalText;
    }).catch(err => {
        console.error("Kunde inte skapa bild:", err);
        if(document.body.contains(tempContainer)) document.body.removeChild(tempContainer);
        exportBtn.innerText = originalText;
    });
}

function getScheduleHtmlForPrint() {
    const activeDayIndex = currentAdminDayIndex; 
    const activeDayName = days[activeDayIndex];
    const datePicker = document.getElementById('adminDatePicker');
    const displayDate = datePicker ? new Date(datePicker.value).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' }) : "";
    
    // Korrigerad färgkarta som matchar admin.css/style.css exakt
    const COLOR_MAP = {
        "color-bjorkliden": { solid: "#ffb300", transparent: "rgba(255, 179, 0, 0.15)", border: "rgba(255, 179, 0, 0.6)", text: "#000" },
        "color-kiruna":     { solid: "#fff176", transparent: "rgba(255, 241, 118, 0.25)", border: "rgba(255, 241, 118, 0.8)", text: "#000" },
        "color-bastutrask": { solid: "#e53935", transparent: "rgba(229, 57, 53, 0.15)", border: "rgba(229, 57, 53, 0.6)", text: "#000" },
        "color-boden":      { solid: "#7cb342", transparent: "rgba(124, 179, 66, 0.15)", border: "rgba(124, 179, 66, 0.6)", text: "#000" },
        "color-gallivare":  { solid: "#64b5f6", transparent: "rgba(100, 181, 246, 0.15)", border: "rgba(100, 181, 246, 0.6)", text: "#000" },
        "color-alvsbyn":    { solid: "#bdbdbd", transparent: "rgba(189, 189, 189, 0.20)", border: "rgba(189, 189, 189, 0.6)", text: "#000" },
        "color-info":       { solid: "#ec407a", transparent: "rgba(236, 64, 122, 0.15)", border: "rgba(236, 64, 122, 0.6)", text: "#000" },
        "color-pl":         { solid: "#0277bd", transparent: "rgba(2, 119, 189, 0.15)", border: "rgba(2, 119, 189, 0.6)", text: "#fff" }
    };

    const mainTitleText = `Vi som jobbar ${activeDayName} ${displayDate} (v.${selectedWeek})`;

    let htmlContent = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; font-family: 'Inter', sans-serif;">
            <h1 style="font-size:2.2rem; color:#222; margin:0;">${mainTitleText}</h1>
        </div>
        <div style="display:grid; grid-template-columns: 150px 1fr 1fr 1fr; gap:10px; margin-bottom:10px; padding-bottom:5px; border-bottom:2px solid #eee; font-weight:bold; text-align:center; font-family: 'Inter', sans-serif;">
            <div></div>
            ${displayTimes.map(t => `<div>${t}</div>`).join('')}
        </div>
    `;

    const scheduleData = getScheduleData();
    const weekPrefix = `y${selectedYear}w${selectedWeek}-`; 

    stations.forEach(station => {
        const color = COLOR_MAP[station.class] || { solid: "#666", transparent: "#eee", border: "#ccc", text: "#000" };
        const isInfo = station.name === 'Info';
        const rowStyle = isInfo ? 'margin-top:50px;' : '';

        const labelStyle = `
            background-color: ${color.solid}; color: ${color.text}; 
            font-weight: bold; padding: 10px; border-radius: 4px;
            display:flex; align-items:center; justify-content:center;
            min-height:50px; text-shadow: 0 1px 1px rgba(0,0,0,0.1);
            font-family: 'Inter', sans-serif;
        `;
        
        htmlContent += `
            <div style="display:grid; grid-template-columns: 150px 1fr 1fr 1fr; gap:10px; margin-bottom:10px; ${rowStyle}">
                <div style="${labelStyle}">${station.name}</div>
        `;

        dbTimes.forEach((dbTime, index) => {
            const isTwoColStation = (station.name === "Info" || station.name === "PL");
            if (isTwoColStation && index === 2) return; 

            const key = `${weekPrefix}${activeDayName}-${station.name}-${dbTime}`;
            const name = scheduleData[key] || "";
            const isEmpty = (!name || name.trim() === "");

            let cardStyle = `
                display:flex; align-items:center; justify-content:center; text-align:center; 
                min-height:50px; border-radius:4px; padding:10px; font-weight:bold; font-size:1.1rem;
                font-family: 'Inter', sans-serif;
            `;

            if (isEmpty) {
                cardStyle += `background-color: #fff; border: 1px solid #eee;`;
            } else {
                cardStyle += `background-color: ${color.transparent}; border: 1px solid ${color.border}; color: #000;`;
            }

            htmlContent += `<div style="${cardStyle}">${name}</div>`;
        });
        htmlContent += `</div>`; 
    });
    
    return htmlContent;
}


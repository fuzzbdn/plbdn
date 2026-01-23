/* =========================================
   1. KONFIGURATION & DATA
   ========================================= */
// Sätt till true för att använda databasen (Vercel + Neon)
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

let globalScheduleData = {};
let globalUserList = [];

/* =========================================
   2. API & DATABAS (VERCEL + NEON + LOCALSTORAGE)
   ========================================= */

async function fetchData(type) {
    // Hantera LocalStorage (om moln-DB är avstängd)
    if (!USE_CLOUD_DB) {
        let key = '';
        let defaultVal = {};
        
        if (type === 'schedule') { key = 'shiftData'; defaultVal = {}; }
        else if (type === 'users') { key = 'userList'; defaultVal = []; }
        else if (type === 'settings') { key = 'siteSettings'; defaultVal = { theme: 'light' }; } 

        const local = localStorage.getItem(key);
        return local ? JSON.parse(local) : defaultVal;
    }
    
    // Hantera Cloud DB
    try {
        const response = await fetch(`/api/data-api?type=${type}`);
        if (!response.ok) throw new Error('Kunde inte hämta data');
        return await response.json();
    } catch (error) {
        console.error(`Fetch error (${type}):`, error);
        if (type === 'users') return [];
        if (type === 'settings') return { theme: 'light' }; // Fallback
        return {};
    }
}

async function saveData(type, data) {
    // Uppdatera globala variabler direkt för snabb UI-respons
    if (type === 'schedule') globalScheduleData = data;
    if (type === 'users') globalUserList = data;

    // Hantera LocalStorage
    if (!USE_CLOUD_DB) {
        let key = '';
        if (type === 'schedule') key = 'shiftData';
        else if (type === 'users') key = 'userList';
        else if (type === 'settings') key = 'siteSettings'; 

        localStorage.setItem(key, JSON.stringify(data));
        return;
    }

    // Hantera Cloud DB
    const password = sessionStorage.getItem('adminPassword');
    
    if (!password) {
        alert("Du måste logga in igen!");
        window.location.href = "index.html";
        return;
    }

    try {
        const response = await fetch('/api/data-api', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${password}`
            },
            body: JSON.stringify({ type: type, data: data })
        });

        if (!response.ok) {
            if (response.status === 401) alert("Fel lösenord! Logga in på nytt.");
            else throw new Error("Serverfel vid sparning");
        }

    } catch (e) {
        console.error("Save failed", e);
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
   4. INITIERING
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const bodyId = document.body.id;

    if (bodyId === 'page-login') {
        initLogin();
        return;
    }

    // Hämta grunddata (schema + användare)
    if (USE_CLOUD_DB) {
        try {
            [globalScheduleData, globalUserList] = await Promise.all([
                fetchData('schedule'),
                fetchData('users')
            ]);
        } catch (e) {
            console.log("Kunde inte hämta initial data.");
        }
    } else {
        globalScheduleData = await fetchData('schedule');
        globalUserList = await fetchData('users');
    }

    if (bodyId === 'page-admin') {
        initLogout(); 
        if (USE_CLOUD_DB && !sessionStorage.getItem('adminPassword')) {
             window.location.href = "index.html";
             return;
        }
        initAdmin();
        initThemeSelector(); // Starta tema-väljaren
    } else if (bodyId === 'page-display') {
        initDisplay();
    }
    
    // Koppla knappar
    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.addEventListener('click', printSchedule);

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', generateScheduleImage);
});

/* =========================================
   5. LOGIN & LOGOUT
   ========================================= */
function initLogin() {
    const loginBtn = document.getElementById('loginBtn');
    const passwordInput = document.getElementById('passwordInput');

    if (!loginBtn || !passwordInput) return;

    const performLogin = async () => {
        const password = passwordInput.value.trim();
        
        if (!password) {
            passwordInput.style.borderColor = "#ff6b6b";
            setTimeout(() => passwordInput.style.borderColor = "#eee", 500);
            return;
        }

        const originalText = loginBtn.innerText;
        loginBtn.innerText = "Kontrollerar...";
        loginBtn.disabled = true;

        try {
            const response = await fetch('/api/data-api', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${password}`
                },
                body: JSON.stringify({ type: 'verify', data: {} })
            });

            if (response.ok) {
                sessionStorage.setItem('adminPassword', password);
                window.location.href = "admin.html";
            } else {
                alert("Fel lösenord!");
                passwordInput.value = "";
                passwordInput.focus();
                passwordInput.style.borderColor = "#ff6b6b";
            }
        } catch (error) {
            console.error("Login error:", error);
            alert("Kunde inte nå servern. Kontrollera din anslutning.");
        } finally {
            loginBtn.innerText = originalText;
            loginBtn.disabled = false;
        }
    };

    loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        performLogin();
    });

    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performLogin();
    });
}

function initLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (!logoutBtn) return;

    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('adminPassword');
        window.location.href = "index.html";
    });
}

/* =========================================
   6. ADMIN LOGIK
   ========================================= */
let currentAdminDayIndex = getCurrentDayIndex();
if (currentAdminDayIndex < 0) currentAdminDayIndex = 0; 

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
    const now = new Date();
    const iso = getISOWeekAndYear(now);
    selectedWeek = iso.week;
    selectedYear = iso.year;

    setupWeekNav();
    setupSidebarAddUser();
    renderNav();
    renderAdminGrid();
}

/* --- TEMA-VÄLJARE (ADMIN) --- */
/* Ersätt hela funktionen initThemeSelector i script.js med denna */

async function initThemeSelector() {
    const select = document.getElementById('themeSelect');
    const saveBtn = document.getElementById('saveThemeBtn');
    
    if (!select || !saveBtn) return;

    // 1. Hämta nuvarande inställning och visa i listan
    try {
        const settings = await fetchData('settings'); 
        if (settings && settings.theme) {
            select.value = settings.theme;
        }
    } catch(e) { console.log("Inga sparade inställningar än"); }

    // 2. Koppla sparandet till KNAPPEN (click) istället för listan
    saveBtn.addEventListener('click', async () => {
        const newTheme = select.value;
        const currentSettings = (await fetchData('settings')) || {};
        
        // Uppdatera objektet
        currentSettings.theme = newTheme;
        
        // Spara till databasen
        await saveData('settings', currentSettings);
        
        // Visuell feedback på knappen
        const originalText = saveBtn.innerText;
        saveBtn.innerText = "Sparat!";
        saveBtn.style.backgroundColor = "#4CAF50"; // Grön färg
        saveBtn.style.color = "#fff";
        
        setTimeout(() => {
            saveBtn.innerText = originalText;
            saveBtn.style.backgroundColor = ""; // Återgå till original
            saveBtn.style.color = "";
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
                alert('Namnet finns redan!');
            }
        }
    }
    if (addBtn && input) {
        addBtn.onclick = addUser;
        input.onkeydown = (e) => { if (e.key === 'Enter') addUser(); };
    }
}

function setupWeekNav() {
    const prevBtn = document.getElementById('prevWeekBtn');
    const nextBtn = document.getElementById('nextWeekBtn');
    const display = document.getElementById('currentWeekDisplay');

    if (!prevBtn || !nextBtn || !display) return;

    function updateDisplay() {
        display.innerText = `Vecka ${selectedWeek}, ${selectedYear}`;
        const dateDisplay = document.getElementById('currentDateDisplay');
        if (dateDisplay) dateDisplay.innerText = `Redigerar: ${days[currentAdminDayIndex]} (v.${selectedWeek})`;
    }

    prevBtn.onclick = () => {
        if (selectedWeek === 1) { selectedYear--; selectedWeek = 52; } else { selectedWeek--; }
        updateDisplay(); renderAdminGrid();
    };

    nextBtn.onclick = () => {
        if (selectedWeek >= 52) { selectedYear++; selectedWeek = 1; } else { selectedWeek++; }
        updateDisplay(); renderAdminGrid();
    };
    updateDisplay();
}

function renderNav() {
    const nav = document.getElementById('weekNav');
    if (!nav) return;
    nav.innerHTML = '';
    days.forEach((day, idx) => {
        const btn = document.createElement('button');
        btn.className = `day-btn ${idx === currentAdminDayIndex ? 'active' : ''}`;
        btn.innerText = day;
        btn.onclick = () => { currentAdminDayIndex = idx; renderNav(); renderAdminGrid(); };
        nav.appendChild(btn);
    });
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
            const newUsers = getUsers().filter(u => u !== user);
            saveData('users', newUsers);
            renderRoster(); 
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
    const allUsers = getUsers();
    const dayName = days[currentAdminDayIndex];
    const weekPrefix = `y${selectedYear}w${selectedWeek}-`;
    const usedUsersSet = getUsedUsersForDay(dayName, weekPrefix);

    const headerRow = document.createElement('div');
    headerRow.className = 'header-row';
    headerRow.appendChild(document.createElement('div')); 
    dbTimes.forEach(time => {
        const th = document.createElement('div');
        th.className = 'time-header-item';
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
            const isTwoColStation = (station.name === "Info" || station.name === "PL");
            if (isTwoColStation && index === 2) return; 

            const block = document.createElement('div');
            block.className = 'shift-block'; 
            
            const key = `${weekPrefix}${dayName}-${station.name}-${time}`;
            const currentText = scheduleData[key] || "";
            if (!currentText.trim()) block.classList.add('empty');

            block.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; block.classList.add('drag-over'); };
            block.ondragleave = () => { block.classList.remove('drag-over'); };
            block.ondrop = (e) => {
                e.preventDefault();
                block.classList.remove('drag-over');
                const droppedName = e.dataTransfer.getData("text/plain");
                if (droppedName) {
                    let newVal = currentText.trim();
                    if (newVal === "" || newVal === droppedName) newVal = droppedName;
                    else if (!newVal.includes(droppedName)) newVal += " / " + droppedName;
                    else return;
                    
                    scheduleData[key] = newVal;
                    saveData('schedule', scheduleData);
                    renderAdminGrid(); 
                }
            };

            const textSpan = document.createElement('span');
            textSpan.className = 'shift-text';
            textSpan.innerText = currentText;
            textSpan.contentEditable = "true";
            
            textSpan.onblur = (e) => {
                const newText = e.target.innerText.trim();
                if (newText === currentText) return;

                const namesInBox = newText.split('/').map(n => n.trim()).filter(n => n.length > 0);
                let currentUsersList = [...getUsers()];
                let usersUpdated = false;

                namesInBox.forEach(name => {
                    const exists = currentUsersList.some(u => u.toLowerCase() === name.toLowerCase());
                    if (!exists) {
                        currentUsersList.push(name);
                        usersUpdated = true;
                    }
                });

                if (usersUpdated) {
                    currentUsersList.sort((a, b) => a.localeCompare(b, 'sv'));
                    saveData('users', currentUsersList);
                }

                scheduleData[key] = newText;
                saveData('schedule', scheduleData);
                renderAdminGrid(); 
            };

            textSpan.onkeydown = (e) => { 
                if (e.key === 'Enter') { 
                    e.preventDefault(); 
                    e.target.blur(); 
                } 
            };
            
            block.appendChild(textSpan);

            const toolsDiv = document.createElement('div');
            toolsDiv.className = 'admin-tools';
            const availableUsers = allUsers.filter(u => !usedUsersSet.has(u));
            
            if (availableUsers.length > 0) {
                const ddContainer = document.createElement('div');
                ddContainer.className = 'dropdown-container';
                const btn = document.createElement('button');
                btn.className = 'dropdown-btn';
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
                const menu = document.createElement('div');
                menu.className = 'dropdown-menu';
                availableUsers.forEach(u => {
                    const item = document.createElement('div');
                    item.className = 'dropdown-item';
                    item.innerText = u;
                    item.onclick = () => {
                        let ns = textSpan.innerText.trim(); 
                        ns = ns === "" ? u : ns + " / " + u;
                        scheduleData[key] = ns;
                        saveData('schedule', scheduleData);
                        renderAdminGrid();
                    };
                    menu.appendChild(item);
                });
                btn.onclick = (e) => { e.stopPropagation(); closeAllDropdowns(); menu.classList.toggle('show'); };
                ddContainer.appendChild(btn);
                ddContainer.appendChild(menu);
                toolsDiv.appendChild(ddContainer);
            }

            if (currentText !== "") {
                const clearBtn = document.createElement('button');
                clearBtn.className = 'clear-btn';
                clearBtn.innerHTML = "&times;";
                clearBtn.onclick = () => {
                    scheduleData[key] = "";
                    saveData('schedule', scheduleData);
                    renderAdminGrid();
                };
                toolsDiv.appendChild(clearBtn);
            }
            block.appendChild(toolsDiv);
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
    updateDisplayTheme(); // Hämta tema direkt vid start

    setInterval(updateClock, 60000);
    
    if (USE_CLOUD_DB) {
        setInterval(async () => {
            try {
                globalScheduleData = await fetchData('schedule');
                loadDisplayData();
                updateDisplayTheme(); // Kolla tema vid varje uppdatering
            } catch (e) { console.error("Update fail", e); }
        }, 10000); 
    }
}

/* --- UPPDATERAD FUNKTION: HANTERA ALLA TEMAN (JUL, PÅSK, MATRIX ETC) --- */
async function updateDisplayTheme() {
    try {
        const settings = await fetchData('settings');
        // Standard är 'light'
        const activeTheme = (settings && settings.theme) ? settings.theme : 'light';
        
        // Lista på alla kända tema-klasser för att kunna rensa bort gamla
        const knownThemes = ['theme-dark', 'theme-jul', 'theme-pask', 'theme-matrix'];
        
        const body = document.body;

        // 1. Rensa bort alla gamla teman
        knownThemes.forEach(themeClass => {
            body.classList.remove(themeClass);
        });

        // 2. Lägg till det aktiva temat (om det inte är light som är standard)
        if (activeTheme !== 'light') {
            body.classList.add(`theme-${activeTheme}`);
        }

    } catch (e) {
        console.error("Kunde inte hämta tema", e);
    }
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
    const now = new Date();
    
    const COLOR_MAP = {
        "color-bjorkliden": { solid: "#43a047", transparent: "rgba(67, 160, 71, 0.4)", border: "rgba(67, 160, 71, 0.6)" },
        "color-kiruna":     { solid: "#546e7a", transparent: "rgba(84, 110, 122, 0.4)", border: "rgba(84, 110, 122, 0.6)" },
        "color-bastutrask": { solid: "#d81b60", transparent: "rgba(216, 27, 96, 0.4)", border: "rgba(216, 27, 96, 0.6)" },
        "color-boden":      { solid: "#fb8c00", transparent: "rgba(251, 140, 0, 0.4)", border: "rgba(251, 140, 0, 0.6)" },
        "color-gallivare":  { solid: "#8e24aa", transparent: "rgba(142, 36, 170, 0.4)", border: "rgba(142, 36, 170, 0.6)" },
        "color-alvsbyn":    { solid: "#039be5", transparent: "rgba(3, 155, 229, 0.4)", border: "rgba(3, 155, 229, 0.6)" },
        "color-info":       { solid: "#00acc1", transparent: "rgba(0, 172, 193, 0.4)", border: "rgba(0, 172, 193, 0.6)" },
        "color-pl":         { solid: "#3949ab", transparent: "rgba(57, 73, 171, 0.4)", border: "rgba(57, 73, 171, 0.6)" }
    };

    const dateFormatted = now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' });
    const mainTitleText = `Vi som jobbar ${activeDayName} ${dateFormatted} (v.${selectedWeek})`;

    let htmlContent = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <h1 style="font-size:2.2rem; color:#222; margin:0;">${mainTitleText}</h1>
        </div>
        <div style="display:grid; grid-template-columns: 150px 1fr 1fr 1fr; gap:10px; margin-bottom:10px; padding-bottom:5px; border-bottom:2px solid #eee; font-weight:bold; text-align:center;">
            <div></div>
            ${displayTimes.map(t => `<div>${t}</div>`).join('')}
        </div>
    `;

    const scheduleData = getScheduleData();
    const weekPrefix = `y${selectedYear}w${selectedWeek}-`; 

    stations.forEach(station => {
        const color = COLOR_MAP[station.class] || { solid: "#666", transparent: "#eee", border: "#ccc" };
        const isInfo = station.name === 'Info';
        const rowStyle = isInfo ? 'margin-top:50px;' : '';

        const labelStyle = `
            background-color: ${color.solid}; color: #fff; 
            font-weight: bold; padding: 10px; border-radius: 4px;
            display:flex; align-items:center; justify-content:center;
            min-height:50px;
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




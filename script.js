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

// Lokala variabler
let globalScheduleData = {};
let globalUserList = [];

/* =========================================
   2. API & DATABAS (VERCEL + NEON)
   ========================================= */

async function fetchData(type) {
    if (!USE_CLOUD_DB) {
        const key = type === 'schedule' ? 'shiftData' : 'userList';
        const local = localStorage.getItem(key);
        return local ? JSON.parse(local) : (type === 'users' ? [] : {});
    }
    
    try {
        // Anropa Vercel API
        const response = await fetch(`/api/data-api?type=${type}`);
        if (!response.ok) throw new Error('Kunde inte hämta data');
        return await response.json();
    } catch (error) {
        console.error("Fetch error:", error);
        return type === 'users' ? [] : {};
    }
}

async function saveData(type, data) {
    // 1. Uppdatera minnet direkt
    if (type === 'schedule') globalScheduleData = data;
    if (type === 'users') globalUserList = data;

    // 2. Spara lokalt om Cloud är avstängt
    if (!USE_CLOUD_DB) {
        const key = type === 'schedule' ? 'shiftData' : 'userList';
        localStorage.setItem(key, JSON.stringify(data));
        return;
    }

    // 3. Hämta lösenordet från session (satt vid inloggning)
    const password = sessionStorage.getItem('adminPassword');
    
    if (!password) {
        alert("Du måste logga in igen!");
        window.location.href = "index.html";
        return;
    }

    try {
        // Skicka till Vercel API
        const response = await fetch('/api/data-api', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${password}` // Skicka lösenordet
            },
            body: JSON.stringify({ type: type, data: data })
        });

        if (!response.ok) {
            if (response.status === 401) alert("Fel lösenord! Logga in på nytt.");
            else throw new Error("Serverfel vid sparning");
        }

    } catch (e) {
        console.error("Save failed", e);
        alert("Kunde inte spara till databasen.");
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

    // Hämta data
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
        globalScheduleData = JSON.parse(localStorage.getItem('shiftData')) || {};
        globalUserList = JSON.parse(localStorage.getItem('userList')) || [];
    }

    if (bodyId === 'page-admin') {
        // Enkel koll att man loggat in
        if (USE_CLOUD_DB && !sessionStorage.getItem('adminPassword')) {
             window.location.href = "index.html";
             return;
        }
        initAdmin();
    } else if (bodyId === 'page-display') {
        initDisplay();
    }
});

/* =========================================
   5. LOGIN LOGIK
   ========================================= */
function initLogin() {
    const loginBtn = document.getElementById('loginBtn');
    if (!loginBtn) return;

    loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const password = prompt("Ange admin-lösenord:");
        if (password) {
            sessionStorage.setItem('adminPassword', password);
            window.location.href = "admin.html";
        }
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
        nameSpan.innerText = user + (isBusy ? " ✓" : "");
        if (isBusy) div.title = "Redan inbokad denna dag";
        div.appendChild(nameSpan);

        const delBtn = document.createElement('button');
        delBtn.innerHTML = "&times;";
        delBtn.className = "remove-user-btn";
        delBtn.title = "Ta bort permanent";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if(confirm(`Ta bort ${user}?`)) {
                saveData('users', getUsers().filter(u => u !== user));
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
    
    renderRoster(); // Uppdatera sidomenyn

    const scheduleData = getScheduleData();
    const allUsers = getUsers();
    const dayName = days[currentAdminDayIndex];
    const weekPrefix = `y${selectedYear}w${selectedWeek}-`;
    const usedUsersSet = getUsedUsersForDay(dayName, weekPrefix);

    // --- Header Raden (Tider) ---
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

    // --- Stationsrader ---
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
            
            // Unikt ID för just denna ruta
            const key = `${weekPrefix}${dayName}-${station.name}-${time}`;
            const currentText = scheduleData[key] || "";
            
            if (!currentText.trim()) block.classList.add('empty');

            // --- Drag & Drop Logik ---
            block.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; block.classList.add('drag-over'); };
            block.ondragleave = () => { block.classList.remove('drag-over'); };
            block.ondrop = (e) => {
                e.preventDefault();
                block.classList.remove('drag-over');
                const droppedName = e.dataTransfer.getData("text/plain");
                if (droppedName) {
                    let newVal = currentText.trim();
                    // Lägg till med / om det redan finns text, annars ersätt
                    if (newVal === "" || newVal === droppedName) newVal = droppedName;
                    else if (!newVal.includes(droppedName)) newVal += " / " + droppedName;
                    else return; // Namnet fanns redan
                    
                    scheduleData[key] = newVal;
                    saveData('schedule', scheduleData);
                    renderAdminGrid(); 
                }
            };

            // --- Textfältet (ContentEditable) ---
            const textSpan = document.createElement('span');
            textSpan.className = 'shift-text';
            textSpan.innerText = currentText;
            textSpan.contentEditable = "true";
            
            // HÄR ÄR FIXEN: Hantera när man skriver manuellt och klickar bort
            textSpan.onblur = (e) => {
                const newText = e.target.innerText.trim();
                
                // Om inget ändrats, gör inget (sparar prestanda)
                if (newText === currentText) return;

                // 1. Kolla om det finns nya namn som inte finns i listan
                // (T.ex om man skriver "NyPerson / GammalPerson")
                const namesInBox = newText.split('/').map(n => n.trim()).filter(n => n.length > 0);
                let currentUsersList = [...getUsers()]; // Kopiera listan
                let usersUpdated = false;

                namesInBox.forEach(name => {
                    // Finns namnet redan? (okänsligt för stor/liten bokstav)
                    const exists = currentUsersList.some(u => u.toLowerCase() === name.toLowerCase());
                    if (!exists) {
                        currentUsersList.push(name); // Lägg till nytt namn
                        usersUpdated = true;
                    }
                });

                // 2. Om vi hittade nya namn, spara användarlistan först
                if (usersUpdated) {
                    currentUsersList.sort((a, b) => a.localeCompare(b, 'sv')); // Sortera bokstavsordning
                    saveData('users', currentUsersList);
                    // (Globala variabeln uppdateras automatiskt i saveData)
                }

                // 3. Spara själva schemat
                scheduleData[key] = newText;
                saveData('schedule', scheduleData);
                
                // 4. Rita om allt (så att ev. nya namn dyker upp i sidomenyn direkt)
                renderAdminGrid(); 
            };

            // Spara när man trycker Enter
            textSpan.onkeydown = (e) => { 
                if (e.key === 'Enter') { 
                    e.preventDefault(); 
                    e.target.blur(); // Detta triggar onblur ovan
                } 
            };
            
            block.appendChild(textSpan);

            // --- Verktyg (Dropdown & Rensa) ---
            const toolsDiv = document.createElement('div');
            toolsDiv.className = 'admin-tools';
            
            // Visa bara dropdown om det finns lediga personer
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

            // Visa kryss om rutan inte är tom
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
    setInterval(updateClock, 60000);
    
    // Polling varje 10e sekund
    if (USE_CLOUD_DB) {
        setInterval(async () => {
            try {
                globalScheduleData = await fetchData('schedule');
                loadDisplayData();
            } catch (e) { console.error("Update fail", e); }
        }, 10000); 
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
   8. EXPORT & UTSKRIFT (Kopiera från tidigare filer om behövs, 
   här är endast placeholders för att inte göra filen för lång)
   ========================================= */
document.addEventListener('DOMContentLoaded', () => {
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', () => alert("Export-funktionen (html2canvas) behöver implementeras igen eller kopieras från din gamla fil."));
    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.addEventListener('click', () => window.print());
});


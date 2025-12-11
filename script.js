/* =========================================
   1. KONFIGURATION & DATA
   ========================================= */
// Sätt denna till true när du laddat upp till Netlify.
// Sätt till false om du vill testa lokalt på datorn utan internet/databas.
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

// Lokala variabler som håller datan så att sidan känns snabb
let globalScheduleData = {};
let globalUserList = [];

/* =========================================
   2. API & DATABAS (NETLIFY BLOBS)
   ========================================= */

// Hämta data (från databas eller localStorage beroende på inställning)
async function fetchData(type) {
    if (!USE_CLOUD_DB) {
        // Fallback till gamla systemet om vi kör lokalt
        const key = type === 'schedule' ? 'shiftData' : 'userList';
        const local = localStorage.getItem(key);
        return local ? JSON.parse(local) : (type === 'users' ? [] : {});
    }
    
    try {
        // Hämta från Netlify Function
        const response = await fetch(`/.netlify/functions/data-api?type=${type}`);
        if (!response.ok) throw new Error('Kunde inte hämta data');
        return await response.json();
    } catch (error) {
        console.error("Fetch error:", error);
        return type === 'users' ? [] : {};
    }
}

// Spara data
async function saveData(type, data) {
    // 1. Uppdatera minnet direkt (så UI:t inte laggar)
    if (type === 'schedule') globalScheduleData = data;
    if (type === 'users') globalUserList = data;

    // 2. Spara lokalt om vi inte kör moln
    if (!USE_CLOUD_DB) {
        const key = type === 'schedule' ? 'shiftData' : 'userList';
        localStorage.setItem(key, JSON.stringify(data));
        return;
    }

    // 3. Spara till Netlify Blobs (Kräver inloggning)
    if (!window.netlifyIdentity) return;
    const user = window.netlifyIdentity.currentUser();
    
    if (!user) {
        alert("Du måste vara inloggad för att spara ändringar!");
        return;
    }

    try {
        await fetch('/.netlify/functions/data-api', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${user.token.access_token}` // Skicka med nyckeln
            },
            body: JSON.stringify({ type: type, data: data })
        });
    } catch (e) {
        console.error("Save failed", e);
        alert("Kunde inte spara till databasen. Kontrollera din anslutning.");
    }
}

/* =========================================
   3. HJÄLPFUNKTIONER (ANPASSADE)
   ========================================= */

// Dessa funktioner hämtar nu från variablerna vi laddade vid start
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
   4. INITIERING (START)
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const bodyId = document.body.id;

    // Om vi är på inloggningssidan, kör initLogin direkt (behöver ingen data)
    if (bodyId === 'page-login') {
        initLogin();
        return;
    }

    // För Admin och Display: Hämta datan FÖRST, sen rita sidan
    // Detta gör att vi slipper "tomma" sidor som blinkar till
    if (USE_CLOUD_DB) {
        try {
            [globalScheduleData, globalUserList] = await Promise.all([
                fetchData('schedule'),
                fetchData('users')
            ]);
        } catch (e) {
            console.log("Kunde inte hämta initial data, kör tomt.");
        }
    } else {
        // Hämta från localStorage
        globalScheduleData = JSON.parse(localStorage.getItem('shiftData')) || {};
        globalUserList = JSON.parse(localStorage.getItem('userList')) || [];
    }

    if (bodyId === 'page-admin') {
        // Dubbelkolla att man är inloggad, annars kasta ut
        if (USE_CLOUD_DB && window.netlifyIdentity) {
            const user = window.netlifyIdentity.currentUser();
            if (!user) {
                window.location.href = "index.html"; 
                return;
            }
        }
        initAdmin();
    } else if (bodyId === 'page-display') {
        initDisplay();
    }
});

/* =========================================
   5. LOGIN LOGIK (index.html)
   ========================================= */
function initLogin() {
    const loginBtn = document.getElementById('loginBtn');
    
    // Hantera knappen
    if (loginBtn) {
        loginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.netlifyIdentity) {
                window.netlifyIdentity.open();
            } else {
                console.error("Netlify Identity script ej laddat.");
            }
        });
    }

    // Lyssna på inloggning
    if (window.netlifyIdentity) {
        window.netlifyIdentity.on('login', user => {
            console.log("Inloggning lyckades!", user);
            window.netlifyIdentity.close();
            window.location.href = "admin.html";
        });
    }
}

/* =========================================
   6. ADMIN LOGIK
   ========================================= */
let currentAdminDayIndex = getCurrentDayIndex();
if (currentAdminDayIndex < 0) currentAdminDayIndex = 0; 

window.onclick = function(event) {
    if (!event.target.closest('.dropdown-container')) {
        closeAllDropdowns();
    }
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
            // Använd global variabel istället för localStorage
            let users = [...getUsers()]; 
            if (!users.some(u => u.toLowerCase() === name.toLowerCase())) {
                users.push(name);
                users.sort((a, b) => a.localeCompare(b, 'sv'));
                
                // SPARA TILL DATABAS
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
        input.onkeydown = (e) => {
            if (e.key === 'Enter') addUser();
        };
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
        if (dateDisplay) {
            dateDisplay.innerText = `Redigerar: ${days[currentAdminDayIndex]} (v.${selectedWeek})`;
        }
    }

    prevBtn.onclick = () => {
        if (selectedWeek === 1) {
            selectedYear--;
            selectedWeek = 52; 
        } else {
            selectedWeek--;
        }
        updateDisplay();
        renderAdminGrid();
    };

    nextBtn.onclick = () => {
        if (selectedWeek >= 52) {
            selectedYear++;
            selectedWeek = 1;
        } else {
            selectedWeek++;
        }
        updateDisplay();
        renderAdminGrid();
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
        btn.onclick = () => { 
            currentAdminDayIndex = idx; 
            renderNav();      
            renderAdminGrid(); 
        };
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
            // Ta bort och spara till databas
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

    const scheduleData = getScheduleData(); // Använder global variabel
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
            
            if (!currentText || currentText.trim() === "") {
                block.classList.add('empty');
            }

            // Drag and Drop
            block.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; block.classList.add('drag-over'); };
            block.ondragleave = () => { block.classList.remove('drag-over'); };

            block.ondrop = (e) => {
                e.preventDefault();
                block.classList.remove('drag-over');
                
                const droppedName = e.dataTransfer.getData("text/plain");
                if (droppedName) {
                    let currentVal = textSpan.innerText.trim();
                    let newVal = "";
                    if (currentVal === "" || currentVal === droppedName) { newVal = droppedName; } 
                    else if (!currentVal.includes(droppedName)) { newVal = currentVal + " / " + droppedName; } 
                    else { return; }

                    // UPPDATERA DATA & SPARA
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
                let newText = e.target.innerText.trim();
                const names = newText.split(" / ").map(n => n.trim()).filter(n => n.length > 0);
                
                // Spara nya namn automatiskt
                let usersUpdated = false;
                let currentUsers = [...getUsers()];
                names.forEach(name => {
                    if (!currentUsers.some(u => u.toLowerCase() === name.toLowerCase())) {
                        currentUsers.push(name);
                        usersUpdated = true;
                    }
                });
                
                if (usersUpdated) {
                    currentUsers.sort((a, b) => a.localeCompare(b, 'sv'));
                    saveData('users', currentUsers);
                }
                
                // SPARA SCHEMA
                scheduleData[key] = newText;
                saveData('schedule', scheduleData);
                
                renderAdminGrid(); 
            };

            textSpan.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
            };
            
            block.appendChild(textSpan);

            // Verktyg (Dropdown & Rensa)
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
                        let newString = textSpan.innerText.trim(); 
                        if (newString === "") newString = u;
                        else newString = newString + " / " + u;
                        
                        scheduleData[key] = newString;
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
   7. DISPLAY LOGIK (Auto-uppdaterande)
   ========================================= */
function initDisplay() {
    updateClock();
    // Rita upp direkt med datan vi hämtade i DOMContentLoaded
    loadDisplayData();
    
    // Uppdatera klockan varje sekund
    setInterval(updateClock, 1000);
    
    // VIKTIGT: Hämta ny data från databasen var 10:e sekund
    if (USE_CLOUD_DB) {
        setInterval(async () => {
            try {
                // Hämta i bakgrunden
                const newData = await fetchData('schedule');
                // Spara till global variabel
                globalScheduleData = newData;
                // Rita om skärmen
                loadDisplayData();
            } catch (e) {
                console.error("Kunde inte uppdatera display:", e);
            }
        }, 10000); 
    }
}

function updateClock() {
    const clockEl = document.getElementById('clock');
    if (clockEl) {
        const now = new Date();
        const timeString = now.toLocaleTimeString('sv-SE', {
            hour: '2-digit', 
            minute: '2-digit'
        });
        clockEl.innerText = timeString;
    }
}

function loadDisplayData() {
    let todayIndex = getCurrentDayIndex();
    if (todayIndex < 0) todayIndex = 0; 
    const todayName = days[todayIndex];
    const data = getScheduleData(); // Hämtar nu från global variabel
    
    const now = new Date();
    const iso = getISOWeekAndYear(now);
    const currentWeek = iso.week;
    const currentYear = iso.year;

    const container = document.getElementById('mainContainer');
    if (!container) return;
    container.innerHTML = '';
    
    const dateFormatted = now.toLocaleDateString('sv-SE', {
        day: 'numeric', 
        month: 'long'
    });
    
    const titleEl = document.getElementById('mainTitle');
    if (titleEl) {
        titleEl.innerText = `Vi som jobbar ${todayName} ${dateFormatted} (v.${currentWeek})`;
    }
    
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
            const isTwoColStation = (station.name === "Info" || station.name === "PL");
            if (isTwoColStation && index === 2) return;

            const prefix = `y${currentYear}w${currentWeek}-`;
            const key = `${prefix}${todayName}-${station.name}-${dbTime}`;
            const name = data[key];
            
            const card = document.createElement('div');
            card.className = 'shift-card'; 

            if (!name || name.trim() === "") {
                card.classList.add('empty');
                card.innerText = "";
            } else {
                card.innerText = name;
            }
            row.appendChild(card);
        });
        container.appendChild(row);
    });
}

/* =========================================
   8. EXPORT & UTSKRIFT (Oförändrad logik)
   ========================================= */

document.addEventListener('DOMContentLoaded', () => {
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', generateScheduleImage);
    
    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.addEventListener('click', printSchedule);
});

function getScheduleHtmlForPrint() {
    const activeDayIndex = currentAdminDayIndex; 
    const activeDayName = days[activeDayIndex];
    const now = new Date();
    
    const dateFormatted = now.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' });
    const mainTitleText = `Vi som jobbar ${activeDayName} ${dateFormatted} (v.${selectedWeek})`;
    
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
    
    let htmlContent = `
        <div class="top-bar print-header-bar" style="display:flex; justify-content:space-between; align-items:center; max-width:1400px; margin:0 auto 20px auto; padding:0 20px;">
            <h1 style="font-size:2.2rem; color:#222; font-weight:800; flex-grow:1; margin:0!important; padding:0!important; text-align:left!important;">
                ${mainTitleText}
            </h1>
            <div style="width: 100px; height: 32px;"></div> 
        </div>
        <div class="display-grid print-grid" style="background:#fff; padding:20px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.1); max-width:1400px; margin:0 auto;">
            <div class="time-header-row" style="display:grid; grid-template-columns: 150px 1fr 1fr 1fr; gap:10px; margin-bottom:10px; padding-bottom:5px; border-bottom:2px solid #eee; font-weight:bold; text-align:center;">
                <div></div>
                ${displayTimes.map(t => `<div class="time-header">${t}</div>`).join('')}
            </div>
    `;

    const scheduleData = getScheduleData();
    const weekPrefix = `y${selectedYear}w${selectedWeek}-`; 

    stations.forEach(station => {
        const color = COLOR_MAP[station.class];
        const isInfo = station.name === 'Info';
        const rowStyle = isInfo ? 'margin-top:50px; border-top:none;' : '';

        const labelStyle = `
            background-color: ${color.solid} !important; 
            color: #fff !important; 
            opacity: 1 !important;
            font-weight: bold; padding: 10px; border-radius: 4px;
            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
            text-align: center; display:flex; align-items:center; justify-content:center;
            height:100%; min-height:50px;
        `;
        
        htmlContent += `
            <div class="display-row ${station.class}" style="display:grid; grid-template-columns: 150px 1fr 1fr 1fr; gap:10px; margin-bottom:10px; align-items:center; ${rowStyle}">
                <div class="station-label" style="${labelStyle}">${station.name}</div>
        `;

        dbTimes.forEach((dbTime, index) => {
            const isTwoColStation = (station.name === "Info" || station.name === "PL");
            if (isTwoColStation && index === 2) return; 

            const key = `${weekPrefix}${activeDayName}-${station.name}-${dbTime}`;
            const name = scheduleData[key] || "";
            const isEmpty = (!name || name.trim() === "");

            let cardStyle = `
                display:flex; align-items:center; justify-content:center; text-align:center; 
                height:100%; min-height:50px; border-radius:4px; padding:15px; font-weight:bold; font-size:1.1rem;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            `;

            if (isEmpty) {
                cardStyle += `background-color: #ffffff !important; border: none !important; box-shadow: none !important;`;
            } else {
                cardStyle += `background-color: ${color.transparent} !important; border: 1px solid ${color.border} !important; color: #000 !important;`;
            }

            htmlContent += `<div class="shift-card ${isEmpty ? 'empty' : ''}" style="${cardStyle}">${name}</div>`;
        });
        htmlContent += `</div>`; 
    });
    htmlContent += `</div>`; 
    return htmlContent;
}

function printSchedule() {
    const printBtn = document.getElementById('printBtn');
    const originalText = printBtn.innerText;
    printBtn.innerText = "Förbereder utskrift...";

    const printContent = getScheduleHtmlForPrint();
    const printWindow = window.open('', '', 'height=600,width=800');
    
    printWindow.document.write(`<html><head><title>Schema Utskrift</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="style.css">
        <style>@page { size: A4 landscape; margin: 1cm; }</style> 
        </head><body class="print-view">${printContent}</body></html>`);
    printWindow.document.close();

    printWindow.onload = function() {
        printWindow.focus(); 
        printWindow.print();
        printWindow.close();
        printBtn.innerText = originalText;
    };
    setTimeout(() => { if (!printWindow.closed) printBtn.innerText = originalText; }, 5000);
}

function generateScheduleImage() {
    setTimeout(() => {
        const exportBtn = document.getElementById('exportBtn');
        const originalText = exportBtn.innerText;
        exportBtn.innerText = "Genererar bild..."; 
    
        const tempContainer = document.createElement('div');
        tempContainer.id = "temp-export-container";
        Object.assign(tempContainer.style, {
            position: 'absolute', top: '-9999px', left: '0', width: '1600px', 
            backgroundColor: '#f4f4f9', padding: '40px', fontFamily: "'Inter', sans-serif"
        });
    
        tempContainer.innerHTML = getScheduleHtmlForPrint();
        document.body.appendChild(tempContainer);
    
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
            alert("Något gick fel vid bildskapandet.");
            document.body.removeChild(tempContainer);
            exportBtn.innerText = originalText;
        });
    }, 50); 
}
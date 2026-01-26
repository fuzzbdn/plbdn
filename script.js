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
let editingAdminId = null; 

/* =========================================
   2. KOMMUNIKATION MED SERVER (API)
   ========================================= */
async function fetchData(type) {
    try {
        const headers = {};
        if (type === 'admins') {
            const token = sessionStorage.getItem('jwtToken');
            if (token) headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(`/api/data-api?type=${type}`, { headers });
        if (!res.ok) throw new Error('Fetch failed');
        return await res.json();
    } catch (e) {
        if (type === 'users' || type === 'admins') return [];
        if (type === 'settings') return { theme: 'light' };
        if (type === 'message') return { text: '', show: false };
        return {};
    }
}

async function saveData(type, data) {
    if(type === 'schedule' || type === 'schedule_draft' || type === 'schedule_published') {
        globalScheduleData = data;
    }
    
    const token = sessionStorage.getItem('jwtToken');
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
        return true;
    } catch (e) {
        alert("Kunde inte spara.");
        return false;
    }
}

function applyTheme(themeName) {
    if (document.body.id === 'page-admin' || document.body.id === 'page-settings') return;
    
    const themes = ['theme-dark', 'theme-jul', 'theme-pask', 'theme-matrix'];
    document.body.classList.remove(...themes);
    if (themeName && themeName !== 'light') {
        document.body.classList.add(`theme-${themeName}`);
    }
}

/* =========================================
   3. INITIERING (ROUTING)
   ========================================= */
document.addEventListener('DOMContentLoaded', async () => {
    const pageId = document.body.id;

    if (pageId === 'page-login') { initLogin(); return; }
    if (pageId === 'page-reset') { initReset(); return; }

    const [users, settings] = await Promise.all([
        fetchData('users'), fetchData('settings')
    ]);
    globalUserList = users;

    if (settings && settings.theme) applyTheme(settings.theme);

    if (pageId === 'page-admin') {
        if (!checkAuth()) return;
        initAdmin();
    } else if (pageId === 'page-settings') {
        if (!checkAuth()) return;
        initSettings(settings);
    } else if (pageId === 'page-display') {
        initDisplay();
    }
});

function checkAuth() {
    if (!sessionStorage.getItem('jwtToken')) {
        window.location.href = "index.html";
        return false;
    }
    return true;
}

/* =========================================
   4. LOGIN & GLÖMT LÖSENORD
   ========================================= */
function initLogin() {
    const loginBtn = document.getElementById('loginBtn');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');
    
    const forgotView = document.getElementById('forgotForm');
    const loginView = document.getElementById('loginForm');
    const resetEmailIn = document.getElementById('resetEmailInput');
    const resetBtn = document.getElementById('sendResetBtn');
    
    const toForgotLink = document.getElementById('forgotPassLink');
    const toLoginLink = document.getElementById('backToLoginLink');

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
                sessionStorage.setItem('jwtToken', data.token); 
                sessionStorage.setItem('adminUser', data.user);
                sessionStorage.setItem('adminName', data.name);
                window.location.href = "admin.html";
            } else {
                alert("Fel användarnamn eller lösenord!");
            }
        } catch (e) { alert("Kunde inte nå servern."); }
    };

    if(loginBtn) loginBtn.onclick = doLogin;
    if(passIn) passIn.onkeydown = (e) => { if(e.key === 'Enter') doLogin(); };

    if(toForgotLink) {
        toForgotLink.onclick = (e) => {
            e.preventDefault();
            loginView.style.display = 'none';
            forgotView.style.display = 'block';
        };
    }
    if(toLoginLink) {
        toLoginLink.onclick = (e) => {
            e.preventDefault();
            forgotView.style.display = 'none';
            loginView.style.display = 'block';
        };
    }

    if(resetBtn) {
        resetBtn.onclick = async () => {
            const email = resetEmailIn.value.trim();
            if(!email) return alert("Ange din e-postadress.");
            
            resetBtn.innerText = "SKICKAR...";
            try {
                const res = await fetch('/api/data-api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'request_reset', email })
                });
                const data = await res.json();
                
                if(data.success) {
                    alert(data.message || "Länk skickad.");
                    resetEmailIn.value = "";
                    toLoginLink.click();
                } else {
                    alert("Kunde inte skicka.");
                }
            } catch(e) { console.error(e); }
            resetBtn.innerText = "ÅTERSTÄLL";
        };
    }
}

function initReset() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    const newPass = document.getElementById('newPassInput');
    const confirmPass = document.getElementById('confirmPassInput');
    const submitBtn = document.getElementById('resetSubmitBtn');
    const msg = document.getElementById('resetMessage');

    if(!token) {
        if(msg) msg.innerText = "Fel: Ingen kod hittades i länken.";
        if(submitBtn) submitBtn.disabled = true;
        return;
    }

    if(submitBtn) {
        submitBtn.onclick = async () => {
            const p1 = newPass.value.trim();
            const p2 = confirmPass.value.trim();
            
            if(!p1) return alert("Ange ett lösenord");
            if(p1 !== p2) return alert("Lösenorden matchar inte");

            submitBtn.innerText = "SPARAR...";
            
            try {
                const res = await fetch('/api/data-api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'perform_reset', token, newPassword: p1 })
                });
                const data = await res.json();
                
                if(data.success) {
                    msg.style.color = "#4CAF50";
                    msg.innerText = "Lösenordet har ändrats! Du skickas till login...";
                    setTimeout(() => window.location.href = "index.html", 2000);
                } else {
                    msg.style.color = "red";
                    msg.innerText = data.error || "Länken ogiltig.";
                    submitBtn.innerText = "FÖRSÖK IGEN";
                }
            } catch(e) {
                console.error(e);
                msg.innerText = "Serverfel.";
            }
        };
    }
}

/* =========================================
   6. INSTÄLLNINGSSIDA
   ========================================= */
async function initSettings(currentSettings) {
    const displayName = sessionStorage.getItem('adminName') || sessionStorage.getItem('adminUser') || 'Admin';
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + displayName;

    const themeSelect = document.getElementById('themeSelect');
    const saveThemeBtn = document.getElementById('saveThemeBtn');
    if(themeSelect && currentSettings?.theme) themeSelect.value = currentSettings.theme;
    
    if(saveThemeBtn) {
        saveThemeBtn.onclick = async () => {
            if(await saveData('settings', { theme: themeSelect.value })) {
                saveThemeBtn.innerText = "Sparat!";
                setTimeout(() => saveThemeBtn.innerText = "Spara Tema", 2000);
            }
        };
    }

    const msgInput = document.getElementById('displayMessageInput');
    const showCheck = document.getElementById('showMessageCheckbox');
    const msgBtn = document.getElementById('saveMessageBtn');
    const currentMsg = await fetchData('message');
    
    if(currentMsg) {
        msgInput.value = currentMsg.text || "";
        showCheck.checked = currentMsg.show || false;
    }
    if(msgBtn) {
        msgBtn.onclick = async () => {
            if(await saveData('message', { text: msgInput.value, show: showCheck.checked })) {
                msgBtn.innerText = "Sparat!";
                setTimeout(() => msgBtn.innerText = "Uppdatera", 2000);
            }
        };
    }

    const listContainer = document.getElementById('adminListContainer');
    const actionBtn = document.getElementById('addAdminBtn');
    
    const inputFirst = document.getElementById('newAdminFirstName');
    const inputLast = document.getElementById('newAdminLastName');
    const inputEmail = document.getElementById('newAdminEmail');
    const inputUser = document.getElementById('newAdminUser');
    const inputPass = document.getElementById('newAdminPass');

    const renderAdmins = async () => {
        listContainer.innerHTML = "Laddar...";
        const admins = await fetchData('admins');
        
        if(admins.length === 0) {
            listContainer.innerHTML = "<p style='padding:10px; color:#888;'>Inga admins hittades.</p>";
            return;
        }

        listContainer.innerHTML = admins.map(a => {
            const fullName = (a.first_name || a.last_name) 
                ? `<strong>${a.first_name || ''} ${a.last_name || ''}</strong>` 
                : `<em style="color:#888;">(Inget namn)</em>`;
            const userJson = JSON.stringify(a).replace(/"/g, '&quot;');
            const emailDisplay = a.email ? `<span style="font-size:0.8rem; color:#888;"> | ${a.email}</span>` : "";

            return `
            <div class="admin-list-item" style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-size:1rem;">${fullName}</div>
                    <div style="font-size:0.85rem; color:#666;">@${a.username} ${emailDisplay}</div>
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="remove-user-btn" style="color:#2196F3;" onclick="startEditAdmin(${userJson})" title="Redigera">✏️</button>
                    <button class="remove-user-btn" onclick="deleteAdmin('${a.username}')" title="Ta bort">🗑️</button>
                </div>
            </div>
            `;
        }).join('');
    };

    if(actionBtn) {
        actionBtn.onclick = async () => {
            const firstName = inputFirst.value.trim();
            const lastName = inputLast.value.trim();
            const email = inputEmail.value.trim();
            const username = inputUser.value.trim();
            const password = inputPass.value.trim();

            if(!username) return alert("Användarnamn krävs!");

            const token = sessionStorage.getItem('jwtToken');
            const action = editingAdminId ? 'edit_admin' : 'add_admin';
            
            if(action === 'add_admin' && !password) return alert("Lösenord krävs för ny användare!");

            const bodyData = { 
                action, username, password, firstName, lastName, email,
                id: editingAdminId 
            };

            const res = await fetch('/api/data-api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(bodyData)
            });

            if(res.ok) {
                resetForm();
                renderAdmins();
            } else {
                alert("Kunde inte spara.");
            }
        };
    }

    window.startEditAdmin = (user) => {
        editingAdminId = user.id;
        inputFirst.value = user.first_name || "";
        inputLast.value = user.last_name || "";
        inputEmail.value = user.email || "";
        inputUser.value = user.username || "";
        inputPass.value = ""; 
        inputPass.placeholder = "Nytt lösen (valfritt)";
        
        actionBtn.innerText = "💾";
        actionBtn.style.backgroundColor = "#2196F3";

        if(!document.getElementById('cancelEditBtn')) {
            const cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancelEditBtn';
            cancelBtn.innerText = "❌";
            cancelBtn.className = "sidebar-add-btn";
            cancelBtn.style.backgroundColor = "#999";
            cancelBtn.onclick = resetForm;
            actionBtn.parentNode.appendChild(cancelBtn);
        }
    };

    function resetForm() {
        editingAdminId = null;
        inputFirst.value = "";
        inputLast.value = "";
        inputEmail.value = "";
        inputUser.value = "";
        inputPass.value = "";
        inputPass.placeholder = "Lösenord";
        
        actionBtn.innerText = "+";
        actionBtn.style.backgroundColor = "#4CAF50";
        const cancel = document.getElementById('cancelEditBtn');
        if(cancel) cancel.remove();
    }

    window.deleteAdmin = async (username) => {
        if(!confirm(`Ta bort admin ${username}?`)) return;
        const token = sessionStorage.getItem('jwtToken');
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ action: 'remove_admin', username })
        });
        if(res.ok) renderAdmins();
        else alert("Kunde inte ta bort.");
    };

    renderAdmins();

    document.getElementById('logoutBtn').onclick = () => {
        sessionStorage.clear();
        window.location.href = "index.html";
    };
}

/* =========================================
   7. ADMIN (PLANERING & PUBLICERING)
   ========================================= */
async function initAdmin() {
    const displayName = sessionStorage.getItem('adminName') || sessionStorage.getItem('adminUser') || 'Admin';
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + displayName;

    let draft = await fetchData('schedule_draft');
    const published = await fetchData('schedule_published');
    const oldLegacy = await fetchData('schedule');

    if (!draft || Object.keys(draft).length === 0) {
        if (published && Object.keys(published).length > 0) draft = published;
        else draft = oldLegacy;
    }
    
    globalScheduleData = draft || {}; 

    const pubBtn = document.getElementById('publishBtn');
    if(pubBtn) {
        pubBtn.onclick = async () => {
            if(confirm("Vill du publicera ändringarna till statusskärmen?")) {
                pubBtn.innerText = "Publicerar...";
                const success = await saveData('schedule_published', globalScheduleData);
                if(success) {
                    pubBtn.innerText = "✅ Publicerat!";
                    pubBtn.style.backgroundColor = "#1b5e20";
                    setTimeout(() => {
                        pubBtn.innerText = "📡 Publicera";
                        pubBtn.style.backgroundColor = "#2e7d32";
                    }, 3000);
                }
            }
        };
    }

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
    
    // EXPORT KNAPPAR
    document.getElementById('exportBtn').onclick = generateImage;

    const printBtn = document.getElementById('printBtn');
    if (printBtn) {
        printBtn.onclick = () => {
            // Här använder vi "getScheduleHtmlForPrint" som också används av exportBtn
            // men vi lägger in det i print-container för utskrift
            const printContainer = document.getElementById('print-container');
            if (!printContainer) return alert("Saknar print-container!");

            printContainer.innerHTML = getScheduleHtmlForPrint();
            window.print();
            setTimeout(() => { printContainer.innerHTML = ''; }, 1000);
        };
    }
}

function renderAdminGrid() {
    const container = document.getElementById('scheduleContainer');
    renderRoster(); 
    if(!container) return;

    const dayName = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;

    let html = `<div class="header-row"><div></div>${dbTimes.map(t => `<div>${t}</div>`).join('')}</div>`;

    stations.forEach(st => {
        html += `<div class="station-row ${st.class}"><div class="station-label">${st.name}</div>`;
        dbTimes.forEach((time, idx) => {
            if ((st.name === "Info" || st.name === "PL") && idx === 2) { html += `<div></div>`; return; }
            
            const key = `${prefix}${st.name}-${time}`;
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

function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if(!list) return;

    const dayName = days[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;

    const usersWorkingToday = new Set();
    Object.keys(globalScheduleData).forEach(key => {
        if (key.startsWith(prefix)) {
            const val = globalScheduleData[key];
            if (val) {
                val.split('/').forEach(n => usersWorkingToday.add(n.trim()));
            }
        }
    });

    const availableUsers = globalUserList.filter(user => !usersWorkingToday.has(user));

    list.innerHTML = availableUsers.map(u => 
        `<div class="draggable-item" draggable="true" ondragstart="event.dataTransfer.setData('text', '${u}')">
            ${u} <button class="remove-user-btn" onclick="removeUser('${u}')">&times;</button>
        </div>`
    ).join('');
}

async function saveShift(key, val) {
    globalScheduleData[key] = val.trim();
    await saveData('schedule_draft', globalScheduleData);
    renderAdminGrid();
}

async function handleDrop(e, key) {
    e.preventDefault();
    const name = e.dataTransfer.getData("text");
    let current = globalScheduleData[key] || "";
    if (current.includes(name)) return;
    if(current) current += " / " + name;
    else current = name;
    await saveShift(key, current);
}

/* =========================================
   8. DISPLAY-SIDAN
   ========================================= */
let lastDataSnapshot = ""; 

function initDisplay() {
    setInterval(() => {
        const el = document.getElementById('clock');
        if(el) el.innerText = new Date().toLocaleTimeString('sv-SE', {hour:'2-digit', minute:'2-digit'});
    }, 1000);

    const refreshData = async () => {
        let published = await fetchData('schedule_published');
        const oldLegacy = await fetchData('schedule'); 
        
        if (!published || Object.keys(published).length === 0) {
            published = oldLegacy;
        }

        const [settings, message] = await Promise.all([
            fetchData('settings'), fetchData('message')
        ]);
        
        const currentData = published || {};
        const newSnapshot = JSON.stringify({
            schedule: currentData,
            theme: settings?.theme || 'light',
            msg: message || {}
        });

        if (newSnapshot === lastDataSnapshot) return; 

        lastDataSnapshot = newSnapshot;
        globalScheduleData = currentData;
        
        if(settings && settings.theme) applyTheme(settings.theme);

        const marqueeContainer = document.getElementById('marqueeContainer');
        const marqueeText = document.getElementById('marqueeText');
        if(marqueeContainer && marqueeText) {
            if(message && message.show && message.text) {
                marqueeContainer.style.display = 'block';
                if(marqueeText.innerText !== message.text) marqueeText.innerText = message.text;
            } else { marqueeContainer.style.display = 'none'; }
        }

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
                const val = globalScheduleData[key] || "";
                html += `<div class="shift-card ${val?'':'empty'}">${val}</div>`;
            });
            html += `</div>`;
        });
        container.innerHTML = html;
    };

    refreshData();
    setInterval(refreshData, 15000);
}

/* =========================================
   9. BILDEXPORT & UTSKRIFTS-HJÄLP
   ========================================= */

// Denna funktion skapar en snygg HTML-sträng som används både för "Spara bild" och "Skriv ut"
function getScheduleHtmlForPrint() {
    const activeDayName = days[currentAdminDayIndex];
    const now = new Date(); // Eller använd det valda datumet om du vill
    
    // Färger (Måste matcha CSS-klasserna)
    const COLOR_MAP = {
        "color-bjorkliden": { solid: "#ffb74d", transparent: "rgba(255, 183, 77, 0.4)", border: "rgba(255, 183, 77, 0.6)" },
        "color-kiruna":     { solid: "#fff176", transparent: "rgba(255, 241, 118, 0.4)", border: "rgba(255, 241, 118, 0.6)" },
        "color-bastutrask": { solid: "#e57373", transparent: "rgba(229, 115, 115, 0.4)", border: "rgba(229, 115, 115, 0.6)" },
        "color-boden":      { solid: "#81c784", transparent: "rgba(129, 199, 132, 0.4)", border: "rgba(129, 199, 132, 0.6)" },
        "color-gallivare":  { solid: "#64b5f6", transparent: "rgba(100, 181, 246, 0.4)", border: "rgba(100, 181, 246, 0.6)" },
        "color-alvsbyn":    { solid: "#e0e0e0", transparent: "rgba(224, 224, 224, 0.4)", border: "rgba(224, 224, 224, 0.6)" },
        "color-info":       { solid: "#f06292", transparent: "rgba(240, 98, 146, 0.4)", border: "rgba(240, 98, 146, 0.6)" },
        "color-pl":         { solid: "#0277bd", transparent: "rgba(2, 119, 189, 0.4)", border: "rgba(2, 119, 189, 0.6)" }
    };

    const dateFormatted = document.getElementById('currentDateDisplay').innerText;
    const mainTitleText = `Bemanningsschema - ${dateFormatted}`;

    let htmlContent = `
        <div style="font-family: sans-serif; padding: 20px;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="font-size: 24px; margin: 0;">${mainTitleText}</h1>
            </div>
            
            <div style="display: grid; grid-template-columns: 150px 1fr 1fr 1fr; gap: 10px; text-align: center; font-weight: bold; margin-bottom: 10px;">
                <div></div>
                ${displayTimes.map(t => `<div style="border:1px solid #000; padding:5px; background:#ddd;">${t}</div>`).join('')}
            </div>
    `;

    const weekPrefix = `y${selectedYear}w${selectedWeek}-`; 

    stations.forEach(station => {
        const color = COLOR_MAP[station.class] || { solid: "#ccc", transparent: "#eee", border: "#999" };
        const labelStyle = `background-color: ${color.solid}; color: #000; font-weight: bold; padding: 10px; display: flex; align-items: center; justify-content: center; border: 1px solid #000;`;
        
        htmlContent += `
            <div style="display: grid; grid-template-columns: 150px 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div style="${labelStyle}">${station.name}</div>
        `;

        dbTimes.forEach((dbTime, index) => {
            const isTwoColStation = (station.name === "Info" || station.name === "PL");
            if (isTwoColStation && index === 2) return; 

            const key = `${weekPrefix}${activeDayName}-${station.name}-${dbTime}`;
            const name = globalScheduleData[key] || "";
            const isEmpty = (!name || name.trim() === "");

            let cardStyle = `
                display: flex; align-items: center; justify-content: center; text-align: center; 
                min-height: 50px; padding: 5px; font-weight: bold; border: 1px solid #000;
            `;

            if (isEmpty) {
                cardStyle += `background-color: #fff;`;
            } else {
                cardStyle += `background-color: #fff;`; // Eller color.transparent om du vill ha färg i rutan
            }

            htmlContent += `<div style="${cardStyle}">${name}</div>`;
        });
        htmlContent += `</div>`; 
    });
    
    htmlContent += `</div>`;
    return htmlContent;
}

function generateImage() {
    const exportBtn = document.getElementById('exportBtn');
    const originalText = exportBtn.innerText;
    exportBtn.innerText = "Genererar..."; 

    // Skapa en tillfällig container för bilden
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.top = '-9999px';
    tempContainer.style.left = '0';
    tempContainer.style.width = '1200px'; // Bredden på bilden
    tempContainer.style.backgroundColor = '#fff';
    
    // Fyll med snygg HTML
    tempContainer.innerHTML = getScheduleHtmlForPrint();
    document.body.appendChild(tempContainer);

    if (typeof html2canvas === 'undefined') {
        alert("html2canvas saknas. Ladda om sidan.");
        exportBtn.innerText = originalText;
        return;
    }

    html2canvas(tempContainer, { scale: 2 }).then(canvas => {
        const activeDayName = days[currentAdminDayIndex];
        const link = document.createElement('a');
        link.download = `Schema-${activeDayName}-v${selectedWeek}.jpg`; 
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        link.click();
        
        document.body.removeChild(tempContainer);
        exportBtn.innerText = originalText;
    }).catch(err => {
        console.error("Fel vid bildgenerering:", err);
        if(document.body.contains(tempContainer)) document.body.removeChild(tempContainer);
        exportBtn.innerText = originalText;
    });
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

async function removeUser(u) {
    if(confirm('Ta bort ' + u + ' permanent från systemet?')) {
        globalUserList = globalUserList.filter(user => user !== u);
        await saveData('users', globalUserList);
        renderRoster();
    }
}

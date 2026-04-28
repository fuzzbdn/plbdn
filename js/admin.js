import { fetchData, apiAction } from './service.js';
import { showToast, showConfirm, getISOWeek, isLight, escapeHTML } from './utils.js';
import { DAYS } from './config.js';

let globalScheduleData = {}; 
let globalUserList = [];
let globalStations = [];
let globalShifts = [];
let datesOfWeek = [];
let currentAdminDayIndex = 0;

// Centraliserad logik för vilket namn som ska visas
function getFriendlyName(u) {
    if (u.display_name) return u.display_name;
    if (u.first_name) return `${u.first_name} ${u.last_name || ''}`.trim();
    return u.username;
}

export async function initAdmin() {
    // ... autentisering och initiering ...
    const [users, stations, shifts] = await Promise.all([fetchData('users'), fetchData('stations'), fetchData('shifts')]);
    globalUserList = users || [];
    globalStations = stations || [];
    globalShifts = shifts || [];

    setupSidebarAddUser();
    updateGrid(new Date().toISOString().split('T')[0]);
}

function renderAdminGrid() {
    const cont = document.getElementById('scheduleContainer');
    const currentDateStr = datesOfWeek[currentAdminDayIndex];
    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${escapeHTML(s.label)}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        html += `<div class="station-row"><div class="station-label" style="background:${st.color}">${escapeHTML(st.name)}</div>`;
        globalShifts.forEach(sh => {
            const assignments = globalScheduleData[`${currentDateStr}_${st.id}_${sh.id}`] || [];
let usersHtml = assignments.map(a => {
    const nameToShow = a.display_name || 
                       (a.first_name ? `${a.first_name} ${a.last_name||''}`.trim() : a.username);
    return `
    <span class="assigned-user-pill">
        ${escapeHTML(nameToShow)}
        <button class="clear-user-btn" data-date="${currentDateStr}" data-station="${st.id}" data-shift="${sh.id}" data-user="${a.user_id}">×</button>
    </span>`;
}).join('');
            html += `<div class="shift-block" ondrop="handleDrop(event)" ondragover="event.preventDefault()" data-date="${currentDateStr}" data-station="${st.id}" data-shift="${sh.id}">${usersHtml}</div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

function renderRoster() {
// I din js/admin.js, uppdatera renderRoster:
function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if(!list) return;
    
    // ... (behåll logiken för sortering och busy-status)

    list.innerHTML = sortedUsers.map(u => {
        const isAssigned = workingTodayUserIds.has(u.id);
        const assignedClass = isAssigned ? 'assigned' : '';
        
        // PRIORITET: 1. display_name, 2. förnamn+efternamn, 3. username
        const nameToShow = u.display_name || 
                           (u.first_name ? `${u.first_name} ${u.last_name||''}`.trim() : u.username);
        
        const safeName = escapeHTML(nameToShow);
        return `<div class="draggable-item ${assignedClass}" draggable="true" ondragstart="event.dataTransfer.setData('user_id','${u.id}')">
                    ${safeName} 
                    <button class="remove-user-btn" data-fullname="${safeName}">×</button>
                </div>`;
    }).join('');
    
    // ... (behåll event listeners för radering)
}
}

async function updateGrid(dateStr) {
    // ... datumhantering ...
    const scheduleRaw = await fetchData('schedule', `&start_date=${datesOfWeek[0]}&end_date=${datesOfWeek[6]}`);
    globalScheduleData = {};
    if (Array.isArray(scheduleRaw)) {
        scheduleRaw.forEach(row => {
            const key = `${row.work_date.split('T')[0]}_${row.station_id}_${row.shift_id}`;
            if (!globalScheduleData[key]) globalScheduleData[key] = [];
            globalScheduleData[key].push(row);
        });
    }
    renderAdminGrid(); renderRoster();
}

function setupSidebarAddUser() {
    const btn = document.getElementById('sidebarAddBtn');
    const inp = document.getElementById('sidebarNewName');
    btn.onclick = async () => {
        const name = inp.value.trim();
        if(!name) return;
        await apiAction('quick_add_user', { fullName: name });
        inp.value = '';
        globalUserList = await fetchData('users'); renderRoster();
    };
}

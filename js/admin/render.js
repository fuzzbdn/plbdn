import { fetchData, apiAction } from '../service.js';
import { escapeHTML, isLight, buildWeeklyGridHTML, showToast, showConfirm } from '../utils.js';
import { DAYS } from '../config.js';
import { getStations, getShifts, getScheduleData, getUsers, setUsers } from '../store.js';
import { adminState, getFriendlyName, getUserAbsence } from './state.js';

export function renderViews() {
    if (adminState.isWeeklyView) {
        renderWeeklyView();
    } else {
        renderAdminGrid();
    }
    renderRoster();
}

export function renderAdminGrid() {
    const cont = document.getElementById('scheduleContainer');
    if (!cont) return;

    const currentStations = getStations();
    const currentShifts = getShifts();
    const scheduleData = getScheduleData();

    if (!currentShifts.length || !currentStations.length) {
        cont.innerHTML = '<p style="padding:1rem;color:#888;">Inga stationer eller pass konfigurerade.</p>';
        return;
    }

    const currentDateStr = adminState.datesOfWeek[adminState.currentAdminDayIndex];
    const safeDate = escapeHTML(currentDateStr);

    let html = `<div class="header-row"><div></div>${currentShifts.map(s => `<div>${escapeHTML(s.time_range || s.label)}</div>`).join('')}</div>`;

    currentStations.forEach(st => {
        if (st.is_spacer) {
            html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`;
            return;
        }

        const contrast = isLight(st.color) ? '#000' : '#fff';
        const safeColor = escapeHTML(st.color);
        const styles = `background-color:${safeColor}; color:${contrast}; --station-color:${safeColor};`;
        const safeStationId = escapeHTML(String(st.id));

        html += `<div class="station-row"><div class="station-label" style="${styles}">${escapeHTML(st.name)}</div>`;

        currentShifts.forEach(sh => {
            if (!sh || sh.id == null) return;

            const safeShiftId = escapeHTML(String(sh.id));
            const key = `${currentDateStr}_${st.id}_${sh.id}`;
            const assignments = scheduleData[key] || [];
            const hasUsers = assignments.length > 0;

            const textVal = assignments.map(a => getFriendlyName(a)).join(' / ');
            const safeVal = escapeHTML(textVal);

            html += `
            <div class="shift-block ${hasUsers ? '' : 'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event)" data-date="${safeDate}" data-station="${safeStationId}" data-shift="${safeShiftId}">
                <span class="shift-text" contenteditable="true" data-date="${safeDate}" data-station="${safeStationId}" data-shift="${safeShiftId}">${safeVal}</span>
                <div class="shift-controls">
                    <button class="add-user-btn" data-date="${safeDate}" data-station="${safeStationId}" data-shift="${safeShiftId}" title="Lägg till">+</button>
                    ${hasUsers ? `<button class="clear-btn" data-date="${safeDate}" data-station="${safeStationId}" data-shift="${safeShiftId}">×</button>` : ''}
                </div>
            </div>`;
        });
        html += `</div>`;
    });

    cont.innerHTML = html;
}

export function renderWeeklyView() {
    const cont = document.getElementById('weeklyContainer');
    if (!cont) return;

    const scheduleData = getScheduleData();
    const currentStations = getStations();
    const currentShifts = getShifts();
    const users = getUsers();

    const getAssignments = (userId, dateStr) => {
        let userAssignments = [];
        Object.keys(scheduleData).forEach(key => {
            if (key.startsWith(dateStr)) {
                const rowAssignments = scheduleData[key];
                const assignment = rowAssignments.find(a => String(a.user_id) === String(userId));
                if (assignment) {
                    const st = currentStations.find(s => s.id === assignment.station_id);
                    const sh = currentShifts.find(s => s.id === assignment.shift_id);
                    if (st && sh) {
                        userAssignments.push({ stationName: st.name, stationColor: st.color, shiftLabel: sh.label });
                    }
                }
            }
        });
        return userAssignments;
    };

    const getAbsence = (userId, dateStr) => getUserAbsence(userId, dateStr);

    cont.innerHTML = buildWeeklyGridHTML(users, adminState.datesOfWeek, getAssignments, false, DAYS, getAbsence);
}

export function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if (!list) return;

    const currentDateStr = adminState.datesOfWeek[adminState.currentAdminDayIndex];
    const workingTodayUserIds = new Set();
    const scheduleData = getScheduleData();

    Object.keys(scheduleData).forEach(k => {
        if (k.startsWith(currentDateStr)) {
            scheduleData[k].forEach(a => workingTodayUserIds.add(a.user_id));
        }
    });

    const users = getUsers();
    const sortedUsers = [...users].sort((a, b) => {
        const aBusy = workingTodayUserIds.has(a.id);
        const bBusy = workingTodayUserIds.has(b.id);
        if (aBusy === bBusy) return getFriendlyName(a).localeCompare(getFriendlyName(b));
        return aBusy ? 1 : -1;
    });

    list.innerHTML = sortedUsers.map(u => {
        const abs = getUserAbsence(u.id, currentDateStr);
        let absIcon = '';
        let absClass = '';

        if (abs) {
            absClass = 'absent';
            if (abs.type === 'Sjuk') absIcon = '🤒';
            else if (abs.type === 'VAB') absIcon = '🧸';
            else if (abs.type === 'Semester') absIcon = '🌴';
            else absIcon = '✈️';
        }

        const isAssigned = workingTodayUserIds.has(u.id);
        const assignedClass = isAssigned ? 'assigned' : '';
        const safeName = escapeHTML(getFriendlyName(u));
        const safeId = escapeHTML(String(u.id));
        const canDrag = abs ? 'false' : 'true';

        return `<div class="draggable-item ${assignedClass} ${absClass}" draggable="${canDrag}" ondragstart="event.dataTransfer.setData('user_id','${safeId}')">
            ${absIcon} ${safeName} ${abs ? `<span style="font-size:0.75rem; font-weight:normal; margin-left:5px;">(${escapeHTML(abs.type)})</span>` : ''}
            <button class="remove-user-btn" data-userid="${safeId}" data-fullname="${safeName}">×</button>
        </div>`;
    }).join('');

    list.querySelectorAll('.remove-user-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const userId = e.target.getAttribute('data-userid'); // Hämta ID
            const name = e.target.getAttribute('data-fullname');
            
            if (await showConfirm(`Ta bort ${name} från databasen?`)) {
                // Skicka userId som "id"
                const res = await apiAction('remove_user', { id: userId });
                if (res.success) {
                    showToast('Personal borttagen', 'info');
                    const fetchedUsers = await fetchData('users');
                    setUsers(fetchedUsers || []);
                    renderViews();
                } else {
                    showToast(res.error || 'Kunde inte ta bort användaren', 'error');
                }
            }
        };
    });
}

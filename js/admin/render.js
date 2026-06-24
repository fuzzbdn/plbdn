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

            html += `
            <div class="shift-block ${hasUsers ? '' : 'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event)" data-date="${safeDate}" data-station="${safeStationId}" data-shift="${safeShiftId}">
                <div class="shift-users-container">`;

            if (hasUsers) {
                assignments.forEach(a => {
                    const name = escapeHTML(getFriendlyName(a));
                    const note = a.note ? escapeHTML(a.note) : '';
                    const assignmentId = escapeHTML(String(a.id));
                    html += `
                    <span class="assigned-user-pill" 
                        data-assignment-id="${assignmentId}" 
                        data-name="${name}" 
                        data-note="${note}"
                        style="cursor:pointer;">
                        ${name}
                        ${note ? `<span class="pill-note">(${note})</span>` : ''}
                        <button class="clear-user-btn" 
                            data-date="${safeDate}" 
                            data-station="${safeStationId}" 
                            data-shift="${safeShiftId}" 
                            data-userid="${escapeHTML(String(a.user_id))}" 
                            title="Ta bort">×</button>
                    </span>`;
                });
            }

            html += `</div>
                <div class="shift-controls">
                    <button class="add-user-btn" data-date="${safeDate}" data-station="${safeStationId}" data-shift="${safeShiftId}" title="Lägg till">+</button>
                </div>
            </div>`;
        });
        html += `</div>`;
    });

    cont.innerHTML = html;

    // Sätt upp klick-lyssnare för pills
    cont.querySelectorAll('.assigned-user-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            if (e.target.classList.contains('clear-user-btn')) return;
            showNotePopup(pill);
        });
    });
}

export function renderWeeklyView() {
    const cont = document.getElementById('weeklyContainer');
    if (!cont) return;

    const scheduleData = getScheduleData();
    const currentStations = getStations();
    const currentShifts = getShifts();
    const users = getUsers();

    const scheduleIndex = {};
    Object.entries(scheduleData).forEach(([key, assignments]) => {
        const dateStr = key.split('_')[0];
        if (!scheduleIndex[dateStr]) scheduleIndex[dateStr] = [];
        scheduleIndex[dateStr].push(...assignments);
    });

    const getAssignments = (userId, dateStr) => {
        const userAssignments = [];
        (scheduleIndex[dateStr] || []).forEach(assignment => {
            if (String(assignment.user_id) !== String(userId)) return;
            const st = currentStations.find(s => s.id === assignment.station_id);
            const sh = currentShifts.find(s => s.id === assignment.shift_id);
            if (st && sh) {
                userAssignments.push({ stationName: st.name, stationColor: st.color, shiftLabel: sh.label });
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

        const removeBtnHtml = u.has_password
            ? ''
            : `<button class="remove-user-btn" data-userid="${safeId}" data-fullname="${safeName}">×</button>`;

        return `<div class="draggable-item ${assignedClass} ${absClass}" draggable="${canDrag}" ondragstart="event.dataTransfer.setData('user_id','${safeId}')">
            ${absIcon} ${safeName} ${abs ? `<span style="font-size:0.75rem; font-weight:normal; margin-left:5px;">(${escapeHTML(abs.type)})</span>` : ''}
            ${removeBtnHtml}
        </div>`;
    }).join('');

    list.querySelectorAll('.remove-user-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const userId = e.target.getAttribute('data-userid');
            const name = e.target.getAttribute('data-fullname');

            if (await showConfirm(`Ta bort ${name} från databasen?`)) {
                const res = await apiAction('remove_user', { id: userId });
                if (res.success) {
                    showToast('Personal borttagen', 'info');
                    const fetchedUsers = await fetchData('users');
                    if (fetchedUsers?.success) {
                        setUsers(fetchedUsers.data);
                        renderViews();
                    } else {
                        showToast('Kunde inte ladda om personallistan', 'error');
                    }
                } else {
                    showToast(res.error || 'Kunde inte ta bort användaren', 'error');
                }
            }
        };
    });
}

function showNotePopup(pill) {
    const existing = document.getElementById('note-popup');
    if (existing) existing.remove();

    const assignmentId = pill.getAttribute('data-assignment-id');
    const name = pill.getAttribute('data-name');
    const currentNote = pill.getAttribute('data-note') || '';

    const popup = document.createElement('div');
    popup.id = 'note-popup';
    popup.style.cssText = `
        position: absolute;
        z-index: 500;
        background: #fff;
        border: 1px solid #ccc;
        border-radius: 8px;
        padding: 12px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.15);
        min-width: 220px;
        top: calc(100% + 4px);
        left: 0;
    `;

    popup.innerHTML = `
        <div style="font-weight: 800; margin-bottom: 8px; color: #333; font-size: 0.95rem;">${name}</div>
        <input type="text" id="noteInput" placeholder="Lägg till notering..." 
            value="${currentNote}"
            style="width: 100%; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; 
                   font-size: 0.9rem; box-sizing: border-box; margin-bottom: 8px;">
        <div style="display: flex; gap: 6px;">
            <button id="saveNoteBtn" style="flex:1; background:#0277bd; color:#fff; border:none; 
                    padding: 6px; border-radius: 4px; cursor:pointer; font-weight: bold; font-size: 0.9rem;">Spara</button>
            <button id="clearNoteBtn" style="background:#ffebee; color:#c62828; border:none; 
                    padding: 6px 10px; border-radius: 4px; cursor:pointer;" title="Rensa notering">✕</button>
            <button id="cancelNoteBtn" style="background:#f5f5f5; color:#333; border:none; 
                    padding: 6px 10px; border-radius: 4px; cursor:pointer;">Avbryt</button>
        </div>
    `;

    pill.style.position = 'relative';
    pill.appendChild(popup);

    const input = popup.querySelector('#noteInput');
    input.focus();
    input.select();

    const closePopup = () => popup.remove();

    popup.querySelector('#cancelNoteBtn').onclick = (e) => {
        e.stopPropagation();
        closePopup();
    };

    popup.querySelector('#clearNoteBtn').onclick = async (e) => {
        e.stopPropagation();
        const res = await apiAction('update_note', { id: assignmentId, note: '' });
        if (res.success) {
            closePopup();
            const { updateGrid } = await import('./core.js');
            const { getCurrentPickerDate } = await import('./state.js');
            updateGrid(getCurrentPickerDate());
        }
    };

    popup.querySelector('#saveNoteBtn').onclick = async (e) => {
        e.stopPropagation();
        const note = input.value.trim();
        const res = await apiAction('update_note', { id: assignmentId, note });
        if (res.success) {
            closePopup();
            const { updateGrid } = await import('./core.js');
            const { getCurrentPickerDate } = await import('./state.js');
            updateGrid(getCurrentPickerDate());
        }
    };

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            popup.querySelector('#saveNoteBtn').click();
        }
        if (e.key === 'Escape') closePopup();
    });

    setTimeout(() => {
        document.addEventListener('click', function closeOnOutside(e) {
            if (!popup.contains(e.target) && !pill.contains(e.target)) {
                closePopup();
                document.removeEventListener('click', closeOnOutside);
            }
        });
    }, 0);
}

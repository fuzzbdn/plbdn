import { apiAction, fetchData } from '../service.js';
import { showToast, escapeHTML } from '../utils.js';
import { getUsers, setUsers, getScheduleData } from '../store.js';
import { getFriendlyName, getUserAbsence, getCurrentPickerDate } from './state.js';
import { updateGrid, updatePublishBanner } from './core.js';
import { renderViews } from './render.js';

export function setupDragAndDrop() {
    window.handleDrop = async (e) => {
        e.preventDefault();
        const date = e.currentTarget.getAttribute('data-date');
        const stationId = e.currentTarget.getAttribute('data-station');
        const shiftId = e.currentTarget.getAttribute('data-shift');
        const userId = e.dataTransfer.getData('user_id');

        if (!userId) return;

        const abs = getUserAbsence(userId, date);
        if (abs) {
            showToast(`Personen är markerad som ${abs.type} detta datum!`, 'error');
            return;
        }

        await apiAction('assign_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
        updateGrid(getCurrentPickerDate());
    };

    const scheduleContainer = document.getElementById('scheduleContainer');
    if (scheduleContainer) {
        scheduleContainer.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('clear-user-btn') || e.target.classList.contains('add-user-btn')) {
                e.preventDefault();
            }
        });

        scheduleContainer.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('shift-text')) {
                const dropdown = document.getElementById('autocomplete-dropdown');
                if (!dropdown) return;

                const items = dropdown.querySelectorAll('.dropdown-item');
                if (items.length === 0) return;

                let currentIndex = Array.from(items).findIndex(item => item.classList.contains('active-item'));

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    currentIndex = (currentIndex < items.length - 1) ? currentIndex + 1 : 0;
                    updateDropdownHighlight(items, currentIndex);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    currentIndex = (currentIndex > 0) ? currentIndex - 1 : items.length - 1;
                    updateDropdownHighlight(items, currentIndex);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (currentIndex >= 0 && currentIndex < items.length) {
                        const event = new MouseEvent('mousedown');
                        items[currentIndex].dispatchEvent(event);
                    }
                } else if (e.key === 'Escape') {
                    closeAutocomplete();
                }
            }
        });

        function updateDropdownHighlight(items, index) {
            items.forEach(item => item.classList.remove('active-item'));
            if (index >= 0 && index < items.length) {
                items[index].classList.add('active-item');
                items[index].scrollIntoView({ block: 'nearest' });
            }
        }

        scheduleContainer.addEventListener('click', async (e) => {
            // Ta bort en enskild person från passet
            if (e.target.classList.contains('clear-user-btn')) {
                e.stopPropagation();
                const date = e.target.getAttribute('data-date');
                const stationId = e.target.getAttribute('data-station');
                const shiftId = e.target.getAttribute('data-shift');
                const userId = e.target.getAttribute('data-userid');
                await apiAction('remove_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
                updateGrid(getCurrentPickerDate());
                return;
            }

            if (e.target.classList.contains('add-user-btn')) {
                const date = e.target.getAttribute('data-date');
                const stationId = e.target.getAttribute('data-station');
                const shiftId = e.target.getAttribute('data-shift');
                manualAdd(e, date, stationId, shiftId);
            }
        });

        scheduleContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('shift-text')) showAutocomplete(e.target);
        });

        scheduleContainer.addEventListener('focusout', (e) => {
            if (e.target.classList.contains('shift-text')) {
                const date = e.target.getAttribute('data-date');
                const stationId = e.target.getAttribute('data-station');
                const shiftId = e.target.getAttribute('data-shift');
                const text = e.target.innerText;
                const scheduleData = getScheduleData();

                const key = `${date}_${stationId}_${shiftId}`;
                const currentText = (scheduleData[key] || []).map(a => getFriendlyName(a)).join(' / ');
                if (text.trim() === currentText.trim()) return;

                setTimeout(() => syncShiftTextToDB(date, stationId, shiftId, text), 150);
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('shift-text')) closeAutocomplete();
    });
}

async function syncShiftTextToDB(date, stationId, shiftId, text) {
    const key = `${date}_${stationId}_${shiftId}`;
    const scheduleData = getScheduleData();
    const currentAssignments = scheduleData[key] || [];

    for (let a of currentAssignments) {
        await apiAction('remove_shift', { date, user_id: a.user_id, station_id: stationId, shift_id: shiftId });
    }

    const names = text.split('/').map(n => n.trim()).filter(n => n.length > 0);

    for (let name of names) {
        let u = getUsers().find(u => getFriendlyName(u).toLowerCase() === name.toLowerCase());

        if (!u) {
            await apiAction('quick_add_user', { fullName: name });
            const newUsers = await fetchData('users');
            if (newUsers?.success) setUsers(newUsers.data);
            u = getUsers().find(u => getFriendlyName(u).toLowerCase() === name.toLowerCase());
        }

        if (u) {
            const abs = getUserAbsence(u.id, date);
            if (!abs) {
                await apiAction('assign_shift', { date, user_id: u.id, station_id: stationId, shift_id: shiftId });
            } else {
                showToast(`${getFriendlyName(u)} lades inte till eftersom de är frånvarande.`, 'error');
            }
        }
    }
    updateGrid(getCurrentPickerDate());
}

function manualAdd(e, date, stationId, shiftId) {
    e.stopPropagation();
    const existing = document.getElementById('quick-dropdown');
    if (existing) existing.remove();

    const block = e.target.closest('.shift-block');
    const sortedUsers = [...getUsers()].sort((a, b) => getFriendlyName(a).localeCompare(getFriendlyName(b)));

    const menu = document.createElement('div');
    menu.id = 'quick-dropdown';
    menu.className = 'dropdown-menu';
    menu.style.top = 'calc(100% + 2px)';
    menu.style.left = '0';

    let html = sortedUsers.map(u =>
        `<div class="dropdown-item user-select-btn" data-id="${escapeHTML(String(u.id))}">${escapeHTML(getFriendlyName(u))}</div>`
    ).join('');
    html += `<div class="dropdown-item manual-btn" style="color:#0277bd; font-weight:bold; background:#e3f2fd;">+ Skriv in eget namn...</div>`;
    menu.innerHTML = html;

    block.appendChild(menu);

    menu.addEventListener('click', async (evt) => {
        if (evt.target.classList.contains('user-select-btn')) {
            const userId = evt.target.getAttribute('data-id');
            const abs = getUserAbsence(userId, date);

            if (abs) {
                showToast('Personen är frånvarande detta datum!', 'error');
                menu.remove();
                return;
            }

            await apiAction('assign_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
            menu.remove();
            updateGrid(getCurrentPickerDate());

        } else if (evt.target.classList.contains('manual-btn')) {
            menu.remove();
            showInlineNameInput(block, async (name) => {
                if (!name) return;
                await apiAction('quick_add_user', { fullName: name });
                const users = await fetchData('users');
                if (users?.success) setUsers(users.data);
                const newUser = getUsers().find(u => getFriendlyName(u).toLowerCase() === name.trim().toLowerCase());

                if (newUser) {
                    await apiAction('assign_shift', { date, user_id: newUser.id, station_id: stationId, shift_id: shiftId });
                }
                updateGrid(getCurrentPickerDate());
            });
        }
    });

    document.addEventListener('click', function closeMenu(evt) {
        if (!menu.contains(evt.target)) menu.remove();
    }, { once: true });
}

function showInlineNameInput(block, onConfirm) {
    const existing = document.getElementById('inline-name-input');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'inline-name-input';
    wrapper.style.cssText = 'position:absolute; z-index:200; top:calc(100% + 2px); left:0; background:#fff; border:1px solid #ccc; border-radius:4px; padding:6px; display:flex; gap:4px; box-shadow:0 2px 8px rgba(0,0,0,0.15);';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Namn...';
    input.style.cssText = 'border:1px solid #ccc; border-radius:3px; padding:4px 6px; font-size:0.85rem; width:130px;';

    const confirmBtn = document.createElement('button');
    confirmBtn.innerText = '✓';
    confirmBtn.title = 'Lägg till';
    confirmBtn.style.cssText = 'background:#0277bd; color:#fff; border:none; border-radius:3px; padding:4px 8px; cursor:pointer;';

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = '✕';
    cancelBtn.title = 'Avbryt';
    cancelBtn.style.cssText = 'background:#e0e0e0; border:none; border-radius:3px; padding:4px 8px; cursor:pointer;';

    wrapper.appendChild(input);
    wrapper.appendChild(confirmBtn);
    wrapper.appendChild(cancelBtn);
    block.appendChild(wrapper);
    input.focus();

    const cleanup = () => wrapper.remove();

    confirmBtn.onclick = () => {
        const name = input.value.trim();
        cleanup();
        onConfirm(name);
    };

    cancelBtn.onclick = cleanup;
    input.onkeydown = (e) => {
        if (e.key === 'Enter') confirmBtn.click();
        if (e.key === 'Escape') cleanup();
    };
}

function showAutocomplete(element) {
    closeAutocomplete();
    const text = element.innerText;
    const parts = text.split('/');
    const currentPart = parts[parts.length - 1].trim();
    if (currentPart.length === 0) return;

    const matches = getUsers().filter(u => getFriendlyName(u).toLowerCase().startsWith(currentPart.toLowerCase()));
    if (matches.length === 0) return;

    const block = element.closest('.shift-block');
    const dropdown = document.createElement('div');
    dropdown.id = 'autocomplete-dropdown';
    dropdown.className = 'dropdown-menu';
    dropdown.style.top = 'calc(100% + 2px)';
    dropdown.style.left = '0';

    let isFirst = true;

    matches.forEach(match => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';

        if (isFirst) {
            item.classList.add('active-item');
            isFirst = false;
        }

        item.innerText = getFriendlyName(match);

        item.onmousedown = (evt) => {
            evt.preventDefault();
            parts[parts.length - 1] = parts.length > 1 ? ' ' + getFriendlyName(match) : getFriendlyName(match);
            element.innerText = parts.join(' / ').trim();
            closeAutocomplete();
            element.blur();
        };
        dropdown.appendChild(item);
    });

    block.appendChild(dropdown);
}

function closeAutocomplete() {
    const existing = document.getElementById('autocomplete-dropdown');
    if (existing) existing.remove();
}

export function setupSidebarAddUser() {
    const btn = document.getElementById('sidebarAddBtn');
    const inp = document.getElementById('sidebarNewName');

    if (btn && inp) {
        btn.onclick = async () => {
            const newName = inp.value.trim();
            if (newName) {
                const res = await apiAction('quick_add_user', { fullName: newName });
                if (res.success) {
                    showToast('Personal tillagd i databasen', 'success');
                    inp.value = '';
                    const users = await fetchData('users');
                    if (users?.success) setUsers(users.data);
                    renderViews();
                    updatePublishBanner();
                } else {
                    showToast('Kunde inte lägga till personal', 'error');
                }
            }
        };

        inp.onkeydown = e => { if (e.key === 'Enter') btn.click(); };
    }
}

import { fetchData, apiAction } from '../service.js';
import { showToast, showConfirm, getISOWeek, escapeHTML } from '../utils.js';
import { DAYS } from '../config.js';
import { setAllInitialData, setScheduleData, getScheduleData } from '../store.js';
import { adminState, getDatesOfWeek, getCurrentPickerDate } from './state.js';
import { renderViews } from './render.js';
import { setupDragAndDrop, setupSidebarAddUser } from './dragdrop.js';

export async function initAdmin() {
    const role = localStorage.getItem('userRole');
    if (role !== 'admin' && role !== 'superadmin') {
        window.location.href = 'user.html';
        return;
    }

    document.getElementById('currentUserDisplay').innerText = 'Inloggad: ' + (localStorage.getItem('adminName') || 'Admin');

    if (role === 'superadmin') {
        const saContainer = document.getElementById('superAdminContainer');
        if (saContainer) saContainer.style.display = 'flex';
        loadWorkplaces();
    }

    async function loadWorkplaces() {
        const workplaces = await fetchData('workplaces');
        const select = document.getElementById('workplaceSelect');

        if (workplaces && select) {
            select.innerHTML = workplaces.map(w => `<option value="${escapeHTML(String(w.id))}">${escapeHTML(w.name)}</option>`).join('');
            const active = localStorage.getItem('activeWorkplace') || 'default';
            select.value = active;

            select.onchange = (e) => {
                localStorage.setItem('activeWorkplace', e.target.value);
                window.location.reload();
            };
        }
    }

    try {
        const [users, stations, shifts, absences] = await Promise.all([
            fetchData('users'),
            fetchData('stations'),
            fetchData('shifts'),
            fetchData('absences')
        ]);

        setAllInitialData({ users, stations, shifts, absences });
    } catch (e) {
        showToast('Fel vid hämtning av grunddata', 'error');
    }

    const picker = document.getElementById('adminDatePicker');
    picker.value = new Date().toISOString().split('T')[0];
    picker.onchange = (e) => updateGrid(e.target.value);

    document.getElementById('prevDayBtn').onclick = () => changeDate(-1);
    document.getElementById('nextDayBtn').onclick = () => changeDate(1);

    function changeDate(days) {
        if (!picker.value) return;
        const d = new Date(picker.value);
        d.setDate(d.getDate() + days);

        const tzoffset = d.getTimezoneOffset() * 60000;
        picker.value = (new Date(d.getTime() - tzoffset)).toISOString().slice(0, 10);
        updateGrid(picker.value);
    }

    document.getElementById('publishBtn').onclick = async () => {
        const currentDateStr = adminState.datesOfWeek[adminState.currentAdminDayIndex];
        let start = currentDateStr, end = currentDateStr;
        let msg = `Vill du publicera dagens schema (${currentDateStr}) till displayen?`;

        if (adminState.isWeeklyView) {
            start = adminState.datesOfWeek[0];
            end = adminState.datesOfWeek[6];
            msg = 'Vill du publicera hela veckans schema till displayen?';
        }

        if (await showConfirm(msg)) {
            const res = await apiAction('publish_schedule', { start_date: start, end_date: end });
            if (res.success) {
                showToast('Schemat är publicerat!', 'success');
                updateGrid(getCurrentPickerDate());
            } else {
                showToast('Kunde inte publicera', 'error');
            }
        }
    };

    document.getElementById('logoutBtn').onclick = () => {
        localStorage.clear();
        window.location.href = 'index.html';
    };

    const toggleBtn = document.getElementById('toggleViewBtn');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            adminState.isWeeklyView = !adminState.isWeeklyView;
            const dayCont = document.getElementById('scheduleContainer');
            const weekCont = document.getElementById('weeklyContainer');

            if (adminState.isWeeklyView) {
                dayCont.style.display = 'none';
                weekCont.style.display = 'block';
                toggleBtn.innerText = '📆 Byt till Dagsvy';
                toggleBtn.style.backgroundColor = '#455a64';
            } else {
                dayCont.style.display = 'grid';
                weekCont.style.display = 'none';
                toggleBtn.innerText = '📅 Byt till Veckovy';
                toggleBtn.style.backgroundColor = '#0277bd';
            }

            renderViews();
            updatePublishBanner();
        };
    }

    setupDragAndDrop();
    setupSidebarAddUser();

    updateGrid(picker.value);
}

export async function updateGrid(dateStr) {
    const d = new Date(dateStr);
    const iso = getISOWeek(d);

    adminState.selectedWeek = iso.week;
    adminState.selectedYear = iso.year;
    adminState.currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    adminState.datesOfWeek = getDatesOfWeek(dateStr);

    document.getElementById('currentDateDisplay').innerText = `${DAYS[adminState.currentAdminDayIndex]} v.${adminState.selectedWeek}, ${adminState.selectedYear}`;

    const scheduleRaw = await fetchData('schedule', `&start_date=${adminState.datesOfWeek[0]}&end_date=${adminState.datesOfWeek[6]}`);
    
    // Detta anropar setScheduleData i store.js som parsar och sparar den globalt!
    setScheduleData(scheduleRaw);

    renderViews();
    updatePublishBanner();
}

export function updatePublishBanner() {
    let hasUnpublished = false;
    const currentDateStr = adminState.datesOfWeek[adminState.currentAdminDayIndex];
    const scheduleData = getScheduleData();

    Object.values(scheduleData).forEach(assignments => {
        assignments.forEach(row => {
            if (!row.is_published) {
                const localDate = row.work_date.split('T')[0];
                if (adminState.isWeeklyView || localDate === currentDateStr) {
                    hasUnpublished = true;
                }
            }
        });
    });

    const banner = document.getElementById('publishReminderBanner');
    if (banner) {
        if (hasUnpublished) banner.classList.remove('hidden');
        else banner.classList.add('hidden');
    }

    return hasUnpublished;
}

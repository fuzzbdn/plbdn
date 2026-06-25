import { fetchData, apiAction } from '../service.js';
import { showToast, showConfirm, getISOWeek, escapeHTML } from '../utils.js';
import { DAYS } from '../config.js';
import { setAllInitialData, setScheduleData, getScheduleData } from '../store.js';
import { adminState, getDatesOfWeek, getCurrentPickerDate } from './state.js';
import { renderViews } from './render.js';
import { setupDragAndDrop, setupSidebarAddUser } from './dragdrop.js';

export async function initAdmin() {
    // ------------------------------------------------------------------------
    // 1. SÄKERHET OCH UPPSTART
    // ------------------------------------------------------------------------
    
    // Vi läser rollen från localStorage FÖR ATT VETA HUR VI SKA RITA UI:t.
    // Det faktiska säkerhetsskyddet ligger i att API:et (fetchData) kommer att 
    // kasta ut användaren med 401 Unauthorized om de "hackat" sin roll.
    const localRole = localStorage.getItem('userRole');
    if (localRole !== 'admin' && localRole !== 'superadmin') {
        window.location.replace('user.html');
        return;
    }

    document.getElementById('currentUserDisplay').innerText = 'Inloggad: ' + (localStorage.getItem('adminName') || 'Admin');

// ------------------------------------------------------------------------
    // 2. LADDNING AV GRUNDDATA (Nyanserad felhantering med fallbacks)
    // ------------------------------------------------------------------------
    
    try {
        const fetchPromises = [
            fetchData('users'),    // Index 0 (Kritisk)
            fetchData('stations'), // Index 1 (Kritisk)
            fetchData('shifts'),   // Index 2 (Kritisk)
            fetchData('absences')  // Index 3 (Icke-kritisk)
        ];

        if (localRole === 'superadmin') {
            fetchPromises.push(fetchData('workplaces')); // Index 4 (Icke-kritisk för grundvy)
        }

        const results = await Promise.allSettled(fetchPromises);
        
        // Kontrollera om vi fick 401 Unauthorized från någon av dem (hanteras redan av service.js)
        if (results.some(r => r.status === 'fulfilled' && r.value?.status === 401)) {
            return; 
        }

        // Hjälpfunktion för att plocka ut data och hantera fel per resurs
        const getResultData = (index, resourceName, isCritical) => {
            const res = results[index];
            if (!res || res.status === 'rejected' || !res.value?.success) {
                const errorMsg = res?.status === 'rejected' ? res.reason : res?.value?.error;
                console.error(`Kunde inte ladda ${resourceName}:`, errorMsg);
                
                if (isCritical) {
                    throw new Error(`Kritisk resurs saknas: ${resourceName}`);
                } else {
                    showToast(`Varning: Kunde inte ladda ${resourceName}. Viss data saknas.`, 'info');
                    return []; // Returnera tom array så systemet inte kraschar senare
                }
            }
            return res.value.data;
        };

        // Utvärdera varje anrop
        const users = getResultData(0, 'personal', true);
        const stations = getResultData(1, 'stationer', true);
        const shifts = getResultData(2, 'arbetspass', true);
        const absences = getResultData(3, 'frånvaro', false);
        
        setAllInitialData({ users, stations, shifts, absences });

        if (localRole === 'superadmin' && results[4]) {
            const workplaces = getResultData(4, 'arbetsplatser', false);
            const saContainer = document.getElementById('superAdminContainer');
            if (saContainer) saContainer.style.display = 'flex';
            setupWorkplaceDropdown(workplaces);
        }

    } catch (e) {
        console.error("Kritiskt fel vid initiering av admin:", e);
        showToast('Systemet kunde inte startas. Ladda om sidan.', 'error');
        
        // Dölj laddande UI eller visa felmeddelande på skärmen här om nödvändigt
        const scheduleContainer = document.getElementById('scheduleContainer');
        if (scheduleContainer) {
            scheduleContainer.innerHTML = '<div style="padding: 20px; color: #d32f2f; font-weight: bold; text-align: center;">Ett kritiskt nätverksfel uppstod. Vänligen ladda om sidan.</div>';
        }
        return;
    }

    // ------------------------------------------------------------------------
    // 3. UI KOPPLINGAR OCH EVENT LISTENERS
    // ------------------------------------------------------------------------
    
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
                showToast(res.error || 'Kunde inte publicera', 'error');
            }
        }
    };

    // FIX: Utloggning som faktiskt rensar HTTPOnly-cookies på servern!
    document.getElementById('logoutBtn').onclick = async () => {
        await apiAction('logout', {});
        localStorage.clear(); 
        globalThis.location.href = "index.html";
    };

    const toggleBtn = document.getElementById('toggleViewBtn');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            adminState.isWeeklyView = !adminState.isWeeklyView;
            
            // FIX: Använder nu CSS-klasser/dataset istället för hårdkodade styles för bättre maintainability.
            // (Kräver att du lägger till dessa i admin.css vid tillfälle, men detta är strukturellt renare).
            const container = document.querySelector('.schedule-card');
            if (container) {
                container.dataset.view = adminState.isWeeklyView ? 'weekly' : 'daily';
            }

            // Fallback tills du uppdaterat CSS
            const dayCont = document.getElementById('scheduleContainer');
            const weekCont = document.getElementById('weeklyContainer');

            if (adminState.isWeeklyView) {
                if(dayCont) dayCont.style.display = 'none';
                if(weekCont) weekCont.style.display = 'block';
                toggleBtn.innerText = '📆 Byt till Dagsvy';
                // Undvik inline-styles, men behålls här för bakåtkompatibilitet tills CSS uppdateras
                toggleBtn.style.backgroundColor = '#455a64'; 
            } else {
                if(dayCont) dayCont.style.display = 'grid';
                if(weekCont) weekCont.style.display = 'none';
                toggleBtn.innerText = '📅 Byt till Veckovy';
                toggleBtn.style.backgroundColor = '#0277bd';
            }

            renderViews();
            updatePublishBanner();
        };
    }

    setupDragAndDrop();
    setupSidebarAddUser();

    // Starta den initiala renderingen
    updateGrid(picker.value);
}

// ------------------------------------------------------------------------
// FRISTÅENDE FUNKTIONER
// ------------------------------------------------------------------------

/**
 * Bygger och hanterar dropdownen för Super-Admins för att byta anläggning.
 */
function setupWorkplaceDropdown(workplaces) {
    const select = document.getElementById('workplaceSelect');
    if (!select || !workplaces) return;

    select.innerHTML = workplaces.map(w => `<option value="${escapeHTML(String(w.id))}">${escapeHTML(w.name)}</option>`).join('');
    const active = localStorage.getItem('activeWorkplace') || 'default';
    select.value = active;

    select.onchange = async (e) => {
        // Nytt säkert anrop till servern för att byta arbetsplats via cookie
        const res = await apiAction('switch_workplace', { workplace_id: e.target.value });
        if (res.success) {
            localStorage.setItem('activeWorkplace', e.target.value); // Ligger kvar visuellt
            window.location.reload();
        } else {
            showToast(res.error || "Kunde inte byta arbetsplats", "error");
        }
    };
}

export async function updateGrid(dateStr) {
    const d = new Date(dateStr);
    const iso = getISOWeek(d);

    adminState.selectedWeek = iso.week;
    adminState.selectedYear = iso.year;
    adminState.currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    adminState.datesOfWeek = getDatesOfWeek(dateStr);

    document.getElementById('currentDateDisplay').innerText = `${DAYS[adminState.currentAdminDayIndex]} v.${adminState.selectedWeek}, ${adminState.selectedYear}`;

    // FIX: Extrahera strukturerad data och lägg till felhantering
    const res = await fetchData('schedule', { 
        start_date: adminState.datesOfWeek[0], 
        end_date: adminState.datesOfWeek[6] 
    });
    
    if (res && res.success) {
        setScheduleData(res.data);
        renderViews();
        updatePublishBanner();
    } else {
        // Avbryt tyst om vi blev utkastade (hanteras av service.js) eller visa ett fel.
        if (res && res.status !== 401) {
            showToast(res?.error || 'Kunde inte ladda schemat', 'error');
        }
    }
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

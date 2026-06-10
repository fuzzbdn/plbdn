import { fetchData, apiAction } from './service.js';
import { showToast, showConfirm, getISOWeek, isLight, escapeHTML, buildWeeklyGridHTML } from './utils.js';
import { DAYS } from './config.js';

// ==========================================
// GLOBALA VARIABLER (Tillstånd / State)
// ==========================================
let globalScheduleData = {};
let globalUserList = [];
let globalStations = [];
let globalShifts = [];
let globalAbsences = [];

let selectedWeek = 0;
let selectedYear = 0;
let currentAdminDayIndex = 0;
let isWeeklyView = false;
let datesOfWeek = [];

// ==========================================
// HJÄLPFUNKTIONER
// ==========================================

/**
 * Returnerar det aktuella datumvärdet från date-pickern.
 * Centraliserad funktion för att undvika upprepade getElementById-anrop.
 * @returns {string} Datumsträngen (YYYY-MM-DD).
 */
function getCurrentPickerDate() {
    return document.getElementById('adminDatePicker').value;
}

/**
 * Hämtar det mest relevanta namnet för en användare.
 * Prioriterar display_name, därefter för/efternamn, sist username.
 * @param {Object} u - Användarobjektet från databasen.
 * @returns {string} Det formaterade namnet.
 */
function getFriendlyName(u) {
    if (u.display_name) return u.display_name;
    if (u.first_name) return `${u.first_name} ${u.last_name || ''}`.trim();
    return u.username;
}

/**
 * Räknar ut datum för alla dagar i den vecka som det angivna datumet tillhör.
 * Veckan börjar alltid på en måndag.
 *
 * FIX: Muterade tidigare det inkommande datumobjektet via d.setDate().
 * Skapar nu en kopia (monday) för att undvika sidoeffekter.
 *
 * @param {string} dateStr - Datumsträng (YYYY-MM-DD).
 * @returns {string[]} Array med 7 datumsträngar (Måndag till Söndag).
 */
function getDatesOfWeek(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();

    // Konvertera söndag (0) till 7 för att få måndag som första dag i veckan
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);

    // FIX: Skapa en ny Date istället för att mutera d
    const monday = new Date(d);
    monday.setDate(diff);

    const dates = [];
    for (let i = 0; i < 7; i++) {
        const temp = new Date(monday);
        temp.setDate(monday.getDate() + i);
        // Hantera tidszoner så att ISO-strängen inte byter dag av misstag
        const tzoffset = temp.getTimezoneOffset() * 60000;
        dates.push((new Date(temp.getTime() - tzoffset)).toISOString().slice(0, 10));
    }
    return dates;
}

/**
 * Kontrollerar om en användare har registrerad frånvaro ett specifikt datum.
 * @param {number|string} userId - Användarens ID.
 * @param {string} dateStr - Datum att kontrollera (YYYY-MM-DD).
 * @returns {Object|undefined} Frånvaroobjektet om personen är frånvarande, annars undefined.
 */
function getUserAbsence(userId, dateStr) {
    return globalAbsences.find(a =>
        String(a.user_id) === String(userId) &&
        dateStr >= a.start_date.split('T')[0] &&
        dateStr <= a.end_date.split('T')[0]
    );
}

// ==========================================
// HUVUDFUNKTION: INITIERA ADMIN
// ==========================================

/**
 * Huvudfunktion som körs när admin-sidan laddas.
 * Sätter upp event listeners och hämtar grunddata.
 */
export async function initAdmin() {
    // 1. Säkerhetskontroll – obs: detta är enbart klientsideskydd.
    // All faktisk behörighetskontroll MÅSTE göras server-side.
    const role = localStorage.getItem('userRole');
    if (role !== 'admin' && role !== 'superadmin') {
        window.location.href = 'user.html';
        return;
    }

    // Visa vem som är inloggad
    document.getElementById('currentUserDisplay').innerText = 'Inloggad: ' + (localStorage.getItem('adminName') || 'Admin');

    // 2. Specifik hantering för Super-Admins (Flera arbetsplatser)
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

    // 3. Hämta all grunddata från API:et parallellt för snabbare laddning
    try {
        const [users, stations, shifts, absences] = await Promise.all([
            fetchData('users'),
            fetchData('stations'),
            fetchData('shifts'),
            fetchData('absences')
        ]);

        globalUserList = Array.isArray(users) ? users : [];
        globalStations = Array.isArray(stations) ? stations : [];
        globalShifts = Array.isArray(shifts) ? shifts : [];
        globalAbsences = Array.isArray(absences) ? absences : [];
    } catch (e) {
        showToast('Fel vid hämtning av grunddata', 'error');
    }

    // 4. Sätt upp Datumväljaren
    const picker = document.getElementById('adminDatePicker');
    picker.value = new Date().toISOString().split('T')[0]; // Dagens datum som standard
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

    // 5. Hantera publicering av schemat
    document.getElementById('publishBtn').onclick = async () => {
        const currentDateStr = datesOfWeek[currentAdminDayIndex];
        let start = currentDateStr, end = currentDateStr;
        let msg = `Vill du publicera dagens schema (${currentDateStr}) till displayen?`;

        if (isWeeklyView) {
            start = datesOfWeek[0];
            end = datesOfWeek[6];
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

    // 6. Global Drop-hanterare (Drag & Drop funktionalitet)
    window.handleDrop = async (e) => {
        e.preventDefault();
        const date = e.currentTarget.getAttribute('data-date');
        const stationId = e.currentTarget.getAttribute('data-station');
        const shiftId = e.currentTarget.getAttribute('data-shift');
        const userId = e.dataTransfer.getData('user_id');

        if (!userId) return;

        // Kontrollera frånvaro innan placering
        const abs = getUserAbsence(userId, date);
        if (abs) {
            showToast(`Personen är markerad som ${abs.type} detta datum!`, 'error');
            return;
        }

        await apiAction('assign_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
        updateGrid(getCurrentPickerDate());
    };

    // 7. Event Delegation för schemabehållaren (hanterar klick/skrivande i rutorna)
    const scheduleContainer = document.getElementById('scheduleContainer');
    if (scheduleContainer) {

        // --- Förhindra att rutan sparas av misstag ---
        scheduleContainer.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('clear-btn') || e.target.classList.contains('add-user-btn')) {
                e.preventDefault();
            }
        });

        // --- Tangentbordsnavigering för autokomplettering (Pil upp/ner & Enter) ---
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
            // Ta bort från pass (X-knappen)
            if (e.target.classList.contains('clear-btn')) {
                const date = e.target.getAttribute('data-date');
                const stationId = e.target.getAttribute('data-station');
                const shiftId = e.target.getAttribute('data-shift');
                const key = `${date}_${stationId}_${shiftId}`;

                const assignments = globalScheduleData[key] || [];
                for (let a of assignments) {
                    await apiAction('remove_shift', { date, user_id: a.user_id, station_id: stationId, shift_id: shiftId });
                }
                updateGrid(getCurrentPickerDate());
            }

            // Manuell lägg till (+ knappen)
            if (e.target.classList.contains('add-user-btn')) {
                const date = e.target.getAttribute('data-date');
                const stationId = e.target.getAttribute('data-station');
                const shiftId = e.target.getAttribute('data-shift');
                manualAdd(e, date, stationId, shiftId);
            }
        });

        // Visa autokomplettering när man skriver
        scheduleContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('shift-text')) showAutocomplete(e.target);
        });

        // FIX: Spara attribut i closure INNAN setTimeout, så att e.target inte
        // riskerar att ha ändrats när callbacken körs (förekommer i vissa webbläsare).
        scheduleContainer.addEventListener('focusout', (e) => {
            if (e.target.classList.contains('shift-text')) {
                const date = e.target.getAttribute('data-date');
                const stationId = e.target.getAttribute('data-station');
                const shiftId = e.target.getAttribute('data-shift');
                const text = e.target.innerText;

                // FIX: Jämför mot befintlig data – hoppa över API-anrop om inget ändrats.
                const key = `${date}_${stationId}_${shiftId}`;
                const currentText = (globalScheduleData[key] || []).map(a => getFriendlyName(a)).join(' / ');
                if (text.trim() === currentText.trim()) return;

                // Liten fördröjning för att mousedown på autokompletteringsalternativ
                // ska hinna avfyras innan blur sparar innehållet.
                setTimeout(() => syncShiftTextToDB(date, stationId, shiftId, text), 150);
            }
        });
    }

    setupSidebarAddUser();

    // 8. Hantera växling mellan Dagsvy och Veckovy
    const toggleBtn = document.getElementById('toggleViewBtn');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            isWeeklyView = !isWeeklyView;
            const dayCont = document.getElementById('scheduleContainer');
            const weekCont = document.getElementById('weeklyContainer');

            if (isWeeklyView) {
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

    // Kör igång första inladdningen
    updateGrid(picker.value);
}

// ==========================================
// SCHEMALOGIK & DATABASHANTERING
// ==========================================

/**
 * Sparar direktinmatad text från en schemaruta till databasen.
 * Hanterar även skapandet av nya användare "on the fly".
 */
async function syncShiftTextToDB(date, stationId, shiftId, text) {
    const key = `${date}_${stationId}_${shiftId}`;
    const currentAssignments = globalScheduleData[key] || [];

    // Radera existerande bemanning på detta pass
    for (let a of currentAssignments) {
        await apiAction('remove_shift', { date, user_id: a.user_id, station_id: stationId, shift_id: shiftId });
    }

    // Dela upp texten vid snedstreck (ex: "Anna / Kalle")
    const names = text.split('/').map(n => n.trim()).filter(n => n.length > 0);

    for (let name of names) {
        let u = globalUserList.find(u => getFriendlyName(u).toLowerCase() === name.toLowerCase());

        // Om användaren inte finns, skapa den direkt i databasen
        if (!u) {
            await apiAction('quick_add_user', { fullName: name });
            const newUsers = await fetchData('users');
            if (newUsers) globalUserList = newUsers;
            u = globalUserList.find(u => getFriendlyName(u).toLowerCase() === name.toLowerCase());
        }

        // Boka in användaren om de inte har frånvaro
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

/**
 * Hämtar och strukturerar schema-data från servern baserat på valt datum.
 */
async function updateGrid(dateStr) {
    const d = new Date(dateStr);
    const iso = getISOWeek(d);

    selectedWeek = iso.week;
    selectedYear = iso.year;
    currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    datesOfWeek = getDatesOfWeek(dateStr);

    document.getElementById('currentDateDisplay').innerText = `${DAYS[currentAdminDayIndex]} v.${selectedWeek}, ${selectedYear}`;

    // Hämta hela veckans data på en gång för att minska nätverksanrop
    const scheduleRaw = await fetchData('schedule', `&start_date=${datesOfWeek[0]}&end_date=${datesOfWeek[6]}`);
    globalScheduleData = {};

    // Bygg upp en dictionary där nyckeln är "Datum_Station_Pass" för snabb sökning
    if (Array.isArray(scheduleRaw)) {
        scheduleRaw.forEach(row => {
            const localDate = row.work_date.split('T')[0];
            const key = `${localDate}_${row.station_id}_${row.shift_id}`;
            if (!globalScheduleData[key]) globalScheduleData[key] = [];
            globalScheduleData[key].push(row);
        });
    }

    renderViews();
    updatePublishBanner();
}

/**
 * Visar/döljer varningsbannern om det finns opublicerade ändringar.
 * FIX: Returnerar nu ett booleskt värde istället för att enbart skriva till
 * global state, vilket gör funktionen lättare att återanvända och testa.
 * @returns {boolean} Sant om det finns opublicerade ändringar.
 */
function updatePublishBanner() {
    let hasUnpublished = false;
    const currentDateStr = datesOfWeek[currentAdminDayIndex];

    Object.values(globalScheduleData).forEach(assignments => {
        assignments.forEach(row => {
            if (!row.is_published) {
                const localDate = row.work_date.split('T')[0];
                if (isWeeklyView || localDate === currentDateStr) {
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

// ==========================================
// RIT-FUNKTIONER (RENDERING)
// ==========================================

function renderViews() {
    if (isWeeklyView) {
        renderWeeklyView();
    } else {
        renderAdminGrid();
    }
    renderRoster();
}

/**
 * Ritar upp Dagsvyn (Rutnätet med Stationer och Tider).
 * FIX: Använder nu escapeHTML på alla attributvärden (data-station, data-shift m.fl.)
 * för att förhindra XSS via server-returnerade ID:n.
 */
function renderAdminGrid() {
    const cont = document.getElementById('scheduleContainer');
    if (!cont) return;

    // FIX: Tidigt avbrott om grunddata saknas, undviker tysta krascher
    if (!globalShifts.length || !globalStations.length) {
        cont.innerHTML = '<p style="padding:1rem;color:#888;">Inga stationer eller pass konfigurerade.</p>';
        return;
    }

    const currentDateStr = datesOfWeek[currentAdminDayIndex];
    const safeDate = escapeHTML(currentDateStr);

    // Skapa kolumn-rubrikerna (tiderna)
    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${escapeHTML(s.time_range || s.label)}</div>`).join('')}</div>`;

    // Loopa över alla stationer/arbetsplatser
    globalStations.forEach(st => {
        // Om det är en "Spacer" (mellanrum), rita bara ut ett tomt utrymme
        if (st.is_spacer) {
            html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`;
            return;
        }

        // Beräkna om texten ska vara svart eller vit baserat på bakgrundsfärgen
        const contrast = isLight(st.color) ? '#000' : '#fff';
        const safeColor = escapeHTML(st.color);
        const styles = `background-color:${safeColor}; color:${contrast}; --station-color:${safeColor};`;
        const safeStationId = escapeHTML(String(st.id));

        html += `<div class="station-row"><div class="station-label" style="${styles}">${escapeHTML(st.name)}</div>`;

        // Skapa cellerna (passen) för stationen
        globalShifts.forEach(sh => {
            // FIX: Tidigt avbrott om shift saknar ID för att undvika ogiltiga nycklar
            if (!sh || sh.id == null) return;

            const safeShiftId = escapeHTML(String(sh.id));
            const key = `${currentDateStr}_${st.id}_${sh.id}`;
            const assignments = globalScheduleData[key] || [];
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

// ==========================================
// MENYER OCH AUTOKOMPLETTERING
// ==========================================

/**
 * Visar en dropdown-meny för att snabbt lägga till en person via knapptryck.
 * FIX: Ersätter den blockerande prompt() med ett eget modal-input-element.
 */
function manualAdd(e, date, stationId, shiftId) {
    e.stopPropagation();
    const existing = document.getElementById('quick-dropdown');
    if (existing) existing.remove();

    const block = e.target.closest('.shift-block');
    const sortedUsers = [...globalUserList].sort((a, b) => getFriendlyName(a).localeCompare(getFriendlyName(b)));

    const menu = document.createElement('div');
    menu.id = 'quick-dropdown';
    menu.className = 'dropdown-menu';
    menu.style.top = 'calc(100% + 2px)';
    menu.style.left = '0';

    // FIX: escapeHTML på data-id-attributet för att förhindra XSS
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
            // FIX: Ersätter blockerande prompt() med ett inline modal-fält
            showInlineNameInput(block, async (name) => {
                if (!name) return;
                await apiAction('quick_add_user', { fullName: name });
                const users = await fetchData('users');
                globalUserList = users || [];
                const newUser = globalUserList.find(u => getFriendlyName(u).toLowerCase() === name.trim().toLowerCase());

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

/**
 * Visar ett litet inline-inmatningsfält i ett pass-block som ersättning
 * för den blockerande prompt()-dialogen.
 * @param {HTMLElement} block - Det shift-block som inmatningsfältet placeras i.
 * @param {Function} onConfirm - Callback med det inmatade namnet som argument.
 */
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

/**
 * Visar autokompletterings-förslag medan administratören skriver ett namn.
 */
function showAutocomplete(element) {
    closeAutocomplete();
    const text = element.innerText;
    const parts = text.split('/');
    const currentPart = parts[parts.length - 1].trim();
    if (currentPart.length === 0) return;

    const matches = globalUserList.filter(u => getFriendlyName(u).toLowerCase().startsWith(currentPart.toLowerCase()));
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

document.addEventListener('click', (e) => {
    if (!e.target.classList.contains('shift-text')) closeAutocomplete();
});

// ==========================================
// VECKOVY & PERSONAL-LISTA
// ==========================================

function renderWeeklyView() {
    const cont = document.getElementById('weeklyContainer');
    if (!cont) return;

    const getAssignments = (userId, dateStr) => {
        let userAssignments = [];
        Object.keys(globalScheduleData).forEach(key => {
            if (key.startsWith(dateStr)) {
                const rowAssignments = globalScheduleData[key];
                const assignment = rowAssignments.find(a => String(a.user_id) === String(userId));
                if (assignment) {
                    const st = globalStations.find(s => s.id === assignment.station_id);
                    const sh = globalShifts.find(s => s.id === assignment.shift_id);
                    if (st && sh) {
                        userAssignments.push({ stationName: st.name, stationColor: st.color, shiftLabel: sh.label });
                    }
                }
            }
        });
        return userAssignments;
    };

    const getAbsence = (userId, dateStr) => getUserAbsence(userId, dateStr);

    cont.innerHTML = buildWeeklyGridHTML(globalUserList, datesOfWeek, getAssignments, false, DAYS, getAbsence);
}

/**
 * Ritar ut listan på personal till vänster (som man kan dra och släppa).
 * FIX: escapeHTML används nu konsekvent på alla data-attribut, inte bara synlig text.
 */
function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if (!list) return;

    const currentDateStr = datesOfWeek[currentAdminDayIndex];
    const workingTodayUserIds = new Set();

    Object.keys(globalScheduleData).forEach(k => {
        if (k.startsWith(currentDateStr)) {
            globalScheduleData[k].forEach(a => workingTodayUserIds.add(a.user_id));
        }
    });

    // Sortera personal: De som inte jobbar idag hamnar först, sedan i bokstavsordning
    const sortedUsers = [...globalUserList].sort((a, b) => {
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
        // FIX: escapeHTML på data-id-attributet för att förhindra XSS
        const safeId = escapeHTML(String(u.id));
        const canDrag = abs ? 'false' : 'true';

        return `<div class="draggable-item ${assignedClass} ${absClass}" draggable="${canDrag}" ondragstart="event.dataTransfer.setData('user_id','${safeId}')">
            ${absIcon} ${safeName} ${abs ? `<span style="font-size:0.75rem; font-weight:normal; margin-left:5px;">(${escapeHTML(abs.type)})</span>` : ''}
            <button class="remove-user-btn" data-fullname="${safeName}">×</button>
        </div>`;
    }).join('');

    list.querySelectorAll('.remove-user-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const name = e.target.getAttribute('data-fullname');
            if (await showConfirm(`Ta bort ${name} från databasen?`)) {
                const res = await apiAction('remove_user', { fullName: name });
                if (res.success) {
                    showToast('Personal borttagen', 'info');
                    globalUserList = await fetchData('users') || [];
                    renderViews();
                } else {
                    showToast('Kunde inte ta bort användaren', 'error');
                }
            }
        };
    });
}

function setupSidebarAddUser() {
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
                    globalUserList = await fetchData('users') || [];
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

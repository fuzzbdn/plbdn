/**
 * ============================================================================
 * DRAGDROP.JS (Admin/Planering)
 * Hanterar all avancerad interaktion i planeringsvyn (rutnätet).
 * Inkluderar Drag-and-Drop (dra personal från rostern in i ett pass), 
 * inline-redigering (klicka och skriv), live-sökning (autocomplete) och 
 * manuella rullgardinsmenyer.
 * ============================================================================
 */

import { apiAction, fetchData } from '../service.js';
import { showToast, escapeHTML } from '../utils.js';
import { getUsers, setUsers, getScheduleData } from '../store.js';
import { getFriendlyName, getUserAbsence, getCurrentPickerDate } from './state.js';
import { updateGrid, updatePublishBanner } from './core.js';
import { renderViews } from './render.js';

/**
 * Huvudfunktion för att sätta upp alla händelselyssnare (Event Listeners)
 * för rutnätet. Använder "Event Delegation" för prestanda (en lyssnare på
 * hela containern istället för 100 lyssnare på varje enskild ruta).
 */
export function setupDragAndDrop() {
    
    // ==========================================
    // 1. DRAG & DROP-LOGIK
    // ==========================================
    /**
     * Fångar upp när en person släpps (drop) i ett arbetspass.
     * Måste ligga globalt på window eftersom den anropas via ondrop i HTML.
     */
    window.handleDrop = async (e) => {
        e.preventDefault();
        const date = e.currentTarget.dataset.date;
        const stationId = e.currentTarget.dataset.station;
        const shiftId = e.currentTarget.dataset.shift;
        const userId = e.dataTransfer.getData('user_id');

        if (!userId) return;

        // Säkerhetskontroll: Är personen sjuk/ledig?
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
        
        // Förhindra att standard-drag-beteenden stör våra knappar
        scheduleContainer.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('clear-user-btn') || e.target.classList.contains('add-user-btn')) {
                e.preventDefault();
            }
        });

        // ==========================================
        // 2. TANGENTBORDSNAVIGERING (Autocomplete)
        // ==========================================
        scheduleContainer.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('shift-text')) {
                const dropdown = document.getElementById('autocomplete-dropdown');
                if (!dropdown) return;

                const items = dropdown.querySelectorAll('.dropdown-item');
                if (items.length === 0) return;

                // Hitta vilket val i listan som är markerat just nu
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
                        // Simulera ett musklick på det valda elementet
                        const event = new MouseEvent('mousedown');
                        items[currentIndex].dispatchEvent(event);
                    }
                } else if (e.key === 'Escape') {
                    closeAutocomplete();
                }
            }
        });

        /** Hjälpfunktion för att flytta färgmarkeringen i dropdown-listan */
        function updateDropdownHighlight(items, index) {
            items.forEach(item => item.classList.remove('active-item'));
            if (index >= 0 && index < items.length) {
                items[index].classList.add('active-item');
                // Se till att menyn scrollar om listan är lång
                items[index].scrollIntoView({ block: 'nearest' });
            }
        }

        // ==========================================
        // 3. KLICK-HANTERING I RUTNÄTET
        // ==========================================
        scheduleContainer.addEventListener('click', async (e) => {
            
            // Hantera "Ta bort"-krysset för en person
            if (e.target.classList.contains('clear-user-btn')) {
                e.stopPropagation();
                const date = e.target.dataset.date;
                const stationId = e.target.dataset.station;
                const shiftId = e.target.dataset.shift;
                const userId = e.target.dataset.userid;
                
                await apiAction('remove_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
                updateGrid(getCurrentPickerDate());
                return;
            }

            // Hantera Plus-knappen (+) i botten av ett pass
            if (e.target.classList.contains('add-user-btn')) {
                const date = e.target.dataset.date;
                const stationId = e.target.dataset.station;
                const shiftId = e.target.dataset.shift;
                manualAdd(e, date, stationId, shiftId);
                return;
            }

            // Hantera klick på en TOM yta i ett pass (öppna textrutan för inline-skrivning)
            const block = e.target.closest('.shift-block');
            if (block && !e.target.closest('.assigned-user-pill') && !e.target.classList.contains('shift-text')) {
                const shiftText = block.querySelector('.shift-text');
                if (shiftText && shiftText.style.display === 'none') {
                    shiftText.innerText = '';
                    shiftText.style.display = 'block';
                    shiftText.focus();
                }
            }
        });

        // Trigger för autocomplete när man skriver
        scheduleContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('shift-text')) showAutocomplete(e.target);
        });

        // ==========================================
        // 4. SPARA INLINE-TEXT TILL DATABAS
        // ==========================================
        // När administratören klickar utanför textrutan (tappar fokus)
        scheduleContainer.addEventListener('focusout', (e) => {
            if (e.target.classList.contains('shift-text')) {
                const date = e.target.dataset.date;
                const stationId = e.target.dataset.station;
                const shiftId = e.target.dataset.shift;
                const text = e.target.innerText;
                
                e.target.style.display = 'none'; // Dölj fältet igen

                // Kontrollera om texten faktiskt har ändrats för att undvika onödiga anrop
                const key = `${date}_${stationId}_${shiftId}`;
                const currentText = (getScheduleData()[key] || []).map(a => getFriendlyName(a)).join(' / ');
                if (text.trim() === currentText.trim()) return;

                // Kör sparningen med en liten fördröjning så autocomplete-klicket hinner registreras
                setTimeout(() => syncShiftTextToDB(date, stationId, shiftId, text), 150);
            }
        });
    }

    // Stäng autocomplete-menyn om man klickar någon annanstans på sidan
    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('shift-text')) closeAutocomplete();
    });
}

/**
 * Tolkar fri text (t.ex. "Kalle / Anna") och sparar detta till databasen.
 * Skapar även upp nya användare i systemet automatiskt om de inte redan finns!
 */
async function syncShiftTextToDB(date, stationId, shiftId, text) {
    // Dela upp strängen på snedstreck och rensa onödiga mellanslag
    const names = text.split('/').map(n => n.trim()).filter(n => n.length > 0);
    if (names.length === 0) return;

    for (let name of names) {
        // Kolla om personen redan finns (Oavsett stora/små bokstäver)
        let u = getUsers().find(u => getFriendlyName(u).toLowerCase() === name.toLowerCase());

        // Om inte, auto-skapa ett "vikarie"-konto i bakgrunden
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

// ==========================================
// PLUS-MENYN (Rullgardin)
// ==========================================
/**
 * Ritar ut en rullgardinsmeny när man klickar på Plus-knappen (+).
 * Innehåller alla anställda, möjlighet att låsa passet, och möjlighet att 
 * skriva in ett eget namn.
 */
function manualAdd(e, date, stationId, shiftId) {
    e.stopPropagation();
    const existing = document.getElementById('quick-dropdown');
    if (existing) existing.remove();

    const block = e.target.closest('.shift-block');
    // Sortera personalen i bokstavsordning
    const sortedUsers = [...getUsers()].sort((a, b) => getFriendlyName(a).localeCompare(getFriendlyName(b)));

    const menu = document.createElement('div');
    menu.id = 'quick-dropdown';
    menu.className = 'dropdown-menu';
    menu.style.top = 'calc(100% + 2px)';
    menu.style.left = '0';

    // Nyhet: Låsknappen högst upp + avskiljare
    let html = `
        <div class="dropdown-item lock-shift-btn" style="color:#d32f2f; font-weight:bold; cursor:pointer;">
            🔒 Lås hela passet
        </div>
        <div style="height: 1px; background-color: #ddd; margin: 4px 0;"></div>
    `;

    html += sortedUsers.map(u =>
        `<div class="dropdown-item user-select-btn" data-id="${escapeHTML(String(u.id))}">${escapeHTML(getFriendlyName(u))}</div>`
    ).join('');
    html += `<div class="dropdown-item manual-btn" style="color:#0277bd; font-weight:bold; background:#e3f2fd;">+ Skriv in eget namn...</div>`;
    
    menu.innerHTML = html;
    block.appendChild(menu);

    menu.addEventListener('click', async (evt) => {
        // Om användaren klickar på "Lås hela passet"
        if (evt.target.classList.contains('lock-shift-btn')) {
            await apiAction('toggle_lock', { date, station_id: stationId, shift_id: shiftId, is_locked: true });
            menu.remove();
            updateGrid(getCurrentPickerDate());
            return;
        }

        // Väljer en befintlig person från listan
        if (evt.target.classList.contains('user-select-btn')) {
            const userId = evt.target.dataset.id;
            const abs = getUserAbsence(userId, date);

            if (abs) {
                showToast('Personen är frånvarande detta datum!', 'error');
                menu.remove();
                return;
            }

            await apiAction('assign_shift', { date, user_id: userId, station_id: stationId, shift_id: shiftId });
            menu.remove();
            updateGrid(getCurrentPickerDate());

        } 
        // Väljer att skriva in ett nytt, okänt namn
        else if (evt.target.classList.contains('manual-btn')) {
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

    // Ta bort menyn om man klickar någon annanstans
    document.addEventListener('click', function closeMenu(evt) {
        if (!menu.contains(evt.target)) menu.remove();
    }, { once: true });
}

/**
 * Visar en mini-input-ruta inuti passet för att snabbt skriva in ett namn
 * efter att man klickat på "+ Skriv in eget namn...".
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

// ==========================================
// AUTOCOMPLETE (Söka medan man skriver)
// ==========================================
/**
 * Ritar ut en förslagsmeny medan användaren skriver i schemacellen.
 */
function showAutocomplete(element) {
    closeAutocomplete();
    const text = element.innerText;
    
    // Hantera scenariot där man skriver flera namn separerade med "/"
    const parts = text.split('/');
    const currentPart = parts[parts.length - 1].trim();
    if (currentPart.length === 0) return;

    // Sök fram matchningar (börjar på bokstäverna)
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

        // Markera det första förslaget som förvalt (för att kunna trycka Enter)
        if (isFirst) {
            item.classList.add('active-item');
            isFirst = false;
        }

        item.innerText = getFriendlyName(match);

        // Måste vara mousedown, ej click, eftersom 'focusout' på inputfältet triggas före 'click'
        item.onmousedown = (evt) => {
            evt.preventDefault();
            parts[parts.length - 1] = parts.length > 1 ? ' ' + getFriendlyName(match) : getFriendlyName(match);
            element.innerText = parts.join(' / ').trim();
            closeAutocomplete();
            element.blur(); // Triggar focusout -> syncShiftTextToDB()
        };
        dropdown.appendChild(item);
    });

    block.appendChild(dropdown);
}

function closeAutocomplete() {
    const existing = document.getElementById('autocomplete-dropdown');
    if (existing) existing.remove();
}

// ==========================================
// SIDEBAR: LÄGG TILL PERSON (SNABBVAL)
// ==========================================
/**
 * Kopplar logiken för fältet i högerkanten (Rostern) där man snabbt
 * kan skapa en ny anställd/vikarie i systemet utan att gå via inställningar.
 */
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

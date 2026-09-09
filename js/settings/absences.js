/**
 * ============================================================================
 * ABSENCES.JS (Admin/Inställningar)
 * Hanterar fliken "Frånvaro" under Inställningar.
 * Låter administratören registrera Sjukdom, VAB och Semester. 
 * Integrerar med backend för att automatiskt radera eventuella krockande 
 * arbetspass för personen under den valda perioden.
 * ============================================================================
 */

import { fetchData, apiAction } from '../service.js';
import { showToast, showConfirm, escapeHTML } from '../utils.js';
import { getUsers, getAbsences, setAbsences } from '../store.js';

/** @type {string|number|null} Håller ID:t för den frånvaro som redigeras just nu. Null = Skapa ny. */
let editingAbsenceId = null;

/**
 * Startar upp frånvarofliken, bygger formuläret och laddar in aktuell frånvarodata.
 */
export function initAbsencesTab() {
    const saveBtn = document.getElementById('saveAbsenceBtn');
    const userSelect = document.getElementById('absUser');
    const typeSelect = document.getElementById('absType');
    const startInput = document.getElementById('absStart');
    const endInput = document.getElementById('absEnd');

    if (!saveBtn || !userSelect) return;

    /**
     * Hämtar dagens datum i lokalt svenskt format (YYYY-MM-DD)
     * med hänsyn till tidszoner.
     * @returns {string} Dagens datum.
     */
    const getToday = () => {
        const now = new Date();
        return new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    };

    // ==========================================
    // 1. DYNAMISKT UI (Avbryt-knapp)
    // ==========================================
    // Skapa en Avbryt-knapp dynamiskt om den inte redan finns i HTML:en
    let cancelBtn = document.getElementById('cancelAbsenceEditBtn');
    if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancelAbsenceEditBtn';
        cancelBtn.className = 'cancel-edit-btn';
        cancelBtn.style.display = 'none';
        cancelBtn.style.flex = '1';
        cancelBtn.innerText = 'Avbryt';

        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '10px';
        
        saveBtn.parentNode.insertBefore(btnContainer, saveBtn);
        btnContainer.appendChild(saveBtn);
        btnContainer.appendChild(cancelBtn);
        saveBtn.style.flex = '1';
    }

    // Fyll dropdown-listan med alla användare från Store
    userSelect.innerHTML = getUsers().map(u =>
        `<option value="${escapeHTML(String(u.id))}">${escapeHTML(u.display_name || u.first_name || u.username)}</option>`
    ).join('');

    // Sätt defaultvärden
    startInput.value = getToday();
    endInput.value = getToday();

    /**
     * Återställer formuläret till "Skapa Ny"-läge.
     */
    const resetForm = () => {
        editingAbsenceId = null;
        startInput.value = getToday();
        endInput.value = getToday();
        userSelect.disabled = false; // Lås upp användarvalet igen
        
        saveBtn.innerText = 'Spara Frånvaro';
        saveBtn.style.backgroundColor = '#0277bd';
        cancelBtn.style.display = 'none';
    };

    cancelBtn.onclick = resetForm;

    // ==========================================
    // 2. HANTERA REDIGERING & RADERING
    // ==========================================
    
    /**
     * Startar redigeringsläget för en befintlig frånvaro.
     * @param {string|number} id - Frånvarons ID.
     */
    const startEditAbsence = (id) => {
        const abs = getAbsences().find(a => String(a.id) === String(id));
        if (!abs) return;

        editingAbsenceId = abs.id;
        userSelect.value = abs.user_id;
        userSelect.disabled = true; // Man kan inte byta person på en befintlig frånvaro
        typeSelect.value = abs.type;
        startInput.value = abs.start_date.split('T')[0];
        endInput.value = abs.end_date.split('T')[0];

        saveBtn.innerText = 'Spara Ändringar';
        saveBtn.style.backgroundColor = '#2e7d32'; // Grön färg för att markera redigering
        cancelBtn.style.display = 'inline-flex';

        // Scrolla mjukt upp till formuläret
        document.getElementById('tab-absences').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    /**
     * Raderar en frånvaro efter bekräftelse.
     * @param {string|number} id - Frånvarons ID.
     */
    const deleteAbsence = async (id) => {
        if (await showConfirm("Radera denna frånvaro?")) {
            const res = await apiAction('delete_absence', { id });
            if (!res.success) {
                showToast(res.error || 'Kunde inte radera frånvaron', 'error');
                return;
            }
            
            // Hämta om hela frånvarolistan för att säkerställa att vi är synkade
            const fetched = await fetchData('absences');
            if (fetched?.success) {
                setAbsences(fetched.data);
                renderAbsences();
                resetForm();
            } else {
                showToast('Kunde inte ladda om frånvarolistan', 'error');
            }
        }
    };

    // ==========================================
    // 3. RENDERING AV LISTAN
    // ==========================================
    /**
     * Ritar ut alla sparade frånvaroposter i gränssnittet.
     */
    const renderAbsences = () => {
        const absences = getAbsences();
        const cont = document.getElementById('absenceListContainer');

        if (!absences || absences.length === 0) {
            cont.innerHTML = "<div style='color:#888; font-style:italic;'>Ingen frånvaro registrerad.</div>";
            return;
        }

        let html = '';
        absences.forEach(a => {
            let icon = '✈️';
            if (a.type === 'Sjuk') icon = '🤒';
            if (a.type === 'VAB') icon = '🧸';
            if (a.type === 'Semester') icon = '🌴';

            const name = a.display_name || `${a.first_name} ${a.last_name || ''}`.trim();
            const dates = a.start_date.split('T')[0] === a.end_date.split('T')[0]
                ? a.start_date.split('T')[0]
                : `${a.start_date.split('T')[0]} till ${a.end_date.split('T')[0]}`;

            // Modern DOM-eventhantering via klasser och data-attribut (säkrare mot XSS)
            html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid #ddd; background:#fff; margin-bottom:5px; border-radius:4px;">
                <div>
                    <strong>${icon} ${escapeHTML(name)}</strong>
                    <span style="color:#666; font-size:0.85em; margin-left:10px;">${escapeHTML(a.type)} (${escapeHTML(dates)})</span>
                </div>
                <div>
                    <button class="list-btn edit-absence-btn" data-id="${escapeHTML(String(a.id))}" style="color:#0277bd; margin-right:5px;" title="Redigera">✏️</button>
                    <button class="list-btn delete-absence-btn" data-id="${escapeHTML(String(a.id))}" style="color:#d32f2f;" title="Ta bort">🗑️</button>
                </div>
            </div>`;
        });

        cont.innerHTML = html;

        // Koppla knapparna med EventListeners efter att HTML:en injicerats
        cont.querySelectorAll('.edit-absence-btn').forEach(btn => {
            btn.onclick = () => startEditAbsence(btn.dataset.id);
        });
        cont.querySelectorAll('.delete-absence-btn').forEach(btn => {
            btn.onclick = () => deleteAbsence(btn.dataset.id);
        });
    };

    // ==========================================
    // 4. SPARA FRÅNVARO (CRUD)
    // ==========================================
    saveBtn.onclick = async () => {
        const user_id = userSelect.value;
        const type = typeSelect.value;
        const start_date = startInput.value;
        const end_date = endInput.value;

        if (!user_id || !start_date || !end_date) return showToast("Fyll i alla fält", "error");
        if (start_date > end_date) return showToast("Slutdatum kan inte vara före startdatum", "error");

        const u = getUsers().find(x => String(x.id) === String(user_id));
        const name = u ? (u.display_name || u.first_name) : "Personen";

        // Tydliga varningstexter för administratören, eftersom backend kommer att ta bort krockande pass
        const msg = editingAbsenceId
            ? `Du ändrar nu frånvaron för ${name} till att gälla mellan ${start_date} och ${end_date}.\n\n⚠️ Eventuella inbokade pass under denna NYA period kommer att rensas. Vill du fortsätta?`
            : `Detta markerar ${name} som ${type} mellan ${start_date} och ${end_date}.\n\n⚠️ Eventuella inbokade pass under denna period kommer att rensas automatiskt. Vill du fortsätta?`;

        if (await showConfirm(msg)) {
            const payload = { user_id, type, start_date, end_date };
            if (editingAbsenceId) payload.id = editingAbsenceId;

            const res = await apiAction('save_absence', payload);
            
            if (res.success) {
                showToast(editingAbsenceId ? "Frånvaro uppdaterad!" : "Frånvaro sparad!", "success");
                resetForm();
                
                // Uppdatera listan efter lyckat sparande
                const fetched = await fetchData('absences');
                if (fetched?.success) {
                    setAbsences(fetched.data);
                    renderAbsences();
                } else {
                    showToast('Kunde inte ladda om frånvarolistan', 'error');
                }
            } else {
                showToast(res.error || "Ett fel uppstod", "error");
            }
        }
    };

    // Initial rendering vid sidladdning
    renderAbsences();
}

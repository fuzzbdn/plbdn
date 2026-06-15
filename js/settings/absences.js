import { fetchData, apiAction } from '../service.js';
import { showToast, showConfirm, escapeHTML } from '../utils.js';
import { getUsers, getAbsences, setAbsences } from '../store.js';

export function initAbsencesTab() {
    const saveBtn = document.getElementById('saveAbsenceBtn');
    const userSelect = document.getElementById('absUser');
    if(!saveBtn || !userSelect) return;

    userSelect.innerHTML = getUsers().map(u => 
        `<option value="${escapeHTML(String(u.id))}">${escapeHTML(u.display_name || u.first_name || u.username)}</option>`
    ).join('');

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('absStart').value = today;
    document.getElementById('absEnd').value = today;

    const renderAbsences = () => {
        const absences = getAbsences();
        const cont = document.getElementById('absenceListContainer');
        
        if(!absences || absences.length === 0) {
            cont.innerHTML = "<div style='color:#888; font-style:italic;'>Ingen frånvaro registrerad.</div>";
            return;
        }
        
        let html = '';
        absences.forEach(a => {
            let icon = '✈️';
            if(a.type === 'Sjuk') icon = '🤒';
            if(a.type === 'VAB') icon = '🧸';
            if(a.type === 'Semester') icon = '🌴';

            const name = a.display_name || `${a.first_name} ${a.last_name||''}`.trim();
            const dates = a.start_date.split('T')[0] === a.end_date.split('T')[0] 
                ? a.start_date.split('T')[0] 
                : `${a.start_date.split('T')[0]} till ${a.end_date.split('T')[0]}`;

            html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid #ddd; background:#fff; margin-bottom:5px; border-radius:4px;">
                <div>
                    <strong>${icon} ${escapeHTML(name)}</strong> <span style="color:#666; font-size:0.85em; margin-left:10px;">${escapeHTML(a.type)} (${escapeHTML(dates)})</span>
                </div>
                <button class="list-btn" onclick="deleteAbsence(${a.id})" style="color:#d32f2f;">🗑️</button>
            </div>`;
        });
        cont.innerHTML = html;
    };

    window.deleteAbsence = async (id) => {
        if(await showConfirm("Radera denna frånvaro?")) {
            await apiAction('delete_absence', { id });
            const fetched = await fetchData('absences');
            setAbsences(fetched);
            renderAbsences();
        }
    };

    saveBtn.onclick = async () => {
        const user_id = document.getElementById('absUser').value;
        const type = document.getElementById('absType').value;
        const start_date = document.getElementById('absStart').value;
        const end_date = document.getElementById('absEnd').value;

        if(!user_id || !start_date || !end_date) return showToast("Fyll i alla fält", "error");
        if(start_date > end_date) return showToast("Slutdatum kan inte vara före startdatum", "error");

        const u = getUsers().find(x => String(x.id) === String(user_id));
        const name = u ? (u.display_name || u.first_name) : "Personen";
        const msg = `Detta markerar ${name} som ${type} mellan ${start_date} och ${end_date}.\n\n⚠️ Eventuella inbokade pass under denna period kommer att rensas automatiskt. Vill du fortsätta?`;

        if(await showConfirm(msg)) {
            const res = await apiAction('save_absence', { user_id, type, start_date, end_date });
            if(res.success) {
                showToast("Frånvaro sparad!", "success");
                const fetched = await fetchData('absences');
                setAbsences(fetched);
                renderAbsences();
            } else {
                showToast("Ett fel uppstod", "error");
            }
        }
    };

    renderAbsences();
}

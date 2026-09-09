/**
 * ============================================================================
 * USERS.JS (Admin/Inställningar)
 * Hanterar fliken "Användare/Personal" under systeminställningar.
 * Låter administratörer (och superadmins) skapa, redigera, söka och ta bort 
 * användarkonton i systemet.
 * ============================================================================
 */

import { fetchData, apiAction } from '../service.js';
import { showToast, showConfirm, escapeHTML } from '../utils.js';

// ==========================================
// LOKALT TILLSTÅND (State)
// ==========================================
/** @type {string|null} ID på den användare som just nu redigeras, annars null om vi skapar en ny */
let editingAdminId = null;
/** @type {Array} Lokal cache av användarlistan för att möjliggöra blixtsnabb sökning utan nätverksanrop */
let localAdmins = []; 

/**
 * Startar upp kontohanteringsfliken, binder knappar och laddar in listan.
 */
export function initUsersTab() {
    const admBtn = document.getElementById('addAdminBtn');
    const admCancel = document.getElementById('cancelAdminEditBtn');
    const admDisp = document.getElementById('newAdminDisplayName');
    const admFirst = document.getElementById('newAdminFirstName');
    const admLast = document.getElementById('newAdminLastName');
    const admEmail = document.getElementById('newAdminEmail');
    const admUser = document.getElementById('newAdminUser');
    const admPass = document.getElementById('newAdminPass');
    const admRole = document.getElementById('newAdminRole');
    const searchInput = document.getElementById('adminSearchInput'); 
    
    if (!admBtn) return;

    // ==========================================
    // SÄKERHET & BEHÖRIGHET
    // ==========================================
    // Dölj alternativet att skapa en "Super-Admin" om man själv bara är vanlig Admin
    const loggedInRole = (localStorage.getItem('userRole') || '').trim().toLowerCase();
    if (admRole && loggedInRole !== 'superadmin') {
        const superAdminOption = admRole.querySelector('option[value="superadmin"]');
        if (superAdminOption) {
            superAdminOption.remove(); 
        }
    }

    // ==========================================
    // RENDERING OCH SÖKNING
    // ==========================================
    /**
     * Laddar in och ritar ut listan med användare.
     * @param {boolean} skipFetch - Om true, hoppa över databasanropet och rendera bara den lokala cachen (används vid sökning).
     */
    const renderAdmins = async (skipFetch = false) => {
        if (!skipFetch) {
            const res = await fetchData('admins');
            localAdmins = (res?.success && Array.isArray(res.data)) ? res.data : [];
        }
        
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        
        // Filtrera listan om användaren har skrivit något i sökrutan
        let displayList = localAdmins;
        if (searchTerm) {
            displayList = localAdmins.filter(a => {
                const combinedText = `${a.first_name || ''} ${a.last_name || ''} ${a.display_name || ''} ${a.username || ''} ${a.role || ''}`.toLowerCase();
                return combinedText.includes(searchTerm);
            });
        }
        
        // Bygg tabellhuvudet (Sticky header)
        let html = `
        <div style="display:flex; padding: 10px 15px; background: #f5f5f5; border-bottom: 2px solid #ddd; font-weight: 600; font-size: 0.85rem; color: #555; text-transform: uppercase; position: sticky; top: 0; z-index: 10;">
            <div style="flex: 2; min-width: 150px;">Namn / Visningsnamn</div>
            <div style="flex: 1.5; min-width: 120px;">Användarnamn</div>
            <div style="flex: 1; min-width: 100px;">Roll</div>
            <div style="width: 80px; text-align: right;">Åtgärd</div>
        </div>
        `;

        if (displayList.length === 0) {
            html += `<div style="padding: 15px; text-align: center; color: #666;">Inga konton hittades som matchar sökningen.</div>`;
        } else {
            // Loopa igenom konton och rita ut raderna
            html += displayList.map(a => {
                // Skapa snygga etiketter (badges) för användarrollerna
                let roleBadge = '<span style="background:#e0e0e0; color:#333; padding:3px 8px; border-radius:12px; font-size:0.75em; font-weight:bold;">🧍 Användare</span>';
                if (a.role === 'admin') roleBadge = '<span style="background:#fff3e0; color:#e65100; padding:3px 8px; border-radius:12px; border: 1px solid #ffe0b2; font-size:0.75em; font-weight:bold;">🔧 Admin</span>';
                if (a.role === 'superadmin') roleBadge = '<span style="background:#f3e5f5; color:#4a148c; padding:3px 8px; border-radius:12px; border: 1px solid #e1bee7; font-size:0.75em; font-weight:bold;">👑 Super-Admin</span>';
                
                const fullName = `${escapeHTML(a.first_name || '')} ${escapeHTML(a.last_name || '')}`.trim() || "<em style='color:#999'>Namn saknas</em>";
                const displayNameSub = a.display_name ? `<br><span style="font-size:0.85em; color:#0277bd; font-weight: 600;">➔ Visas som: ${escapeHTML(a.display_name)}</span>` : "";
                
                return `
                <div class="admin-list-item" style="display: flex; align-items: center; padding: 12px 15px; border-bottom: 1px solid #eee; transition: background 0.2s; background: #fff;">
                    <div style="flex: 2; min-width: 150px; line-height: 1.5;">
                        <strong style="font-size: 1rem; color: #333;">${fullName}</strong>
                        ${displayNameSub}
                    </div>
                    <div style="flex: 1.5; min-width: 120px; color: #555; font-family: monospace; font-size: 0.95em;">
                        @${escapeHTML(a.username)}
                    </div>
                    <div style="flex: 1; min-width: 100px;">
                        ${roleBadge}
                    </div>
                    <div style="width: 80px; display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="list-btn" onclick="startEditAdmin('${a.id}')" title="Redigera" style="background:#f5f5f5;">✏️</button>
                        <button class="list-btn" onclick="deleteAdmin('${escapeHTML(String(a.id))}', '${escapeHTML(a.username)}')" title="Ta bort">🗑️</button>
                    </div>
                </div>`;
            }).join('');
        }
        
        document.getElementById('adminListContainer').innerHTML = html;
    };

    // Live-sökning: Rendera om listan vid varje knapptryck, men gör INGET nätverksanrop (skipFetch = true)
    if (searchInput) {
        searchInput.addEventListener('input', () => renderAdmins(true));
    }

    // ==========================================
    // GLOBALA HANDLINGAR (HTML Onclick)
    // ==========================================
    // Vi måste lägga dessa på globalThis eftersom knapparna renderas som 
    // HTML-strängar och annars inte hittar funktionerna.

    /**
     * Startar redigeringsläget för en befintlig användare.
     * Fyller formuläret med användarens nuvarande data.
     */
    globalThis.startEditAdmin = (id) => {
        const u = localAdmins.find(admin => String(admin.id) === String(id));
        if (!u) return;

        editingAdminId = u.id;
        admDisp.value = u.display_name || "";
        admFirst.value = u.first_name || "";
        admLast.value = u.last_name || "";
        admEmail.value = u.email || "";
        admUser.value = u.username;
        admRole.value = u.role || 'user';
        
        // Vid redigering är lösenordet valfritt att ändra
        admPass.placeholder = "Nytt lösenord (valfritt)";
        admPass.value = "";
        
        admBtn.innerText = "Spara Ändringar";
        admBtn.style.background = "#2196F3"; // Ändra färg för att markera "Edit Mode"
        admCancel.style.display = "inline-flex";
        
        // Scrolla mjukt upp till formuläret
        document.getElementById('newAdminDisplayName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    /**
     * Avbryter redigeringsläget och tömmer formuläret.
     */
    const resetAdm = () => {
        editingAdminId = null;
        admDisp.value = ""; admFirst.value = ""; admLast.value = ""; admEmail.value = "";
        admUser.value = ""; admPass.value = ""; admPass.placeholder = "Lösenord"; admRole.value = 'user';
        
        admBtn.innerText = "Spara / Skapa konto"; 
        admBtn.style.background = ""; 
        admCancel.style.display = "none";
        
        // Töm sökrutan och återställ hela listan
        if (searchInput) {
            searchInput.value = '';
            renderAdmins(true); 
        }
    };
    if (admCancel) admCancel.onclick = resetAdm;

    /**
     * Sparar formuläret mot databasen (hanterar BÅDE Skapa nytt och Redigera).
     */
    admBtn.onclick = async () => {
        if (!admUser.value) return showToast("Användarnamn krävs", "error");
        
        // Avgör rätt action-typ beroende på om vi redigerar eller skapar nytt
        const action = editingAdminId ? 'edit_admin' : 'add_admin';
        
        const payload = {
            id: editingAdminId,
            displayName: admDisp.value.trim(),
            firstName: admFirst.value.trim(),
            lastName: admLast.value.trim(),
            email: admEmail.value.trim(),
            username: admUser.value.trim(),
            password: admPass.value,
            role: admRole.value
        };

        const res = await apiAction(action, payload);

        if (res.success) {
            showToast("Användare sparad!", "success");
            resetAdm(); 
            renderAdmins(); // Hämta ny fräsch data från databasen
        } else {
            showToast(res.error || "Fel vid sparande", "error");
        }
    };

    /**
     * Raderar en användare från systemet efter bekräftelse.
     */
    globalThis.deleteAdmin = async (id, username) => {
        if (await showConfirm(`Ta bort kontot @${escapeHTML(username)}?`)) {
            const res = await apiAction('remove_admin', { id });
            
            if (res.success) {
                showToast("Användare raderad", "info");
                if (searchInput) searchInput.value = ''; // Rensa eventuell sökning
                renderAdmins(); 
            } else {
                showToast("Kunde inte radera användare", "error");
            }
        }
    };
    
    // ==========================================
    // INITIERING: Hämta data direkt när fliken öppnas
    // ==========================================
    renderAdmins();
}

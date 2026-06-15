import { fetchData, apiAction } from '../service.js';
import { showToast, showConfirm, escapeHTML } from '../utils.js';

let editingAdminId = null;
let localAdmins = []; // Hålls lokalt i denna modul

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

    // Dölj Super-Admin valet om man inte själv är Super-Admin
    const loggedInRole = (localStorage.getItem('userRole') || '').trim().toLowerCase();
    if (admRole && loggedInRole !== 'superadmin') {
        const superAdminOption = admRole.querySelector('option[value="superadmin"]');
        if (superAdminOption) {
            superAdminOption.remove(); 
        }
    }

    const renderAdmins = async (skipFetch = false) => {
        if (!skipFetch) {
            let admins = await fetchData('admins');
            localAdmins = Array.isArray(admins) ? admins : []; 
        }
        
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        
        let displayList = localAdmins;
        if (searchTerm) {
            displayList = localAdmins.filter(a => {
                const combinedText = `${a.first_name || ''} ${a.last_name || ''} ${a.display_name || ''} ${a.username || ''} ${a.role || ''}`.toLowerCase();
                return combinedText.includes(searchTerm);
            });
        }
        
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
            html += displayList.map(a => {
                let roleBadge = '<span style="background:#e0e0e0; color:#333; padding:3px 8px; border-radius:12px; font-size:0.75em; font-weight:bold;">🧍 Användare</span>';
                if(a.role === 'admin') roleBadge = '<span style="background:#fff3e0; color:#e65100; padding:3px 8px; border-radius:12px; border: 1px solid #ffe0b2; font-size:0.75em; font-weight:bold;">🔧 Admin</span>';
                if(a.role === 'superadmin') roleBadge = '<span style="background:#f3e5f5; color:#4a148c; padding:3px 8px; border-radius:12px; border: 1px solid #e1bee7; font-size:0.75em; font-weight:bold;">👑 Super-Admin</span>';
                
                const fullName = `${a.first_name || ''} ${a.last_name || ''}`.trim() || "<em style='color:#999'>Namn saknas</em>";
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
                        <button class="list-btn" onclick="deleteAdmin('${escapeHTML(a.username)}')" title="Ta bort" style="background:#ffebee; color: #d32f2f;">🗑️</button>
                    </div>
                </div>`;
            }).join('');
        }
        
        document.getElementById('adminListContainer').innerHTML = html;
    };

    if (searchInput) {
        searchInput.addEventListener('input', () => renderAdmins(true));
    }

    window.startEditAdmin = (id) => {
        const u = localAdmins.find(admin => String(admin.id) === String(id));
        if (!u) return;

        editingAdminId = u.id;
        admDisp.value = u.display_name || "";
        admFirst.value = u.first_name || "";
        admLast.value = u.last_name || "";
        admEmail.value = u.email || "";
        admUser.value = u.username;
        admRole.value = u.role || 'user';
        admPass.placeholder = "Nytt lösenord (valfritt)";
        admPass.value = "";
        admBtn.innerText = "Spara Ändringar";
        admBtn.style.background = "#2196F3";
        admCancel.style.display = "inline-flex";
        
        document.getElementById('newAdminDisplayName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const resetAdm = () => {
        editingAdminId = null;
        admDisp.value = ""; admFirst.value = ""; admLast.value = ""; admEmail.value = "";
        admUser.value = ""; admPass.value = ""; admPass.placeholder = "Lösenord"; admRole.value = 'user';
        admBtn.innerText = "Spara / Skapa konto"; admBtn.style.background = ""; admCancel.style.display = "none";
        
        if (searchInput) {
            searchInput.value = '';
            renderAdmins(true); 
        }
    };
    if(admCancel) admCancel.onclick = resetAdm;

    admBtn.onclick = async () => {
        if (!admUser.value) return showToast("Användarnamn krävs", "error");
        const action = editingAdminId ? 'edit_admin' : 'add_admin';
        
        const payload = {
            action, id: editingAdminId,
            displayName: admDisp.value.trim(),
            firstName: admFirst.value.trim(),
            lastName: admLast.value.trim(),
            email: admEmail.value.trim(),
            username: admUser.value.trim(),
            password: admPass.value,
            role: admRole.value
        };

        // Här används rå fetch istället för apiAction på grund av endpointens uppbyggnad i originalet
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast("Användare sparad!", "success");
            resetAdm(); renderAdmins(); 
        } else {
            const err = await res.json();
            showToast(err.error || "Fel vid sparande", "error");
        }
    };

    window.deleteAdmin = async (u) => {
        if (await showConfirm(`Ta bort kontot @${u}?`)) {
            await fetch('/api/data-api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove_admin', username: u })
            });
            
            if (searchInput) searchInput.value = '';
            renderAdmins(); 
        }
    };
    
    renderAdmins();
}

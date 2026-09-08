/**
 * ============================================================================
 * WORKPLACES.JS
 * Hanterar inställningsfliken för Super-Admins där man kan skapa nya 
 * isolerade arbetsplatser (t.ex. för olika städer eller avdelningar).
 * ============================================================================
 */

import { fetchData, apiAction } from '../service.js';
import { showToast, escapeHTML } from '../utils.js';

/**
 * Startar upp fliken för Arbetsplatser (Visas endast för superadmins).
 * Laddar in befintliga arbetsplatser och kopplar upp "Skapa ny"-knappen.
 */
export function initWorkplaceSettings() {
    const wpName = document.getElementById('newWorkplaceName');
    const wpBtn = document.getElementById('addWorkplaceBtn');
    
    /**
     * Hämtar listan över alla arbetsplatser från databasen och ritar 
     * upp dem i gränssnittet.
     */
    const renderWorkplaces = async () => {
        const res = await fetchData('workplaces');
        const wps = (res?.success && Array.isArray(res.data)) ? res.data : [];
        
        const cont = document.getElementById('workplaceListContainer');
        if (cont) {
            cont.innerHTML = wps.map(w => `
            <div class="admin-list-item">
                <div class="list-info-left">
                    <strong>${escapeHTML(w.name)}</strong> 
                    <span style="font-size:0.8rem; color:#888; margin-left:10px;">(ID: ${escapeHTML(String(w.id))})</span>
                </div>
            </div>`).join('');
        }
    };
    
    // Händelselyssnare för att skapa en ny arbetsplats
    if (wpBtn) {
        wpBtn.onclick = async () => {
            if (!wpName.value) return showToast("Ange ett namn", "info");
            
            await apiAction('save_workplace', { name: wpName.value, is_new: true });
            
            wpName.value = '';
            showToast("Arbetsplats skapad!", "success");
            
            // Uppdatera listan direkt så användaren ser resultatet
            renderWorkplaces();
            
            // Ladda om sidan efter 1.5 sekunder.
            // Detta är nödvändigt för att Super-Admins rullgardinsmeny (högst upp i fönstret)
            // ska fånga upp den nya arbetsplatsen och låta dem byta till den.
            setTimeout(() => window.location.reload(), 1500); 
        };
    }
    
    // Gör en initial laddning av listan när funktionen körs
    renderWorkplaces();
}

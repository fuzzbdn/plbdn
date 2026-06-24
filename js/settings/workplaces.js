import { fetchData, apiAction } from '../service.js';
import { showToast, escapeHTML } from '../utils.js';

export function initWorkplaceSettings() {
    const wpName = document.getElementById('newWorkplaceName');
    const wpBtn = document.getElementById('addWorkplaceBtn');
    
        const renderWorkplaces = async () => {
            const res = await fetchData('workplaces');
            let wps = (res?.success && Array.isArray(res.data)) ? res.data : [];
        
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
    
    if (wpBtn) {
        wpBtn.onclick = async () => {
            if (!wpName.value) return showToast("Ange ett namn", "info");
            await apiAction('save_workplace', { name: wpName.value, is_new: true });
            wpName.value = '';
            showToast("Arbetsplats skapad!", "success");
            renderWorkplaces();
            
            // Ladda om efter 1.5 sek så att backend-ändringarna får genomslag globalt
            setTimeout(() => window.location.reload(), 1500); 
        };
    }
    
    renderWorkplaces();
}

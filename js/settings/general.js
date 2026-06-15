import { fetchData, saveData } from '../service.js';
import { showToast } from '../utils.js';

export function initGeneralTab(currentSettings) {
    // 1. Hantering av Meddelanden på display-skärmen
    const msgIn = document.getElementById('displayMessageInput');
    const msgCheck = document.getElementById('showMessageCheckbox');
    const saveBtn = document.getElementById('saveMessageBtn');
    
    if (msgIn && msgCheck) {
        fetchData('message').then(msg => {
            if (msg) {
                msgIn.value = msg.text || "";
                msgCheck.checked = msg.show || false;
            }
        });
        
        if (saveBtn) {
            saveBtn.onclick = async () => {
                await saveData('message', { text: msgIn.value, show: msgCheck.checked });
                showToast("Meddelande uppdaterat!", "success");
            };
        }
    }

    // 2. Hantering av export-dagar
    const daysInp = document.getElementById('exportDefaultDaysInput');
    const saveMiscBtn = document.getElementById('saveMiscSettingsBtn');
    
    if (daysInp) {
        // Standard är 1 dag (idag) om inget annat sparats
        daysInp.value = currentSettings?.exportDefaultDays || 1; 
    }
    
    if (saveMiscBtn) {
        saveMiscBtn.onclick = async () => {
            const currentSets = await fetchData('settings') || {};
            // Tvinga till ett heltal, lägst 1
            currentSets.exportDefaultDays = Math.max(1, parseInt(daysInp.value) || 1);
            await saveData('settings', currentSets);
            showToast("Inställning sparad!", "success");
        };
    }
}

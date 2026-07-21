import { fetchData, saveData, apiAction } from '../service.js';
import { showToast } from '../utils.js';

export function initGeneralTab() {
    const msgIn = document.getElementById('messageInput');
    const msgCheck = document.getElementById('showMessageCheckbox');
    const saveMsgBtn = document.getElementById('saveMessageBtn');
    
    const daysIn = document.getElementById('exportDefaultDaysInput');
    const saveDaysBtn = document.getElementById('saveMiscSettingsBtn');
    
    const generateDisplayLinkBtn = document.getElementById('generateDisplayLinkBtn');
    const displayLinkContainer = document.getElementById('displayLinkContainer');
    const generatedDisplayLink = document.getElementById('generatedDisplayLink');
    const copyDisplayLinkBtn = document.getElementById('copyDisplayLinkBtn');

    // ==========================================
    // 0. INITIERA VÄRDEN VID LADDNING
    // ==========================================
    
    fetchData('settings').then(res => {
        if (res?.success && res.data) {
            if (daysIn) daysIn.value = res.data.exportDefaultDays || 1;
        }
    });

    fetchData('message').then(res => {
        if (res?.success && res.data) {
            if (msgIn) msgIn.value = res.data.text || "";
            if (msgCheck) msgCheck.checked = res.data.show || false;
        }
    });

    // ==========================================
    // 1. Hantering av Meddelande
    // ==========================================
    if (saveMsgBtn) {
        saveMsgBtn.onclick = async () => {
            const res = await saveData('message', { 
                text: msgIn ? msgIn.value : '', 
                show: msgCheck ? msgCheck.checked : false
            });
            
            if (res?.success) {
                showToast("Meddelande uppdaterat!", "success");
            } else {
                showToast(res?.error || "Kunde inte spara meddelande", "error");
            }
        };
    }

    // ==========================================
    // 2. Hantering av Export-inställningar
    // ==========================================
    if (saveDaysBtn) {
        saveDaysBtn.onclick = async () => {
            const newDays = Number.parseInt(daysIn ? daysIn.value : 1);
            if (Number.isNaN(newDays) || newDays < 1) return showToast("Ange ett giltigt antal dagar", "error");

            const res = await fetchData('settings');
            const currentSets = res?.success ? (res.data || {}) : {};
            
            currentSets.exportDefaultDays = newDays;
            
            const saveRes = await saveData('settings', currentSets);
            if (saveRes?.success) {
                showToast("Inställningar sparade!", "success");
            } else {
                showToast("Kunde inte spara inställningar", "error");
            }
        };
    }

    // ==========================================
    // 3. Generering av Displaylänk (JWT-baserad)
    // ==========================================
    if (generateDisplayLinkBtn) {
        generateDisplayLinkBtn.onclick = async () => {
            const res = await apiAction('generate_display_link', {});
            
            if (res?.success) {
                const origin = window.location.origin;
                let pathname = window.location.pathname.replace('settings.html', '').replace('admin.html', '');
                if (!pathname.endsWith('/')) pathname += '/';

                const link = `${origin}${pathname}display.html?token=${encodeURIComponent(res.token)}`;
                
                if (generatedDisplayLink) generatedDisplayLink.value = link;
                if (displayLinkContainer) displayLinkContainer.style.display = 'block';
                showToast("Säker länk genererad!", "success");
            } else {
                showToast(res?.error || "Kunde inte generera länk", "error");
            }
        };
    }

    if (copyDisplayLinkBtn) {
        copyDisplayLinkBtn.onclick = () => {
            if (!generatedDisplayLink) return;
            generatedDisplayLink.select();
            navigator.clipboard.writeText(generatedDisplayLink.value)
                .then(() => showToast("Länken kopierad!", "success"))
                .catch(() => showToast("Kunde inte kopiera", "error"));
        };
    }
}

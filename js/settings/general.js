import { fetchData, saveData, apiAction } from '../service.js';
import { showToast } from '../utils.js';

export function initGeneralTab() {
    const msgIn = document.getElementById('messageInput');
    const msgCheck = document.getElementById('showMessageCheck');
    const saveMsgBtn = document.getElementById('saveMessageBtn');
    
    const daysIn = document.getElementById('defaultDaysInput');
    const saveDaysBtn = document.getElementById('saveDaysBtn');
    
    const generateDisplayLinkBtn = document.getElementById('generateDisplayLinkBtn');
    const displayLinkContainer = document.getElementById('displayLinkContainer');
    const generatedDisplayLink = document.getElementById('generatedDisplayLink');
    const copyDisplayLinkBtn = document.getElementById('copyDisplayLinkBtn');

    // ==========================================
    // 0. INITIERA VÄRDEN VID LADDNING
    // ==========================================
    
    // Hämta export-inställningar
    fetchData('settings').then(res => {
        if (res?.success && res.data) {
            if (daysIn) daysIn.value = res.data.exportDefaultDays || 1;
        }
    });

    // Hämta meddelande
    fetchData('message').then(res => {
        if (res?.success && res.data) {
            msgIn.value = res.data.text || "";
            msgCheck.checked = res.data.show || false;
        }
    });

    // ==========================================
    // 1. Hantering av Meddelande
    // ==========================================
    saveMsgBtn.onclick = async () => {
        const res = await saveData('message', { 
            text: msgIn.value, 
            show: msgCheck.checked 
        });
        
        if (res?.success) {
            showToast("Meddelande uppdaterat!", "success");
        } else {
            showToast(res?.error || "Kunde inte spara meddelande", "error");
        }
    };

    // ==========================================
    // 2. Hantering av Export-inställningar
    // ==========================================
    saveDaysBtn.onclick = async () => {
        const newDays = parseInt(daysIn.value);
        if (isNaN(newDays) || newDays < 1) return showToast("Ange ett giltigt antal dagar", "error");

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

    // ==========================================
    // 3. Generering av Displaylänk (JWT-baserad)
    // ==========================================
    if (generateDisplayLinkBtn) {
        generateDisplayLinkBtn.onclick = async () => {
            // Anropa servern för att generera en säker JWT via vår nya action
            const res = await apiAction('generate_display_link', {});
            
            if (res?.success) {
                const origin = window.location.origin;
                let pathname = window.location.pathname.replace('settings.html', '').replace('admin.html', '');
                if (!pathname.endsWith('/')) pathname += '/';

                // Baka in den signerade JWT-tokenen i URL:en
                const link = `${origin}${pathname}display.html?token=${encodeURIComponent(res.token)}`;
                
                generatedDisplayLink.value = link;
                displayLinkContainer.style.display = 'block';
                showToast("Säker länk genererad!", "success");
            } else {
                showToast(res?.error || "Kunde inte generera länk", "error");
            }
        };
    }

    if (copyDisplayLinkBtn) {
        copyDisplayLinkBtn.onclick = () => {
            generatedDisplayLink.select();
            navigator.clipboard.writeText(generatedDisplayLink.value)
                .then(() => showToast("Länken kopierad!", "success"))
                .catch(() => showToast("Kunde inte kopiera", "error"));
        };
    }
}

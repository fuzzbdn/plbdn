/**
 * ============================================================================
 * GENERAL.JS (Admin/Inställningar)
 * Hanterar fliken "Allmänt & Meddelanden" under Inställningar.
 * Här styrs den rullande informationstexten (Marquee) på TV-skärmen,
 * standardinställningar för export, samt genereringen av säkra
 * display-länkar (JWT) för TV-skärmarna.
 * ============================================================================
 */

import { fetchData, saveData, apiAction } from '../service.js';
import { showToast } from '../utils.js';

/**
 * Initierar fliken för allmänna inställningar.
 * Hämtar sparade inställningar från servern och kopplar event-lyssnare till knapparna.
 */
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
    
    // Hämta inställningar för export
    fetchData('settings').then(res => {
        if (res?.success && res.data) {
            if (daysIn) daysIn.value = res.data.exportDefaultDays || 1;
        }
    });

    // Hämta rullande meddelande (Marquee)
    fetchData('message').then(res => {
        if (res?.success && res.data) {
            if (msgIn) msgIn.value = res.data.text || "";
            if (msgCheck) msgCheck.checked = res.data.show || false;
        }
    });

    // ==========================================
    // 1. HANTERING AV MEDDELANDE (TV-skärm)
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
    // 2. HANTERING AV EXPORT-INSTÄLLNINGAR
    // ==========================================
    if (saveDaysBtn) {
        saveDaysBtn.onclick = async () => {
            const newDays = Number.parseInt(daysIn ? daysIn.value : 1);
            if (Number.isNaN(newDays) || newDays < 1) {
                return showToast("Ange ett giltigt antal dagar", "error");
            }

            // Hämta befintliga inställningar först för att inte skriva över annat (t.ex. CSS-tema)
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
    // 3. GENERERING AV DISPLAYLÄNK (JWT)
    // ==========================================
    if (generateDisplayLinkBtn) {
        generateDisplayLinkBtn.onclick = async () => {
            // Begär en ny, säker token från servern
            const res = await apiAction('generate_display_link', {});
            
            if (res?.success) {
                const origin = window.location.origin;
                
                // Säkerställ att vi bygger rätt URL oavsett var vi befinner oss
                let pathname = window.location.pathname.replace('settings.html', '').replace('admin.html', '');
                if (!pathname.endsWith('/')) pathname += '/';

                // Sätt ihop den färdiga, klickbara länken med den krypterade biljetten
                const link = `${origin}${pathname}display.html?token=${encodeURIComponent(res.token)}`;
                
                if (generatedDisplayLink) generatedDisplayLink.value = link;
                if (displayLinkContainer) displayLinkContainer.style.display = 'block';
                
                showToast("Säker länk genererad!", "success");
            } else {
                showToast(res?.error || "Kunde inte generera länk", "error");
            }
        };
    }

    // Hanterar kopiering av länken till urklipp
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

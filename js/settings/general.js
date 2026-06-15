import { fetchData, saveData } from '../service.js';
import { showToast } from '../utils.js';

export function initGeneralTab(currentSettings) {
    // ==========================================
    // 1. Hantering av Meddelanden på display-skärmen
    // ==========================================
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

    // ==========================================
    // 2. Hantering av export-dagar
    // ==========================================
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
            const newDays = Math.max(1, parseInt(daysInp.value) || 1);
            currentSets.exportDefaultDays = newDays;
            
            await saveData('settings', currentSets);
            showToast("Inställning sparad!", "success");

            // -- NY KOD: Uppdatera Export-fliken live --
            // När vi sparar, hämtar vi datumfälten från Export-fliken och räknar om 
            // slutdatumet baserat på det nya värdet för antal dagar.
            const printStartDate = document.getElementById('printStartDate');
            const printEndDate = document.getElementById('printEndDate');
            
            if (printStartDate && printEndDate && printStartDate.value) {
                // Skapa ett datum-objekt från startdatumet
                const startD = new Date(printStartDate.value);
                // Lägg till de nya dagarna (minus 1 eftersom startdagen räknas)
                startD.setDate(startD.getDate() + (newDays - 1));
                
                // Formatera tillbaka till YYYY-MM-DD med hänsyn till lokal tidszon och uppdatera fältet
                const localDateStr = new Date(startD.getTime() - (startD.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                printEndDate.value = localDateStr;
            }
        };
    }

    // ==========================================
    // 3. Hantering av Displaylänk
    // ==========================================
    const generateDisplayLinkBtn = document.getElementById('generateDisplayLinkBtn');
    const displaySecretInput = document.getElementById('displaySecretInput');
    const displayLinkContainer = document.getElementById('displayLinkContainer');
    const generatedDisplayLink = document.getElementById('generatedDisplayLink');
    const copyDisplayLinkBtn = document.getElementById('copyDisplayLinkBtn');

    if (generateDisplayLinkBtn) {
        generateDisplayLinkBtn.onclick = () => {
            const secret = displaySecretInput.value.trim();
            
            if (!secret) {
                showToast("Du måste ange en display-nyckel!", "error");
                return;
            }

            // Skapa länken baserat på nuvarande domän, sökväg, arbetsplats och nyckeln
            const currentUrl = window.location.origin;
            const workplace = localStorage.getItem('activeWorkplace') || 'default';

            // Räkna ut korrekt bassökväg (fungerar även om appen ligger i en undermapp)
            let pathname = window.location.pathname;
            pathname = pathname.replace('settings.html', '').replace('admin.html', '');
            if (!pathname.endsWith('/')) pathname += '/';

            // Vi använder ?token= eftersom display.js förväntar sig det!
            const link = `${currentUrl}${pathname}display.html?token=${encodeURIComponent(secret)}&workplace=${encodeURIComponent(workplace)}`;
            
            generatedDisplayLink.value = link;
            displayLinkContainer.style.display = 'block';
            showToast("Länk genererad!", "success");
        };
    }

    // Kod för att kopiera länken när man klickar på "Kopiera länk"
    if (copyDisplayLinkBtn) {
        copyDisplayLinkBtn.onclick = () => {
            generatedDisplayLink.select();
            generatedDisplayLink.setSelectionRange(0, 99999);

            const fallbackCopy = () => {
                try {
                    document.execCommand('copy');
                    showToast("Länken kopierades till urklipp!", "success");
                } catch {
                    showToast("Kunde inte kopiera länken automatiskt", "error");
                }
            };

            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(generatedDisplayLink.value)
                    .then(() => showToast("Länken kopierades till urklipp!", "success"))
                    .catch(fallbackCopy);
            } else {
                fallbackCopy();
            }
        };
    }
}

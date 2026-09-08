/**
 * ============================================================================
 * CORE.JS (Admin/Inställningar)
 * Huvudfilen (dirigenten) för Inställningssidan (settings.html).
 * Denna fil laddas när användaren går in på inställningar. Den hämtar all 
 * nödvändig grunddata i en stor batch och startar därefter upp alla de
 * separata modulerna/flikarna.
 * ============================================================================
 */

import { showToast } from '../utils.js';
import { setAllInitialData } from '../store.js';
import { fetchData, apiAction } from '../service.js';

// Importera alla flik-moduler (Separation of Concerns)
import { initGeneralTab } from './general.js';
import { initWeatherTab } from './weather.js';
import { initStationsTab } from './stations.js';
import { initShiftsTab } from './shifts.js';
import { initThemeTab } from './theme.js';
import { initUsersTab } from './users.js';
import { initAbsencesTab } from './absences.js';
import { initExportTab } from './export.js';
import { initStatisticsTab } from './statistics.js';
import { initWorkplaceSettings } from './workplaces.js';

/**
 * Startar upp hela inställningsvyn.
 * Kastar ut obehöriga användare, hämtar all data, populerar det lokala
 * minnet (Store) och initierar varje enskild flik.
 */
export async function initSettings() {
    // Säkerhetskontroll (Client-side)
    const role = (localStorage.getItem('userRole') || '').trim().toLowerCase();
    
    if (role !== 'admin' && role !== 'superadmin') {
        window.location.href = "user.html";
        return;
    }

    // Skriv ut namnet på den inloggade i sidhuvudet
    const currentUserDisplay = document.getElementById('currentUserDisplay');
    if (currentUserDisplay) {
        currentUserDisplay.innerText = "Inloggad: " + (localStorage.getItem('adminName') || 'Admin');
    }

    // Hantera Utloggning
    document.getElementById('logoutBtn').onclick = async () => {
        await apiAction('logout', {});
        localStorage.clear(); 
        window.location.href = "index.html"; 
    };

    // Specialhantering för Super-Admins (Visar systemhanterings-fliken)
    if (role === 'superadmin') {
        const tabBtn = document.getElementById('tabBtnWorkplaces');
        if (tabBtn) tabBtn.style.display = 'flex';
        initWorkplaceSettings(); // Aktivera arbetsplatser-modulen
    }

    // ==========================================
    // DATA-HÄMTNING OCH INITIERING
    // ==========================================
    try {
        const todayStr = new Date().toISOString().split('T')[0];

        // Hämta ALL nödvändig grunddata för hela inställningssidan parallellt
        // (Mycket snabbare än att låta varje enskild flik hämta sin egen data sekventiellt)
        const [
            settingsRes, 
            themesRes, 
            stationsRes, 
            shiftsRes, 
            scheduleRes, 
            usersRes, 
            absencesRes
        ] = await Promise.all([
            fetchData('settings'),
            fetchData('custom_themes'),
            fetchData('stations'),
            fetchData('shifts'),
            fetchData('schedule', { start_date: todayStr, end_date: todayStr }),
            fetchData('users'),
            fetchData('absences')
        ]);

        // Populera vår "Single Source of Truth" (Store.js) så all data finns i minnet
        setAllInitialData({
            users:        usersRes?.success     ? usersRes.data     : [],
            stations:     stationsRes?.success  ? stationsRes.data  : [],
            shifts:       shiftsRes?.success    ? shiftsRes.data    : [],
            absences:     absencesRes?.success  ? absencesRes.data  : [],
            themes:       themesRes?.success    ? themesRes.data    : [],
            scheduleData: scheduleRes?.success  ? scheduleRes.data  : []
        });

        // Plocka ut det generella inställnings-objektet (Settings JSON)
        const currentSettings = settingsRes?.success ? settingsRes.data : {};

        // Starta alla under-moduler
        initGeneralTab();
        initWeatherTab();
        initStationsTab();
        initShiftsTab();
        initThemeTab(currentSettings); // Theme-tab behöver veta vilket tema som är aktivt
        initUsersTab();
        initAbsencesTab();
        initExportTab(currentSettings); // Export-tab behöver veta default-antal dagar
        initStatisticsTab();

    } catch (e) {
        console.error(e);
        showToast("Kunde inte ladda alla inställningar", "error");
    }
}

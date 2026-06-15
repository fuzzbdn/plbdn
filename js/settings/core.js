import { fetchData } from '../service.js';
import { showToast } from '../utils.js';
import { setAllInitialData } from '../store.js';

// Importera alla dina nya fina flik-moduler:
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

export async function initSettings() {
    const role = (localStorage.getItem('userRole') || '').trim().toLowerCase();
    
    if (role !== 'admin' && role !== 'superadmin') {
        window.location.href = "user.html";
        return;
    }

    const currentUserDisplay = document.getElementById('currentUserDisplay');
    if (currentUserDisplay) {
        currentUserDisplay.innerText = "Inloggad: " + (localStorage.getItem('adminName') || 'Admin');
    }

    document.getElementById('logoutBtn').onclick = () => { 
        localStorage.clear(); 
        window.location.href = "index.html"; 
    };

    if (role === 'superadmin') {
        const tabBtn = document.getElementById('tabBtnWorkplaces');
        if (tabBtn) tabBtn.style.display = 'flex';
        initWorkplaceSettings(); // Aktivera arbetsplatser!
    }

    try {
        const todayStr = new Date().toISOString().split('T')[0];

        const [settings, themes, stations, shifts, scheduleData, users, absences] = await Promise.all([
            fetchData('settings'),
            fetchData('custom_themes'),
            fetchData('stations'),
            fetchData('shifts'),
            fetchData('schedule', `&start_date=${todayStr}&end_date=${todayStr}`),
            fetchData('users'),
            fetchData('absences')
        ]);

        setAllInitialData({
            users, stations, shifts, absences, themes, scheduleData
        });

        // Starta upp alla flikarna!
        initGeneralTab(settings);
        initWeatherTab();
        initStationsTab();
        initShiftsTab();
        initThemeTab(settings);
        initUsersTab();
        initAbsencesTab();
        initExportTab(settings);
        initStatisticsTab();

    } catch (e) {
        console.error(e);
        showToast("Kunde inte ladda alla inställningar", "error");
    }
}

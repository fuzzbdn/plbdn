import { fetchData } from '../service.js';
import { showToast } from '../utils.js';
import { setAllInitialData } from '../store.js';
import { initStationsTab } from './stations.js';
import { initShiftsTab } from './shifts.js';
import { initUsersTab } from './users.js';
import { initAbsencesTab } from './absences.js';

// Importera logiken för varje enskild flik
import { initGeneralTab } from './general.js';
// (Du kommer lägga till fler importer här senare, t.ex. initStationsTab, initUsersTab osv)

export async function initSettings() {
    // 1. Säkerhetskontroll (Klient-sida)
    const role = (localStorage.getItem('userRole') || '').trim().toLowerCase();
    
    if (role !== 'admin' && role !== 'superadmin') {
        window.location.href = "user.html";
        return;
    }

    // Uppdatera UI med inloggad användare
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
        // initWorkplaceSettings(); // Vi bygger denna i en egen fil senare
    }

    // 2. Hämta all data parallellt
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

        // 3. Spara ALL data i vår nya globala store!
        setAllInitialData({
            users,
            stations,
            shifts,
            absences,
            themes,
            scheduleData // Obs: du behöver skicka in denna på rätt sätt till storen enligt den vi byggde
        });

        // 4. Initiera alla flikar och skicka med nödvändig inställningsdata
        initGeneralTab(settings);
        
        // Här kommer resten sen:
        // initWeatherTab();
        initStationsTab();
        initShiftsTab();
        // initAdminsTab();
        initUsersTab();
        initAbsencesTab();
        // initThemeTab(settings);
        // initExportTab(settings);
        // initStatisticsTab();

    } catch (e) {
        console.error(e);
        showToast("Kunde inte ladda alla inställningar", "error");
    }
}

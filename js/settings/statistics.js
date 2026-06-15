import { fetchData } from '../service.js';
import { showToast, escapeHTML } from '../utils.js';
import { getStations } from '../store.js';

export function initStatisticsTab() {
    const btn = document.getElementById('loadStatsBtn');
    const startInp = document.getElementById('statsStartDate');
    const endInp = document.getElementById('statsEndDate');
    const resultsContainer = document.getElementById('statsResultsContainer');

    if (!btn || !startInp || !endInp || !resultsContainer) return;

    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    
    startInp.value = new Date(firstDay.getTime() - (firstDay.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    endInp.value = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    btn.onclick = async () => {
        const sDate = startInp.value;
        const eDate = endInp.value;

        if (!sDate || !eDate) return showToast("Välj både start- och slutdatum", "error");
        if (sDate > eDate) return showToast("Startdatum kan inte vara efter slutdatum", "error");

        resultsContainer.innerHTML = '<div style="padding: 30px; text-align: center; font-weight: bold; color: #0277bd;">Hämtar och beräknar data... ⏳</div>';

        try {
            const scheduleData = await fetchData('schedule', `&start_date=${sDate}&end_date=${eDate}`);
            
            if (!scheduleData || scheduleData.length === 0) {
                resultsContainer.innerHTML = '<div style="padding: 30px; text-align: center; color: #666;">Inga schemalagda pass hittades under denna period.</div>';
                return;
            }

            const publishedShifts = scheduleData.filter(s => s.is_published);

            if (publishedShifts.length === 0) {
                resultsContainer.innerHTML = '<div style="padding: 30px; text-align: center; color: #666;">Inga <b>publicerade</b> pass hittades under denna period.</div>';
                return;
            }

            const userStats = {};
            const stations = getStations(); // Hämta från Store
            
            publishedShifts.forEach(shift => {
                const uid = shift.user_id;
                
                if (!userStats[uid]) {
                    userStats[uid] = {
                        name: shift.display_name || `${shift.first_name || ''} ${shift.last_name || ''}`.trim() || 'Okänd Användare',
                        totalShifts: 0,
                        stations: {}
                    };
                }
                
                userStats[uid].totalShifts++; 
                const stationName = stations.find(s => s.id === shift.station_id)?.name || 'Borttagen plats';
                userStats[uid].stations[stationName] = (userStats[uid].stations[stationName] || 0) + 1;
            });

            const sortedUsers = Object.values(userStats).sort((a, b) => b.totalShifts - a.totalShifts);

            let html = `
            <div style="display:flex; padding: 12px 15px; background: #f5f5f5; border-bottom: 2px solid #ddd; font-weight: 800; font-size: 0.85rem; color: #555; text-transform: uppercase; position: sticky; top: 0; z-index: 10;">
                <div style="flex: 2;">Personal</div>
                <div style="flex: 1; text-align: center;">Totalt Antal Pass</div>
                <div style="flex: 3; padding-left: 15px;">Fördelning av platser</div>
            </div>
            `;

            sortedUsers.forEach(user => {
                const topStations = Object.entries(user.stations)
                    .map(([name, count]) => `<span style="display:inline-block; background:#e3f2fd; color:#0277bd; padding:2px 6px; border-radius:4px; font-size:0.8rem; margin: 2px 4px 2px 0;">${escapeHTML(name)}: <b>${count}</b></span>`)
                    .join(' ');
                    
                html += `
                <div class="admin-list-item" style="display: flex; align-items: center; padding: 12px 15px; border-bottom: 1px solid #eee; background: #fff; transition: background 0.2s;">
                    <div style="flex: 2; font-weight: bold; color: #333; font-size: 1rem;">
                        ${escapeHTML(user.name)}
                    </div>
                    <div style="flex: 1; text-align: center; font-size: 1.3rem; font-weight: 800; color: #0277bd;">
                        ${user.totalShifts}
                    </div>
                    <div style="flex: 3; padding-left: 15px;">
                        ${topStations}
                    </div>
                </div>`;
            });

            html += `
            <div style="padding: 15px; background: #e8f5e9; text-align: right; font-weight: bold; color: #2e7d32; border-top: 2px solid #c8e6c9;">
                Totalt publicerade pass i perioden: ${publishedShifts.length} st
            </div>`;

            resultsContainer.innerHTML = html;

        } catch (err) {
            console.error("Fel vid statistik:", err);
            resultsContainer.innerHTML = '<div style="padding: 30px; text-align: center; color: #d32f2f; font-weight:bold;">Kunde inte hämta statistik. Kontrollera din anslutning.</div>';
        }
    };
}

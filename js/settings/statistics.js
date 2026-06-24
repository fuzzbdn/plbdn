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

        resultsContainer.innerHTML = '<div class="stats-loading">Hämtar och beräknar data... ⏳</div>';

        try {
            const response = await fetchData('schedule', { start_date: sDate, end_date: eDate });
            
            // --- FELHANTERING: Kontrollera API-svaret direkt ---
            if (!response?.success) {
                resultsContainer.innerHTML = `<div class="stats-error">${escapeHTML(response?.error || 'Kunde inte hämta statistik.')}</div>`;
                return;
            }

            // --- DATA-EXTRAHERING ---
            const scheduleData = response.data;
            
            if (!scheduleData || scheduleData.length === 0) {
                resultsContainer.innerHTML = '<div class="stats-empty">Inga schemalagda pass hittades under denna period.</div>';
                return;
            }

            const publishedShifts = scheduleData.filter(s => s.is_published);

            if (publishedShifts.length === 0) {
                resultsContainer.innerHTML = '<div class="stats-empty">Inga <b>publicerade</b> pass hittades under denna period.</div>';
                return;
            }

            const userStats = {};
            const stations = getStations(); 
            
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

            // --- RENDERING (Nu med rena CSS-klasser) ---
            let html = `
            <div class="stats-header-row">
                <div class="stats-col-name">Personal</div>
                <div class="stats-col-total">Totalt Antal Pass</div>
                <div class="stats-col-dist">Fördelning av platser</div>
            </div>
            `;

            sortedUsers.forEach(user => {
                const topStations = Object.entries(user.stations)
                    .map(([name, count]) => `<span class="stats-badge">${escapeHTML(name)}: <b>${count}</b></span>`)
                    .join(' ');
                    
                html += `
                <div class="admin-list-item stats-row">
                    <div class="stats-col-name stats-name-text">
                        ${escapeHTML(user.name)}
                    </div>
                    <div class="stats-col-total stats-count-text">
                        ${user.totalShifts}
                    </div>
                    <div class="stats-col-dist">
                        ${topStations}
                    </div>
                </div>`;
            });

            html += `
            <div class="stats-summary-footer">
                Totalt publicerade pass i perioden: ${publishedShifts.length} st
            </div>`;

            resultsContainer.innerHTML = html;

        } catch (err) {
            // Detta fångar nu endast oväntade javascript-krascher, inte nätverksfel
            console.error("Internt fel vid statistik:", err);
            resultsContainer.innerHTML = '<div class="stats-error">Ett internt fel uppstod vid beräkning av statistiken.</div>';
        }
    };
}

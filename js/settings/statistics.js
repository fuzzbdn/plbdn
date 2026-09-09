/**
 * ============================================================================
 * STATISTICS.JS
 * Hanterar statistik-fliken under Inställningar.
 * Detta är ett analytiskt verktyg (MTO - Man-Teknik-Organisation) för chefer 
 * för att spåra arbetsbelastning, frånvaro och säkerställa en rättvis 
 * fördelning av helgpass bland personalen.
 * ============================================================================
 */

import { fetchData } from '../service.js';
import { showToast, escapeHTML } from '../utils.js';
import { getStations } from '../store.js';

/**
 * Initierar fliken för statistik.
 * Sätter upp datumväljare med förvalda datum (från månadens start till idag)
 * och binder logiken för att hämta och kalkylera datan.
 */
export function initStatisticsTab() {
    const btn = document.getElementById('loadStatsBtn');
    const startInp = document.getElementById('statsStartDate');
    const endInp = document.getElementById('statsEndDate');
    const resultsContainer = document.getElementById('statsResultsContainer');

    if (!btn || !startInp || !endInp || !resultsContainer) return;

    // ==========================================
    // 1. Sätt förvalda datum (1:a i månaden -> Idag)
    // ==========================================
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Använd tidszonsoffset för att säkerställa att datumsträngen (YYYY-MM-DD) blir rätt i svensk tid
    startInp.value = new Date(firstDay.getTime() - (firstDay.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    endInp.value = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    // ==========================================
    // 2. Hantera hämtning och uträkning
    // ==========================================
    btn.onclick = async () => {
        const sDate = startInp.value;
        const eDate = endInp.value;

        // Validering av indata
        if (!sDate || !eDate) return showToast("Välj både start- och slutdatum", "error");
        if (sDate > eDate) return showToast("Startdatum kan inte vara efter slutdatum", "error");

        resultsContainer.innerHTML = '<div class="stats-loading">Hämtar och beräknar data... ⏳</div>';

        try {
            // Hämta BÅDE schema och frånvaro parallellt för maximal prestanda
            const [scheduleRes, absencesRes] = await Promise.all([
                fetchData('schedule', { start_date: sDate, end_date: eDate }),
                fetchData('absences')
            ]);
            
            if (!scheduleRes?.success) {
                resultsContainer.innerHTML = `<div class="stats-error">${escapeHTML(scheduleRes?.error || 'Kunde inte hämta schema.')}</div>`;
                return;
            }

            const scheduleData = scheduleRes.data;
            const absencesData = absencesRes?.success ? absencesRes.data : [];
            
            if (!scheduleData || scheduleData.length === 0) {
                resultsContainer.innerHTML = '<div class="stats-empty">Inga schemalagda pass hittades under denna period.</div>';
                return;
            }

            // Filtrera ut pass som bara är "utkast" - statistiken ska bara bygga på det som personalen faktiskt ser/jobbar
            const publishedShifts = scheduleData.filter(s => s.is_published);

            if (publishedShifts.length === 0) {
                resultsContainer.innerHTML = '<div class="stats-empty">Inga <b>publicerade</b> pass hittades under denna period.</div>';
                return;
            }

            // ==========================================
            // 3. MTO-Logik & Data-aggregering
            // ==========================================
            
            // Räkna ut hur många dagar perioden är. 
            // Används för att bedöma om någon har orimligt hög arbetsbelastning.
            const daysInPeriod = Math.round((new Date(eDate) - new Date(sDate)) / (1000 * 60 * 60 * 24)) + 1;
            // Kalkyl: Snitt på 5 dagar per vecka är hälsosamt. Allt över detta flaggas.
            const maxHealthyShifts = Math.ceil((daysInPeriod / 7) * 5); 

            /** @type {Object<string, Object>} Ett uppslagsverk (Dictionary) med varje persons uppbyggda statistik */
            const userStats = {};
            const stations = getStations(); 
            
            // A. Processa alla publicerade arbetspass
            publishedShifts.forEach(shift => {
                const uid = shift.user_id;
                
                // Initiera personens objekt om det är första gången vi stöter på dem i loopen
                if (!userStats[uid]) {
                    userStats[uid] = {
                        name: shift.display_name || `${shift.first_name || ''} ${shift.last_name || ''}`.trim() || 'Okänd Användare',
                        totalShifts: 0,
                        weekendShifts: 0,
                        stations: {},
                        absences: {}
                    };
                }
                
                userStats[uid].totalShifts++; 
                
                // Kontrollera rättvisa för obekväm arbetstid: Inföll passet på en Lördag (6) eller Söndag (0)?
                const workDate = new Date(shift.work_date);
                if (workDate.getDay() === 0 || workDate.getDay() === 6) {
                    userStats[uid].weekendShifts++;
                }

                // Vilken station/arbetsuppgift utfördes?
                const stationName = stations.find(s => s.id === shift.station_id)?.name || 'Borttagen plats';
                userStats[uid].stations[stationName] = (userStats[uid].stations[stationName] || 0) + 1;
            });

            // B. Processa frånvaro (Sjuk, Semester, VAB)
            absencesData.forEach(abs => {
                // Kolla om frånvaron överlappar med den period chefen söker på
                if (abs.start_date <= eDate && abs.end_date >= sDate) {
                    const uid = abs.user_id;
                    // Registrera frånvaron (endast om personen ifråga hade några arbetspass, för att hålla listan ren)
                    if (userStats[uid]) {
                        userStats[uid].absences[abs.type] = (userStats[uid].absences[abs.type] || 0) + 1;
                    }
                }
            });

            // Sortera listan så att personen som jobbat mest hamnar högst upp (MTO-fokus)
            const sortedUsers = Object.values(userStats).sort((a, b) => b.totalShifts - a.totalShifts);

            // ==========================================
            // 4. Rendering (HTML Generering)
            // ==========================================
            let html = `
            <div class="stats-header-row" style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 3fr; gap: 10px; font-weight: bold; border-bottom: 2px solid #ccc; padding-bottom: 8px; margin-bottom: 10px;">
                <div>Personal</div>
                <div title="Totalt antal pass i perioden">Totalt Pass</div>
                <div title="Pass som infaller på lördag eller söndag">Helgpass</div>
                <div title="Registrerad frånvaro i perioden">Frånvaro</div>
                <div>Fördelning (Platser)</div>
            </div>
            `;

            sortedUsers.forEach(user => {
                // Bygg grafiska etiketter (badges) för stationer
                const topStations = Object.entries(user.stations)
                    .map(([name, count]) => `<span class="stats-badge" style="background:#e3f2fd; color:#0277bd; padding:2px 6px; border-radius:4px; font-size:0.85rem; margin-right:4px; display:inline-block;">${escapeHTML(name)}: <b>${count}</b></span>`)
                    .join('');

                // Bygg grafiska etiketter (badges) för frånvaro
                const absencesHtml = Object.entries(user.absences)
                    .map(([type, count]) => `<span style="background:#ffebee; color:#c62828; padding:2px 4px; border-radius:4px; font-size:0.8rem; margin-right:4px;">${escapeHTML(type)} (${count})</span>`)
                    .join('');
                
                // MTO-varning: Flaggar om personen ligger över rekommenderad snittbelastning (>5 dagar/vecka)
                const isOverworked = user.totalShifts > maxHealthyShifts;
                const shiftColor = isOverworked ? 'color: #d32f2f; font-weight: bold;' : '';
                const warningIcon = isOverworked ? ' <span title="Varning: Hög arbetsbelastning i perioden">⚠️</span>' : '';
                    
                html += `
                <div class="admin-list-item stats-row" style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 3fr; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee;">
                    <div class="stats-name-text">
                        <strong>${escapeHTML(user.name)}</strong>
                    </div>
                    <div class="stats-count-text" style="${shiftColor}">
                        ${user.totalShifts} ${warningIcon}
                    </div>
                    <div class="stats-weekend-text" style="color: #ef6c00;">
                        ${user.weekendShifts > 0 ? user.weekendShifts : '-'}
                    </div>
                    <div class="stats-absence-text">
                        ${absencesHtml || '<span style="color:#aaa;">-</span>'}
                    </div>
                    <div class="stats-col-dist">
                        ${topStations}
                    </div>
                </div>`;
            });

            // Summerande fot (bra för övergripande ekonomisk och logistisk översikt)
            html += `
            <div class="stats-summary-footer" style="margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px; text-align: right; color: #555;">
                <strong>Summering:</strong> ${publishedShifts.length} schemalagda pass fördelat på ${sortedUsers.length} anställda under ${daysInPeriod} dagar.
            </div>`;

            resultsContainer.innerHTML = html;

        } catch (err) {
            console.error("Internt fel vid statistik:", err);
            resultsContainer.innerHTML = '<div class="stats-error">Ett internt fel uppstod vid beräkning av statistiken.</div>';
        }
    };
}

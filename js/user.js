import { fetchData } from './service.js';
import { isLight, escapeHTML } from './utils.js';
import { DAYS } from './config.js';

let globalScheduleData = {};
let globalUserList = [];
let globalStations = [];
let globalShifts = [];
let showOnlyMe = false;
let datesOfWeek = [];

export async function initUserView() {
    const userId = sessionStorage.getItem('userId');
    const name = sessionStorage.getItem('adminName');
    
    if (!sessionStorage.getItem('jwtToken')) {
        window.location.href = "index.html"; return;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (name || 'Användare');
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href = "index.html"; };

    // Hantera filter-knappen
    const filterBtn = document.getElementById('toggleMyScheduleBtn');
    if (filterBtn) {
        filterBtn.onclick = () => {
            showOnlyMe = !showOnlyMe;
            filterBtn.innerText = showOnlyMe ? "👥 Visa alla" : "👤 Visa endast mitt schema";
            filterBtn.style.backgroundColor = showOnlyMe ? "#455a64" : "#0277bd";
            renderUserWeeklyView();
        };
    }

    try {
        const today = new Date();
        const start = new Date(today);
        start.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
        const end = new Date(start);
        end.setDate(start.getDate() + 6);

        const tzoffset = start.getTimezoneOffset() * 60000;
        const startStr = (new Date(start.getTime() - tzoffset)).toISOString().split('T')[0];
        const endStr = (new Date(end.getTime() - tzoffset)).toISOString().split('T')[0];

        datesOfWeek = [];
        for(let i=0; i<7; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            datesOfWeek.push((new Date(d.getTime() - tzoffset)).toISOString().split('T')[0]);
        }

        const [users, stations, shifts, schedule] = await Promise.all([
            fetchData('users'), 
            fetchData('stations'), 
            fetchData('shifts'),
            fetchData('schedule', `&start_date=${startStr}&end_date=${endStr}`)
        ]);

        globalUserList = users || [];
        globalStations = stations || [];
        globalShifts = shifts || [];
        
        globalScheduleData = {};
        if (Array.isArray(schedule)) {
            schedule.forEach(row => {
                if(row.is_published) { // VISAR ENDAST PUBLICERAT
                    const date = row.work_date.split('T')[0];
                    const key = `${date}_${row.user_id}`;
                    if (!globalScheduleData[key]) globalScheduleData[key] = [];
                    globalScheduleData[key].push(row);
                }
            });
        }

        renderUserWeeklyView();
    } catch (e) {
        console.error("Fel vid hämtning av schema", e);
    }
}

function renderUserWeeklyView() {
    const cont = document.getElementById('userWeeklyContainer');
    if (!cont) return;
    
    const myId = sessionStorage.getItem('userId');
    
    const usersToShow = showOnlyMe 
        ? globalUserList.filter(u => String(u.id) === String(myId))
        : globalUserList;

    let html = '<div class="weekly-grid"><div class="weekly-header-row"><div class="weekly-user-name">Personal</div>';
    DAYS.forEach(day => html += `<div>${day}</div>`);
    html += `</div>`;

    if (usersToShow.length === 0 && showOnlyMe) {
        html += `<div style="padding: 20px; color: #666; font-style: italic;">Kunde inte hitta dina uppgifter.</div>`;
    } else {
        usersToShow.forEach(user => {
            const nameToShow = user.display_name || `${user.first_name} ${user.last_name || ''}`.trim();
            html += `<div class="weekly-user-row"><div class="weekly-user-name">${escapeHTML(nameToShow)}</div>`;
            
            for (let i = 0; i < 7; i++) {
                const dateStr = datesOfWeek[i];
                const key = `${dateStr}_${user.id}`;
                const assignments = globalScheduleData[key] || [];

                html += `<div class="weekly-cell">`;
                if (assignments.length === 0) {
                    html += `<span class="free-text">Ledig</span>`;
                } else {
                    assignments.forEach(a => {
                        const st = globalStations.find(s => s.id === a.station_id);
                        const sh = globalShifts.find(s => s.id === a.shift_id);
                        if(st && sh) {
                            const bg = st.color;
                            const fg = isLight(bg) ? '#000' : '#fff';
                            let shortLabel = sh.label.toLowerCase() === 'förmiddag' ? 'FM' : (sh.label.toLowerCase() === 'eftermiddag' ? 'EM' : sh.label);
                            html += `<div class="weekly-badge" style="background:${escapeHTML(bg)}; color:${fg};">${escapeHTML(st.name)} <span style="opacity:0.8; font-weight:normal;">(${escapeHTML(shortLabel)})</span></div>`;
                        }
                    });
                }
                html += `</div>`;
            }
            html += `</div>`; 
        });
    }
    html += '</div>'; 
    cont.innerHTML = html;
}

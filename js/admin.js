/* ==========================================================================
   IMPORTER & GLOBALA VARIABLER
   Här hämtas funktioner från andra filer och variabler skapas för att
   hålla reda på schemat, personal och status medan sidan är öppen.
   ========================================================================== */
import { fetchData, saveData } from './service.js';
import { showToast, showConfirm, getISOWeek, isLight } from './utils.js';
import { DEFAULT_STATIONS, DEFAULT_SHIFTS, DAYS } from './config.js';

let globalScheduleData = {};        // Det aktuella schemat vi arbetar i (oftast utkastet)
let publishedDataSnapshot = {};     // En kopia av det som ligger live (för att kunna jämföra ändringar)
let globalUserList = [];            // Lista på all personal
let globalStations = [];            // Lista på stationer
let globalShifts = [];              // Lista på tider/pass
let selectedWeek = 0;               // Vald vecka
let selectedYear = 0;               // Valt år
let currentAdminDayIndex = 0;       // Vilken dag i veckan (0-6) vi tittar på just nu

/* =========================================
   5. ADMIN PLANERING
   Detta är huvudfunktionen som startar hela admin-gränssnittet.
   ========================================= */
export async function initAdmin() {
    // Visa namnet på den som är inloggad
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    
    // 1. HÄMTA ALL DATA
    // Använder Promise.all för att hämta allt samtidigt (snabbare än en och en)
    try {
        const [users, draft, published, old, stations, shifts] = await Promise.all([
            fetchData('users'),
            fetchData('schedule_draft'),
            fetchData('schedule_published'),
            fetchData('schedule'),
            fetchData('config_stations'),
            fetchData('config_shifts')
        ]);

        // Sätt globala variabler (använd standardvärden om databasen är tom)
        globalUserList = Array.isArray(users) ? users : [];
        globalStations = (Array.isArray(stations) && stations.length) ? stations : DEFAULT_STATIONS;
        globalShifts = (Array.isArray(shifts) && shifts.length) ? shifts : DEFAULT_SHIFTS;
        
        // Spara en kopia av det publicerade schemat för att kunna upptäcka osparade ändringar
        publishedDataSnapshot = published || {}; 

        // Välj vilken data som ska visas: Utkast går före Publicerat, som går före Gammalt
        if(!draft || !Object.keys(draft).length) {
            globalScheduleData = (published && Object.keys(published).length) ? published : (old || {});
        } else {
            globalScheduleData = draft;
        }

        // (updateGrid anropas längst ner i funktionen, vilket ritar ut schemat)

    } catch (e) {
        console.error("Kunde inte hämta data:", e);
        showToast("Fel vid hämtning av data", "error");
    }

    // --- PUBLICERA-KNAPPEN ---
    // När man klickar här flyttas datan från "utkast" till "publicerat"
    document.getElementById('publishBtn').onclick = async () => {
        if(await showConfirm("Vill du publicera schemat till displayen?")) { 
            await saveData('schedule_published', globalScheduleData); 
            
            // Uppdatera "snapshoten" eftersom nuvarande vy nu är samma som live
            publishedDataSnapshot = JSON.parse(JSON.stringify(globalScheduleData));
            
            // Kontrollera status igen (detta kommer dölja den gula varningsbannern)
            checkPublishStatus();
            
            showToast("Schemat är publicerat!", "success"); 
        }
    };

    // --- DATUMVÄLJARE ---
    const picker = document.getElementById('adminDatePicker');
    picker.value = new Date().toISOString().split('T')[0]; // Sätt dagens datum som start
    
    // När man väljer nytt datum i kalendern
    picker.onchange = (e) => updateGrid(e.target.value);
    
    // --- PIL-NAVIGERING (Föregående/Nästa dag) ---
    const prevBtn = document.getElementById('prevDayBtn');
    const nextBtn = document.getElementById('nextDayBtn');
    
    if(prevBtn && nextBtn) {
        prevBtn.onclick = () => changeDate(-1);
        nextBtn.onclick = () => changeDate(1);
    }

    // Funktion för att ändra datum med +/- antal dagar
    function changeDate(days) {
        const currentVal = picker.value;
        if(!currentVal) return;
        
        const d = new Date(currentVal);
        d.setDate(d.getDate() + days); // Lägg till eller dra ifrån dagar
        
        // Formatera om till YYYY-MM-DD för input-fältet
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const newDateStr = `${yyyy}-${mm}-${dd}`;
        
        picker.value = newDateStr;
        updateGrid(newDateStr);
    }
    // ----------------------

    // Kör den första uppdateringen för att visa schemat vid start
    updateGrid(picker.value);

    // Logga ut-knapp
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };
    
    // Initiera funktionen för att lägga till personal i sidomenyn
    setupSidebarAddUser();
    
    // VIKTIGT: Gör dessa funktioner tillgängliga globalt (window)
    // Detta krävs eftersom HTML-koden använder `onclick="removeUser(...)"` etc.
    window.removeUser = removeUser;
    window.saveShift = saveShift;
    window.manualAdd = manualAdd;
    window.handleDrop = handleDrop;
    window.selectUser = selectUser;
    window.selectUserManual = selectUserManual;
}

/**
 * Uppdaterar variabler baserat på datum och ritar om hela gränssnittet.
 */
function updateGrid(dateStr) {
    const d = new Date(dateStr);
    const iso = getISOWeek(d);
    selectedWeek = iso.week; 
    selectedYear = iso.year;
    // Fixa så söndag (0) blir index 6, måndag (1) blir 0 (Svensk standard)
    currentAdminDayIndex = d.getDay() === 0 ? 6 : d.getDay() - 1;
    
    const dateDisplay = document.getElementById('currentDateDisplay');
    if(dateDisplay) {
        dateDisplay.innerText = `${DAYS[currentAdminDayIndex]} v.${selectedWeek}, ${selectedYear}`;
    }
    
    renderAdminGrid(); // Rita schemat
    renderRoster();    // Rita personallistan
    
    // VIKTIGT: Kontrollera publiceringsstatus varje gång vi byter dag
    // Detta tänder/släcker varningsbannern om ändringar inte är publicerade
    checkPublishStatus();
}

/**
 * Genererar HTML för själva schematabellen (Stationer vs Tider).
 */
function renderAdminGrid() {
    const cont = document.getElementById('scheduleContainer');
    if(!cont) return;

    const dayName = DAYS[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;

    // Skapa rubrikraden med tider
    let html = `<div class="header-row"><div></div>${globalShifts.map(s => `<div>${s.time}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        // Om det är en "spacer" (mellanrum), rita en tom rad
        if(st.isSpacer) { 
            html += `<div class="station-row" style="grid-column:1/-1; height:30px;"></div>`; 
            return; 
        }
        
        // Beräkna textfärg (kontrast) mot bakgrundsfärgen
        const contrast = isLight(st.color) ? '#000' : '#fff';
        const styles = `background-color:${st.color}; color:${contrast}; --station-color:${st.color};`; 
        
        // Rita stationens namn
        html += `<div class="station-row"><div class="station-label" style="${styles}">${st.name}</div>`;
        
        // Rita rutorna för varje tidspass
        globalShifts.forEach(sh => {
            const key = `${prefix}${st.name}-${sh.time}`; // Unik nyckel för cellen
            const val = globalScheduleData[key] || "";
            
            // Skapa HTML för rutan (med drag-and-drop events och knappar)
            html += `
            <div class="shift-block ${val?'':'empty'}" ondragover="event.preventDefault()" ondrop="handleDrop(event,'${key}')">
                <span class="shift-text" contenteditable="true" onblur="saveShift('${key}', this.innerText)">${val}</span>
                <div class="shift-controls">
                    <button class="add-user-btn" onclick="manualAdd(event, '${key}')" title="Lägg till">+</button>
                    ${val ? `<button class="clear-btn" onclick="saveShift('${key}', '')">×</button>`:''}
                </div>
            </div>`;
        });
        html += `</div>`;
    });
    cont.innerHTML = html;
}

/**
 * Renderar listan med personal i sidopanelen.
 * Sorterar listan så att de som redan jobbar hamnar längst ner och blir gråa.
 */
function renderRoster() {
    const list = document.getElementById('draggableUserList');
    if(!list) return;
    
    const dayName = DAYS[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;
    const work = new Set(); // Håller koll på vilka som jobbar idag
    
    // Gå igenom schemat för att se vem som jobbar
    Object.keys(globalScheduleData).forEach(k => { 
        if(k.startsWith(prefix) && globalScheduleData[k]) { 
            globalScheduleData[k].split('/').forEach(n => work.add(n.trim())); 
        }
    });

    // Sortera: Lediga först, upptagna sist
    const sortedUsers = [...globalUserList].sort((a, b) => {
        const aBusy = work.has(a);
        const bBusy = work.has(b);
        if (aBusy === bBusy) return a.localeCompare(b);
        return aBusy ? 1 : -1; 
    });

    // Skapa HTML-elementen (draggable)
    list.innerHTML = sortedUsers.map(u => {
        const isAssigned = work.has(u);
        const assignedClass = isAssigned ? 'assigned' : '';
        return `<div class="draggable-item ${assignedClass}" draggable="true" ondragstart="event.dataTransfer.setData('text','${u}')">${u} <button class="remove-user-btn" onclick="removeUser('${u}')">×</button></div>`;
    }).join('');
}

/**
 * Jämför nuvarande utkast med det senast publicerade schemat.
 * Visar en gul banner om det finns skillnader för DENNA dag.
 */
function checkPublishStatus() {
    const banner = document.getElementById('publishReminderBanner');
    if (!banner) return;

    const dayName = DAYS[currentAdminDayIndex];
    // Prefixet filtrerar så vi bara kollar aktuell dag (År+Vecka+Dag)
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;

    let currentViewChanged = false;

    // Helper för att hantera undefined/null som tomma strängar
    const val = (v) => (v || "").trim();

    // Samla alla nycklar som är relevanta för DENNA dag (från både utkast och publicerat)
    const relevantKeys = new Set();
    
    Object.keys(globalScheduleData).forEach(k => {
        if(k.startsWith(prefix)) relevantKeys.add(k);
    });
    Object.keys(publishedDataSnapshot).forEach(k => {
        if(k.startsWith(prefix)) relevantKeys.add(k);
    });

    // Jämför värdena
    for (const key of relevantKeys) {
        if (val(globalScheduleData[key]) !== val(publishedDataSnapshot[key])) {
            currentViewChanged = true;
            break;
        }
    }

    // Visa eller dölj bannern beroende på resultat
    if (currentViewChanged) {
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

/**
 * Sparar en ändring av ett pass till utkast-databasen.
 */
async function saveShift(k, v) { 
    globalScheduleData[k] = v.trim(); 
    await saveData('schedule_draft', globalScheduleData); 
    
    // Kontrollera status efter varje sparning (tänder bannern om skillnad uppstår)
    checkPublishStatus();
    
    renderAdminGrid(); 
    renderRoster(); 
}

/**
 * Hanterar när man släpper ett namn (drop) på en ruta.
 */
async function handleDrop(e, k) { 
    e.preventDefault(); 
    const n = e.dataTransfer.getData("text"); 
    let c = globalScheduleData[k] || ""; 
    // Lägg till namnet (med / om det redan finns namn)
    if(!c.includes(n)) await saveShift(k, c ? c + " / " + n : n); 
}

/**
 * Skapar dropdown-menyn (snabbval) när man klickar på "+" i en ruta.
 */
function manualAdd(e, key) {
    e.stopPropagation();
    const existing = document.getElementById('quick-dropdown');
    if (existing) existing.remove();

    const dayName = DAYS[currentAdminDayIndex];
    const prefix = `y${selectedYear}w${selectedWeek}-${dayName}-`;
    const busyUsers = new Set();
    
    // Lista ut vilka som redan jobbar denna dag
    Object.keys(globalScheduleData).forEach(k => { 
        if(k.startsWith(prefix) && globalScheduleData[k]) { 
            globalScheduleData[k].split('/').forEach(n => busyUsers.add(n.trim())); 
        }
    });
    
    // Filtrera fram ledig personal
    const availableUsers = globalUserList.filter(u => !busyUsers.has(u)).sort();

    // Bygg menyn
    const menu = document.createElement('div');
    menu.id = 'quick-dropdown';
    menu.className = 'dropdown-menu';
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY + 10}px`;

    let html = availableUsers.length > 0 
        ? availableUsers.map(u => `<div class="dropdown-item" onclick="selectUser('${key}', '${u}')">${u}</div>`).join('') 
        : `<div class="dropdown-item disabled">Ingen ledig</div>`;
    
    html += `<div class="dropdown-item manual" onclick="selectUserManual('${key}')">+ Skriv in eget namn...</div>`;
    menu.innerHTML = html;
    document.body.appendChild(menu);
    
    // Stäng menyn om man klickar utanför
    document.addEventListener('click', function closeMenu(evt) { 
        if (!menu.contains(evt.target)) menu.remove(); 
    }, { once: true });
}

// Lägger till vald användare från dropdown
async function selectUser(key, name) {
    const currentVal = globalScheduleData[key] || "";
    const newVal = currentVal ? currentVal + " / " + name : name;
    const menu = document.getElementById('quick-dropdown');
    if(menu) menu.remove();
    await saveShift(key, newVal);
}

// Hanterar manuell inmatning av namn (via prompt)
async function selectUserManual(key) {
    const menu = document.getElementById('quick-dropdown');
    if(menu) menu.remove();
    setTimeout(async () => {
        const name = prompt("Ange namn:");
        if (name) {
            const currentVal = globalScheduleData[key] || "";
            const newVal = currentVal ? currentVal + " / " + name : name;
            await saveShift(key, newVal);
        }
    }, 50);
}

/**
 * Kopplar logik till "Lägg till"-knappen i sidopanelen (för ny personal).
 */
function setupSidebarAddUser() {
    const btn = document.getElementById('sidebarAddBtn');
    const inp = document.getElementById('sidebarNewName');
    if(btn && inp) { 
        btn.onclick = async () => {
            if(inp.value){
                globalUserList.push(inp.value);
                globalUserList.sort();
                await saveData('users', globalUserList);
                showToast("Personal tillagd", "success");
                inp.value='';
                renderRoster();
            }
        }; 
        inp.onkeydown = e => { if(e.key==='Enter') btn.click(); } 
    }
}

/**
 * Tar bort en person helt från systemet.
 */
async function removeUser(u) { 
    if(await showConfirm('Ta bort '+u+'?')){
        globalUserList = globalUserList.filter(user => user !== u);
        await saveData('users', globalUserList);
        showToast("Personal borttagen", "info");
        renderRoster();
    } 
}

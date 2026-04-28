import { fetchData, saveData, apiAction } from './service.js';
import { showToast, showConfirm, escapeHTML } from './utils.js';

let globalStations = [], globalShifts = [], globalCustomThemes = [];
let editingStationId = null, editingShiftId = null, editingAdminId = null;

export async function initSettings() {
    if (sessionStorage.getItem('userRole') !== 'admin') {
        window.location.href = "user.html"; return;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };

    const [settings, themes, stations, shifts] = await Promise.all([
        fetchData('settings'), 
        fetchData('custom_themes'), 
        fetchData('stations'), 
        fetchData('shifts')
    ]);
    
    globalCustomThemes = themes || [];
    globalStations = Array.isArray(stations) ? stations : [];
    globalShifts = Array.isArray(shifts) ? shifts : [];

    initGeneralTab();
    initWeatherTab(); 
    initStationsSettings(); 
    initShiftsSettings(); 
    initAdminSettings();
}

function initGeneralTab() {
    const msgIn = document.getElementById('displayMessageInput');
    const msgCheck = document.getElementById('showMessageCheckbox');
    fetchData('message').then(msg => { if(msg) { msgIn.value = msg.text||""; msgCheck.checked = msg.show||false; } });
    document.getElementById('saveMessageBtn').onclick = async () => {
        await saveData('message', { text: msgIn.value, show: msgCheck.checked });
        showToast("Meddelande uppdaterat!", "success");
    };
}

function initWeatherTab() {
    // Samma kod som tidigare för väder...
    const hiddenName = document.getElementById('weatherCityName');
    const hiddenLat = document.getElementById('weatherLat');
    const hiddenLong = document.getElementById('weatherLong');
    fetchData('weather_config').then(data => {
        if(data && data.name) { document.getElementById('currentWeatherDisplay').innerHTML = `📍 <strong>${escapeHTML(data.name)}</strong>`; }
    });
    
    document.getElementById('saveWeatherBtn').onclick = async () => {
        await saveData('weather_config', { name: hiddenName.value, latitude: hiddenLat.value, longitude: hiddenLong.value });
        showToast("Plats sparad!", "success");
    };
}

// --- V2.0 STATIONER (Använder Riktiga ID) ---
function initStationsSettings() {
    const stName = document.getElementById('newStationName'), stColor = document.getElementById('newStationColor');
    const stBtn = document.getElementById('addStationBtn'), stCancel = document.getElementById('cancelStationEditBtn');

    const renderStations = () => {
        document.getElementById('stationListContainer').innerHTML = globalStations.map(st => {
            if(st.is_spacer) return `<div class="admin-list-item" style="background:#f9f9f9;"><i>--- Mellanrum ---</i> <button class="list-btn" onclick="deleteStation(${st.id})">🗑️</button></div>`;
            return `
            <div class="admin-list-item">
                <div class="list-info-left">
                    <div style="width:20px; height:20px; background:${escapeHTML(st.color)}; border-radius:50%; margin-right:10px;"></div>
                    <strong>${escapeHTML(st.name)}</strong>
                </div>
                <div class="list-actions-right">
                    <button class="list-btn" onclick="startEditStation(${st.id})">✏️</button>
                    <button class="list-btn" onclick="deleteStation(${st.id})">🗑️</button>
                </div>
            </div>`;
        }).join('');
    };

    window.startEditStation = (id) => {
        const st = globalStations.find(s => s.id === id);
        if(!st) return;
        editingStationId = id; stName.value = st.name; stColor.value = st.color;
        stBtn.innerText = "💾 Spara"; stBtn.style.background = "#2196F3"; stCancel.style.display = "inline-flex";
    };

    const resetSt = () => { editingStationId = null; stName.value = ""; stBtn.innerText = "+ Lägg till Station"; stBtn.style.background = ""; stCancel.style.display = "none"; };
    if(stCancel) stCancel.onclick = resetSt;

    stBtn.onclick = async () => {
        if(!stName.value) return showToast("Ange namn", "info");
        await apiAction('save_station', { id: editingStationId, name: stName.value, color: stColor.value, is_spacer: false });
        globalStations = await fetchData('stations'); renderStations(); resetSt(); showToast("Sparat", "success");
    };

    document.getElementById('addSpacerBtn').onclick = async () => { 
        await apiAction('save_station', { is_spacer: true });
        globalStations = await fetchData('stations'); renderStations(); 
    };

    window.deleteStation = async (id) => { 
        if(await showConfirm("Ta bort?")) { 
            await apiAction('delete_station', { id });
            globalStations = await fetchData('stations'); renderStations(); 
        }
    };
    renderStations();
}

// --- V2.0 ARBETSPASS ---
function initShiftsSettings() {
    const shLabel = document.getElementById('newShiftLabel'), shTime = document.getElementById('newShiftTime');
    const shBtn = document.getElementById('addShiftBtn'), shCancel = document.getElementById('cancelShiftEditBtn');

    const renderShifts = () => {
        document.getElementById('shiftListContainer').innerHTML = globalShifts.map(sh => `
        <div class="admin-list-item">
            <div class="list-info-left"><strong>${escapeHTML(sh.label)}</strong> <span style="color:#666; margin-left:5px;">(${escapeHTML(sh.time_range||'')})</span></div>
            <div class="list-actions-right">
                <button class="list-btn" onclick="startEditShift(${sh.id})">✏️</button>
                <button class="list-btn" onclick="deleteShift(${sh.id})">🗑️</button>
            </div>
        </div>`).join('');
    };
    
    window.startEditShift = (id) => { 
        const sh = globalShifts.find(s => s.id === id); if(!sh) return;
        editingShiftId = id; shLabel.value = sh.label; shTime.value = sh.time_range||""; 
        shBtn.innerText = "Spara"; shBtn.style.background = "#2196F3"; shCancel.style.display = "inline-flex"; 
    };

    const resetSh = () => { editingShiftId = null; shLabel.value = ""; shTime.value = ""; shBtn.innerText = "Lägg till Pass"; shBtn.style.background = ""; shCancel.style.display = "none"; };
    if(shCancel) shCancel.onclick = resetSh;

    shBtn.onclick = async () => { 
        if(!shLabel.value) return; 
        await apiAction('save_shift', { id: editingShiftId, label: shLabel.value, time_range: shTime.value }); 
        globalShifts = await fetchData('shifts'); renderShifts(); resetSh(); showToast("Sparat", "success"); 
    };

    window.deleteShift = async (id) => { 
        if(await showConfirm("Ta bort?")) { 
            await apiAction('delete_shift', { id });
            globalShifts = await fetchData('shifts'); renderShifts(); 
        }
    };
    renderShifts();
}

// --- V2.0 PERSONAL (ADMINS & ANVÄNDARE) ---
function initAdminSettings() {
    const admBtn = document.getElementById('addAdminBtn'), admCancel = document.getElementById('cancelAdminEditBtn');
    const admUser = document.getElementById('newAdminUser'), admPass = document.getElementById('newAdminPass');
    const admFirst = document.getElementById('newAdminFirstName'), admLast = document.getElementById('newAdminLastName');
    const admEmail = document.getElementById('newAdminEmail'), admRole = document.getElementById('newAdminRole'); 

    const renderAdmins = async () => {
        let admins = await fetchData('admins');
        document.getElementById('adminListContainer').innerHTML = admins.map(a => {
            const roleBadge = a.role === 'admin' ? '<span style="background:#ff9800; color:#fff; padding:2px 5px; border-radius:3px; font-size:0.7em;">Admin</span>' : '<span style="background:#4CAF50; color:#fff; padding:2px 5px; border-radius:3px; font-size:0.7em;">User</span>';
            return `
            <div class="admin-list-item">
                <div class="list-info-left"><strong>${escapeHTML(a.username)}</strong> ${roleBadge} <span style="color:#666; margin-left:5px; font-size:0.9em;">(${escapeHTML(a.first_name||'')} ${escapeHTML(a.last_name||'')})</span></div>
                <div class="list-actions-right">
                    <button class="list-btn" onclick='startEditAdmin(${JSON.stringify(a).replace(/'/g, "&#39;")})'>✏️</button>
                    <button class="list-btn" onclick="deleteAdmin('${escapeHTML(a.username)}')">🗑️</button>
                </div>
            </div>`;
        }).join('');
    };

    window.startEditAdmin = (u) => {
        editingAdminId = u.id; admUser.value = u.username; admFirst.value = u.first_name||""; admLast.value = u.last_name||""; 
        admEmail.value = u.email||""; admRole.value = u.role || 'user';
        admPass.placeholder = "Nytt lösen (valfritt)"; admPass.value = "";
        admBtn.innerText = "Spara"; admBtn.style.background = "#2196F3"; admCancel.style.display = "inline-flex";
    };

    const resetAdm = () => { 
        editingAdminId = null; admUser.value = ""; admPass.value = ""; admFirst.value = ""; admLast.value = ""; admEmail.value = ""; admRole.value = 'user';
        admPass.placeholder = "Lösenord"; admBtn.innerText = "Spara / Skapa konto"; admBtn.style.background = ""; admCancel.style.display = "none"; 
    };
    if(admCancel) admCancel.onclick = resetAdm;

    admBtn.onclick = async () => {
        if(!admUser.value) return showToast("Användarnamn krävs", "error");
        const action = editingAdminId ? 'edit_admin' : 'add_admin';
        const res = await apiAction(action, null); // Payload skickas i body nedan
        await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, 
            body: JSON.stringify({ action, username:admUser.value, password:admPass.value, firstName:admFirst.value, lastName:admLast.value, email:admEmail.value, role:admRole.value, id:editingAdminId }) 
        });
        showToast(editingAdminId ? "Användare uppdaterad" : "Tillagd", "success");
        resetAdm(); renderAdmins();
    };

    window.deleteAdmin = async(u) => { 
        if(await showConfirm("Ta bort användare?")) {
            await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, body: JSON.stringify({action:'remove_admin', username:u}) }); 
            renderAdmins(); 
        }
    };
    renderAdmins();
}

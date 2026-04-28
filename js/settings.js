import { fetchData, saveData, apiAction } from './service.js';
import { showToast, showConfirm, isLight, escapeHTML } from './utils.js';

let globalStations = [], globalShifts = [], globalCustomThemes = [];
let editingStationId = null, editingShiftId = null, editingAdminId = null;

export async function initSettings() {
    if (sessionStorage.getItem('userRole') !== 'admin' && sessionStorage.getItem('userRole') !== 'superadmin') {
        window.location.href = "user.html";
        return;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName') || 'Admin');
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href = "index.html"; };

    // NYTT: Visa Arbetsplats-flik för Super-Admins
    if (sessionStorage.getItem('userRole') === 'superadmin') {
        const tabBtn = document.getElementById('tabBtnWorkplaces');
        if (tabBtn) tabBtn.style.display = 'flex';
        initWorkplaceSettings();
    }

    try {
        const [settings, themes, stations, shifts] = await Promise.all([
            fetchData('settings'),
            fetchData('custom_themes'),
            fetchData('stations'),
            fetchData('shifts')
        ]);

        globalCustomThemes = Array.isArray(themes) ? themes : [];
        globalStations = Array.isArray(stations) ? stations : [];
        globalShifts = Array.isArray(shifts) ? shifts : [];

        initGeneralTab();
        initWeatherTab();
        initStationsSettings();
        initShiftsSettings();
        initAdminSettings();
    } catch (e) {
        showToast("Kunde inte ladda inställningar", "error");
    }
}

function initGeneralTab() {
    const msgIn = document.getElementById('displayMessageInput');
    const msgCheck = document.getElementById('showMessageCheckbox');
    fetchData('message').then(msg => {
        if (msg) {
            msgIn.value = msg.text || "";
            msgCheck.checked = msg.show || false;
        }
    });
    document.getElementById('saveMessageBtn').onclick = async () => {
        await saveData('message', { text: msgIn.value, show: msgCheck.checked });
        showToast("Meddelande uppdaterat!", "success");
    };
}

function initWeatherTab() {
    const hiddenName = document.getElementById('weatherCityName');
    const hiddenLat = document.getElementById('weatherLat');
    const hiddenLong = document.getElementById('weatherLong');
    const currentDisplay = document.getElementById('currentWeatherDisplay');

    fetchData('weather_config').then(data => {
        if (data && data.name) {
            currentDisplay.innerHTML = `📍 <strong>${escapeHTML(data.name)}</strong>`;
            hiddenName.value = data.name;
            hiddenLat.value = data.latitude;
            hiddenLong.value = data.longitude;
        }
    });

    document.getElementById('saveWeatherBtn').onclick = async () => {
        await saveData('weather_config', {
            name: hiddenName.value,
            latitude: hiddenLat.value,
            longitude: hiddenLong.value
        });
        showToast("Väderplats sparad!", "success");
    };
}

function initStationsSettings() {
    const stName = document.getElementById('newStationName');
    const stColor = document.getElementById('newStationColor');
    const stBtn = document.getElementById('addStationBtn');
    const stCancel = document.getElementById('cancelStationEditBtn');

    let dragSrcStationEl = null;
    window.handleStationDragStart = (e) => {
        dragSrcStationEl = e.target.closest('.draggable-station');
        e.dataTransfer.effectAllowed = 'move';
        dragSrcStationEl.classList.add('dragging');
    };
    window.handleStationDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; };
    window.handleStationDrop = async (e) => {
        e.stopPropagation();
        const targetEl = e.target.closest('.draggable-station');
        if (dragSrcStationEl && targetEl && dragSrcStationEl !== targetEl) {
            const oldIndex = parseInt(dragSrcStationEl.dataset.index);
            const newIndex = parseInt(targetEl.dataset.index);
            
            const movedItem = globalStations.splice(oldIndex, 1)[0];
            globalStations.splice(newIndex, 0, movedItem);
            
            const newOrderIds = globalStations.map(st => st.id);
            await apiAction('reorder_stations', newOrderIds);
            
            renderStations(); 
        }
        return false;
    };

    const renderStations = () => {
        const cont = document.getElementById('stationListContainer');
        cont.innerHTML = globalStations.map((st, i) => {
            const dragAttr = `draggable="true" ondragstart="handleStationDragStart(event)" ondragover="handleStationDragOver(event)" ondrop="handleStationDrop(event)" data-index="${i}"`;
            
            if (st.is_spacer) {
                return `<div class="admin-list-item draggable-station" ${dragAttr} style="background:#f9f9f9; cursor:grab;">
                            <div class="list-info-left">
                                <span class="drag-handle" style="margin-right:10px; color:#aaa;">☰</span>
                                <i>--- Mellanrum ---</i>
                            </div>
                            <div class="list-actions-right">
                                <button class="list-btn" onclick="deleteStation(${st.id})">🗑️</button>
                            </div>
                        </div>`;
            }
            return `
            <div class="admin-list-item draggable-station" ${dragAttr} style="cursor:grab;">
                <div class="list-info-left">
                    <span class="drag-handle" style="margin-right:10px; color:#aaa;">☰</span>
                    <div style="width:20px; height:20px; background:${escapeHTML(st.color)}; border-radius:50%; margin-right:10px; border:1px solid #ccc;"></div>
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
        if (!st) return;
        editingStationId = id;
        stName.value = st.name;
        stColor.value = st.color;
        stBtn.innerText = "Spara Ändringar";
        stBtn.style.background = "#2196F3";
        stCancel.style.display = "inline-flex";
    };

    const resetSt = () => {
        editingStationId = null;
        stName.value = "";
        stBtn.innerText = "Lägg till";
        stBtn.style.background = "";
        stCancel.style.display = "none";
    };
    if(stCancel) stCancel.onclick = resetSt;

    stBtn.onclick = async () => {
        if (!stName.value) return showToast("Ange ett namn", "info");
        await apiAction('save_station', {
            id: editingStationId,
            name: stName.value,
            color: stColor.value,
            is_spacer: false
        });
        globalStations = await fetchData('stations');
        renderStations();
        resetSt();
        showToast("Station sparad", "success");
    };

    document.getElementById('addSpacerBtn').onclick = async () => {
        await apiAction('save_station', { is_spacer: true });
        globalStations = await fetchData('stations');
        renderStations();
    };

    window.deleteStation = async (id) => {
        if (await showConfirm("Ta bort platsen?")) {
            await apiAction('delete_station', { id });
            globalStations = await fetchData('stations');
            renderStations();
        }
    };
    renderStations();
}

function initShiftsSettings() {
    const shLabel = document.getElementById('newShiftLabel');
    const shTime = document.getElementById('newShiftTime');
    const shBtn = document.getElementById('addShiftBtn');
    const shCancel = document.getElementById('cancelShiftEditBtn');

    let dragSrcShiftEl = null;
    window.handleShiftDragStart = (e) => {
        dragSrcShiftEl = e.target.closest('.draggable-shift');
        e.dataTransfer.effectAllowed = 'move';
        dragSrcShiftEl.classList.add('dragging');
    };
    window.handleShiftDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; };
    window.handleShiftDrop = async (e) => {
        e.stopPropagation();
        const targetEl = e.target.closest('.draggable-shift');
        if (dragSrcShiftEl && targetEl && dragSrcShiftEl !== targetEl) {
            const oldIndex = parseInt(dragSrcShiftEl.dataset.index);
            const newIndex = parseInt(targetEl.dataset.index);
            
            const movedItem = globalShifts.splice(oldIndex, 1)[0];
            globalShifts.splice(newIndex, 0, movedItem);
            
            const newOrderIds = globalShifts.map(sh => sh.id);
            await apiAction('reorder_shifts', newOrderIds);
            
            renderShifts(); 
        }
        return false;
    };

    const renderShifts = () => {
        document.getElementById('shiftListContainer').innerHTML = globalShifts.map((sh, i) => {
            const dragAttr = `draggable="true" ondragstart="handleShiftDragStart(event)" ondragover="handleShiftDragOver(event)" ondrop="handleShiftDrop(event)" data-index="${i}"`;
            return `
        <div class="admin-list-item draggable-shift" ${dragAttr} style="cursor:grab;">
            <div class="list-info-left">
                <span class="drag-handle" style="margin-right:10px; color:#aaa;">☰</span>
                <strong>${escapeHTML(sh.label)}</strong> 
                <span style="color:#666; margin-left:5px;">(${escapeHTML(sh.time_range || '')})</span>
            </div>
            <div class="list-actions-right">
                <button class="list-btn" onclick="startEditShift(${sh.id})">✏️</button>
                <button class="list-btn" onclick="deleteShift(${sh.id})">🗑️</button>
            </div>
        </div>`}).join('');
    };

    window.startEditShift = (id) => {
        const sh = globalShifts.find(s => s.id === id);
        if (!sh) return;
        editingShiftId = id;
        shLabel.value = sh.label;
        shTime.value = sh.time_range || "";
        shBtn.innerText = "Spara Ändringar";
        shBtn.style.background = "#2196F3";
        shCancel.style.display = "inline-flex";
    };

    const resetSh = () => {
        editingShiftId = null;
        shLabel.value = "";
        shTime.value = "";
        shBtn.innerText = "Lägg till Pass";
        shBtn.style.background = "";
        shCancel.style.display = "none";
    };
    if(shCancel) shCancel.onclick = resetSh;

    shBtn.onclick = async () => {
        if (!shLabel.value) return showToast("Ange en etikett", "info");
        await apiAction('save_shift', {
            id: editingShiftId,
            label: shLabel.value,
            time_range: shTime.value
        });
        globalShifts = await fetchData('shifts');
        renderShifts();
        resetSh();
        showToast("Arbetspass sparat", "success");
    };

    window.deleteShift = async (id) => {
        if (await showConfirm("Ta bort arbetspasset?")) {
            await apiAction('delete_shift', { id });
            globalShifts = await fetchData('shifts');
            renderShifts();
        }
    };
    renderShifts();
}

function initAdminSettings() {
    const admBtn = document.getElementById('addAdminBtn');
    const admCancel = document.getElementById('cancelAdminEditBtn');
    const admDisp = document.getElementById('newAdminDisplayName');
    const admFirst = document.getElementById('newAdminFirstName');
    const admLast = document.getElementById('newAdminLastName');
    const admEmail = document.getElementById('newAdminEmail');
    const admUser = document.getElementById('newAdminUser');
    const admPass = document.getElementById('newAdminPass');
    const admRole = document.getElementById('newAdminRole');

    const renderAdmins = async () => {
        let admins = await fetchData('admins');
        document.getElementById('adminListContainer').innerHTML = admins.map(a => {
            let roleBadge = '<span style="background:#4CAF50; color:#fff; padding:2px 5px; border-radius:3px; font-size:0.7em;">User</span>';
            if(a.role === 'admin') roleBadge = '<span style="background:#ff9800; color:#fff; padding:2px 5px; border-radius:3px; font-size:0.7em;">Admin</span>';
            if(a.role === 'superadmin') roleBadge = '<span style="background:#9c27b0; color:#fff; padding:2px 5px; border-radius:3px; font-size:0.7em;">Super-Admin</span>';
            
            const fullName = `${a.first_name || ''} ${a.last_name || ''}`.trim() || "Namn saknas";
            const displayNameSub = a.display_name ? ` [Visa: ${a.display_name}]` : "";
            
            return `
            <div class="admin-list-item">
                <div class="list-info-left">
                    <strong>${escapeHTML(fullName)}</strong> ${roleBadge}
                    <span style="color:#666; margin-left:5px; font-size:0.9em;">
                        (@${escapeHTML(a.username)})${escapeHTML(displayNameSub)}
                    </span>
                </div>
                <div class="list-actions-right">
                    <button class="list-btn" onclick='startEditAdmin(${JSON.stringify(a).replace(/'/g, "&#39;")})'>✏️</button>
                    <button class="list-btn" onclick="deleteAdmin('${escapeHTML(a.username)}')">🗑️</button>
                </div>
            </div>`;
        }).join('');
    };

    window.startEditAdmin = (u) => {
        editingAdminId = u.id;
        admDisp.value = u.display_name || "";
        admFirst.value = u.first_name || "";
        admLast.value = u.last_name || "";
        admEmail.value = u.email || "";
        admUser.value = u.username;
        admRole.value = u.role || 'user';
        admPass.placeholder = "Nytt lösenord (valfritt)";
        admPass.value = "";
        admBtn.innerText = "Spara Ändringar";
        admBtn.style.background = "#2196F3";
        admCancel.style.display = "inline-flex";
    };

    const resetAdm = () => {
        editingAdminId = null;
        admDisp.value = ""; admFirst.value = ""; admLast.value = ""; admEmail.value = "";
        admUser.value = ""; admPass.value = ""; admPass.placeholder = "Lösenord"; admRole.value = 'user';
        admBtn.innerText = "Spara / Skapa konto"; admBtn.style.background = ""; admCancel.style.display = "none";
    };
    if(admCancel) admCancel.onclick = resetAdm;

    admBtn.onclick = async () => {
        if (!admUser.value) return showToast("Användarnamn krävs", "error");
        const action = editingAdminId ? 'edit_admin' : 'add_admin';
        
        const payload = {
            action, id: editingAdminId,
            displayName: admDisp.value.trim(),
            firstName: admFirst.value.trim(),
            lastName: admLast.value.trim(),
            email: admEmail.value.trim(),
            username: admUser.value.trim(),
            password: admPass.value,
            role: admRole.value
        };

        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionStorage.getItem('jwtToken')}` },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast("Användare sparad!", "success");
            resetAdm(); renderAdmins();
        } else {
            const err = await res.json();
            showToast(err.error || "Fel vid sparande", "error");
        }
    };

    window.deleteAdmin = async (u) => {
        if (await showConfirm(`Ta bort kontot @${u}?`)) {
            await fetch('/api/data-api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionStorage.getItem('jwtToken')}` },
                body: JSON.stringify({ action: 'remove_admin', username: u })
            });
            renderAdmins();
        }
    };
    renderAdmins();
}

function initWorkplaceSettings() {
    const wpName = document.getElementById('newWorkplaceName');
    const wpBtn = document.getElementById('addWorkplaceBtn');
    
    const renderWorkplaces = async () => {
        const wps = await fetchData('workplaces');
        const cont = document.getElementById('workplaceListContainer');
        if (cont && wps) {
            cont.innerHTML = wps.map(w => `
            <div class="admin-list-item">
                <div class="list-info-left">
                    <strong>${escapeHTML(w.name)}</strong> 
                    <span style="font-size:0.8rem; color:#888; margin-left:10px;">(ID: ${escapeHTML(w.id)})</span>
                </div>
            </div>`).join('');
        }
    };
    
    if (wpBtn) {
        wpBtn.onclick = async () => {
            if (!wpName.value) return showToast("Ange ett namn", "info");
            await apiAction('save_workplace', { name: wpName.value, is_new: true });
            wpName.value = '';
            showToast("Arbetsplats skapad!", "success");
            renderWorkplaces();
            
            setTimeout(() => window.location.reload(), 1500); 
        };
    }
    
    renderWorkplaces();
}

import { fetchData, saveData, apiAction } from './service.js';
import { showToast, showConfirm, isLight, escapeHTML, getISOWeek } from './utils.js';
import { DAYS } from './config.js'; 

let globalStations = [], globalShifts = [], globalCustomThemes = [], globalScheduleData = {};
let globalAdmins = []; 
let globalUserList = []; 
let globalAbsences = []; 
let editingStationId = null, editingShiftId = null, editingAdminId = null;

export async function initSettings() {
    const role = (localStorage.getItem('userRole') || '').trim().toLowerCase();
    
    if (role !== 'admin' && role !== 'superadmin') {
        window.location.href = "user.html";
        return;
    }

    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (localStorage.getItem('adminName') || 'Admin');
    document.getElementById('logoutBtn').onclick = () => { localStorage.clear(); window.location.href = "index.html"; };

    if (role === 'superadmin') {
        const tabBtn = document.getElementById('tabBtnWorkplaces');
        if (tabBtn) tabBtn.style.display = 'flex';
        initWorkplaceSettings();
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

        globalCustomThemes = Array.isArray(themes) ? themes : [];
        globalStations = Array.isArray(stations) ? stations : [];
        globalShifts = Array.isArray(shifts) ? shifts : [];
        globalUserList = Array.isArray(users) ? users : [];
        globalAbsences = Array.isArray(absences) ? absences : [];
        
        globalScheduleData = {};
        if (Array.isArray(scheduleData)) {
            scheduleData.forEach(row => {
                const key = `${row.station_id}_${row.shift_id}`;
                if (!globalScheduleData[key]) globalScheduleData[key] = [];
                globalScheduleData[key].push(row);
            });
        }

        initGeneralTab();
        initWeatherTab();
        initStationsSettings();
        initShiftsSettings();
        initAdminSettings();
        initAbsenceSettings(); 
        initThemeTab(settings);
        initExportTab(); 
    } catch (e) {
        showToast("Kunde inte ladda alla inställningar", "error");
    }
}

function initGeneralTab() {
    const msgIn = document.getElementById('displayMessageInput');
    const msgCheck = document.getElementById('showMessageCheckbox');
    if (!msgIn || !msgCheck) return;
    
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
    if (!hiddenName) return;

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
    if (!stName) return;

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
        if (!cont) return;
        
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
        const fetched = await fetchData('stations');
        globalStations = Array.isArray(fetched) ? fetched : [];
        renderStations();
        resetSt();
        showToast("Station sparad", "success");
    };

    const spacerBtn = document.getElementById('addSpacerBtn');
    if (spacerBtn) {
        spacerBtn.onclick = async () => {
            await apiAction('save_station', { is_spacer: true });
            const fetched = await fetchData('stations');
            globalStations = Array.isArray(fetched) ? fetched : [];
            renderStations();
        };
    }

    window.deleteStation = async (id) => {
        if (await showConfirm("Ta bort platsen?")) {
            await apiAction('delete_station', { id });
            const fetched = await fetchData('stations');
            globalStations = Array.isArray(fetched) ? fetched : [];
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
    if (!shLabel) return;

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
        const cont = document.getElementById('shiftListContainer');
        if (!cont) return;
        cont.innerHTML = globalShifts.map((sh, i) => {
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
        const fetched = await fetchData('shifts');
        globalShifts = Array.isArray(fetched) ? fetched : [];
        renderShifts();
        resetSh();
        showToast("Arbetspass sparat", "success");
    };

    window.deleteShift = async (id) => {
        if (await showConfirm("Ta bort arbetspasset?")) {
            await apiAction('delete_shift', { id });
            const fetched = await fetchData('shifts');
            globalShifts = Array.isArray(fetched) ? fetched : [];
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
    if (!admBtn) return;

    const renderAdmins = async () => {
        let admins = await fetchData('admins');
        if (!Array.isArray(admins)) admins = []; 
        globalAdmins = admins; 
        
        let html = `
        <div style="display:flex; padding: 10px 15px; background: #f5f5f5; border-bottom: 2px solid #ddd; font-weight: 600; font-size: 0.85rem; color: #555; text-transform: uppercase; position: sticky; top: 0; z-index: 10;">
            <div style="flex: 2; min-width: 150px;">Namn / Visningsnamn</div>
            <div style="flex: 1.5; min-width: 120px;">Användarnamn</div>
            <div style="flex: 1; min-width: 100px;">Roll</div>
            <div style="width: 80px; text-align: right;">Åtgärd</div>
        </div>
        `;

        if (admins.length === 0) {
            html += `<div style="padding: 15px; text-align: center; color: #666;">Inga konton hittades.</div>`;
        } else {
            html += admins.map(a => {
                let roleBadge = '<span style="background:#e0e0e0; color:#333; padding:3px 8px; border-radius:12px; font-size:0.75em; font-weight:bold;">🧍 Användare</span>';
                if(a.role === 'admin') roleBadge = '<span style="background:#fff3e0; color:#e65100; padding:3px 8px; border-radius:12px; border: 1px solid #ffe0b2; font-size:0.75em; font-weight:bold;">🔧 Admin</span>';
                if(a.role === 'superadmin') roleBadge = '<span style="background:#f3e5f5; color:#4a148c; padding:3px 8px; border-radius:12px; border: 1px solid #e1bee7; font-size:0.75em; font-weight:bold;">👑 Super-Admin</span>';
                
                const fullName = `${a.first_name || ''} ${a.last_name || ''}`.trim() || "<em style='color:#999'>Namn saknas</em>";
                const displayNameSub = a.display_name ? `<br><span style="font-size:0.85em; color:#0277bd; font-weight: 600;">➔ Visas som: ${escapeHTML(a.display_name)}</span>` : "";
                
                return `
                <div class="admin-list-item" style="display: flex; align-items: center; padding: 12px 15px; border-bottom: 1px solid #eee; transition: background 0.2s; background: #fff;">
                    <div style="flex: 2; min-width: 150px; line-height: 1.5;">
                        <strong style="font-size: 1rem; color: #333;">${fullName}</strong>
                        ${displayNameSub}
                    </div>
                    <div style="flex: 1.5; min-width: 120px; color: #555; font-family: monospace; font-size: 0.95em;">
                        @${escapeHTML(a.username)}
                    </div>
                    <div style="flex: 1; min-width: 100px;">
                        ${roleBadge}
                    </div>
                    <div style="width: 80px; display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="list-btn" onclick="startEditAdmin('${a.id}')" title="Redigera" style="background:#f5f5f5;">✏️</button>
                        <button class="list-btn" onclick="deleteAdmin('${escapeHTML(a.username)}')" title="Ta bort" style="background:#ffebee; color: #d32f2f;">🗑️</button>
                    </div>
                </div>`;
            }).join('');
        }
        
        document.getElementById('adminListContainer').innerHTML = html;
    };

    window.startEditAdmin = (id) => {
        const u = globalAdmins.find(admin => String(admin.id) === String(id));
        if (!u) return;

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
        
        document.getElementById('newAdminDisplayName').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('jwtToken')}` },
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
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('jwtToken')}` },
                body: JSON.stringify({ action: 'remove_admin', username: u })
            });
            renderAdmins();
        }
    };
    renderAdmins();
}

function initAbsenceSettings() {
    const saveBtn = document.getElementById('saveAbsenceBtn');
    const userSelect = document.getElementById('absUser');
    if(!saveBtn || !userSelect) return;

    userSelect.innerHTML = globalUserList.map(u => 
        `<option value="${u.id}">${escapeHTML(u.display_name || u.first_name || u.username)}</option>`
    ).join('');

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('absStart').value = today;
    document.getElementById('absEnd').value = today;

    const renderAbsences = () => {
        const cont = document.getElementById('absenceListContainer');
        if(!globalAbsences || globalAbsences.length === 0) {
            cont.innerHTML = "<div style='color:#888; font-style:italic;'>Ingen frånvaro registrerad.</div>";
            return;
        }
        let html = '';
        globalAbsences.forEach(a => {
            let icon = '✈️';
            if(a.type === 'Sjuk') icon = '🤒';
            if(a.type === 'VAB') icon = '🧸';
            if(a.type === 'Semester') icon = '🌴';

            const name = a.display_name || `${a.first_name} ${a.last_name||''}`.trim();
            const dates = a.start_date.split('T')[0] === a.end_date.split('T')[0] 
                ? a.start_date.split('T')[0] 
                : `${a.start_date.split('T')[0]} till ${a.end_date.split('T')[0]}`;

            html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid #ddd; background:#fff; margin-bottom:5px; border-radius:4px;">
                <div>
                    <strong>${icon} ${escapeHTML(name)}</strong> <span style="color:#666; font-size:0.85em; margin-left:10px;">${a.type} (${dates})</span>
                </div>
                <button class="list-btn" onclick="deleteAbsence(${a.id})" style="color:#d32f2f;">🗑️</button>
            </div>`;
        });
        cont.innerHTML = html;
    };

    window.deleteAbsence = async (id) => {
        if(await showConfirm("Radera denna frånvaro?")) {
            await apiAction('delete_absence', { id });
            globalAbsences = await fetchData('absences') || [];
            renderAbsences();
        }
    };

    saveBtn.onclick = async () => {
        const user_id = document.getElementById('absUser').value;
        const type = document.getElementById('absType').value;
        const start_date = document.getElementById('absStart').value;
        const end_date = document.getElementById('absEnd').value;

        if(!user_id || !start_date || !end_date) return showToast("Fyll i alla fält", "error");
        if(start_date > end_date) return showToast("Slutdatum kan inte vara före startdatum", "error");

        const u = globalUserList.find(x => String(x.id) === String(user_id));
        const name = u ? (u.display_name || u.first_name) : "Personen";
        const msg = `Detta markerar ${name} som ${type} mellan ${start_date} och ${end_date}.\n\n⚠️ Eventuella inbokade pass under denna period kommer att rensas automatiskt. Vill du fortsätta?`;

        if(await showConfirm(msg)) {
            const res = await apiAction('save_absence', { user_id, type, start_date, end_date });
            if(res.success) {
                showToast("Frånvaro sparad!", "success");
                globalAbsences = await fetchData('absences') || [];
                renderAbsences();
            } else {
                showToast("Ett fel uppstod", "error");
            }
        }
    };

    renderAbsences();
}

function initWorkplaceSettings() {
    const wpName = document.getElementById('newWorkplaceName');
    const wpBtn = document.getElementById('addWorkplaceBtn');
    
    const renderWorkplaces = async () => {
        let wps = await fetchData('workplaces');
        if (!Array.isArray(wps)) wps = [];
        
        const cont = document.getElementById('workplaceListContainer');
        if (cont) {
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

function initThemeTab(currentSettings) {
    const themeSelect = document.getElementById('themeSelect');
    const editSelect = document.getElementById('editThemeSelect');
    const iframe = document.getElementById('themePreviewIframe');

    if (iframe) {
        iframe.style.width = '1920px';
        iframe.style.height = '1080px';
        iframe.style.transformOrigin = 'top left';
        
        const resizeIframe = () => {
            const parent = iframe.parentElement;
            if (!parent) return;
            const scale = parent.clientWidth / 1920;
            iframe.style.transform = `scale(${scale})`;
            parent.style.height = `${1080 * scale}px`;
        };
        
        window.addEventListener('resize', resizeIframe);
        setTimeout(resizeIframe, 50); 
    }

    function updatePreview(themeId) {
        if (!iframe || !iframe.contentDocument) return;
        
        let customCss = "";
        if (themeId && themeId !== 'light') {
            const t = globalCustomThemes.find(x => x.id === themeId);
            if (t) customCss = t.css;
        }

        const now = new Date();
        const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1; 
        const dayName = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"][dayIndex];
        const dateStr = `${now.getDate()}/${now.getMonth() + 1}`;
        const iso = getISOWeek(now);

        let html = `
        <div class="display-wrapper">
            <div class="top-bar">
                <h1 id="mainTitle">Vi som jobbar ${dayName} ${dateStr}</h1>
                <div style="display:flex; align-items:center;">
                    <div id="weatherWidget" style="margin-right:20px; font-weight:700;">PREVIEW: 20°C</div>
                    <div id="clock">12:00</div>
                </div>
            </div>
            
            <div id="mainContainer">
                <div class="time-header-row">
                    <div></div>
                    ${globalShifts.map(s => `<div class="time-header">${escapeHTML(s.label)}</div>`).join('')}
                </div>
        `;
        
        globalStations.forEach(st => {
            if (st.is_spacer) { 
                html += `<div class="display-row spacer-row"></div>`; 
                return; 
            }
            
            const contrast = isLight(st.color) ? '#000' : '#fff';
            const vars = `style="--station-color:${escapeHTML(st.color)}; --contrast-color:${contrast};"`;
            
            html += `<div class="display-row" ${vars}><div class="station-label">${escapeHTML(st.name)}</div>`;
            
            globalShifts.forEach(sh => {
                const targetDateStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                const assignedRows = globalScheduleData[`${st.id}_${sh.id}`] || [];
                const validRows = assignedRows.filter(r => r.is_published && r.work_date.split('T')[0] === targetDateStr);
                
                const val = validRows.map(a => a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim()).join(' / ');
                const safeVal = escapeHTML(val);
                
                html += `<div class="shift-card ${safeVal?'':'empty'}" data-label="${escapeHTML(sh.label)}">${safeVal}</div>`;
            });
            
            html += `</div>`;
        });
        
        html += `</div></div>`;

        const doc = iframe.contentDocument;
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html lang="sv">
            <head>
                <base href="${window.location.href}">
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
                <link rel="stylesheet" href="base.css">
                <link rel="stylesheet" href="display.css">
                <style>
                    body { margin: 0; background-color: var(--bg-color); }
                    ::-webkit-scrollbar { display: none; }
                    ${customCss}
                </style>
            </head>
            <body class="display-view">
                ${html}
            </body>
            </html>
        `);
        doc.close();
    }

    function populate() {
        const cur = themeSelect?.value || (currentSettings?.theme || 'light');
        if(themeSelect) {
            themeSelect.innerHTML = `<option value="light">Ljus (Standard)</option>` + 
                                    globalCustomThemes.map(t => `<option value="${escapeHTML(t.id)}">✨ ${escapeHTML(t.name)}</option>`).join('');
            themeSelect.value = cur;
        }
        setTimeout(() => updatePreview(cur), 100);
        if(editSelect) {
            editSelect.innerHTML = '<option value="">-- Välj tema att redigera --</option>' + 
                                   globalCustomThemes.map(t => `<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)}</option>`).join('');
        }
    }

    if(themeSelect) themeSelect.onchange = (e) => updatePreview(e.target.value);

    const saveBtn = document.getElementById('saveThemeBtn');
    if(saveBtn) {
        saveBtn.onclick = async () => {
            await saveData('settings', { theme: themeSelect.value });
            showToast("Tema aktiverat!", "success");
        };
    }

    if(editSelect) {
        const tName = document.getElementById('customThemeName');
        const tCss = document.getElementById('customThemeCSS');
        const tId = document.getElementById('customThemeId');
        
        editSelect.onchange = () => { 
            const t = globalCustomThemes.find(x => x.id === editSelect.value); 
            if (t) { tName.value = t.name; tCss.value = t.css; tId.value = t.id; } 
        };
        
        document.getElementById('clearThemeEditorBtn').onclick = () => { 
            tId.value=""; tName.value=""; tCss.value=""; editSelect.value=""; 
        };
        
        document.getElementById('saveCustomThemeBtn').onclick = async () => {
            if(!tName.value || !tCss.value) return showToast("Fyll i namn och CSS", "error");
            const id = tId.value || 'theme_' + Date.now();
            const newTheme = { id: id, name: tName.value, css: tCss.value };
            const index = globalCustomThemes.findIndex(t => t.id === id);
            if(index >= 0) globalCustomThemes[index] = newTheme; else globalCustomThemes.push(newTheme);
            
            await saveData('custom_themes', globalCustomThemes);
            showToast("Tema sparat!", "success");
            document.getElementById('clearThemeEditorBtn').click(); populate();
            
            if(themeSelect && themeSelect.value === id) updatePreview(id);
        };
        
        document.getElementById('deleteThemeBtn').onclick = async () => {
            const id = editSelect.value; if(!id) return;
            if(await showConfirm("Radera detta tema?")) {
                globalCustomThemes = globalCustomThemes.filter(t => t.id !== id);
                await saveData('custom_themes', globalCustomThemes);
                if(themeSelect && themeSelect.value === id) { themeSelect.value='light'; await saveData('settings', {theme:'light'}); }
                showToast("Tema raderat", "info"); document.getElementById('clearThemeEditorBtn').click(); populate();
            }
        };
    }
    populate();
    
    const tabBtn = document.querySelector('button[onclick="openTab(\'tab-theme\')"]');
    if(tabBtn) {
        tabBtn.addEventListener('click', () => {
            setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
        });
    }
}

// --- UTSKRIFT OCH ZIP-BILDEXPORT (Med v1.4 Design) ---
function initExportTab() {
    const btnToday = document.getElementById('btnSetToday');
    const btnWeek = document.getElementById('btnSetWeek');
    const btnNextWeek = document.getElementById('btnSetNextWeek');
    const startInp = document.getElementById('printStartDate');
    const endInp = document.getElementById('printEndDate');
    const printBtn = document.getElementById('doPrintBtn');
    const imgBtn = document.getElementById('doImageBtn');

    if(!startInp || !endInp) return;

    const setDates = (start, end) => {
        const tz = start.getTimezoneOffset() * 60000;
        startInp.value = new Date(start.getTime() - tz).toISOString().split('T')[0];
        endInp.value = new Date(end.getTime() - tz).toISOString().split('T')[0];
    };

    if(btnToday) btnToday.onclick = () => {
        const d = new Date();
        setDates(d, d);
    };
    if(btnWeek) btnWeek.onclick = () => {
        const d = new Date();
        const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
        const start = new Date(d); start.setDate(d.getDate() - day);
        const end = new Date(start); end.setDate(start.getDate() + 6);
        setDates(start, end);
    };
    if(btnNextWeek) btnNextWeek.onclick = () => {
        const d = new Date();
        const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
        const start = new Date(d); start.setDate(d.getDate() - day + 7);
        const end = new Date(start); end.setDate(start.getDate() + 6);
        setDates(start, end);
    };

    if(btnWeek) btnWeek.click();

    function generateSingleDayPrintHtml(dateObj, stations, shifts, schedule) {
        const iso = getISOWeek(dateObj);
        const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1;
        const dayName = DAYS[dayIndex];
        const dateStr = dateObj.toLocaleDateString('sv-SE');
        const targetDateStr = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

        let html = `
        <div class="print-page" style="padding: 10px; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box;">
            <div style="text-align:center; margin-bottom:15px;">
                <h1 style="margin:0; font-size: 1.8rem;">Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})</h1>
            </div>
            <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 5px; justify-content: space-between;">
                <div style="display:grid; grid-template-columns: 200px repeat(${shifts.length}, 1fr); gap: 10px;">
                    <div></div>
                    ${shifts.map(s => `
                        <div style="text-align:center; font-weight:800; text-transform:uppercase; color:#555; font-size:0.85rem;">
                            ${escapeHTML(s.label)}<br><small style="font-weight:400;">${escapeHTML(s.time_range || s.time || '')}</small>
                        </div>`).join('')}
                </div>`;

        stations.forEach(st => {
            if (st.is_spacer) {
                html += `<div style="flex-grow: 0.2;"></div>`;
                return;
            }

            const bg = st.color;
            const fg = isLight(bg) ? '#000' : '#fff';

            html += `
            <div style="display:grid; grid-template-columns: 200px repeat(${shifts.length}, 1fr); gap: 10px; flex: 1;">
                <div style="background:${escapeHTML(bg)}; color:${fg}; padding:10px; border-radius:6px; font-weight:800; font-size:1.1rem; display:flex; align-items:center; border: 1px solid #ddd; justify-content: center;">
                    ${escapeHTML(st.name)}
                </div>`;

            shifts.forEach(sh => {
                const assignedRows = schedule.filter(r =>
                    r.is_published &&
                    r.work_date.split('T')[0] === targetDateStr &&
                    r.station_id === st.id &&
                    r.shift_id === sh.id
                );
                const val = assignedRows.map(a => a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim()).join(' / ');

                html += `
                <div style="background:#fff; border: 1px solid #ccc; border-radius:6px; display:flex; align-items:center; justify-content:center; text-align:center; font-weight:700; font-size:1.2rem;">
                    ${escapeHTML(val)}
                </div>`;
            });
            html += `</div>`;
        });

        html += `</div></div>`;
        return html;
    }

    function generateDisplayHtmlForImage(dateObj, stations, shifts, schedule) {
        const iso = getISOWeek(dateObj);
        const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1;
        const dayName = DAYS[dayIndex];
        const dateStr = `${dateObj.getDate()}/${dateObj.getMonth() + 1}`;
        const targetDateStr = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

        let html = `
        <div class="display-wrapper">
            <div class="top-bar">
                <h1 id="mainTitle">Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})</h1>
            </div>

            <div id="mainContainer">
                <div class="time-header-row">
                    <div></div>
                    ${shifts.map(s => `<div class="time-header">${escapeHTML(s.label)}</div>`).join('')}
                </div>
        `;

        stations.forEach(st => {
            if (st.is_spacer) {
                html += `<div class="display-row spacer-row"></div>`;
                return;
            }

            const contrast = isLight(st.color) ? '#000' : '#fff';
            const vars = `style="--station-color:${escapeHTML(st.color)}; --contrast-color:${contrast};"`;

            html += `<div class="display-row" ${vars}><div class="station-label">${escapeHTML(st.name)}</div>`;

            shifts.forEach(sh => {
                const assignedRows = schedule.filter(r =>
                    r.is_published &&
                    r.work_date.split('T')[0] === targetDateStr &&
                    r.station_id === st.id &&
                    r.shift_id === sh.id
                );
                const val = assignedRows.map(a => a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim()).join(' / ');

                html += `<div class="shift-card ${val ? '' : 'empty'}" data-label="${escapeHTML(sh.label)}">${escapeHTML(val)}</div>`;
            });

            html += `</div>`;
        });

        html += `
            </div>
        </div>`;

        return html;
    }

    const runExport = async (mode) => {
        const sDate = new Date(startInp.value);
        const eDate = new Date(endInp.value);
        if (sDate > eDate) return showToast("Startdatum måste vara före slutdatum", "error");

        showToast("Hämtar data för export...", "info");

        const [stations, shifts, schedule] = await Promise.all([
            fetchData('stations'), fetchData('shifts'),
            fetchData('schedule', `&start_date=${startInp.value}&end_date=${endInp.value}`)
        ]);

        if(!schedule) return showToast("Kunde inte hämta schemat.", "error");

        if (mode === 'print') {
            const pc = document.getElementById('print-container') || document.createElement('div');
            pc.id = 'print-container';
            if(!document.body.contains(pc)) document.body.appendChild(pc);

            let html = "";
            let loopDate = new Date(sDate);
            while (loopDate <= eDate) {
                html += generateSingleDayPrintHtml(new Date(loopDate), stations, shifts, schedule);
                loopDate.setDate(loopDate.getDate() + 1);
            }
            pc.innerHTML = html;
            window.print();
            setTimeout(() => pc.innerHTML = '', 1000);
        } else {
            if(typeof html2canvas === 'undefined') return showToast("html2canvas saknas.", "error");
            if(typeof JSZip === 'undefined') return showToast("JSZip saknas. Uppdatera settings.html", "error"); 

            const btn = document.getElementById('doImageBtn');
            const txt = btn.innerText;
            btn.innerText = "Genererar...";

            let customCss = "";
            const themeSelect = document.getElementById('themeSelect');
            if (themeSelect && themeSelect.value && themeSelect.value !== 'light') {
                const t = globalCustomThemes.find(x => x.id === themeSelect.value);
                if (t) customCss = t.css;
            }

            const iframe = document.createElement('iframe');
            iframe.style.cssText = "position:absolute; top:-9999px; left:0; width:1920px; height:1080px; border:none;";
            document.body.appendChild(iframe);

            let loopDate = new Date(sDate);
            let count = 0;
            const zip = new JSZip(); 
            let singleImageBase64 = null; 
            let singleImageName = "";

            while (loopDate <= eDate) {
                const doc = iframe.contentDocument;
                doc.open();
                doc.write(`
                    <!DOCTYPE html>
                    <html lang="sv">
                    <head>
                        <base href="${window.location.href}">
                        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
                        <link rel="stylesheet" href="base.css">
                        <link rel="stylesheet" href="display.css">
                        <style>
                            ${customCss}
                            * { transition: none !important; animation: none !important; }
                            body { margin: 0; overflow: hidden; background-color: var(--bg-color, #f0f2f5); }
                            ::-webkit-scrollbar { display: none; }
                        </style>
                    </head>
                    <body class="display-view" id="page-display">
                        ${generateDisplayHtmlForImage(new Date(loopDate), stations, shifts, schedule)}
                    </body>
                    </html>
                `);
                doc.close();

                await new Promise(r => setTimeout(r, 1000));

                try {
                    const canvas = await html2canvas(doc.body, {
                        scale: 2,
                        useCORS: true,
                        backgroundColor: doc.body.style.backgroundColor || '#f0f2f5'
                    });

                    const lDateStr = new Date(loopDate.getTime() - (loopDate.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                    const base64Img = canvas.toDataURL('image/png');

                    if (count === 0) {
                        singleImageBase64 = base64Img;
                        singleImageName = `Schema-${lDateStr}.png`;
                    }

                    const base64Data = base64Img.split('base64,')[1];
                    zip.file(`Schema-${lDateStr}.png`, base64Data, {base64: true});

                    count++;
                } catch (e) { console.error("Kunde inte skapa bild:", e); }

                loopDate.setDate(loopDate.getDate() + 1);
            }

            document.body.removeChild(iframe);
            btn.innerText = txt;

            if (count === 1) {
                const link = document.createElement('a');
                link.download = singleImageName;
                link.href = singleImageBase64;
                link.click();
                showToast("Bild sparad!", "success");
            } else if (count > 1) {
                showToast("Packar ZIP-fil...", "info");
                try {
                    const content = await zip.generateAsync({type: "blob"});
                    const link = document.createElement('a');
                    link.download = `Scheman_${startInp.value}_till_${endInp.value}.zip`;
                    const url = URL.createObjectURL(content);
                    link.href = url;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000); 
                    showToast(`Klar! ${count} bilder sparade i en ZIP.`, "success");
                } catch(e) {
                    showToast("Kunde inte skapa ZIP", "error");
                }
            }
        }
    };

    if(printBtn) printBtn.onclick = () => runExport('print');
    if(imgBtn) imgBtn.onclick = () => runExport('image');
}

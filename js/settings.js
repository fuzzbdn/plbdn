import { fetchData, saveData } from './service.js';
import { showToast, showConfirm, isLight, getISOWeek } from './utils.js';
import { DEFAULT_STATIONS, DEFAULT_SHIFTS, DAYS } from './config.js';

let globalStations = [], globalShifts = [], globalCustomThemes = [], globalScheduleData = {};
let editingStationIndex = null, editingShiftIndex = null, editingAdminId = null, dragSrcStationEl = null;

// Huvudfunktion som anropas från main.js
export async function initSettings() {
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };

    // Ladda all data parallellt
    const [draft, published, old, settings, themes, stations, shifts] = await Promise.all([
        fetchData('schedule_draft'), 
        fetchData('schedule_published'), 
        fetchData('schedule'),
        fetchData('settings'), 
        fetchData('custom_themes'), 
        fetchData('config_stations'), 
        fetchData('config_shifts')
    ]);
    
    // Sätt globala variabler
    globalScheduleData = (draft && Object.keys(draft).length) ? draft : (published || old || {});
    globalCustomThemes = themes || [];
    globalStations = (Array.isArray(stations) && stations.length) ? stations : DEFAULT_STATIONS;
    globalShifts = (Array.isArray(shifts) && shifts.length) ? shifts : DEFAULT_SHIFTS;

    // Initiera alla flikar
    initGeneralTab();
    initWeatherTab(); // <-- NY FUNKTION KÖRS HÄR
    initThemeTab(settings);
    initStationsSettings(); 
    initShiftsSettings(); 
    initAdminSettings();
    initExportTab();
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

// NY: VÄDERINSTÄLLNINGAR
function initWeatherTab() {
    const latIn = document.getElementById('weatherLat');
    const longIn = document.getElementById('weatherLong');
    const nameIn = document.getElementById('weatherCityName');

    fetchData('weather_config').then(data => {
        if (data) {
            latIn.value = data.latitude || "";
            longIn.value = data.longitude || "";
            nameIn.value = data.name || "";
        } else {
            // Default Boden
            latIn.value = "65.82";
            longIn.value = "21.69";
            nameIn.value = "BODEN";
        }
    });

    document.getElementById('saveWeatherBtn').onclick = async () => {
        const config = {
            latitude: latIn.value.trim(),
            longitude: longIn.value.trim(),
            name: nameIn.value.trim() || "VÄDER"
        };
        await saveData('weather_config', config);
        showToast("Väderinställningar sparade!", "success");
    };
}

// TEMA FUNKTIONER (IFRAME)
function initThemeTab(currentSettings) {
    const themeSelect = document.getElementById('themeSelect');
    const editSelect = document.getElementById('editThemeSelect');
    const iframe = document.getElementById('themePreviewIframe');

    function updatePreview(themeId) {
        if (!iframe || !iframe.contentDocument) return;
        let cssToInject = "";
        if (themeId && themeId !== 'light') {
            const t = globalCustomThemes.find(x => x.id === themeId);
            if (t) cssToInject = t.css;
        }
        let styleTag = iframe.contentDocument.getElementById('injected-preview-style');
        if (!styleTag) {
            styleTag = iframe.contentDocument.createElement('style');
            styleTag.id = 'injected-preview-style';
            iframe.contentDocument.head.appendChild(styleTag);
        }
        styleTag.innerHTML = cssToInject;
    }

    function populate() {
        const cur = themeSelect.value || (currentSettings?.theme || 'light');
        themeSelect.innerHTML = `<option value="light">Ljus (Standard)</option>` + 
                                globalCustomThemes.map(t => `<option value="${t.id}">✨ ${t.name}</option>`).join('');
        themeSelect.value = cur;
        setTimeout(() => updatePreview(cur), 100);
        if(editSelect) {
            editSelect.innerHTML = '<option value="">-- Välj tema att redigera --</option>' + 
                                   globalCustomThemes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
        }
    }

    iframe.onload = () => updatePreview(themeSelect.value);
    themeSelect.onchange = (e) => updatePreview(e.target.value);

    document.getElementById('saveThemeBtn').onclick = async () => {
        await saveData('settings', { theme: themeSelect.value });
        showToast("Tema aktiverat!", "success");
    };

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
        };
        
        document.getElementById('deleteThemeBtn').onclick = async () => {
            const id = editSelect.value; if(!id) return;
            if(await showConfirm("Radera detta tema?")) {
                globalCustomThemes = globalCustomThemes.filter(t => t.id !== id);
                await saveData('custom_themes', globalCustomThemes);
                if(themeSelect.value === id) { themeSelect.value='light'; await saveData('settings', {theme:'light'}); }
                showToast("Tema raderat", "info"); document.getElementById('clearThemeEditorBtn').click(); populate();
            }
        };
    }
    populate();
}

function initStationsSettings() {
    const stName = document.getElementById('newStationName');
    const stColor = document.getElementById('newStationColor');
    const stBtn = document.getElementById('addStationBtn');
    const stCancel = document.getElementById('cancelStationEditBtn');

    window.handleStationDragStart = (e) => {
        dragSrcStationEl = e.target.closest('.draggable-station');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', dragSrcStationEl.innerHTML);
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
            await saveData('config_stations', globalStations);
            renderStations(); 
        }
        return false;
    };

    const renderStations = () => {
        const cont = document.getElementById('stationListContainer');
        if(!Array.isArray(globalStations)) globalStations = DEFAULT_STATIONS;
        cont.innerHTML = globalStations.map((st, i) => {
            const dragAttr = `draggable="true" ondragstart="handleStationDragStart(event)" ondragover="handleStationDragOver(event)" ondrop="handleStationDrop(event)" data-index="${i}"`;
            if(st.isSpacer) return `<div class="draggable-station" ${dragAttr} style="background:#f9f9f9; color:#888;"><div class="list-info-left"><span class="drag-handle">☰</span><i>--- Mellanrum ---</i></div><div class="list-actions-right"><button class="list-btn" onclick="deleteStation(${i})">🗑️</button></div></div>`;
            return `<div class="draggable-station" ${dragAttr}><div class="list-info-left"><span class="drag-handle">☰</span><div style="width:20px; height:20px; background:${st.color}; border-radius:50%; border:1px solid #ccc; flex-shrink:0;"></div><strong>${st.name}</strong></div><div class="list-actions-right"><button class="list-btn" onclick="startEditStation(${i})">✏️</button><button class="list-btn" onclick="deleteStation(${i})">🗑️</button></div></div>`;
        }).join('');
    };

    window.startEditStation = (i) => {
        editingStationIndex = i; stName.value = globalStations[i].name; stColor.value = globalStations[i].color;
        stBtn.innerText = "💾"; stBtn.style.background = "#2196F3"; stCancel.style.display = "inline-flex";
    };
    const resetSt = () => { editingStationIndex = null; stName.value = ""; stBtn.innerText = "+"; stBtn.style.background = ""; stCancel.style.display = "none"; };
    stCancel.onclick = resetSt;

    stBtn.onclick = async () => {
        if(!stName.value) return showToast("Ange namn", "info");
        const item = { name: stName.value, color: stColor.value };
        if(editingStationIndex !== null) globalStations[editingStationIndex] = item; else globalStations.push(item);
        await saveData('config_stations', globalStations);
        showToast("Sparat", "success"); resetSt(); renderStations();
    };
    document.getElementById('addSpacerBtn').onclick = async () => { globalStations.push({ isSpacer: true }); await saveData('config_stations', globalStations); renderStations(); };
    window.deleteStation = async (i) => { if(await showConfirm("Ta bort?")) { globalStations.splice(i, 1); await saveData('config_stations', globalStations); renderStations(); }};
    renderStations();
}

function initShiftsSettings() {
    const shLabel = document.getElementById('newShiftLabel'), shTime = document.getElementById('newShiftTime');
    const shBtn = document.getElementById('addShiftBtn'), shCancel = document.getElementById('cancelShiftEditBtn');

    const renderShifts = () => {
        const cont = document.getElementById('shiftListContainer');
        if(!Array.isArray(globalShifts)) globalShifts = DEFAULT_SHIFTS;
        cont.innerHTML = globalShifts.map((sh, i) => `
        <div class="shift-list-item">
            <div class="list-info-left">
                <strong>${sh.label}</strong> 
                <span style="color:#666; margin-left:5px;">(${sh.time})</span>
            </div>
            <div class="list-actions-right">
                <button class="list-btn" onclick="startEditShift(${i})">✏️</button>
                <button class="list-btn" onclick="deleteShift(${i})">🗑️</button>
            </div>
        </div>`).join('');
    };
    window.startEditShift = (i) => { editingShiftIndex = i; shLabel.value = globalShifts[i].label; shTime.value = globalShifts[i].time; shBtn.innerText = "Spara"; shBtn.style.background = "#2196F3"; shCancel.style.display = "inline-flex"; };
    const resetSh = () => { editingShiftIndex = null; shLabel.value = ""; shTime.value = ""; shBtn.innerText = "Lägg till Pass"; shBtn.style.background = ""; shCancel.style.display = "none"; };
    shCancel.onclick = resetSh;
    shBtn.onclick = async () => { if(!shLabel.value) return; const item = { label: shLabel.value, time: shTime.value }; if(editingShiftIndex !== null) globalShifts[editingShiftIndex] = item; else globalShifts.push(item); await saveData('config_shifts', globalShifts); showToast("Sparat", "success"); resetSh(); renderShifts(); };
    window.deleteShift = async (i) => { if(await showConfirm("Ta bort?")) { globalShifts.splice(i, 1); await saveData('config_shifts', globalShifts); renderShifts(); }};
    renderShifts();
}

function initAdminSettings() {
    const admBtn = document.getElementById('addAdminBtn');
    const admCancel = document.getElementById('cancelAdminEditBtn');
    const admUser = document.getElementById('newAdminUser');
    const admPass = document.getElementById('newAdminPass');
    const admFirst = document.getElementById('newAdminFirstName');
    const admLast = document.getElementById('newAdminLastName');
    const admEmail = document.getElementById('newAdminEmail');

    const renderAdmins = async () => {
        let admins = await fetchData('admins');
        if(!Array.isArray(admins)) admins = [];
        document.getElementById('adminListContainer').innerHTML = admins.map(a => `
            <div class="admin-list-item">
                <div class="list-info-left">
                    <strong>${a.username}</strong>
                    <span style="color:#666; margin-left:5px; font-size:0.9em;">
                        (${a.first_name||''} ${a.last_name||''})
                    </span>
                </div>
                <div class="list-actions-right">
                    <button class="list-btn" onclick='startEditAdmin(${JSON.stringify(a).replace(/'/g,"'")})'>✏️</button>
                    <button class="list-btn" onclick="deleteAdmin('${a.username}')">🗑️</button>
                </div>
            </div>`).join('');
    };

    window.startEditAdmin = (u) => {
        editingAdminId = u.id; 
        admUser.value = u.username; 
        admFirst.value = u.first_name||""; 
        admLast.value = u.last_name||""; 
        admEmail.value = u.email||"";
        admPass.placeholder = "Nytt lösen (valfritt)"; 
        admPass.value = "";
        admBtn.innerText = "Spara"; 
        admBtn.style.background = "#2196F3"; 
        admCancel.style.display = "inline-flex";
    };

    const resetAdm = () => { 
        editingAdminId = null; 
        admUser.value = ""; 
        admPass.value = ""; 
        admFirst.value = ""; 
        admLast.value = ""; 
        admEmail.value = ""; 
        admPass.placeholder = "Lösenord"; 
        admBtn.innerText = "Spara / Skapa konto"; 
        admBtn.style.background = ""; 
        admCancel.style.display = "none"; 
    };
    admCancel.onclick = resetAdm;

    admBtn.onclick = async () => {
        const u = admUser.value, p = admPass.value;
        if(!u) return showToast("Användarnamn krävs", "error");
        
        const action = editingAdminId ? 'edit_admin' : 'add_admin';
        if(action === 'add_admin' && !p) return showToast("Lösenord krävs", "error");
        
        await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, 
            body: JSON.stringify({
                action, 
                username:u, 
                password:p, 
                firstName:admFirst.value, 
                lastName:admLast.value, 
                email:admEmail.value, 
                id:editingAdminId
            }) 
        });
        showToast(editingAdminId ? "Admin uppdaterad" : "Admin tillagd", "success");
        resetAdm(); renderAdmins();
    };

    window.deleteAdmin = async(u) => { 
        if(await showConfirm("Ta bort admin?")) {
            await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, body: JSON.stringify({action:'remove_admin', username:u}) }); 
            showToast("Admin borttagen", "info");
            renderAdmins(); 
        }
    };
    renderAdmins();
}

function initExportTab() {
    const startIn = document.getElementById('printStartDate');
    const endIn = document.getElementById('printEndDate');
    const today = new Date().toISOString().split('T')[0];
    if(startIn) startIn.value = today;
    if(endIn) endIn.value = today;

    document.getElementById('btnSetToday').onclick = () => { startIn.value = today; endIn.value = today; };
    
    document.getElementById('btnSetWeek').onclick = () => { 
        const d = new Date(); 
        const day = d.getDay(); 
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
        d.setDate(diff); 
        startIn.value = d.toISOString().split('T')[0]; 
        d.setDate(d.getDate() + 6); 
        endIn.value = d.toISOString().split('T')[0]; 
    };
    
    document.getElementById('btnSetNextWeek').onclick = () => { 
        const d = new Date(); 
        const day = d.getDay(); 
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
        d.setDate(diff + 7); 
        startIn.value = d.toISOString().split('T')[0]; 
        d.setDate(d.getDate() + 6); 
        endIn.value = d.toISOString().split('T')[0]; 
    };

    const runExport = async (mode) => {
        const sDate = new Date(startIn.value);
        const eDate = new Date(endIn.value);
        if (sDate > eDate) return showToast("Startdatum måste vara före slutdatum", "error");
        
        if (mode === 'print') {
            const pc = document.getElementById('print-container') || document.createElement('div');
            pc.id = 'print-container';
            if(!document.body.contains(pc)) document.body.appendChild(pc);
            
            let html = "";
            let loopDate = new Date(sDate);
            while (loopDate <= eDate) { 
                html += generateSingleDayPrintHtml(new Date(loopDate)); 
                loopDate.setDate(loopDate.getDate() + 1); 
            }
            pc.innerHTML = html;
            window.print();
            setTimeout(() => pc.innerHTML = '', 1000);
        } else {
            if(typeof html2canvas === 'undefined') return showToast("html2canvas saknas.", "error");
            
            const btn = document.getElementById('doImageBtn');
            const txt = btn.innerText;
            btn.innerText = "Genererar...";
            
            const temp = document.createElement('div');
            temp.style.cssText = "position:absolute; top:-9999px; left:0; width:1200px; background:#fff;";
            document.body.appendChild(temp);
            
            let loopDate = new Date(sDate);
            let count = 0;
            
            while (loopDate <= eDate) {
                temp.innerHTML = generateSingleDayPrintHtml(new Date(loopDate), true);
                await new Promise(r => setTimeout(r, 100));
                try {
                    const canvas = await html2canvas(temp, { scale: 2 });
                    const link = document.createElement('a');
                    link.download = `Schema-${loopDate.toLocaleDateString('sv-SE')}.jpg`;
                    link.href = canvas.toDataURL('image/jpeg', 0.9);
                    link.click();
                    count++;
                    await new Promise(r => setTimeout(r, 500));
                } catch (e) { console.error(e); }
                loopDate.setDate(loopDate.getDate() + 1);
            }
            document.body.removeChild(temp);
            btn.innerText = txt;
            showToast(`Klar! ${count} bild(er).`, "success");
        }
    };
    
    document.getElementById('doPrintBtn').onclick = () => runExport('print');
    const imgBtn = document.getElementById('doImageBtn'); 
    if(imgBtn) imgBtn.onclick = () => runExport('image');
}

function generateSingleDayPrintHtml(dateObj, forImage = false) {
    const iso = getISOWeek(dateObj);
    const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1; 
    const dayName = DAYS[dayIndex];
    const dateStr = dateObj.toLocaleDateString('sv-SE');
    const prefix = `y${iso.year}w${iso.week}-${dayName}-`;
    const style = forImage ? 'padding:20px; font-family:sans-serif; background:#fff;' : 'page-break-after: always; padding: 20px; font-family: sans-serif;';
    
    let html = `<div class="print-page" style="${style}"><div style="text-align:center; margin-bottom:20px;"><h2 style="margin:0;">${dayName} ${dateStr}</h2><span style="font-size:0.9em; color:#666;">Vecka ${iso.week}, ${iso.year}</span></div>`;
    html += `<div style="display:grid; grid-template-columns:150px repeat(${globalShifts.length}, 1fr); gap:0; border:1px solid #000; border-bottom:none;"><div style="background:#ddd; border-right:1px solid #000; padding:5px;"></div>${globalShifts.map(s => `<div style="background:#ddd; border-right:1px solid #000; padding:5px; text-align:center; font-weight:bold;">${s.time}<br><span style="font-size:0.8em; font-weight:normal;">${s.label}</span></div>`).join('')}</div>`;
    html += `<div style="border:1px solid #000; border-top:none;">`;
    
    globalStations.forEach(st => {
        if (st.isSpacer) { html += `<div style="height:15px; background:#f0f0f0; border-top:1px solid #000;"></div>`; return; }
        const bg = st.color;
        const fg = isLight(bg) ? '#000' : '#fff';
        html += `<div style="display:grid; grid-template-columns:150px repeat(${globalShifts.length}, 1fr); border-top:1px solid #000;"><div style="background:${bg}; color:${fg}; padding:10px; font-weight:bold; border-right:1px solid #000; display:flex; align-items:center;">${st.name}</div>`;
        globalShifts.forEach((sh, index) => {
            const val = globalScheduleData[`${prefix}${st.name}-${sh.time}`] || "";
            const borderRight = index === globalShifts.length - 1 ? '' : 'border-right:1px solid #000;';
            html += `<div style="padding:5px; display:flex; align-items:center; justify-content:center; text-align:center; font-weight:bold; font-size:0.9rem; ${borderRight}">${val}</div>`;
        });
        html += `</div>`;
    });
    return html + `</div></div>`;
}

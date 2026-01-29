import { fetchData, saveData } from './service.js';
import { showToast, showConfirm, isLight, getISOWeek } from './utils.js';
import { DEFAULT_STATIONS, DEFAULT_SHIFTS, DAYS } from './config.js';

let globalStations = [], globalShifts = [], globalCustomThemes = [], globalScheduleData = {};
let editingStationIndex = null, editingShiftIndex = null, editingAdminId = null, dragSrcStationEl = null;

export async function initSettings() {
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };

    const [draft, published, old, settings, themes, stations, shifts] = await Promise.all([
        fetchData('schedule_draft'), fetchData('schedule_published'), fetchData('schedule'),
        fetchData('settings'), fetchData('custom_themes'), fetchData('config_stations'), fetchData('config_shifts')
    ]);
    
    globalScheduleData = draft && Object.keys(draft).length ? draft : (published || old || {});
    globalCustomThemes = themes || [];
    globalStations = stations || DEFAULT_STATIONS;
    globalShifts = shifts || DEFAULT_SHIFTS;

    initThemeTab(settings);
    initStationsTab();
    initShiftsTab();
    initAdminTab();
    initExportTab();
    initGeneralTab();
}

function initGeneralTab() {
    const msgIn = document.getElementById('displayMessageInput'), msgCheck = document.getElementById('showMessageCheckbox');
    fetchData('message').then(msg => { if(msg) { msgIn.value = msg.text||""; msgCheck.checked = msg.show||false; } });
    document.getElementById('saveMessageBtn').onclick = async () => { await saveData('message', { text: msgIn.value, show: msgCheck.checked }); showToast("Uppdaterat", "success"); };
}

function initThemeTab(settings) {
    const themeSelect = document.getElementById('themeSelect'), editSelect = document.getElementById('editThemeSelect');
    const previewBox = document.getElementById('themePreviewBox');

    function populate() {
        const cur = themeSelect.value || (settings?.theme || 'light');
        themeSelect.innerHTML = `<option value="light">Ljus (Standard)</option>` + globalCustomThemes.map(t => `<option value="${t.id}">✨ ${t.name}</option>`).join('');
        themeSelect.value = cur;
        updatePreview(cur);
        if(editSelect) editSelect.innerHTML = '<option value="">-- Välj tema --</option>' + globalCustomThemes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    }

    function updatePreview(id) {
        if (!previewBox) return;
        let bg = '#f4f4f9', text = '#333';
        if (id && id !== 'light') {
            const t = globalCustomThemes.find(x => x.id === id);
            if (t && t.css) {
                const bgMatch = t.css.match(/--bg-color\s*:\s*([^;}]+)/);
                const textMatch = t.css.match(/--text-color\s*:\s*([^;}]+)/);
                if (bgMatch) bg = bgMatch[1].trim();
                if (textMatch) text = textMatch[1].trim();
            }
        }
        previewBox.style.backgroundColor = bg; previewBox.style.color = text;
    }

    themeSelect.onchange = (e) => updatePreview(e.target.value);
    document.getElementById('saveThemeBtn').onclick = async () => { await saveData('settings', { theme: themeSelect.value }); showToast("Tema aktiverat!", "success"); };
    
    if(editSelect) {
        const tName = document.getElementById('customThemeName'), tCss = document.getElementById('customThemeCSS'), tId = document.getElementById('customThemeId');
        editSelect.onchange = () => { const t = globalCustomThemes.find(x => x.id === editSelect.value); if (t) { tName.value = t.name; tCss.value = t.css; tId.value = t.id; } };
        document.getElementById('clearThemeEditorBtn').onclick = () => { tId.value=""; tName.value=""; tCss.value=""; editSelect.value=""; };
        document.getElementById('saveCustomThemeBtn').onclick = async () => {
            if(!tName.value || !tCss.value) return showToast("Fyll i allt", "error");
            const id = tId.value || 'theme_' + Date.now();
            const newTheme = { id, name: tName.value, css: tCss.value };
            const idx = globalCustomThemes.findIndex(t => t.id === id);
            if(idx >= 0) globalCustomThemes[idx] = newTheme; else globalCustomThemes.push(newTheme);
            await saveData('custom_themes', globalCustomThemes);
            showToast("Tema sparat!", "success"); document.getElementById('clearThemeEditorBtn').click(); populate();
        };
        document.getElementById('deleteThemeBtn').onclick = async () => {
            const id = editSelect.value; if(!id) return;
            if(await showConfirm("Radera?")) {
                globalCustomThemes = globalCustomThemes.filter(t => t.id !== id);
                await saveData('custom_themes', globalCustomThemes);
                if(themeSelect.value === id) { themeSelect.value='light'; await saveData('settings', {theme:'light'}); }
                showToast("Raderat", "info"); document.getElementById('clearThemeEditorBtn').click(); populate();
            }
        };
    }
    populate();
}

// (Stations, Shifts, Admin och Export funktionerna är identiska med tidigare script.js men flyttade hit. 
// För att spara plats här i chatten, kopiera in dem från ditt gamla script.js eller be mig skriva ut hela filen om du vill.)
// ... (Här skulle initStationsTab, initShiftsTab, initAdminTab, initExportTab ligga)
// Jag har skapat en komplett fil åt dig nedan för att undvika klipp-och-klistra fel.

function initStationsTab() {
    const render = () => {
        const cont = document.getElementById('stationListContainer');
        cont.innerHTML = globalStations.map((st, i) => {
            const dragAttr = `draggable="true" ondragstart="handleStationDragStart(event)" ondragover="handleStationDragOver(event)" ondrop="handleStationDrop(event)" data-index="${i}"`;
            if(st.isSpacer) return `<div class="draggable-station" ${dragAttr} style="background:#f9f9f9; color:#888;"><div class="list-info-left"><span class="drag-handle">☰</span><i>--- Mellanrum ---</i></div><div class="list-actions-right"><button class="list-btn" onclick="deleteStation(${i})">🗑️</button></div></div>`;
            return `<div class="draggable-station" ${dragAttr}><div class="list-info-left"><span class="drag-handle">☰</span><div style="width:20px; height:20px; background:${st.color}; border-radius:50%; border:1px solid #ccc; flex-shrink:0;"></div><strong>${st.name}</strong></div><div class="list-actions-right"><button class="list-btn" onclick="startEditStation(${i})">✏️</button><button class="list-btn" onclick="deleteStation(${i})">🗑️</button></div></div>`;
        }).join('');
    };
    window.handleStationDragStart = (e) => { dragSrcStationEl = e.target.closest('.draggable-station'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/html', dragSrcStationEl.innerHTML); dragSrcStationEl.classList.add('dragging'); };
    window.handleStationDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; };
    window.handleStationDrop = async (e) => { e.stopPropagation(); const target = e.target.closest('.draggable-station'); if (dragSrcStationEl && target && dragSrcStationEl !== target) { const oldIdx = parseInt(dragSrcStationEl.dataset.index), newIdx = parseInt(target.dataset.index); const item = globalStations.splice(oldIdx, 1)[0]; globalStations.splice(newIdx, 0, item); await saveData('config_stations', globalStations); render(); } return false; };
    
    const nameIn = document.getElementById('newStationName'), colIn = document.getElementById('newStationColor'), btn = document.getElementById('addStationBtn'), cancel = document.getElementById('cancelStationEditBtn');
    window.startEditStation = (i) => { editingStationIndex = i; nameIn.value = globalStations[i].name; colIn.value = globalStations[i].color; btn.innerText = "💾"; btn.style.background = "#2196F3"; cancel.style.display = "inline-flex"; };
    const reset = () => { editingStationIndex = null; nameIn.value = ""; btn.innerText = "+"; btn.style.background = ""; cancel.style.display = "none"; };
    cancel.onclick = reset;
    btn.onclick = async () => { if(!nameIn.value) return; const item = { name: nameIn.value, color: colIn.value }; if(editingStationIndex !== null) globalStations[editingStationIndex] = item; else globalStations.push(item); await saveData('config_stations', globalStations); showToast("Sparat", "success"); reset(); render(); };
    document.getElementById('addSpacerBtn').onclick = async () => { globalStations.push({ isSpacer: true }); await saveData('config_stations', globalStations); render(); };
    window.deleteStation = async (i) => { if(await showConfirm("Ta bort?")) { globalStations.splice(i, 1); await saveData('config_stations', globalStations); render(); }};
    render();
}

function initShiftsTab() {
    const render = () => {
        const cont = document.getElementById('shiftListContainer');
        cont.innerHTML = globalShifts.map((sh, i) => `<div class="shift-list-item"><div class="list-info-left"><strong>${sh.label}</strong> <span style="color:#666; margin-left:5px;">(${sh.time})</span></div><div class="list-actions-right"><button class="list-btn" onclick="startEditShift(${i})">✏️</button><button class="list-btn" onclick="deleteShift(${i})">🗑️</button></div></div>`).join('');
    };
    const lblIn = document.getElementById('newShiftLabel'), timeIn = document.getElementById('newShiftTime'), btn = document.getElementById('addShiftBtn'), cancel = document.getElementById('cancelShiftEditBtn');
    window.startEditShift = (i) => { editingShiftIndex = i; lblIn.value = globalShifts[i].label; timeIn.value = globalShifts[i].time; btn.innerText = "Spara"; btn.style.background = "#2196F3"; cancel.style.display = "inline-flex"; };
    const reset = () => { editingShiftIndex = null; lblIn.value = ""; timeIn.value = ""; btn.innerText = "Lägg till Pass"; btn.style.background = ""; cancel.style.display = "none"; };
    cancel.onclick = reset;
    btn.onclick = async () => { if(!lblIn.value) return; const item = { label: lblIn.value, time: timeIn.value }; if(editingShiftIndex !== null) globalShifts[editingShiftIndex] = item; else globalShifts.push(item); await saveData('config_shifts', globalShifts); showToast("Sparat", "success"); reset(); render(); };
    window.deleteShift = async (i) => { if(await showConfirm("Ta bort?")) { globalShifts.splice(i, 1); await saveData('config_shifts', globalShifts); render(); }};
    render();
}

function initAdminTab() {
    const render = async () => {
        let admins = await fetchData('admins');
        if(!Array.isArray(admins)) admins = [];
        document.getElementById('adminListContainer').innerHTML = admins.map(a => `<div class="admin-list-item"><div class="list-info-left"><strong>${a.username}</strong><span style="color:#666; margin-left:5px; font-size:0.9em;">(${a.first_name||''} ${a.last_name||''})</span></div><div class="list-actions-right"><button class="list-btn" onclick='startEditAdmin(${JSON.stringify(a).replace(/'/g,"&#39;")})'>✏️</button><button class="list-btn" onclick="deleteAdmin('${a.username}')">🗑️</button></div></div>`).join('');
    };
    const btn = document.getElementById('addAdminBtn'), cancel = document.getElementById('cancelAdminEditBtn'), userIn = document.getElementById('newAdminUser'), passIn = document.getElementById('newAdminPass'), firstIn = document.getElementById('newAdminFirstName'), lastIn = document.getElementById('newAdminLastName'), emailIn = document.getElementById('newAdminEmail');
    window.startEditAdmin = (u) => { editingAdminId = u.id; userIn.value = u.username; firstIn.value = u.first_name||""; lastIn.value = u.last_name||""; emailIn.value = u.email||""; passIn.placeholder = "Nytt lösen (valfritt)"; passIn.value = ""; btn.innerText = "Spara"; btn.style.background = "#2196F3"; cancel.style.display = "inline-flex"; };
    const reset = () => { editingAdminId = null; userIn.value = ""; passIn.value = ""; firstIn.value = ""; lastIn.value = ""; emailIn.value = ""; passIn.placeholder = "Lösenord"; btn.innerText = "Spara / Skapa konto"; btn.style.background = ""; cancel.style.display = "none"; };
    cancel.onclick = reset;
    btn.onclick = async () => { if(!userIn.value) return showToast("Användarnamn krävs", "error"); const action = editingAdminId ? 'edit_admin' : 'add_admin'; if(action === 'add_admin' && !passIn.value) return showToast("Lösenord krävs", "error"); await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, body: JSON.stringify({action, username:userIn.value, password:passIn.value, firstName:firstIn.value, lastName:lastIn.value, email:emailIn.value, id:editingAdminId}) }); showToast("Sparat", "success"); reset(); render(); };
    window.deleteAdmin = async(u) => { if(await showConfirm("Ta bort?")) { await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${sessionStorage.getItem('jwtToken')}`}, body: JSON.stringify({action:'remove_admin', username:u}) }); showToast("Borttagen", "info"); render(); }};
    render();
}

function initExportTab() {
    const startIn = document.getElementById('printStartDate'), endIn = document.getElementById('printEndDate');
    const today = new Date().toISOString().split('T')[0];
    if(startIn) startIn.value = today; if(endIn) endIn.value = today;

    document.getElementById('btnSetToday').onclick = () => { startIn.value = today; endIn.value = today; };
    document.getElementById('btnSetWeek').onclick = () => { const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); d.setDate(diff); startIn.value = d.toISOString().split('T')[0]; d.setDate(d.getDate() + 6); endIn.value = d.toISOString().split('T')[0]; };
    document.getElementById('btnSetNextWeek').onclick = () => { const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); d.setDate(diff + 7); startIn.value = d.toISOString().split('T')[0]; d.setDate(d.getDate() + 6); endIn.value = d.toISOString().split('T')[0]; };

    const runExport = async (mode) => {
        const sDate = new Date(startIn.value), eDate = new Date(endIn.value);
        if (sDate > eDate) return showToast("Startdatum måste vara före slutdatum", "error");
        
        if (mode === 'print') {
            const pc = document.getElementById('print-container') || document.createElement('div');
            pc.id = 'print-container';
            if(!document.body.contains(pc)) document.body.appendChild(pc);
            let html = "", loopDate = new Date(sDate);
            while (loopDate <= eDate) { html += generateSingleDayPrintHtml(new Date(loopDate)); loopDate.setDate(loopDate.getDate() + 1); }
            pc.innerHTML = html;
            window.print();
            setTimeout(() => pc.innerHTML = '', 1000);
        } else {
            if(typeof html2canvas === 'undefined') return showToast("html2canvas saknas.", "error");
            const btn = document.getElementById('doImageBtn'), txt = btn.innerText;
            btn.innerText = "Genererar...";
            const temp = document.createElement('div');
            temp.style.cssText = "position:absolute; top:-9999px; left:0; width:1200px; background:#fff;";
            document.body.appendChild(temp);
            let loopDate = new Date(sDate), count = 0;
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
    const imgBtn = document.getElementById('doImageBtn'); if(imgBtn) imgBtn.onclick = () => runExport('image');
}

function generateSingleDayPrintHtml(dateObj, forImage = false) {
    // Samma funktion som du redan har, den är beroende av globala variabler som vi definierat överst.
    const iso = getISOWeek(dateObj);
    const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1; 
    const dayName = DAYS[dayIndex], dateStr = dateObj.toLocaleDateString('sv-SE');
    const prefix = `y${iso.year}w${iso.week}-${dayName}-`;
    const shifts = (Array.isArray(globalShifts) && globalShifts.length) ? globalShifts : DEFAULT_SHIFTS;
    const stations = (Array.isArray(globalStations) && globalStations.length) ? globalStations : DEFAULT_STATIONS;
    const style = forImage ? 'padding:20px; font-family:sans-serif; background:#fff;' : 'page-break-after: always; padding: 20px; font-family: sans-serif;';
    
    let html = `<div class="print-page" style="${style}"><div style="text-align:center; margin-bottom:20px;"><h2 style="margin:0;">${dayName} ${dateStr}</h2><span style="font-size:0.9em; color:#666;">Vecka ${iso.week}, ${iso.year}</span></div>`;
    html += `<div style="display:grid; grid-template-columns:150px repeat(${shifts.length}, 1fr); gap:0; border:1px solid #000; border-bottom:none;"><div style="background:#ddd; border-right:1px solid #000; padding:5px;"></div>${shifts.map(s => `<div style="background:#ddd; border-right:1px solid #000; padding:5px; text-align:center; font-weight:bold;">${s.time}<br><span style="font-size:0.8em; font-weight:normal;">${s.label}</span></div>`).join('')}</div><div style="border:1px solid #000; border-top:none;">`;
    stations.forEach(st => {
        if (st.isSpacer) { html += `<div style="height:15px; background:#f0f0f0; border-top:1px solid #000;"></div>`; return; }
        const bg = st.color, fg = isLight(bg) ? '#000' : '#fff';
        html += `<div style="display:grid; grid-template-columns:150px repeat(${shifts.length}, 1fr); border-top:1px solid #000;"><div style="background:${bg}; color:${fg}; padding:10px; font-weight:bold; border-right:1px solid #000; display:flex; align-items:center;">${st.name}</div>`;
        shifts.forEach((sh, index) => {
            const val = globalScheduleData[`${prefix}${st.name}-${sh.time}`] || "";
            const borderRight = index === shifts.length - 1 ? '' : 'border-right:1px solid #000;';
            html += `<div style="padding:5px; display:flex; align-items:center; justify-content:center; text-align:center; font-weight:bold; font-size:0.9rem; ${borderRight}">${val}</div>`;
        });
        html += `</div>`;
    });
    return html + `</div></div>`;
}

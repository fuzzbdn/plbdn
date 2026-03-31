import { fetchData, saveData } from './service.js';
import { showToast, showConfirm, isLight, getISOWeek, escapeHTML } from './utils.js';
import { DEFAULT_STATIONS, DEFAULT_SHIFTS, DAYS } from './config.js';

let globalStations = [], globalShifts = [], globalCustomThemes = [], globalScheduleData = {};
let editingStationIndex = null, editingShiftIndex = null, editingAdminId = null, dragSrcStationEl = null, dragSrcShiftEl = null;
export async function initSettings() {
    // FIX: Tog bort escapeHTML för innerText
    document.getElementById('currentUserDisplay').innerText = "Inloggad: " + (sessionStorage.getItem('adminName')||'Admin');
    document.getElementById('logoutBtn').onclick = () => { sessionStorage.clear(); window.location.href="index.html"; };

    const [draft, published, old, settings, themes, stations, shifts] = await Promise.all([
        fetchData('schedule_draft'), 
        fetchData('schedule_published'), 
        fetchData('schedule'),
        fetchData('settings'), 
        fetchData('custom_themes'), 
        fetchData('config_stations'), 
        fetchData('config_shifts')
    ]);
    
    globalScheduleData = (draft && Object.keys(draft).length) ? draft : (published || old || {});
    globalCustomThemes = themes || [];
    globalStations = (Array.isArray(stations) && stations.length) ? stations : DEFAULT_STATIONS;
    globalShifts = (Array.isArray(shifts) && shifts.length) ? shifts : DEFAULT_SHIFTS;

    initGeneralTab();
    initWeatherTab(); 
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

function initWeatherTab() {
    const searchIn = document.getElementById('weatherSearchInput');
    const searchBtn = document.getElementById('searchLocationBtn');
    const resultsDiv = document.getElementById('searchResultsContainer');
    const resultsSelect = document.getElementById('locationResultsSelect');
    
    const currentDisplay = document.getElementById('currentWeatherDisplay');
    const hiddenLat = document.getElementById('weatherLat');
    const hiddenLong = document.getElementById('weatherLong');
    const hiddenName = document.getElementById('weatherCityName');

    fetchData('weather_config').then(data => {
        if (data && data.name) {
            updateCurrentDisplay(data.name, data.latitude, data.longitude);
        } else {
            updateCurrentDisplay("BODEN", "65.82", "21.69");
        }
    });

    function updateCurrentDisplay(name, lat, long) {
        currentDisplay.innerHTML = `📍 <strong>${escapeHTML(name)}</strong> <span style="font-size:0.9em; color:#666;">(${escapeHTML(lat)}, ${escapeHTML(long)})</span>`;
        hiddenName.value = name;
        hiddenLat.value = lat;
        hiddenLong.value = long;
    }

    if(searchBtn) {
        searchBtn.onclick = async () => {
            const query = searchIn.value.trim();
            if (query.length < 2) return showToast("Skriv minst 2 tecken", "info");

            searchBtn.innerText = "Söker...";
            try {
                const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=sv&format=json`;
                const res = await fetch(url);
                const data = await res.json();

                resultsSelect.innerHTML = ""; 

                if (!data.results || data.results.length === 0) {
                    showToast("Inga platser hittades", "info");
                    resultsDiv.style.display = "none";
                } else {
                    data.results.forEach(place => {
                        const country = place.country || "";
                        const admin1 = place.admin1 || ""; 
                        const label = `${place.name}, ${admin1} ${country}`;
                        
                        const option = document.createElement('option');
                        option.text = label;
                        option.value = JSON.stringify({
                            name: place.name,
                            lat: place.latitude,
                            long: place.longitude
                        });
                        resultsSelect.add(option);
                    });
                    
                    resultsDiv.style.display = "block";
                    
                    if (data.results.length > 0) {
                        const first = data.results[0];
                        updateCurrentDisplay(first.name, first.latitude, first.longitude);
                    }
                }
            } catch (e) {
                console.error(e);
                showToast("Kunde inte söka. Kontrollera nätverk.", "error");
            } finally {
                searchBtn.innerText = "🔍 Sök";
            }
        };
    }

    if(resultsSelect) {
        resultsSelect.onchange = () => {
            const selectedData = JSON.parse(resultsSelect.value);
            updateCurrentDisplay(selectedData.name, selectedData.lat, selectedData.long);
        };
    }

    const saveBtn = document.getElementById('saveWeatherBtn');
    if(saveBtn) {
        saveBtn.onclick = async () => {
            const config = {
                name: hiddenName.value,
                latitude: hiddenLat.value,
                longitude: hiddenLong.value
            };
            
            await saveData('weather_config', config);
            showToast("Plats sparad! Displayen uppdateras strax.", "success");
            
            if(resultsDiv) resultsDiv.style.display = "none";
            if(searchIn) searchIn.value = "";
        };
    }
    
    if(searchIn) {
        searchIn.onkeydown = (e) => {
            if(e.key === 'Enter' && searchBtn) searchBtn.click();
        };
    }
}

function initThemeTab(currentSettings) {
    const themeSelect = document.getElementById('themeSelect');
    const editSelect = document.getElementById('editThemeSelect');
    const iframe = document.getElementById('themePreviewIframe');

    // Tvinga iframen att bete sig som en 1080p TV-skärm och skala ner den
if (iframe) {
        iframe.style.width = '1920px';
        iframe.style.height = '1080px';
        iframe.style.transformOrigin = 'top left';
        
        const resizeIframe = () => {
            const parent = iframe.parentElement;
            if (!parent) return;
            
            // 1. Räkna ut skalan enbart baserat på tillgänglig bredd
            const scale = parent.clientWidth / 1920;
            iframe.style.transform = `scale(${scale})`;
            
            // 2. Tvinga rutan att bli exakt lika hög som den nedskalade TV-skärmen
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

        // Bygg äkta HTML med dagens datum och din riktiga schemadata!
        const now = new Date();
        const iso = getISOWeek(now);
        const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1; 
        const dayName = DAYS[dayIndex];
        const dateStr = `${now.getDate()}/${now.getMonth() + 1}`;
        const prefix = `y${iso.year}w${iso.week}-${dayName}-`;

        let html = `
        <div class="display-wrapper">
            <div class="top-bar">
                <h1 id="mainTitle">Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})</h1>
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
            if (st.isSpacer) { 
                html += `<div class="display-row spacer-row"></div>`; 
                return; 
            }
            
            const contrast = isLight(st.color) ? '#000' : '#fff';
            const vars = `style="--station-color:${escapeHTML(st.color)}; --contrast-color:${contrast};"`;
            
            html += `<div class="display-row" ${vars}><div class="station-label">${escapeHTML(st.name)}</div>`;
            
            globalShifts.forEach(sh => {
                const key = `${prefix}${st.name}-${sh.time}`;
                const val = globalScheduleData[key] || "";
                const safeVal = escapeHTML(val);
                html += `<div class="shift-card ${safeVal?'':'empty'}" data-label="${escapeHTML(sh.label)}">${safeVal}</div>`;
            });
            
            html += `</div>`;
        });
        
        html += `</div></div>`;

        // Skriv in allt i iframen som ett helt nytt dokument
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
        const cur = themeSelect.value || (currentSettings?.theme || 'light');
        themeSelect.innerHTML = `<option value="light">Ljus (Standard)</option>` + 
                                globalCustomThemes.map(t => `<option value="${escapeHTML(t.id)}">✨ ${escapeHTML(t.name)}</option>`).join('');
        themeSelect.value = cur;
        setTimeout(() => updatePreview(cur), 100);
        if(editSelect) {
            editSelect.innerHTML = '<option value="">-- Välj tema att redigera --</option>' + 
                                   globalCustomThemes.map(t => `<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)}</option>`).join('');
        }
    }

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
            
            // Ladda den nya CSS-koden direkt i previewen
            if(themeSelect.value === id) updatePreview(id);
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
    
    // Säkerställ att iframen skalas om när man klickar på fliken (eftersom den kan ha varit osynlig)
    const tabBtn = document.querySelector('button[onclick="openTab(\'tab-theme\')"]');
    if(tabBtn) {
        tabBtn.addEventListener('click', () => {
            setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
        });
    }
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
            return `<div class="draggable-station" ${dragAttr}><div class="list-info-left"><span class="drag-handle">☰</span><div style="width:20px; height:20px; background:${escapeHTML(st.color)}; border-radius:50%; border:1px solid #ccc; flex-shrink:0;"></div><strong>${escapeHTML(st.name)}</strong></div><div class="list-actions-right"><button class="list-btn" onclick="startEditStation(${i})">✏️</button><button class="list-btn" onclick="deleteStation(${i})">🗑️</button></div></div>`;
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

    // DRA-OCH-SLÄPP LOGIK FÖR PASS
    window.handleShiftDragStart = (e) => {
        dragSrcShiftEl = e.target.closest('.draggable-shift');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', dragSrcShiftEl.innerHTML);
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
            await saveData('config_shifts', globalShifts);
            renderShifts(); 
        }
        return false;
    };

    const renderShifts = () => {
        const cont = document.getElementById('shiftListContainer');
        if(!Array.isArray(globalShifts)) globalShifts = DEFAULT_SHIFTS;
        cont.innerHTML = globalShifts.map((sh, i) => `
        <div class="shift-list-item draggable-shift" draggable="true" ondragstart="handleShiftDragStart(event)" ondragover="handleShiftDragOver(event)" ondrop="handleShiftDrop(event)" data-index="${i}">
            <div class="list-info-left">
                <span class="drag-handle">☰</span>
                <strong>${escapeHTML(sh.label)}</strong> 
                <span style="color:#666; margin-left:5px;">(${escapeHTML(sh.time)})</span>
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

    // FIX: Lyssnare för edit och delete kopplat till list-containern
    const adminListContainer = document.getElementById('adminListContainer');
    adminListContainer.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-admin-btn');
        const delBtn = e.target.closest('.delete-admin-btn');
        if (editBtn) {
            const adminData = JSON.parse(editBtn.getAttribute('data-admin'));
            startEditAdmin(adminData);
        } else if (delBtn) {
            deleteAdmin(delBtn.getAttribute('data-username'));
        }
    });

    const renderAdmins = async () => {
        let admins = await fetchData('admins');
        if(!Array.isArray(admins)) admins = [];
        // FIX: Dat-attribut för att slippa O'Brian krascher i admin listan
        adminListContainer.innerHTML = admins.map(a => `
            <div class="admin-list-item">
                <div class="list-info-left">
                    <strong>${escapeHTML(a.username)}</strong>
                    <span style="color:#666; margin-left:5px; font-size:0.9em;">
                        (${escapeHTML(a.first_name||'')} ${escapeHTML(a.last_name||'')})
                    </span>
                </div>
                <div class="list-actions-right">
                    <button class="list-btn edit-admin-btn" data-admin='${escapeHTML(JSON.stringify(a))}'>✏️</button>
                    <button class="list-btn delete-admin-btn" data-username="${escapeHTML(a.username)}">🗑️</button>
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
                        ${generateDisplayHtmlForImage(new Date(loopDate))}
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
                    
                    const link = document.createElement('a');
                    link.download = `Schema-${loopDate.toLocaleDateString('sv-SE')}.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                    count++;
                } catch (e) { console.error("Kunde inte skapa bild:", e); }
                
                loopDate.setDate(loopDate.getDate() + 1);
            }
            
            document.body.removeChild(iframe);
            btn.innerText = txt;
            showToast(`Klar! ${count} bild(er).`, "success");
        }
    };
    
    document.getElementById('doPrintBtn').onclick = () => runExport('print');
    const imgBtn = document.getElementById('doImageBtn'); 
    if(imgBtn) imgBtn.onclick = () => runExport('image');
}

function generateSingleDayPrintHtml(dateObj) {
    const iso = getISOWeek(dateObj);
    const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1; 
    const dayName = DAYS[dayIndex];
    const dateStr = dateObj.toLocaleDateString('sv-SE');
    const prefix = `y${iso.year}w${iso.week}-${dayName}-`;
    
    let html = `
    <div class="print-page" style="padding: 10px; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box;">
        <div style="text-align:center; margin-bottom:15px;">
            <h1 style="margin:0; font-size: 1.8rem;">Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})</h1>
        </div>
        <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 5px; justify-content: space-between;">
            <div style="display:grid; grid-template-columns: 200px repeat(${globalShifts.length}, 1fr); gap: 10px;">
                <div></div>
                ${globalShifts.map(s => `
                    <div style="text-align:center; font-weight:800; text-transform:uppercase; color:#555; font-size:0.85rem;">
                        ${escapeHTML(s.label)}<br><small style="font-weight:400;">${escapeHTML(s.time)}</small>
                    </div>`).join('')}
            </div>`;

    globalStations.forEach(st => {
        if (st.isSpacer) { 
            html += `<div style="flex-grow: 0.2;"></div>`; 
            return; 
        }
        
        const bg = st.color;
        const fg = isLight(bg) ? '#000' : '#fff';
        
        html += `
        <div style="display:grid; grid-template-columns: 200px repeat(${globalShifts.length}, 1fr); gap: 10px; flex: 1;">
            <div style="background:${escapeHTML(bg)}; color:${fg}; padding:10px; border-radius:6px; font-weight:800; font-size:1.1rem; display:flex; align-items:center; border: 1px solid #ddd; justify-content: center;">
                ${escapeHTML(st.name)}
            </div>`;
            
        globalShifts.forEach(sh => {
            const val = globalScheduleData[`${prefix}${st.name}-${sh.time}`] || "";
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

function generateDisplayHtmlForImage(dateObj) {
    const iso = getISOWeek(dateObj);
    const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1; 
    const dayName = DAYS[dayIndex];
    const dateStr = `${dateObj.getDate()}/${dateObj.getMonth() + 1}`;
    const prefix = `y${iso.year}w${iso.week}-${dayName}-`;
    
    let html = `
    <div class="display-wrapper">
        <div class="top-bar">
            <h1 id="mainTitle">Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})</h1>
        </div>
        
        <div id="mainContainer">
            <div class="time-header-row">
                <div></div>
                ${globalShifts.map(s => `<div class="time-header">${escapeHTML(s.label)}</div>`).join('')}
            </div>
    `;
    
    globalStations.forEach(st => {
        if (st.isSpacer) { 
            html += `<div class="display-row spacer-row"></div>`; 
            return; 
        }
        
        const contrast = isLight(st.color) ? '#000' : '#fff';
        const vars = `style="--station-color:${escapeHTML(st.color)}; --contrast-color:${contrast};"`;
        
        html += `<div class="display-row" ${vars}><div class="station-label">${escapeHTML(st.name)}</div>`;
        
        globalShifts.forEach(sh => {
            const key = `${prefix}${st.name}-${sh.time}`;
            const val = globalScheduleData[key] || "";
            html += `<div class="shift-card ${val ? '' : 'empty'}" data-label="${escapeHTML(sh.label)}">${escapeHTML(val)}</div>`;
        });
        
        html += `</div>`;
    });
    
    html += `
        </div>
    </div>`;
    
    return html;
}

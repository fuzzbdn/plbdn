import { saveData } from '../service.js';
import { showToast, showConfirm, isLight, escapeHTML, getISOWeek } from '../utils.js';
import { getCustomThemes, setCustomThemes, getStations, getShifts, getScheduleData } from '../store.js';

export function initThemeTab(currentSettings) {
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
            const t = getCustomThemes().find(x => x.id === themeId);
            if (t) customCss = t.css;
        }

        const now = new Date();
        const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1; 
        const dayName = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"][dayIndex];
        const dateStr = `${now.getDate()}/${now.getMonth() + 1}`;
        const iso = getISOWeek(now);
        
        const currentStations = getStations();
        const currentShifts = getShifts();
        const scheduleData = getScheduleData();

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
                    ${currentShifts.map(s => `<div class="time-header">${escapeHTML(s.label)}</div>`).join('')}
                </div>
        `;
        
        currentStations.forEach(st => {
            if (st.is_spacer) { 
                html += `<div class="display-row spacer-row"></div>`; 
                return; 
            }
            
            const contrast = isLight(st.color) ? '#000' : '#fff';
            const vars = `style="--station-color:${escapeHTML(st.color)}; --contrast-color:${contrast};"`;
            
            html += `<div class="display-row" ${vars}><div class="station-label">${escapeHTML(st.name)}</div>`;
            
            currentShifts.forEach(sh => {
                const targetDateStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                
                // FIX: Använd det nya uppdaterade formatet på nyckeln som matchar store.js
                const assignedRows = scheduleData[`${targetDateStr}_${st.id}_${sh.id}`] || [];
                
                // FIX: Datumet är redan filtrerat i nyckeln, så vi behöver bara kolla is_published
                const validRows = assignedRows.filter(r => r.is_published);
                
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
        const customThemes = getCustomThemes();
        const cur = themeSelect?.value || (currentSettings?.theme || 'light');
        if(themeSelect) {
            themeSelect.innerHTML = `<option value="light">Ljus (Standard)</option>` + 
                                    customThemes.map(t => `<option value="${escapeHTML(t.id)}">✨ ${escapeHTML(t.name)}</option>`).join('');
            themeSelect.value = cur;
        }
        setTimeout(() => updatePreview(cur), 100);
        if(editSelect) {
            editSelect.innerHTML = '<option value="">-- Välj tema att redigera --</option>' + 
                                   customThemes.map(t => `<option value="${escapeHTML(t.id)}">${escapeHTML(t.name)}</option>`).join('');
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
            const t = getCustomThemes().find(x => x.id === editSelect.value); 
            if (t) { tName.value = t.name; tCss.value = t.css; tId.value = t.id; } 
        };
        
        document.getElementById('clearThemeEditorBtn').onclick = () => { 
            tId.value=""; tName.value=""; tCss.value=""; editSelect.value=""; 
        };
        
        document.getElementById('saveCustomThemeBtn').onclick = async () => {
            if(!tName.value || !tCss.value) return showToast("Fyll i namn och CSS", "error");
            const id = tId.value || 'theme_' + Date.now();
            const newTheme = { id: id, name: tName.value, css: tCss.value };
            
            const currentThemes = [...getCustomThemes()];
            const index = currentThemes.findIndex(t => t.id === id);
            
            if(index >= 0) currentThemes[index] = newTheme; 
            else currentThemes.push(newTheme);
            
            setCustomThemes(currentThemes);
            await saveData('custom_themes', currentThemes);
            
            showToast("Tema sparat!", "success");
            document.getElementById('clearThemeEditorBtn').click(); 
            populate();
            
            if(themeSelect && themeSelect.value === id) updatePreview(id);
        };
        
        document.getElementById('deleteThemeBtn').onclick = async () => {
            const id = editSelect.value; if(!id) return;
            if(await showConfirm("Radera detta tema?")) {
                const currentThemes = getCustomThemes().filter(t => t.id !== id);
                setCustomThemes(currentThemes);
                await saveData('custom_themes', currentThemes);
                
                if(themeSelect && themeSelect.value === id) { 
                    themeSelect.value='light'; 
                    await saveData('settings', {theme:'light'}); 
                }
                
                showToast("Tema raderat", "info"); 
                document.getElementById('clearThemeEditorBtn').click(); 
                populate();
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

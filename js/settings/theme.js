import { saveData } from '../service.js';
import { showToast, showConfirm, isLight, escapeHTML, getISOWeek } from '../utils.js';
import { getCustomThemes, setCustomThemes, getStations, getShifts, getScheduleData } from '../store.js';

function buildAssignmentHtml(a) {
    const name = escapeHTML(a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim());
    const note = a.note ? `<span style="color:#888; font-size:0.8em; font-weight:400;"> (${escapeHTML(a.note)})</span>` : '';
    return `<span>${name}${note}</span>`;
}

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

        const now        = new Date();
        const dayIndex   = now.getDay() === 0 ? 6 : now.getDay() - 1;
        const dayName    = ["Måndag","Tisdag","Onsdag","Torsdag","Fredag","Lördag","Söndag"][dayIndex];
        const dateStr    = `${now.getDate()}/${now.getMonth() + 1}`;
        const iso        = getISOWeek(now);
        const targetDateStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

        const currentStations = getStations();
        const currentShifts   = getShifts();

        const rawScheduleData = getScheduleData();
        const previewSchedule = {};
        Object.entries(rawScheduleData).forEach(([key, rows]) => {
            const parts = key.split('_');
            if (parts.length < 3) return;
            const [date, stationId, shiftId] = parts;
            if (date !== targetDateStr) return;
            const displayKey = `${stationId}_${shiftId}`;
            if (!previewSchedule[displayKey]) previewSchedule[displayKey] = [];
            previewSchedule[displayKey].push(...rows);
        });

        const timeHeaders = currentShifts.map(s => `<div class="time-header">${escapeHTML(s.label)}</div>`).join('');
        let gridHtml = `<div class="time-header-row"><div></div>${timeHeaders}</div>`;

        currentStations.forEach(st => {
            if (st.is_spacer) {
                gridHtml += `<div class="display-row spacer-row"></div>`;
                return;
            }
            const contrast  = isLight(st.color) ? '#000' : '#fff';
            const safeColor = escapeHTML(st.color);

            gridHtml += `<div class="display-row" style="--station-color:${safeColor}; --contrast-color:${contrast};">`;
            gridHtml += `<div class="station-label">${escapeHTML(st.name)}</div>`;

            currentShifts.forEach(sh => {
                const assignments = (previewSchedule[`${st.id}_${sh.id}`] || [])
                    .filter(r => r.is_published);
                const val = assignments.map(buildAssignmentHtml).join(' / ');
                const isEmpty = assignments.length === 0;
                gridHtml += `<div class="shift-card ${isEmpty ? 'empty' : ''}" data-label="${escapeHTML(sh.label)}">${isEmpty ? '' : val}</div>`;
            });

            gridHtml += `</div>`;
        });

        const doc = iframe.contentDocument;
        doc.open();
        doc.close();

        doc.documentElement.lang = 'sv';

        const base = doc.createElement('base');
        base.href = window.location.href;
        doc.head.appendChild(base);

        const metaCharset = doc.createElement('meta');
        metaCharset.setAttribute('charset', 'UTF-8');
        doc.head.appendChild(metaCharset);

        for (const href of [
            'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap',
            'css/base.css',
            'css/display.css'
        ]) {
            const link = doc.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            doc.head.appendChild(link);
        }

        const scrollStyle = doc.createElement('style');
        scrollStyle.textContent = '::-webkit-scrollbar { display: none; }';
        doc.head.appendChild(scrollStyle);

        doc.body.className = 'display-view';
        doc.body.id = 'page-display';

        const wrapper = doc.createElement('div');
        wrapper.className = 'display-wrapper';

        const topBar = doc.createElement('div');
        topBar.className = 'top-bar';

        const h1 = doc.createElement('h1');
        h1.id = 'mainTitle';
        h1.textContent = `Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})`;
        topBar.appendChild(h1);

        const rightDiv = doc.createElement('div');
        rightDiv.style.cssText = 'display:flex; align-items:center;';

        const weatherDiv = doc.createElement('div');
        weatherDiv.id = 'weatherWidget';
        weatherDiv.style.cssText = 'margin-right:20px; font-weight:700;';
        weatherDiv.textContent = '☀️ 20°C';

        const clockDiv = doc.createElement('div');
        clockDiv.id = 'clock';
        clockDiv.textContent = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

        rightDiv.appendChild(weatherDiv);
        rightDiv.appendChild(clockDiv);
        topBar.appendChild(rightDiv);
        wrapper.appendChild(topBar);

        const marqueeContainer = doc.createElement('div');
        marqueeContainer.id = 'marqueeContainer';
        marqueeContainer.style.display = 'none';
        const marqueeEl = doc.createElement('marquee');
        marqueeEl.id = 'marqueeText';
        marqueeEl.setAttribute('scrollamount', '10');
        marqueeContainer.appendChild(marqueeEl);
        wrapper.appendChild(marqueeContainer);

        const mainContainer = doc.createElement('div');
        mainContainer.id = 'mainContainer';
        mainContainer.innerHTML = gridHtml;
        wrapper.appendChild(mainContainer);

        doc.body.appendChild(wrapper);

        if (customCss) {
            const styleEl = doc.createElement('style');
            styleEl.textContent = customCss;
            doc.head.appendChild(styleEl);
        }
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

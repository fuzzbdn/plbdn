import { fetchData } from '../service.js';
import { showToast, isLight, escapeHTML, getISOWeek } from '../utils.js';
import { DAYS } from '../config.js';
import { getCustomThemes } from '../store.js';

export function initExportTab(currentSettings) {
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

    const defaultDays = parseInt(currentSettings?.exportDefaultDays) || 1;
    const dStart = new Date();
    const dEnd = new Date(dStart);
    dEnd.setDate(dStart.getDate() + defaultDays - 1); 
    setDates(dStart, dEnd);

    if(btnToday) btnToday.onclick = () => { const d = new Date(); setDates(d, d); };
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
            if (st.is_spacer) { html += `<div style="flex-grow: 0.2;"></div>`; return; }
            const bg = st.color;
            const fg = isLight(bg) ? '#000' : '#fff';

            html += `
            <div style="display:grid; grid-template-columns: 200px repeat(${shifts.length}, 1fr); gap: 10px; flex: 1;">
                <div style="background:${escapeHTML(bg)}; color:${fg}; padding:10px; border-radius:6px; font-weight:800; font-size:1.1rem; display:flex; align-items:center; border: 1px solid #ddd; justify-content: center;">
                    ${escapeHTML(st.name)}
                </div>`;

            shifts.forEach(sh => {
                const assignedRows = schedule.filter(r => r.is_published && r.work_date.split('T')[0] === targetDateStr && r.station_id === st.id && r.shift_id === sh.id);
                const val = assignedRows.map(a => a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim()).join(' / ');
                html += `<div style="background:#fff; border: 1px solid #ccc; border-radius:6px; display:flex; align-items:center; justify-content:center; text-align:center; font-weight:700; font-size:1.2rem;">${escapeHTML(val)}</div>`;
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
                </div>`;

        stations.forEach(st => {
            if (st.is_spacer) { html += `<div class="display-row spacer-row"></div>`; return; }
            const contrast = isLight(st.color) ? '#000' : '#fff';
            const vars = `style="--station-color:${escapeHTML(st.color)}; --contrast-color:${contrast};"`;

            html += `<div class="display-row" ${vars}><div class="station-label">${escapeHTML(st.name)}</div>`;

            shifts.forEach(sh => {
                const assignedRows = schedule.filter(r => r.is_published && r.work_date.split('T')[0] === targetDateStr && r.station_id === st.id && r.shift_id === sh.id);
                const val = assignedRows.map(a => a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim()).join(' / ');
                html += `<div class="shift-card ${val ? '' : 'empty'}" data-label="${escapeHTML(sh.label)}">${escapeHTML(val)}</div>`;
            });
            html += `</div>`;
        });
        html += `</div></div>`;
        return html;
    }

    const runExport = async (mode) => {
        const sDate = new Date(startInp.value);
        const eDate = new Date(endInp.value);
        if (sDate > eDate) return showToast("Startdatum måste vara före slutdatum", "error");

        showToast("Hämtar data för export...", "info");

        // Hämtar dagsfärsk data för den exakta perioden
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
            if(typeof JSZip === 'undefined') return showToast("JSZip saknas.", "error"); 

            const btn = document.getElementById('doImageBtn');
            const txt = btn.innerText;
            btn.innerText = "Genererar...";

            let customCss = "";
            const themeSelect = document.getElementById('themeSelect');
            if (themeSelect && themeSelect.value && themeSelect.value !== 'light') {
                const t = getCustomThemes().find(x => x.id === themeSelect.value);
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
                            <link rel="stylesheet" href="css/base.css">
                            <link rel="stylesheet" href="css/display.css">
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
                        scale: 2, useCORS: true, backgroundColor: doc.body.style.backgroundColor || '#f0f2f5'
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
                link.download = singleImageName; link.href = singleImageBase64; link.click();
                showToast("Bild sparad!", "success");
            } else if (count > 1) {
                showToast("Packar ZIP-fil...", "info");
                try {
                    const content = await zip.generateAsync({type: "blob"});
                    const link = document.createElement('a');
                    link.download = `Scheman_${startInp.value}_till_${endInp.value}.zip`;
                    const url = URL.createObjectURL(content);
                    link.href = url; link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000); 
                    showToast(`Klar! ${count} bilder sparade i en ZIP.`, "success");
                } catch(e) { showToast("Kunde inte skapa ZIP", "error"); }
            }
        }
    };

    if(printBtn) printBtn.onclick = () => runExport('print');
    if(imgBtn) imgBtn.onclick = () => runExport('image');
}

import { fetchData } from '../service.js';
import { showToast, isLight, escapeHTML, getISOWeek } from '../utils.js';
import { DAYS } from '../config.js';
import { getCustomThemes } from '../store.js';

// ==========================================
// Hjälpfunktioner (top-level för att undvika djup nästling)
// ==========================================
function buildShiftCellContent(assignedRows) {
    return assignedRows.map(a => {
        const name = escapeHTML(a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim());
        const note = a.note ? `<span style="color:#888; font-size:0.8em; font-weight:400;"> (${escapeHTML(a.note)})</span>` : '';
        return `<span style="font-weight:700;">${name}</span>${note}`;
    }).join(' / ');
}

function generateSingleDayPrintHtml(dateObj, stations, shifts, schedule) {
    const iso = getISOWeek(dateObj);
    const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1;
    const dayName = DAYS[dayIndex];
    const dateStr = dateObj.toLocaleDateString('sv-SE');
    const targetDateStr = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    const shiftHeaders = shifts.map(s => `
        <div class="print-col-title">
            ${escapeHTML(s.label)}<br><small>${escapeHTML(s.time_range || s.time || '')}</small>
        </div>`).join('');

    let html = `
    <div class="print-page-wrapper">
        <div class="print-header">
            <h1>Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})</h1>
        </div>
        <div class="print-grid-container">
            <div class="print-grid-row" style="grid-template-columns: 200px repeat(${shifts.length}, 1fr);">
                <div></div>${shiftHeaders}
            </div>`;

    stations.forEach(st => {
        if (st.is_spacer) {
            html += `<div class="print-spacer"></div>`;
            return;
        }
        const bg = escapeHTML(st.color);
        const fg = isLight(st.color) ? '#000' : '#fff';
        const shiftCells = shifts.map(sh => {
            const assignedRows = schedule.filter(r =>
                r.is_published &&
                r.work_date.split('T')[0] === targetDateStr &&
                r.station_id === st.id &&
                r.shift_id === sh.id
            );
            return `<div class="print-shift-cell">${buildShiftCellContent(assignedRows)}</div>`;
        }).join('');

        html += `
        <div class="print-grid-row print-data-row" style="grid-template-columns: 200px repeat(${shifts.length}, 1fr);">
            <div class="print-station-cell" style="background:${bg}; color:${fg};">${escapeHTML(st.name)}</div>
            ${shiftCells}
        </div>`;
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

    const timeHeaders = shifts.map(s => `<div class="time-header">${escapeHTML(s.label)}</div>`).join('');

    let html = `
    <div class="display-wrapper">
        <div class="top-bar">
            <h1 id="mainTitle">Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})</h1>
        </div>
        <div id="mainContainer">
            <div class="time-header-row"><div></div>${timeHeaders}</div>`;

    stations.forEach(st => {
        if (st.is_spacer) { html += `<div class="display-row spacer-row"></div>`; return; }
        const contrast = isLight(st.color) ? '#000' : '#fff';
        const safeColor = escapeHTML(st.color);

        const shiftCards = shifts.map(sh => {
            const assignedRows = schedule.filter(r =>
                r.is_published &&
                r.work_date.split('T')[0] === targetDateStr &&
                r.station_id === st.id &&
                r.shift_id === sh.id
            );
            const isEmpty = assignedRows.length === 0;
            return `<div class="shift-card ${isEmpty ? 'empty' : ''}" data-label="${escapeHTML(sh.label)}">${isEmpty ? '' : buildShiftCellContent(assignedRows)}</div>`;
        }).join('');

        html += `<div class="display-row" style="--station-color:${safeColor}; --contrast-color:${contrast};">
            <div class="station-label">${escapeHTML(st.name)}</div>
            ${shiftCards}
        </div>`;
    });
    html += `</div></div>`;
    return html;
}

function getCustomCss() {
    const themeSelect = document.getElementById('themeSelect');
    if (!themeSelect?.value || themeSelect.value === 'light') return '';
    const t = getCustomThemes().find(x => x.id === themeSelect.value);
    return t ? t.css : '';
}

async function runPrintExport(sDate, eDate, stations, shifts, schedule) {
    const pc = document.getElementById('print-container') || document.createElement('div');
    pc.id = 'print-container';
    if (!document.body.contains(pc)) document.body.appendChild(pc);

    let html = '';
    let loopDate = new Date(sDate);
    while (loopDate <= eDate) {
        html += generateSingleDayPrintHtml(new Date(loopDate), stations, shifts, schedule);
        loopDate = new Date(loopDate.getTime() + 86400000);
    }
    pc.innerHTML = html;
    window.print();
    setTimeout(() => { pc.innerHTML = ''; }, 1000);
}

async function runImageExport(sDate, eDate, stations, shifts, schedule, customCss) {
    if (typeof html2canvas === 'undefined') return showToast("html2canvas saknas.", "error");
    if (typeof JSZip === 'undefined') return showToast("JSZip saknas.", "error");

    const btn = document.getElementById('doImageBtn');
    const txt = btn.innerText;
    btn.innerText = "Genererar...";

    const iframe = document.createElement('iframe');
    iframe.style.cssText = "position:absolute; top:-9999px; left:0; width:1920px; height:1080px; border:none;";
    document.body.appendChild(iframe);

    try {
        let loopDate = new Date(sDate);
        let count = 0;
        const zip = new JSZip();
        let singleImageBase64 = null;
        let singleImageName = "";

        while (loopDate <= eDate) {
            const doc = iframe.contentDocument;
            const iframeLoaded = new Promise(resolve => { iframe.onload = resolve; });

            doc.open();
            doc.write(`
                <!DOCTYPE html>
                <html lang="sv">
                <head>
                    <base href="${globalThis.location.href}">
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
                    <link rel="stylesheet" href="css/base.css">
                    <link rel="stylesheet" href="css/display.css">
                    <style>
                        * { transition: none !important; animation: none !important; }
                        body { margin: 0; overflow: hidden; background-color: var(--bg-color, #f0f2f5); }
                        ::-webkit-scrollbar { display: none; }
                    </style>
                </head>
                <body class="display-view" id="page-display">
                    <div id="__export_content__"></div>
                </body>
                </html>
            `);
            doc.close();

            iframe.contentDocument.getElementById('__export_content__').innerHTML =
                generateDisplayHtmlForImage(new Date(loopDate), stations, shifts, schedule);

            if (customCss) {
                const styleEl = iframe.contentDocument.createElement('style');
                styleEl.textContent = customCss;
                iframe.contentDocument.head.appendChild(styleEl);
            }

            await iframeLoaded;
            await new Promise(r => requestAnimationFrame(r));

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
                zip.file(`Schema-${lDateStr}.png`, base64Data, { base64: true });
                count++;
            } catch (e) {
                console.error("Kunde inte skapa bild:", e);
            }

            loopDate = new Date(loopDate.getTime() + 86400000);
        }

        if (count === 1 && singleImageBase64) {
            const link = document.createElement('a');
            link.download = singleImageName;
            link.href = singleImageBase64;
            link.click();
            showToast("Bild sparad!", "success");
        } else if (count > 1) {
            showToast("Packar ZIP-fil...", "info");
            try {
                const startInp = document.getElementById('printStartDate');
                const endInp = document.getElementById('printEndDate');
                const content = await zip.generateAsync({ type: "blob" });
                const link = document.createElement('a');
                link.download = `Scheman_${startInp.value}_till_${endInp.value}.zip`;
                const url = URL.createObjectURL(content);
                link.href = url;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                showToast(`Klar! ${count} bilder sparade i en ZIP.`, "success");
            } catch (e) {
                console.error("Kunde inte skapa ZIP:", e);
                showToast("Kunde inte skapa ZIP", "error");
            }
        }
    } finally {
        iframe.remove();
        btn.innerText = txt;
    }
}

export function initExportTab(currentSettings) {
    const btnToday    = document.getElementById('btnSetToday');
    const btnWeek     = document.getElementById('btnSetWeek');
    const btnNextWeek = document.getElementById('btnSetNextWeek');
    const startInp    = document.getElementById('printStartDate');
    const endInp      = document.getElementById('printEndDate');
    const printBtn    = document.getElementById('doPrintBtn');
    const imgBtn      = document.getElementById('doImageBtn');

    if (!startInp || !endInp) return;

    const setDates = (start, end) => {
        const tz = start.getTimezoneOffset() * 60000;
        startInp.value = new Date(start.getTime() - tz).toISOString().split('T')[0];
        endInp.value   = new Date(end.getTime() - tz).toISOString().split('T')[0];
    };

    const applyDefaultDates = async () => {
        const res = await fetchData('settings');
        const days = Number.parseInt(res?.success ? res.data?.exportDefaultDays : currentSettings?.exportDefaultDays) || 1;
        const now = new Date();
        const dStart = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
        const dEnd = new Date(dStart);
        dEnd.setDate(dStart.getDate() + days - 1);
        setDates(dStart, dEnd);
    };

    applyDefaultDates();

    const exportTabBtn = document.querySelector('button[onclick="openTab(\'tab-export\')"]');
    if (exportTabBtn) {
        exportTabBtn.addEventListener('click', () => applyDefaultDates());
    }

    if (btnToday) btnToday.onclick = () => { const d = new Date(); setDates(d, d); };
    if (btnWeek) btnWeek.onclick = () => {
        const d = new Date();
        const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
        const start = new Date(d); start.setDate(d.getDate() - day);
        const end = new Date(start); end.setDate(start.getDate() + 6);
        setDates(start, end);
    };
    if (btnNextWeek) btnNextWeek.onclick = () => {
        const d = new Date();
        const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
        const start = new Date(d); start.setDate(d.getDate() - day + 7);
        const end = new Date(start); end.setDate(start.getDate() + 6);
        setDates(start, end);
    };

    const runExport = async (mode) => {
        const sDate = new Date(startInp.value);
        const eDate = new Date(endInp.value);
        if (sDate > eDate) return showToast("Startdatum måste vara före slutdatum", "error");

        showToast("Hämtar data för export...", "info");

        const results = await Promise.allSettled([
            fetchData('stations'),
            fetchData('shifts'),
            fetchData('schedule', { start_date: startInp.value, end_date: endInp.value })
        ]);

        if (results.some(r => r.status === 'rejected' || !r.value?.success)) {
            return showToast("Kunde inte hämta data för export. Kontrollera nätverket.", "error");
        }

        const stations = results[0].value.data || [];
        const shifts   = results[1].value.data || [];
        const schedule = results[2].value.data || [];

        if (mode === 'print') {
            await runPrintExport(sDate, eDate, stations, shifts, schedule);
        } else {
            await runImageExport(sDate, eDate, stations, shifts, schedule, getCustomCss());
        }
    };

    if (printBtn) printBtn.onclick = () => runExport('print');
    if (imgBtn)   imgBtn.onclick   = () => runExport('image');
}

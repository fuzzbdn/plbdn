/**
 * ============================================================================
 * EXPORT.JS
 * Hanterar fliken "Dela & Exportera" under Inställningar.
 * Ansvarar för att generera fysiska utskrifter (Pappers-scheman) via 
 * fönstrets print()-dialog, samt att generera bildfiler (PNG) av scheman 
 * som kan zippas ihop och laddas ner lokalt (via html2canvas och JSZip).
 * ============================================================================
 */

import { fetchData } from '../service.js';
import { showToast, isLight, escapeHTML, getISOWeek } from '../utils.js';
import { DAYS } from '../config.js';
import { getCustomThemes } from '../store.js';

// ==========================================
// HJÄLPFUNKTIONER (Bygger innehåll)
// ==========================================

/**
 * Formaterar innehållet i en "schemacell" med personalens namn och eventuella
 * tilläggsnoteringar.
 * 
 * @param {Array} assignedRows - Array med pass för en specifik station och tid.
 * @returns {string} Färdig HTML-sträng separerad med '/'.
 */
function buildShiftCellContent(assignedRows) {
    return assignedRows.map(a => {
        const name = escapeHTML(a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim());
        const note = a.note ? `<span style="color:#888; font-size:0.8em; font-weight:400;"> (${escapeHTML(a.note)})</span>` : '';
        return `<span style="font-weight:700;">${name}</span>${note}`;
    }).join(' / ');
}

// ==========================================
// UTSKRIFTSGENERATOR (Pappersutskrift)
// ==========================================

/**
 * Genererar HTML-koden för ett snyggt pappersschema för en (1) specifik dag.
 * Optimerat för skrivare via "@media print" i CSS.
 * 
 * @param {Date} dateObj - Datumet som ska skrivas ut.
 * @param {Array} stations - Alla arbetsstationer.
 * @param {Array} shifts - Alla arbetspass.
 * @param {Array} schedule - Rådata för aktuella schemapass.
 * @returns {string} En komplett HTML-sträng.
 */
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
        // Om det är ett "mellanrum", rita bara ut ett grått streck på pappret
        if (st.is_spacer) { html += `<div class="print-spacer"></div>`; return; }
        
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

// ==========================================
// BILDGENERATOR (DOM för html2canvas)
// ==========================================

/**
 * Bygger en ren HTML DOM (objektträd) att injicera i en osynlig iframe.
 * Görs via document.createElement() istället för innerHTML för ökad 
 * prestanda och säkerhet. Bygger upp en visuell TV-skärm att fota av.
 */
function buildDisplayDomForImage(doc, dateObj, stations, shifts, schedule) {
    const iso = getISOWeek(dateObj);
    const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1;
    const dayName = DAYS[dayIndex];
    const dateStr = `${dateObj.getDate()}/${dateObj.getMonth() + 1}`;
    const targetDateStr = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    const wrapper = doc.createElement('div');
    wrapper.className = 'display-wrapper';

    const topBar = doc.createElement('div');
    topBar.className = 'top-bar';
    const h1 = doc.createElement('h1');
    h1.id = 'mainTitle';
    h1.textContent = `Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})`;
    topBar.appendChild(h1);
    wrapper.appendChild(topBar);

    const mainContainer = doc.createElement('div');
    mainContainer.id = 'mainContainer';

    const headerRow = doc.createElement('div');
    headerRow.className = 'time-header-row';
    headerRow.appendChild(doc.createElement('div'));
    
    shifts.forEach(sh => {
        const th = doc.createElement('div');
        th.className = 'time-header';
        th.textContent = sh.label;
        headerRow.appendChild(th);
    });
    mainContainer.appendChild(headerRow);

    stations.forEach(st => {
        if (st.is_spacer) {
            const spacer = doc.createElement('div');
            spacer.className = 'display-row spacer-row';
            mainContainer.appendChild(spacer);
            return;
        }

        const contrast = isLight(st.color) ? '#000' : '#fff';
        const row = doc.createElement('div');
        row.className = 'display-row';
        row.style.setProperty('--station-color', st.color);
        row.style.setProperty('--contrast-color', contrast);

        const stationLabel = doc.createElement('div');
        stationLabel.className = 'station-label';
        stationLabel.textContent = st.name;
        row.appendChild(stationLabel);

        shifts.forEach(sh => {
            const assignedRows = schedule.filter(r =>
                r.is_published &&
                r.work_date.split('T')[0] === targetDateStr &&
                r.station_id === st.id &&
                r.shift_id === sh.id
            );
            
            const card = doc.createElement('div');
            card.className = `shift-card${assignedRows.length === 0 ? ' empty' : ''}`;
            card.dataset.label = sh.label;

            assignedRows.forEach((a, i) => {
                if (i > 0) card.appendChild(doc.createTextNode(' / '));
                
                const nameSpan = doc.createElement('span');
                nameSpan.style.fontWeight = '700';
                nameSpan.textContent = a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim();
                card.appendChild(nameSpan);
                
                if (a.note) {
                    const noteSpan = doc.createElement('span');
                    noteSpan.style.cssText = 'color:#888; font-size:0.8em; font-weight:400;';
                    noteSpan.textContent = ` (${a.note})`;
                    card.appendChild(noteSpan);
                }
            });

            row.appendChild(card);
        });
        mainContainer.appendChild(row);
    });

    wrapper.appendChild(mainContainer);
    return wrapper;
}

/**
 * Hämtar det aktiva CSS-temat för att säkerställa att bildexporten
 * ser ut precis som TV-skärmen (t.ex. Dark Mode).
 */
function getCustomCss() {
    const themeSelect = document.getElementById('themeSelect');
    if (!themeSelect?.value || themeSelect.value === 'light') return '';
    const t = getCustomThemes().find(x => x.id === themeSelect.value);
    return t ? t.css : '';
}

// ==========================================
// EXEKVERING (Utskrift & Bildgenerering)
// ==========================================

/**
 * Bygger en osynlig div på sidan, fyller den med pappers-versionen av schemat,
 * och triggar webbläsarens utskriftsdialog.
 */
async function runPrintExport(sDate, eDate, stations, shifts, schedule) {
    const pc = document.getElementById('print-container') || document.createElement('div');
    pc.id = 'print-container';
    if (!document.body.contains(pc)) document.body.appendChild(pc);

    let html = '';
    let loopDate = new Date(sDate);
    // Iterera genom datumspannet dag för dag
    while (loopDate <= eDate) {
        html += generateSingleDayPrintHtml(new Date(loopDate), stations, shifts, schedule);
        loopDate = new Date(loopDate.getTime() + 86400000); // Lägg till 24 timmar
    }
    
    pc.innerHTML = html;
    window.print();
    
    // Rensa upp efter att utskriftsdialogen har hanterats
    setTimeout(() => { pc.innerHTML = ''; }, 1000);
}

/**
 * Genererar skärmdumpar (PNG) inuti en dold 1080p iframe via html2canvas.
 * Vid fler än 1 bild paketeras de automatiskt till en ZIP-fil.
 */
async function runImageExport(sDate, eDate, stations, shifts, schedule, customCss) {
    if (typeof html2canvas === 'undefined') return showToast("html2canvas saknas.", "error");
    if (typeof JSZip === 'undefined') return showToast("JSZip saknas.", "error");

    const btn = document.getElementById('doImageBtn');
    const txt = btn.innerText;
    btn.innerText = "Genererar...";

    // Hämta och baka in systemets CSS så html2canvas kan rendera det korrekt
    const [baseCssText, displayCssText] = await Promise.all([
        fetch('css/base.css').then(r => r.text()).catch(() => ''),
        fetch('css/display.css').then(r => r.text()).catch(() => '')
    ]);
    const inlinedCss = `${baseCssText}\n${displayCssText}\n* { transition: none !important; animation: none !important; } body { margin: 0; overflow: hidden; background-color: var(--bg-color, #f0f2f5); } ::-webkit-scrollbar { display: none; }`;

    // Skapa en dold "skärm" (Iframe)
    const iframe = document.createElement('iframe');
    iframe.style.cssText = "position:absolute; top:-9999px; left:0; width:1920px; height:1080px; border:none;";
    document.body.appendChild(iframe);

    try {
        let loopDate = new Date(sDate);
        let count = 0;
        const zip = new JSZip();
        let singleImageBase64 = null;
        let singleImageName = "";

        // Gå igenom valt datumintervall dag för dag
        while (loopDate <= eDate) {
            const iframeDoc = iframe.contentDocument;
            const iframeLoaded = new Promise(resolve => { iframe.onload = resolve; });

            iframeDoc.open();
            iframeDoc.close();
            iframeDoc.documentElement.lang = 'sv';
            iframeDoc.body.className = 'display-view';
            iframeDoc.body.id = 'page-display';

            // Importera typsnitt
            const fontLink = iframeDoc.createElement('link');
            fontLink.rel = 'stylesheet';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap';
            iframeDoc.head.appendChild(fontLink);

            // Injicera grund-CSS
            const styleEl = iframeDoc.createElement('style');
            styleEl.textContent = inlinedCss;
            iframeDoc.head.appendChild(styleEl);

            // Montera dagens layout i iframen
            iframeDoc.body.appendChild(
                buildDisplayDomForImage(iframeDoc, new Date(loopDate), stations, shifts, schedule)
            );

            // Injicera eventuellt custom-tema (t.ex. Dark Mode)
            if (customCss) {
                const customStyleEl = iframeDoc.createElement('style');
                customStyleEl.textContent = customCss;
                iframeDoc.head.appendChild(customStyleEl);
            }

            await iframeLoaded;
            
            // Vänta en "frame" (ca 16ms) så webbläsaren hinner rita upp färgerna korrekt
            await new Promise(r => requestAnimationFrame(r));

            try {
                // Ta skärmdump!
                const canvas = await html2canvas(iframeDoc.body, {
                    scale: 2, // Retina/High-Res
                    useCORS: true, 
                    backgroundColor: iframeDoc.body.style.backgroundColor || '#f0f2f5'
                });

                const lDateStr = new Date(loopDate.getTime() - (loopDate.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                const base64Img = canvas.toDataURL('image/png');

                // Spara för nedladdning (om det bara är en fil)
                if (count === 0) {
                    singleImageBase64 = base64Img;
                    singleImageName = `Schema-${lDateStr}.png`;
                }

                // Stoppa filen inuti ZIP-arkivet (ta bort "data:image/png;base64," från strängen först)
                zip.file(`Schema-${lDateStr}.png`, base64Img.split('base64,')[1], { base64: true });
                count++;
            } catch (e) {
                console.error("Kunde inte skapa bild:", e);
            }

            loopDate = new Date(loopDate.getTime() + 86400000); // Nästa dag
        }

        // Nedladdningslogik (Enkel fil vs ZIP)
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

// ==========================================
// HUVUD-FUNKTION (Initiering av fliken)
// ==========================================

export function initExportTab(currentSettings) {
    const btnToday    = document.getElementById('btnSetToday');
    const btnWeek     = document.getElementById('btnSetWeek');
    const btnNextWeek = document.getElementById('btnSetNextWeek');
    const startInp    = document.getElementById('printStartDate');
    const endInp      = document.getElementById('printEndDate');
    const printBtn    = document.getElementById('doPrintBtn');
    const imgBtn      = document.getElementById('doImageBtn');

    if (!startInp || !endInp) return;

    /**
     * Ställer in start- och slutdatumfälten (hanterar tidzoner).
     */
    const setDates = (start, end) => {
        const tz = start.getTimezoneOffset() * 60000;
        startInp.value = new Date(start.getTime() - tz).toISOString().split('T')[0];
        endInp.value   = new Date(end.getTime() - tz).toISOString().split('T')[0];
    };

    /**
     * Hämtar standardantal dagar för export från databasen och applicerar
     * dessa på kalenderfälten.
     */
    const applyDefaultDates = async () => {
        const res = await fetchData('settings');
        const days = Number.parseInt(res?.success ? res.data?.exportDefaultDays : currentSettings?.exportDefaultDays) || 1;
        
        const now = new Date();
        const dStart = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
        const dEnd = new Date(dStart);
        dEnd.setDate(dStart.getDate() + days - 1);
        
        setDates(dStart, dEnd);
    };

    // Ställ in standarddatum vid laddning
    applyDefaultDates();

    // Återställ standarddatum om användaren klickar på "Export"-fliken i menyn igen
    const exportTabBtn = document.querySelector('button[onclick="openTab(\'tab-export\')"]');
    if (exportTabBtn) exportTabBtn.addEventListener('click', () => applyDefaultDates());

    // Snabbalternativ-knappar (Idag, Denna vecka, Nästa vecka)
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

    /**
     * Samlar ihop all data och exekverar antingen pappersutskrift eller bildexport.
     * @param {string} mode - 'print' eller 'image'
     */
    const runExport = async (mode) => {
        const sDate = new Date(startInp.value);
        const eDate = new Date(endInp.value);
        
        if (sDate > eDate) return showToast("Startdatum måste vara före slutdatum", "error");

        showToast("Hämtar data för export...", "info");

        // För att garantera att vi skriver ut dagsfärsk data hämtar vi nytt från databasen (ignorerar cache)
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

    // Koppla huvudknapparna
    if (printBtn) printBtn.onclick = () => runExport('print');
    if (imgBtn)   imgBtn.onclick   = () => runExport('image');
}

$ cat -n /home/user/plbdn/js/settings/export.js

     1	import { fetchData } from '../service.js';
     2	import { showToast, isLight, escapeHTML, getISOWeek } from '../utils.js';
     3	import { DAYS } from '../config.js';
     4	import { getCustomThemes } from '../store.js';
     5	
     6	// ==========================================
     7	// Hjälpfunktioner (top-level för att undvika djup nästling)
     8	// ==========================================
     9	function buildShiftCellContent(assignedRows) {
    10	    return assignedRows.map(a => {
    11	        const name = escapeHTML(a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim());
    12	        const note = a.note ? `<span style="color:#888; font-size:0.8em; font-weight:400;"> (${escapeHTML(a.note)})</span>` : '';
    13	        return `<span style="font-weight:700;">${name}</span>${note}`;
    14	    }).join(' / ');
    15	}
    16	
    17	function generateSingleDayPrintHtml(dateObj, stations, shifts, schedule) {
    18	    const iso = getISOWeek(dateObj);
    19	    const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1;
    20	    const dayName = DAYS[dayIndex];
    21	    const dateStr = dateObj.toLocaleDateString('sv-SE');
    22	    const targetDateStr = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    23	
    24	    const shiftHeaders = shifts.map(s => `
    25	        <div class="print-col-title">
    26	            ${escapeHTML(s.label)}<br><small>${escapeHTML(s.time_range || s.time || '')}</small>
    27	        </div>`).join('');
    28	
    29	    let html = `
    30	    <div class="print-page-wrapper">
    31	        <div class="print-header">
    32	            <h1>Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})</h1>
    33	        </div>
    34	        <div class="print-grid-container">
    35	            <div class="print-grid-row" style="grid-template-columns: 200px repeat(${shifts.length}, 1fr);">
    36	                <div></div>${shiftHeaders}
    37	            </div>`;
    38	
    39	    stations.forEach(st => {
    40	        if (st.is_spacer) { html += `<div class="print-spacer"></div>`; return; }
    41	        const bg = escapeHTML(st.color);
    42	        const fg = isLight(st.color) ? '#000' : '#fff';
    43	        const shiftCells = shifts.map(sh => {
    44	            const assignedRows = schedule.filter(r =>
    45	                r.is_published &&
    46	                r.work_date.split('T')[0] === targetDateStr &&
    47	                r.station_id === st.id &&
    48	                r.shift_id === sh.id
    49	            );
    50	            return `<div class="print-shift-cell">${buildShiftCellContent(assignedRows)}</div>`;
    51	        }).join('');
    52	        html += `
    53	        <div class="print-grid-row print-data-row" style="grid-template-columns: 200px repeat(${shifts.length}, 1fr);">
    54	            <div class="print-station-cell" style="background:${bg}; color:${fg};">${escapeHTML(st.name)}</div>
    55	            ${shiftCells}
    56	        </div>`;
    57	    });
    58	    html += `</div></div>`;
    59	    return html;
    60	}
    61	
    62	// Bygger iframe-innehållet via DOM-manipulation — ingen innerHTML med användardata
    63	function buildDisplayDomForImage(doc, dateObj, stations, shifts, schedule) {
    64	    const iso = getISOWeek(dateObj);
    65	    const dayIndex = dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1;
    66	    const dayName = DAYS[dayIndex];
    67	    const dateStr = `${dateObj.getDate()}/${dateObj.getMonth() + 1}`;
    68	    const targetDateStr = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    69	
    70	    const wrapper = doc.createElement('div');
    71	    wrapper.className = 'display-wrapper';
    72	
    73	    const topBar = doc.createElement('div');
    74	    topBar.className = 'top-bar';
    75	    const h1 = doc.createElement('h1');
    76	    h1.id = 'mainTitle';
    77	    h1.textContent = `Vi som jobbar ${dayName} ${dateStr} (v.${iso.week})`;
    78	    topBar.appendChild(h1);
    79	    wrapper.appendChild(topBar);
    80	
    81	    const mainContainer = doc.createElement('div');
    82	    mainContainer.id = 'mainContainer';
    83	
    84	    const headerRow = doc.createElement('div');
    85	    headerRow.className = 'time-header-row';
    86	    headerRow.appendChild(doc.createElement('div'));
    87	    shifts.forEach(sh => {
    88	        const th = doc.createElement('div');
    89	        th.className = 'time-header';
    90	        th.textContent = sh.label;
    91	        headerRow.appendChild(th);
    92	    });
    93	    mainContainer.appendChild(headerRow);
    94	
    95	    stations.forEach(st => {
    96	        if (st.is_spacer) {
    97	            const spacer = doc.createElement('div');
    98	            spacer.className = 'display-row spacer-row';
    99	            mainContainer.appendChild(spacer);
   100	            return;
   101	        }
   102	
   103	        const contrast = isLight(st.color) ? '#000' : '#fff';
   104	        const row = doc.createElement('div');
   105	        row.className = 'display-row';
   106	        row.style.setProperty('--station-color', st.color);
   107	        row.style.setProperty('--contrast-color', contrast);
   108	
   109	        const stationLabel = doc.createElement('div');
   110	        stationLabel.className = 'station-label';
   111	        stationLabel.textContent = st.name;
   112	        row.appendChild(stationLabel);
   113	
   114	        shifts.forEach(sh => {
   115	            const assignedRows = schedule.filter(r =>
   116	                r.is_published &&
   117	                r.work_date.split('T')[0] === targetDateStr &&
   118	                r.station_id === st.id &&
   119	                r.shift_id === sh.id
   120	            );
   121	            const card = doc.createElement('div');
   122	            card.className = `shift-card${assignedRows.length === 0 ? ' empty' : ''}`;
   123	            card.dataset.label = sh.label;
   124	
   125	            assignedRows.forEach((a, i) => {
   126	                if (i > 0) card.appendChild(doc.createTextNode(' / '));
   127	                const nameSpan = doc.createElement('span');
   128	                nameSpan.style.fontWeight = '700';
   129	                nameSpan.textContent = a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim();
   130	                card.appendChild(nameSpan);
   131	                if (a.note) {
   132	                    const noteSpan = doc.createElement('span');
   133	                    noteSpan.style.cssText = 'color:#888; font-size:0.8em; font-weight:400;';
   134	                    noteSpan.textContent = ` (${a.note})`;
   135	                    card.appendChild(noteSpan);
   136	                }
   137	            });
   138	
   139	            row.appendChild(card);
   140	        });
   141	        mainContainer.appendChild(row);
   142	    });
   143	
   144	    wrapper.appendChild(mainContainer);
   145	    return wrapper;
   146	}
   147	
   148	function getCustomCss() {
   149	    const themeSelect = document.getElementById('themeSelect');
   150	    if (!themeSelect?.value || themeSelect.value === 'light') return '';
   151	    const t = getCustomThemes().find(x => x.id === themeSelect.value);
   152	    return t ? t.css : '';
   153	}
   154	
   155	async function runPrintExport(sDate, eDate, stations, shifts, schedule) {
   156	    const pc = document.getElementById('print-container') || document.createElement('div');
   157	    pc.id = 'print-container';
   158	    if (!document.body.contains(pc)) document.body.appendChild(pc);
   159	
   160	    let html = '';
   161	    let loopDate = new Date(sDate);
   162	    while (loopDate <= eDate) {
   163	        html += generateSingleDayPrintHtml(new Date(loopDate), stations, shifts, schedule);
   164	        loopDate = new Date(loopDate.getTime() + 86400000);
   165	    }
   166	    pc.innerHTML = html;
   167	    window.print();
   168	    setTimeout(() => { pc.innerHTML = ''; }, 1000);
   169	}
   170	
   171	async function runImageExport(sDate, eDate, stations, shifts, schedule, customCss) {
   172	    if (typeof html2canvas === 'undefined') return showToast("html2canvas saknas.", "error");
   173	    if (typeof JSZip === 'undefined') return showToast("JSZip saknas.", "error");
   174	
   175	    const btn = document.getElementById('doImageBtn');
   176	    const txt = btn.innerText;
   177	    btn.innerText = "Genererar...";
   178	
   179	    const [baseCssText, displayCssText] = await Promise.all([
   180	        fetch('css/base.css').then(r => r.text()).catch(() => ''),
   181	        fetch('css/display.css').then(r => r.text()).catch(() => '')
   182	    ]);
   183	    const inlinedCss = `${baseCssText}\n${displayCssText}\n* { transition: none !important; animation: none !important; } body { margin: 0; overflow: hidden; background-color: var(--bg-color, #f0f2f5); } ::-webkit-scrollbar { display: none; }`;
   184	
   185	    const iframe = document.createElement('iframe');
   186	    iframe.style.cssText = "position:absolute; top:-9999px; left:0; width:1920px; height:1080px; border:none;";
   187	    document.body.appendChild(iframe);
   188	
   189	    try {
   190	        let loopDate = new Date(sDate);
   191	        let count = 0;
   192	        const zip = new JSZip();
   193	        let singleImageBase64 = null;
   194	        let singleImageName = "";
   195	
   196	        while (loopDate <= eDate) {
   197	            const iframeDoc = iframe.contentDocument;
   198	            const iframeLoaded = new Promise(resolve => { iframe.onload = resolve; });
   199	
   200	            iframeDoc.open();
   201	            iframeDoc.close();
   202	            iframeDoc.documentElement.lang = 'sv';
   203	            iframeDoc.body.className = 'display-view';
   204	            iframeDoc.body.id = 'page-display';
   205	
   206	            const fontLink = iframeDoc.createElement('link');
   207	            fontLink.rel = 'stylesheet';
   208	            fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap';
   209	            iframeDoc.head.appendChild(fontLink);
   210	
   211	            const styleEl = iframeDoc.createElement('style');
   212	            styleEl.textContent = inlinedCss;
   213	            iframeDoc.head.appendChild(styleEl);
   214	
   215	            iframeDoc.body.appendChild(
   216	                buildDisplayDomForImage(iframeDoc, new Date(loopDate), stations, shifts, schedule)
   217	            );
   218	
   219	            if (customCss) {
   220	                const customStyleEl = iframeDoc.createElement('style');
   221	                customStyleEl.textContent = customCss;
   222	                iframeDoc.head.appendChild(customStyleEl);
   223	            }
   224	
   225	            await iframeLoaded;
   226	            await new Promise(r => requestAnimationFrame(r));
   227	
   228	            try {
   229	                const canvas = await html2canvas(iframeDoc.body, {
   230	                    scale: 2, useCORS: true, backgroundColor: iframeDoc.body.style.backgroundColor || '#f0f2f5'
   231	                });
   232	
   233	                const lDateStr = new Date(loopDate.getTime() - (loopDate.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
   234	                const base64Img = canvas.toDataURL('image/png');
   235	
   236	                if (count === 0) {
   237	                    singleImageBase64 = base64Img;
   238	                    singleImageName = `Schema-${lDateStr}.png`;
   239	                }
   240	
   241	                zip.file(`Schema-${lDateStr}.png`, base64Img.split('base64,')[1], { base64: true });
   242	                count++;
   243	            } catch (e) {
   244	                console.error("Kunde inte skapa bild:", e);
   245	            }
   246	
   247	            loopDate = new Date(loopDate.getTime() + 86400000);
   248	        }
   249	
   250	        if (count === 1 && singleImageBase64) {
   251	            const link = document.createElement('a');
   252	            link.download = singleImageName;
   253	            link.href = singleImageBase64;
   254	            link.click();
   255	            showToast("Bild sparad!", "success");
   256	        } else if (count > 1) {
   257	            showToast("Packar ZIP-fil...", "info");
   258	            try {
   259	                const startInp = document.getElementById('printStartDate');
   260	                const endInp = document.getElementById('printEndDate');
   261	                const content = await zip.generateAsync({ type: "blob" });
   262	                const link = document.createElement('a');
   263	                link.download = `Scheman_${startInp.value}_till_${endInp.value}.zip`;
   264	                const url = URL.createObjectURL(content);
   265	                link.href = url;
   266	                link.click();
   267	                setTimeout(() => URL.revokeObjectURL(url), 1000);
   268	                showToast(`Klar! ${count} bilder sparade i en ZIP.`, "success");
   269	            } catch (e) {
   270	                console.error("Kunde inte skapa ZIP:", e);
   271	                showToast("Kunde inte skapa ZIP", "error");
   272	            }
   273	        }
   274	    } finally {
   275	        iframe.remove();
   276	        btn.innerText = txt;
   277	    }
   278	}
   279	
   280	export function initExportTab(currentSettings) {
   281	    const btnToday    = document.getElementById('btnSetToday');
   282	    const btnWeek     = document.getElementById('btnSetWeek');
   283	    const btnNextWeek = document.getElementById('btnSetNextWeek');
   284	    const startInp    = document.getElementById('printStartDate');
   285	    const endInp      = document.getElementById('printEndDate');
   286	    const printBtn    = document.getElementById('doPrintBtn');
   287	    const imgBtn      = document.getElementById('doImageBtn');
   288	
   289	    if (!startInp || !endInp) return;
   290	
   291	    const setDates = (start, end) => {
   292	        const tz = start.getTimezoneOffset() * 60000;
   293	        startInp.value = new Date(start.getTime() - tz).toISOString().split('T')[0];
   294	        endInp.value   = new Date(end.getTime() - tz).toISOString().split('T')[0];
   295	    };
   296	
   297	    const applyDefaultDates = async () => {
   298	        const res = await fetchData('settings');
   299	        const days = Number.parseInt(res?.success ? res.data?.exportDefaultDays : currentSettings?.exportDefaultDays) || 1;
   300	        const now = new Date();
   301	        const dStart = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
   302	        const dEnd = new Date(dStart);
   303	        dEnd.setDate(dStart.getDate() + days - 1);
   304	        setDates(dStart, dEnd);
   305	    };
   306	
   307	    applyDefaultDates();
   308	
   309	    const exportTabBtn = document.querySelector('button[onclick="openTab(\'tab-export\')"]');
   310	    if (exportTabBtn) exportTabBtn.addEventListener('click', () => applyDefaultDates());
   311	
   312	    if (btnToday) btnToday.onclick = () => { const d = new Date(); setDates(d, d); };
   313	    if (btnWeek) btnWeek.onclick = () => {
   314	        const d = new Date();
   315	        const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
   316	        const start = new Date(d); start.setDate(d.getDate() - day);
   317	        const end = new Date(start); end.setDate(start.getDate() + 6);
   318	        setDates(start, end);
   319	    };
   320	    if (btnNextWeek) btnNextWeek.onclick = () => {
   321	        const d = new Date();
   322	        const day = d.getDay() === 0 ? 6 : d.getDay() - 1;
   323	        const start = new Date(d); start.setDate(d.getDate() - day + 7);
   324	        const end = new Date(start); end.setDate(start.getDate() + 6);
   325	        setDates(start, end);
   326	    };
   327	
   328	    const runExport = async (mode) => {
   329	        const sDate = new Date(startInp.value);
   330	        const eDate = new Date(endInp.value);
   331	        if (sDate > eDate) return showToast("Startdatum måste vara före slutdatum", "error");
   332	
   333	        showToast("Hämtar data för export...", "info");
   334	
   335	        const results = await Promise.allSettled([
   336	            fetchData('stations'),
   337	            fetchData('shifts'),
   338	            fetchData('schedule', { start_date: startInp.value, end_date: endInp.value })
   339	        ]);
   340	
   341	        if (results.some(r => r.status === 'rejected' || !r.value?.success)) {
   342	            return showToast("Kunde inte hämta data för export. Kontrollera nätverket.", "error");
   343	        }
   344	
   345	        const stations = results[0].value.data || [];
   346	        const shifts   = results[1].value.data || [];
   347	        const schedule = results[2].value.data || [];
   348	
   349	        if (mode === 'print') {
   350	            await runPrintExport(sDate, eDate, stations, shifts, schedule);
   351	        } else {
   352	            await runImageExport(sDate, eDate, stations, shifts, schedule, getCustomCss());
   353	        }
   354	    };
   355	
   356	    if (printBtn) printBtn.onclick = () => runExport('print');
   357	    if (imgBtn)   imgBtn.onclick   = () => runExport('image');
   358	}

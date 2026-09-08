/**
 * ============================================================================
 * UTILS.JS
 * En samling återanvändbara hjälpfunktioner (verktyg) som används i hela appen.
 * Hanterar UI-komponenter (Toasts, Modaler), datumuträkningar, färghantering 
 * och säkerhet (HTML-escapning).
 * ============================================================================
 */

/**
 * Visar en tillfällig notis (toast) på skärmen för användaren.
 * @param {string} message - Meddelandet som ska visas.
 * @param {string} [type='info'] - Typ av notis ('info', 'success', 'error'). Styr färgen.
 */
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    
    // Animerar in notisen efter en kort fördröjning
    setTimeout(() => { 
        toast.style.opacity = '1'; 
        toast.style.transform = 'translateY(0)'; 
    }, 10);
    
    // Tar bort notisen automatiskt efter 3 sekunder
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Visar en anpassad bekräftelseruta (modal) och väntar på användarens svar.
 * Faller tillbaka på webbläsarens inbyggda confirm() om modalen saknas i HTML.
 * @param {string} message - Frågan eller varningen som ska visas.
 * @returns {Promise<boolean>} Resolvar till true (Ja) eller false (Nej/Avbryt).
 */
export function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const msgEl = document.getElementById('confirmMessage');
        const btnYes = document.getElementById('btnConfirmYes');
        const btnNo = document.getElementById('btnConfirmNo');
        
        // Fallback om DOM-elementen saknas
        if(!modal || !msgEl || !btnYes || !btnNo) {
            resolve(confirm(message)); 
            return;
        }
        
        msgEl.innerText = message;
        modal.classList.add('show');
        
        // Hjälpfunktion för att stänga modalen och rensa event listeners
        const cleanup = () => {
            modal.classList.remove('show');
            btnYes.onclick = null;
            btnNo.onclick = null;
        };
        
        btnYes.onclick = () => { cleanup(); resolve(true); };
        btnNo.onclick = () => { cleanup(); resolve(false); };
    });
}

/**
 * Beräknar ISO 8601-veckonummer och tillhörande år för ett givet datum.
 * (Viktigt i Sverige där vi använder ISO-standard för veckonummer).
 * @param {Date} date - Datumobjektet som ska analyseras.
 * @returns {Object} Ett objekt med { year, week }.
 */
export function getISOWeek(date) {
    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    return {
        year: target.getFullYear(),
        week: 1 + Math.ceil((firstThursday - target) / 604800000)
    };
}

/**
 * Avgör om en specifik HEX-färg är ljus eller mörk.
 * Används för att dynamiskt sätta textfärg (svart eller vit) för bästa kontrast.
 * @param {string} color - Färgen i HEX-format (t.ex. '#ffffff' eller '#333333').
 * @returns {boolean} Returnerar true om färgen är ljus, annars false.
 */
export function isLight(color) {
    // FIX: Härdad mot null/undefined/ogiltiga färgformat (t.ex. '#fff', 'red', '')
    // Utan denna kraschar hela display-renderingen om station.color är NULL i databasen
    if (!color || typeof color !== 'string') return true;
    
    const hex = color.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return true;
    
    // Konverterar HEX till RGB och beräknar luminans (enligt standardformel)
    const r = Number.parseInt(hex.substring(0, 2), 16);
    const g = Number.parseInt(hex.substring(2, 4), 16);
    const b = Number.parseInt(hex.substring(4, 6), 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000 > 155;
}

/**
 * Saniterar strängar för att förhindra XSS (Cross-Site Scripting).
 * Omvandlar farliga tecken till säkra HTML-entiteter.
 * @param {string|number|null} str - Den ofiltrerade datan.
 * @returns {string} En HTML-säker sträng.
 */
export function escapeHTML(str) {
    // FIX: Härdad mot icke-strängar (tal, boolean) som tidigare kraschade med
    // "str.replace is not a function". Null/undefined returnerar fortfarande tom sträng.
    if (str === null || str === undefined) return '';
    if (typeof str !== 'string') str = String(str);
    
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

/**
 * Genererar HTML-strukturen för veckoschemat.
 * Hanterar både grid-vy (desktop) och list-vy (mobil), samt visar pass och frånvaro.
 * @param {Array} users - Lista över användare.
 * @param {Array} dates - Array med datumsträngar (veckans dagar).
 * @param {Function} getAssignmentsFn - Funktion för att hämta en persons pass för ett givet datum.
 * @param {boolean} showHeadersWithDates - Om datum ska visas i desktop-rubrikerna.
 * @param {Array} daysArray - En array med veckodagarnas namn (['Mån', 'Tis', ...]).
 * @param {Function} [getAbsenceFn=null] - Frivillig funktion för att hämta frånvaro.
 * @returns {string} Den kompletta HTML-strängen för veckovyn.
 */
export function buildWeeklyGridHTML(users, dates, getAssignmentsFn, showHeadersWithDates, daysArray, getAbsenceFn = null) {
    let html = '<div class="weekly-grid"><div class="weekly-header-row"><div class="weekly-user-name">Personal</div>';
    
    // 1. Bygger datorns topp-rubrik (Kolumner för varje veckodag)
    dates.forEach(dateStr => {
        const d = new Date(dateStr);
        const dayName = daysArray[d.getDay() === 0 ? 6 : d.getDay() - 1];
        if (showHeadersWithDates) {
            const shortDate = `${d.getDate()}/${d.getMonth() + 1}`;
            html += `<div>${dayName} <br><small>${shortDate}</small></div>`;
        } else {
            html += `<div>${dayName}</div>`;
        }
    });
    html += `</div>`;

    // 2. Bygger raderna (eller korten på mobilen) för varje person
    users.forEach(user => {
        const nameToShow = user.display_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username;
        html += `<div class="weekly-user-row"><div class="weekly-user-name">${escapeHTML(nameToShow)}</div>`;

        dates.forEach(dateStr => {
            const d = new Date(dateStr);
            const dayName = daysArray[d.getDay() === 0 ? 6 : d.getDay() - 1];
            const shortDate = `${d.getDate()}/${d.getMonth() + 1}`;

            const assignments = getAssignmentsFn(user.id, dateStr);
            const absence = getAbsenceFn ? getAbsenceFn(user.id, dateStr) : null;
            
            // Ren cell utan gamla data-taggar som kan orsaka spök-text
            html += `<div class="weekly-cell">`;
            
            // DEN ENDA utskriften av datumet för mobilen
            html += `<div class="mobile-date-label">${dayName} ${shortDate}</div>`; 
            html += `<div class="weekly-cell-content">`; 

            // Prioriterar frånvaro. Om personen är sjuk/ledig, visa bara detta.
            if (absence) {
                let icon = '✈️';
                if(absence.type === 'Sjuk') icon = '🤒';
                if(absence.type === 'VAB') icon = '🧸';
                if(absence.type === 'Semester') icon = '🌴';
                html += `<div class="weekly-badge" style="background:#ffebee; color:#c62828; border: 1px solid #ffcdd2;">${icon} ${escapeHTML(absence.type)}</div>`;
            } 
            // Om ingen frånvaro och inga pass = Ledig
            else if (!assignments || assignments.length === 0) {
                html += `<span class="free-text">Ledig</span>`;
            } 
            // Annars ritar vi ut arbetsplats-pillren
            else {
                assignments.forEach(a => {
                    const bg = a.stationColor || '#ccc';
                    const fg = isLight(bg) ? '#000' : '#fff';
                    let shortLabel = a.shiftLabel.toLowerCase() === 'förmiddag' ? 'FM' : (a.shiftLabel.toLowerCase() === 'eftermiddag' ? 'EM' : a.shiftLabel);
                    html += `<div class="weekly-badge" style="background:${escapeHTML(bg)}; color:${fg};">${escapeHTML(a.stationName)} <span style="opacity:0.8; font-weight:normal;">(${escapeHTML(shortLabel)})</span></div>`;
                });
            }
            html += `</div></div>`;
        });
        html += `</div>`;
    });
    html += '</div>';
    return html;
}

/**
 * Generisk Drag-and-Drop-hanterare för att sortera listor (Event Delegation).
 * Används bl.a. för att byta ordning på arbetsstationer och tider i inställningarna.
 * @param {HTMLElement} container - DOM-elementet som håller listan (föräldern).
 * @param {string} itemSelector - CSS-selektor för de objekt som får dras (t.ex. '.draggable-item').
 * @param {Function} onReorder - Callback-funktion som körs när ett objekt släpps (får oldIndex och newIndex som argument).
 */
export function setupListDragAndDrop(container, itemSelector, onReorder) {
    if (!container) return;
    let dragSrcEl = null;

    container.addEventListener('dragstart', (e) => {
        dragSrcEl = e.target.closest(itemSelector);
        if (dragSrcEl) {
            e.dataTransfer.effectAllowed = 'move';
            dragSrcEl.classList.add('dragging');
        }
    });

    container.addEventListener('dragover', (e) => {
        if (e.target.closest(itemSelector)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        }
    });

    container.addEventListener('dragend', () => {
        if (dragSrcEl) dragSrcEl.classList.remove('dragging');
    });

    container.addEventListener('drop', (e) => {
        e.stopPropagation();
        const targetEl = e.target.closest(itemSelector);
        
        if (dragSrcEl && targetEl && dragSrcEl !== targetEl) {
            const oldIndex = Number.parseInt(dragSrcEl.dataset.index);
            const newIndex = Number.parseInt(targetEl.dataset.index);
            if (!Number.isNaN(oldIndex) && !Number.isNaN(newIndex)) {
                onReorder(oldIndex, newIndex);
            }
        }
        if (dragSrcEl) dragSrcEl.classList.remove('dragging');
    });
}

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; }, 10);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

export function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const msgEl = document.getElementById('confirmMessage');
        const btnYes = document.getElementById('btnConfirmYes');
        const btnNo = document.getElementById('btnConfirmNo');
        if(!modal || !msgEl || !btnYes || !btnNo) {
            resolve(confirm(message)); return;
        }
        msgEl.innerText = message;
        modal.classList.add('show');
        
        const cleanup = () => {
            modal.classList.remove('show');
            btnYes.onclick = null;
            btnNo.onclick = null;
        };
        
        btnYes.onclick = () => { cleanup(); resolve(true); };
        btnNo.onclick = () => { cleanup(); resolve(false); };
    });
}

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

export function isLight(color) {
    // FIX: Härdad mot null/undefined/ogiltiga färgformat (t.ex. '#fff', 'red', '')
    // Utan denna kraschar hela display-renderingen om station.color är NULL i databasen
    if (!color || typeof color !== 'string') return true;
    const hex = color.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return true;
    const r = Number.parseInt(hex.substring(0, 2), 16);
    const g = Number.parseInt(hex.substring(2, 2), 16);
    const b = Number.parseInt(hex.substring(4, 2), 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000 > 155;
}

export function escapeHTML(str) {
    // FIX: Härdad mot icke-strängar (tal, boolean) som tidigare kraschade med
    // "str.replace is not a function". Null/undefined returnerar fortfarande tom sträng.
    if (str === null || str === undefined) return '';
    if (typeof str !== 'string') str = String(str);
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

export function buildWeeklyGridHTML(users, dates, getAssignmentsFn, showHeadersWithDates, daysArray, getAbsenceFn = null) {
    let html = '<div class="weekly-grid"><div class="weekly-header-row"><div class="weekly-user-name">Personal</div>';
    
    // 1. Bygger datorns topp-rubrik
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

            if (absence) {
                let icon = '✈️';
                if(absence.type === 'Sjuk') icon = '🤒';
                if(absence.type === 'VAB') icon = '🧸';
                if(absence.type === 'Semester') icon = '🌴';
                html += `<div class="weekly-badge" style="background:#ffebee; color:#c62828; border: 1px solid #ffcdd2;">${icon} ${escapeHTML(absence.type)}</div>`;
            } 
            else if (!assignments || assignments.length === 0) {
                html += `<span class="free-text">Ledig</span>`;
            } else {
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
 * Generisk Drag-and-Drop-hanterare för listor (Event Delegation).
 * @param {HTMLElement} container - DOM-elementet som håller listan.
 * @param {string} itemSelector - CSS-selektor för de objekt som får dras (t.ex. '.draggable-item').
 * @param {Function} onReorder - Callback som körs när ett objekt släpps (får oldIndex och newIndex).
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

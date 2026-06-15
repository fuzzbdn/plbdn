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
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000 > 155;
}

export function escapeHTML(str) {
    if (!str) return "";
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
                // FIX: Lade till escapeHTML(absence.type) här
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

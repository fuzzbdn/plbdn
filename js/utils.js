// ==========================================
// UTILS.JS - Hjälpfunktioner för hela systemet
// ==========================================

// Visar en popup (toast) med ett meddelande nere i hörnet
export function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = type === 'error' ? '❌' : (type === 'info' ? 'ℹ️' : '✅');
    toast.innerHTML = `<span>${icon}</span> <span>${escapeHTML(message)}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { if(container.contains(toast)) container.removeChild(toast); }, 300);
    }, 3000);
}

// Visar en snyggare bekräftelse-ruta istället för webbläsarens inbyggda
export function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        if(!modal) { resolve(confirm(message)); return; }

        const msgEl = document.getElementById('confirmMessage');
        const btnYes = document.getElementById('btnConfirmYes');
        const btnNo = document.getElementById('btnConfirmNo');

        msgEl.innerText = message;
        modal.classList.add('show');

        const cleanup = () => {
            modal.classList.remove('show');
            btnYes.removeEventListener('click', handleYes);
            btnNo.removeEventListener('click', handleNo);
        };

        const handleYes = () => { cleanup(); resolve(true); };
        const handleNo = () => { cleanup(); resolve(false); };

        btnYes.addEventListener('click', handleYes);
        btnNo.addEventListener('click', handleNo);
    });
}

// Räknar ut vilket Veckonummer ett specifikt datum tillhör (Svensk standard ISO-8601)
export function getISOWeek(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const w1 = new Date(date.getFullYear(), 0, 4);
    return {
        week: 1 + Math.round(((date.getTime() - w1.getTime()) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7),
        year: date.getFullYear()
    };
}

// Avgör om en färg är ljus eller mörk (för att veta om texten ska vara vit eller svart)
export function isLight(color) {
    if(!color) return true;
    const h = color.replace('#','');
    const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
    return ((r*299 + g*587 + b*114)/1000) >= 128;
}

// Skyddar mot XSS (Hackare som försöker skriva in kod i namnfält)
export function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}

// ==========================================
// DRY REFACTORING: Bygg Veckoschemat
// ==========================================
// Denna funktion tar emot rådata och spottar ut färdig HTML för veckovyn.
// Används av både admin.js och user.js för att slippa duplicerad kod.
export function buildWeeklyGridHTML(users, dates, getAssignmentsFn, showHeadersWithDates, daysArray) {
    let html = '<div class="weekly-grid"><div class="weekly-header-row"><div class="weekly-user-name">Personal</div>';
    
    // 1. Bygg datumrubrikerna i toppen (t.ex. "Måndag" eller "Måndag 12/4")
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

    // 2. Loopa igenom varje användare och bygg deras rad
    users.forEach(user => {
        // Prioritera Display-namn, annars förnamn+efternamn
        const nameToShow = user.display_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username;
        html += `<div class="weekly-user-row"><div class="weekly-user-name">${escapeHTML(nameToShow)}</div>`;

        // 3. Loopa igenom dagarna för denna användare
        dates.forEach(dateStr => {
            // Använd funktionen vi skickade med för att hämta just denna persons pass för denna dag
            const assignments = getAssignmentsFn(user.id, dateStr);
            html += `<div class="weekly-cell">`;
            
            // Är listan tom? Skriv "Ledig"
            if (!assignments || assignments.length === 0) {
                html += `<span class="free-text">Ledig</span>`;
            } else {
                // Skapa en färgkodad badge för varje pass
                assignments.forEach(a => {
                    const bg = a.stationColor || '#ccc';
                    const fg = isLight(bg) ? '#000' : '#fff';
                    // Förkorta "Förmiddag" till "FM" för att spara plats
                    let shortLabel = a.shiftLabel.toLowerCase() === 'förmiddag' ? 'FM' : (a.shiftLabel.toLowerCase() === 'eftermiddag' ? 'EM' : a.shiftLabel);
                    html += `<div class="weekly-badge" style="background:${escapeHTML(bg)}; color:${fg};">${escapeHTML(a.stationName)} <span style="opacity:0.8; font-weight:normal;">(${escapeHTML(shortLabel)})</span></div>`;
                });
            }
            html += `</div>`;
        });
        html += `</div>`;
    });
    html += '</div>';
    
    // Returnera den färdiga HTML-koden
    return html;
}

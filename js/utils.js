export function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // Lägg till ikon baserat på typ
    let icon = type === 'error' ? '❌' : (type === 'info' ? 'ℹ️' : '✅');
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => { if(container.contains(toast)) container.removeChild(toast); }, 300);
    }, 3000);
}

export function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        // Fallback om modalen saknas i HTML
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

export function isLight(color) {
    if(!color) return true;
    const h = color.replace('#','');
    const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
    return ((r*299 + g*587 + b*114)/1000) >= 128;
}

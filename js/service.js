import { showToast } from './utils.js';

// ==========================================
// HJÄLPFUNKTIONER
// ==========================================

/**
 * Bygger headers med Authorization och x-workplace-id.
 * FIX: Extraherad från alla tre funktioner för att undvika upprepning.
 * @param {Object} extra - Extra headers att slå ihop (t.ex. Content-Type).
 * @returns {Object} Headers-objekt.
 */
function buildAuthHeaders(extra = {}) {
    const headers = { ...extra };
    const token = localStorage.getItem('jwtToken');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const workplace = localStorage.getItem('activeWorkplace');
    if (workplace) headers['x-workplace-id'] = workplace;
    return headers;
}

/**
 * Hanterar 401-svar genom att rensa sessionen och skicka till inloggningssidan.
 * FIX: Extraherad från alla tre funktioner för att undvika upprepning.
 */
function handleUnauthorized() {
    localStorage.clear();
    window.location.href = 'index.html';
}

// ==========================================
// API-FUNKTIONER
// ==========================================

/**
 * Hämtar data från API:et via GET.
 *
 * FIX: displayToken läses inte längre från URL:en här – det orsakade att
 * token lades till dubbelt när display.js redan skickade med den via extraParams.
 * Den som anropar ansvarar för att skicka med token i extraParams vid behov.
 *
 * FIX: Fel loggas nu med statuskod istället för att kastas och fångas tyst.
 *
 * @param {string} type - API-typen (t.ex. 'users', 'schedule').
 * @param {string} extraParams - Extra query-parametrar (t.ex. '&start_date=...').
 * @returns {Promise<any|null>} Parsed JSON eller null vid fel.
 */
export async function fetchData(type, extraParams = '') {
    try {
        // Lägg till workplace från URL om den finns (används av display-sidan)
        const urlParams = new URLSearchParams(window.location.search);
        const workplace = urlParams.get('workplace');

        let url = `/api/data-api?type=${type}${extraParams}`;
        if (workplace) url += `&workplace=${encodeURIComponent(workplace)}`;

        const res = await fetch(url, { headers: buildAuthHeaders() });

        if (res.status === 401) {
            handleUnauthorized();
            return null;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status} för typ: ${type}`);

        return await res.json();
    } catch (e) {
        console.error('fetchData misslyckades:', e.message);
        return null;
    }
}

/**
 * Sparar data till API:et via POST.
 *
 * FIX: Returnerar nu false vid alla icke-ok svar från servern,
 * inte bara vid 401. Tidigare returnerades true även vid t.ex. 500.
 *
 * FIX: Toast-anropet är borttaget – UI-feedback hör hemma i den modul
 * som anropar servicen, inte i service-lagret självt.
 *
 * @param {string} type - API-typen att spara.
 * @param {*} data - Data att spara.
 * @returns {Promise<boolean>} True vid lyckat svar, annars false.
 */
export async function saveData(type, data) {
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        showToast('Sessionen utlöpt. Logga in igen.', 'error');
        setTimeout(() => { window.location.href = 'index.html'; }, 2000);
        return false;
    }

    try {
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ type, data })
        });

        if (res.status === 401) {
            handleUnauthorized();
            return false;
        }

        // FIX: Returnera false vid alla serversidan-fel (t.ex. 500), inte bara 401
        if (!res.ok) {
            console.error(`saveData misslyckades: HTTP ${res.status} för typ: ${type}`);
            return false;
        }

        return true;
    } catch (e) {
        console.error('saveData nätverksfel:', e.message);
        return false;
    }
}

/**
 * Utför en API-åtgärd via POST.
 *
 * FIX: Omdirigerar nu till inloggningssidan utan att visa en toast
 * om token saknas – konsekvent med saveData och fetchData.
 *
 * @param {string} action - Åtgärden att utföra (t.ex. 'assign_shift').
 * @param {Object} payload - Data att skicka med åtgärden.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function apiAction(action, payload = {}) {
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        handleUnauthorized();
        return { success: false, error: 'Inte inloggad' };
    }

    try {
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ action, payload })
        });

        if (res.status === 401) {
            handleUnauthorized();
            return { success: false, error: 'Session utlöpt' };
        }

        if (!res.ok) {
            console.error(`apiAction misslyckades: HTTP ${res.status} för åtgärd: ${action}`);
            return { success: false, error: `HTTP ${res.status}` };
        }

        return await res.json();
    } catch (e) {
        console.error('apiAction nätverksfel:', e.message);
        return { success: false, error: 'Nätverksfel' };
    }
}

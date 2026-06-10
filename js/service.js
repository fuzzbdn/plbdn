import { showToast } from './utils.js';

// ==========================================
// HJÄLPFUNKTIONER
// ==========================================

/**
 * Bygger headers med x-workplace-id.
 * FIX: Authorization-headern är borttagen eftersom vi nu använder HttpOnly-cookies
 * som hanteras automatiskt av webbläsaren.
 * @param {Object} extra - Extra headers att slå ihop (t.ex. Content-Type).
 * @returns {Object} Headers-objekt.
 */
function buildAuthHeaders(extra = {}) {
    const headers = { ...extra };
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
    if (!window.location.pathname.includes('index.html')) {
        window.location.href = 'index.html';
    }
}

// ==========================================
// API-FUNKTIONER
// ==========================================

/**
 * Hämtar data från API:et via GET.
 *
 * FIX: displayToken plockas upp från URL:en igen om den finns, 
 * eftersom skärmen nu behöver skicka med den även för att hämta inställningar.
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
        const token = urlParams.get('token'); // Plocka upp display-nyckeln

        let url = `/api/data-api?type=${type}${extraParams}`;
        if (workplace) url += `&workplace=${encodeURIComponent(workplace)}`;
        
        // Bifoga token automatiskt för display-skärmar om den saknas i strängen
        if (token && !url.includes('&token=') && !url.includes('&display_token=')) {
            url += `&token=${encodeURIComponent(token)}`;
        }

        // CRITICAL: credentials: 'include' tvingar webbläsaren att skicka med HttpOnly-cookien
        const res = await fetch(url, { 
            headers: buildAuthHeaders(),
            credentials: 'include' 
        });

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
 * FIX: Returnerar nu false vid alla icke-ok svar från servern.
 * FIX: Lokal token-kontroll är borttagen, vi förlitar oss på backendens 401-svar via cookies.
 *
 * @param {string} type - API-typen att spara.
 * @param {*} data - Data att spara.
 * @returns {Promise<boolean>} True vid lyckat svar, annars false.
 */
export async function saveData(type, data) {
    try {
        // CRITICAL: credentials: 'include' används för att skicka HttpOnly-cookien
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ type, data }),
            credentials: 'include'
        });

        if (res.status === 401) {
            handleUnauthorized();
            return false;
        }

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
 * FIX: Omdirigerar till inloggningssidan via 401-svaret istället för lokal kontroll.
 *
 * @param {string} action - Åtgärden att utföra (t.ex. 'assign_shift').
 * @param {Object} payload - Data att skicka med åtgärden.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function apiAction(action, payload = {}) {
    try {
        // CRITICAL: credentials: 'include' används för att skicka HttpOnly-cookien
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ action, payload }),
            credentials: 'include'
        });

        if (res.status === 401) {
            handleUnauthorized();
            return { success: false, error: 'Session utlöpt eller obehörig' };
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

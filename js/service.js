/**
 * ============================================================================
 * SERVICE.JS
 * Hanterar all nätverkskommunikation (HTTP-anrop) mot backend-API:et.
 * Implementerar en smart lokal cache, automatiska timeouts, och centraliserad
 * felhantering (som t.ex. att logga ut användaren om sessionen går ut).
 * ============================================================================
 */

const DEFAULT_TIMEOUT_MS = 10000; // Avbryt nätverksanrop efter 10 sekunder
const CACHE_TTL_MS = 30000;       // Data lever i cachen i 30 sekunder (Time To Live)

/**
 * En Set med de datatyper (endpoints) som vi tillåter att appen cachar.
 * Detta förhindrar att vi spammar databasen med identiska GET-anrop.
 */
const CACHEABLE_TYPES = new Set([
    'users', 'admins', 'stations', 'shifts', 'settings', 
    'workplaces', 'message', 'custom_themes', 'weather_config'
]);

/**
 * Mappar (kartlägger) specifika POST-actions till de cacher som måste rensas.
 * Om vi t.ex. sparar en ny station, måste cachen för 'stations' raderas,
 * annars kommer gränssnittet visa den gamla listan i 30 sekunder.
 */
const CACHE_INVALIDATION_MAP = {
    quick_add_user:   ['users', 'admins'],
    remove_user:      ['users', 'admins'],
    add_admin:        ['users', 'admins'],
    edit_admin:       ['users', 'admins'],
    remove_admin:     ['users', 'admins'],
    save_station:     ['stations'],
    delete_station:   ['stations'],
    reorder_stations: ['stations'],
    save_shift:       ['shifts'],
    delete_shift:     ['shifts'],
    reorder_shifts:   ['shifts'],
    save_workplace:   ['workplaces', 'settings'],
};

// Vår interna minnes-cache (Map är snabbare och renare än ett vanligt objekt)
const _cache = new Map();

/**
 * Hämtar data från den lokala cachen om den fortfarande är giltig (färsk).
 * @param {string} key - Hela URL:en som användes för anropet.
 * @returns {Object|null} Cachat data-objekt, eller null om det är för gammalt/saknas.
 */
function _cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    
    // Rensa ut datan om den har blivit äldre än vår angivna livslängd (30s)
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        _cache.delete(key);
        return null;
    }
    return entry.data;
}

/**
 * Sparar ett nätverkssvar i den lokala cachen, tillsammans med aktuell tidsstämpel.
 * @param {string} key - Hela URL:en som användes för anropet.
 * @param {Object} data - Det nätverkssvar (JSON) vi fick från servern.
 */
function _cacheSet(key, data) {
    _cache.set(key, { data, ts: Date.now() });
}

/**
 * Tvingar fram en radering av specifika typer ur cachen.
 * @param {Array<string>} types - Lista på datatyper som ska invalidiseras (t.ex. ['users']).
 */
function _invalidateTypes(types) {
    for (const [key] of _cache) {
        if (types.some(t => key.includes(`type=${t}`))) {
            _cache.delete(key);
        }
    }
}

/**
 * Tvingar en utloggning om API:et svarar med 401 Unauthorized (ogiltig JWT/Cookie).
 */
function handleExpiredSession() {
    localStorage.clear();
    window.location.replace('index.html?session=expired');
}

/**
 * Dirigerar rätt GET-fråga (typ) till rätt fil/endpoint på backend-servern.
 * @param {string} type - Typen av data som söks (t.ex. 'users' eller 'schedule').
 * @returns {string} Sökvägen till API:et (t.ex. '/api/schedule').
 */
function getEndpointForType(type) {
    const userTypes = ['users', 'admins'];
    const scheduleTypes = ['schedule', 'absences'];
    const settingsTypes = ['workplaces', 'stations', 'shifts', 'settings', 'message', 'custom_themes', 'display_bundle', 'weather_config'];

    if (userTypes.includes(type)) return '/api/users';
    if (scheduleTypes.includes(type)) return '/api/schedule';
    if (settingsTypes.includes(type)) return '/api/settings';

    throw new Error(`Okänd GET-typ för API-anrop: ${type}`);
}

/**
 * Dirigerar rätt POST-fråga (action) till rätt fil/endpoint på backend-servern.
 * @param {string} action - Handlingens namn (t.ex. 'assign_shift' eller 'login').
 * @returns {string} Sökvägen till API:et.
 */
function getEndpointForAction(action) {
    const authActions = ['login', 'logout', 'request_reset', 'perform_reset', 'switch_workplace'];
    const userActions = ['quick_add_user', 'remove_user', 'add_admin', 'edit_admin', 'remove_admin'];
    const scheduleActions = ['assign_shift', 'remove_shift', 'publish_schedule', 'save_absence', 'delete_absence', 'update_note', 'toggle_lock'];
    const settingsActions = ['reorder_stations', 'reorder_shifts', 'save_workplace', 'save_station', 'save_shift', 'delete_station', 'delete_shift', 'generate_display_link'];

    if (authActions.includes(action)) return '/api/auth';
    if (userActions.includes(action)) return '/api/users';
    if (scheduleActions.includes(action)) return '/api/schedule';
    if (settingsActions.includes(action)) return '/api/settings';

    throw new Error(`Okänd POST-action för API-anrop: ${action}`);
}

/**
 * Den centrala interna funktionen som utför det faktiska Fetch-anropet mot nätverket.
 * Hanterar timeouts, JSON-parsning och fel-statuskoder centralt.
 * 
 * @param {string} url - Den fullständiga URL:en till API:et.
 * @param {Object} options - Inställningar för fetch (method, headers, body etc).
 * @returns {Object} Serverns svar, alltid strukturerat som ett objekt.
 */
async function _apiFetch(url, options = {}) {
    // Sätter upp en timeout för att förhindra att appen "hänger sig" om nätverket är segt
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const headers = { ...options.headers };
    if (options.body) headers['Content-Type'] = 'application/json';

    try {
        const res = await fetch(url, { ...options, headers, signal: controller.signal });
        clearTimeout(timeoutId);

        // Säkerhet: Om användaren har tappat sin behörighet (session timeout)
        if (res.status === 401) {
            if (!window.location.pathname.endsWith('index.html') &&
                window.location.pathname !== '/') {
                handleExpiredSession();
            }
            return { success: false, error: 'Sessionen har gått ut.', status: 401 };
        }

        // Generella HTTP-fel (500 Server Error, 404 Not Found, etc)
        if (!res.ok) {
            return { success: false, error: `HTTP-fel ${res.status}: ${res.statusText}`, status: res.status };
        }

        const data = await res.json();

        // Om backend (lite slarvigt) inte skickar { success: true }, tvingar vi in det här
        if (options.method === 'GET' && typeof data === 'object' && !data.hasOwnProperty('success')) {
            return { success: true, data };
        }

        return data;

    } catch (err) {
        clearTimeout(timeoutId);
        
        if (err.name === 'AbortError') {
            return { success: false, error: 'Anropet tog för lång tid (Timeout)' };
        }
        
        console.error(`Nätverksfel mot ${url}:`, err);
        return { success: false, error: err.message || 'Ett okänt nätverksfel uppstod' };
    }
}

/**
 * Huvudfunktion för att hämta data (GET-anrop).
 * Används för att läsa in användare, scheman, inställningar etc.
 * Tillämpar automatisk cachning om datatypen tillåter det.
 * 
 * @param {string} type - Vilken typ av data som ska hämtas (t.ex. 'users').
 * @param {Object} [paramsObj={}] - Frivilliga sökparametrar (t.ex. startdatum och slutdatum).
 * @returns {Promise<Object>} Data från backend eller cache.
 */
export async function fetchData(type, paramsObj = {}) {
    try {
        const endpoint = getEndpointForType(type);
        const url = new URL(endpoint, window.location.origin);

        url.searchParams.append('type', type);
        Object.entries(paramsObj).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, String(value));
            }
        });

        const urlStr = url.toString();

        // 1. Kolla om vi redan har datan sparad i minnet (Cachen)
        if (CACHEABLE_TYPES.has(type)) {
            const cached = _cacheGet(urlStr);
            if (cached) return cached;
        }

        // 2. Om inte, hämta från servern
        const result = await _apiFetch(urlStr, { method: 'GET' });

        // 3. Om anropet lyckades, spara svaret i minnet för framtida snabbare access
        if (CACHEABLE_TYPES.has(type) && result?.success) {
            _cacheSet(urlStr, result);
        }

        return result;
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    }
}

/**
 * Huvudfunktion för att utföra handlingar som förändrar databasen (POST-anrop).
 * T.ex. lägga till ett pass, ta bort en användare eller byta lösenord.
 * 
 * @param {string} action - Vilken specifik handling som ska utföras.
 * @param {Object} payload - Den data (t.ex. user_id, date, shift_id) som handlingen kräver.
 * @returns {Promise<Object>} Svar från backend (success: true/false).
 */
export export async function apiAction(action, payload) {
    try {
        const endpoint = getEndpointForAction(action);
        const result = await _apiFetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({ action, payload })
        });

        // Rensar cachen automatiskt om en viktig ändring gjordes
        if (result?.success !== false) {
            const toInvalidate = CACHE_INVALIDATION_MAP[action];
            if (toInvalidate) _invalidateTypes(toInvalidate);
        }

        return result;
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    }
}

/**
 * Specialfunktion för att spara rena inställnings-dokument.
 * Används för JSON-lagring i tabellen 'app_storage' (t.ex. väder-config, rullande text).
 * 
 * @param {string} type - Typ av inställning (t.ex. 'settings', 'message').
 * @param {Object} data - Själva inställningsobjektet.
 * @returns {Promise<Object>} Svar från backend.
 */
export async function saveData(type, data) {
    try {
        const result = await _apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ type, data })
        });

        // Tvinga systemet att hämta de nya inställningarna nästa gång de efterfrågas
        if (result?.success !== false) {
            _invalidateTypes([type]);
        }

        return result;
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    }
}

// ============================================================================
// SERVICE.JS - API-Hantering och Nätverksanrop (Slutgiltig version)
// ============================================================================

const DEFAULT_TIMEOUT_MS = 10000; // 10 sekunder

/**
 * Hanterar utkastning av användare på ett atomärt och säkert sätt.
 */
function handleExpiredSession() {
    localStorage.clear();
    window.location.replace('index.html?session=expired');
}

/**
 * Returnerar endpoint baserat på GET-typ. Kastar fel om typen är okänd.
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
 * Returnerar endpoint baserat på POST-action. Kastar fel om action är okänd.
 */
function getEndpointForAction(action) {
    // Lade till 'switch_workplace' här så att den skickas till '/api/auth'
    const authActions = ['login', 'logout', 'request_reset', 'perform_reset', 'switch_workplace'];
    const userActions = ['quick_add_user', 'remove_user', 'add_admin', 'edit_admin', 'remove_admin'];
    const scheduleActions = ['assign_shift', 'remove_shift', 'publish_schedule', 'save_absence', 'delete_absence'];
    const settingsActions = ['reorder_stations', 'reorder_shifts', 'save_workplace', 'save_station', 'save_shift', 'delete_station', 'delete_shift'];
    
    if (authActions.includes(action)) return '/api/auth';
    if (userActions.includes(action)) return '/api/users';
    if (scheduleActions.includes(action)) return '/api/schedule';
    if (settingsActions.includes(action)) return '/api/settings';
    
    throw new Error(`Okänd POST-action för API-anrop: ${action}`);
}

/**
 * Intern basfunktion för alla fetch-anrop.
 * Hanterar timeout, session-interceptors och standardiserad felhantering.
 */
async function _apiFetch(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    // TODO (Säkerhet): activeWorkplace bör flyttas till en HttpOnly-cookie
    const headers = {
        'x-workplace-id': localStorage.getItem('activeWorkplace') || 'default',
        ...options.headers
    };

    // Sätt endast Content-Type om vi faktiskt skickar en body (t.ex. vid POST)
    if (options.body) {
        headers['Content-Type'] = 'application/json';
    }

    try {
        const res = await fetch(url, { ...options, headers, signal: controller.signal });
        clearTimeout(timeoutId);

        // --- SESSION INTERCEPTOR ---
        if (res.status === 401) {
            // Redirecta INTE om vi redan är på inloggningssidan
            if (!window.location.pathname.endsWith('index.html') && 
                window.location.pathname !== '/') {
                handleExpiredSession();
            }
            return { success: false, error: 'Sessionen har gått ut.', status: 401 };
        }

        // --- FELHANTERING (HTTP 4xx/5xx) ---
        if (!res.ok) {
            return { 
                success: false, 
                error: `HTTP-fel ${res.status}: ${res.statusText}`, 
                status: res.status 
            };
        }

        // --- LYCKAT ANROP ---
        const data = await res.json();
        
        // Defensiv wrapper för GET-anrop som returnerar rena listor från backend
        if (options.method === 'GET' && typeof data === 'object' && !data.hasOwnProperty('success')) {
            return { success: true, data: data };
        }
        
        return data;

    } catch (err) {
        clearTimeout(timeoutId);
        
        // --- TIMEOUT-HANTERING ---
        if (err.name === 'AbortError') {
            return { success: false, error: 'Anropet tog för lång tid (Timeout)' };
        }
        
        console.error(`Nätverksfel mot ${url}:`, err);
        return { success: false, error: err.message || 'Ett okänt nätverksfel uppstod' };
    }
}

/**
 * Hämtar data från backend via GET.
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

        return await _apiFetch(url.toString(), { method: 'GET' });
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    }
}

/**
 * Skickar data till backend via POST.
 */
export async function apiAction(action, payload) {
    try {
        const endpoint = getEndpointForAction(action);
        return await _apiFetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({ action, payload })
        });
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    }
}

/**
 * Sparar generisk inställningsdata (JSON) i databasen.
 */
export async function saveData(type, data) {
    try {
        return await _apiFetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ type, data })
        });
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    }
}

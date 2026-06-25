const DEFAULT_TIMEOUT_MS = 10000;

function handleExpiredSession() {
    localStorage.clear();
    window.location.replace('index.html?session=expired');
}

function getEndpointForType(type) {
    const userTypes = ['users', 'admins'];
    const scheduleTypes = ['schedule', 'absences'];
    const settingsTypes = ['workplaces', 'stations', 'shifts', 'settings', 'message', 'custom_themes', 'display_bundle', 'weather_config'];

    if (userTypes.includes(type)) return '/api/users';
    if (scheduleTypes.includes(type)) return '/api/schedule';
    if (settingsTypes.includes(type)) return '/api/settings';
    
    throw new Error(`Okänd GET-typ för API-anrop: ${type}`);
}

function getEndpointForAction(action) {
    const authActions = ['login', 'logout', 'request_reset', 'perform_reset', 'switch_workplace'];
    const userActions = ['quick_add_user', 'remove_user', 'add_admin', 'edit_admin', 'remove_admin'];
    const scheduleActions = ['assign_shift', 'remove_shift', 'publish_schedule', 'save_absence', 'delete_absence', 'update_note'];
    const settingsActions = ['reorder_stations', 'reorder_shifts', 'save_workplace', 'save_station', 'save_shift', 'delete_station', 'delete_shift', 'generate_display_link'];
    
    if (authActions.includes(action)) return '/api/auth';
    if (userActions.includes(action)) return '/api/users';
    if (scheduleActions.includes(action)) return '/api/schedule';
    if (settingsActions.includes(action)) return '/api/settings';
    
    throw new Error(`Okänd POST-action för API-anrop: ${action}`);
}

async function _apiFetch(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    const headers = {
        ...options.headers
    };

    if (options.body) {
        headers['Content-Type'] = 'application/json';
    }

    try {
        const res = await fetch(url, { ...options, headers, signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.status === 401) {
            if (!globalThis.location.pathname.endsWith('index.html') &&
                globalThis.location.pathname !== '/') {
                handleExpiredSession();
            }
            return { success: false, error: 'Sessionen har gått ut.', status: 401 };
        }

        if (!res.ok) {
            return { 
                success: false, 
                error: `HTTP-fel ${res.status}: ${res.statusText}`, 
                status: res.status 
            };
        }

        const data = await res.json();
        
        if (options.method === 'GET' && typeof data === 'object' && !data.hasOwnProperty('success')) {
            return { success: true, data: data };
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

export async function fetchData(type, paramsObj = {}) {
    try {
        const endpoint = getEndpointForType(type);
        const url = new URL(endpoint, globalThis.location.origin);
        
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

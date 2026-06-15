// ============================================================================
// SERVICE.JS - API-Hantering och Nätverksanrop
// ============================================================================

/**
 * Hjälpfunktion som listar ut vilken endpoint (auth, users, schedule, settings)
 * som ska anropas baserat på GET-typ.
 */
function getEndpointForType(type) {
    if (['users', 'admins'].includes(type)) return '/api/users';
    if (['schedule', 'absences'].includes(type)) return '/api/schedule';
    return '/api/settings'; // Hanterar workplaces, stations, shifts, settings, message, themes, display
}

/**
 * Hjälpfunktion som listar ut vilken endpoint som ska anropas baserat på POST-action.
 */
function getEndpointForAction(action) {
    const authActions = ['login', 'logout', 'request_reset', 'perform_reset'];
    const userActions = ['quick_add_user', 'remove_user', 'add_admin', 'edit_admin', 'remove_admin'];
    const scheduleActions = ['assign_shift', 'remove_shift', 'publish_schedule', 'save_absence', 'delete_absence'];
    
    if (authActions.includes(action)) return '/api/auth';
    if (userActions.includes(action)) return '/api/users';
    if (scheduleActions.includes(action)) return '/api/schedule';
    return '/api/settings'; // Hanterar stationer, pass, arbetsplatser mm.
}

/**
 * Hämtar data från backend via GET
 */
export async function fetchData(type, extraParams = '') {
    const endpoint = getEndpointForType(type);
    try {
        const res = await fetch(`${endpoint}?type=${type}${extraParams}`, {
            headers: {
                'x-workplace-id': localStorage.getItem('activeWorkplace') || 'default'
            }
        });
        if (!res.ok) throw new Error('Network response was not ok');
        return await res.json();
    } catch (err) {
        console.error(`Fel vid hämtning av ${type}:`, err);
        return null;
    }
}

/**
 * Skickar data till backend via POST
 */
export async function apiAction(action, payload) {
    const endpoint = getEndpointForAction(action);
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-workplace-id': localStorage.getItem('activeWorkplace') || 'default'
            },
            body: JSON.stringify({ action, payload })
        });
        return await res.json();
    } catch (err) {
        console.error(`Fel vid utförande av ${action}:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Sparar generisk inställningsdata (JSON) i databasen (t.ex. teman och väder)
 */
export async function saveData(type, data) {
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-workplace-id': localStorage.getItem('activeWorkplace') || 'default'
            },
            body: JSON.stringify({ type, data })
        });
        return await res.json();
    } catch (err) {
        console.error(`Fel vid sparande av ${type}:`, err);
        return { success: false, error: err.message };
    }
}

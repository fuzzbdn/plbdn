import { showToast } from './utils.js';

export async function fetchData(type, extraParams = "") {
    try {
        const headers = {};
        const token = sessionStorage.getItem('jwtToken');
        if (token) headers['Authorization'] = `Bearer ${token}`;
        
        // NYTT: Skicka med vald arbetsplats om man är Superadmin
        const activeWorkplace = sessionStorage.getItem('activeWorkplace');
        if (activeWorkplace) headers['x-workplace-id'] = activeWorkplace;
        
        const urlParams = new URLSearchParams(window.location.search);
        const displayToken = urlParams.get('token');
        const workplace = urlParams.get('workplace');
        
        let url = `/api/data-api?type=${type}${extraParams}`;
        if(displayToken) url += `&display_token=${displayToken}`;
        if(workplace) url += `&workplace=${workplace}`;

        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error();
        return await res.json();
    } catch (e) { return null; }
}

export async function saveData(type, data) {
    const token = sessionStorage.getItem('jwtToken');
    if (!token) { 
        showToast("Sessionen utlöpt. Logga in igen.", "error"); 
        setTimeout(() => window.location.href="index.html", 2000);
        return false; 
    }
    
    const headers = { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` };
    const activeWorkplace = sessionStorage.getItem('activeWorkplace');
    if (activeWorkplace) headers['x-workplace-id'] = activeWorkplace;

    try {
        await fetch('/api/data-api', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ type, data })
        });
        return true;
    } catch (e) { return false; }
}

export async function apiAction(action, payload = {}) {
    const token = sessionStorage.getItem('jwtToken');
    if (!token) return { success: false, error: "Inte inloggad" };
    
    const headers = { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` };
    const activeWorkplace = sessionStorage.getItem('activeWorkplace');
    if (activeWorkplace) headers['x-workplace-id'] = activeWorkplace;

    try {
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ action, payload })
        });
        return await res.json();
    } catch (e) { return { success: false, error: "Nätverksfel" }; }
}

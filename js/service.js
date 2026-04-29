import { showToast } from './utils.js';

export async function fetchData(type, extraParams = "") {
    try {
        const headers = {};
        const token = localStorage.getItem('jwtToken');
        if (token) headers['Authorization'] = `Bearer ${token}`;
        
        const activeWorkplace = localStorage.getItem('activeWorkplace');
        if (activeWorkplace) headers['x-workplace-id'] = activeWorkplace;
        
        const urlParams = new URLSearchParams(window.location.search);
        const displayToken = urlParams.get('token');
        const workplace = urlParams.get('workplace');
        
        let url = `/api/data-api?type=${type}${extraParams}`;
        if(displayToken) url += `&display_token=${displayToken}`;
        if(workplace) url += `&workplace=${workplace}`;

        const res = await fetch(url, { headers });
        
        // Logga ut automatiskt om token har gått ut
        if (res.status === 401) {
            localStorage.clear();
            window.location.href = "index.html";
            return null;
        }
        
        if (!res.ok) throw new Error();
        return await res.json();
    } catch (e) { return null; }
}

export async function saveData(type, data) {
    const token = localStorage.getItem('jwtToken');
    if (!token) { 
        showToast("Sessionen utlöpt. Logga in igen.", "error"); 
        setTimeout(() => window.location.href="index.html", 2000);
        return false; 
    }
    
    const headers = { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` };
    const activeWorkplace = localStorage.getItem('activeWorkplace');
    if (activeWorkplace) headers['x-workplace-id'] = activeWorkplace;

    try {
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ type, data })
        });
        
        if (res.status === 401) {
            localStorage.clear();
            window.location.href = "index.html";
            return false;
        }
        
        return true;
    } catch (e) { return false; }
}

export async function apiAction(action, payload = {}) {
    const token = localStorage.getItem('jwtToken');
    if (!token) {
        window.location.href = "index.html";
        return { success: false, error: "Inte inloggad" };
    }
    
    const headers = { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` };
    const activeWorkplace = localStorage.getItem('activeWorkplace');
    if (activeWorkplace) headers['x-workplace-id'] = activeWorkplace;

    try {
        const res = await fetch('/api/data-api', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ action, payload })
        });
        
        if (res.status === 401) {
            localStorage.clear();
            window.location.href = "index.html";
            return { success: false, error: "Session utlöpt" };
        }
        
        return await res.json();
    } catch (e) { return { success: false, error: "Nätverksfel" }; }
}

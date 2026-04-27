import { showToast } from './utils.js';

export async function fetchData(type) {
    try {
        const headers = {};
        const token = sessionStorage.getItem('jwtToken');
        if (token) headers['Authorization'] = `Bearer ${token}`;
        
        // Plockar upp token från URL:en om det är en display-skärm
        const urlParams = new URLSearchParams(window.location.search);
        const displayToken = urlParams.get('token');
        
        let url = `/api/data-api?type=${type}`;
        if(displayToken) url += `&display_token=${displayToken}`;

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
    try {
        await fetch('/api/data-api', {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` },
            body: JSON.stringify({ type, data })
        });
        return true;
    } catch (e) { return false; }
}

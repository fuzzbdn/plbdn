import { showToast } from './utils.js';

export async function fetchData(type) {
    try {
        const headers = {};
        const token = sessionStorage.getItem('jwtToken');
        if (token && type === 'admins') headers['Authorization'] = `Bearer ${token}`;
        
        // Här anropas din existerande backend i 'api'-mappen
        const res = await fetch(`/api/data-api?type=${type}`, { headers });
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

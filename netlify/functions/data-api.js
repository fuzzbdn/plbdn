// netlify/functions/data-api.js
const { getStore } = require('@netlify/blobs');

exports.handler = async (event, context) => {
    // 1. Säkerhet: Endast Admin får skriva (POST)
    const user = context.clientContext && context.clientContext.user;
    
    // Konfigurera Blobs (databasen)
    const store = getStore('schedule-db');
    
    // GET: Hämta data (Öppen för display och admin)
    if (event.httpMethod === 'GET') {
        const type = event.queryStringParameters.type || 'schedule';
        const data = await store.get(type, { type: 'json' });
        return {
            statusCode: 200,
            body: JSON.stringify(data || {}) // Returnera tom objekt om inget finns
        };
    }

    // POST: Spara data (Kräver inloggning)
    if (event.httpMethod === 'POST') {
        if (!user) {
            return { statusCode: 401, body: "Unauthorized" };
        }

        const body = JSON.parse(event.body);
        const type = body.type; // 'schedule' eller 'users'
        const payload = body.data;

        await store.setJSON(type, payload);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Saved successfully" })
        };
    }

    return { statusCode: 405, body: "Method Not Allowed" };
};
// netlify/functions/data-api.js
const { getStore } = require('@netlify/blobs');

exports.handler = async (event, context) => {
    console.log("Funktionen startar..."); // Syns i Netlify-loggen

    try {
        // Försök koppla till databasen
        // Vi lägger detta INUTI try-blocket för att fånga MissingBlobsEnvironmentError
        const store = getStore('schedule-db');
        
        // 1. GET: Hämta data
        if (event.httpMethod === 'GET') {
            const type = event.queryStringParameters.type || 'schedule';
            console.log("Försöker hämta:", type);
            const data = await store.get(type, { type: 'json' });
            
            return {
                statusCode: 200,
                body: JSON.stringify(data || {})
            };
        }

        // 2. POST: Spara data
        if (event.httpMethod === 'POST') {
            const user = context.clientContext && context.clientContext.user;
            if (!user) {
                return { statusCode: 401, body: "Unauthorized: Du är inte inloggad." };
            }

            const body = JSON.parse(event.body);
            console.log("Sparar data för:", body.type);
            
            await store.setJSON(body.type, body.data);

            return {
                statusCode: 200,
                body: JSON.stringify({ message: "Saved successfully" })
            };
        }

        return { statusCode: 405, body: "Method Not Allowed" };

    } catch (error) {
        // HÄR FÅNGAR VI KRASCHEN
        console.error("KRITISKT FEL:", error); // Skriver till loggen
        
        // Returnera felet till webbläsaren så du ser det
        return {
            statusCode: 500,
            body: JSON.stringify({
                errorType: "Server Error",
                message: error.message,
                stack: error.stack
            })
        };
    }
};

const { Pool } = require('pg');

// Skapa en koppling till databasen med hjälp av lösenordet vi sparade i Netlify
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Krävs ofta för Neon/molndatabaser
  }
});

exports.handler = async (event, context) => {
  // Vi måste svara headers för att inte webbläsaren ska klaga, även vid fel
  const headers = {
    'Content-Type': 'application/json'
  };

  try {
    // 1. GET: Hämta data
    if (event.httpMethod === 'GET') {
      const type = event.queryStringParameters.type || 'schedule';
      
      // SQL-fråga: Hämta raden där nyckeln är 'schedule' eller 'users'
      const result = await pool.query('SELECT value FROM kv_store WHERE key = $1', [type]);
      
      let data = {};
      if (result.rows.length > 0) {
        data = result.rows[0].value;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data)
      };
    }

    // 2. POST: Spara data
    if (event.httpMethod === 'POST') {
      // Kolla inloggning (Identity)
      const user = context.clientContext && context.clientContext.user;
      if (!user) {
        return { statusCode: 401, headers, body: "Unauthorized" };
      }

      const body = JSON.parse(event.body);
      const type = body.type; // 'schedule' eller 'users'
      const payload = body.data;

      // SQL-fråga: "Upsert" (Uppdatera om den finns, annars skapa ny)
      const query = `
        INSERT INTO kv_store (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key)
        DO UPDATE SET value = $2;
      `;

      await pool.query(query, [type, JSON.stringify(payload)]);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: "Saved to Neon successfully" })
      };
    }

    return { statusCode: 405, headers, body: "Method Not Allowed" };

  } catch (error) {
    console.error("Database Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

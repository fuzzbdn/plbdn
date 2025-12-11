const { Pool } = require('pg');

// Koppla upp mot Neon med adressen från Netlify-inställningarna
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

exports.handler = async (event, context) => {
  console.log("Databas URL är:", process.env.DATABASE_URL ? "Hittad (Börjar med " + process.env.DATABASE_URL.substring(0, 10) + ")" : "UNDEFINED / TOM!");
  
  const headers = {
    'Content-Type': 'application/json'
  };

  try {
    // 1. GET: Hämta data (Schedule eller Users)
    if (event.httpMethod === 'GET') {
      const type = event.queryStringParameters.type || 'schedule';
      
      // Hämta från Neon-databasen
      const result = await pool.query('SELECT value FROM kv_store WHERE key = $1', [type]);
      
      let data = type === 'users' ? [] : {};
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
      // Kolla att användaren är inloggad via Netlify Identity
      const user = context.clientContext && context.clientContext.user;
      if (!user) {
        return { statusCode: 401, headers, body: "Unauthorized" };
      }

      const body = JSON.parse(event.body);
      const type = body.type; 
      const payload = body.data;

      // SQL "Upsert" (Uppdatera om finns, annars skapa ny)
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


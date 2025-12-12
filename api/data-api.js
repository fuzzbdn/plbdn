// api/data-api.js
const { Pool } = require('pg');

// Koppling till Neon (hämtas från Environment Variables)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Krävs ofta för Neon/moln-db
});

// Enkelt lösenordsskydd (hämtas från Environment Variables)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

export default async function handler(req, res) {
  // 1. Hantera CORS (så din frontend får prata med backend)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { type } = req.query; // 'schedule' eller 'users'
  
  // Kontrollera att type är giltig
  if (type !== 'schedule' && type !== 'users') {
     // Om det är en POST och type ligger i body istället
     if (req.method !== 'POST' || !req.body || !req.body.type) {
        return res.status(400).json({ error: "Invalid type parameter" });
     }
  }

  try {
    // === GET: Hämta data ===
    if (req.method === 'GET') {
      const result = await pool.query('SELECT data FROM app_storage WHERE key = $1', [type]);
      if (result.rows.length > 0) {
        return res.status(200).json(result.rows[0].data);
      } else {
        // Returnera tomt om inget finns
        return res.status(200).json(type === 'users' ? [] : {});
      }
    }

    // === POST: Spara data ===
    if (req.method === 'POST') {
      // 1. Kolla lösenord (Authorization header)
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1]; // "Bearer <lösenord>"

      if (token !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Fel lösenord" });
      }

      // 2. Hämta data från body
      const bodyData = req.body; // Vercel parsar JSON automatiskt
      const dataType = bodyData.type;
      const dataPayload = bodyData.data;

      if (!dataType || !dataPayload) {
        return res.status(400).json({ error: "Missing data or type" });
      }

      // 3. Spara till Neon (UPSERT - Uppdatera om finns, annars skapa)
      // Vi använder JSON.stringify för att säkra att det sparas som JSONB korrekt om det behövs,
      // men pg-biblioteket hanterar ofta objekt direkt mot JSONB-kolumner.
      await pool.query(
        `INSERT INTO app_storage (key, data) 
         VALUES ($1, $2) 
         ON CONFLICT (key) 
         DO UPDATE SET data = $2`,
        [dataType, JSON.stringify(dataPayload)]
      );

      return res.status(200).json({ success: true });
    }

    // Om annan metod
    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) {
    console.error("Database error:", error);
    return res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
}

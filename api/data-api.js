const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

module.exports = async function handler(req, res) {
  // CORS-headers (Låter frontend prata med backend)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // ---------------------------------------------------------
    // 1. GET (HÄMTA) - KRÄVER INGET LÖSENORD (För Display-sidan)
    // ---------------------------------------------------------
    if (req.method === 'GET') {
      const { type } = req.query;
      
      // Hämta data från DB
      const result = await pool.query('SELECT data FROM app_storage WHERE key = $1', [type]);
      
      if (result.rows.length > 0) {
        return res.status(200).json(result.rows[0].data);
      } else {
        // Standardvärden om databasen är tom
        if (type === 'settings') return res.status(200).json({ theme: 'light' });
        if (type === 'users') return res.status(200).json([]);
        return res.status(200).json({});
      }
    }

    // ---------------------------------------------------------
    // 2. POST (SPARA) - KRÄVER LÖSENORD (För Admin-sidan)
    // ---------------------------------------------------------
    if (req.method === 'POST') {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1]; // "Bearer <lösenord>"

      // Verifiera inloggning (Login-anropet skickar action: 'login' i body, hanteras separat eller här)
      // Här kollar vi om headern matchar lösenordet
      if (token !== ADMIN_PASSWORD) {
         // Specialfall: Om det är ett inloggningsförsök kollar vi body istället
         if (req.body.action === 'login') {
             if (req.body.password === ADMIN_PASSWORD) {
                 return res.status(200).json({ success: true, token: ADMIN_PASSWORD });
             } else {
                 return res.status(401).json({ success: false, error: "Fel lösenord" });
             }
         }
         return res.status(401).json({ error: "Unauthorized" });
      }

      // Om vi har rätt token, spara data
      const { type, data } = req.body;
      
      if (type && data) {
          await pool.query(
            `INSERT INTO app_storage (key, data) VALUES ($1, $2) 
             ON CONFLICT (key) DO UPDATE SET data = $2`,
            [type, JSON.stringify(data)]
          );
          return res.status(200).json({ success: true });
      }
      
      // Om det bara var en inloggningskoll (action: login) som gick igenom ovan
      if (req.body.action === 'login') {
          return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: "No data provided" });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message });
  }
};

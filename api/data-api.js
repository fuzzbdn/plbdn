const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Master-lösenord (från miljövariabler eller fallback)
const MASTER_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

module.exports = async function handler(req, res) {
  // CORS-headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // ==========================================
    // 1. GET (HÄMTA) - Publikt (Display & Init)
    // ==========================================
    if (req.method === 'GET') {
      const { type } = req.query;
      
      const result = await pool.query('SELECT data FROM app_storage WHERE key = $1', [type]);
      
      if (result.rows.length > 0) {
        return res.status(200).json(result.rows[0].data);
      } else {
        // Standardvärden
        if (type === 'settings') return res.status(200).json({ theme: 'light' });
        if (type === 'users') return res.status(200).json([]); // Personal
        if (type === 'admins') return res.status(200).json([]); // Admins
        return res.status(200).json({});
      }
    }

    // ==========================================
    // 2. POST (SPARA & LOGIN) - Skyddat
    // ==========================================
    if (req.method === 'POST') {
      const { action, username, password, type, data } = req.body;

      // --- SCENARIO A: INLOGGNING ---
      if (action === 'login') {
        // 1. Kolla master-lösenordet först (alltid giltigt)
        if (password === MASTER_PASSWORD) {
             return res.status(200).json({ success: true, user: 'Master Admin' });
        }

        // 2. Kolla databasen efter matchande användare
        const dbRes = await pool.query("SELECT data FROM app_storage WHERE key = 'admins'");
        const admins = dbRes.rows.length > 0 ? dbRes.rows[0].data : [];
        
        // Hitta matchning (användarnamn OCH lösenord)
        const validUser = admins.find(a => a.username === username && a.password === password);

        if (validUser) {
            return res.status(200).json({ success: true, user: validUser.username });
        } else {
            return res.status(401).json({ success: false, error: "Fel användarnamn eller lösenord" });
        }
      }

      // --- SCENARIO B: SPARA DATA (Kräver token/lösenord) ---
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1]; // "Bearer <lösenord>"

      if (!token) {
          return res.status(401).json({ error: "Ingen behörighet" });
      }

      // Vi måste verifiera att token (lösenordet) som skickas med är giltigt
      let isAuthorized = false;

      // 1. Är det master-lösenordet?
      if (token === MASTER_PASSWORD) isAuthorized = true;

      // 2. Om inte, kolla om det matchar någon admin i databasen
      if (!isAuthorized) {
          const dbRes = await pool.query("SELECT data FROM app_storage WHERE key = 'admins'");
          const admins = dbRes.rows.length > 0 ? dbRes.rows[0].data : [];
          // Om lösenordet matchar någon av administratörerna
          if (admins.some(a => a.password === token)) {
              isAuthorized = true;
          }
      }

      if (!isAuthorized) {
          return res.status(401).json({ error: "Ogiltigt lösenord (sessionen kan ha gått ut)" });
      }

      // Spara data om behörig
      if (type && data) {
          await pool.query(
            `INSERT INTO app_storage (key, data) VALUES ($1, $2) 
             ON CONFLICT (key) DO UPDATE SET data = $2`,
            [type, JSON.stringify(data)]
          );
          return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: "Ingen data att spara" });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message });
  }
};

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
    // 1. GET (HÄMTA DATA)
    // ==========================================
    if (req.method === 'GET') {
      const { type } = req.query;

      // Specialfall: Hämta admins från RÄTT tabell (admin_users)
      if (type === 'admins') {
          const result = await pool.query('SELECT * FROM admin_users');
          return res.status(200).json(result.rows);
      }
      
      // Annars hämta från generella lagringen (schema, inställningar, personal)
      const result = await pool.query('SELECT data FROM app_storage WHERE key = $1', [type]);
      
      if (result.rows.length > 0) {
        return res.status(200).json(result.rows[0].data);
      } else {
        // Defaults
        if (type === 'settings') return res.status(200).json({ theme: 'light' });
        if (type === 'users') return res.status(200).json([]);
        return res.status(200).json({});
      }
    }

    // ==========================================
    // 2. POST (LOGIN & SPARA)
    // ==========================================
    if (req.method === 'POST') {
      const { action, username, password, type, data } = req.body;

      // --- SCENARIO A: INLOGGNING ---
      if (action === 'login') {
        // 1. Kolla master-lösenordet
        if (password === MASTER_PASSWORD) {
             return res.status(200).json({ success: true, user: 'Master Admin' });
        }

        // 2. Kolla i 'admin_users' tabellen
        try {
            const result = await pool.query(
                'SELECT * FROM admin_users WHERE username = $1 AND password = $2', 
                [username, password]
            );
            
            if (result.rows.length > 0) {
                return res.status(200).json({ success: true, user: result.rows[0].username });
            }
        } catch (err) {
            console.error("Tabellfel (kanske saknas admin_users?):", err);
        }

        return res.status(401).json({ success: false, error: "Fel användarnamn eller lösenord" });
      }

      // --- SCENARIO B: SPARA DATA ---
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) return res.status(401).json({ error: "Ingen token" });

      // Verifiera token mot master eller databas
      let isAuthorized = (token === MASTER_PASSWORD);
      if (!isAuthorized) {
          const resAuth = await pool.query('SELECT 1 FROM admin_users WHERE password = $1', [token]);
          if (resAuth.rows.length > 0) isAuthorized = true;
      }

      if (!isAuthorized) return res.status(401).json({ error: "Ogiltig session" });

      // Specialfall: Spara Admins (Synka listan mot admin_users tabellen)
      if (type === 'admins' && Array.isArray(data)) {
          const client = await pool.connect();
          try {
              await client.query('BEGIN');
              await client.query('DELETE FROM admin_users'); // Rensa tabellen
              for (const admin of data) {
                  if (admin.username && admin.password) {
                      await client.query(
                          'INSERT INTO admin_users (username, password) VALUES ($1, $2)',
                          [admin.username, admin.password]
                      );
                  }
              }
              await client.query('COMMIT');
              return res.status(200).json({ success: true });
          } catch (e) {
              await client.query('ROLLBACK');
              throw e;
          } finally {
              client.release();
          }
      }

      // Vanlig sparning (Schema, Settings, Personal) till app_storage
      if (type && data) {
          await pool.query(
            `INSERT INTO app_storage (key, data) VALUES ($1, $2) 
             ON CONFLICT (key) DO UPDATE SET data = $2`,
            [type, JSON.stringify(data)]
          );
          return res.status(200).json({ success: true });
      }
      
      return res.status(400).json({ error: "Ingen data" });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message });
  }
};

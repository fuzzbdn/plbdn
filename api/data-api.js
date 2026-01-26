const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || "en_hemlig_nyckel_som_ingen_kan_gissa_12345";

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // --- GET ---
    if (req.method === 'GET') {
      const { type } = req.query;

      if (type === 'admins') {
          const authHeader = req.headers.authorization;
          const token = authHeader && authHeader.split(' ')[1];
          if (!token) return res.status(401).json({ error: "Ingen behörighet" });
          
          try {
              jwt.verify(token, JWT_SECRET);
              // VIKTIGT: Vi hämtar ID nu också för att kunna editera
              const result = await pool.query('SELECT id, username, first_name, last_name FROM admin_users ORDER BY username ASC');
              return res.status(200).json(result.rows);
          } catch (err) {
              return res.status(403).json({ error: "Ogiltig session" });
          }
      }
      
      const result = await pool.query('SELECT data FROM app_storage WHERE key = $1', [type]);
      if (result.rows.length > 0) return res.status(200).json(result.rows[0].data);
      
      // Defaults
      if (type === 'settings') return res.status(200).json({ theme: 'light' });
      if (type === 'users') return res.status(200).json([]);
      if (type === 'message') return res.status(200).json({ text: '', show: false });
      return res.status(200).json({});
    }

    // --- POST ---
    if (req.method === 'POST') {
      const { action, username, password, type, data } = req.body;

      // 1. LOGGA IN
      if (action === 'login') {
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) return res.status(401).json({ success: false, error: "Fel användarnamn/lösenord" });

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(401).json({ success: false, error: "Fel användarnamn/lösenord" });

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        
        // Skicka tillbaka fullständigt namn om det finns
        const fullName = (user.first_name && user.last_name) 
            ? `${user.first_name} ${user.last_name}` 
            : user.username;

        return res.status(200).json({ success: true, token: token, user: user.username, name: fullName });
      }

      // AUTH CHECK
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];
      let decodedUser = null;
      try {
          if (!token) throw new Error();
          decodedUser = jwt.verify(token, JWT_SECRET);
      } catch (err) {
          return res.status(401).json({ error: "Session utlöpt" });
      }

      // 2. SKAPA NY ADMIN
      if (action === 'add_admin') {
          const { firstName, lastName } = req.body;
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(password, salt);
          try {
              await pool.query(
                  'INSERT INTO admin_users (username, password, first_name, last_name) VALUES ($1, $2, $3, $4)', 
                  [username, hashedPassword, firstName, lastName]
              );
              return res.status(200).json({ success: true });
          } catch (e) { return res.status(400).json({ error: "Användaren finns redan" }); }
      }

      // 3. UPPDATERA ADMIN (Ny funktion!)
      if (action === 'edit_admin') {
          const { id, firstName, lastName } = req.body;
          
          try {
              if (password && password.trim() !== "") {
                  // Uppdatera MED lösenord
                  const salt = await bcrypt.genSalt(10);
                  const hashedPassword = await bcrypt.hash(password, salt);
                  await pool.query(
                      'UPDATE admin_users SET username=$1, password=$2, first_name=$3, last_name=$4 WHERE id=$5',
                      [username, hashedPassword, firstName, lastName, id]
                  );
              } else {
                  // Uppdatera UTAN lösenord
                  await pool.query(
                      'UPDATE admin_users SET username=$1, first_name=$2, last_name=$3 WHERE id=$4',
                      [username, firstName, lastName, id]
                  );
              }
              return res.status(200).json({ success: true });
          } catch (e) {
              return res.status(400).json({ error: "Kunde inte uppdatera (användarnamn upptaget?)" });
          }
      }

      // 4. TA BORT ADMIN
      if (action === 'remove_admin') {
          if (decodedUser.username === username) return res.status(400).json({ error: "Kan ej radera sig själv" });
          await pool.query('DELETE FROM admin_users WHERE username = $1', [username]);
          return res.status(200).json({ success: true });
      }

      // 5. SPARA DATA
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
    return res.status(500).json({ error: "Serverfel: " + error.message });
  }
};

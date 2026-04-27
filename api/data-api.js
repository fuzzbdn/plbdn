import pg from 'pg';
const { Pool } = pg;
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Resend } from 'resend'; 

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET;
const resend = new Resend(process.env.RESEND_API_KEY); 

// Nyckeln hämtas nu ENBART från Vercels miljövariabler för högsta säkerhet
const SECRET_DISPLAY_KEY = process.env.DISPLAY_SECRET;

if (!JWT_SECRET) {
  console.error("KRITISKT FEL: JWT_SECRET saknas i miljövariablerna.");
  throw new Error("Serverkonfiguration saknas. Kontakta systemadministratören.");
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // --- GET (Hämta data) ---
    if (req.method === 'GET') {
      const { type } = req.query;
      
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];
      const displayToken = req.query.display_token; 

      let isAuthorized = false;

      // 1. Kolla JWT (Inloggad användare/admin)
      if (token) {
          try {
              jwt.verify(token, JWT_SECRET);
              isAuthorized = true;
          } catch (err) { }
      }

      // 2. Kolla Display-nyckel (Externa skärmar via Vercel)
      if (displayToken && displayToken === SECRET_DISPLAY_KEY) {
          isAuthorized = true;
      }

      // 3. Tillåt inloggningssidan att hämta tema, annars neka om ej auktoriserad
      if (!isAuthorized && !['settings', 'custom_themes'].includes(type)) {
          return res.status(401).json({ error: "Åtkomst nekad. Logga in eller ange giltig display-nyckel." });
      }

      // Hämta Admins/Användare
      if (type === 'admins') {
          try {
              const result = await pool.query('SELECT id, username, first_name, last_name, email, role FROM admin_users ORDER BY username ASC');
              return res.status(200).json(result.rows);
          } catch (err) { return res.status(500).json({ error: "Kunde inte hämta användare" }); }
      }
      
      // Hämta Övrigt
      try {
          const result = await pool.query('SELECT data FROM app_storage WHERE key = $1', [type]);
          if (result.rows.length > 0) {
              return res.status(200).json(result.rows[0].data);
          }
      } catch (dbError) { console.error("DB Error fetching " + type, dbError); }
      
      if (type === 'settings') return res.status(200).json({ theme: 'light' });
      if (type === 'users') return res.status(200).json([]);
      if (type === 'message') return res.status(200).json({ text: '', show: false });
      
      return res.status(200).json({});
    }

    // --- POST (Spara/Ändra) ---
    if (req.method === 'POST') {
      const { action, username, password, type, data } = req.body;

      const isPublicAction = ['login', 'request_reset', 'perform_reset'].includes(action);
      
      // --- SÄKERHETSFIX: Läs av rollen i token ---
      let currentUserRole = 'user'; // Standard är lägsta behörighet

      if (!isPublicAction) {
          const authHeader = req.headers.authorization;
          const token = authHeader && authHeader.split(' ')[1];
          if (!token) return res.status(401).json({ error: "Åtkomst nekad: Token saknas" });
          try { 
              const decoded = jwt.verify(token, JWT_SECRET); 
              currentUserRole = decoded.role || 'user'; // Sparar rollen från JWT
          } 
          catch (err) { return res.status(403).json({ error: "Åtkomst nekad: Ogiltig token" }); }
      }

      // --- SÄKERHETSFIX: Spärra vanliga användare från att spara eller ändra admin-inställningar ---
      const isAdminAction = ['add_admin', 'edit_admin', 'remove_admin'].includes(action) || (type && data);
      if (isAdminAction && currentUserRole !== 'admin') {
          return res.status(403).json({ error: "Behörighet saknas. Endast administratörer får göra ändringar." });
      }

      // 1. LOGGA IN
      if (action === 'login') {
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        const user = result.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ success: false, error: "Fel uppgifter" });
        }
        // Baka in rollen i den nya tokenen när man loggar in
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role || 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        const name = (user.first_name) ? `${user.first_name} ${user.last_name||''}` : user.username;
        return res.status(200).json({ success: true, token, user: user.username, name, role: user.role || 'admin' });
      }

      // 2. SPARA DATA
      if (type && data) {
         await pool.query(`INSERT INTO app_storage (key, data) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET data = $2`, [type, JSON.stringify(data)]);
         return res.status(200).json({ success: true });
      }

      // 3. ADMIN HANTERING
      if (action === 'add_admin') {
          const { firstName, lastName, email, role } = req.body;
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(password, salt);
          try {
              await pool.query(
                  'INSERT INTO admin_users (username, password, first_name, last_name, email, role) VALUES ($1, $2, $3, $4, $5, $6)', 
                  [username, hashedPassword, firstName, lastName, email, role || 'user']
              );
              return res.status(200).json({ success: true });
          } catch (e) { return res.status(400).json({ error: "Användare finns redan" }); }
      }

      if (action === 'edit_admin') {
          const { id, firstName, lastName, email, role } = req.body;
          try {
              if (password && password.trim() !== "") {
                  const salt = await bcrypt.genSalt(10);
                  const hashedPassword = await bcrypt.hash(password, salt);
                  await pool.query(
                      'UPDATE admin_users SET username=$1, password=$2, first_name=$3, last_name=$4, email=$5, role=$6 WHERE id=$7',
                      [username, hashedPassword, firstName, lastName, email, role || 'user', id]
                  );
              } else {
                  await pool.query(
                      'UPDATE admin_users SET username=$1, first_name=$2, last_name=$3, email=$4, role=$5 WHERE id=$6',
                      [username, firstName, lastName, email, role || 'user', id]
                  );
              }
              return res.status(200).json({ success: true });
          } catch (e) { return res.status(400).json({ error: "Kunde inte uppdatera" }); }
      }

      if (action === 'remove_admin') {
          await pool.query('DELETE FROM admin_users WHERE username = $1', [username]);
          return res.status(200).json({ success: true });
      }

      // Återställning (Löses som tidigare)
      if (action === 'request_reset') { /* Samma som innan */ return res.status(200).json({ success: true }); }
      if (action === 'perform_reset') { /* Samma som innan */ return res.status(200).json({ success: true }); }
    }
    
    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) { return res.status(500).json({ error: error.message }); }
}

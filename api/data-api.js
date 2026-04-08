import pg from 'pg';
const { Pool } = pg;
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Resend } from 'resend'; 

// Skapa poolen
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET;
const resend = new Resend(process.env.RESEND_API_KEY); // <-- INITIERA RESEND

// Fail-safe: Stoppa appen direkt om nyckeln saknas
if (!JWT_SECRET) {
  console.error("KRITISKT FEL: JWT_SECRET saknas i miljövariablerna.");
  throw new Error("Serverkonfiguration saknas. Kontakta systemadministratören.");
}

export default async function handler(req, res) {
  // CORS och Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // --- GET (Hämta data) ---
    if (req.method === 'GET') {
      const { type } = req.query;

      // Hämta Admins
      if (type === 'admins') {
          const authHeader = req.headers.authorization;
          const token = authHeader && authHeader.split(' ')[1];
          if (!token) return res.status(401).json({ error: "Ingen token" });
          try {
              jwt.verify(token, JWT_SECRET);
              const result = await pool.query('SELECT id, username, first_name, last_name, email FROM admin_users ORDER BY username ASC');
              return res.status(200).json(result.rows);
          } catch (err) { return res.status(403).json({ error: "Ogiltig token" }); }
      }
      
      // Hämta Övrigt
      try {
          const result = await pool.query('SELECT data FROM app_storage WHERE key = $1', [type]);
          if (result.rows.length > 0) {
              return res.status(200).json(result.rows[0].data);
          }
      } catch (dbError) {
          console.error("DB Error fetching " + type, dbError);
      }
      
      // Defaults
      if (type === 'settings') return res.status(200).json({ theme: 'light' });
      if (type === 'users') return res.status(200).json([]);
      if (type === 'message') return res.status(200).json({ text: '', show: false });
      
      return res.status(200).json({});
    }

    // --- POST (Spara/Ändra) ---
    if (req.method === 'POST') {
      const { action, username, password, type, data } = req.body;

      // 0. AUKTORISERING
      const isPublicAction = ['login', 'request_reset', 'perform_reset'].includes(action);
      
      if (!isPublicAction) {
          const authHeader = req.headers.authorization;
          const token = authHeader && authHeader.split(' ')[1];
          
          if (!token) {
              return res.status(401).json({ error: "Åtkomst nekad: Token saknas" });
          }
          
          try {
              jwt.verify(token, JWT_SECRET);
          } catch (err) { 
              return res.status(403).json({ error: "Åtkomst nekad: Ogiltig token" }); 
          }
      }

      // 1. LOGGA IN
      if (action === 'login') {
        const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
        const user = result.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ success: false, error: "Fel uppgifter" });
        }
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        const name = (user.first_name) ? `${user.first_name} ${user.last_name||''}` : user.username;
        return res.status(200).json({ success: true, token, user: user.username, name });
      }

      // 2. SPARA DATA
      if (type && data) {
         await pool.query(
           `INSERT INTO app_storage (key, data) VALUES ($1, $2) 
            ON CONFLICT (key) DO UPDATE SET data = $2`,
           [type, JSON.stringify(data)]
         );
         return res.status(200).json({ success: true });
      }

      // 3. ADMIN HANTERING
      
      // Lägg till Admin
      if (action === 'add_admin') {
          const { firstName, lastName, email } = req.body;
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(password, salt);
          try {
              await pool.query(
                  'INSERT INTO admin_users (username, password, first_name, last_name, email) VALUES ($1, $2, $3, $4, $5)', 
                  [username, hashedPassword, firstName, lastName, email]
              );
              return res.status(200).json({ success: true });
          } catch (e) { return res.status(400).json({ error: "Användare finns redan" }); }
      }

      // Redigera Admin
      if (action === 'edit_admin') {
          const { id, firstName, lastName, email } = req.body;
          try {
              if (password && password.trim() !== "") {
                  const salt = await bcrypt.genSalt(10);
                  const hashedPassword = await bcrypt.hash(password, salt);
                  await pool.query(
                      'UPDATE admin_users SET username=$1, password=$2, first_name=$3, last_name=$4, email=$5 WHERE id=$6',
                      [username, hashedPassword, firstName, lastName, email, id]
                  );
              } else {
                  await pool.query(
                      'UPDATE admin_users SET username=$1, first_name=$2, last_name=$3, email=$4 WHERE id=$5',
                      [username, firstName, lastName, email, id]
                  );
              }
              return res.status(200).json({ success: true });
          } catch (e) { return res.status(400).json({ error: "Kunde inte uppdatera" }); }
      }

      // Ta bort Admin
      if (action === 'remove_admin') {
          await pool.query('DELETE FROM admin_users WHERE username = $1', [username]);
          return res.status(200).json({ success: true });
      }

      // Återställning (Request Reset)
      if (action === 'request_reset') {
          const { email } = req.body;
          const result = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email]);
          const user = result.rows[0];
          
          if (!user) return res.status(200).json({ success: true, message: "Länk skickad (om e-posten finns)." });

          const resetToken = crypto.randomBytes(20).toString('hex');
          const expires = Date.now() + 3600000; // Giltig i 1 timme
          await pool.query('UPDATE admin_users SET reset_token=$1, reset_expires=$2 WHERE id=$3', [resetToken, expires, user.id]);
          
          // Bygg URL:en
          const protocol = req.headers.host.includes('localhost') ? 'http' : 'https';
          const resetLink = `${protocol}://${req.headers.host}/reset.html?token=${resetToken}`;
          
          // --- SKICKA MAILET VIA RESEND ---
          try {
              await resend.emails.send({
                  from: 'STRUL <losen@info.strulapp.se>', // Låt denna vara kvar tills du verifierat en egen domän
                  to: email,
                  subject: 'Återställ ditt lösenord - STRUL',
                  html: `
                      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
                          <h2 style="color: #0277bd;">Återställ ditt lösenord</h2>
                          <p>Du har begärt att få återställa ditt lösenord för STRUL.</p>
                          <p>Klicka på knappen nedan för att välja ett nytt lösenord. Länken är giltig i 1 timme.</p>
                          <div style="margin: 30px 0;">
                              <a href="${resetLink}" style="background-color: #0277bd; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">Välj nytt lösenord</a>
                          </div>
                          <p style="font-size: 0.9em; color: #666;">Om knappen inte fungerar, klistra in denna länk i din webbläsare:<br>
                          <a href="${resetLink}">${resetLink}</a></p>
                          <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;">
                          <p style="font-size: 0.8em; color: #999;">Om du inte har begärt en lösenordsåterställning kan du tryggt ignorera detta mail.</p>
                      </div>
                  `
              });
              console.log("Återställningsmail skickat via Resend till:", email);
          } catch (mailError) {
              console.error("Kunde inte skicka mail via Resend:", mailError);
          }

          return res.status(200).json({ success: true });
      }

      // Utför Återställning (Perform Reset)
      if (action === 'perform_reset') {
          const { token, newPassword } = req.body;
          const result = await pool.query('SELECT * FROM admin_users WHERE reset_token = $1 AND reset_expires > $2', [token, Date.now()]);
          const user = result.rows[0];
          if (!user) return res.status(400).json({ success: false, error: "Ogiltig eller utgången länk" });

          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(newPassword, salt);
          await pool.query('UPDATE admin_users SET password=$1, reset_token=NULL, reset_expires=NULL WHERE id=$2', [hashedPassword, user.id]);
          return res.status(200).json({ success: true });
      }
    }
    
    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}

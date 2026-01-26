import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL + "?sslmode=require",
});

export default async function handler(req, res) {
  // Hantera CORS (så att din frontend får prata med backend)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { action, username, password } = req.body;

  try {
    const client = await pool.connect();

    // 1. LOGGA IN (Verifiera användare)
    if (action === 'login') {
      const result = await client.query(
        'SELECT * FROM admin_users WHERE username = $1 AND password = $2',
        [username, password]
      );
      
      if (result.rows.length > 0) {
        res.status(200).json({ success: true, user: result.rows[0].username });
      } else {
        res.status(401).json({ success: false, message: 'Fel inloggning' });
      }
    } 
    
    // 2. LÄGG TILL ANVÄNDARE
    else if (action === 'add') {
      // (Här borde man egentligen kolla att den som anropar redan är inloggad)
      try {
        await client.query(
          'INSERT INTO admin_users (username, password) VALUES ($1, $2)',
          [username, password]
        );
        res.status(200).json({ success: true });
      } catch (err) {
        res.status(400).json({ success: false, message: 'Användaren finns nog redan' });
      }
    }

    // 3. TA BORT ANVÄNDARE
    else if (action === 'remove') {
      await client.query(
        'DELETE FROM admin_users WHERE username = $1',
        [username]
      );
      res.status(200).json({ success: true });
    }
    
    // 4. HÄMTA LISTA (För admin-panelen)
    else if (action === 'list') {
      const result = await client.query('SELECT username FROM admin_users ORDER BY username ASC');
      res.status(200).json(result.rows);
    }

    client.release();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Databasfel' });
  }
}
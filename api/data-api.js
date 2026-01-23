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

  // Hantera preflight-förfrågningar (OPTIONS)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // === GET: Hämta data ===
    if (req.method === 'GET') {
      const { type } = req.query;

      // --- ÄNDRING 1: Tillåt 'settings' här ---
      // Vi kollar nu om typen är någon av de tillåtna
      const allowedTypes = ['schedule', 'users', 'settings'];
      
      if (!allowedTypes.includes(type)) {
        return res.status(400).json({ error: "Invalid type parameter" });
      }
      // ----------------------------------------

      const result = await pool.query('SELECT data FROM app_storage WHERE key = $1', [type]);
      
      if (result.rows.length > 0) {
        return res.status(200).json(result.rows[0].data);
      } else {
        // --- ÄNDRING 2: Snyggare hantering av standardvärden ---
        let defaultData = {};
        if (type === 'users') defaultData = [];
        if (type === 'settings') defaultData = { theme: 'light' }; // Standardtema om inget finns sparat
        
        return res.status(200).json(defaultData);
        // -------------------------------------------------------
      }
    }

    // === POST: Spara data ELLER Verifiera lösenord ===
    if (req.method === 'POST') {
      // 1. Kolla lösenord (Authorization header)
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1]; // "Bearer <lösenord>"

      if (token !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Fel lösenord" });
      }

      // 2. Hämta data från body
      const bodyData = req.body; 
      const dataType = bodyData.type;
      const dataPayload = bodyData.data;

      // Hantera verifiering (Login)
      if (dataType === 'verify') {
          return res.status(200).json({ success: true, message: "Lösenord godkänt" });
      }

      // Validera data för sparning
      if (!dataType || !dataPayload) {
        return res.status(400).json({ error: "Missing data or type" });
      }

      // OBS: POST-delen behöver ingen ändring!
      // Eftersom den sparar baserat på `dataType` som skickas från frontend,
      // kommer den automatiskt spara 'settings' när frontend skickar det.

      // 3. Spara till Neon (UPSERT - Uppdatera om finns, annars skapa)
      await pool.query(
        `INSERT INTO app_storage (key, data) 
         VALUES ($1, $2) 
         ON CONFLICT (key) 
         DO UPDATE SET data = $2`,
        [dataType, JSON.stringify(dataPayload)]
      );

      return res.status(200).json({ success: true });
    }

    // Om annan metod än GET eller POST används
    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) {
    console.error("Database error:", error);
    return res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
}

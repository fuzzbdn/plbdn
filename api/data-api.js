import pg from 'pg';
const { Pool } = pg;
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET;
const SECRET_DISPLAY_KEY = process.env.DISPLAY_SECRET;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // --- 1. AUTENTISERING ---
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    let isAuthorized = false;
    let currentUserRole = 'user';
    let currentWorkplace = 'default';

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            isAuthorized = true;
            currentUserRole = decoded.role || 'user';
            currentWorkplace = decoded.workplaceId || 'default';
        } catch (err) { }
    }

    const displayToken = req.query.display_token;
    if (displayToken && displayToken === SECRET_DISPLAY_KEY) {
        isAuthorized = true;
        currentWorkplace = req.query.workplace || 'default'; 
    }

    // --- 2. GET (HÄMTA DATA) ---
    if (req.method === 'GET') {
        const { type, start_date, end_date } = req.query;

        if (!isAuthorized && !['settings', 'custom_themes'].includes(type)) {
            return res.status(401).json({ error: "Åtkomst nekad." });
        }

        if (type === 'users' || type === 'admins') {
            const result = await pool.query(
                `SELECT id, username, first_name, last_name, display_name, email, role 
                 FROM admin_users 
                 WHERE workplace_id = $1 
                 ORDER BY COALESCE(display_name, first_name, username) ASC`, 
                [currentWorkplace]
            );
            return res.status(200).json(result.rows);
        }

        if (type === 'stations') {
            const result = await pool.query('SELECT * FROM stations WHERE workplace_id = $1 ORDER BY sort_order ASC', [currentWorkplace]);
            return res.status(200).json(result.rows);
        }

        if (type === 'shifts') {
            const result = await pool.query('SELECT * FROM shifts WHERE workplace_id = $1 ORDER BY sort_order ASC', [currentWorkplace]);
            return res.status(200).json(result.rows);
        }

        if (type === 'schedule') {
            const result = await pool.query(`
                SELECT sa.id, sa.work_date, sa.user_id, sa.station_id, sa.shift_id, sa.is_published,
                       u.first_name, u.last_name, u.display_name
                FROM schedule_assignments sa
                JOIN admin_users u ON sa.user_id = u.id
                JOIN stations s ON sa.station_id = s.id
                WHERE s.workplace_id = $1
                AND sa.work_date >= $2 AND sa.work_date <= $3
            `, [currentWorkplace, start_date, end_date]);
            return res.status(200).json(result.rows);
        }

        // Hämta inställningar, meddelanden, väder etc från gamla app_storage
        const result = await pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, currentWorkplace]);
        return res.status(200).json(result.rows.length > 0 ? result.rows[0].data : {});
    }

    // --- 3. POST (SPARA/ÄNDRA DATA) ---
    if (req.method === 'POST') {
        const { action, payload, type, data, username, password, fullName, id, firstName, lastName, displayName, email, role } = req.body;

        // Inloggning (publik)
        if (action === 'login') {
            const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username || payload?.username]);
            const user = result.rows[0];
            if (!user || !user.password || !(await bcrypt.compare(password || payload?.password, user.password))) {
                return res.status(401).json({ success: false, error: "Fel uppgifter" });
            }
            const signedToken = jwt.sign({ id: user.id, username: user.username, role: user.role, workplaceId: user.workplace_id }, JWT_SECRET, { expiresIn: '24h' });
            return res.status(200).json({ success: true, token: signedToken, name: user.display_name || user.first_name || user.username, role: user.role });
        }

        // Endast admins nedanför
        if (currentUserRole !== 'admin') return res.status(403).json({ error: "Behörighet saknas" });

        // --- PERSONALHANTERING ---
        if (action === 'quick_add_user') {
            const nameToAdd = payload?.fullName || fullName;
            if (!nameToAdd) return res.status(400).json({ error: "Namn saknas" });
            
            // Klipp isär namnet för att undvika databas-krasch (first_name får inte vara tomt)
            const parts = nameToAdd.trim().split(' ');
            const first = parts[0];
            const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
            const tempUsername = 'user_' + Date.now();
            
            try {
                await pool.query(
                    'INSERT INTO admin_users (username, first_name, last_name, display_name, role, workplace_id) VALUES ($1, $2, $3, $4, $5, $6)', 
                    [tempUsername, first, last, nameToAdd.trim(), 'user', currentWorkplace]
                );
                return res.status(200).json({ success: true });
            } catch (dbError) {
                console.error("Databasfel vid quick_add_user:", dbError);
                return res.status(500).json({ success: false, error: "Kunde inte spara till databasen." });
            }
        }

        if (action === 'remove_user') {
            const nameToRemove = payload?.fullName || fullName;
            if (!nameToRemove) return res.status(400).json({ error: "Namn saknas" });

            try {
                // Raderar oavsett om namnet ligger som visningsnamn, förnamn+efternamn eller användarnamn
                await pool.query(`
                    DELETE FROM admin_users 
                    WHERE (display_name = $1 
                       OR TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) = $1 
                       OR username = $1) 
                    AND workplace_id = $2
                `, [nameToRemove.trim(), currentWorkplace]);
                return res.status(200).json({ success: true });
            } catch (dbError) {
                return res.status(500).json({ success: false, error: "Kunde inte radera." });
            }
        }

        // Fullständig admin-redigering
        if (action === 'add_admin') {
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.query('INSERT INTO admin_users (username, password, first_name, last_name, display_name, email, role, workplace_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', 
                [username, hashedPassword, firstName, lastName, displayName, email, role, currentWorkplace]);
            return res.status(200).json({ success: true });
        }

        if (action === 'edit_admin') {
            if (password && password.trim() !== "") {
                const hashedPassword = await bcrypt.hash(password, 10);
                await pool.query('UPDATE admin_users SET username=$1, password=$2, first_name=$3, last_name=$4, display_name=$5, email=$6, role=$7 WHERE id=$8 AND workplace_id=$9',
                    [username, hashedPassword, firstName, lastName, displayName, email, role, id, currentWorkplace]);
            } else {
                await pool.query('UPDATE admin_users SET username=$1, first_name=$2, last_name=$3, display_name=$4, email=$5, role=$6 WHERE id=$7 AND workplace_id=$8',
                    [username, firstName, lastName, displayName, email, role, id, currentWorkplace]);
            }
            return res.status(200).json({ success: true });
        }

        if (action === 'remove_admin') {
            await pool.query('DELETE FROM admin_users WHERE username = $1 AND workplace_id = $2', [username, currentWorkplace]);
            return res.status(200).json({ success: true });
        }
        
        // --- SCHEMALÄGGNING & PUBLICERING ---
        if (action === 'assign_shift') {
            await pool.query(`
                INSERT INTO schedule_assignments (work_date, user_id, station_id, shift_id, is_published) 
                VALUES ($1, $2, $3, $4, false) 
                ON CONFLICT (work_date, user_id, station_id, shift_id) DO NOTHING
            `, [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
            return res.status(200).json({ success: true });
        }

        if (action === 'remove_shift') {
            await pool.query('DELETE FROM schedule_assignments WHERE work_date=$1 AND user_id=$2 AND station_id=$3 AND shift_id=$4', 
                [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
            return res.status(200).json({ success: true });
        }

        if (action === 'publish_schedule') {
            await pool.query(`
                UPDATE schedule_assignments sa
                SET is_published = true
                FROM stations s
                WHERE sa.station_id = s.id AND s.workplace_id = $1
                AND sa.work_date >= $2 AND sa.work_date <= $3
            `, [currentWorkplace, payload.start_date, payload.end_date]);
            return res.status(200).json({ success: true });
        }

        // --- STATIONER & PASS ---
        if (action === 'save_station') {
            if (payload.id) {
                await pool.query('UPDATE stations SET name=$1, color=$2, is_spacer=$3 WHERE id=$4 AND workplace_id=$5', 
                    [payload.name, payload.color, payload.is_spacer, payload.id, currentWorkplace]);
            } else {
                await pool.query('INSERT INTO stations (workplace_id, name, color, is_spacer, sort_order) VALUES ($1, $2, $3, $4, 99)', 
                    [currentWorkplace, payload.name, payload.color, payload.is_spacer]);
            }
            return res.status(200).json({ success: true });
        }
        
        if (action === 'delete_station') {
            await pool.query('DELETE FROM stations WHERE id=$1 AND workplace_id=$2', [payload.id, currentWorkplace]);
            return res.status(200).json({ success: true });
        }

        if (action === 'reorder_stations') {
            for (let i = 0; i < payload.length; i++) {
                await pool.query('UPDATE stations SET sort_order=$1 WHERE id=$2 AND workplace_id=$3', [i, payload[i], currentWorkplace]);
            }
            return res.status(200).json({ success: true });
        }

        if (action === 'save_shift') {
            if (payload.id) {
                await pool.query('UPDATE shifts SET label=$1, time_range=$2 WHERE id=$3 AND workplace_id=$4', 
                    [payload.label, payload.time_range, payload.id, currentWorkplace]);
            } else {
                await pool.query('INSERT INTO shifts (workplace_id, label, time_range, sort_order) VALUES ($1, $2, $3, 99)', 
                    [currentWorkplace, payload.label, payload.time_range]);
            }
            return res.status(200).json({ success: true });
        }

        if (action === 'delete_shift') {
            await pool.query('DELETE FROM shifts WHERE id=$1 AND workplace_id=$2', [payload.id, currentWorkplace]);
            return res.status(200).json({ success: true });
        }

        if (action === 'reorder_shifts') {
            for (let i = 0; i < payload.length; i++) {
                await pool.query('UPDATE shifts SET sort_order=$1 WHERE id=$2 AND workplace_id=$3', [i, payload[i], currentWorkplace]);
            }
            return res.status(200).json({ success: true });
        }

        // --- LEGACY (Teman, Meddelanden) ---
        if (type && data) {
            await pool.query('DELETE FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, currentWorkplace]);
            await pool.query('INSERT INTO app_storage (key, data, workplace_id) VALUES ($1, $2, $3)', [type, JSON.stringify(data), currentWorkplace]);
            return res.status(200).json({ success: true });
        }

    }
    return res.status(405).end();
  } catch (e) { 
      console.error(e);
      res.status(500).json({ error: e.message }); 
  }
}

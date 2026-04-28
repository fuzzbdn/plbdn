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

if (!JWT_SECRET) {
  console.error("KRITISKT FEL: JWT_SECRET saknas.");
  throw new Error("Serverkonfiguration saknas.");
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // ==========================================
    // 1. AUTENTISERING & ARBETSPLATS-ISOLERING
    // ==========================================
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    let isAuthorized = false;
    let currentUserRole = 'user';
    let currentWorkplace = 'default'; // Standard om inget annat anges
    let currentUserId = null;

    // A. Kolla JWT (Inloggad personal)
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            isAuthorized = true;
            currentUserRole = decoded.role || 'user';
            currentWorkplace = decoded.workplaceId || 'default';
            currentUserId = decoded.id;
        } catch (err) { }
    }

    // B. Kolla Display-nyckel (TV-skärmar)
    const displayToken = req.query.display_token;
    if (displayToken && displayToken === SECRET_DISPLAY_KEY) {
        isAuthorized = true;
        // Skärmen måste ange vilken arbetsplats den tillhör i URL:en, annars tar vi 'default'
        currentWorkplace = req.query.workplace || 'default'; 
    }

    // ==========================================
    // 2. HÄMTA DATA (GET)
    // ==========================================
    if (req.method === 'GET') {
        const { type, start_date, end_date } = req.query;

        // Vissa saker (som inloggningssidans tema) får hämtas utan att vara inloggad
        if (!isAuthorized && !['settings', 'custom_themes'].includes(type)) {
            return res.status(401).json({ error: "Åtkomst nekad." });
        }

        // Hämta Personal & Admins för denna arbetsplats
        if (type === 'users' || type === 'admins') {
            const result = await pool.query(
                `SELECT id, username, first_name, last_name, email, role 
                 FROM admin_users 
                 WHERE workplace_id = $1 
                 ORDER BY first_name ASC`, 
                [currentWorkplace]
            );
            return res.status(200).json(result.rows);
        }

        // Hämta Stationer
        if (type === 'stations') {
            const result = await pool.query('SELECT * FROM stations WHERE workplace_id = $1 ORDER BY sort_order ASC', [currentWorkplace]);
            return res.status(200).json(result.rows);
        }

        // Hämta Pass
        if (type === 'shifts') {
            const result = await pool.query('SELECT * FROM shifts WHERE workplace_id = $1 ORDER BY sort_order ASC', [currentWorkplace]);
            return res.status(200).json(result.rows);
        }

        // Hämta Schema (Kräver start och slutdatum!)
        if (type === 'schedule') {
            if (!start_date || !end_date) return res.status(400).json({error: "Saknar datumintervall"});
            const result = await pool.query(`
                SELECT sa.id, sa.work_date, sa.user_id, sa.station_id, sa.shift_id, sa.is_published,
                       u.first_name, u.last_name
                FROM schedule_assignments sa
                JOIN admin_users u ON sa.user_id = u.id
                JOIN stations s ON sa.station_id = s.id
                WHERE s.workplace_id = $1
                AND sa.work_date >= $2 AND sa.work_date <= $3
            `, [currentWorkplace, start_date, end_date]);
            return res.status(200).json(result.rows);
        }

        // Hämta Gamla Inställningar (Teman, Väder, Meddelanden)
        const result = await pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, currentWorkplace]);
        if (result.rows.length > 0) return res.status(200).json(result.rows[0].data);
        
        return res.status(200).json({});
    }

    // ==========================================
    // 3. SKRIVA DATA (POST)
    // ==========================================
    if (req.method === 'POST') {
        const { action, payload, type, data, username, password, fullName, id, firstName, lastName, email, role } = req.body;

        const isPublicAction = ['login'].includes(action);
        if (!isAuthorized && !isPublicAction) {
            return res.status(401).json({ error: "Åtkomst nekad." });
        }

        // --- INLOGGNING ---
        if (action === 'login') {
            const userIn = username || payload?.username;
            const passIn = password || payload?.password;
            const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [userIn]);
            const user = result.rows[0];
            
            if (!user || !user.password || !(await bcrypt.compare(passIn, user.password))) {
                return res.status(401).json({ success: false, error: "Fel uppgifter eller saknar lösenord" });
            }
            
            const tokenPayload = { id: user.id, username: user.username, role: user.role, workplaceId: user.workplace_id };
            const signedToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
            const name = user.first_name ? `${user.first_name} ${user.last_name||''}` : user.username;
            
            return res.status(200).json({ success: true, token: signedToken, user: user.username, name, role: user.role });
        }

        // --- SÄKERHETSSPÄRR FÖR ÄNDRINGAR ---
        if (currentUserRole !== 'admin') {
            return res.status(403).json({ error: "Endast administratörer får göra ändringar." });
        }

        // --- PERSONALHANTERING ---
        if (action === 'quick_add_user') {
            if (!fullName) return res.status(400).json({ error: "Namn saknas" });
            const parts = fullName.trim().split(' ');
            const first = parts[0];
            const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
            const tempUsername = 'user_' + Date.now();
            await pool.query(
                'INSERT INTO admin_users (username, first_name, last_name, role, workplace_id) VALUES ($1, $2, $3, $4, $5)', 
                [tempUsername, first, last, 'user', currentWorkplace]
            );
            return res.status(200).json({ success: true });
        }

        if (action === 'remove_user') {
            if (!fullName) return res.status(400).json({ error: "Namn saknas" });
            await pool.query(
                "DELETE FROM admin_users WHERE TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) = $1 AND workplace_id = $2", 
                [fullName.trim(), currentWorkplace]
            );
            return res.status(200).json({ success: true });
        }

        if (action === 'add_admin') {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            await pool.query(
                'INSERT INTO admin_users (username, password, first_name, last_name, email, role, workplace_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', 
                [username, hashedPassword, firstName, lastName, email, role || 'user', currentWorkplace]
            );
            return res.status(200).json({ success: true });
        }

        if (action === 'edit_admin') {
            if (password && password.trim() !== "") {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(password, salt);
                await pool.query(
                    'UPDATE admin_users SET username=$1, password=$2, first_name=$3, last_name=$4, email=$5, role=$6 WHERE id=$7 AND workplace_id=$8',
                    [username, hashedPassword, firstName, lastName, email, role || 'user', id, currentWorkplace]
                );
            } else {
                await pool.query(
                    'UPDATE admin_users SET username=$1, first_name=$2, last_name=$3, email=$4, role=$5 WHERE id=$6 AND workplace_id=$7',
                    [username, firstName, lastName, email, role || 'user', id, currentWorkplace]
                );
            }
            return res.status(200).json({ success: true });
        }

        if (action === 'remove_admin') {
            await pool.query('DELETE FROM admin_users WHERE username = $1 AND workplace_id = $2', [username, currentWorkplace]);
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

        // --- SCHEMALÄGGNING ---
        if (action === 'assign_shift') {
            await pool.query(`
                INSERT INTO schedule_assignments (work_date, user_id, station_id, shift_id, is_published)
                VALUES ($1, $2, $3, $4, false)
                ON CONFLICT (work_date, user_id, station_id, shift_id) DO NOTHING
            `, [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
            return res.status(200).json({ success: true });
        }

        if (action === 'remove_shift') {
            await pool.query(`
                DELETE FROM schedule_assignments 
                WHERE work_date=$1 AND user_id=$2 AND station_id=$3 AND shift_id=$4
            `, [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
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

        // --- LEGACY INSTÄLLNINGAR (Väder, Teman) ---
        if (type && data) {
            await pool.query('DELETE FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, currentWorkplace]);
            await pool.query('INSERT INTO app_storage (key, data, workplace_id) VALUES ($1, $2, $3)', [type, JSON.stringify(data), currentWorkplace]);
            return res.status(200).json({ success: true });
        }
    }
    
    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) { 
      console.error(error);
      return res.status(500).json({ error: error.message }); 
  }
}

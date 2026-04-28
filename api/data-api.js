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

        const result = await pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, currentWorkplace]);
        return res.status(200).json(result.rows.length > 0 ? result.rows[0].data : {});
    }

    if (req.method === 'POST') {
        const { action, payload, type, data, username, password, fullName, id, firstName, lastName, displayName, email, role } = req.body;

        if (action === 'login') {
            const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username || payload?.username]);
            const user = result.rows[0];
            if (!user || !user.password || !(await bcrypt.compare(password || payload?.password, user.password))) {
                return res.status(401).json({ success: false, error: "Fel uppgifter" });
            }
            const signedToken = jwt.sign({ id: user.id, username: user.username, role: user.role, workplaceId: user.workplace_id }, JWT_SECRET, { expiresIn: '24h' });
            return res.status(200).json({ success: true, token: signedToken, name: user.display_name || user.first_name || user.username, role: user.role });
        }

        if (currentUserRole !== 'admin') return res.status(403).json({ error: "Behörighet saknas" });


if (action === 'quick_add_user') {
    if (!fullName) return res.status(400).json({ error: "Namn saknas" });
    
    // Skapa ett tillfälligt unikt användarnamn (t.ex. user_1714392000)
    const tempUsername = 'user_' + Date.now();
    
    try {
        await pool.query(
            'INSERT INTO admin_users (username, display_name, role, workplace_id) VALUES ($1, $2, $3, $4)', 
            [tempUsername, fullName.trim(), 'user', currentWorkplace]
        );
        return res.status(200).json({ success: true });
    } catch (e) {
        console.error("Quick add error:", e);
        return res.status(500).json({ error: "Kunde inte spara till databasen" });
    }
}

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

        // ... radering av user/admin, spara stationer/pass etc (samma som tidigare)
        if (action === 'remove_user') {
            await pool.query("DELETE FROM admin_users WHERE (display_name = $1 OR username = $1) AND workplace_id = $2", [fullName.trim(), currentWorkplace]);
            return res.status(200).json({ success: true });
        }
        
        if (action === 'assign_shift') {
            await pool.query('INSERT INTO schedule_assignments (work_date, user_id, station_id, shift_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', 
                [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
            return res.status(200).json({ success: true });
        }

        if (action === 'remove_shift') {
            await pool.query('DELETE FROM schedule_assignments WHERE work_date=$1 AND user_id=$2 AND station_id=$3 AND shift_id=$4', 
                [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
            return res.status(200).json({ success: true });
        }
    }
    return res.status(405).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

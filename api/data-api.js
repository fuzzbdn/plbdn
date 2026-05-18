import pg from 'pg';
const { Pool } = pg;
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET;
const SECRET_DISPLAY_KEY = process.env.DISPLAY_SECRET;
const resend = new Resend(process.env.RESEND_API_KEY);

function handleDatabaseError(res, error) {
    console.error("Databasfel:", error);
    if (error.code === '23505') {
        return res.status(400).json({ success: false, error: "Detta värde (t.ex. användarnamn) finns redan." });
    }
    return res.status(500).json({ success: false, error: "Ett internt serverfel uppstod." });
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-workplace-id');

    if (req.method === 'OPTIONS') { return res.status(200).end(); }

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

                if (currentUserRole === 'superadmin' && req.headers['x-workplace-id']) {
                    currentWorkplace = req.headers['x-workplace-id'];
                }
            } catch (err) { /* Ogiltig token */ }
        }

        if (req.query.display_token === SECRET_DISPLAY_KEY) {
            isAuthorized = true;
            currentWorkplace = req.query.workplace || 'default'; 
        }

        if (req.method === 'GET') {
            const { type, start_date, end_date } = req.query;

            if (!isAuthorized && !['settings', 'custom_themes'].includes(type)) {
                return res.status(401).json({ error: "Åtkomst nekad." });
            }

            switch (type) {
                case 'workplaces':
                    if (currentUserRole !== 'superadmin') return res.status(403).json({ error: "Obehörig" });
                    const wpRes = await pool.query('SELECT * FROM workplaces ORDER BY name ASC');
                    return res.status(200).json(wpRes.rows);

                case 'users':
                case 'admins':
                    const roleFilter = type === 'users' ? "AND (role != 'superadmin' OR role IS NULL)" : "";
                    const usersRes = await pool.query(
                        `SELECT id, username, first_name, last_name, display_name, email, role 
                         FROM admin_users WHERE workplace_id = $1 ${roleFilter}
                         ORDER BY COALESCE(display_name, first_name, username) ASC`, [currentWorkplace]
                    );
                    return res.status(200).json(usersRes.rows);

                case 'absences':
                    const absRes = await pool.query(`
                        SELECT a.*, u.first_name, u.last_name, u.display_name FROM absences a 
                        JOIN admin_users u ON a.user_id = u.id 
                        WHERE a.workplace_id = $1 ORDER BY a.start_date DESC`, [currentWorkplace]
                    );
                    return res.status(200).json(absRes.rows);

                case 'stations':
                    const statRes = await pool.query('SELECT * FROM stations WHERE workplace_id = $1 ORDER BY sort_order ASC', [currentWorkplace]);
                    return res.status(200).json(statRes.rows);

                case 'shifts':
                    const shiftRes = await pool.query('SELECT * FROM shifts WHERE workplace_id = $1 ORDER BY sort_order ASC', [currentWorkplace]);
                    return res.status(200).json(shiftRes.rows);

                case 'schedule':
                    if(!start_date || !end_date) return res.status(400).json({error: "Saknar datum"});
                    const schedRes = await pool.query(`
                        SELECT sa.id, sa.work_date, sa.user_id, sa.station_id, sa.shift_id, sa.is_published,
                               u.first_name, u.last_name, u.display_name
                        FROM schedule_assignments sa
                        JOIN admin_users u ON sa.user_id = u.id
                        JOIN stations s ON sa.station_id = s.id
                        WHERE s.workplace_id = $1 AND sa.work_date >= $2 AND sa.work_date <= $3
                        ORDER BY sa.id ASC`, [currentWorkplace, start_date, end_date]
                    );
                    return res.status(200).json(schedRes.rows);

                default:
                    const storeRes = await pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, currentWorkplace]);
                    return res.status(200).json(storeRes.rows.length > 0 ? storeRes.rows[0].data : {});
            }
        }

        if (req.method === 'POST') {
            const { action, payload, type, data, username, password, fullName, id, firstName, lastName, displayName, email, role, token: tokenBody, newPassword } = req.body;

            switch (action) {
                case 'login':
                    const userRes = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username || payload?.username]);
                    const user = userRes.rows[0];
                    if (!user || !user.password || !(await bcrypt.compare(password || payload?.password, user.password))) {
                        return res.status(401).json({ success: false, error: "Fel uppgifter" });
                    }
                    const signedToken = jwt.sign({ id: user.id, username: user.username, role: user.role, workplaceId: user.workplace_id }, JWT_SECRET, { expiresIn: '24h' });
                    return res.status(200).json({ success: true, token: signedToken, userId: user.id, name: user.display_name || user.first_name || user.username, role: user.role });

                case 'request_reset':
                    if (!email) return res.status(400).json({ error: "E-post saknas" });
                    const emailRes = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email]);
                    const resetUser = emailRes.rows[0];
                    if (!resetUser) return res.status(200).json({ success: true, message: "Länk skickad (om e-posten finns)." });

                    const resetToken = jwt.sign({ id: resetUser.id, purpose: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
                    const protocol = req.headers.host.includes('localhost') ? 'http' : 'https';
                    const resetLink = `${protocol}://${req.headers.host}/reset.html?token=${resetToken}`;
                    
                    try {
                        await resend.emails.send({
                            from: 'STRUL <losen@info.strulapp.se>', 
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
                                </div>
                            `
                        });
                    } catch (mailError) {
                        console.error("Kunde inte skicka mail via Resend:", mailError);
                    }
                    return res.status(200).json({ success: true });

                case 'perform_reset':
                    if (!tokenBody || !newPassword) return res.status(400).json({ error: "Saknar data" });
                    const decoded = jwt.verify(tokenBody, JWT_SECRET);
                    if (decoded.purpose !== 'reset') return res.status(400).json({ error: "Ogiltig token typ" });
                    const hashedPassword = await bcrypt.hash(newPassword, 10);
                    await pool.query('UPDATE admin_users SET password = $1 WHERE id = $2', [hashedPassword, decoded.id]);
                    return res.status(200).json({ success: true });
            }

            if (currentUserRole !== 'admin' && currentUserRole !== 'superadmin') {
                return res.status(403).json({ error: "Behörighet saknas" });
            }

            switch (action) {
                case 'save_absence':
                    if (!payload || !payload.user_id || !payload.start_date || !payload.end_date) {
                        return res.status(400).json({ error: "Saknar nödvändig data för frånvaro" });
                    }
                    const client = await pool.connect(); 
                    try {
                        await client.query('BEGIN'); 
                        await client.query(
                            'INSERT INTO absences (user_id, start_date, end_date, type, workplace_id) VALUES ($1, $2, $3, $4, $5)',
                            [payload.user_id, payload.start_date, payload.end_date, payload.type, currentWorkplace]
                        );
                        await client.query(`
                            DELETE FROM schedule_assignments 
                            WHERE user_id = $1 AND work_date >= $2 AND work_date <= $3 
                            AND station_id IN (SELECT id FROM stations WHERE workplace_id = $4)
                        `, [payload.user_id, payload.start_date, payload.end_date, currentWorkplace]);
                        await client.query('COMMIT'); 
                        return res.status(200).json({ success: true });
                    } catch (err) {
                        await client.query('ROLLBACK'); 
                        throw err; 
                    } finally {
                        client.release(); 
                    }

                case 'reorder_stations':
                    if (!Array.isArray(payload)) return res.status(400).json({ error: "Payload måste vara en array" });
                    const stationQueries = payload.map((statId, i) => 
                        pool.query('UPDATE stations SET sort_order=$1 WHERE id=$2 AND workplace_id=$3', [i, statId, currentWorkplace])
                    );
                    await Promise.all(stationQueries);
                    return res.status(200).json({ success: true });

                case 'reorder_shifts':
                    if (!Array.isArray(payload)) return res.status(400).json({ error: "Payload måste vara en array" });
                    const shiftQueries = payload.map((shiftId, i) => 
                        pool.query('UPDATE shifts SET sort_order=$1 WHERE id=$2 AND workplace_id=$3', [i, shiftId, currentWorkplace])
                    );
                    await Promise.all(shiftQueries);
                    return res.status(200).json({ success: true });

                case 'delete_absence':
                    await pool.query('DELETE FROM absences WHERE id = $1 AND workplace_id = $2', [payload.id, currentWorkplace]);
                    return res.status(200).json({ success: true });

                case 'save_workplace':
                    if (currentUserRole !== 'superadmin') return res.status(403).json({ error: "Kräver superadmin" });
                    if (payload.is_new) {
                        await pool.query('INSERT INTO workplaces (id, name) VALUES ($1, $2)', [Date.now().toString(), payload.name]);
                    } else {
                        await pool.query('UPDATE workplaces SET name=$1 WHERE id=$2', [payload.name, payload.id]);
                    }
                    return res.status(200).json({ success: true });

                case 'quick_add_user':
                    const nameToAdd = payload?.fullName || fullName;
                    if (!nameToAdd) return res.status(400).json({ error: "Namn saknas" });
                    const parts = nameToAdd.trim().split(' ');
                    await pool.query('INSERT INTO admin_users (username, first_name, last_name, display_name, role, workplace_id) VALUES ($1, $2, $3, $4, $5, $6)', 
                        ['user_' + Date.now(), parts[0], parts.slice(1).join(' '), nameToAdd.trim(), 'user', currentWorkplace]);
                    return res.status(200).json({ success: true });

                case 'remove_user':
                    const nameToRemove = payload?.fullName || fullName;
                    await pool.query(`DELETE FROM admin_users WHERE (display_name = $1 OR TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) = $1 OR username = $1) AND workplace_id = $2`, [nameToRemove.trim(), currentWorkplace]);
                    return res.status(200).json({ success: true });

                case 'add_admin':
                    if (role === 'superadmin' && currentUserRole !== 'superadmin') {
                        return res.status(403).json({ error: "Endast en Super-Admin kan skapa andra Super-Admin-konton." });
                    }
                    
                    let newHashedPass = null; 
                    if (password && password.trim().length >= 6) {
                        newHashedPass = await bcrypt.hash(password, 10);
                    } else if (password && password.trim().length > 0 && password.trim().length < 6) {
                        return res.status(400).json({ error: "Lösenordet måste vara minst 6 tecken långt om det anges." });
                    }

                    await pool.query('INSERT INTO admin_users (username, password, first_name, last_name, display_name, email, role, workplace_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', 
                        [username, newHashedPass, firstName || displayName || username, lastName, displayName, email, role, currentWorkplace]);
                    return res.status(200).json({ success: true });

                case 'edit_admin':
                    if (role === 'superadmin' && currentUserRole !== 'superadmin') {
                        return res.status(403).json({ error: "Endast en Super-Admin kan tilldela Super-Admin-rollen." });
                    }

                    const safeFirstName = firstName || displayName || username;
                    if (password && password.trim() !== "") {
                        if (password.trim().length < 6) return res.status(400).json({ error: "Lösenordet måste vara minst 6 tecken långt." });
                        const updatedHash = await bcrypt.hash(password, 10);
                        await pool.query('UPDATE admin_users SET username=$1, password=$2, first_name=$3, last_name=$4, display_name=$5, email=$6, role=$7 WHERE id=$8 AND workplace_id=$9',
                            [username, updatedHash, safeFirstName, lastName, displayName, email, role, id, currentWorkplace]);
                    } else {
                        await pool.query('UPDATE admin_users SET username=$1, first_name=$2, last_name=$3, display_name=$4, email=$5, role=$6 WHERE id=$7 AND workplace_id=$8',
                            [username, safeFirstName, lastName, displayName, email, role, id, currentWorkplace]);
                    }
                    return res.status(200).json({ success: true });

                case 'remove_admin':
                    await pool.query('DELETE FROM admin_users WHERE username = $1 AND workplace_id = $2', [username, currentWorkplace]);
                    return res.status(200).json({ success: true });

                case 'assign_shift':
                    await pool.query(`INSERT INTO schedule_assignments (work_date, user_id, station_id, shift_id, is_published) VALUES ($1, $2, $3, $4, false) ON CONFLICT DO NOTHING`, 
                        [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
                    return res.status(200).json({ success: true });

                case 'remove_shift':
                    await pool.query('DELETE FROM schedule_assignments WHERE work_date=$1 AND user_id=$2 AND station_id=$3 AND shift_id=$4', 
                        [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
                    return res.status(200).json({ success: true });

                case 'publish_schedule':
                    await pool.query(`UPDATE schedule_assignments sa SET is_published = true FROM stations s WHERE sa.station_id = s.id AND s.workplace_id = $1 AND sa.work_date >= $2 AND sa.work_date <= $3`, 
                        [currentWorkplace, payload.start_date, payload.end_date]);
                    return res.status(200).json({ success: true });

                case 'save_station':
                    if (payload.id) {
                        await pool.query('UPDATE stations SET name=$1, color=$2, is_spacer=$3 WHERE id=$4 AND workplace_id=$5', [payload.name, payload.color, payload.is_spacer, payload.id, currentWorkplace]);
                    } else {
                        await pool.query('INSERT INTO stations (workplace_id, name, color, is_spacer, sort_order) VALUES ($1, $2, $3, $4, 99)', [currentWorkplace, payload.name, payload.color, payload.is_spacer]);
                    }
                    return res.status(200).json({ success: true });

                case 'save_shift':
                    if (payload.id) {
                        await pool.query('UPDATE shifts SET label=$1, time_range=$2 WHERE id=$3 AND workplace_id=$4', [payload.label, payload.time_range, payload.id, currentWorkplace]);
                    } else {
                        await pool.query('INSERT INTO shifts (workplace_id, label, time_range, sort_order) VALUES ($1, $2, $3, 99)', [currentWorkplace, payload.label, payload.time_range]);
                    }
                    return res.status(200).json({ success: true });

                case 'delete_station':
                    await pool.query('DELETE FROM stations WHERE id=$1 AND workplace_id=$2', [payload.id, currentWorkplace]);
                    return res.status(200).json({ success: true });

                case 'delete_shift':
                    await pool.query('DELETE FROM shifts WHERE id=$1 AND workplace_id=$2', [payload.id, currentWorkplace]);
                    return res.status(200).json({ success: true });
            }

            // SÄKERHET: Vitlista för lagringsnycklar så att ingen kan skriva över kritisk data
            if (type && data) {
                const allowedStorageKeys = ['settings', 'message', 'custom_themes', 'weather_config'];
                if (!allowedStorageKeys.includes(type)) {
                    return res.status(400).json({ error: "Ogiltig datatyp för lagring" });
                }
                
                await pool.query('DELETE FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, currentWorkplace]);
                await pool.query('INSERT INTO app_storage (key, data, workplace_id) VALUES ($1, $2, $3)', [type, JSON.stringify(data), currentWorkplace]);
                return res.status(200).json({ success: true });
            }
        }
        
        return res.status(405).end(); 

    } catch (e) { 
        return handleDatabaseError(res, e);
    }
}

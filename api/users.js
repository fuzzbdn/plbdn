import bcrypt from 'bcryptjs';
import { pool, authenticate, handleDatabaseError, setupCors } from './_shared.js';

export default async function handler(req, res) {
    setupCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const auth = authenticate(req);
    if (!auth.isAuthorized) return res.status(401).json({ error: "Åtkomst nekad." });

    try {
        if (req.method === 'GET') {
            const { type } = req.query;
            res.setHeader('Cache-Control', 'no-store, max-age=0');

            if (type === 'users' || type === 'admins') {
                let roleFilter = "";
                // Dölj alltid superadmin i den vanliga personal-listan.
                // Om en vanlig admin begär admin-listan ska superadmins också döljas.
                if (type === 'users' || (type === 'admins' && auth.role !== 'superadmin')) {
                    roleFilter = "AND (role != 'superadmin' OR role IS NULL)";
                }

                const usersRes = await pool.query(
                    `SELECT id, username, first_name, last_name, display_name, email, role, (password IS NOT NULL) AS has_password 
                     FROM admin_users WHERE workplace_id = $1 ${roleFilter}
                     ORDER BY COALESCE(display_name, first_name, username) ASC`, 
                     [auth.workplace]
                );
                return res.status(200).json(usersRes.rows);
            }
            return res.status(400).json({ error: "Ogiltig GET-typ för users" });
        }

        if (req.method === 'POST') {
            if (auth.role !== 'admin' && auth.role !== 'superadmin') {
                return res.status(403).json({ error: "Behörighet saknas" });
            }

            const { action, payload } = req.body;
            
            // Extrahera variablerna från payload (fallback till req.body ifall äldre anrop görs)
            const data = payload || req.body;
            const { username, password, fullName, id, firstName, lastName, displayName, email, role } = data;

            switch (action) {
                case 'quick_add_user':
                    const nameToAdd = data.fullName || fullName;
                    if (!nameToAdd) return res.status(400).json({ error: "Namn saknas" });
                    const parts = nameToAdd.trim().split(' ');
                    await pool.query('INSERT INTO admin_users (username, first_name, last_name, display_name, role, workplace_id) VALUES ($1, $2, $3, $4, $5, $6)', 
                        ['user_' + Date.now(), parts[0], parts.slice(1).join(' '), nameToAdd.trim(), 'user', auth.workplace]);
                    return res.status(200).json({ success: true });

                case 'remove_user':
                    // Radera via unikt ID istället för Namn (hindrar att fel person tas bort vid dubbla namn)
                    const targetId = data.id;
                    if (!targetId) return res.status(400).json({ error: "ID saknas" });

                    // Säkerhetskontroll: hämta roll och lösenord
                    const checkRes = await pool.query('SELECT role, password FROM admin_users WHERE id = $1 AND workplace_id = $2', [targetId, auth.workplace]);
                    if (checkRes.rows.length > 0) {
                        const targetUser = checkRes.rows[0];
                        
                        // Skydd mot att vanliga admins tar bort superadmins
                        if (auth.role !== 'superadmin' && targetUser.role === 'superadmin') {
                            return res.status(403).json({ error: "Du kan inte ta bort ett superadmin-konto." });
                        }
                        
                        // Skydd: Användare med lösenord kan inte tas bort från sidomenyn
                        if (targetUser.password !== null) {
                            return res.status(403).json({ error: "Konto med lösenord kan endast raderas från Inställningar > Användare & Konton." });
                        }
                    }

                    await pool.query(`DELETE FROM admin_users WHERE id = $1 AND workplace_id = $2`, [targetId, auth.workplace]);
                    return res.status(200).json({ success: true });

                case 'add_admin':
                    if (role === 'superadmin' && auth.role !== 'superadmin') {
                        return res.status(403).json({ error: "Endast en Super-Admin kan skapa andra Super-Admin-konton." });
                    }
                    
                    let newHashedPass = null; 
                    if (password && password.trim().length >= 6) {
                        newHashedPass = await bcrypt.hash(password, 10);
                    } else if (password && password.trim().length > 0 && password.trim().length < 6) {
                        return res.status(400).json({ error: "Lösenordet måste vara minst 6 tecken långt om det anges." });
                    }

                    await pool.query('INSERT INTO admin_users (username, password, first_name, last_name, display_name, email, role, workplace_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', 
                        [username, newHashedPass, firstName || displayName || username, lastName, displayName, email, role, auth.workplace]);
                    return res.status(200).json({ success: true });

                case 'edit_admin':
                    if (role === 'superadmin' && auth.role !== 'superadmin') {
                        return res.status(403).json({ error: "Endast en Super-Admin kan tilldela Super-Admin-rollen." });
                    }

                    // Säkerhetsfix: Kontrollera vilken roll användaren SOM REDIGERAS har just nu i databasen
                    if (auth.role !== 'superadmin') {
                        const targetRes = await pool.query('SELECT role FROM admin_users WHERE id = $1 AND workplace_id = $2', [id, auth.workplace]);
                        if (targetRes.rows.length > 0 && targetRes.rows[0].role === 'superadmin') {
                            return res.status(403).json({ error: "Du har inte behörighet att redigera ett superadmin-konto." });
                        }
                    }

                    const safeFirstName = firstName || displayName || username;
                    if (password && password.trim() !== "") {
                        if (password.trim().length < 6) return res.status(400).json({ error: "Lösenordet måste vara minst 6 tecken långt." });
                        const updatedHash = await bcrypt.hash(password, 10);
                        await pool.query('UPDATE admin_users SET username=$1, password=$2, first_name=$3, last_name=$4, display_name=$5, email=$6, role=$7 WHERE id=$8 AND workplace_id=$9',
                            [username, updatedHash, safeFirstName, lastName, displayName, email, role, id, auth.workplace]);
                    } else {
                        await pool.query('UPDATE admin_users SET username=$1, first_name=$2, last_name=$3, display_name=$4, email=$5, role=$6 WHERE id=$7 AND workplace_id=$8',
                            [username, safeFirstName, lastName, displayName, email, role, id, auth.workplace]);
                    }
                    return res.status(200).json({ success: true });

                case 'remove_admin':
                    // Säkerhetsfix: Samma skydd i admin-borttagningen
                    if (auth.role !== 'superadmin') {
                        const checkAdminRes = await pool.query('SELECT role FROM admin_users WHERE username = $1 AND workplace_id = $2', [username, auth.workplace]);
                        if (checkAdminRes.rows.length > 0 && checkAdminRes.rows[0].role === 'superadmin') {
                            return res.status(403).json({ error: "Du kan inte ta bort ett superadmin-konto." });
                        }
                    }
                    await pool.query('DELETE FROM admin_users WHERE username = $1 AND workplace_id = $2', [username, auth.workplace]);
                    return res.status(200).json({ success: true });

                default:
                    return res.status(400).json({ error: "Okänd action för users" });
            }
        }
        
        return res.status(405).end();
    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

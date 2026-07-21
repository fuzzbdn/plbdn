// ============================================================================
// API/USERS.JS
// Hanterar all CRUD för användarkonton (personal och admins).
//
// Endpoints:
//   GET  ?type=users   → Hämtar alla icke-superadmin-användare för arbetsplatsen
//   GET  ?type=admins  → Hämtar alla användare (superadmin ser även superadmins)
//   POST action=quick_add_user → Skapar ett enkelt användarkonto utan lösenord
//   POST action=remove_user    → Tar bort användare utan lösenord (från sidopanelen)
//   POST action=add_admin      → Skapar ett fullständigt konto med lösenord och roll
//   POST action=edit_admin     → Redigerar ett befintligt konto
//   POST action=remove_admin   → Tar bort ett konto permanent (från inställningar)
// ============================================================================
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, authenticate, handleDatabaseError, setupCors } from './_shared.js';

export default async function handler(req, res) {
    // --- Grundläggande inställningar ---
    setupCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Verifiera att användaren är inloggad via JWT-cookie
    const auth = authenticate(req);
    if (!auth.isAuthorized) return res.status(401).json({ error: "Åtkomst nekad." });

    try {

        // ========================================================================
        // GET — Hämta användarlista
        // ========================================================================
        if (req.method === 'GET') {
            const { type } = req.query;

            // Förhindra att webbläsaren cachar användarlistan
            res.setHeader('Cache-Control', 'no-store, max-age=0');

            if (type === 'users' || type === 'admins') {
                // Superadmins är dolda för vanliga admins — de syns bara för sig själva
                let roleFilter = "";
                if (type === 'users' || (type === 'admins' && auth.role !== 'superadmin')) {
                    roleFilter = "AND (role != 'superadmin' OR role IS NULL)";
                }

                const usersRes = await pool.query(
                    `SELECT id, username, first_name, last_name, display_name, email, role,
                            (password IS NOT NULL) AS has_password 
                     FROM admin_users 
                     WHERE workplace_id = $1 ${roleFilter}
                     ORDER BY COALESCE(display_name, first_name, username) ASC`,
                    [auth.workplace]
                );
                return res.status(200).json(usersRes.rows);
            }

            return res.status(400).json({ error: "Ogiltig GET-typ för users" });
        }


        // ========================================================================
        // POST — Skapa, redigera eller ta bort användare
        // ========================================================================
        if (req.method === 'POST') {

            // Endast admins och superadmins får ändra användare
            if (auth.role !== 'admin' && auth.role !== 'superadmin') {
                return res.status(403).json({ error: "Behörighet saknas" });
            }

            const { action, payload } = req.body;

            // Normalisera: stöd både { action, payload } och flat body för bakåtkompatibilitet
            const data = payload || req.body;
            const { username, password, id, firstName, lastName, displayName, email, role } = data;

            switch (action) {


                // ----------------------------------------------------------------
                // Snabb-lägg till en person utan lösenord (från sidopanelen i admin)
                // ----------------------------------------------------------------
                case 'quick_add_user': {
                    const nameToAdd = data.fullName;
                    if (!nameToAdd || !nameToAdd.trim()) {
                        return res.status(400).json({ error: "Namn saknas" });
                    }

                    const parts = nameToAdd.trim().split(' ');

                    // Generera ett unikt internt användarnamn — syns aldrig för användaren
                    const uniqueUsername = 'user_' + crypto.randomUUID();

                    await pool.query(
                        `INSERT INTO admin_users 
                            (username, first_name, last_name, display_name, role, workplace_id)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            uniqueUsername,
                            parts[0],
                            parts.slice(1).join(' '),   // Resten av orden blir efternamnet
                            nameToAdd.trim(),
                            'user',
                            auth.workplace
                        ]
                    );
                    return res.status(200).json({ success: true });
                }


                // ----------------------------------------------------------------
                // Ta bort en person utan lösenord (krysset i sidopanelen)
                // Konton med lösenord kräver att man går via Inställningar.
                // ----------------------------------------------------------------
                case 'remove_user': {
                    const targetId = data.id;
                    if (!targetId) return res.status(400).json({ error: "ID saknas" });

                    // Verifiera att kontot faktiskt finns och tillhör arbetsplatsen
                    const checkRes = await pool.query(
                        'SELECT role, password FROM admin_users WHERE id = $1 AND workplace_id = $2',
                        [targetId, auth.workplace]
                    );

                    if (checkRes.rows.length === 0) {
                        return res.status(404).json({ error: "Användaren hittades inte." });
                    }

                    const targetUser = checkRes.rows[0];

                    // Bara superadmin kan ta bort superadmin-konton
                    if (auth.role !== 'superadmin' && targetUser.role === 'superadmin') {
                        return res.status(403).json({ error: "Du kan inte ta bort ett superadmin-konto." });
                    }

                    // Konton med lösenord tas bort via Inställningar > Användare & Konton
                    // för att förhindra att admins av misstag raderar inloggningskonton
                    if (targetUser.password !== null) {
                        return res.status(403).json({
                            error: "Konto med lösenord kan endast raderas från Inställningar > Användare & Konton."
                        });
                    }

                    await pool.query(
                        'DELETE FROM admin_users WHERE id = $1 AND workplace_id = $2',
                        [targetId, auth.workplace]
                    );
                    return res.status(200).json({ success: true });
                }


                // ----------------------------------------------------------------
                // Skapa ett nytt fullständigt konto (admin, user eller superadmin)
                // ----------------------------------------------------------------
                case 'add_admin': {
                    if (!username || !username.trim()) {
                        return res.status(400).json({ error: "Användarnamn saknas." });
                    }

                    // Bara superadmin får skapa superadmin-konton
                    if (role === 'superadmin' && auth.role !== 'superadmin') {
                        return res.status(403).json({
                            error: "Endast en Super-Admin kan skapa andra Super-Admin-konton."
                        });
                    }

                    // Lösenordet är valfritt (personen kan sakna inloggning)
                    // men om det anges måste det vara minst 6 tecken
                    let newHashedPass = null;
                    const passwordStr = password ? String(password) : '';
                    if (passwordStr.trim().length >= 6) {
                        newHashedPass = await bcrypt.hash(passwordStr.trim(), 10);
                    } else if (passwordStr.trim().length > 0 && passwordStr.trim().length < 6) {
                        return res.status(400).json({
                            error: "Lösenordet måste vara minst 6 tecken långt om det anges."
                        });
                    }

                    // Fallback-hierarki för förnamn om inga namnfält är ifyllda
                    const addFirstName = firstName || displayName || username.trim();

                    await pool.query(
                        `INSERT INTO admin_users 
                            (username, password, first_name, last_name, display_name, email, role, workplace_id)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [
                            username.trim(),
                            newHashedPass,
                            addFirstName,
                            lastName,
                            displayName,
                            email,
                            role,
                            auth.workplace
                        ]
                    );
                    return res.status(200).json({ success: true });
                }


                // ----------------------------------------------------------------
                // Redigera ett befintligt konto
                // ----------------------------------------------------------------
                case 'edit_admin': {
                    if (!id) return res.status(400).json({ error: "ID saknas." });

                    // Kontrollera rollbehörighet innan något annat görs
                    if (role === 'superadmin' && auth.role !== 'superadmin') {
                        return res.status(403).json({
                            error: "Endast en Super-Admin kan tilldela Super-Admin-rollen."
                        });
                    }

                    // En vanlig admin får inte redigera superadmin-konton
                    if (auth.role !== 'superadmin') {
                        const targetRes = await pool.query(
                            'SELECT role FROM admin_users WHERE id = $1 AND workplace_id = $2',
                            [id, auth.workplace]
                        );
                        if (targetRes.rows.length === 0) {
                            return res.status(404).json({ error: "Användaren hittades inte." });
                        }
                        if (targetRes.rows[0].role === 'superadmin') {
                            return res.status(403).json({
                                error: "Du har inte behörighet att redigera ett superadmin-konto."
                            });
                        }
                    }

                    // Minst ett namnfält krävs — annars vet vi inte vad personen heter
                    const safeFirstName = firstName || displayName || (username && username.trim());
                    if (!safeFirstName) {
                        return res.status(400).json({
                            error: "Förnamn eller visningsnamn måste anges."
                        });
                    }

                    // Om ett nytt lösenord anges — validera och hasha det
                        const passwordStr = password ? String(password) : '';
                        if (passwordStr.trim() !== "") {
                            if (passwordStr.trim().length < 6) {
                            return res.status(400).json({
                                error: "Lösenordet måste vara minst 6 tecken långt."
                            });
                        }
                        const updatedHash = await bcrypt.hash(passwordStr.trim(), 10);
                        await pool.query(
                            `UPDATE admin_users 
                             SET username=$1, password=$2, first_name=$3, last_name=$4,
                                 display_name=$5, email=$6, role=$7
                             WHERE id=$8 AND workplace_id=$9`,
                            [username, updatedHash, safeFirstName, lastName, displayName, email, role, id, auth.workplace]
                        );
                    } else {
                        // Inget nytt lösenord — behåll det befintliga
                        await pool.query(
                            `UPDATE admin_users 
                             SET username=$1, first_name=$2, last_name=$3,
                                 display_name=$4, email=$5, role=$6
                             WHERE id=$7 AND workplace_id=$8`,
                            [username, safeFirstName, lastName, displayName, email, role, id, auth.workplace]
                        );
                    }
                    return res.status(200).json({ success: true });
                }


                // ----------------------------------------------------------------
                // Ta bort ett konto permanent via Inställningar > Användare & Konton
                //
                // BUGGFIX: Tidigare skickade frontend username som identifierare,
                // vilket innebär att fel konto kunde raderas om två personer hade
                // samma användarnamn (möjligt vid snabb-lägg-till).
                // Nu används alltid det unika databas-ID:t (id) istället.
                // ----------------------------------------------------------------
                case 'remove_admin': {
                    // Kräv alltid id — username är INTE tillräckligt unikt
                    if (!id) {
                        return res.status(400).json({
                            error: "ID saknas. Kontakta support om felet kvarstår."
                        });
                    }

                    // En vanlig admin får inte ta bort superadmin-konton
                    if (auth.role !== 'superadmin') {
                        const checkAdminRes = await pool.query(
                            'SELECT role FROM admin_users WHERE id = $1 AND workplace_id = $2',
                            [id, auth.workplace]
                        );
                        if (checkAdminRes.rows.length === 0) {
                            return res.status(404).json({ error: "Användaren hittades inte." });
                        }
                        if (checkAdminRes.rows[0].role === 'superadmin') {
                            return res.status(403).json({
                                error: "Du kan inte ta bort ett superadmin-konto."
                            });
                        }
                    }

                    // Radera på id + workplace_id för att garantera rätt rad
                    // och förhindra att en superadmin råkar radera tvärs arbetsplatser
                    await pool.query(
                        'DELETE FROM admin_users WHERE id = $1 AND workplace_id = $2',
                        [id, auth.workplace]
                    );
                    return res.status(200).json({ success: true });
                }


                default:
                    return res.status(400).json({ error: "Okänd action för users" });
            }
        }

        return res.status(405).end();

    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

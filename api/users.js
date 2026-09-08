/**
 * ============================================================================
 * API / USERS.JS (Backend)
 * Serverlös (Serverless) funktion som hanterar all CRUD-logik mot databasen
 * för användarkonton (både personal och administratörer).
 * Sköter även säkerhet, lösenordshashning (Bcrypt) och roll-validering.
 * ============================================================================
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, authenticate, handleDatabaseError, setupCors } from './_shared.js';

// ==========================================
// 1. HJÄLPFUNKTIONER FÖR DATABASÅTGÄRDER
// ==========================================

/**
 * "Quick Add": Skapar ett snabbt "spökkonto" (enbart namn) utan inloggningsuppgifter.
 * Används när man skriver in ett nytt namn direkt i schemat.
 */
async function handleQuickAddUser(auth, data) {
    const nameToAdd = data?.fullName;
    if (!nameToAdd || !nameToAdd.trim()) return { status: 400, body: { error: "Namn saknas" } };
    
    const parts = nameToAdd.trim().split(' ');
    // Generera ett säkert, unikt fallback-användarnamn
    const uniqueUsername = 'user_' + crypto.randomUUID();
    
    await pool.query(
        `INSERT INTO admin_users (username, first_name, last_name, display_name, role, workplace_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uniqueUsername, parts[0], parts.slice(1).join(' '), nameToAdd.trim(), 'user', auth.workplace]
    );
    
    return { status: 200, body: { success: true } };
}

/**
 * Tar bort ett konto. Innehåller säkerhetsspärrar för att förhindra radering
 * av riktiga konton (de med lösenord) från snabb-gränssnittet i schemat.
 */
async function handleRemoveUser(auth, data) {
    const targetId = data.id;
    if (!targetId) return { status: 400, body: { error: "ID saknas" } };
    
    // Hämta mål-användarens nuvarande status
    const checkRes = await pool.query(
        'SELECT role, password FROM admin_users WHERE id = $1 AND workplace_id = $2',
        [targetId, auth.workplace]
    );
    
    if (checkRes.rows.length === 0) return { status: 404, body: { error: "Användaren hittades inte." } };
    
    const targetUser = checkRes.rows[0];
    
    // Behörighetskontroll: Endast Super-Admins får radera andra Super-Admins
    if (auth.role !== 'superadmin' && targetUser.role === 'superadmin') {
        return { status: 403, body: { error: "Du kan inte ta bort ett superadmin-konto." } };
    }
    
    // Säkerhetsspärr: Konton med lösenord får inte raderas "snabbt" från schemat
    if (targetUser.password !== null) {
        return { status: 403, body: { error: "Konto med lösenord kan endast raderas från Inställningar > Användare & Konton." } };
    }
    
    await pool.query('DELETE FROM admin_users WHERE id = $1 AND workplace_id = $2', [targetId, auth.workplace]);
    return { status: 200, body: { success: true } };
}

/**
 * Skapar ett fullständigt användar/admin-konto inklusive krypterat lösenord.
 */
async function handleAddAdmin(auth, data) {
    const { username, password, firstName, lastName, displayName, email, role } = data;
    
    if (!username || !username.trim()) return { status: 400, body: { error: "Användarnamn saknas." } };
    
    // Behörighetskontroll
    if (role === 'superadmin' && auth.role !== 'superadmin') {
        return { status: 403, body: { error: "Endast en Super-Admin kan skapa andra Super-Admin-konton." } };
    }
    
    let newHashedPass = null;
    const passwordStr = password ? String(password) : '';
    
    // Validera och Hasha (kryptera) lösenordet med Bcrypt
    if (passwordStr.trim().length >= 6) {
        newHashedPass = await bcrypt.hash(passwordStr.trim(), 10);
    } else if (passwordStr.trim().length > 0) {
        return { status: 400, body: { error: "Lösenordet måste vara minst 6 tecken långt om det anges." } };
    }
    
    const addFirstName = firstName || displayName || username?.trim();
    
    await pool.query(
        `INSERT INTO admin_users (username, password, first_name, last_name, display_name, email, role, workplace_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [username.trim(), newHashedPass, addFirstName, lastName, displayName, email, role, auth.workplace]
    );
    
    return { status: 200, body: { success: true } };
}

/**
 * Redigerar en befintlig användare/admin. Uppdaterar endast lösenordet om ett nytt skickas in.
 */
async function handleEditAdmin(auth, data) {
    const { username, password, id, firstName, lastName, displayName, email, role } = data;
    
    if (!id) return { status: 400, body: { error: "ID saknas." } };
    
    // Behörighetskontroller för roller
    if (role === 'superadmin' && auth.role !== 'superadmin') {
        return { status: 403, body: { error: "Endast en Super-Admin kan tilldela Super-Admin-rollen." } };
    }
    
    // Vanliga admins får inte redigera Super-Admins
    if (auth.role !== 'superadmin') {
        const targetRes = await pool.query(
            'SELECT role FROM admin_users WHERE id = $1 AND workplace_id = $2',
            [id, auth.workplace]
        );
        if (targetRes.rows.length === 0) return { status: 404, body: { error: "Användaren hittades inte." } };
        if (targetRes.rows[0].role === 'superadmin') {
            return { status: 403, body: { error: "Du har inte behörighet att redigera ett superadmin-konto." } };
        }
    }
    
    const safeFirstName = firstName || displayName || username?.trim();
    if (!safeFirstName) return { status: 400, body: { error: "Förnamn eller visningsnamn måste anges." } };
    
    const passwordStr = password ? String(password) : '';
    
    // Om administratören valde att byta lösenord
    if (passwordStr.trim() !== "") {
        if (passwordStr.trim().length < 6) {
            return { status: 400, body: { error: "Lösenordet måste vara minst 6 tecken långt." } };
        }
        const updatedHash = await bcrypt.hash(passwordStr.trim(), 10);
        
        await pool.query(
            `UPDATE admin_users SET username=$1, password=$2, first_name=$3, last_name=$4,
             display_name=$5, email=$6, role=$7 WHERE id=$8 AND workplace_id=$9`,
            [username, updatedHash, safeFirstName, lastName, displayName, email, role, id, auth.workplace]
        );
    } 
    // Om lösenordet ska lämnas orört
    else {
        await pool.query(
            `UPDATE admin_users SET username=$1, first_name=$2, last_name=$3,
             display_name=$4, email=$5, role=$6 WHERE id=$7 AND workplace_id=$8`,
            [username, safeFirstName, lastName, displayName, email, role, id, auth.workplace]
        );
    }
    
    return { status: 200, body: { success: true } };
}

/**
 * Radera en admin från fliken "Konton & Användare".
 */
async function handleRemoveAdmin(auth, data) {
    const { id } = data;
    if (!id) return { status: 400, body: { error: "ID saknas. Kontakta support om felet kvarstår." } };
    
    // Vanliga admins får inte radera Super-Admins
    if (auth.role !== 'superadmin') {
        const checkAdminRes = await pool.query(
            'SELECT role FROM admin_users WHERE id = $1 AND workplace_id = $2',
            [id, auth.workplace]
        );
        if (checkAdminRes.rows.length === 0) return { status: 404, body: { error: "Användaren hittades inte." } };
        if (checkAdminRes.rows[0].role === 'superadmin') {
            return { status: 403, body: { error: "Du kan inte ta bort ett superadmin-konto." } };
        }
    }
    
    await pool.query('DELETE FROM admin_users WHERE id = $1 AND workplace_id = $2', [id, auth.workplace]);
    return { status: 200, body: { success: true } };
}

// ==========================================
// 2. HUVUDROUTER (Hanterar inkommande anrop)
// ==========================================

export default async function handler(req, res) {
    // Sätt CORS-headers så webbläsaren tillåter anropet
    setupCors(req, res);
    
    // Svara snabbt på preflight-anrop från webbläsaren
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Verifiera inloggnings-token
    const auth = authenticate(req);
    if (!auth.isAuthorized) return res.status(401).json({ error: "Åtkomst nekad." });

    try {
        // -----------------------------------------------------
        // GET: Hämta lista med användare
        // -----------------------------------------------------
        if (req.method === 'GET') {
            res.setHeader('Cache-Control', 'no-store, max-age=0'); // Förhindra cache-buggar
            
            const { type } = req.query;
            if (type !== 'users' && type !== 'admins') {
                return res.status(400).json({ error: "Ogiltig GET-typ för users" });
            }
            
            let roleFilter = "";
            // Filtrera bort superadmins för vanliga användare/admins
            if (type === 'users' || (type === 'admins' && auth.role !== 'superadmin')) {
                roleFilter = "AND (role != 'superadmin' OR role IS NULL)";
            }
            
            // `has_password` används på klientsidan för att dölja "Kryss/Radera"-knappen i schemat
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

        // -----------------------------------------------------
        // POST: Skapa, Redigera eller Radera användare
        // -----------------------------------------------------
        if (req.method === 'POST') {
            // Säkerställ att bara administratörer får göra ändringar
            if (auth.role !== 'admin' && auth.role !== 'superadmin') {
                return res.status(403).json({ error: "Behörighet saknas" });
            }
            
            const { action, payload } = req.body;
            const data = payload || req.body;

            // Router för olika API-actions
            const actions = {
                quick_add_user: () => handleQuickAddUser(auth, data),
                remove_user:    () => handleRemoveUser(auth, data),
                add_admin:      () => handleAddAdmin(auth, data),
                edit_admin:     () => handleEditAdmin(auth, data),
                remove_admin:   () => handleRemoveAdmin(auth, data),
            };

            if (!actions[action]) return res.status(400).json({ error: "Okänd action för users" });
            
            // Exekvera vald funktion och returnera resultatet till frontend
            const result = await actions[action]();
            return res.status(result.status).json(result.body);
        }

        // Om anropet varken var GET eller POST
        return res.status(405).end();
        
    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

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
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool, authenticate, handleDatabaseError, setupCors } from './_shared.js';

export default async function handler(req, res) {
    setupCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const auth = authenticate(req);
    if (!auth.isAuthorized) return res.status(401).json({ error: "Åtkomst nekad." });

    try {
        if (req.method === 'GET') return handleGet(req, res, auth);
        if (req.method === 'POST') return handlePost(req, res, auth);
        return res.status(405).end();
    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

async function handleGet(req, res, auth) {
    const { type } = req.query;
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (type !== 'users' && type !== 'admins') {
        return res.status(400).json({ error: "Ogiltig GET-typ för users" });
    }

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

async function handlePost(req, res, auth) {
    if (auth.role !== 'admin' && auth.role !== 'superadmin') {
        return res.status(403).json({ error: "Behörighet saknas" });
    }

    const { action, payload } = req.body;

    switch (action) {
        case 'quick_add_user': return quickAddUser(res, auth, payload);
        case 'remove_user':    return removeUser(res, auth, payload);
        case 'add_admin':      return addAdmin(res, auth, payload);
        case 'edit_admin':     return editAdmin(res, auth, payload);
        case 'remove_admin':   return removeAdmin(res, auth, payload);
        default:               return res.status(400).json({ error: "Okänd action för users" });
    }
}

async function quickAddUser(res, auth, payload) {
    const nameToAdd = payload?.fullName;
    if (!nameToAdd?.trim()) {
        return res.status(400).json({ error: "Namn saknas" });
    }

    const parts = nameToAdd.trim().split(' ');
    const uniqueUsername = 'user_' + crypto.randomUUID();

    await pool.query(
        `INSERT INTO admin_users
            (username, first_name, last_name, display_name, role, workplace_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uniqueUsername, parts[0], parts.slice(1).join(' '), nameToAdd.trim(), 'user', auth.workplace]
    );
    return res.status(200).json({ success: true });
}

async function removeUser(res, auth, payload) {
    const targetId = payload?.id;
    if (!targetId) return res.status(400).json({ error: "ID saknas" });

    const checkRes = await pool.query(
        'SELECT role, password FROM admin_users WHERE id = $1 AND workplace_id = $2',
        [targetId, auth.workplace]
    );
    if (checkRes.rows.length === 0) {
        return res.status(404).json({ error: "Användaren hittades inte." });
    }

    const targetUser = checkRes.rows[0];

    if (auth.role !== 'superadmin' && targetUser.role === 'superadmin') {
        return res.status(403).json({ error: "Du kan inte ta bort ett superadmin-konto." });
    }
    if (targetUser.password !== null) {
        return res.status(403).json({
            error: "Konto med lösenord kan endast raderas från Inställningar > Användare & Konton."
        });
    }

    await pool.query('DELETE FROM admin_users WHERE id = $1 AND workplace_id = $2', [targetId, auth.workplace]);
    return res.status(200).json({ success: true });
}

async function addAdmin(res, auth, payload) {
    const { username, password, firstName, lastName, displayName, email, role } = payload || {};

    if (!username?.trim()) {
        return res.status(400).json({ error: "Användarnamn saknas." });
    }
    if (role === 'superadmin' && auth.role !== 'superadmin') {
        return res.status(403).json({ error: "Endast en Super-Admin kan skapa andra Super-Admin-konton." });
    }

    let newHashedPass = null;
    const passwordStr = password ? String(password).trim() : '';
    if (passwordStr.length > 0 && passwordStr.length < 6) {
        return res.status(400).json({ error: "Lösenordet måste vara minst 6 tecken långt om det anges." });
    } else if (passwordStr.length >= 6) {
        newHashedPass = await bcrypt.hash(passwordStr, 10);
    }

    const addFirstName = firstName || displayName || username.trim();

    await pool.query(
        `INSERT INTO admin_users
            (username, password, first_name, last_name, display_name, email, role, workplace_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [username.trim(), newHashedPass, addFirstName, lastName, displayName, email, role, auth.workplace]
    );
    return res.status(200).json({ success: true });
}

async function editAdmin(res, auth, payload) {
    const { id, username, password, firstName, lastName, displayName, email, role } = payload || {};

    if (!id) return res.status(400).json({ error: "ID saknas." });

    if (role === 'superadmin' && auth.role !== 'superadmin') {
        return res.status(403).json({ error: "Endast en Super-Admin kan tilldela Super-Admin-rollen." });
    }

    if (auth.role !== 'superadmin') {
        const targetRes = await pool.query(
            'SELECT role FROM admin_users WHERE id = $1 AND workplace_id = $2',
            [id, auth.workplace]
        );
        if (targetRes.rows.length === 0) {
            return res.status(404).json({ error: "Användaren hittades inte." });
        }
        if (targetRes.rows[0].role === 'superadmin') {
            return res.status(403).json({ error: "Du har inte behörighet att redigera ett superadmin-konto." });
        }
    }

    const safeFirstName = firstName || displayName || username?.trim();
    if (!safeFirstName) {
        return res.status(400).json({ error: "Förnamn eller visningsnamn måste anges." });
    }

    const passwordStr = password ? String(password).trim() : '';
    if (passwordStr.length > 0) {
        if (passwordStr.length < 6) {
            return res.status(400).json({ error: "Lösenordet måste vara minst 6 tecken långt." });
        }
        const updatedHash = await bcrypt.hash(passwordStr, 10);
        await pool.query(
            `UPDATE admin_users
             SET username=$1, password=$2, first_name=$3, last_name=$4,
                 display_name=$5, email=$6, role=$7
             WHERE id=$8 AND workplace_id=$9`,
            [username, updatedHash, safeFirstName, lastName, displayName, email, role, id, auth.workplace]
        );
    } else {
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

async function removeAdmin(res, auth, payload) {
    const { id } = payload || {};

    if (!id) {
        return res.status(400).json({ error: "ID saknas. Kontakta support om felet kvarstår." });
    }

    if (auth.role !== 'superadmin') {
        const checkAdminRes = await pool.query(
            'SELECT role FROM admin_users WHERE id = $1 AND workplace_id = $2',
            [id, auth.workplace]
        );
        if (checkAdminRes.rows.length === 0) {
            return res.status(404).json({ error: "Användaren hittades inte." });
        }
        if (checkAdminRes.rows[0].role === 'superadmin') {
            return res.status(403).json({ error: "Du kan inte ta bort ett superadmin-konto." });
        }
    }

    await pool.query('DELETE FROM admin_users WHERE id = $1 AND workplace_id = $2', [id, auth.workplace]);
    return res.status(200).json({ success: true });
}

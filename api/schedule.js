import { pool, authenticate, handleDatabaseError, setupCors } from './_shared.js';
import { notifyScheduleUpdated } from './_pusher.js';

export default async function handler(req, res) {
    setupCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const auth = authenticate(req);
    if (!auth.isAuthorized) return res.status(401).json({ error: "Åtkomst nekad." });

    try {
        if (req.method === 'GET') return await handleGet(req, res, auth);
        if (req.method === 'POST') return await handlePost(req, res, auth);
        return res.status(405).end();
    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

async function handleGet(req, res, auth) {
    const { type, start_date, end_date } = req.query;
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (type === 'schedule') {
        if (!start_date || !end_date) return res.status(400).json({ error: "Saknar datum" });
        const schedRes = await pool.query(`
            SELECT sa.id, sa.work_date, sa.user_id, sa.station_id, sa.shift_id, sa.is_published, sa.note, sa.is_locked,
                   u.first_name, u.last_name, u.display_name
            FROM schedule_assignments sa
            JOIN admin_users u ON sa.user_id = u.id
            JOIN stations s ON sa.station_id = s.id
            WHERE s.workplace_id = $1 AND sa.work_date >= $2 AND sa.work_date <= $3
            ORDER BY sa.id ASC`, [auth.workplace, start_date, end_date]
        );
        return res.status(200).json(schedRes.rows);
    }

    if (type === 'absences') {
        const absRes = await pool.query(`
            SELECT a.*, u.first_name, u.last_name, u.display_name FROM absences a
            JOIN admin_users u ON a.user_id = u.id
            WHERE a.workplace_id = $1 ORDER BY a.start_date DESC`, [auth.workplace]
        );
        return res.status(200).json(absRes.rows);
    }

    return res.status(400).json({ error: "Ogiltig GET-typ för schedule" });
}

async function handlePost(req, res, auth) {
    if (auth.role !== 'admin' && auth.role !== 'superadmin') {
        return res.status(403).json({ error: "Behörighet saknas" });
    }
    const { action, payload } = req.body;
    switch (action) {
        case 'assign_shift':     return await handleAssignShift(res, auth, payload);
        case 'remove_shift':     return await handleRemoveShift(res, auth, payload);
        case 'publish_schedule': return await handlePublishSchedule(res, auth, payload);
        case 'update_note':      return await handleUpdateNote(res, auth, payload);
        case 'toggle_lock':      return await handleToggleLock(res, auth, payload);
        case 'save_absence':     return await handleSaveAbsence(res, auth, payload);
        case 'delete_absence':   return await handleDeleteAbsence(res, auth, payload);
        default:                 return res.status(400).json({ error: "Okänd action för schedule" });
    }
}

async function handleAssignShift(res, auth, payload) {
    if (!payload?.date || !payload?.user_id || !payload?.station_id || !payload?.shift_id) {
        return res.status(400).json({ error: "Saknar nödvändig data för tilldelning." });
    }
    const valid = await pool.query(`
        SELECT 1 FROM admin_users u, stations s
        WHERE u.id = $1 AND u.workplace_id = $3
        AND s.id = $2 AND s.workplace_id = $3
    `, [payload.user_id, payload.station_id, auth.workplace]);
    if (valid.rows.length === 0) {
        return res.status(403).json({ error: "Ogiltig tilldelning — användare eller station tillhör inte din arbetsplats." });
    }
    await pool.query(`
        INSERT INTO schedule_assignments (work_date, user_id, station_id, shift_id, is_published, is_locked)
        VALUES ($1, $2, $3, $4, false, false) ON CONFLICT DO NOTHING
    `, [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
    return res.status(200).json({ success: true });
}

async function handleRemoveShift(res, auth, payload) {
    if (!payload?.date || !payload?.user_id || !payload?.station_id || !payload?.shift_id) {
        return res.status(400).json({ error: "Saknar nödvändig data för borttagning." });
    }

    const check = await pool.query(`
        SELECT is_locked FROM schedule_assignments
        WHERE work_date = $1 AND user_id = $2 AND station_id = $3 AND shift_id = $4
    `, [payload.date, payload.user_id, payload.station_id, payload.shift_id]);

    if (check.rows.length > 0 && check.rows[0].is_locked) {
        return res.status(403).json({ error: "Arbetspasset är låst och kan inte tas bort." });
    }

    await pool.query(`
        DELETE FROM schedule_assignments sa
        USING stations s
        WHERE sa.station_id = s.id
        AND s.workplace_id = $1
        AND sa.work_date = $2
        AND sa.user_id = $3
        AND sa.station_id = $4
        AND sa.shift_id = $5
    `, [auth.workplace, payload.date, payload.user_id, payload.station_id, payload.shift_id]);
    return res.status(200).json({ success: true });
}

async function handlePublishSchedule(res, auth, payload) {
    if (!payload?.start_date || !payload?.end_date) {
        return res.status(400).json({ error: "Saknar datumintervall för publicering." });
    }
    await pool.query(`
        UPDATE schedule_assignments sa SET is_published = true
        FROM stations s
        WHERE sa.station_id = s.id
        AND s.workplace_id = $1
        AND sa.work_date >= $2
        AND sa.work_date <= $3
    `, [auth.workplace, payload.start_date, payload.end_date]);
    notifyScheduleUpdated(auth.workplace);
    return res.status(200).json({ success: true });
}

async function handleUpdateNote(res, auth, payload) {
    if (!payload?.id) {
        return res.status(400).json({ error: "Saknar ID för tilldelning." });
    }

    const check = await pool.query('SELECT is_locked FROM schedule_assignments WHERE id = $1', [payload.id]);
    if (check.rows.length > 0 && check.rows[0].is_locked) {
        return res.status(403).json({ error: "Arbetspasset är låst och anteckningen kan inte ändras." });
    }

    await pool.query(`
        UPDATE schedule_assignments sa SET note = $1
        FROM stations s
        WHERE sa.station_id = s.id
        AND s.workplace_id = $2
        AND sa.id = $3
    `, [payload.note || null, auth.workplace, payload.id]);
    return res.status(200).json({ success: true });
}

async function handleToggleLock(res, auth, payload) {
    if (!payload?.id || payload.is_locked === undefined) {
        return res.status(400).json({ error: "Saknar ID eller låsstatus." });
    }
    
    await pool.query(`
        UPDATE schedule_assignments sa SET is_locked = $1
        FROM stations s
        WHERE sa.station_id = s.id
        AND s.workplace_id = $2
        AND sa.id = $3
    `, [payload.is_locked, auth.workplace, payload.id]);
    
    return res.status(200).json({ success: true, is_locked: payload.is_locked });
}

async function handleSaveAbsence(res, auth, payload) {
    if (!payload?.user_id || !payload?.start_date || !payload?.end_date) {
        return res.status(400).json({ error: "Saknar nödvändig data för frånvaro" });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (payload.id) {
            await updateAbsence(client, auth, payload);
        } else {
            await insertAbsence(client, payload, auth);
        }
        await client.query('COMMIT');
        return res.status(200).json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.statusCode === 404) return res.status(404).json({ error: err.message });
        throw err;
    } finally {
        client.release();
    }
}

async function updateAbsence(client, auth, payload) {
    const oldAbsRes = await client.query(
        'SELECT start_date, end_date FROM absences WHERE id = $1 AND workplace_id = $2 AND user_id = $3',
        [payload.id, auth.workplace, payload.user_id]
    );
    if (oldAbsRes.rows.length === 0) {
        throw Object.assign(new Error("Frånvaron hittades inte."), { statusCode: 404 });
    }
    await client.query(
        'UPDATE absences SET start_date = $1, end_date = $2, type = $3 WHERE id = $4 AND workplace_id = $5 AND user_id = $6',
        [payload.start_date, payload.end_date, payload.type, payload.id, auth.workplace, payload.user_id]
    );
    const old = oldAbsRes.rows[0];
    const clearFrom = new Date(old.start_date) < new Date(payload.start_date) ? old.start_date : payload.start_date;
    const clearTo   = new Date(old.end_date)   > new Date(payload.end_date)   ? old.end_date   : payload.end_date;
    await clearShifts(client, payload.user_id, clearFrom, clearTo, auth.workplace);
}

async function insertAbsence(client, payload, auth) {
    await client.query(
        'INSERT INTO absences (user_id, start_date, end_date, type, workplace_id) VALUES ($1, $2, $3, $4, $5)',
        [payload.user_id, payload.start_date, payload.end_date, payload.type, auth.workplace]
    );
    await clearShifts(client, payload.user_id, payload.start_date, payload.end_date, auth.workplace);
}

async function clearShifts(client, userId, from, to, workplace) {
    await client.query(`
        DELETE FROM schedule_assignments
        WHERE user_id = $1 AND work_date >= $2 AND work_date <= $3
        AND is_locked = false
        AND station_id IN (SELECT id FROM stations WHERE workplace_id = $4)
    `, [userId, from, to, workplace]);
}

async function handleDeleteAbsence(res, auth, payload) {
    if (!payload?.id) {
        return res.status(400).json({ error: "Saknar ID för frånvaro." });
    }
    await pool.query('DELETE FROM absences WHERE id = $1 AND workplace_id = $2', [payload.id, auth.workplace]);
    return res.status(200).json({ success: true });
}

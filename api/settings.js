// ============================================================================
// API/SETTINGS.JS - Hanterar stationer, pass, arbetsplatser och inställningar
// ============================================================================

import { pool, handleDatabaseError, setupCors, authenticate, JWT_SECRET } from './_shared.js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

// ==========================================
// GET-HANTERARE
// ==========================================

async function handleGetWorkplaces(auth) {
    if (auth.role !== 'superadmin') return { status: 403, body: { success: false, error: "Endast superadmin" } };
    const wpRes = await pool.query('SELECT id, name FROM workplaces ORDER BY name ASC');
    return { status: 200, body: { success: true, data: wpRes.rows } };
}

async function handleGetStations(auth) {
    const stRes = await pool.query(
        'SELECT * FROM stations WHERE workplace_id = $1 ORDER BY sort_order ASC',
        [auth.workplace]
    );
    return { status: 200, body: { success: true, data: stRes.rows } };
}

async function handleGetShifts(auth) {
    const shRes = await pool.query(
        'SELECT * FROM shifts WHERE workplace_id = $1 ORDER BY sort_order ASC',
        [auth.workplace]
    );
    return { status: 200, body: { success: true, data: shRes.rows } };
}

async function handleGetDisplayBundle(auth, query) {
    const { start_date, end_date, include_config } = query;
    if (!start_date || !end_date) {
        return { status: 400, body: { success: false, error: "Saknar start_date eller end_date" } };
    }
    const queries = [
        pool.query('SELECT * FROM stations WHERE workplace_id = $1 ORDER BY sort_order ASC', [auth.workplace]),
        pool.query('SELECT * FROM shifts WHERE workplace_id = $1 ORDER BY sort_order ASC', [auth.workplace]),
        pool.query(`
            SELECT sa.id, sa.work_date, sa.user_id, sa.station_id, sa.shift_id, sa.is_published, sa.note,
                   u.first_name, u.last_name, u.display_name
            FROM schedule_assignments sa
            JOIN admin_users u ON sa.user_id = u.id
            JOIN stations s ON sa.station_id = s.id
            WHERE s.workplace_id = $1 AND sa.work_date >= $2 AND sa.work_date <= $3
            ORDER BY sa.id ASC
        `, [auth.workplace, start_date, end_date])
    ];

    if (include_config === 'true') {
        queries.push(
            pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', ['settings', auth.workplace]),
            pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', ['message', auth.workplace]),
            pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', ['weather_config', auth.workplace])
        );
    }

    const results = await Promise.allSettled(queries);
    const getRows = (idx) => results[idx]?.status === 'fulfilled' ? results[idx].value.rows : [];
    const getSingleData = (idx) =>
        results[idx]?.status === 'fulfilled' && results[idx].value.rows[0]
            ? results[idx].value.rows[0].data : {};

    const responseData = { stations: getRows(0), shifts: getRows(1), schedule: getRows(2) };
    if (include_config === 'true') {
        responseData.settings       = getSingleData(3);
        responseData.message        = getSingleData(4);
        responseData.weather_config = getSingleData(5);
    }
    return { status: 200, body: { success: true, data: responseData } };
}

async function handleGetStorage(auth, type) {
    const allowedGetTypes = ['settings', 'message', 'custom_themes', 'weather_config'];
    if (!allowedGetTypes.includes(type)) return { status: 400, body: { success: false, error: "Ogiltig typ" } };
    const storeRes = await pool.query(
        'SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2',
        [type, auth.workplace]
    );
    return { status: 200, body: { success: true, data: storeRes.rows[0]?.data || {} } };
}

// ==========================================
// POST-HANTERARE
// ==========================================

function handleGenerateDisplayLink(auth) {
    const token = jwt.sign(
        { purpose: 'display', workplaceId: auth.workplace },
        JWT_SECRET,
        { expiresIn: '1y' }
    );
    return { status: 200, body: { success: true, token } };
}

async function handleSaveWorkplace(auth, payload) {
    if (auth.role !== 'superadmin') return { status: 403, body: { success: false, error: "Endast superadmin" } };
    if (!payload?.name?.trim()) return { status: 400, body: { success: false, error: "Namn krävs" } };
    if (payload.id) {
        await pool.query('UPDATE workplaces SET name = $1 WHERE id = $2', [payload.name.trim(), payload.id]);
    } else {
        const newId = crypto.randomUUID();
        await pool.query('INSERT INTO workplaces (id, name) VALUES ($1, $2)', [newId, payload.name.trim()]);
    }
    return { status: 200, body: { success: true } };
}

async function handleSaveStation(auth, payload) {
    if (!payload?.name?.trim()) return { status: 400, body: { success: false, error: "Namn krävs" } };
    if (payload.id) {
        await pool.query(
            'UPDATE stations SET name = $1, color = $2, is_spacer = $3 WHERE id = $4 AND workplace_id = $5',
            [payload.name.trim(), payload.color, payload.is_spacer || false, payload.id, auth.workplace]
        );
    } else {
        const maxRes = await pool.query(
            'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM stations WHERE workplace_id = $1',
            [auth.workplace]
        );
        await pool.query(
            'INSERT INTO stations (workplace_id, name, color, is_spacer, sort_order) VALUES ($1, $2, $3, $4, $5)',
            [auth.workplace, payload.name.trim(), payload.color, payload.is_spacer || false, maxRes.rows[0].next_order]
        );
    }
    return { status: 200, body: { success: true } };
}

async function handleSaveShift(auth, payload) {
    if (!payload?.label?.trim()) return { status: 400, body: { success: false, error: "Etikett krävs" } };
    if (payload.id) {
        await pool.query(
            'UPDATE shifts SET label = $1, time_range = $2 WHERE id = $3 AND workplace_id = $4',
            [payload.label.trim(), payload.time_range, payload.id, auth.workplace]
        );
    } else {
        const maxRes = await pool.query(
            'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM shifts WHERE workplace_id = $1',
            [auth.workplace]
        );
        await pool.query(
            'INSERT INTO shifts (workplace_id, label, time_range, sort_order) VALUES ($1, $2, $3, $4)',
            [auth.workplace, payload.label.trim(), payload.time_range, maxRes.rows[0].next_order]
        );
    }
    return { status: 200, body: { success: true } };
}

async function handleDeleteStation(auth, payload) {
    if (!payload?.id) return { status: 400, body: { success: false, error: "ID krävs" } };
    await pool.query('DELETE FROM stations WHERE id = $1 AND workplace_id = $2', [payload.id, auth.workplace]);
    return { status: 200, body: { success: true } };
}

async function handleDeleteShift(auth, payload) {
    if (!payload?.id) return { status: 400, body: { success: false, error: "ID krävs" } };
    await pool.query('DELETE FROM shifts WHERE id = $1 AND workplace_id = $2', [payload.id, auth.workplace]);
    return { status: 200, body: { success: true } };
}

async function handleReorderStations(auth, payload) {
    if (!Array.isArray(payload)) return { status: 400, body: { success: false, error: "Payload måste vara en array" } };
    await Promise.all(payload.map(item =>
        pool.query('UPDATE stations SET sort_order = $1 WHERE id = $2 AND workplace_id = $3', [item.sort_order, item.id, auth.workplace])
    ));
    return { status: 200, body: { success: true } };
}

async function handleReorderShifts(auth, payload) {
    if (!Array.isArray(payload)) return { status: 400, body: { success: false, error: "Payload måste vara en array" } };
    await Promise.all(payload.map(item =>
        pool.query('UPDATE shifts SET sort_order = $1 WHERE id = $2 AND workplace_id = $3', [item.sort_order, item.id, auth.workplace])
    ));
    return { status: 200, body: { success: true } };
}

async function handleSaveStorage(auth, type, data) {
    const allowedPostTypes = ['settings', 'message', 'custom_themes', 'weather_config'];
    if (!allowedPostTypes.includes(type)) return { status: 400, body: { success: false, error: "Ogiltig lagringstyp" } };
    await pool.query(`
        INSERT INTO app_storage (key, data, workplace_id) VALUES ($1, $2, $3)
        ON CONFLICT (key, workplace_id) DO UPDATE SET data = EXCLUDED.data
    `, [type, JSON.stringify(data), auth.workplace]);
    return { status: 200, body: { success: true } };
}

// ==========================================
// HUVUD-HANDLER
// ==========================================

export default async function handler(req, res) {
    setupCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const auth = authenticate(req);
    if (!auth.isAuthorized) return res.status(401).json({ success: false, error: "Obehörig" });

    try {
        if (req.method === 'GET') {
            res.setHeader('Cache-Control', 'no-store, max-age=0');
            const { type, ...rest } = req.query;
            let result;
            if (type === 'workplaces')     result = await handleGetWorkplaces(auth);
            else if (type === 'stations')  result = await handleGetStations(auth);
            else if (type === 'shifts')    result = await handleGetShifts(auth);
            else if (type === 'display_bundle') result = await handleGetDisplayBundle(auth, req.query);
            else                           result = await handleGetStorage(auth, type);
            return res.status(result.status).json(result.body);
        }

        if (req.method === 'POST') {
            if (!['admin', 'superadmin'].includes(auth.role)) {
                return res.status(403).json({ success: false, error: "Endast admin kan ändra inställningar" });
            }
            const { action, payload, type, data } = req.body;

            if (action) {
                const actions = {
                    generate_display_link: () => handleGenerateDisplayLink(auth),
                    save_workplace:        () => handleSaveWorkplace(auth, payload),
                    save_station:          () => handleSaveStation(auth, payload),
                    save_shift:            () => handleSaveShift(auth, payload),
                    delete_station:        () => handleDeleteStation(auth, payload),
                    delete_shift:          () => handleDeleteShift(auth, payload),
                    reorder_stations:      () => handleReorderStations(auth, payload),
                    reorder_shifts:        () => handleReorderShifts(auth, payload),
                };
                if (!actions[action]) return res.status(400).json({ success: false, error: "Okänd action" });
                const result = await actions[action]();
                return res.status(result.status).json(result.body);
            }

            if (type && data !== undefined) {
                const result = await handleSaveStorage(auth, type, data);
                return res.status(result.status).json(result.body);
            }

            return res.status(400).json({ success: false, error: "Ogiltig payload" });
        }

        return res.status(405).json({ success: false, error: "Metod ej tillåten" });
    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

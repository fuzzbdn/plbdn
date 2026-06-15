import { pool, authenticate, handleDatabaseError, setupCors } from './_shared.js';

export default async function handler(req, res) {
    setupCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const auth = authenticate(req);

    try {
        if (req.method === 'GET') {
            const { type, start_date, end_date, include_config } = req.query;

            if (type === 'display_bundle') {
                res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
            } else {
                res.setHeader('Cache-Control', 'no-store, max-age=0');
            }

            // Tillåt endast display_bundle att passera utan inloggning (om token stämmer)
            if (!auth.isAuthorized && type !== 'display_bundle') {
                return res.status(401).json({ error: "Åtkomst nekad." });
            }

            switch (type) {
                case 'display_bundle':
                    if(!start_date || !end_date) return res.status(400).json({error: "Saknar datum"});
                    
                    const queries = [
                        pool.query('SELECT * FROM stations WHERE workplace_id = $1 ORDER BY sort_order ASC', [auth.workplace]),
                        pool.query('SELECT * FROM shifts WHERE workplace_id = $1 ORDER BY sort_order ASC', [auth.workplace]),
                        pool.query(`
                            SELECT sa.id, sa.work_date, sa.user_id, sa.station_id, sa.shift_id, sa.is_published,
                                   u.first_name, u.last_name, u.display_name
                            FROM schedule_assignments sa
                            JOIN admin_users u ON sa.user_id = u.id
                            JOIN stations s ON sa.station_id = s.id
                            WHERE s.workplace_id = $1 AND sa.work_date >= $2 AND sa.work_date <= $3
                            ORDER BY sa.id ASC`, [auth.workplace, start_date, end_date])
                    ];

                    if (include_config === 'true') {
                        queries.push(pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', ['settings', auth.workplace]));
                        queries.push(pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', ['message', auth.workplace]));
                        queries.push(pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', ['weather_config', auth.workplace]));
                    }

                    const results = await Promise.all(queries);
                    
                    const responseData = {
                        stations: results[0].rows,
                        shifts: results[1].rows,
                        schedule: results[2].rows
                    };

                    if (include_config === 'true') {
                        responseData.settings = results[3].rows.length > 0 ? results[3].rows[0].data : {};
                        responseData.message = results[4].rows.length > 0 ? results[4].rows[0].data : {};
                        responseData.weather_config = results[5].rows.length > 0 ? results[5].rows[0].data : {};
                    }
                    return res.status(200).json(responseData);

                case 'workplaces':
                    if (auth.role !== 'superadmin') return res.status(403).json({ error: "Obehörig" });
                    const wpRes = await pool.query('SELECT * FROM workplaces ORDER BY name ASC');
                    return res.status(200).json(wpRes.rows);

                case 'stations':
                    const statRes = await pool.query('SELECT * FROM stations WHERE workplace_id = $1 ORDER BY sort_order ASC', [auth.workplace]);
                    return res.status(200).json(statRes.rows);

                case 'shifts':
                    const shiftRes = await pool.query('SELECT * FROM shifts WHERE workplace_id = $1 ORDER BY sort_order ASC', [auth.workplace]);
                    return res.status(200).json(shiftRes.rows);

                default:
                    const storeRes = await pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, auth.workplace]);
                    return res.status(200).json(storeRes.rows.length > 0 ? storeRes.rows[0].data : {});
            }
        }

        if (req.method === 'POST') {
            if (auth.role !== 'admin' && auth.role !== 'superadmin') {
                return res.status(403).json({ error: "Behörighet saknas" });
            }

            const { action, payload, type, data } = req.body;

            switch (action) {
                case 'reorder_stations':
                    if (!Array.isArray(payload)) return res.status(400).json({ error: "Payload måste vara en array" });
                    await Promise.all(payload.map((statId, i) => pool.query('UPDATE stations SET sort_order=$1 WHERE id=$2 AND workplace_id=$3', [i, statId, auth.workplace])));
                    return res.status(200).json({ success: true });

                case 'reorder_shifts':
                    if (!Array.isArray(payload)) return res.status(400).json({ error: "Payload måste vara en array" });
                    await Promise.all(payload.map((shiftId, i) => pool.query('UPDATE shifts SET sort_order=$1 WHERE id=$2 AND workplace_id=$3', [i, shiftId, auth.workplace])));
                    return res.status(200).json({ success: true });

                case 'save_workplace':
                    if (auth.role !== 'superadmin') return res.status(403).json({ error: "Kräver superadmin" });
                    if (payload.is_new) {
                        await pool.query('INSERT INTO workplaces (id, name) VALUES ($1, $2)', [Date.now().toString(), payload.name]);
                    } else {
                        await pool.query('UPDATE workplaces SET name=$1 WHERE id=$2', [payload.name, payload.id]);
                    }
                    return res.status(200).json({ success: true });

                case 'save_station':
                    if (payload.id) {
                        await pool.query('UPDATE stations SET name=$1, color=$2, is_spacer=$3 WHERE id=$4 AND workplace_id=$5', [payload.name, payload.color, payload.is_spacer, payload.id, auth.workplace]);
                    } else {
                        await pool.query('INSERT INTO stations (workplace_id, name, color, is_spacer, sort_order) VALUES ($1, $2, $3, $4, 99)', [auth.workplace, payload.name, payload.color, payload.is_spacer]);
                    }
                    return res.status(200).json({ success: true });

                case 'save_shift':
                    if (payload.id) {
                        await pool.query('UPDATE shifts SET label=$1, time_range=$2 WHERE id=$3 AND workplace_id=$4', [payload.label, payload.time_range, payload.id, auth.workplace]);
                    } else {
                        await pool.query('INSERT INTO shifts (workplace_id, label, time_range, sort_order) VALUES ($1, $2, $3, 99)', [auth.workplace, payload.label, payload.time_range]);
                    }
                    return res.status(200).json({ success: true });

                case 'delete_station':
                    await pool.query('DELETE FROM stations WHERE id=$1 AND workplace_id=$2', [payload.id, auth.workplace]);
                    return res.status(200).json({ success: true });

                case 'delete_shift':
                    await pool.query('DELETE FROM shifts WHERE id=$1 AND workplace_id=$2', [payload.id, auth.workplace]);
                    return res.status(200).json({ success: true });
            }

            // Hantering av generisk lagring (t.ex. save_message, save_theme)
            if (type && data) {
                const allowedStorageKeys = ['settings', 'message', 'custom_themes', 'weather_config'];
                if (!allowedStorageKeys.includes(type)) {
                    return res.status(400).json({ error: "Ogiltig datatyp för lagring" });
                }
                
                await pool.query('DELETE FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, auth.workplace]);
                await pool.query('INSERT INTO app_storage (key, data, workplace_id) VALUES ($1, $2, $3)', [type, JSON.stringify(data), auth.workplace]);
                return res.status(200).json({ success: true });
            }
        }
        
        return res.status(405).end(); 

    } catch (e) { 
        return handleDatabaseError(res, e);
    }
}

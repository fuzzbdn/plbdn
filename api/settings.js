// ============================================================================
// API/SETTINGS.JS - Hanterar stationer, pass, arbetsplatser och inställningar
// ============================================================================

import { pool, handleDatabaseError, setupCors, authenticate, JWT_SECRET } from './_shared.js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

export default async function handler(req, res) {
    setupCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const auth = authenticate(req);
    if (!auth.isAuthorized) {
        return res.status(401).json({ success: false, error: "Obehörig" });
    }

    try {
        // ==========================================
        // GET-ANROP
        // ==========================================
        if (req.method === 'GET') {
            res.setHeader('Cache-Control', 'no-store, max-age=0');
            const { type, start_date, end_date, include_config } = req.query;

            switch (type) {

                // --- Arbetsplatser (Endast superadmin) ---
                case 'workplaces': {
                    if (auth.role !== 'superadmin') {
                        return res.status(403).json({ success: false, error: "Endast superadmin" });
                    }
                    const wpRes = await pool.query(
                        'SELECT id, name FROM workplaces ORDER BY name ASC'
                    );
                    return res.status(200).json({ success: true, data: wpRes.rows });
                }

                // --- Stationer ---
                case 'stations': {
                    const stRes = await pool.query(
                        'SELECT * FROM stations WHERE workplace_id = $1 ORDER BY sort_order ASC',
                        [auth.workplace]
                    );
                    return res.status(200).json({ success: true, data: stRes.rows });
                }

                // --- Arbetspass ---
                case 'shifts': {
                    const shRes = await pool.query(
                        'SELECT * FROM shifts WHERE workplace_id = $1 ORDER BY sort_order ASC',
                        [auth.workplace]
                    );
                    return res.status(200).json({ success: true, data: shRes.rows });
                }

                // --- Display-bundle (Schema + valfri config) ---
                case 'display_bundle': {
                    if (!start_date || !end_date) {
                        return res.status(400).json({ success: false, error: "Saknar start_date eller end_date" });
                    }

                    const queries = [
                        pool.query(
                            'SELECT * FROM stations WHERE workplace_id = $1 ORDER BY sort_order ASC',
                            [auth.workplace]
                        ),
                        pool.query(
                            'SELECT * FROM shifts WHERE workplace_id = $1 ORDER BY sort_order ASC',
                            [auth.workplace]
                        ),
                        pool.query(`
                            SELECT sa.id, sa.work_date, sa.user_id, sa.station_id, sa.shift_id, sa.is_published, sa.note,
                                   u.first_name, u.last_name, u.display_name
                            FROM schedule_assignments sa
                            JOIN admin_users u ON sa.user_id = u.id
                            JOIN stations s ON sa.station_id = s.id
                            WHERE s.workplace_id = $1
                              AND sa.work_date >= $2
                              AND sa.work_date <= $3
                            ORDER BY sa.id ASC
                        `, [auth.workplace, start_date, end_date])
                    ];

                    // Config hämtas bara vid behov (spara DB-anrop)
                    const fetchConfig = include_config === 'true';
                    if (fetchConfig) {
                        queries.push(pool.query(
                            'SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2',
                            ['settings', auth.workplace]
                        ));
                        queries.push(pool.query(
                            'SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2',
                            ['message', auth.workplace]
                        ));
                        queries.push(pool.query(
                            'SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2',
                            ['weather_config', auth.workplace]
                        ));
                    }

                    const results = await Promise.allSettled(queries);

                    // Hjälpare för att plocka ut rader säkert
                    const getRows = (idx) =>
                        results[idx]?.status === 'fulfilled' ? results[idx].value.rows : [];
                    const getSingleData = (idx) =>
                        results[idx]?.status === 'fulfilled' && results[idx].value.rows[0]
                            ? results[idx].value.rows[0].data
                            : {};

                    const responseData = {
                        stations: getRows(0),
                        shifts:   getRows(1),
                        schedule: getRows(2)
                    };

                    if (fetchConfig) {
                        responseData.settings      = getSingleData(3);
                        responseData.message       = getSingleData(4);
                        responseData.weather_config = getSingleData(5);
                    }

                    return res.status(200).json({ success: true, data: responseData });
                }

                // --- Generisk app_storage (settings, message, custom_themes, weather_config) ---
                default: {
                    const allowedGetTypes = ['settings', 'message', 'custom_themes', 'weather_config'];
                    if (!allowedGetTypes.includes(type)) {
                        return res.status(400).json({ success: false, error: "Ogiltig typ" });
                    }

                    const storeRes = await pool.query(
                        'SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2',
                        [type, auth.workplace]
                    );
                    return res.status(200).json({
                        success: true,
                        data: storeRes.rows[0]?.data || {}
                    });
                }
            }
        }

        // ==========================================
        // POST-ANROP
        // ==========================================
        if (req.method === 'POST') {
            // Display-rollen får aldrig skriva inställningar
            if (!['admin', 'superadmin'].includes(auth.role)) {
                return res.status(403).json({ success: false, error: "Endast admin kan ändra inställningar" });
            }

            const { action, payload, type, data } = req.body;

            // --- SPECIFIKA ACTIONS ---
            if (action) {
                switch (action) {

                    // Generera JWT för display-enhet
                    case 'generate_display_link': {
                        const token = jwt.sign(
                            { purpose: 'display', workplaceId: auth.workplace },
                            JWT_SECRET
                            // TODO: Lägg till { expiresIn: '1y' } för ökad säkerhet
                        );
                        return res.status(200).json({ success: true, token });
                    }

                    // Skapa eller uppdatera arbetsplats (Endast superadmin)
                    case 'save_workplace': {
                        if (auth.role !== 'superadmin') {
                            return res.status(403).json({ success: false, error: "Endast superadmin" });
                        }
                        if (!payload?.name?.trim()) {
                            return res.status(400).json({ success: false, error: "Namn krävs" });
                        }
                        if (payload.id) {
                            await pool.query(
                                'UPDATE workplaces SET name = $1 WHERE id = $2',
                                [payload.name.trim(), payload.id]
                            );
                        } else {
                            const newId = crypto.randomUUID();
                            await pool.query(
                                'INSERT INTO workplaces (id, name) VALUES ($1, $2)',
                                [newId, payload.name.trim()]
                            );
                        }
                        return res.status(200).json({ success: true });
                    }

                    // Skapa eller uppdatera station
                    case 'save_station': {
                        if (!payload?.name?.trim()) {
                            return res.status(400).json({ success: false, error: "Namn krävs" });
                        }
                        if (payload.id) {
                            await pool.query(
                                `UPDATE stations
                                 SET name = $1, color = $2, is_spacer = $3
                                 WHERE id = $4 AND workplace_id = $5`,
                                [payload.name.trim(), payload.color, payload.is_spacer || false, payload.id, auth.workplace]
                            );
                        } else {
                            const maxRes = await pool.query(
                                'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM stations WHERE workplace_id = $1',
                                [auth.workplace]
                            );
                            await pool.query(
                                `INSERT INTO stations (workplace_id, name, color, is_spacer, sort_order)
                                 VALUES ($1, $2, $3, $4, $5)`,
                                [auth.workplace, payload.name.trim(), payload.color, payload.is_spacer || false, maxRes.rows[0].next_order]
                            );
                        }
                        return res.status(200).json({ success: true });
                    }

                    // Skapa eller uppdatera arbetspass
                    case 'save_shift': {
                        if (!payload?.label?.trim()) {
                            return res.status(400).json({ success: false, error: "Etikett krävs" });
                        }
                        if (payload.id) {
                            await pool.query(
                                `UPDATE shifts
                                 SET label = $1, time_range = $2
                                 WHERE id = $3 AND workplace_id = $4`,
                                [payload.label.trim(), payload.time_range, payload.id, auth.workplace]
                            );
                        } else {
                            const maxRes = await pool.query(
                                'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM shifts WHERE workplace_id = $1',
                                [auth.workplace]
                            );
                            await pool.query(
                                `INSERT INTO shifts (workplace_id, label, time_range, sort_order)
                                 VALUES ($1, $2, $3, $4)`,
                                [auth.workplace, payload.label.trim(), payload.time_range, maxRes.rows[0].next_order]
                            );
                        }
                        return res.status(200).json({ success: true });
                    }

                    // Ta bort station
                    case 'delete_station': {
                        if (!payload?.id) {
                            return res.status(400).json({ success: false, error: "ID krävs" });
                        }
                        await pool.query(
                            'DELETE FROM stations WHERE id = $1 AND workplace_id = $2',
                            [payload.id, auth.workplace]
                        );
                        return res.status(200).json({ success: true });
                    }

                    // Ta bort arbetspass
                    case 'delete_shift': {
                        if (!payload?.id) {
                            return res.status(400).json({ success: false, error: "ID krävs" });
                        }
                        await pool.query(
                            'DELETE FROM shifts WHERE id = $1 AND workplace_id = $2',
                            [payload.id, auth.workplace]
                        );
                        return res.status(200).json({ success: true });
                    }

                    // Sortera om stationer
                    case 'reorder_stations': {
                        if (!Array.isArray(payload)) {
                            return res.status(400).json({ success: false, error: "Payload måste vara en array" });
                        }
                        await Promise.all(
                            payload.map(item =>
                                pool.query(
                                    'UPDATE stations SET sort_order = $1 WHERE id = $2 AND workplace_id = $3',
                                    [item.sort_order, item.id, auth.workplace]
                                )
                            )
                        );
                        return res.status(200).json({ success: true });
                    }

                    // Sortera om arbetspass
                    case 'reorder_shifts': {
                        if (!Array.isArray(payload)) {
                            return res.status(400).json({ success: false, error: "Payload måste vara en array" });
                        }
                        await Promise.all(
                            payload.map(item =>
                                pool.query(
                                    'UPDATE shifts SET sort_order = $1 WHERE id = $2 AND workplace_id = $3',
                                    [item.sort_order, item.id, auth.workplace]
                                )
                            )
                        );
                        return res.status(200).json({ success: true });
                    }

                    default: {
                        return res.status(400).json({ success: false, error: "Okänd action" });
                    }
                }
            }

            // --- GENERISK LAGRING (settings, message, custom_themes, weather_config) ---
            if (type && data !== undefined) {
                const allowedPostTypes = ['settings', 'message', 'custom_themes', 'weather_config'];
                if (!allowedPostTypes.includes(type)) {
                    return res.status(400).json({ success: false, error: "Ogiltig lagringstyp" });
                }

                // Atomär UPSERT — kräver UNIQUE(key, workplace_id) i databasen
                await pool.query(`
                    INSERT INTO app_storage (key, data, workplace_id)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (key, workplace_id)
                    DO UPDATE SET data = EXCLUDED.data
                `, [type, JSON.stringify(data), auth.workplace]);

                return res.status(200).json({ success: true });
            }

            return res.status(400).json({ success: false, error: "Ogiltig payload" });
        }

        return res.status(405).json({ success: false, error: "Metod ej tillåten" });

    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

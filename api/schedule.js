// Fil: api/schedule.js

import { pool, authenticate, handleDatabaseError, setupCors } from './_shared.js';

/**
 * Huvudhanterare för schemaläggning och frånvaro.
 * API:et hanterar hämtning av scheman/frånvaro (GET) samt
 * tilldelning, publicering och hantering av pass och ledigheter (POST).
 */
export default async function handler(req, res) {
    // 1. Konfigurera CORS och hantera preflight-anrop
    setupCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // 2. Autentisering: Säkerställ att användaren har en giltig inloggning
    const auth = authenticate(req);
    if (!auth.isAuthorized) return res.status(401).json({ error: "Åtkomst nekad." });

    try {
        // ==========================================
        // GET-ANROP: Hämta data (schema eller frånvaro)
        // ==========================================
        if (req.method === 'GET') {
            const { type, start_date, end_date } = req.query;

            res.setHeader('Cache-Control', 'no-store, max-age=0');

            // --- Hämta Schema ---
            if (type === 'schedule') {
                if (!start_date || !end_date) return res.status(400).json({ error: "Saknar datum" });

                const schedRes = await pool.query(`
                    SELECT sa.id, sa.work_date, sa.user_id, sa.station_id, sa.shift_id, sa.is_published,
                           u.first_name, u.last_name, u.display_name
                    FROM schedule_assignments sa
                    JOIN admin_users u ON sa.user_id = u.id
                    JOIN stations s ON sa.station_id = s.id
                    WHERE s.workplace_id = $1 AND sa.work_date >= $2 AND sa.work_date <= $3
                    ORDER BY sa.id ASC`, [auth.workplace, start_date, end_date]
                );
                return res.status(200).json(schedRes.rows);
            }

            // --- Hämta Frånvaro ---
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

        // ==========================================
        // POST-ANROP: Skapa, ändra eller ta bort data
        // ==========================================
        if (req.method === 'POST') {

            // 3. Auktorisering: Endast administratörer får ändra i schemat
            if (auth.role !== 'admin' && auth.role !== 'superadmin') {
                return res.status(403).json({ error: "Behörighet saknas" });
            }

            const { action, payload } = req.body;

            switch (action) {

                // --- Tilldela ett pass ---
                case 'assign_shift': {
                    // FIX: Validera att alla fält finns
                    if (!payload?.date || !payload?.user_id || !payload?.station_id || !payload?.shift_id) {
                        return res.status(400).json({ error: "Saknar nödvändig data för tilldelning." });
                    }

                    // FIX: Kontrollera att user och station tillhör auth.workplace
                    const validAssign = await pool.query(`
                        SELECT 1 FROM admin_users u, stations s
                        WHERE u.id = $1 AND u.workplace_id = $3
                        AND s.id = $2 AND s.workplace_id = $3
                    `, [payload.user_id, payload.station_id, auth.workplace]);

                    if (validAssign.rows.length === 0) {
                        return res.status(403).json({ error: "Ogiltig tilldelning — användare eller station tillhör inte din arbetsplats." });
                    }

                    await pool.query(`
                        INSERT INTO schedule_assignments (work_date, user_id, station_id, shift_id, is_published)
                        VALUES ($1, $2, $3, $4, false) ON CONFLICT DO NOTHING
                    `, [payload.date, payload.user_id, payload.station_id, payload.shift_id]);

                    return res.status(200).json({ success: true });
                }

                // --- Ta bort ett inbokat pass ---
                case 'remove_shift': {
                    // FIX: Validera att alla fält finns
                    if (!payload?.date || !payload?.user_id || !payload?.station_id || !payload?.shift_id) {
                        return res.status(400).json({ error: "Saknar nödvändig data för borttagning." });
                    }

                    // FIX: Säkerställ att passet tillhör auth.workplace via stations-tabellen
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

                // --- Publicera schemat för en viss period ---
                case 'publish_schedule': {
                    // FIX: Validera att datumfälten finns
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

                    return res.status(200).json({ success: true });
                }

                // --- Registrera eller Uppdatera frånvaro (och rensa krockande pass) ---
                case 'save_absence': {
                    if (!payload?.user_id || !payload?.start_date || !payload?.end_date) {
                        return res.status(400).json({ error: "Saknar nödvändig data för frånvaro" });
                    }

                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');

                        if (payload.id) {
                            // FIX: Hämta gamla datumintervallet innan uppdatering så vi kan rensa
                            // pass som låg inom det gamla intervallet men inte det nya
                            const oldAbsRes = await client.query(
                                'SELECT start_date, end_date FROM absences WHERE id = $1 AND workplace_id = $2 AND user_id = $3',
                                [payload.id, auth.workplace, payload.user_id]
                            );

                            if (oldAbsRes.rows.length === 0) {
                                await client.query('ROLLBACK');
                                return res.status(404).json({ error: "Frånvaron hittades inte." });
                            }

                            // Uppdatera frånvaron
                            await client.query(
                                'UPDATE absences SET start_date = $1, end_date = $2, type = $3 WHERE id = $4 AND workplace_id = $5 AND user_id = $6',
                                [payload.start_date, payload.end_date, payload.type, payload.id, auth.workplace, payload.user_id]
                            );

                            // Rensa pass inom det sammanslagna intervallet (gammalt + nytt)
                            const oldStart = new Date(oldAbsRes.rows[0].start_date);
                            const oldEnd = new Date(oldAbsRes.rows[0].end_date);
                            const newStart = new Date(payload.start_date);
                            const newEnd = new Date(payload.end_date);
                            
                            const clearFrom = oldStart < newStart ? oldAbsRes.rows[0].start_date : payload.start_date;
                            const clearTo = oldEnd > newEnd ? oldAbsRes.rows[0].end_date : payload.end_date;

                            await client.query(`
                                DELETE FROM schedule_assignments
                                WHERE user_id = $1 AND work_date >= $2 AND work_date <= $3
                                AND station_id IN (SELECT id FROM stations WHERE workplace_id = $4)
                            `, [payload.user_id, clearFrom, clearTo, auth.workplace]);

                        } else {
                            // Ny frånvaro
                            await client.query(
                                'INSERT INTO absences (user_id, start_date, end_date, type, workplace_id) VALUES ($1, $2, $3, $4, $5)',
                                [payload.user_id, payload.start_date, payload.end_date, payload.type, auth.workplace]
                            );

                            // Rensa pass inom det nya intervallet
                            await client.query(`
                                DELETE FROM schedule_assignments
                                WHERE user_id = $1 AND work_date >= $2 AND work_date <= $3
                                AND station_id IN (SELECT id FROM stations WHERE workplace_id = $4)
                            `, [payload.user_id, payload.start_date, payload.end_date, auth.workplace]);
                        }

                        await client.query('COMMIT');
                        return res.status(200).json({ success: true });
                    } catch (err) {
                        await client.query('ROLLBACK');
                        throw err;
                    } finally {
                        client.release();
                    }
                }

                // --- Ta bort en registrerad frånvaro ---
                case 'delete_absence': {
                    if (!payload?.id) {
                        return res.status(400).json({ error: "Saknar ID för frånvaro." });
                    }
                    await pool.query('DELETE FROM absences WHERE id = $1 AND workplace_id = $2', [payload.id, auth.workplace]);
                    return res.status(200).json({ success: true });
                }

                default:
                    return res.status(400).json({ error: "Okänd action för schedule" });
            }
        }

        return res.status(405).end();

    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

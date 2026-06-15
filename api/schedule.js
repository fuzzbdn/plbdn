import { pool, authenticate, handleDatabaseError, setupCors } from './_shared.js';

export default async function handler(req, res) {
    setupCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const auth = authenticate(req);
    if (!auth.isAuthorized) return res.status(401).json({ error: "Åtkomst nekad." });

    try {
        if (req.method === 'GET') {
            const { type, start_date, end_date } = req.query;
            res.setHeader('Cache-Control', 'no-store, max-age=0');

            if (type === 'schedule') {
                if(!start_date || !end_date) return res.status(400).json({error: "Saknar datum"});
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

        if (req.method === 'POST') {
            if (auth.role !== 'admin' && auth.role !== 'superadmin') {
                return res.status(403).json({ error: "Behörighet saknas" });
            }

            const { action, payload } = req.body;

            switch (action) {
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
                        [auth.workplace, payload.start_date, payload.end_date]);
                    return res.status(200).json({ success: true });

                case 'save_absence':
                    if (!payload || !payload.user_id || !payload.start_date || !payload.end_date) {
                        return res.status(400).json({ error: "Saknar nödvändig data för frånvaro" });
                    }
                    const client = await pool.connect(); 
                    try {
                        await client.query('BEGIN'); 
                        await client.query(
                            'INSERT INTO absences (user_id, start_date, end_date, type, workplace_id) VALUES ($1, $2, $3, $4, $5)',
                            [payload.user_id, payload.start_date, payload.end_date, payload.type, auth.workplace]
                        );
                        // Ta bort eventuella inbokade pass för denna person under frånvaron
                        await client.query(`
                            DELETE FROM schedule_assignments 
                            WHERE user_id = $1 AND work_date >= $2 AND work_date <= $3 
                            AND station_id IN (SELECT id FROM stations WHERE workplace_id = $4)
                        `, [payload.user_id, payload.start_date, payload.end_date, auth.workplace]);
                        await client.query('COMMIT'); 
                        return res.status(200).json({ success: true });
                    } catch (err) {
                        await client.query('ROLLBACK'); 
                        throw err; 
                    } finally {
                        client.release(); 
                    }

                case 'delete_absence':
                    await pool.query('DELETE FROM absences WHERE id = $1 AND workplace_id = $2', [payload.id, auth.workplace]);
                    return res.status(200).json({ success: true });

                default:
                    return res.status(400).json({ error: "Okänd action för schedule" });
            }
        }
        
        return res.status(405).end();
    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

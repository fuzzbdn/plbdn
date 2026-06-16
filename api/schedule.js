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
            
            // Förhindra att webbläsaren cachar schemadatan, så vi alltid visar senaste versionen
            res.setHeader('Cache-Control', 'no-store, max-age=0');

            // --- Hämta Schema ---
            if (type === 'schedule') {
                if(!start_date || !end_date) return res.status(400).json({error: "Saknar datum"});
                
                // Hämtar alla inbokade pass inom datumintervallet för den inloggades arbetsplats
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
                // Hämtar all registrerad frånvaro för arbetsplatsen, sorterat med nyaste först
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

            // Hantera olika administrativa åtgärder baserat på 'action'
            switch (action) {
                
                // --- Tilldela ett pass ---
                case 'assign_shift':
                    // ON CONFLICT DO NOTHING förhindrar krasch om man råkar dubbelklicka/skicka samma pass två gånger
                    await pool.query(`INSERT INTO schedule_assignments (work_date, user_id, station_id, shift_id, is_published) VALUES ($1, $2, $3, $4, false) ON CONFLICT DO NOTHING`, 
                        [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
                    return res.status(200).json({ success: true });

                // --- Ta bort ett inbokat pass ---
                case 'remove_shift':
                    await pool.query('DELETE FROM schedule_assignments WHERE work_date=$1 AND user_id=$2 AND station_id=$3 AND shift_id=$4', 
                        [payload.date, payload.user_id, payload.station_id, payload.shift_id]);
                    return res.status(200).json({ success: true });

                // --- Publicera schemat för en viss period ---
                case 'publish_schedule':
                    // Uppdaterar is_published till true för alla pass på den aktuella arbetsplatsen inom datumintervallet
                    await pool.query(`UPDATE schedule_assignments sa SET is_published = true FROM stations s WHERE sa.station_id = s.id AND s.workplace_id = $1 AND sa.work_date >= $2 AND sa.work_date <= $3`, 
                        [auth.workplace, payload.start_date, payload.end_date]);
                    return res.status(200).json({ success: true });

                // --- Registrera frånvaro (och rensa krockande pass) ---
                case 'save_absence':
                    if (!payload || !payload.user_id || !payload.start_date || !payload.end_date) {
                        return res.status(400).json({ error: "Saknar nödvändig data för frånvaro" });
                    }
                    
                    // Använder en specifik databasklient för att köra en "Transaktion"
                    const client = await pool.connect(); 
                    try {
                        await client.query('BEGIN'); // Starta transaktionen
                        
                        // 1. Lägg in frånvaron i tabellen
                        await client.query(
                            'INSERT INTO absences (user_id, start_date, end_date, type, workplace_id) VALUES ($1, $2, $3, $4, $5)',
                            [payload.user_id, payload.start_date, payload.end_date, payload.type, auth.workplace]
                        );
                        
                        // 2. Säkerhet: Ta automatiskt bort eventuella inbokade pass för personen under dessa datum.
                        // Detta hindrar att systemet tror att en person både är schemalagd och sjuk/ledig samtidigt.
                        await client.query(`
                            DELETE FROM schedule_assignments 
                            WHERE user_id = $1 AND work_date >= $2 AND work_date <= $3 
                            AND station_id IN (SELECT id FROM stations WHERE workplace_id = $4)
                        `, [payload.user_id, payload.start_date, payload.end_date, auth.workplace]);
                        
                        await client.query('COMMIT'); // Spara båda ändringarna permanent
                        return res.status(200).json({ success: true });
                    } catch (err) {
                        // Om något av stegen ovan misslyckas, rulla tillbaka allt så vi inte får ofullständig data
                        await client.query('ROLLBACK'); 
                        throw err; 
                    } finally {
                        client.release(); // Släpp tillbaka anslutningen till poolen så den kan återanvändas
                    }

                // --- Ta bort en registrerad frånvaro ---
                case 'delete_absence':
                    // Verifierar arbetsplatsen i frågan för att säkerställa att admins inte kan ta bort frånvaro på andra arbetsplatser
                    await pool.query('DELETE FROM absences WHERE id = $1 AND workplace_id = $2', [payload.id, auth.workplace]);
                    return res.status(200).json({ success: true });

                default:
                    return res.status(400).json({ error: "Okänd action för schedule" });
            }
        }
        
        // Metoden var varken GET, POST eller OPTIONS
        return res.status(405).end();
        
    } catch (e) {
        // Skickar oväntade server-/databasfel till vår gemensamma hanterare
        return handleDatabaseError(res, e);
    }
}

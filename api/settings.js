import { pool, authenticate, handleDatabaseError, setupCors } from './_shared.js';

/**
 * API-hanterare för systemkonfiguration och grunddata.
 * Hanterar arbetsplatser, stationer, arbetspass (shifts) och flexibel app-lagring (t.ex. meddelanden och teman).
 * Inkluderar även en "display_bundle" för att effektivt ladda allt som behövs till en extern infoskärm i ett enda anrop.
 */
export default async function handler(req, res) {
    // 1. Konfigurera CORS och hantera preflight-anrop (för att webbläsaren ska godkänna anropet)
    setupCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // 2. Försök autentisera användaren (skapar 'auth'-objektet)
    const auth = authenticate(req);

    try {
        // ==========================================
        // GET-ANROP: Hämta konfiguration och listor
        // ==========================================
        if (req.method === 'GET') {
            const { type, start_date, end_date, include_config } = req.query;

            // Cache-strategi: 
            // För infoskärmen ('display_bundle') använder vi "stale-while-revalidate".
            // Det gör att skärmen kan ladda blixtsnabbt från cachen, medan servern hämtar ny data i bakgrunden.
            if (type === 'display_bundle') {
                res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
            } else {
                // All annan data (som admin-verktyg) måste alltid vara helt färsk
                res.setHeader('Cache-Control', 'no-store, max-age=0');
            }

            // Säkerhetsgrind: Om man inte är inloggad får man ENDAST hämta 'display_bundle'
            // (vilket krävs för att de offentliga infoskärmarna ska kunna läsa datan utan personlig inloggning).
            if (!auth.isAuthorized && type !== 'display_bundle') {
                return res.status(401).json({ error: "Åtkomst nekad." });
            }

            switch (type) {
                // --- Samlat anrop för Infoskärmen ---
                case 'display_bundle':
                    if(!start_date || !end_date) return res.status(400).json({error: "Saknar datum"});
                    
                    // Förbered alla databasfrågor i en array. 
                    // Att köra dem parallellt är betydligt snabbare än att "awaita" dem en i taget.
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

                    // Om klienten explicit vill ha med inställningarna, pushar vi in de frågorna också
                    if (include_config === 'true') {
                        queries.push(pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', ['settings', auth.workplace]));
                        queries.push(pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', ['message', auth.workplace]));
                        queries.push(pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', ['weather_config', auth.workplace]));
                    }

                    // Utför alla lagrade databasfrågor exakt samtidigt
                    const results = await Promise.all(queries);
                    
                    // Pussla ihop det slutgiltiga svaret
                    const responseData = {
                        stations: results[0].rows,
                        shifts: results[1].rows,
                        schedule: results[2].rows
                    };

                    // Extrahera JSON-datan från app_storage (och hantera om raden saknas)
                    if (include_config === 'true') {
                        responseData.settings = results[3].rows.length > 0 ? results[3].rows[0].data : {};
                        responseData.message = results[4].rows.length > 0 ? results[4].rows[0].data : {};
                        responseData.weather_config = results[5].rows.length > 0 ? results[5].rows[0].data : {};
                    }
                    return res.status(200).json(responseData);


                // --- Hämta alla arbetsplatser (Exklusivt för superadmin) ---
                case 'workplaces':
                    if (auth.role !== 'superadmin') return res.status(403).json({ error: "Obehörig" });
                    const wpRes = await pool.query('SELECT * FROM workplaces ORDER BY name ASC');
                    return res.status(200).json(wpRes.rows);

                // --- Hämta enbart stationer ---
                case 'stations':
                    const statRes = await pool.query('SELECT * FROM stations WHERE workplace_id = $1 ORDER BY sort_order ASC', [auth.workplace]);
                    return res.status(200).json(statRes.rows);

                // --- Hämta enbart pass (shifts) ---
                case 'shifts':
                    const shiftRes = await pool.query('SELECT * FROM shifts WHERE workplace_id = $1 ORDER BY sort_order ASC', [auth.workplace]);
                    return res.status(200).json(shiftRes.rows);

                // --- Fallback: Hämta ett specifikt nyckelvärde från app_storage ---
                default:
                    const storeRes = await pool.query('SELECT data FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, auth.workplace]);
                    return res.status(200).json(storeRes.rows.length > 0 ? storeRes.rows[0].data : {});
            }
        }

        // ==========================================
        // POST-ANROP: Skapa och uppdatera inställningar
        // ==========================================
        if (req.method === 'POST') {
            
            // Generell behörighetskontroll: Man måste vara minst admin för att göra några ändringar alls
            if (auth.role !== 'admin' && auth.role !== 'superadmin') {
                return res.status(403).json({ error: "Behörighet saknas" });
            }

            const { action, payload, type, data } = req.body;

            switch (action) {
                
                // --- Sortering via Drag & Drop ---
                case 'reorder_stations':
                    if (!Array.isArray(payload)) return res.status(400).json({ error: "Payload måste vara en array" });
                    // Loopar igenom listan av ID:n och uppdaterar 'sort_order' till deras aktuella index i arrayen
                    await Promise.all(payload.map((statId, i) => pool.query('UPDATE stations SET sort_order=$1 WHERE id=$2 AND workplace_id=$3', [i, statId, auth.workplace])));
                    return res.status(200).json({ success: true });

                case 'reorder_shifts':
                    if (!Array.isArray(payload)) return res.status(400).json({ error: "Payload måste vara en array" });
                    await Promise.all(payload.map((shiftId, i) => pool.query('UPDATE shifts SET sort_order=$1 WHERE id=$2 AND workplace_id=$3', [i, shiftId, auth.workplace])));
                    return res.status(200).json({ success: true });

                // --- Hantera arbetsplatser ---
                case 'save_workplace':
                    if (auth.role !== 'superadmin') return res.status(403).json({ error: "Kräver superadmin" });
                    
                    if (payload.is_new) {
                        // Använder timestamp som ett enkelt unikt ID för nya arbetsplatser
                        await pool.query('INSERT INTO workplaces (id, name) VALUES ($1, $2)', [Date.now().toString(), payload.name]);
                    } else {
                        await pool.query('UPDATE workplaces SET name=$1 WHERE id=$2', [payload.name, payload.id]);
                    }
                    return res.status(200).json({ success: true });

                // --- Skapa / Redigera Station ---
                case 'save_station':
                    if (payload.id) {
                        await pool.query('UPDATE stations SET name=$1, color=$2, is_spacer=$3 WHERE id=$4 AND workplace_id=$5', [payload.name, payload.color, payload.is_spacer, payload.id, auth.workplace]);
                    } else {
                        // Nya stationer tvingas längst ner i listan med sort_order = 99
                        await pool.query('INSERT INTO stations (workplace_id, name, color, is_spacer, sort_order) VALUES ($1, $2, $3, $4, 99)', [auth.workplace, payload.name, payload.color, payload.is_spacer]);
                    }
                    return res.status(200).json({ success: true });

                // --- Skapa / Redigera Pass ---
                case 'save_shift':
                    if (payload.id) {
                        await pool.query('UPDATE shifts SET label=$1, time_range=$2 WHERE id=$3 AND workplace_id=$4', [payload.label, payload.time_range, payload.id, auth.workplace]);
                    } else {
                        await pool.query('INSERT INTO shifts (workplace_id, label, time_range, sort_order) VALUES ($1, $2, $3, 99)', [auth.workplace, payload.label, payload.time_range]);
                    }
                    return res.status(200).json({ success: true });

                // --- Borttagning ---
                case 'delete_station':
                    await pool.query('DELETE FROM stations WHERE id=$1 AND workplace_id=$2', [payload.id, auth.workplace]);
                    return res.status(200).json({ success: true });

                case 'delete_shift':
                    await pool.query('DELETE FROM shifts WHERE id=$1 AND workplace_id=$2', [payload.id, auth.workplace]);
                    return res.status(200).json({ success: true });
            }

            // --- Generisk Key/Value-lagring för app_storage (t.ex. JSON-inställningar) ---
            // Körs om klienten skickar 'type' och 'data' men ingen 'action'.
            if (type && data) {
                // En strict "allowlist" säkerställer att ingen kan stoppa in obehöriga nycklar i databasen
                const allowedStorageKeys = ['settings', 'message', 'custom_themes', 'weather_config'];
                if (!allowedStorageKeys.includes(type)) {
                    return res.status(400).json({ error: "Ogiltig datatyp för lagring" });
                }
                
                // Mönster: Ta alltid bort den gamla raden först, lägg sedan in den nya som strängifierad JSON.
                // Detta är ofta robustare än UPSERT om databasstrukturen för JSON-objektet förändras över tid.
                await pool.query('DELETE FROM app_storage WHERE key = $1 AND workplace_id = $2', [type, auth.workplace]);
                await pool.query('INSERT INTO app_storage (key, data, workplace_id) VALUES ($1, $2, $3)', [type, JSON.stringify(data), auth.workplace]);
                
                return res.status(200).json({ success: true });
            }
        }
        
        // Fånga upp om anropet skedde med en otillåten metod (t.ex. PUT eller DELETE)
        return res.status(405).end(); 

    } catch (e) { 
        // Skicka fel som uppstår till den delade felhanteraren för konsekvent formatering
        return handleDatabaseError(res, e);
    }
}

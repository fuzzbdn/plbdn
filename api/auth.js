import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { pool, JWT_SECRET, handleDatabaseError, setupCors } from './_shared.js';

// Initiera Resend för e-postutskick med API-nyckel från miljövariablerna
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Huvudhanterare för API-routen.
 * Hanterar autentiseringsflöden: inloggning, utloggning samt begäran och utförande av lösenordsåterställning.
 */
export default async function handler(req, res) {
    // 1. Grundläggande inställningar och säkerhetskontroller
    setupCors(req, res); // Konfigurera Cross-Origin Resource Sharing
    
    // Hantera preflight-förfrågningar (CORS OPTIONS-anrop)
    if (req.method === 'OPTIONS') return res.status(200).end();
    
    // Säkerställ att endpointen endast accepterar POST-förfrågningar
    if (req.method !== 'POST') return res.status(405).json({ error: "Metod inte tillåten" });

    // 2. Extrahera all möjlig data vi kan behöva från request body
    const { action, username, password, payload, email, newPassword, token: tokenBody } = req.body;

    try {
        // 3. Dirigera begäran baserat på vilken 'action' klienten skickar in
        switch (action) {
            
            // ==========================================
            // INLOGGNING
            // ==========================================
            case 'login':
                // Hämta användaren från databasen (hanterar både direkt 'username' och nestad 'payload.username')
                const userRes = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username || payload?.username]);
                const user = userRes.rows[0];

                // Verifiera att användaren finns och att lösenordet stämmer överens med databasens hashade lösenord
                if (!user || !user.password || !(await bcrypt.compare(password || payload?.password, user.password))) {
                    return res.status(401).json({ success: false, error: "Fel uppgifter" });
                }

                // Skapa en JSON Web Token (JWT) som innehåller användarens grunddata, giltig i 24 timmar
                const signedToken = jwt.sign(
                    { id: user.id, username: user.username, role: user.role, workplaceId: user.workplace_id }, 
                    JWT_SECRET, 
                    { expiresIn: '24h' }
                );
                
                // Sätt JWT:n i en säker cookie. 
                // HttpOnly hindrar JavaScript från att läsa den (skyddar mot XSS-attacker).
                res.setHeader('Set-Cookie', `jwtToken=${signedToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${24 * 60 * 60}`);
                
                // Returnera användardata till klienten (men undanhåll känslig data som lösenords-hashen)
                return res.status(200).json({ 
                    success: true, 
                    token: "cookie-authenticated", 
                    userId: user.id, 
                    name: user.display_name || user.first_name || user.username, 
                    role: user.role 
                });


            // ==========================================
            // UTLOGGNING
            // ==========================================
            case 'logout':
                // "Radera" cookien genom att skriva över den och sätta ett utgångsdatum i det förflutna
                res.setHeader('Set-Cookie', 'jwtToken=; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
                return res.status(200).json({ success: true });


            // ==========================================
            // BEGÄR LÖSENORDSÅTERSTÄLLNING
            // ==========================================
            case 'request_reset':
                if (!email) return res.status(400).json({ error: "E-post saknas" });
                
                const emailRes = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email]);
                const resetUser = emailRes.rows[0];
                
                // Säkerhetspraxis: Om e-posten inte finns i systemet, låtsas ändå som att det lyckades.
                // Detta förhindrar s.k. "email enumeration" där illvilliga aktörer testar vilka mail som är registrerade.
                if (!resetUser) return res.status(200).json({ success: true, message: "Länk skickad (om e-posten finns)." });

                // Skapa en dedikerad JWT för återställning, med ett syfte (purpose) och kort giltighetstid (1 timme)
                const resetToken = jwt.sign({ id: resetUser.id, purpose: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
                
                // Bygg återställningslänken dynamiskt baserat på vilken miljö (localhost/produktion) koden körs i
                const protocol = req.headers.host.includes('localhost') ? 'http' : 'https';
                const resetLink = `${protocol}://${req.headers.host}/reset.html?token=${resetToken}`;
                
                // Skicka e-postmeddelandet med återställningslänken via Resend
                try {
                    await resend.emails.send({
                        from: 'STRUL <losen@info.strulapp.se>', 
                        to: email,
                        subject: 'Återställ ditt lösenord',
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
                                <h2 style="color: #0277bd;">Återställ ditt lösenord</h2>
                                <p>Du har begärt att få återställa ditt lösenord.</p>
                                <p>Klicka på knappen nedan för att välja ett nytt lösenord. Länken är giltig i 1 timme.</p>
                                <div style="margin: 30px 0;">
                                    <a href="${resetLink}" style="background-color: #0277bd; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">Välj nytt lösenord</a>
                                </div>
                            </div>
                        `
                    });
                } catch (mailError) {
                    // Logga felet på servern men låt inte anropet krascha för användaren
                    console.error("Kunde inte skicka mail via Resend:", mailError);
                }
                return res.status(200).json({ success: true });


            // ==========================================
            // UTFÖR LÖSENORDSÅTERSTÄLLNING
            // ==========================================
            case 'perform_reset':
                if (!tokenBody || !newPassword) return res.status(400).json({ error: "Saknar data" });
                
                // Verifiera att token är giltig (kommer kasta ett fel i catch-blocket om den är utgången eller manipulerad)
                const decoded = jwt.verify(tokenBody, JWT_SECRET);
                
                // Dubbelkolla att denna token faktiskt skapades för att återställa lösenordet (och inte är t.ex. en inloggnings-token)
                if (decoded.purpose !== 'reset') return res.status(400).json({ error: "Ogiltig token typ" });
                
                // Hasha det nya lösenordet säkert innan det lagras
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                
                // Uppdatera databasen med det nya lösenordet för den specifika användaren
                await pool.query('UPDATE admin_users SET password = $1 WHERE id = $2', [hashedPassword, decoded.id]);
                
                return res.status(200).json({ success: true });
            
            // Fallback om klienten skickar en okänd 'action'
            default:
                return res.status(400).json({ error: "Ogiltig auth action" });
        }
    } catch (e) {
        // Fånga upp oväntade fel (t.ex. ogiltig JWT, databasfel) och skicka till den gemensamma felhanteraren
        return handleDatabaseError(res, e);
    }
}

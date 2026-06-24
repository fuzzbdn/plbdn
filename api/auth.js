import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { pool, JWT_SECRET, handleDatabaseError, setupCors } from './_shared.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
    setupCors(req, res);
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: "Metod inte tillåten" });

    const { action, username, password, payload, email, newPassword, token: tokenBody } = req.body;

    try {
        switch (action) {
            
            case 'login': {
                const userRes = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username || payload?.username]);
                const user = userRes.rows[0];

                if (!user || !user.password || !(await bcrypt.compare(password || payload?.password, user.password))) {
                    return res.status(401).json({ success: false, error: "Fel uppgifter" });
                }

                const signedToken = jwt.sign(
                    { id: user.id, username: user.username, role: user.role, workplaceId: user.workplace_id }, 
                    JWT_SECRET, 
                    { expiresIn: '24h' }
                );
                
                res.setHeader('Set-Cookie', `jwtToken=${signedToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${24 * 60 * 60}`);
                
                return res.status(200).json({ 
                    success: true, 
                    token: "cookie-authenticated", 
                    userId: user.id, 
                    name: user.display_name || user.first_name || user.username, 
                    role: user.role 
                });
            }

            case 'logout': {
                res.setHeader('Set-Cookie', [
                    'jwtToken=; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
                    'activeWorkplace=; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
                ]);
                return res.status(200).json({ success: true });
            }

            case 'switch_workplace': {
                if (!payload?.workplace_id) {
                    return res.status(400).json({ error: "workplace_id saknas" });
                }
                res.setHeader('Set-Cookie', `activeWorkplace=${payload.workplace_id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${24 * 60 * 60}`);
                return res.status(200).json({ success: true });
            }

            case 'request_reset': {
                if (!email) return res.status(400).json({ error: "E-post saknas" });
                
                const emailRes = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email]);
                const resetUser = emailRes.rows[0];
                
                if (!resetUser) return res.status(200).json({ success: true, message: "Länk skickad (om e-posten finns)." });

                const resetToken = jwt.sign({ id: resetUser.id, purpose: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
                
                const protocol = req.headers.host.includes('localhost') ? 'http' : 'https';
                const resetLink = `${protocol}://${req.headers.host}/reset.html?token=${resetToken}`;
                
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
                    console.error("Kunde inte skicka mail via Resend:", mailError);
                }
                return res.status(200).json({ success: true });
            }

            case 'perform_reset': {
                if (!tokenBody || !newPassword) return res.status(400).json({ error: "Saknar data" });
                
                const decoded = jwt.verify(tokenBody, JWT_SECRET);
                
                if (decoded.purpose !== 'reset') return res.status(400).json({ error: "Ogiltig token typ" });
                
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                
                await pool.query('UPDATE admin_users SET password = $1 WHERE id = $2', [hashedPassword, decoded.id]);
                
                return res.status(200).json({ success: true });
            }
            
            default:
                return res.status(400).json({ error: "Ogiltig auth action" });
        }
    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

/**
 * ============================================================================
 * API / AUTH.JS (Backend)
 * Hanterar all autentisering i systemet.
 * Detta inkluderar inloggning (med HttpOnly cookies), utloggning, byten av
 * aktiv arbetsplats, samt generering och verifiering av lösenordsåterställning 
 * via e-post (med Resend).
 * ============================================================================
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { pool, JWT_SECRET, handleDatabaseError, setupCors } from './_shared.js';

// Initiera Resend för att skicka e-post
const resend = new Resend(process.env.RESEND_API_KEY);

// ==========================================
// 1. HUVUDROUTER (Serverless Handler)
// ==========================================

export default async function handler(req, res) {
    setupCors(req, res);
    
    // Hantera preflight-anrop från webbläsaren
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: "Metod inte tillåten" });

    // Extrahera data från inkommande request
    const { action, username, password, payload, email, newPassword, token: tokenBody } = req.body;

    try {
        switch (action) {
            case 'login':            return await handleLogin(res, username, password, payload);
            case 'logout':           return handleLogout(res);
            case 'switch_workplace': return handleSwitchWorkplace(res, payload);
            case 'request_reset':    return await handleRequestReset(res, req, email);
            case 'perform_reset':    return await handlePerformReset(res, tokenBody, newPassword);
            default:                 return res.status(400).json({ error: "Ogiltig auth action" });
        }
    } catch (e) {
        return handleDatabaseError(res, e);
    }
}

// ==========================================
// 2. ACTION-FUNKTIONER FÖR AUTENTISERING
// ==========================================

/**
 * Hanterar inloggning av administratörer och personal.
 * Verifierar lösenordet mot databasens hash och skapar en säker HttpOnly-cookie.
 */
async function handleLogin(res, username, password, payload) {
    // Stöder både direkt username/password och payload-objekt
    const userRes = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username || payload?.username]);
    const user = userRes.rows[0];

    // Validera användare och lösenord
    if (!user || !user.password || !(await bcrypt.compare(password || payload?.password, user.password))) {
        return res.status(401).json({ success: false, error: "Fel uppgifter" });
    }

    // Signera en JWT som identifierar användaren
    const signedToken = jwt.sign(
        { id: user.id, username: user.username, role: user.role, workplaceId: user.workplace_id },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    // Spara token säkert i webbläsaren så att JavaScript (XSS) inte kan läsa den
    res.setHeader('Set-Cookie', `jwtToken=${signedToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${24 * 60 * 60}`);
    
    return res.status(200).json({
        success: true,
        token: "cookie-authenticated", // Klienten får bara en bekräftelse, den riktiga token ligger i cookien
        userId: user.id,
        name: user.display_name || user.first_name || user.username,
        role: user.role
    });
}

/**
 * Loggar ut användaren genom att rensa dess HttpOnly-cookies.
 */
function handleLogout(res) {
    // Sätt cookies förfallodatum i det förflutna för att tvinga webbläsaren att radera dem
    res.setHeader('Set-Cookie', [
        'jwtToken=; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'activeWorkplace=; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    ]);
    return res.status(200).json({ success: true });
}

/**
 * Byter aktiv arbetsplats för Super-Admins genom att sätta en speciell cookie.
 * (Hanteras i _shared.js middleware för att åsidosätta användarens egentliga arbetsplats).
 */
function handleSwitchWorkplace(res, payload) {
    if (!payload?.workplace_id) return res.status(400).json({ error: "workplace_id saknas" });
    
    res.setHeader('Set-Cookie', `activeWorkplace=${payload.workplace_id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${24 * 60 * 60}`);
    return res.status(200).json({ success: true });
}

// ==========================================
// 3. LÖSENORDSÅTERSTÄLLNING (Via E-post)
// ==========================================

/**
 * Genererar en tillfällig länk för lösenordsåterställning och skickar
 * den via e-post med hjälp av Resend API.
 */
async function handleRequestReset(res, req, email) {
    if (!email) return res.status(400).json({ error: "E-post saknas" });

    const emailRes = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email]);
    const resetUser = emailRes.rows[0];

    // Sikkerhetsmekanism: Returnera "success" oavsett om mailadressen fanns 
    // för att förhindra "User Enumeration Attacks" (att hackare gissar adresser).
    if (!resetUser) {
        return res.status(200).json({ success: true, message: "Länk skickad (om e-posten finns)." });
    }

    // Skapa en tidsbegränsad token specifikt för återställning (1 timme)
    const resetToken = jwt.sign({ id: resetUser.id, purpose: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
    
    // Bygg URL:en oavsett om systemet körs lokalt eller i produktion
    const baseUrl = process.env.BASE_URL || `https://${req.headers.host}`;
    const resetLink = `${baseUrl}/reset.html?token=${resetToken}`;

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
        // Vi returnerar inte error till klienten här, eftersom de då vet att e-posten faktiskt var giltig
    }
    
    return res.status(200).json({ success: true });
}

/**
 * Validerar en återställningstoken, hashar det nya lösenordet och sparar 
 * det i databasen för den specifika användaren.
 */
async function handlePerformReset(res, tokenBody, newPassword) {
    if (!tokenBody || !newPassword) return res.status(400).json({ error: "Saknar data" });

    let decoded;
    try {
        decoded = jwt.verify(tokenBody, JWT_SECRET);
    } catch {
        return res.status(400).json({ error: "Ogiltig eller utgången återställningslänk." });
    }

    // Säkerställ att det var en återställningstoken och inte en vanlig inloggningstoken som skickades med
    if (decoded.purpose !== 'reset') return res.status(400).json({ error: "Ogiltig token typ" });

    // Hasha det nya lösenordet och spara i DB
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admin_users SET password = $1 WHERE id = $2', [hashedPassword, decoded.id]);
    
    return res.status(200).json({ success: true });
}

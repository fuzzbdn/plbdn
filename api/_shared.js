/**
 * ============================================================================
 * API / _SHARED.JS (Backend Core)
 * Kärnmodul för backend-funktionalitet.
 * Hanterar global konfiguration, databasanslutning (PostgreSQL-pool),
 * standardiserad felhantering för databasfrågor, CORS-headers och 
 * systemets centrala JWT-autentisering med Tenant Isolation.
 * ============================================================================
 */

import pg from 'pg';
import jwt from 'jsonwebtoken';
import { parse } from 'cookie';

// ==========================================
// 1. MILJÖVARIABLER & UPPSTARTSVALIDERING
// ==========================================

// Fail-fast: Stoppa servern omedelbart om kritiska säkerhetsnycklar saknas
if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
    console.error('KRITISK: Nödvändiga miljövariabler (JWT_SECRET/DATABASE_URL) saknas. Servern startar inte.');
    process.exit(1);
}

/** @type {string} Den hemliga nyckeln för att signera och verifiera JWT-tokens */
export const JWT_SECRET = process.env.JWT_SECRET;

// ==========================================
// 2. DATABAS-POOL (Produktionsanpassad)
// ==========================================

const { Pool } = pg;

/**
 * En återanvändbar anslutningspool mot PostgreSQL.
 * Max 10 samtidiga anslutningar för att inte överbelasta databasen (t.ex. Neon),
 * samt inbyggda timeouts för att stänga inaktiva anslutningar och undvika minnesläckor.
 */
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Krävs oftast för molndatabaser
    max: 10,                            // Maximala antalet samtidiga anslutningar i poolen
    idleTimeoutMillis: 30000,           // Stäng anslutningar som varit inaktiva i 30 sek
    connectionTimeoutMillis: 5000       // Ge upp om databasen inte svarar inom 5 sek
});

// ==========================================
// 3. FELHANTERING
// ==========================================

/**
 * Fångar vanliga databasfel och översätter dem till säkra, läsbara felmeddelanden
 * för klienten, utan att läcka känslig SQL-struktursdata.
 * 
 * @param {Object} res - Express/Vercel response-objekt
 * @param {Object} error - Felet som kastades från pg-klienten
 */
export function handleDatabaseError(res, error) {
    console.error(`Databasfel (Kod: ${error.code}):`, error.message);

    switch (error.code) {
        case '23505': // Unique violation (t.ex. användarnamnet är upptaget)
            return res.status(400).json({ success: false, error: "Detta värde (t.ex. användarnamn) finns redan." });
        case '23503': // Foreign key violation (t.ex. försöker radera en användare som har inbokade pass)
            return res.status(400).json({ success: false, error: "Operationen misslyckades eftersom datan används av en annan post." });
        case '42P01': // Undefined table (databasen har inte blivit migrerad ordentligt)
            return res.status(500).json({ success: false, error: "Internt fel: Tabellen saknas i databasen." });
        default:      // Fallback för oförutsedda fel
            return res.status(500).json({ success: false, error: "Ett internt serverfel uppstod vid databasanropet." });
    }
}

// ==========================================
// 4. AUKTORISERING (Tenant Isolation & JWT)
// ==========================================

/**
 * Validerar administratörers och personalens inloggning via HTTPOnly-cookies.
 * Inkluderar logik för att låta Super-Admins byta vy till andra arbetsplatser.
 */
function authenticateFromCookie(token, activeWorkplaceCookie, ip) {
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const role = decoded.role || 'user';
        let workplace = decoded.workplaceId || 'default';
        
        // Åsidosätt arbetsplatsen om en Super-Admin har valt en annan anläggning i UI:t
        if (role === 'superadmin' && activeWorkplaceCookie) {
            workplace = activeWorkplaceCookie;
        }
        
        return { isAuthorized: true, role, workplace };
    } catch (err) {
        console.warn(`Ogiltig/Utgången JWT-token. IP: ${ip} | Fel: ${err.message}`);
        return null;
    }
}

/**
 * Validerar TV-skärmarnas åtkomst. Skärmarna använder statiska JWT-länkar 
 * (query-parametrar eller Bearer tokens) istället för cookies, eftersom 
 * de saknar inloggningsgränssnitt.
 */
function authenticateDisplayToken(req, ip) {
    let displayToken = req.query?.display_token || req.query?.token;
    const authHeader = req.headers.authorization;
    
    if (authHeader?.startsWith('Bearer ')) {
        displayToken = authHeader.split(' ')[1];
    }
    
    if (!displayToken) return null;
    
    try {
        const decoded = jwt.verify(displayToken, JWT_SECRET);
        // Säkerställ att det är en display-token (så ingen vanlig inloggning läckt över)
        if (decoded.purpose === 'display' && decoded.workplaceId) {
            return { isAuthorized: true, workplace: decoded.workplaceId, role: 'display' };
        }
        console.warn('Varning: En ogiltig token-typ försökte användas för display-åtkomst.');
        return null;
    } catch (err) {
        console.warn(`Ogiltig Display-JWT. IP: ${ip} | Fel: ${err.message}`);
        return null;
    }
}

/**
 * Huvudfunktion för säkerhetskontroll. Analyserar inkommande förfrågningar
 * och fastställer användarens behörighet och aktuella arbetsplats.
 * 
 * @param {Object} req - Request-objektet
 * @returns {Object} Ett auktoriseringsobjekt: { isAuthorized, role, workplace }
 */
export function authenticate(req) {
    const cookies = parse(req.headers.cookie || '');
    // Hämta IP för loggning och spårning vid intrångsförsök
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'Okänd IP';

    // 1. Prova först cookie-autentisering (Vanliga användare och Admins)
    const cookieAuth = authenticateFromCookie(cookies.jwtToken, cookies.activeWorkplace, ip);
    if (cookieAuth) return cookieAuth;

    // 2. Om inga cookies finns, prova Display-token (TV-skärmar)
    const displayAuth = authenticateDisplayToken(req, ip);
    if (displayAuth) return displayAuth;

    // 3. Obehörig
    return { isAuthorized: false, role: 'user', workplace: 'default' };
}

// ==========================================
// 5. CORS (Cross-Origin Resource Sharing)
// ==========================================

/**
 * Skyddar API:et så att det endast kan anropas från tillåtna domäner.
 * Hanterar även cookies över cross-origin-begäranden (vilket Vercel kräver).
 */
export function setupCors(req, res) {
    // Tillåt att webläsaren skickar med cookies (kritiskt för HttpOnly)
    res.setHeader('Access-Control-Allow-Credentials', true);

    const origin = req.headers.origin;

    if (process.env.ALLOWED_ORIGINS) {
        // I produktion: Acceptera endast anrop från de domäner som angetts i .env
        const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
        if (allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
            res.setHeader('Access-Control-Allow-Origin', 'null');
        }
    } else {
        // I utveckling: Tillåt alla domäner om ingen env-variabel är satt
        console.warn('VARNING: ALLOWED_ORIGINS ej satt — CORS är öppen. Endast OK i lokal utveckling.');
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-workplace-id');
}

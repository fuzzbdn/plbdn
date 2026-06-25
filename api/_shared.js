// ============================================================================
// _SHARED.JS - Gemensam Backend-konfiguration och Auktorisering
// ============================================================================

import pg from 'pg';
import jwt from 'jsonwebtoken';
import { parse } from 'cookie';

// ==========================================
// MILJÖVARIABLER & UPPSTARTSVALIDERING
// ==========================================
if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
    console.error('KRITISK: Nödvändiga miljövariabler (JWT_SECRET/DATABASE_URL) saknas. Servern startar inte.');
    process.exit(1);
}

export const JWT_SECRET = process.env.JWT_SECRET;

// ==========================================
// DATABAS-POOL (Produktionsanpassad)
// ==========================================
const { Pool } = pg;
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

// ==========================================
// FELHANTERING
// ==========================================
export function handleDatabaseError(res, error) {
    console.error(`Databasfel (Kod: ${error.code}):`, error.message);

    switch (error.code) {
        case '23505':
            return res.status(400).json({ success: false, error: "Detta värde (t.ex. användarnamn) finns redan." });
        case '23503':
            return res.status(400).json({ success: false, error: "Operationen misslyckades eftersom datan används av en annan post." });
        case '42P01':
            return res.status(500).json({ success: false, error: "Internt fel: Tabellen saknas i databasen." });
        default:
            return res.status(500).json({ success: false, error: "Ett internt serverfel uppstod vid databasanropet." });
    }
}

// ==========================================
// AUKTORISERING (Tenant Isolation & JWT)
// ==========================================
function authenticateFromCookie(token, activeWorkplaceCookie, ip) {
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const role = decoded.role || 'user';
        let workplace = decoded.workplaceId || 'default';
        if (role === 'superadmin' && activeWorkplaceCookie) {
            workplace = activeWorkplaceCookie;
        }
        return { isAuthorized: true, role, workplace };
    } catch (err) {
        console.warn(`Ogiltig/Utgången JWT-token. IP: ${ip} | Fel: ${err.message}`);
        return null;
    }
}

function authenticateDisplayToken(req, ip) {
    let displayToken = req.query?.display_token || req.query?.token;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        displayToken = authHeader.split(' ')[1];
    }
    if (!displayToken) return null;
    try {
        const decoded = jwt.verify(displayToken, JWT_SECRET);
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

export function authenticate(req) {
    const cookies = parse(req.headers.cookie || '');
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'Okänd IP';

    const cookieAuth = authenticateFromCookie(cookies.jwtToken, cookies.activeWorkplace, ip);
    if (cookieAuth) return cookieAuth;

    const displayAuth = authenticateDisplayToken(req, ip);
    if (displayAuth) return displayAuth;

    return { isAuthorized: false, role: 'user', workplace: 'default' };
}

// ==========================================
// CORS (Cross-Origin Resource Sharing)
// ==========================================
export function setupCors(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);

    const origin = req.headers.origin;

    if (process.env.ALLOWED_ORIGINS) {
        const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
        if (allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
            res.setHeader('Access-Control-Allow-Origin', 'null');
        }
    } else {
        console.warn('VARNING: ALLOWED_ORIGINS ej satt — CORS är öppen. Endast OK i lokal utveckling.');
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-workplace-id');
}

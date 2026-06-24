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
    max: 10,                      // Max antal samtidiga anslutningar
    idleTimeoutMillis: 30000,     // Stäng inaktiva anslutningar efter 30 sekunder
    connectionTimeoutMillis: 5000 // Ge upp om vi inte får anslutning inom 5 sekunder
});

// ==========================================
// FELHANTERING
// ==========================================
export function handleDatabaseError(res, error) {
    console.error(`Databasfel (Kod: ${error.code}):`, error.message);
    
    switch (error.code) {
        case '23505': // Unique violation
            return res.status(400).json({ success: false, error: "Detta värde (t.ex. användarnamn) finns redan." });
        case '23503': // Foreign key violation
            return res.status(400).json({ success: false, error: "Operationen misslyckades eftersom datan används av en annan post." });
        case '42P01': // Undefined table
            return res.status(500).json({ success: false, error: "Internt fel: Tabellen saknas i databasen." });
        default:
            return res.status(500).json({ success: false, error: "Ett internt serverfel uppstod vid databasanropet." });
    }
}

// ==========================================
// AUKTORISERING (Tenant Isolation & JWT)
// ==========================================
export function authenticate(req) {
    const cookies = parse(req.headers.cookie || '');
    const token = cookies.jwtToken;
    const activeWorkplaceCookie = cookies.activeWorkplace;
    
    let authState = {
        isAuthorized: false,
        role: 'user',
        workplace: 'default'
    };

    // 1. VANLIGA ANVÄNDARE (Via Cookie)
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            authState.isAuthorized = true;
            authState.role = decoded.role || 'user';
            
            // Standardregel: Låst till tokenens workplaceId
            authState.workplace = decoded.workplaceId || 'default';

            // Super-Admin undantag: Får använda cookie för att byta anläggning
            if (authState.role === 'superadmin' && activeWorkplaceCookie) {
                authState.workplace = activeWorkplaceCookie;
            }
        } catch (err) {
            const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'Okänd IP';
            console.warn(`Ogiltig/Utgången JWT-token. IP: ${ip} | Fel: ${err.message}`);
        }
    }

    // 2. TV-SKÄRMAR (Hoppa över om användaren redan är autentiserad)
    if (!authState.isAuthorized) {
        let displayToken = req.query?.display_token || req.query?.token;
        
        // Plocka token från Authorization-headern om den finns (Bearer <token>)
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            displayToken = authHeader.split(' ')[1];
        }

        if (displayToken) {
            try {
                const decodedDisplay = jwt.verify(displayToken, JWT_SECRET);
                
                // Verifiera att tokenen är skapad specifikt för en skärm
                if (decodedDisplay.purpose === 'display' && decodedDisplay.workplaceId) {
                    authState.isAuthorized = true;
                    authState.workplace = decodedDisplay.workplaceId;
                    authState.role = 'display';
                } else {
                    console.warn('Varning: En ogiltig token-typ försökte användas för display-åtkomst.');
                }
            } catch (err) {
                const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'Okänd IP';
                console.warn(`Ogiltig Display-JWT. IP: ${ip} | Fel: ${err.message}`);
            }
        }
    }

    return authState;
}

// ==========================================
// CORS (Cross-Origin Resource Sharing)
// ==========================================
export function setupCors(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    
    const origin = req.headers.origin;
    
    // Säker CORS: Tillåt endast origins som definierats i en kommaseparerad miljövariabel
    if (process.env.ALLOWED_ORIGINS) {
        const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
        if (allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
            // Sätt till 'null' för att blockera anrop som inte matchar
            res.setHeader('Access-Control-Allow-Origin', 'null');
        }
    } else {
        // --- Tydlig varning i serverloggen om skyddet saknas ---
        console.warn('VARNING: ALLOWED_ORIGINS ej satt — CORS är öppen. Endast OK i lokal utveckling.');
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-workplace-id');
}

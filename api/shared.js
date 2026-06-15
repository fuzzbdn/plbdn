import pg from 'pg';
import jwt from 'jsonwebtoken';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export const JWT_SECRET = process.env.JWT_SECRET;
export const SECRET_DISPLAY_KEY = process.env.DISPLAY_SECRET;

export function handleDatabaseError(res, error) {
    console.error("Databasfel:", error);
    if (error.code === '23505') {
        return res.status(400).json({ success: false, error: "Detta värde (t.ex. användarnamn) finns redan." });
    }
    return res.status(500).json({ success: false, error: "Ett internt serverfel uppstod." });
}

export function parseCookies(request) {
    const list = {};
    const rc = request.headers.cookie;
    if (rc) {
        rc.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            list[parts.shift().trim()] = decodeURI(parts.join('='));
        });
    }
    return list;
}

export function authenticate(req) {
    const cookies = parseCookies(req);
    const token = cookies.jwtToken;
    
    let authState = {
        isAuthorized: false,
        role: 'user',
        workplace: 'default'
    };

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            authState.isAuthorized = true;
            authState.role = decoded.role || 'user';
            authState.workplace = decoded.workplaceId || 'default';

            if (authState.role === 'superadmin' && req.headers['x-workplace-id']) {
                authState.workplace = req.headers['x-workplace-id'];
            }
        } catch (err) { /* Ogiltig token */ }
    }

    // Stöd för display_token (Skärmarna)
    const displayTokenParam = req.query?.display_token || req.query?.token;
    if (displayTokenParam === SECRET_DISPLAY_KEY) {
        authState.isAuthorized = true;
        authState.workplace = req.query?.workplace || 'default'; 
    }

    return authState;
}

export function setupCors(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-workplace-id');
}

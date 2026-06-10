import { showToast } from './utils.js';

// ==========================================
// HJÄLPFUNKTIONER
// ==========================================

/**
 * Hanterar knappars laddningsstatus.
 * FIX: Exporteras nu så att andra moduler kan återanvända den,
 * alternativt flytta till utils.js om den används brett i projektet.
 * @param {HTMLElement} btn - Knappelementet.
 * @param {boolean} isLoading - Om knappen ska vara i laddningsläge.
 * @param {string} originalText - Knappens ursprungliga text.
 */
export const setButtonLoading = (btn, isLoading, originalText) => {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.innerText = isLoading ? 'Laddar...' : originalText;
    btn.style.opacity = isLoading ? '0.7' : '1';
    btn.style.cursor = isLoading ? 'not-allowed' : 'pointer';
};

/**
 * Laddar och applicerar ett anpassat CSS-tema från API:et.
 * FIX: Extraherad från initLogin för att undvika djupt nästlad Promise-kedja.
 *
 * SÄKERHETSNOTERING: t.css injiceras direkt i DOM:en. Säkerställ att
 * CSS-innehållet valideras/saneras server-side innan det sparas i databasen,
 * och att en Content Security Policy (CSP) är konfigurerad.
 */
async function applyCustomTheme() {
    try {
        const settings = await fetch('/api/data-api?type=settings').then(r => r.json());
        if (!settings?.theme) return;

        const themes = await fetch('/api/data-api?type=custom_themes').then(r => r.json());
        const theme = (themes || []).find(x => x.id === settings.theme);

        if (theme?.css) {
            const style = document.createElement('style');
            style.innerHTML = theme.css;
            document.head.appendChild(style);
        }
    } catch {
        // Ignorera tyst – ett saknat tema är inte ett kritiskt fel
    }
}

/**
 * Validerar e-postformat med ett enkelt regex.
 * FIX: Ersätter den för svaga .includes('@')-kontrollen.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ==========================================
// INLOGGNING
// ==========================================

export function initLogin() {
    applyCustomTheme();

    const loginBtn = document.getElementById('loginBtn');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');

    // Enkel klient-sideskydd mot upprepade inloggningsförsök.
    // OBS: Servern måste också ha rate limiting – detta ger snabbare feedback till användaren.
    let failedAttempts = 0;
    let lockedUntil = 0;

    const doLogin = async () => {
        // Kontrollera om knappen är tillfälligt låst
        if (Date.now() < lockedUntil) {
            const secsLeft = Math.ceil((lockedUntil - Date.now()) / 1000);
            return showToast(`För många försök. Vänta ${secsLeft} sekunder.`, 'error');
        }

        const username = userIn.value.trim();
        // FIX: Trimma INTE lösenordet – mellanslag kan vara en giltig del av lösenordet
        const password = passIn.value;

        // Frontend-validering (spara databasanrop)
        if (!username || !password) {
            return showToast('Vänligen fyll i både användarnamn och lösenord.', 'info');
        }

        setButtonLoading(loginBtn, true, 'Logga in');

        try {
            const res = await fetch('/api/data-api', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', username, password })
            });

            const d = await res.json();

            if (res.ok && d.success) {
                // Återställ felräknaren vid lyckad inloggning
                failedAttempts = 0;

                // SÄKERHETSNOTERING: localStorage för JWT är sårbart för XSS.
                // Det säkrare alternativet är att servern sätter en HttpOnly-cookie.
                localStorage.setItem('jwtToken', d.token);
                localStorage.setItem('userId', d.userId);
                localStorage.setItem('adminName', d.name);
                localStorage.setItem('userRole', d.role);

                showToast('Inloggad! Omdirigerar...', 'success');

                // Liten fördröjning för UX så att toasten hinns läsas
                setTimeout(() => {
                    if (d.role === 'user') window.location.href = 'user.html';
                    else window.location.href = 'admin.html';
                }, 500);
            } else {
                // Öka felräknaren och lås vid för många försök
                failedAttempts++;
                if (failedAttempts >= 5) {
                    lockedUntil = Date.now() + 30_000; // Lås i 30 sekunder
                    failedAttempts = 0;
                    showToast('För många misslyckade försök. Vänta 30 sekunder.', 'error');
                } else {
                    showToast(d.error || 'Fel användarnamn eller lösenord', 'error');
                }
                // Rensa lösenordsfältet vid fel för bättre UX
                passIn.value = '';
            }
        } catch (e) {
            showToast('Nätverksfel eller så är servern nere.', 'error');
        } finally {
            // Återställ knappen oavsett om det gick bra eller dåligt
            setButtonLoading(loginBtn, false, 'Logga in');
        }
    };

    if (loginBtn) loginBtn.onclick = doLogin;

    // Hantera Enter-knappen
    const handleEnter = (e) => { if (e.key === 'Enter') doLogin(); };
    if (userIn) userIn.onkeydown = handleEnter;
    if (passIn) passIn.onkeydown = handleEnter;

    // --- LÖSENORDSÅTERSTÄLLNING (Glömt lösenord) ---
    const forgotLink = document.getElementById('forgotPassLink');
    if (forgotLink) {
        forgotLink.onclick = (e) => {
            e.preventDefault();
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('forgotForm').style.display = 'block';
        };
    }

    const sendResetBtn = document.getElementById('sendResetBtn');
    if (sendResetBtn) {
        sendResetBtn.onclick = async () => {
            const email = document.getElementById('resetEmailInput').value.trim();

            // FIX: Ersätter den för svaga .includes('@')-kontrollen med regex-validering
            if (!isValidEmail(email)) {
                return showToast('Ange en giltig e-postadress', 'info');
            }

            setButtonLoading(sendResetBtn, true, 'Skicka länk');

            try {
                await fetch('/api/data-api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'request_reset', email })
                });

                // Visar alltid "success" oavsett om e-posten finns i databasen,
                // för att förhindra att angripare kan skanna vilka adresser som är registrerade.
                showToast('Länk skickad (om e-posten finns i systemet).', 'success');
                setTimeout(() => window.location.reload(), 2500);
            } catch (e) {
                showToast('Ett fel uppstod vid sändning.', 'error');
            } finally {
                setButtonLoading(sendResetBtn, false, 'Skicka länk');
            }
        };
    }

    const backToLoginLink = document.getElementById('backToLoginLink');
    if (backToLoginLink) {
        backToLoginLink.onclick = (e) => {
            e.preventDefault();
            document.getElementById('forgotForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
        };
    }
}

// ==========================================
// LÖSENORDSÅTERSTÄLLNING
// ==========================================

export function initReset() {
    const t = new URLSearchParams(window.location.search).get('token');

    // FIX: Informerar användaren och omdirigerar vid ogiltig/saknad token
    // istället för att avbryta tyst
    if (!t) {
        showToast('Ogiltig eller saknad återställningslänk.', 'error');
        setTimeout(() => { window.location.href = 'index.html'; }, 2500);
        return;
    }

    const resetBtn = document.getElementById('resetSubmitBtn');
    if (resetBtn) {
        resetBtn.onclick = async () => {
            const p1 = document.getElementById('newPassInput').value;
            const p2 = document.getElementById('confirmPassInput').value;

            if (p1 !== p2) return showToast('Lösenorden matchar ej', 'error');
            if (p1.length < 6) return showToast('Lösenordet måste vara minst 6 tecken', 'error');

            setButtonLoading(resetBtn, true, 'Spara nytt lösenord');

            try {
                const res = await fetch('/api/data-api', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'perform_reset', token: t, newPassword: p1 })
                });

                const data = await res.json();

                if (res.ok && data.success) {
                    showToast('Lösenord ändrat! Skickar dig till inloggningen...', 'success');
                    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
                } else {
                    // Visa exakt vad som blev fel från servern (t.ex. "Ogiltig länk")
                    showToast(data.error || 'Kunde inte återställa lösenordet', 'error');
                }
            } catch (e) {
                showToast('Nätverksfel vid återställning.', 'error');
            } finally {
                setButtonLoading(resetBtn, false, 'Spara nytt lösenord');
            }
        };
    }
}

/**
 * ============================================================================
 * AUTH.JS
 * Hanterar all logik kring autentisering på klientsidan (inloggning, glömt 
 * lösenord, och återställning). Sköter även rate-limiting på klientsidan för
 * att förhindra "brute force"-försök mot login-knappen.
 * ============================================================================
 */

import { showToast } from './utils.js';
import { fetchData } from './service.js';

// ==========================================
// HJÄLPFUNKTIONER
// ==========================================

/**
 * Hanterar visuell feedback för knappar under pågående nätverksanrop.
 * Disablar knappen och ändrar texten för att förhindra dubbelklick.
 * 
 * @param {HTMLElement} btn - Knapp-elementet som ska påverkas.
 * @param {boolean} isLoading - True om laddning pågår, annars false.
 * @param {string} originalText - Den text som ska återställas när laddningen är klar.
 */
export const setButtonLoading = (btn, isLoading, originalText) => {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.innerText = isLoading ? 'Laddar...' : originalText;
    btn.style.opacity = isLoading ? '0.7' : '1';
    btn.style.cursor = isLoading ? 'not-allowed' : 'pointer';
};

/**
 * Laddar och applicerar ett anpassat CSS-tema (Custom Theme) från API:et.
 * Används för att dynamiskt styla inloggningssidan.
 * Obs: För närvarande inaktiverad i initLogin().
 */
async function applyCustomTheme() {
    try {
        const settingsRes = await fetchData('settings');
        if (!settingsRes?.success || !settingsRes.data?.theme) return;

        const themesRes = await fetchData('custom_themes');
        if (!themesRes?.success) return;
        
        const theme = themesRes.data.find(x => x.id === settingsRes.data.theme);
        if (theme?.css) {
            const style = document.createElement('style');
            style.textContent = theme.css; // textContent istället för innerHTML för säkerhet
            document.head.appendChild(style);
        }
    } catch {
        // Ignorera tyst om temaladdningen misslyckas (avbryt inte inloggningen)
    }
}

/**
 * Validerar att en sträng är en korrekt formaterad e-postadress.
 * @param {string} email - E-postadressen att testa.
 * @returns {boolean} True om formatet är korrekt.
 */
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email);
}

// ==========================================
// INLOGGNING & GLÖMT LÖSENORD
// ==========================================

/**
 * Startar upp inloggningsskärmen (index.html).
 * Binder klick- och tangentbords-event till login-formuläret och
 * funktionen för att begära ett nytt lösenord.
 */
export function initLogin() {
 // applyCustomTheme(); 

    const loginBtn = document.getElementById('loginBtn');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');

    // Klientside-variabler för att förhindra spam
    let failedAttempts = 0;
    let lockedUntil = 0;

    /**
     * Validerar indata och skickar inloggningsförfrågan till backend.
     */
    const doLogin = async () => {
        // Säkerhetsstopp: Rate limiting
        if (Date.now() < lockedUntil) {
            const secsLeft = Math.ceil((lockedUntil - Date.now()) / 1000);
            return showToast(`För många försök. Vänta ${secsLeft} sekunder.`, 'error');
        }

        const username = userIn.value.trim();
        const password = passIn.value;

        if (!username || !password) {
            return showToast('Vänligen fyll i både användarnamn och lösenord.', 'info');
        }

        setButtonLoading(loginBtn, true, 'Logga in');

        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', username, password })
            });

            const d = await res.json();

            if (res.ok && d.success) {
                // Inloggning lyckades: Nollställ räknare och spara uppgifter i webläsaren
                failedAttempts = 0;

                localStorage.setItem('jwtToken', d.token);
                localStorage.setItem('userId', d.userId);
                localStorage.setItem('adminName', d.name);
                localStorage.setItem('userRole', d.role);

                showToast('Inloggad! Omdirigerar...', 'success');

                // Omdirigera till rätt vy baserat på användarroll
                setTimeout(() => {
                    if (d.role === 'user') window.location.href = 'user.html';
                    else window.location.href = 'admin.html';
                }, 500);
            } else {
                // Inloggning misslyckades
                failedAttempts++;
                if (failedAttempts >= 5) {
                    // Lås formuläret i 30 sekunder efter 5 misslyckade försök
                    lockedUntil = Date.now() + 30_000;
                    failedAttempts = 0;
                    showToast('För många misslyckade försök. Vänta 30 sekunder.', 'error');
                } else {
                    showToast(d.error || 'Fel användarnamn eller lösenord', 'error');
                }
                passIn.value = ''; // Rensa lösenordsfältet av säkerhetsskäl
            }
        } catch (e) {
            showToast('Nätverksfel eller så är servern nere.', 'error');
        } finally {
            setButtonLoading(loginBtn, false, 'Logga in');
        }
    };

    if (loginBtn) loginBtn.onclick = doLogin;

    // Tillåt att användaren trycker "Enter" för att logga in
    const handleEnter = (e) => { if (e.key === 'Enter') doLogin(); };
    if (userIn) userIn.onkeydown = handleEnter;
    if (passIn) passIn.onkeydown = handleEnter;

    // --- LÖSENORDSÅTERSTÄLLNING (Glömt lösenord) ---
    const forgotLink = document.getElementById('forgotPassLink');
    if (forgotLink) {
        forgotLink.onclick = (e) => {
            e.preventDefault();
            // Växla vy från Inloggning till Glömt Lösenord
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('forgotForm').style.display = 'block';
        };
    }

    const sendResetBtn = document.getElementById('sendResetBtn');
    if (sendResetBtn) {
        sendResetBtn.onclick = async () => {
            const email = document.getElementById('resetEmailInput').value.trim();

            if (!isValidEmail(email)) {
                return showToast('Ange en giltig e-postadress', 'info');
            }

            setButtonLoading(sendResetBtn, true, 'Skicka länk');

            try {
                await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'request_reset', email })
                });

                // Av säkerhetsskäl visas "success" oavsett om mailadressen fanns eller inte.
                // Detta förhindrar s.k. "User Enumeration Attacks" där hackare gissar mailadresser.
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
            // Växla vy tillbaka till Inloggning
            document.getElementById('forgotForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
        };
    }
}

// ==========================================
// UPPDATERA LÖSENORD (VIA MAIL-LÄNK)
// ==========================================

/**
 * Startar upp skärmen för lösenordsbyte (reset.html).
 * Laddas när användaren har klickat på återställningslänken i sitt mail.
 */
export function initReset() {
    // Hämta säkerhets-token från URL:en (t.ex. reset.html?token=123xyz)
    const t = new URLSearchParams(window.location.search).get('token');

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

            // Klientsides-validering
            if (p1 !== p2) return showToast('Lösenorden matchar ej', 'error');
            if (p1.length < 6) return showToast('Lösenordet måste vara minst 6 tecken', 'error');

            setButtonLoading(resetBtn, true, 'Spara nytt lösenord');

            try {
                const res = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'perform_reset', token: t, newPassword: p1 })
                });

                const data = await res.json();

                if (res.ok && data.success) {
                    showToast('Lösenord ändrat! Skickar dig till inloggningen...', 'success');
                    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
                } else {
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

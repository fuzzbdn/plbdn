import { showToast } from './utils.js';
import { fetchData } from './service.js'; // NYTT: Vi importerar vår router!

// ==========================================
// HJÄLPFUNKTIONER
// ==========================================

export const setButtonLoading = (btn, isLoading, originalText) => {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.innerText = isLoading ? 'Laddar...' : originalText;
    btn.style.opacity = isLoading ? '0.7' : '1';
    btn.style.cursor = isLoading ? 'not-allowed' : 'pointer';
};

/**
 * Laddar och applicerar ett anpassat CSS-tema från API:et.
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
            style.textContent = theme.css; // textContent istället för innerHTML
            document.head.appendChild(style);
        }
    } catch {
        // Ignorera tyst
    }
}

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

    let failedAttempts = 0;
    let lockedUntil = 0;

    const doLogin = async () => {
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
            // ÄNDRAT: Peka på den nya /api/auth istället för /api/data-api
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', username, password })
            });

            const d = await res.json();

            if (res.ok && d.success) {
                failedAttempts = 0;

                localStorage.setItem('jwtToken', d.token);
                localStorage.setItem('userId', d.userId);
                localStorage.setItem('adminName', d.name);
                localStorage.setItem('userRole', d.role);

                showToast('Inloggad! Omdirigerar...', 'success');

                setTimeout(() => {
                    if (d.role === 'user') window.location.href = 'user.html';
                    else window.location.href = 'admin.html';
                }, 500);
            } else {
                failedAttempts++;
                if (failedAttempts >= 5) {
                    lockedUntil = Date.now() + 30_000;
                    failedAttempts = 0;
                    showToast('För många misslyckade försök. Vänta 30 sekunder.', 'error');
                } else {
                    showToast(d.error || 'Fel användarnamn eller lösenord', 'error');
                }
                passIn.value = '';
            }
        } catch (e) {
            showToast('Nätverksfel eller så är servern nere.', 'error');
        } finally {
            setButtonLoading(loginBtn, false, 'Logga in');
        }
    };

    if (loginBtn) loginBtn.onclick = doLogin;

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

            if (!isValidEmail(email)) {
                return showToast('Ange en giltig e-postadress', 'info');
            }

            setButtonLoading(sendResetBtn, true, 'Skicka länk');

            try {
                // ÄNDRAT: Peka på den nya /api/auth
                await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'request_reset', email })
                });

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
                // ÄNDRAT: Peka på den nya /api/auth
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

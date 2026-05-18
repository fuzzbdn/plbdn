import { showToast } from './utils.js';

// --- HJÄLPFUNKTION: Hantera knappars laddningsstatus ---
const setButtonLoading = (btn, isLoading, originalText) => {
    if (!btn) return;
    btn.disabled = isLoading;
    btn.innerText = isLoading ? "Laddar..." : originalText;
    btn.style.opacity = isLoading ? "0.7" : "1";
    btn.style.cursor = isLoading ? "not-allowed" : "pointer";
};

export function initLogin() {
    // Laddar eventuellt anpassat tema (Snyggt löst!)
    fetch('/api/data-api?type=settings').then(r=>r.json()).then(s => { 
        if(s?.theme) {
            fetch('/api/data-api?type=custom_themes').then(r=>r.json()).then(themes => {
                const t = (themes||[]).find(x => x.id === s.theme);
                if(t) {
                    const style = document.createElement('style');
                    style.innerHTML = t.css;
                    document.head.appendChild(style);
                }
            });
        }
    }).catch(() => { /* Ignorera tyst om teman inte kan laddas */ });

    const loginBtn = document.getElementById('loginBtn');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');

    const doLogin = async () => {
        const username = userIn.value.trim();
        const password = passIn.value.trim();

        // 1. Frontend-validering (spara databasanrop)
        if (!username || !password) {
            return showToast("Vänligen fyll i både användarnamn och lösenord.", "info");
        }

        // 2. Sätt knapp i laddningsläge
        setButtonLoading(loginBtn, true, "Logga in");

        try {
            const res = await fetch('/api/data-api', { 
                method:'POST', 
                headers:{'Content-Type':'application/json'}, 
                body:JSON.stringify({ action: 'login', username, password }) 
            });
            
            const d = await res.json();
            
            if (res.ok && d.success) {
                // Säker inloggning som överlever att webbläsaren stängs
                localStorage.setItem('jwtToken', d.token); 
                localStorage.setItem('userId', d.userId);
                localStorage.setItem('adminName', d.name);
                localStorage.setItem('userRole', d.role); 
                
                showToast("Inloggad! Omdirigerar...", "success");
                
                setTimeout(() => {
                    if (d.role === 'user') window.location.href = "user.html";
                    else window.location.href = "admin.html";
                }, 500); // Liten fördröjning för UX så att toasten hinns med att läsas
            } else {
                showToast(d.error || "Fel användarnamn eller lösenord", "error");
                passIn.value = ""; // Rensa lösenordsfältet vid fel för bättre UX
            }
        } catch(e) { 
            showToast("Nätverksfel eller så är servern nere.", "error"); 
        } finally {
            // 3. Återställ knappen oavsett om det gick bra eller dåligt
            setButtonLoading(loginBtn, false, "Logga in");
        }
    };

    if(loginBtn) loginBtn.onclick = doLogin;
    
    // Hantera Enter-knappen
    const handleEnter = (e) => { if(e.key==='Enter') doLogin(); };
    if(userIn) userIn.onkeydown = handleEnter;
    if(passIn) passIn.onkeydown = handleEnter;

    // --- LÖSENORDSÅTERSTÄLLNING (Glömt lösenord) ---
    const forgotLink = document.getElementById('forgotPassLink');
    if (forgotLink) {
        forgotLink.onclick = (e) => { 
            e.preventDefault(); 
            document.getElementById('loginForm').style.display='none'; 
            document.getElementById('forgotForm').style.display='block'; 
        };
    }
    
    const sendResetBtn = document.getElementById('sendResetBtn');
    if (sendResetBtn) {
        sendResetBtn.onclick = async () => {
            const email = document.getElementById('resetEmailInput').value.trim();
            
            // Validering av e-postformat
            if(!email || !email.includes('@')) {
                return showToast("Ange en giltig e-postadress", "info");
            }
            
            setButtonLoading(sendResetBtn, true, "Skicka länk");
            
            try {
                await fetch('/api/data-api', { 
                    method:'POST', 
                    headers:{'Content-Type':'application/json'}, 
                    body:JSON.stringify({action:'request_reset', email}) 
                });
                
                // Vi visar alltid "success" oavsett om mailen fanns i databasen
                // för att inte hackare ska kunna skanna vilka mailadresser som finns i systemet.
                showToast("Länk skickad (om e-posten finns i systemet).", "success"); 
                setTimeout(() => window.location.reload(), 2500);
            } catch(e) {
                showToast("Ett fel uppstod vid sändning.", "error");
            } finally {
                setButtonLoading(sendResetBtn, false, "Skicka länk");
            }
        };
    }
    
    const backToLoginLink = document.getElementById('backToLoginLink');
    if (backToLoginLink) {
        backToLoginLink.onclick = (e) => {
            e.preventDefault();
            document.getElementById('forgotForm').style.display='none';
            document.getElementById('loginForm').style.display='block';
        };
    }
}

export function initReset() {
    const t = new URLSearchParams(window.location.search).get('token');
    if(!t) return; 

    const resetBtn = document.getElementById('resetSubmitBtn');
    if (resetBtn) {
        resetBtn.onclick = async () => {
            const p1 = document.getElementById('newPassInput').value;
            const p2 = document.getElementById('confirmPassInput').value;
            
            if (p1 !== p2) return showToast("Lösenorden matchar ej", "error");
            if (p1.length < 6) return showToast("Lösenordet måste vara minst 6 tecken", "error");
            
            setButtonLoading(resetBtn, true, "Spara nytt lösenord");
            
            try {
                const res = await fetch('/api/data-api', { 
                    method:'POST', 
                    headers:{'Content-Type':'application/json'}, 
                    body:JSON.stringify({action:'perform_reset', token:t, newPassword:p1}) 
                });
                
                const data = await res.json();
                
                if (res.ok && data.success) { 
                    showToast("Lösenord ändrat! Skickar dig till inloggningen...", "success"); 
                    setTimeout(() => { window.location.href="index.html"; }, 2000);
                } else {
                    // Visa exakt vad som blev fel från servern (t.ex "Ogiltig länk")
                    showToast(data.error || "Kunde inte återställa lösenordet", "error");
                }
            } catch (e) {
                showToast("Nätverksfel vid återställning.", "error");
            } finally {
                setButtonLoading(resetBtn, false, "Spara nytt lösenord");
            }
        };
    }
}

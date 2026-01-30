import { showToast } from './utils.js';

/* =========================================
   HANTERA INLOGGNINGSSIDAN (index.html)
   ========================================= */
export function initLogin() {
    // 1. LADDNING AV TEMA
    // Hämtar inställningar från servern för att se om ett anpassat tema ska användas
    fetch('/api/data-api?type=settings').then(r=>r.json()).then(s => { 
        if(s?.theme) {
            // Om ett tema är valt, hämta listan på teman och applicera CSS
            fetch('/api/data-api?type=custom_themes').then(r=>r.json()).then(themes => {
                const t = (themes||[]).find(x => x.id === s.theme);
                if(t) {
                    const style = document.createElement('style');
                    style.innerHTML = t.css;
                    document.head.appendChild(style);
                }
            });
        }
    });

    // Hämta referenser till HTML-elementen
    const loginBtn = document.getElementById('loginBtn');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');

    // 2. INLOGGNINGSFUNKTION
    const doLogin = async () => {
        try {
            // Skicka användarnamn och lösenord till API:et
            const res = await fetch('/api/data-api', { 
                method:'POST', 
                headers:{'Content-Type':'application/json'}, 
                body:JSON.stringify({
                    action:'login', 
                    username:userIn.value.trim(), 
                    password:passIn.value.trim()
                }) 
            });
            
            const d = await res.json();
            
            // Om inloggningen lyckades
            if(d.success) {
                // Spara JWT-token och användarinfo i webbläsarens sessionsminne
                sessionStorage.setItem('jwtToken', d.token); 
                sessionStorage.setItem('adminUser', d.user); 
                sessionStorage.setItem('adminName', d.name);
                
                // Skicka vidare användaren till adminsidan
                window.location.href = "admin.html";
            } else {
                showToast("Fel användarnamn eller lösenord", "error");
            }
        } catch(e) { showToast("Serverfel vid inloggning", "error"); }
    };

    // Koppla klick på knappen till funktionen
    if(loginBtn) loginBtn.onclick = doLogin;
    
    // Gör så att man kan trycka "Enter" i input-fälten för att logga in
    const handleEnter = (e) => { if(e.key==='Enter') doLogin(); };
    if(userIn) userIn.onkeydown = handleEnter;
    if(passIn) passIn.onkeydown = handleEnter;

    // 3. GLÖMT LÖSENORD-HANTERING
    // Växla vy: Dölj inloggning, visa återställningsformulär
    document.getElementById('forgotPassLink').onclick = (e) => { 
        e.preventDefault(); 
        document.getElementById('loginForm').style.display='none'; 
        document.getElementById('forgotForm').style.display='block'; 
    };
    
    // Skicka begäran om återställningslänk
    document.getElementById('sendResetBtn').onclick = async () => {
        const email = document.getElementById('resetEmailInput').value;
        if(!email) return showToast("Ange e-post", "info");
        
        await fetch('/api/data-api', { 
            method:'POST', 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify({action:'request_reset', email}) 
        });
        
        showToast("Länk skickad (om e-posten finns).", "success"); 
        // Ladda om sidan efter 2 sekunder för att komma tillbaka till start
        setTimeout(() => window.location.reload(), 2000);
    };
    
    // Knapp för att gå tillbaka till inloggning utan att skicka mail
    document.getElementById('backToLoginLink').onclick = (e) => {
        e.preventDefault();
        document.getElementById('forgotForm').style.display='none';
        document.getElementById('loginForm').style.display='block';
    }
}

/* =========================================
   HANTERA ÅTERSTÄLLNINGSSIDAN (reset.html)
   Används när användaren klickat på länken i mailet.
   ========================================= */
export function initReset() {
    // Hämta den unika token från webbadressen (URL)
    const t = new URLSearchParams(window.location.search).get('token');
    if(!t) return; // Om ingen token finns, gör ingenting

    // När användaren sparar det nya lösenordet
    document.getElementById('resetSubmitBtn').onclick = async () => {
        const p1 = document.getElementById('newPassInput').value;
        const p2 = document.getElementById('confirmPassInput').value;
        
        // Validera att lösenorden matchar
        if(p1!==p2) return showToast("Lösenorden matchar ej", "error");
        
        // Skicka det nya lösenordet och token till servern
        const res = await fetch('/api/data-api', { 
            method:'POST', 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify({action:'perform_reset', token:t, newPassword:p1}) 
        });
        
        if(res.ok) { 
            showToast("Lösenord ändrat!", "success"); 
            window.location.href="index.html"; // Skicka användaren till inloggningen
        } else {
            showToast("Kunde inte återställa", "error");
        }
    };
}

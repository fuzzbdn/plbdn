import { showToast } from './utils.js';

/* =========================================
   HANTERA INLOGGNINGSSIDAN (index.html)
   ========================================= */
export function initLogin() {
    // 1. LADDNING AV TEMA
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
    });

    const loginBtn = document.getElementById('loginBtn');
    const userIn = document.getElementById('usernameInput');
    const passIn = document.getElementById('passwordInput');

    // 2. INLOGGNINGSFUNKTION
    const doLogin = async () => {
        try {
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
            
            if(d.success) {
                sessionStorage.setItem('jwtToken', d.token); 
                sessionStorage.setItem('adminUser', d.user); 
                sessionStorage.setItem('adminName', d.name);
                
                window.location.href = "admin.html";
            } else {
                showToast("Fel användarnamn eller lösenord", "error");
            }
        } catch(e) { showToast("Serverfel vid inloggning", "error"); }
    };

    if(loginBtn) loginBtn.onclick = doLogin;
    
    const handleEnter = (e) => { if(e.key==='Enter') doLogin(); };
    if(userIn) userIn.onkeydown = handleEnter;
    if(passIn) passIn.onkeydown = handleEnter;

    // 3. GLÖMT LÖSENORD-HANTERING
    document.getElementById('forgotPassLink').onclick = (e) => { 
        e.preventDefault(); 
        document.getElementById('loginForm').style.display='none'; 
        document.getElementById('forgotForm').style.display='block'; 
    };
    
    document.getElementById('sendResetBtn').onclick = async () => {
        const email = document.getElementById('resetEmailInput').value;
        if(!email) return showToast("Ange e-post", "info");
        
        await fetch('/api/data-api', { 
            method:'POST', 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify({action:'request_reset', email}) 
        });
        
        showToast("Länk skickad (om e-posten finns).", "success"); 
        setTimeout(() => window.location.reload(), 2000);
    };
    
    document.getElementById('backToLoginLink').onclick = (e) => {
        e.preventDefault();
        document.getElementById('forgotForm').style.display='none';
        document.getElementById('loginForm').style.display='block';
    }
}

/* =========================================
   HANTERA ÅTERSTÄLLNINGSSIDAN (reset.html)
   ========================================= */
export function initReset() {
    const t = new URLSearchParams(window.location.search).get('token');
    if(!t) return; 

    document.getElementById('resetSubmitBtn').onclick = async () => {
        const p1 = document.getElementById('newPassInput').value;
        const p2 = document.getElementById('confirmPassInput').value;
        
        if(p1 !== p2) return showToast("Lösenorden matchar ej", "error");
        if(p1.length < 6) return showToast("Lösenordet måste vara minst 6 tecken", "error");
        
        const res = await fetch('/api/data-api', { 
            method:'POST', 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify({action:'perform_reset', token:t, newPassword:p1}) 
        });
        
        const data = await res.json();
        
        if(res.ok && data.success) { 
            showToast("Lösenord ändrat! Skickar dig till inloggningen...", "success"); 
            // Vänta 2 sekunder innan vi skickar användaren vidare
            setTimeout(() => {
                window.location.href="index.html"; 
            }, 2000);
        } else {
            // Visar felmeddelande från API:et, t.ex. om länken har gått ut
            showToast(data.error || "Kunde inte återställa lösenordet", "error");
        }
    };
}

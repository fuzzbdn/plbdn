import { showToast } from './utils.js';

export function initLogin() {
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
                sessionStorage.setItem('userRole', d.role);
                
                // SKICKA TILL RÄTT SIDA BASERAT PÅ ROLL
                if (d.role === 'admin') {
                    window.location.href = "admin.html";
                } else {
                    window.location.href = "user.html";
                }
            } else {
                showToast("Fel användarnamn eller lösenord", "error");
            }
        } catch(e) { showToast("Serverfel vid inloggning", "error"); }
    };

    if(loginBtn) loginBtn.onclick = doLogin;
    const handleEnter = (e) => { if(e.key==='Enter') doLogin(); };
    if(userIn) userIn.onkeydown = handleEnter;
    if(passIn) passIn.onkeydown = handleEnter;

    // Glömt lösenord (Samma som innan)
    document.getElementById('forgotPassLink').onclick = (e) => { 
        e.preventDefault(); 
        document.getElementById('loginForm').style.display='none'; 
        document.getElementById('forgotForm').style.display='block'; 
    };
    document.getElementById('sendResetBtn').onclick = async () => {
        const email = document.getElementById('resetEmailInput').value;
        if(!email) return showToast("Ange e-post", "info");
        await fetch('/api/data-api', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'request_reset', email}) });
        showToast("Länk skickad (om e-posten finns).", "success"); 
        setTimeout(() => window.location.reload(), 2000);
    };
    document.getElementById('backToLoginLink').onclick = (e) => {
        e.preventDefault();
        document.getElementById('forgotForm').style.display='none';
        document.getElementById('loginForm').style.display='block';
    }
}

export function initReset() { /* Samma som innan */ }

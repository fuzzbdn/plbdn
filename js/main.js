import { initLogin, initReset } from './auth.js';
import { initAdmin } from './admin.js';
import { initUser } from './user.js'; // <-- NY
import { initDisplay } from './display.js';
import { initSettings } from './settings.js';

document.addEventListener('DOMContentLoaded', () => {
    const pageId = document.body.id;
    console.log("Startar modul för sida:", pageId);

    if (pageId === 'page-login') initLogin();
    else if (pageId === 'page-reset') initReset();
    else if (pageId === 'page-admin') initAdmin();
    else if (pageId === 'page-user') initUser(); // <-- NY
    else if (pageId === 'page-display') initDisplay();
    else if (pageId === 'page-settings') initSettings(); 
});

window.openTab = function(tabId) {
    const allPanes = document.querySelectorAll('.tab-pane');
    allPanes.forEach(pane => {
        pane.classList.remove('active');
        pane.style.display = 'none';
    });
    const allBtns = document.querySelectorAll('.tab-btn');
    allBtns.forEach(btn => {
        btn.classList.remove('active');
    });
    const targetPane = document.getElementById(tabId);
    if (targetPane) {
        targetPane.classList.add('active');
        targetPane.style.display = 'block';
    }
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
};

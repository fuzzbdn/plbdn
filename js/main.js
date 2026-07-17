import { APP_VERSION } from './config.js';
import { initLogin, initReset } from './auth.js';
import { initAdmin } from './admin/core.js';
import { initUserView } from './user.js';
import { initDisplay } from './display.js';

// NYTT: Vi importerar nu från vår nya core-fil istället för den gamla settings.js!
import { initSettings } from './settings/core.js'; 

document.addEventListener('DOMContentLoaded', () => {
    // Skriv ut versionen på alla sidor som har ett .version-tag-element
    document.querySelectorAll('.version-tag').forEach(tag => {
        tag.innerText = APP_VERSION;
    });

    const pageId = document.body.id;

    const pages = {
        'page-login':    initLogin,
        'page-reset':    initReset,
        'page-admin':    initAdmin,
        'page-user':     initUserView,
        'page-display':  initDisplay,
        'page-settings': initSettings,
    };

    const initFn = pages[pageId];
    if (initFn) {
        initFn();
    }
});

/**
 * Globalt tillgänglig flik-växlare för HTML onclick-attribut.
 */
window.openTab = function(tabId, event) {
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    const targetPane = document.getElementById(tabId);
    if (targetPane) targetPane.classList.add('active');

    if (event?.currentTarget) event.currentTarget.classList.add('active');
};

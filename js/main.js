import { APP_VERSION } from './config.js';
import { initLogin, initReset } from './auth.js';
import { initAdmin } from './admin.js';
import { initUserView } from './user.js';
import { initDisplay } from './display.js';
import { initSettings } from './settings.js';

document.addEventListener('DOMContentLoaded', () => {
    // Skriv ut versionen på alla sidor som har ett .version-tag-element
    document.querySelectorAll('.version-tag').forEach(tag => {
        tag.innerText = APP_VERSION;
    });

    // FIX: Dubbellogiken för page-login/reset.html är borttagen.
    // Varje sida känns igen uteslutande via sitt unika body-id.
    // Se till att reset.html har id="page-reset" på body-elementet.
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
    // FIX: console.log borttagen – läcker information om sidstrukturen i produktion
});

/**
 * Globalt tillgänglig flik-växlare för HTML onclick-attribut.
 *
 * FIX: Tar nu emot `event` som explicit parameter istället för att läsa
 * från window.event (föråldrad IE-rest som inte stöds i alla webbläsare).
 *
 * FIX: Synlighet styrs nu enbart via CSS-klassen `.active` – inline
 * style.display är borttagen för att undvika konflikt med CSS-regler.
 * Lägg till följande i din CSS om det inte redan finns:
 *   .tab-pane          { display: none; }
 *   .tab-pane.active   { display: block; }
 *
 * Anrop i HTML: <button class="tab-btn" onclick="openTab('tab-id', event)">...</button>
 *
 * @param {string} tabId - ID:t på det tab-pane som ska visas.
 * @param {Event} event  - Klick-eventet från knappen.
 */
window.openTab = function(tabId, event) {
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    const targetPane = document.getElementById(tabId);
    if (targetPane) targetPane.classList.add('active');

    if (event?.currentTarget) event.currentTarget.classList.add('active');
};

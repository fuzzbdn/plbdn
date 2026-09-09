/**
 * ============================================================================
 * MAIN.JS - Applikationens Huvudentré (Entry Point & Router)
 * ============================================================================
 * Denna fil laddas på alla HTML-sidor i systemet. Den fungerar som en "Router"
 * som tittar på sidans <body>-ID och avgör vilken modul som ska startas.
 * Här ligger även globala funktioner som måste vara tillgängliga överallt.
 */

import { APP_VERSION } from './config.js';
import { initLogin, initReset } from './auth.js';
import { initAdmin } from './admin/core.js';
import { initUserView } from './user.js';
import { initDisplay } from './display.js';
import { initSettings } from './settings/core.js'; 

/**
 * Körs automatiskt när hela HTML-dokumentet har laddats klart.
 * Initierar rätt skript för rätt sida.
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Versionering: Hittar alla element med klassen .version-tag (t.ex. sidfoten)
    // och skriver in det aktuella versionsnumret från config.js.
    document.querySelectorAll('.version-tag').forEach(tag => {
        tag.innerText = APP_VERSION;
    });

    // 2. Routing: Hämtar ID:t från sidans <body>-tagg (t.ex. "page-admin").
    const pageId = document.body.id;

    // Mappar sid-ID till rätt startfunktion.
    const pages = {
        'page-login':    initLogin,      // Inloggningssidan
        'page-reset':    initReset,      // Återställ lösenord
        'page-admin':    initAdmin,      // Planeringsvyn (Admin)
        'page-user':     initUserView,   // Mitt Schema (Personal)
        'page-display':  initDisplay,    // TV-skärmsvyn
        'page-settings': initSettings,   // Inställningssidan
    };

    // Leta upp funktionen för den aktuella sidan och kör den om den finns
    const initFn = pages[pageId];
    if (initFn) {
        initFn();
    }
});

/**
 * Globalt tillgänglig flik-växlare (Tab Switcher).
 * Måste sitta på 'window'-objektet eftersom den anropas direkt från 
 * HTML-kodens 'onclick'-attribut (t.ex. onclick="openTab('tab1', event)").
 * 
 * @param {string} tabId - ID:t på den flik-panel (tab-pane) som ska visas.
 * @param {Event} event - Klick-eventet från knappen, för att kunna markera den som aktiv.
 */
window.openTab = function(tabId, event) {
    // Dölj alla paneler och avmarkera alla flik-knappar
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    // Visa den valda panelen
    const targetPane = document.getElementById(tabId);
    if (targetPane) targetPane.classList.add('active');

    // Markera den klickade knappen som aktiv (får en mörkare färg/understrykning via CSS)
    if (event?.currentTarget) event.currentTarget.classList.add('active');
};

/**
 * ============================================================================
 * CONFIG.JS
 * Central konfigurationsfil för applikationen.
 * Innehåller globala konstanter och inställningar som används över hela systemet.
 * ============================================================================
 */

/**
 * Applikationens aktuella versionsnummer.
 * Uppdatera denna sträng vid nya releaser. Denna variabel ritas automatiskt ut
 * på alla sidor i gränssnittet (oftast i sidfoten) via main.js.
 * @constant {string}
 */
export const APP_VERSION = "v3.13";

/**
 * Svenska namn för veckans dagar.
 * Används konsekvent i hela gränssnittet (t.ex. i veckovyn och på TV-skärmen)
 * för att översätta JavaScripts inbyggda (engelska/sifferbaserade) datumformat.
 * Obs: Arrayen börjar på Måndag (index 0) enligt svensk kalenderstandard (ISO 8601).
 * @constant {Array<string>}
 */
export const DAYS = [
    "Måndag", 
    "Tisdag", 
    "Onsdag", 
    "Torsdag", 
    "Fredag", 
    "Lördag", 
    "Söndag"
];

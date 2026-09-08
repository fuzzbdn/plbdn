/**
 * ============================================================================
 * API / _PUSHER.JS (Backend)
 * Hanterar realtidsuppdateringar via WebSockets (Pusher).
 * Används för att omedelbart uppdatera TV-skärmarna ute på arbetsplatserna
 * så fort en administratör klickar på "Publicera" i schemat.
 * ============================================================================
 */

import Pusher from 'pusher';

// Varna i serverloggarna om nycklar saknas (t.ex. vid ny deployment)
if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET || !process.env.PUSHER_CLUSTER) {
    console.error('VARNING: Pusher-miljövariabler saknas. Displayen kommer inte få realtidsuppdateringar.');
}

/**
 * Initiera Pusher-klienten med inställningar från miljövariablerna.
 * useTLS: true tvingar krypterad anslutning över HTTPS/WSS.
 */
export const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

/**
 * Skickar en signal till en specifik arbetsplats TV-skärm(ar) om att 
 * ett nytt schema har publicerats.
 * 
 * SÄKERHET ("Thin Payload"):
 * Vi skickar INTE själva schemadatan över Pusher - bara en signal.
 * När displayen tar emot signalen måste den fortfarande autentisera sig 
 * (med JWT) mot vårt eget API för att hämta datan.
 * 
 * DESIGN ("Fire and forget"): 
 * Om Pusher är nere ska det aldrig krascha backend. Därför loggar vi 
 * bara felet istället för att kasta (throw) det vidare.
 * 
 * @param {string} workplaceId - Arbetsplatsen som ska notifieras
 */
export function notifyScheduleUpdated(workplaceId) {
    pusher.trigger(`workplace-${workplaceId}`, 'schedule-updated', {
        timestamp: Date.now()
    }).catch(err => {
        console.error('Kunde inte skicka Pusher-notis:', err.message);
    });
}

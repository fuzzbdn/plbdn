// ============================================================================
// _PUSHER.JS - Realtidsnotiser till display-skärmar
// ============================================================================

import Pusher from 'pusher';

if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET || !process.env.PUSHER_CLUSTER) {
    console.error('VARNING: Pusher-miljövariabler saknas. Displayen kommer inte få realtidsuppdateringar.');
}

export const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

/**
 * Skickar en signal till en arbetsplats displayskärm(ar) om att schemat uppdaterats.
 * Vi skickar INTE själva schemadatan över Pusher - bara en signal - så att
 * displayen fortfarande måste autentisera sig mot vårt eget API för att hämta datan.
 * Detta är "fire and forget": om Pusher skulle vara nere ska det aldrig
 * krascha en publicering.
 */
export function notifyScheduleUpdated(workplaceId) {
    pusher.trigger(`workplace-${workplaceId}`, 'schedule-updated', {
        timestamp: Date.now()
    }).catch(err => console.error('Kunde inte skicka Pusher-notis:', err.message));
}

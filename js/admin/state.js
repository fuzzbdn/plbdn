/**
 * ============================================================================
 * STATE.JS (Admin/Planering)
 * Hanterar det lokala tillståndet (state) specifikt för administratörens 
 * planeringsvy. Innehåller även dedikerade hjälpfunktioner för schemaläggningen
 * såsom datumuträkningar och namnhantering.
 * ============================================================================
 */

import { getAbsences } from '../store.js';

// ==========================================
// TILLSTÅND (State)
// ==========================================
/**
 * Globalt tillstånd specifikt för planeringsvyn.
 * Detta objekt styr vad som visas på skärmen just nu utan att vi behöver
 * läsa av DOM:en (HTML-elementen) hela tiden.
 */
export const adminState = {
    selectedWeek: 0,           // Aktuellt veckonummer
    selectedYear: 0,           // Aktuellt år
    currentAdminDayIndex: 0,   // Vilken veckodag vi tittar på (0 = Måndag, 6 = Söndag)
    isWeeklyView: false,       // Om true ritas hela veckan ut (Veckovy), annars Dagsvy
    datesOfWeek: []            // Array med 7 datumsträngar (YYYY-MM-DD) för den aktiva veckan
};

// ==========================================
// HJÄLPFUNKTIONER
// ==========================================

/**
 * Läser av valt datum direkt från datumväljaren i gränssnittet.
 * Om datumväljaren inte finns (t.ex. vid första laddningen), faller den 
 * tillbaka på dagens datum.
 * 
 * @returns {string} Datum i formatet YYYY-MM-DD.
 */
export function getCurrentPickerDate() {
    const picker = document.getElementById('adminDatePicker');
    return picker ? picker.value : new Date().toISOString().split('T')[0];
}

/**
 * Utvärderar och returnerar det "bästa" namnet att visa för en användare.
 * Prioritetsordning: Visningsnamn -> Förnamn + Efternamn -> Användarnamn.
 * 
 * @param {Object} u - Användarobjektet från databasen.
 * @returns {string} Ett snyggt formaterat namn.
 */
export function getFriendlyName(u) {
    if (!u) return '';
    if (u.display_name) return u.display_name;
    if (u.first_name) return `${u.first_name} ${u.last_name || ''}`.trim();
    return u.username;
}

/**
 * Tar ett specifikt datum och räknar ut alla 7 datum (Måndag till Söndag) 
 * för den veckan som datumet tillhör.
 * Tar hänsyn till svensk standard (Måndag = första dagen) och lokala tidszoner.
 * 
 * @param {string} dateStr - Startdatumet (YYYY-MM-DD).
 * @returns {Array<string>} En array med 7 datumsträngar (YYYY-MM-DD).
 */
export function getDatesOfWeek(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    
    // JS räknar Söndag som 0. Om det är söndag, backa 6 dagar för att hitta Måndag.
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    
    const monday = new Date(d);
    monday.setDate(diff);
    
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const temp = new Date(monday);
        temp.setDate(monday.getDate() + i);
        // Använd timezone-offset för att garantera att datumen inte hoppar ett dygn 
        // bakåt om servern/datorn ligger i en viss tidszon (t.ex. UTC vs CEST).
        const tzoffset = temp.getTimezoneOffset() * 60000;
        dates.push((new Date(temp.getTime() - tzoffset)).toISOString().slice(0, 10));
    }
    return dates;
}

/**
 * Kontrollerar om en specifik användare är frånvarande (Sjuk/Semester/VAB) 
 * ett specifikt datum. Läser datan blixtsnabbt från den centrala cachen (store.js).
 * 
 * @param {string|number} userId - Användarens ID.
 * @param {string} dateStr - Datumet som ska kontrolleras (YYYY-MM-DD).
 * @returns {Object|undefined} Returnerar frånvaro-objektet om personen är frånvarande, annars undefined.
 */
export function getUserAbsence(userId, dateStr) {
    const absences = getAbsences() || [];
    return absences.find(a =>
        String(a.user_id) === String(userId) &&
        dateStr >= a.start_date.split('T')[0] &&
        dateStr <= a.end_date.split('T')[0]
    );
}

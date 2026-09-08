/**
 * ============================================================================
 * STORE.JS - Centraliserad datahantering (State Management)
 * ============================================================================
 * Denna fil fungerar som applikationens "Single Source of Truth" (enda sanning).
 * Istället för att göra nya API-anrop varje gång vi behöver ett namn eller en färg,
 * sparar vi grunddatan här i minnet. Alla andra filer kan sedan hämta (get) 
 * eller uppdatera (set) datan centralt.
 */

/**
 * Det privata tillståndet (state). Kan inte ändras direkt utifrån, 
 * utan måste ändras via våra "setters" nedan.
 */
const state = {
    scheduleData: {},
    users: [],
    stations: [],
    shifts: [],
    absences: [],
    customThemes: []
};

// ==========================================
// GETTERS (Läs data)
// ==========================================

/** @returns {Object} Hela det publicerade schemat, grupperat på pass. */
export const getScheduleData = () => state.scheduleData;

/** @returns {Array} Lista över all personal. */
export const getUsers = () => state.users;

/** @returns {Array} Lista över alla arbetsstationer/platser. */
export const getStations = () => state.stations;

/** @returns {Array} Lista över alla arbetspass (tider). */
export const getShifts = () => state.shifts;

/** @returns {Array} Lista över all frånvaro (sjuk, semester, etc). */
export const getAbsences = () => state.absences;

/** @returns {Array} Lista över skapade CSS-teman för TV-skärmen. */
export const getCustomThemes = () => state.customThemes;


// ==========================================
// SETTERS (Uppdatera data)
// ==========================================
// Dessa funktioner säkerställer att vi alltid sparar en array, 
// även om API:et av misstag skulle skicka tillbaka null eller undefined.

export const setUsers = (data) => { state.users = Array.isArray(data) ? data : []; };
export const setStations = (data) => { state.stations = Array.isArray(data) ? data : []; };
export const setShifts = (data) => { state.shifts = Array.isArray(data) ? data : []; };
export const setAbsences = (data) => { state.absences = Array.isArray(data) ? data : []; };
export const setCustomThemes = (data) => { state.customThemes = Array.isArray(data) ? data : []; };

/**
 * Tar emot en platt lista med schemadata från databasen och bygger om den till ett
 * uppslagsverk (Dictionary/Object) för snabbare rendering i gränssnittet.
 * 
 * @param {Array} rawData - Platt lista med pass från databasen.
 */
export const setScheduleData = (rawData) => {
    state.scheduleData = {};
    if (Array.isArray(rawData)) {
        rawData.forEach(row => {
            // Skapar en unik nyckel för varje specifik "cell" i schemat
            // Exempel: "2026-09-08_12_4" (Datum_StationID_ShiftID)
            const localDate = row.work_date.split('T')[0];
            const key = `${localDate}_${row.station_id}_${row.shift_id}`;
            
            // Om nyckeln inte finns ännu, skapa en tom array
            if (!state.scheduleData[key]) state.scheduleData[key] = [];
            
            // Lägg till personen i rätt pass
            state.scheduleData[key].push(row);
        });
    }
};

/**
 * Hjälpfunktion för att fylla hela statet på en och samma gång.
 * Används ofta vid initialisering (när sidan laddas första gången) 
 * via ett Promise.all()-anrop.
 * 
 * @param {Object} data - Ett objekt som innehåller all data som ska sparas.
 */
export const setAllInitialData = ({ users, stations, shifts, absences, themes, scheduleData }) => {
    if (users) setUsers(users);
    if (stations) setStations(stations);
    if (shifts) setShifts(shifts);
    if (absences) setAbsences(absences);
    if (themes) setCustomThemes(themes);
    if (scheduleData) setScheduleData(scheduleData);
};

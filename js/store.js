// ==========================================
// STORE.JS - Centraliserad datahantering
// ==========================================

const state = {
    scheduleData: {},
    users: [],
    stations: [],
    shifts: [],
    absences: [],
    customThemes: []
};

// --- GETTERS (Hämta data) ---
export const getScheduleData = () => state.scheduleData;
export const getUsers = () => state.users;
export const getStations = () => state.stations;
export const getShifts = () => state.shifts;
export const getAbsences = () => state.absences;
export const getCustomThemes = () => state.customThemes;

// --- SETTERS (Uppdatera data) ---
export const setUsers = (data) => { state.users = Array.isArray(data) ? data : []; };
export const setStations = (data) => { state.stations = Array.isArray(data) ? data : []; };
export const setShifts = (data) => { state.shifts = Array.isArray(data) ? data : []; };
export const setAbsences = (data) => { state.absences = Array.isArray(data) ? data : []; };
export const setCustomThemes = (data) => { state.customThemes = Array.isArray(data) ? data : []; };

export const setScheduleData = (rawData) => {
    state.scheduleData = {};
    if (Array.isArray(rawData)) {
        rawData.forEach(row => {
            // Används för admin/user-vyn
            const localDate = row.work_date.split('T')[0];
            const key = `${localDate}_${row.station_id}_${row.shift_id}`;
            
            if (!state.scheduleData[key]) state.scheduleData[key] = [];
            state.scheduleData[key].push(row);
        });
    }
};

// Hjälpfunktion för att hämta allt på en gång (t.ex. vid initialisering)
export const setAllInitialData = ({ users, stations, shifts, absences, themes }) => {
    if (users) setUsers(users);
    if (stations) setStations(stations);
    if (shifts) setShifts(shifts);
    if (absences) setAbsences(absences);
    if (themes) setCustomThemes(themes);
};

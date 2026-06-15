// js/store.js
export const state = {
    scheduleData: {},
    users: [],
    stations: [],
    shifts: []
};

export function setUsers(data) { state.users = data; }
export function getUsers() { return state.users; }

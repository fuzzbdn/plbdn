import { getAbsences } from '../store.js';

// Globalt tillstånd specifikt för planeringsvyn
export const adminState = {
    selectedWeek: 0,
    selectedYear: 0,
    currentAdminDayIndex: 0,
    isWeeklyView: false,
    datesOfWeek: []
};

// --- HJÄLPFUNKTIONER ---

export function getCurrentPickerDate() {
    const picker = document.getElementById('adminDatePicker');
    return picker ? picker.value : new Date().toISOString().split('T')[0];
}

export function getFriendlyName(u) {
    if (!u) return '';
    if (u.display_name) return u.display_name;
    if (u.first_name) return `${u.first_name} ${u.last_name || ''}`.trim();
    return u.username;
}

export function getDatesOfWeek(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    
    const monday = new Date(d);
    monday.setDate(diff);
    
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const temp = new Date(monday);
        temp.setDate(monday.getDate() + i);
        const tzoffset = temp.getTimezoneOffset() * 60000;
        dates.push((new Date(temp.getTime() - tzoffset)).toISOString().slice(0, 10));
    }
    return dates;
}

export function getUserAbsence(userId, dateStr) {
    const absences = getAbsences() || [];
    return absences.find(a =>
        String(a.user_id) === String(userId) &&
        dateStr >= a.start_date.split('T')[0] &&
        dateStr <= a.end_date.split('T')[0]
    );
}

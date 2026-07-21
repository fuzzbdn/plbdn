/* =========================================
   CSS/USER.CSS
   Stilar för user.html (Mitt schema).
   Kräver: css/base.css + css/admin.css
   ========================================= */

/*
   Mobilvyn för user.html är skriven med
   mobil-first-principen: grundstilar gäller
   på mobil, @media (min-width: 769px) lägger
   till desktopstilarna ovanpå.
   Ingen !important behövs.
*/

/* =========================================
   GRUNDSTIL (mobil, < 769px)
   ========================================= */

/* Dölj spök-text från ::before/::after som
   ärvs från admin.css veckovy-selektorer */
#page-user .weekly-cell::before,
#page-user .weekly-cell::after {
    display: none;
    content: none;
}

/* Dölj namn-etiketten i "Visa endast mitt"-knappen */
#page-user #toggleMyScheduleBtn .user-name-label {
    display: none;
}

/* --- HEADER (mobil) --- */
#page-user .admin-header {
    padding: 20px 15px;
    position: relative;
    height: auto;
}

#page-user .header-content {
    display: grid;
    grid-template-columns: 50px 1fr 1fr 50px;
    gap: 15px 10px;
    align-items: stretch;
    padding: 0;
}

#page-user .header-content > div,
#page-user .header-datepicker,
#page-user .date-navigation {
    display: contents;
}

/* Dölj element som tar onödig plats på mobil */
#page-user #currentUserDisplay,
#page-user .header-datepicker label,
#page-user .date-navigation > *:not(button) {
    display: none;
}

/* Rad 1: Rubrik (vänster) + Logga ut (höger) */
#page-user h1 {
    grid-column: 1 / 4;
    grid-row: 1;
    font-size: 2.2rem;
    margin: 0;
    color: #0277bd;
    text-align: left;
    align-self: center;
}

#page-user #logoutBtn {
    grid-column: 4 / 5;
    grid-row: 1;
    background: #fee2e2;
    color: #dc2626;
    border: none;
    padding: 8px 0;
    border-radius: 20px;
    font-weight: 800;
    font-size: 0.85rem;
    box-shadow: none;
    margin: 0;
    width: 100%;
    text-align: center;
    align-self: center;
}

/* Rad 2: Vänsterpil, Datumväljare, Högerpil */
#page-user .date-navigation button:first-of-type {
    grid-column: 1 / 2;
    grid-row: 2;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    width: 100%;
    height: 45px;
    padding: 0;
    color: #0277bd;
    font-size: 1.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
}

#page-user #userDatePicker {
    grid-column: 2 / 4;
    grid-row: 2;
    width: 100%;
    height: 45px;
    padding: 0 5px;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    font-size: 1.05rem;
    text-align: center;
    background: #ffffff;
    box-sizing: border-box;
    color: #333;
    font-family: inherit;
    font-weight: 700;
    margin: 0;
}

#page-user .date-navigation button:last-of-type {
    grid-column: 4 / 5;
    grid-row: 2;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    width: 100%;
    height: 45px;
    padding: 0;
    color: #0277bd;
    font-size: 1.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Rad 3: Veckovy-knapp + Visa mitt-knapp */
#page-user #toggleViewBtn {
    grid-column: 1 / 3;
    grid-row: 3;
    width: 100%;
    padding: 12px;
    border-radius: 12px;
    font-weight: 800;
    font-size: 0.9rem;
    margin: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
}

#page-user #toggleMyScheduleBtn {
    grid-column: 3 / 5;
    grid-row: 3;
    width: 100%;
    padding: 12px;
    border-radius: 12px;
    font-size: 0.9rem;
    font-weight: 800;
    box-shadow: 0 4px 12px rgba(76,175,80,0.3);
    margin: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
}

/* --- SCHEMA (mobil veckovy) --- */
#page-user .weekly-header-row { display: none; }

#page-user .weekly-grid {
    display: flex;
    flex-direction: column;
    gap: 20px;
    border: none;
    background: transparent;
    padding: 5px;
    min-width: 0;
}

#page-user .weekly-user-row {
    display: flex;
    flex-direction: column;
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.05);
    border: 1px solid rgba(0,0,0,0.04);
    overflow: hidden;
}

/* Visa/dölj namnrutan baserat på data-attribut */
#page-user #userWeeklyContainer[data-only-me="true"] .weekly-user-name {
    display: none;
}
#page-user #userWeeklyContainer[data-only-me="false"] .weekly-user-name,
#page-user .weekly-user-name {
    display: block;
    background: linear-gradient(135deg, #0277bd 0%, #01579b 100%);
    color: #ffffff;
    padding: 14px 20px;
    font-size: 1.15rem;
    text-align: center;
    border: none;
    font-weight: 800;
    letter-spacing: 0.5px;
}

/* Varje dag: datum (vänster) + pass (höger) på en rad */
#page-user .weekly-cell {
    display: flex;
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    padding: 12px 15px;
    border-bottom: 1px solid #f0f4f8;
    background: #ffffff;
    min-height: auto;
    gap: 15px;
}
#page-user .weekly-cell:last-child { border-bottom: none; }

#page-user .mobile-date-label {
    display: block;
    font-weight: 800;
    color: #0277bd;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 0;
    flex-shrink: 0;
    width: 100px;
    white-space: nowrap;
    text-align: left;
}

#page-user .weekly-cell-content {
    flex-grow: 1;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 8px;
}

#page-user .weekly-badge {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 700;
    padding: 8px 12px;
    text-align: center;
    width: auto;
    box-sizing: border-box;
    white-space: nowrap;
    border-radius: 8px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.05);
}

#page-user .free-text {
    margin: 0;
    color: #64748b;
    background: #f1f5f9;
    padding: 8px 12px;
    border-radius: 8px;
    font-weight: 600;
    text-align: center;
    width: auto;
    box-sizing: border-box;
    border: 1px solid #e2e8f0;
    white-space: nowrap;
}


/* =========================================
   DESKTOP-OVERRIDES (≥ 769px)
   ========================================= */
@media (min-width: 769px) {

    /* Återställ header till flex-rad */
    #page-user .header-content {
        display: flex;
        grid-template-columns: none;
        gap: 0;
    }

    #page-user .header-content > div,
    #page-user .header-datepicker,
    #page-user .date-navigation {
        display: flex;
    }

    /* Visa dolda element */
    #page-user #currentUserDisplay,
    #page-user .header-datepicker label {
        display: block;
    }

    #page-user .date-navigation > *:not(button) {
        display: block;
    }

    /* Återställ header-element till normal layout */
    #page-user h1                                  { grid-column: unset; grid-row: unset; font-size: 1.8rem; color: var(--header-text); }
    #page-user #logoutBtn                          { grid-column: unset; grid-row: unset; background: #ffebee; color: #c62828; border-radius: 4px; padding: 8px 16px; font-size: 0.9rem; font-weight: bold; width: auto; }
    #page-user .date-navigation button:first-of-type,
    #page-user .date-navigation button:last-of-type { grid-column: unset; grid-row: unset; background: none; border: none; height: auto; width: auto; font-size: 1.5rem; border-radius: 0; }
    #page-user #userDatePicker                     { grid-column: unset; grid-row: unset; height: auto; border-radius: 4px; font-size: 1rem; font-weight: normal; width: auto; }
    #page-user #toggleViewBtn,
    #page-user #toggleMyScheduleBtn                { grid-column: unset; grid-row: unset; width: auto; padding: 8px 16px; border-radius: 4px; font-size: 0.9rem; }
    #page-user #toggleMyScheduleBtn .user-name-label { display: inline; }

    /* Återställ veckovy till desktop-grid */
    #page-user .weekly-grid                 { min-width: 900px; flex-direction: unset; gap: unset; }
    #page-user .weekly-header-row           { display: grid; }
    #page-user .weekly-user-row             { display: grid; flex-direction: unset; background: transparent; border-radius: 0; box-shadow: none; border: none; border-bottom: 1px solid var(--border-color); overflow: visible; }
    #page-user .weekly-user-row:hover       { background-color: rgba(0,0,0,0.02); }
    #page-user .weekly-user-name            { background: transparent; color: var(--text-color); padding: 0 0 0 10px; font-size: 1rem; font-weight: 700; letter-spacing: 0; border: none; }
    #page-user .weekly-cell                 { flex-direction: column; justify-content: center; align-items: center; padding: 6px; min-height: 45px; background: var(--input-bg); border: 1px dashed var(--border-color); border-radius: 6px; }
    #page-user .weekly-cell:last-child      { border-bottom: 1px dashed var(--border-color); }
    #page-user .mobile-date-label           { display: none; }
    #page-user .weekly-cell-content         { flex-direction: column; justify-content: center; align-items: stretch; width: 100%; }
    #page-user .weekly-badge                { font-size: 0.8rem; padding: 4px 8px; width: 100%; border-radius: 4px; }
    #page-user .free-text                   { background: none; border: none; padding: 0; color: #767676; font-size: 0.85rem; border-radius: 0; }

    /* Återställ data-only-me-styrning */
    #page-user #userWeeklyContainer[data-only-me="true"] .weekly-user-name  { display: none; }
    #page-user #userWeeklyContainer[data-only-me="false"] .weekly-user-name { display: block; background: transparent; color: var(--text-color); padding: 0 0 0 10px; font-size: 1rem; }
}

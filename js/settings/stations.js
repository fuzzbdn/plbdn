/**
 * ============================================================================
 * STATIONS.JS (Admin/Inställningar)
 * Hanterar fliken "Platser / Arbetsstationer" under Inställningar.
 * Låter administratören skapa, redigera, färgsätta och radera de olika
 * stationerna som personalen kan bemanna. Stöder även "Mellanrum" (Spacers)
 * för att gruppera stationer snyggt på TV-skärmen, samt Drag-and-Drop för 
 * enkel sortering.
 * ============================================================================
 */

import { fetchData, apiAction } from '../service.js';
import { showToast, showConfirm, escapeHTML, setupListDragAndDrop } from '../utils.js';
import { getStations, setStations } from '../store.js';

/** @type {string|number|null} Håller ID:t för den station som just nu redigeras. Null = Skapa ny. */
let editingStationId = null;

/**
 * Startar upp fliken för Stationer, binder knappar och laddar listan.
 */
export function initStationsTab() {
    const stName = document.getElementById('newStationName');
    const stColor = document.getElementById('newStationColor');
    const stBtn = document.getElementById('addStationBtn');
    const stCancel = document.getElementById('cancelStationEditBtn');
    const cont = document.getElementById('stationListContainer');
    
    if (!stName || !cont) return;

    // ==========================================
    // 1. DRAG & DROP (Sortering)
    // ==========================================
    // Aktiverar vår generiska Drag & Drop-hjälpfunktion från utils.js
    setupListDragAndDrop(cont, '.draggable-station', async (oldIndex, newIndex) => {
        const currentStations = [...getStations()];
        
        // Flytta objektet i arrayen
        const movedItem = currentStations.splice(oldIndex, 1)[0];
        currentStations.splice(newIndex, 0, movedItem);
        
        // Uppdatera det lokala minnet (Store) direkt för att gränssnittet ska kännas snabbt
        setStations(currentStations);
        
        // Plocka ut den nya ordningen av ID:n och skicka till databasen
        const newOrderIds = currentStations.map(st => st.id);
        await apiAction('reorder_stations', newOrderIds);
        
        renderStations(); // Rita om listan med de nya index-värdena
    });

    // ==========================================
    // 2. RENDERING AV LISTAN
    // ==========================================
    /**
     * Bygger HTML-strukturen för alla stationer och mellanrum.
     */
    const renderStations = () => {
        cont.innerHTML = getStations().map((st, i) => {
            // Drag-attribut som HTML5 Drag-and-Drop och vår setup-funktion behöver
            const dragAttr = `draggable="true" data-index="${i}"`;
            
            // Specialrendering för "Mellanrum" (Spacer)
            if (st.is_spacer) {
                return `
                <div class="admin-list-item draggable-station" ${dragAttr} style="background:#f9f9f9; cursor:grab;">
                    <div class="list-info-left">
                        <span class="drag-handle" style="margin-right:10px; color:#aaa;">☰</span>
                        <i>--- Mellanrum ---</i>
                    </div>
                    <div class="list-actions-right">
                        <button class="list-btn" onclick="deleteStation(${st.id})" title="Ta bort">🗑️</button>
                    </div>
                </div>`;
            }
            
            // Standardrendering för vanliga Stationer
            return `
            <div class="admin-list-item draggable-station" ${dragAttr} style="cursor:grab;">
                <div class="list-info-left">
                    <span class="drag-handle" style="margin-right:10px; color:#aaa;">☰</span>
                    <div style="width:20px; height:20px; background:${escapeHTML(st.color)}; border-radius:50%; margin-right:10px; border:1px solid #ccc;"></div>
                    <strong>${escapeHTML(st.name)}</strong>
                </div>
                <div class="list-actions-right">
                    <button class="list-btn" onclick="startEditStation(${escapeHTML(String(st.id))})" title="Redigera">✏️</button>
                    <button class="list-btn" onclick="deleteStation(${escapeHTML(String(st.id))})" title="Ta bort">🗑️</button>
                </div>
            </div>`;
        }).join('');
    };

    // ==========================================
    // 3. GLOBALA HANDLINGAR (HTML Onclick)
    // ==========================================

    /**
     * Startar redigeringsläget för en befintlig station.
     */
    globalThis.startEditStation = (id) => {
        const st = getStations().find(s => String(s.id) === String(id));
        if (!st) return;
        
        editingStationId = st.id;
        stName.value = st.name;
        stColor.value = st.color;
        
        stBtn.innerText = "Spara Ändringar";
        stBtn.style.background = "#2196F3"; // Blå färg indikerar redigeringsläge
        stCancel.style.display = "inline-flex";
    };

    /**
     * Avbryter redigeringsläget och tömmer formuläret.
     */
    const resetSt = () => {
        editingStationId = null;
        stName.value = "";
        
        stBtn.innerText = "Lägg till";
        stBtn.style.background = ""; // Återställ standardfärg
        stCancel.style.display = "none";
    };
    if (stCancel) stCancel.onclick = resetSt;

    // ==========================================
    // 4. SPARA OCH SKAPA (CRUD)
    // ==========================================
    
    /**
     * Sparar formuläret (Både för ny station och redigering).
     */
    stBtn.onclick = async () => {
        if (!stName.value) return showToast("Ange ett namn", "info");
        
        await apiAction('save_station', {
            id: editingStationId,
            name: stName.value,
            color: stColor.value,
            is_spacer: false
        });
        
        // Uppdatera lokalt minne (Store) med den nya datan från databasen
        const res = await fetchData('stations');
        if (res?.success) setStations(res.data);
        
        renderStations();
        resetSt();
        showToast("Station sparad", "success");
    };

    /**
     * Skapar ett tomt "Mellanrum" direkt utan formulär.
     */
    const spacerBtn = document.getElementById('addSpacerBtn');
    if (spacerBtn) {
        spacerBtn.onclick = async () => {
            await apiAction('save_station', { is_spacer: true });
            
            const res = await fetchData('stations');
            if (res?.success) setStations(res.data);
            
            renderStations();
        };
    }

    /**
     * Raderar en station eller ett mellanrum efter bekräftelse.
     */
    globalThis.deleteStation = async (id) => {
        if (await showConfirm("Ta bort platsen?")) {
            await apiAction('delete_station', { id });
            
            const res = await fetchData('stations');
            if (res?.success) setStations(res.data);
            
            renderStations();
        }
    };
    
    // ==========================================
    // INITIERING
    // ==========================================
    renderStations();
}

/**
 * ============================================================================
 * SHIFTS.JS (Admin/Inställningar)
 * Hanterar fliken "Arbetspass / Tider" under Inställningar.
 * Låter administratören skapa, redigera, och radera de olika tidsblocken
 * (t.ex. "Förmiddag", "07:00-16:00") som sedan byggs ihop med stationerna.
 * Inkluderar Drag-and-Drop för att styra i vilken ordning passen visas.
 * ============================================================================
 */

import { fetchData, apiAction } from '../service.js';
import { showToast, showConfirm, escapeHTML, setupListDragAndDrop } from '../utils.js';
import { getShifts, setShifts } from '../store.js';

/** @type {string|number|null} Håller ID:t för det arbetspass som just nu redigeras. Null = Skapa nytt. */
let editingShiftId = null;

/**
 * Startar upp fliken för Arbetspass, binder knappar och laddar listan.
 */
export function initShiftsTab() {
    const shLabel = document.getElementById('newShiftLabel');
    const shTime = document.getElementById('newShiftTime');
    const shBtn = document.getElementById('addShiftBtn');
    const shCancel = document.getElementById('cancelShiftEditBtn');
    const cont = document.getElementById('shiftListContainer');
    
    if (!shLabel || !cont) return;

    // ==========================================
    // 1. DRAG & DROP (Sortering)
    // ==========================================
    // Aktiverar den generiska Drag & Drop-hanteraren från utils.js
    setupListDragAndDrop(cont, '.draggable-shift', async (oldIndex, newIndex) => {
        const currentShifts = [...getShifts()];
        
        // Flytta passet i arrayen
        const movedItem = currentShifts.splice(oldIndex, 1)[0];
        currentShifts.splice(newIndex, 0, movedItem);
        
        // Uppdatera gränssnittets data blixtsnabbt i bakgrunden
        setShifts(currentShifts);
        
        // Plocka ut den nya ordningen och spara i databasen
        const newOrderIds = currentShifts.map(sh => sh.id);
        await apiAction('reorder_shifts', newOrderIds);
        
        renderShifts(); // Rita om för att uppdatera index-attributen
    });

    // ==========================================
    // 2. RENDERING AV LISTAN
    // ==========================================
    /**
     * Ritar ut HTML-strukturen för alla arbetspass i listan.
     */
    const renderShifts = () => {
        cont.innerHTML = getShifts().map((sh, i) => {
            // Drag-attribut som krävs av HTML5 och vår hjälpklass
            const dragAttr = `draggable="true" data-index="${i}"`;
            
            return `
            <div class="admin-list-item draggable-shift" ${dragAttr} style="cursor:grab;">
                <div class="list-info-left">
                    <span class="drag-handle" style="margin-right:10px; color:#aaa;">☰</span>
                    <strong>${escapeHTML(sh.label)}</strong> 
                    <span style="color:#666; margin-left:5px;">(${escapeHTML(sh.time_range || '')})</span>
                </div>
                <div class="list-actions-right">
                    <button class="list-btn" onclick="startEditShift('${escapeHTML(String(sh.id))}')" title="Redigera">✏️</button>
                    <button class="list-btn" onclick="deleteShift('${escapeHTML(String(sh.id))}')" title="Ta bort">🗑️</button>
                </div>
            </div>`;
        }).join('');
    };

    // ==========================================
    // 3. GLOBALA HANDLINGAR (HTML Onclick)
    // ==========================================
    /**
     * Förbereder formuläret för att redigera ett befintligt arbetspass.
     */
    globalThis.startEditShift = (id) => {
        const sh = getShifts().find(s => String(s.id) === String(id));
        if (!sh) return;
        
        editingShiftId = sh.id;
        shLabel.value = sh.label;
        shTime.value = sh.time_range || "";
        
        shBtn.innerText = "Spara Ändringar";
        shBtn.style.background = "#2196F3"; // Blå färg för redigeringsläge
        shCancel.style.display = "inline-flex";
    };

    /**
     * Nollställer formuläret och återgår till "Skapa nytt"-läge.
     */
    const resetSh = () => {
        editingShiftId = null;
        shLabel.value = "";
        shTime.value = "";
        
        shBtn.innerText = "Lägg till Pass";
        shBtn.style.background = ""; // Återställ knappens färg
        shCancel.style.display = "none";
    };
    if (shCancel) shCancel.onclick = resetSh;

    // ==========================================
    // 4. SPARA OCH RADERA (CRUD)
    // ==========================================
    /**
     * Skickar datan till servern när användaren klickar på Spara/Lägg till.
     */
    shBtn.onclick = async () => {
        if (!shLabel.value) return showToast("Ange en etikett", "info");
        
        await apiAction('save_shift', {
            id: editingShiftId,
            label: shLabel.value,
            time_range: shTime.value
        });
        
        // Hämta den nysparade listan för att säkerställa att vi har rätt ID:n etc.
        const res = await fetchData('shifts');
        if (res?.success) setShifts(res.data);
        
        renderShifts();
        resetSh();
        showToast("Arbetspass sparat", "success");
    };

    /**
     * Raderar ett arbetspass permanent.
     */
    globalThis.deleteShift = async (id) => {
        if (await showConfirm("Ta bort arbetspasset?")) {
            await apiAction('delete_shift', { id });
            
            const res = await fetchData('shifts');
            if (res?.success) setShifts(res.data);
            
            renderShifts();
        }
    };
    
    // ==========================================
    // INITIERING
    // ==========================================
    renderShifts();
}

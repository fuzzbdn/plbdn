import { fetchData, apiAction } from '../service.js';
import { showToast, showConfirm, escapeHTML, setupListDragAndDrop } from '../utils.js';
import { getStations, setStations } from '../store.js';

let editingStationId = null;

export function initStationsTab() {
    const stName = document.getElementById('newStationName');
    const stColor = document.getElementById('newStationColor');
    const stBtn = document.getElementById('addStationBtn');
    const stCancel = document.getElementById('cancelStationEditBtn');
    const cont = document.getElementById('stationListContainer');
    
    if (!stName || !cont) return;

    // NYTT: Aktivera generisk Drag & Drop för denna container
    setupListDragAndDrop(cont, '.draggable-station', async (oldIndex, newIndex) => {
        const currentStations = [...getStations()];
        const movedItem = currentStations.splice(oldIndex, 1)[0];
        currentStations.splice(newIndex, 0, movedItem);
        
        setStations(currentStations);
        const newOrderIds = currentStations.map(st => st.id);
        await apiAction('reorder_stations', newOrderIds);
        
        renderStations();
    });

    const renderStations = () => {
        cont.innerHTML = getStations().map((st, i) => {
            // NYTT: Mycket renare HTML utan ondrag-attribut
            const dragAttr = `draggable="true" data-index="${i}"`;
            
            if (st.is_spacer) {
                return `<div class="admin-list-item draggable-station" ${dragAttr} style="background:#f9f9f9; cursor:grab;">
                            <div class="list-info-left">
                                <span class="drag-handle" style="margin-right:10px; color:#aaa;">☰</span>
                                <i>--- Mellanrum ---</i>
                            </div>
                            <div class="list-actions-right">
                                <button class="list-btn" onclick="startEditStation(${st.id})">✏️</button>
                                <button class="list-btn" onclick="deleteStation(${st.id})">🗑️</button>
                            </div>
                        </div>`;
            }
            return `
            <div class="admin-list-item draggable-station" ${dragAttr} style="cursor:grab;">
                <div class="list-info-left">
                    <span class="drag-handle" style="margin-right:10px; color:#aaa;">☰</span>
                    <div style="width:20px; height:20px; background:${escapeHTML(st.color)}; border-radius:50%; margin-right:10px; border:1px solid #ccc;"></div>
                    <strong>${escapeHTML(st.name)}</strong>
                </div>
                <div class="list-actions-right">
                    <button class="list-btn" onclick="startEditStation(${escapeHTML(String(st.id))})">✏️</button>
                    <button class="list-btn" onclick="deleteStation(${escapeHTML(String(st.id))})">🗑️</button>
                </div>
            </div>`;
        }).join('');
    };

    window.startEditStation = (id) => {
        const st = getStations().find(s => String(s.id) === String(id));
        if (!st) return;
        editingStationId = st.id;
        stName.value = st.name;
        stColor.value = st.color;
        stBtn.innerText = "Spara Ändringar";
        stBtn.style.background = "#2196F3";
        stCancel.style.display = "inline-flex";
    };

    const resetSt = () => {
        editingStationId = null;
        stName.value = "";
        stBtn.innerText = "Lägg till";
        stBtn.style.background = "";
        stCancel.style.display = "none";
    };
    if (stCancel) stCancel.onclick = resetSt;

    stBtn.onclick = async () => {
        if (!stName.value) return showToast("Ange ett namn", "info");
        await apiAction('save_station', {
            id: editingStationId,
            name: stName.value,
            color: stColor.value,
            is_spacer: false
        });
        const fetched = await fetchData('stations');
        setStations(fetched);
        renderStations();
        resetSt();
        showToast("Station sparad", "success");
    };

    const spacerBtn = document.getElementById('addSpacerBtn');
    if (spacerBtn) {
        spacerBtn.onclick = async () => {
            await apiAction('save_station', { is_spacer: true });
            const fetched = await fetchData('stations');
            setStations(fetched);
            renderStations();
        };
    }

    window.deleteStation = async (id) => {
        if (await showConfirm("Ta bort platsen?")) {
            await apiAction('delete_station', { id });
            const fetched = await fetchData('stations');
            setStations(fetched);
            renderStations();
        }
    };
    
    renderStations();
}

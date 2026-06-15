import { fetchData, apiAction } from '../service.js';
import { showToast, showConfirm, escapeHTML } from '../utils.js';
import { getShifts, setShifts } from '../store.js';

let editingShiftId = null;

export function initShiftsTab() {
    const shLabel = document.getElementById('newShiftLabel');
    const shTime = document.getElementById('newShiftTime');
    const shBtn = document.getElementById('addShiftBtn');
    const shCancel = document.getElementById('cancelShiftEditBtn');
    if (!shLabel) return;

    let dragSrcShiftEl = null;
    window.handleShiftDragStart = (e) => {
        dragSrcShiftEl = e.target.closest('.draggable-shift');
        e.dataTransfer.effectAllowed = 'move';
        dragSrcShiftEl.classList.add('dragging');
    };
    window.handleShiftDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; };
    window.handleShiftDrop = async (e) => {
        e.stopPropagation();
        const targetEl = e.target.closest('.draggable-shift');
        if (dragSrcShiftEl && targetEl && dragSrcShiftEl !== targetEl) {
            const oldIndex = parseInt(dragSrcShiftEl.dataset.index);
            const newIndex = parseInt(targetEl.dataset.index);
            
            const currentShifts = [...getShifts()];
            const movedItem = currentShifts.splice(oldIndex, 1)[0];
            currentShifts.splice(newIndex, 0, movedItem);
            
            setShifts(currentShifts);
            const newOrderIds = currentShifts.map(sh => sh.id);
            await apiAction('reorder_shifts', newOrderIds);
            
            renderShifts(); 
        }
        return false;
    };

    const renderShifts = () => {
        const cont = document.getElementById('shiftListContainer');
        if (!cont) return;
        cont.innerHTML = getShifts().map((sh, i) => {
            const dragAttr = `draggable="true" ondragstart="handleShiftDragStart(event)" ondragover="handleShiftDragOver(event)" ondrop="handleShiftDrop(event)" data-index="${i}"`;
            return `
        <div class="admin-list-item draggable-shift" ${dragAttr} style="cursor:grab;">
            <div class="list-info-left">
                <span class="drag-handle" style="margin-right:10px; color:#aaa;">☰</span>
                <strong>${escapeHTML(sh.label)}</strong> 
                <span style="color:#666; margin-left:5px;">(${escapeHTML(sh.time_range || '')})</span>
            </div>
            <div class="list-actions-right">
                <button class="list-btn" onclick="startEditShift(${sh.id})">✏️</button>
                <button class="list-btn" onclick="deleteShift(${sh.id})">🗑️</button>
            </div>
        </div>`}).join('');
    };

    window.startEditShift = (id) => {
        const sh = getShifts().find(s => s.id === id);
        if (!sh) return;
        editingShiftId = id;
        shLabel.value = sh.label;
        shTime.value = sh.time_range || "";
        shBtn.innerText = "Spara Ändringar";
        shBtn.style.background = "#2196F3";
        shCancel.style.display = "inline-flex";
    };

    const resetSh = () => {
        editingShiftId = null;
        shLabel.value = "";
        shTime.value = "";
        shBtn.innerText = "Lägg till Pass";
        shBtn.style.background = "";
        shCancel.style.display = "none";
    };
    if(shCancel) shCancel.onclick = resetSh;

    shBtn.onclick = async () => {
        if (!shLabel.value) return showToast("Ange en etikett", "info");
        await apiAction('save_shift', {
            id: editingShiftId,
            label: shLabel.value,
            time_range: shTime.value
        });
        const fetched = await fetchData('shifts');
        setShifts(fetched);
        renderShifts();
        resetSh();
        showToast("Arbetspass sparat", "success");
    };

    window.deleteShift = async (id) => {
        if (await showConfirm("Ta bort arbetspasset?")) {
            await apiAction('delete_shift', { id });
            const fetched = await fetchData('shifts');
            setShifts(fetched);
            renderShifts();
        }
    };
    renderShifts();
}

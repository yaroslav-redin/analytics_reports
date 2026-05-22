// ===================== SHEET FORM =====================
document.getElementById('sheetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const checkedBoxes = document.querySelectorAll('.sheet-checkbox:checked');
    const filesPayload = [];
    window.uploadedFiles.forEach(f => {
        const selectedSheets = Array.from(checkedBoxes).filter(cb => cb.dataset.filename === f.filename).map(cb => cb.value);
        if (selectedSheets.length > 0) {
            filesPayload.push({ filename: f.filename, sheets: selectedSheets });
        }
    });

    
    window.sheetSelections = Object.fromEntries(filesPayload.map(f => [f.filename, f.sheets]));

    document.getElementById('processSheetsBtn').disabled = true;
    document.getElementById('sheetSpinner').classList.remove('d-none');

    try {
        const response = await fetch('/process_sheets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: window.sessionId, files: filesPayload })
        });
        const data = await response.json();

        if (response.ok) {
            window.processedFiles = data.processed_files;
            window.questionMapping = {};
            window.reportSections = [];

            renderQuestionsStep3();
            goToStep(2);
        } else { showToast(data.message, 'danger'); }
    } catch (err) { showToast('Ошибка соединения с сервером', 'danger'); }
    finally {
        updateSheetBtn();
        document.getElementById('sheetSpinner').classList.add('d-none');
    }
});

document.getElementById('selectAllSheets').addEventListener('change', (e) => {
    document.querySelectorAll('.sheet-checkbox').forEach(cb => cb.checked = e.target.checked);
    updateSheetBtn();
});

document.getElementById('sheetCheckboxesContainer').addEventListener('change', (e) => {
    if (e.target.classList.contains('sheet-checkbox')) {
        const total = document.querySelectorAll('.sheet-checkbox').length;
        const checked = document.querySelectorAll('.sheet-checkbox:checked').length;
        document.getElementById('selectAllSheets').checked = (total === checked && total > 0);
        updateSheetBtn();
    }
});



function rehydrateSheetsUI() {
    if (!window.uploadedFiles || !window.uploadedFiles.length) return false;
    const container = document.getElementById('sheetCheckboxesContainer');
    if (!container) return false;

    const selections = window.sheetSelections || {};

    container.innerHTML = '';
    window.uploadedFiles.forEach((file, fIdx) => {
        container.insertAdjacentHTML('beforeend',
            `<div class="file-section-title">Файл ${fIdx + 1}: ${file.original_name}</div>`);
        file.sheets.forEach(sheet => {
            const savedForFile = selections[file.filename];
            const wasSelected = Array.isArray(savedForFile)
                ? savedForFile.includes(sheet)
                : file.sheets.length === 1;
            const checkedAttr = wasSelected ? ' checked' : '';
            container.insertAdjacentHTML('beforeend', `
                <div class="form-check ms-3">
                    <input class="form-check-input sheet-checkbox" type="checkbox" value="${sheet}" data-filename="${file.filename}" id="s_${fIdx}_${sheet}"${checkedAttr}>
                    <label class="form-check-label" for="s_${fIdx}_${sheet}">${sheet}</label>
                </div>`);
        });
    });

    const totalSheets = document.querySelectorAll('.sheet-checkbox').length;
    const checkedSheets = document.querySelectorAll('.sheet-checkbox:checked').length;
    const selectAll = document.getElementById('selectAllSheets');
    if (selectAll) selectAll.checked = (totalSheets === checkedSheets && totalSheets > 0);
    if (typeof updateSheetBtn === 'function') updateSheetBtn();
    return true;
}

window.rehydrateSheetsUI = rehydrateSheetsUI;


// ===================== LEGEND SETTINGS =====================
function renderLegendSettings() {
    const block = document.getElementById('legendSettingsBlock');
    const container = document.getElementById('legendInputsContainer');
    if (!window.processedFiles || window.processedFiles.length <= 1) {
        if (block) block.style.display = 'none';
        return;
    }
    if (block) block.style.display = '';
    container.innerHTML = '';
    window.processedFiles.forEach((f, i) => {
        const color = defaultColors[i % defaultColors.length];
        const item = _tpl('tpl-legend-item');
        const colorInput = item.querySelector('.legend-color');
        colorInput.dataset.file = f.clean_filename;
        colorInput.value = color;
        const btn = item.querySelector('.random-legend-color-btn');
        btn.dataset.file = f.clean_filename;
        const textInput = item.querySelector('.legend-label');
        textInput.dataset.file = f.clean_filename;
        textInput.value = f.original_name.replace(/\.[^.]+$/, '');
        container.appendChild(item);
    });
}

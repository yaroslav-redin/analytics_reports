function _escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ===================== DRAG & DROP + FILE PREVIEW =====================
(function () {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('excelFile');
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) {
            const dt = new DataTransfer();
            for (const f of e.dataTransfer.files) dt.items.add(f);
            fileInput.files = dt.files;
            updateFilePreview(fileInput.files);
            updateUploadBtn();
        }
    });
    dropZone.addEventListener('click', e => {
        if (!e.target.closest('label') && !e.target.closest('input')) fileInput.click();
    });
    fileInput.addEventListener('change', () => { updateFilePreview(fileInput.files); updateUploadBtn(); });
}());

function updateFilePreview(files) {
    const preview = document.getElementById('fileListPreview');
    if (!preview) return;
    if (!files || !files.length) { preview.innerHTML = ''; return; }
    const ext = f => f.name.toLowerCase().endsWith('.csv') ? 'fa-file-csv text-secondary' : 'fa-file-excel text-success';
    preview.innerHTML = Array.from(files).map(f => `
        <div class="d-flex align-items-center gap-2 py-1 border-bottom">
            <i class="fa-solid ${ext(f)} fa-fw"></i>
            <span class="text-truncate small">${_escHtml(f.name)}</span>
            <small class="text-muted ms-auto flex-shrink-0">${(f.size / 1024).toFixed(0)}&nbsp;КБ</small>
        </div>`).join('');
}

function rehydrateUploadUI() {
    if (!window.uploadedFiles || !window.uploadedFiles.length) return false;
    const preview = document.getElementById('fileListPreview');
    if (!preview) return false;
    const ext = name => name.toLowerCase().endsWith('.csv')
        ? 'fa-file-csv text-secondary' : 'fa-file-excel text-success';
    preview.innerHTML = window.uploadedFiles.map(f => `
        <div class="d-flex align-items-center gap-2 py-1 border-bottom">
            <i class="fa-solid ${ext(f.original_name)} fa-fw"></i>
            <span class="text-truncate small">${_escHtml(f.original_name)}</span>
        </div>`).join('');
    return true;
}
window.rehydrateUploadUI = rehydrateUploadUI;

// ===================== UPLOAD FORM =====================
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    const files = document.getElementById('excelFile').files;
    for (let i = 0; i < files.length; i++) formData.append('files', files[i]);

    document.getElementById('uploadBtn').disabled = true;
    document.getElementById('uploadSpinner').classList.remove('d-none');

    try {
        const response = await fetch('/upload', { method: 'POST', body: formData });
        const data = await response.json();
        if (response.ok) {
            window.sessionId = data.session_id;
            window.uploadedFiles = data.files.sort((a, b) => b.original_name.localeCompare(a.original_name, 'ru'));
            const container = document.getElementById('sheetCheckboxesContainer');
            container.innerHTML = '';

            window.uploadedFiles.forEach((file, fIdx) => {
                container.insertAdjacentHTML('beforeend', `<div class="file-section-title">Файл ${fIdx + 1}: ${_escHtml(file.original_name)}</div>`);
                file.sheets.forEach(sheet => {
                    const autoChecked = file.sheets.length === 1 ? ' checked' : '';
                    const esc = _escHtml(sheet);
                    container.insertAdjacentHTML('beforeend', `
                        <div class="form-check ms-3">
                            <input class="form-check-input sheet-checkbox" type="checkbox" value="${esc}" data-filename="${_escHtml(file.filename)}" id="s_${fIdx}_${esc}"${autoChecked}>
                            <label class="form-check-label" for="s_${fIdx}_${esc}">${esc}</label>
                        </div>`);
                });
            });

            const totalSheets = document.querySelectorAll('.sheet-checkbox').length;
            const checkedSheets = document.querySelectorAll('.sheet-checkbox:checked').length;
            document.getElementById('selectAllSheets').checked = (totalSheets === checkedSheets && totalSheets > 0);

            goToStep(1);
            updateSheetBtn();
        } else { showToast(data.message, 'danger'); }
    } catch (err) { showToast('Ошибка соединения с сервером', 'danger'); }
    finally {
        updateUploadBtn();
        document.getElementById('uploadSpinner').classList.add('d-none');
    }
});

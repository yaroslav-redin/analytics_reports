// ===================== QUESTIONS STEP 3 =====================
let currentMappingQName = null;

function renderQuestionsStep3() {
    window.questionMapping = {};
    window.questionSourceFile = {};
    document.getElementById('sortableQuestionsList').innerHTML = '<div class="p-3 text-center text-muted" id="emptySortablePlaceholder"><i class="fa-solid fa-hand-pointer me-1"></i>Выберите вопросы на шаге 3, чтобы они появились здесь</div>';

    const fileSelect = document.getElementById('fileSelectStep3');
    const fileSelectContainer = document.getElementById('fileSelectContainer');
    if (window.processedFiles.length > 1) {
        if ($(fileSelect).hasClass('select2-hidden-accessible')) $(fileSelect).select2('destroy');
        fileSelect.innerHTML = window.processedFiles.map((f, i) =>
            `<option value="${i}">${f.original_name}</option>`
        ).join('');
        fileSelectContainer.style.display = '';
        $(fileSelect).select2({ theme: 'bootstrap-5', width: '100%', language: 'ru'});
    } else {
        fileSelectContainer.style.display = 'none';
    }

    document.getElementById('selectAllQuestions').checked = false;
    fileSelect.value = '0';
    _renderQuestionsForFile(0);

    new Sortable(document.getElementById('sortableQuestionsList'), { handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost' });
    updateQuestionsBtn();
}

function _renderQuestionsForFile(fileIdx) {
    document.getElementById('questionsSearchInput').value = '';
    const container = document.getElementById('allQuestionsList');
    container.innerHTML = '';
    const f = window.processedFiles[fileIdx];

    const selectedQNames = new Set(
        Array.from(document.querySelectorAll('#sortableQuestionsList .question-item')).map(el => el.dataset.col)
    );
    const showHidden = document.getElementById('showHiddenCols').checked;

    const inner = document.createElement('div');
    inner.style.cssText = 'width:max-content;min-width:100%';

    f.columns.forEach((colObj, colIdx) => {
        const isSystem = colObj.is_system;
        const qName = colObj.name;
        const cbId = `qcb_${fileIdx}_${colIdx}`;
        const item = document.createElement('div');
        const hiddenClass = isSystem ? 'system-col' + (showHidden ? '' : ' d-none') : '';
        const labelColor = isSystem ? 'text-secondary' : 'text-body';
        item.className = `list-group-item d-flex align-items-center gap-2 py-2 q-item-container ${hiddenClass}`;
        item.dataset.qname = qName;
        item.innerHTML = `
            <input class="form-check-input flex-shrink-0 q-checkbox" type="checkbox" id="${cbId}" value="${_escAttr(qName)}"${selectedQNames.has(qName) ? ' checked' : ''}>
            <label class="form-check-label fw-medium ${labelColor} text-nowrap cursor-pointer" for="${cbId}" title="${_escAttr(qName)}">${_escHtml(qName)}</label>`;
        inner.appendChild(item);
    });

    container.appendChild(inner);

    const visibleItems = [...container.querySelectorAll('.q-item-container:not(.d-none)')];
    if (visibleItems.length === 1) {
        const cb = visibleItems[0].querySelector('.q-checkbox');
        if (cb && !cb.checked) {
            cb.checked = true;
            addQuestionToSortable(cb.value, fileIdx);
        }
    }

    const total = container.querySelectorAll('.q-item-container:not(.d-none):not(.q-filtered)').length;
    const checked = container.querySelectorAll('.q-item-container:not(.d-none):not(.q-filtered) .q-checkbox:checked').length;
    document.getElementById('selectAllQuestions').checked = (total === checked && total > 0);
}

function filterQuestionsList() {
    const query = document.getElementById('questionsSearchInput').value.trim().toLowerCase();
    document.querySelectorAll('#allQuestionsList .q-item-container').forEach(item => {
        const matches = !query || (item.dataset.qname || '').toLowerCase().includes(query);
        item.classList.toggle('q-filtered', !matches);
    });
    const total = document.querySelectorAll('#allQuestionsList .q-item-container:not(.d-none):not(.q-filtered)').length;
    const checked = document.querySelectorAll('#allQuestionsList .q-item-container:not(.d-none):not(.q-filtered) .q-checkbox:checked').length;
    document.getElementById('selectAllQuestions').checked = (total === checked && total > 0);
}

function autoMapQuestion(qName, sourceFileIdx) {
    sourceFileIdx = sourceFileIdx ?? 0;
    const mapping = {};
    mapping[window.processedFiles[sourceFileIdx].clean_filename] = qName;
    window.questionSourceFile[qName] = sourceFileIdx;

    const missingIn = [];
    for (let i = 0; i < window.processedFiles.length; i++) {
        if (i === sourceFileIdx) continue;
        const f = window.processedFiles[i];
        const found = f.columns.find(c => c.name === qName);
        if (found) {
            mapping[f.clean_filename] = found.name;
        } else {
            missingIn.push(f.original_name);
        }
    }

    window.questionMapping[qName] = mapping;
    return missingIn;
}

function addQuestionToSortable(qName, sourceFileIdx) {
    const sortableContainer = document.getElementById('sortableQuestionsList');
    const alreadyExists = Array.from(sortableContainer.querySelectorAll('.question-item')).some(el => el.getAttribute('data-col') === qName);
    if (alreadyExists) return;

    const missingIn = autoMapQuestion(qName, sourceFileIdx ?? 0);

    const item = _tpl('tpl-sortable-q-item');
    item.dataset.col = qName;
    const labelSpan = item.querySelector('.q-label-span');
    labelSpan.textContent = qName;
    labelSpan.title = qName;

    if (missingIn.length > 0) {
        const warn = _tpl('tpl-missing-warning');
        warn.dataset.bsToggle = 'tooltip';
        warn.title = `Вопрос не найден в: ${missingIn.join(', ')}`;
        item.appendChild(warn);
    }

    if (window.processedFiles.length > 1) {
        const mapBtn = _tpl('tpl-sortable-mapping-btn');
        mapBtn.dataset.qname = qName;
        item.appendChild(mapBtn);
    }

    sortableContainer.appendChild(item);

    initTooltips();
    checkEmptyPlaceholder();
    updateQuestionsBtn();
}

function removeQuestionFromSortable(qName) {
    document.getElementById('sortableQuestionsList').querySelectorAll('.question-item').forEach(el => {
        if (el.getAttribute('data-col') === qName) el.remove();
    });
    delete window.questionMapping[qName];
    delete window.questionSourceFile[qName];
    checkEmptyPlaceholder();
    updateQuestionsBtn();
}

function checkEmptyPlaceholder() {
    const sortableContainer = document.getElementById('sortableQuestionsList');
    const emptyPlaceholder = document.getElementById('emptySortablePlaceholder');
    const hasItems = sortableContainer.querySelectorAll('.question-item').length > 0;
    if (emptyPlaceholder) emptyPlaceholder.style.display = hasItems ? 'none' : 'block';
}

window.openMappingModal = function (qName) {
    currentMappingQName = qName;
    const mapping = window.questionMapping[qName] || {};
    const sourceFileIdx = window.questionSourceFile[qName] ?? 0;
    const sourceFile = window.processedFiles[sourceFileIdx];
    const body = document.getElementById('mappingModalBody');
    body.innerHTML = '';

    const p = document.createElement('p');
    p.className = 'fw-bold mb-3';
    p.appendChild(document.createTextNode('Соотнести вопрос:\n'));
    const primarySpan = document.createElement('span');
    primarySpan.className = 'text-primary';
    primarySpan.textContent = qName;
    p.appendChild(primarySpan);
    p.appendChild(document.createTextNode('\n'));
    const smallEl = document.createElement('small');
    smallEl.className = 'text-muted fw-normal';
    smallEl.textContent = `Источник: ${sourceFile.original_name}`;
    p.appendChild(smallEl);
    body.appendChild(p);

    if (_isMissingMapping(qName)) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-warning py-2 small mb-3';
        alert.innerHTML = '<i class="fa-solid fa-triangle-exclamation me-1"></i>Вопрос не соотнесён со всеми файлами. Выберите соответствующий вопрос в каждом файле ниже или оставьте поле пустым.';
        body.appendChild(alert);
    }

    for (let i = 0; i < window.processedFiles.length; i++) {
        if (i === sourceFileIdx) continue;
        const f = window.processedFiles[i];
        const currentMapped = mapping[f.clean_filename] || '';

        const block = _tpl('tpl-mapping-file-block');
        block.querySelector('.mapping-file-label').textContent = `В файле: ${f.original_name}`;
        const select = block.querySelector('.mapping-select');
        select.dataset.file = f.clean_filename;

        const optNone = document.createElement('option');
        optNone.value = '';
        optNone.textContent = '-- Не соотносить --';
        select.appendChild(optNone);

        f.columns.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name;
            if (c.name === currentMapped) opt.selected = true;
            select.appendChild(opt);
        });

        body.appendChild(block);
    }

    const modalEl = document.getElementById('dataMappingModal');
    $('.mapping-select').select2({
        theme: 'bootstrap-5',
        width: '100%',
        dropdownParent: $(modalEl),
        language: 'ru',
        placeholder: '-- Не соотносить --',
        allowClear: true
    });

    new bootstrap.Modal(modalEl).show();
};

document.getElementById('saveMappingBtn').addEventListener('click', () => {
    const selects = document.querySelectorAll('.mapping-select');
    const sourceFileIdx = window.questionSourceFile[currentMappingQName] ?? 0;
    const sourceFile = window.processedFiles[sourceFileIdx];
    const mapping = { [sourceFile.clean_filename]: currentMappingQName };
    let missingCount = 0;

    selects.forEach(sel => {
        if (sel.value) mapping[sel.getAttribute('data-file')] = sel.value;
        else missingCount++;
    });

    window.questionMapping[currentMappingQName] = mapping;

    const isMissing = missingCount > 0;
    const missingTitle = 'Вопрос не соотнесён во всех файлах — нажмите, чтобы исправить';
    const okTitle = 'Соотнести вручную';

    document.querySelectorAll('.section-q-mapping-btn').forEach(btn => {
        if (btn.dataset.qname !== currentMappingQName) return;
        btn.classList.toggle('text-danger', isMissing);
        btn.title = isMissing ? missingTitle : okTitle;
        const row = btn.closest('.section-question-item');
        if (row) {
            row.classList.toggle('q-item-missing', isMissing);
            const sec = window.reportSections.find(s => s.questions.some(q => q.qName === currentMappingQName));
            const q = sec && sec.questions.find(q => q.qName === currentMappingQName);
            if (!isMissing && q && q.visualize) row.classList.add('q-item-viz');
            else row.classList.remove('q-item-viz');
        }
    });

    document.querySelectorAll('.avail-q-mapping-btn').forEach(btn => {
        if (btn.dataset.qname !== currentMappingQName) return;
        btn.classList.toggle('text-danger', isMissing);
        btn.title = isMissing ? missingTitle : okTitle;
        const row = btn.closest('.available-q-item');
        if (row) row.classList.toggle('q-item-missing', isMissing);
    });

    bootstrap.Modal.getInstance(document.getElementById('dataMappingModal')).hide();
});

// ===================== QUESTION LIST EVENT HANDLERS =====================
document.getElementById('questionsSearchInput').addEventListener('input', filterQuestionsList);
document.getElementById('questionsSearchClear').addEventListener('click', () => {
    document.getElementById('questionsSearchInput').value = '';
    filterQuestionsList();
});

$('#fileSelectStep3').on('change', function () {
    document.querySelectorAll('#sortableQuestionsList .question-item').forEach(el => {
        delete window.questionMapping[el.dataset.col];
        delete window.questionSourceFile[el.dataset.col];
    });
    document.getElementById('sortableQuestionsList').innerHTML = '<div class="p-3 text-center text-muted" id="emptySortablePlaceholder"><i class="fa-solid fa-hand-pointer me-1"></i>Выберите вопросы на шаге 3, чтобы они появились здесь</div>';
    document.getElementById('selectAllQuestions').checked = false;
    updateQuestionsBtn();
    _renderQuestionsForFile(parseInt(this.value, 10));
});

document.getElementById('allQuestionsList').addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
    const container = e.target.closest('.q-item-container');
    if (!container) return;
    const cb = container.querySelector('.q-checkbox');
    if (cb) cb.click();
});

document.getElementById('allQuestionsList').addEventListener('change', (e) => {
    if (e.target.classList.contains('q-checkbox')) {
        const sourceFileIdx = parseInt(document.getElementById('fileSelectStep3').value || '0', 10);
        if (e.target.checked) addQuestionToSortable(e.target.value, sourceFileIdx);
        else removeQuestionFromSortable(e.target.value);

        const total = document.querySelectorAll('.q-item-container:not(.d-none):not(.q-filtered)').length;
        const checked = document.querySelectorAll('.q-item-container:not(.d-none):not(.q-filtered) .q-checkbox:checked').length;
        document.getElementById('selectAllQuestions').checked = (total === checked && total > 0);
    }
});

document.getElementById('selectAllQuestions').addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const sourceFileIdx = parseInt(document.getElementById('fileSelectStep3').value || '0', 10);
    document.querySelectorAll('.q-item-container:not(.d-none):not(.q-filtered)').forEach(el => {
        const cb = el.querySelector('.q-checkbox');
        if (cb.checked !== isChecked) {
            cb.checked = isChecked;
            if (isChecked) addQuestionToSortable(cb.value, sourceFileIdx);
            else removeQuestionFromSortable(cb.value);
        }
    });
});

document.getElementById('showHiddenCols').addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll('#allQuestionsList .system-col').forEach(el => {
        if (isChecked) el.classList.remove('d-none');
        else {
            el.classList.add('d-none');
            const cb = el.querySelector('.q-checkbox');
            if (cb && cb.checked) { cb.checked = false; removeQuestionFromSortable(cb.value); }
        }
    });
    const total = document.querySelectorAll('.q-item-container:not(.d-none)').length;
    const checked = document.querySelectorAll('.q-item-container:not(.d-none) .q-checkbox:checked').length;
    document.getElementById('selectAllQuestions').checked = (total === checked && total > 0);
});

document.getElementById('sortableQuestionsList').addEventListener('change', (e) => {
    if (e.target.classList.contains('viz-all-cb')) {
        e.target.closest('.dropdown-menu').querySelectorAll('.viz-opt-cb').forEach(cb => cb.checked = e.target.checked);
    }
    if (e.target.classList.contains('viz-opt-cb')) {
        const dp = e.target.closest('.dropdown-menu');
        dp.querySelector('.viz-all-cb').checked = (dp.querySelectorAll('.viz-opt-cb').length === dp.querySelectorAll('.viz-opt-cb:checked').length);
    }
});

document.getElementById('sortableQuestionsList').addEventListener('click', (e) => {
    const btn = e.target.closest('.mapping-btn');
    if (btn) openMappingModal(btn.dataset.qname);
});


// ===================== REHYDRATE (этап 4) =====================
// Перерисовка шага 3 после refresh: восстанавливает выпадашку выбора файла,
// список доступных вопросов и сортируемый список выбранных — БЕЗ затирания
// сохранённого questionMapping (в отличие от addQuestionToSortable, который
// внутри вызывает autoMapQuestion и переписывает mapping заново).

function _buildSortableItemFromMapping(qName) {
    // Создаёт DOM-элемент сортируемого вопроса, используя текущий
    // window.questionMapping[qName] (а не auto-detect). Если в mapping
    // что-то отсутствует — рисует значок «missing».
    const sortableContainer = document.getElementById('sortableQuestionsList');
    if (Array.from(sortableContainer.querySelectorAll('.question-item'))
        .some(el => el.getAttribute('data-col') === qName)) return;

    const item = _tpl('tpl-sortable-q-item');
    item.dataset.col = qName;
    const labelSpan = item.querySelector('.q-label-span');
    labelSpan.textContent = qName;
    labelSpan.title = qName;

    const qMapping = (window.questionMapping || {})[qName] || {};
    const missingIn = (window.processedFiles || [])
        .filter(f => !qMapping[f.clean_filename])
        .map(f => f.original_name);

    if (missingIn.length > 0) {
        const warn = _tpl('tpl-missing-warning');
        warn.dataset.bsToggle = 'tooltip';
        warn.title = `Вопрос не найден в: ${missingIn.join(', ')}`;
        item.appendChild(warn);
    }

    if (window.processedFiles && window.processedFiles.length > 1) {
        const mapBtn = _tpl('tpl-sortable-mapping-btn');
        mapBtn.dataset.qname = qName;
        item.appendChild(mapBtn);
    }

    sortableContainer.appendChild(item);
}

function rehydrateQuestionsUI() {
    if (!window.processedFiles || !window.processedFiles.length) return false;

    // 1) Выпадашка выбора исходного файла.
    const fileSelect = document.getElementById('fileSelectStep3');
    const fileSelectContainer = document.getElementById('fileSelectContainer');
    if (window.processedFiles.length > 1) {
        if (window.jQuery && $(fileSelect).hasClass('select2-hidden-accessible')) {
            $(fileSelect).select2('destroy');
        }
        fileSelect.innerHTML = window.processedFiles.map((f, i) =>
            `<option value="${i}">${f.original_name}</option>`
        ).join('');
        if (fileSelectContainer) fileSelectContainer.style.display = '';
        if (window.jQuery) {
            $(fileSelect).select2({ theme: 'bootstrap-5', width: '100%', language: 'ru' });
        }
    } else if (fileSelectContainer) {
        fileSelectContainer.style.display = 'none';
    }

    // 2) Сортируемый список выбранных вопросов — из questionMapping,
    //    но БЕЗ авто-маппинга поверх (mapping уже восстановлен).
    const sortableContainer = document.getElementById('sortableQuestionsList');
    sortableContainer.innerHTML = '<div class="p-3 text-center text-muted" id="emptySortablePlaceholder"><i class="fa-solid fa-hand-pointer me-1"></i>Выберите вопросы на шаге 3, чтобы они появились здесь</div>';

    Object.keys(window.questionMapping || {}).forEach(qName => {
        _buildSortableItemFromMapping(qName);
    });

    // 3) Список доступных вопросов для текущего файла. _renderQuestionsForFile
    //    сам учитывает текущее содержимое sortable-списка (через selectedQNames),
    //    поэтому чекбоксы выставляются автоматически.
    fileSelect.value = '0';
    _renderQuestionsForFile(0);

    // 4) Sortable.js на свежем контейнере.
    if (typeof Sortable !== 'undefined') {
        new Sortable(sortableContainer, {
            handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost',
        });
    }

    if (typeof checkEmptyPlaceholder === 'function') checkEmptyPlaceholder();
    if (typeof initTooltips === 'function') initTooltips();
    if (typeof updateQuestionsBtn === 'function') updateQuestionsBtn();
    return true;
}

window.rehydrateQuestionsUI = rehydrateQuestionsUI;
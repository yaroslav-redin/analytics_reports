// ===================== step4.js =====================
// ===================== ШАГ 4: СТРУКТУРА ОТЧЁТА =====================
window.reportSections = window.reportSections || [];
let _sectionIdCounter = 0;

function _nextSectionColor() {
    const idx = (window.reportSections || []).length;
    return idx < PIE_COLORS.length ? PIE_COLORS[idx] : randomColor();
}

function _getAllStep3QNames() {
    return Array.from(document.querySelectorAll('#sortableQuestionsList .question-item')).map(el => el.dataset.col);
}

function _getAssignedQNames() {
    const s = new Set();
    (window.reportSections || []).forEach(sec => sec.questions.forEach(q => s.add(q.qName)));
    return s;
}

function _updateToStep5Btn() {
    const btn = document.getElementById('toStep5Btn');
    if (!btn) return;
    const hasAnything = (window.reportSections && window.reportSections.length > 0)
        || document.querySelectorAll('#availableQuestionsList .available-q-item').length > 0
        || document.querySelectorAll('#sortableQuestionsList .question-item').length > 0;
    btn.disabled = !hasAnything;
    btn.title = hasAnything ? '' : 'Выберите вопросы на шаге 3';
}

function renderStep4() {
    _renderSectionsList();
    _renderAvailableQuestions();
}

function _renderSectionsList() {
    const container = document.getElementById('sectionsList');
    _updateToStep5Btn();
    if (!window.reportSections || !window.reportSections.length) {
        container.innerHTML = '<p class="text-muted small text-center mt-3 px-2 mb-0"></p>';
        return;
    }
    container.innerHTML = '';
    window.reportSections.forEach(sec => {
        container.appendChild(_buildSectionCard(sec));
    });
    window.reportSections.forEach(sec => {
        const listEl = container.querySelector(`.section-questions-list[data-section-id="${sec.id}"]`);
        if (!listEl) return;
        new Sortable(listEl, {
            handle: '.section-q-drag',
            animation: 150,
            ghostClass: 'sortable-ghost',
            filter: '.section-empty-hint',
            onEnd: evt => {
                const s = window.reportSections.find(x => x.id === sec.id);
                if (!s) return;
                const moved = s.questions.splice(evt.oldIndex, 1)[0];
                s.questions.splice(evt.newIndex, 0, moved);
            }
        });
    });
}

function _buildSectionCard(sec) {
    const collapsed = window._collapsedSections && window._collapsedSections.has(sec.id);
    const sectionColor = sec.color || '#a0bce5';

    const card = _tpl('tpl-section-card');
    card.dataset.sectionId = sec.id;
    card.style.borderLeft = `3px solid ${sectionColor}`;

    const colBtn = card.querySelector('.section-collapse-btn');
    colBtn.dataset.sectionId = sec.id;
    colBtn.title = collapsed ? 'Развернуть' : 'Свернуть';
    colBtn.style.color = sectionColor;
    colBtn.querySelector('i').className = `fa-solid ${collapsed ? 'fa-chevron-up' : 'fa-chevron-down'}`;

    const nameSpan = card.querySelector('.section-card-name');
    nameSpan.textContent = sec.name;
    nameSpan.title = sec.name;
    nameSpan.style.color = sectionColor;

    card.querySelector('.add-qs-to-section-btn').dataset.sectionId = sec.id;
    card.querySelector('.edit-section-btn').dataset.sectionId = sec.id;
    card.querySelector('.delete-section-btn').dataset.sectionId = sec.id;

    const wrapper = card.querySelector('.section-questions-wrapper');
    wrapper.dataset.sectionId = sec.id;
    if (collapsed) wrapper.classList.add('collapsed');

    const listEl = card.querySelector('.section-questions-list');
    listEl.dataset.sectionId = sec.id;

    if (sec.questions.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'section-empty-hint';
        hint.textContent = 'Перетащите вопросы сюда или нажмите «+»';
        listEl.appendChild(hint);
    } else {
        sec.questions.forEach(q => listEl.appendChild(_buildSectionQuestion(sec.id, q)));
    }

    return card;
}

function _isMissingMapping(qName) {
    if (!window.processedFiles || window.processedFiles.length <= 1) return false;
    const mapping = window.questionMapping[qName] || {};
    return Object.keys(mapping).length < window.processedFiles.length;
}

function _buildSectionQuestion(sectionId, q) {
    const multiFile = window.processedFiles && window.processedFiles.length > 1;
    const missing = multiFile && _isMissingMapping(q.qName);
    const merges = (window.questionMerges || {})[q.qName];
    const hasMerge = merges && merges.length;
    const mergeTitle = hasMerge
        ? `Склеен с: ${merges.map(m => `«${m}»`).join(', ')} (нажмите, чтобы изменить)`
        : 'Склеить с другим вопросом';

    const item = _tpl('tpl-section-question');
    item.dataset.qname = q.qName;
    item.dataset.sectionId = sectionId;
    if (missing) item.classList.add('q-item-missing');
    else if (q.visualize) item.classList.add('q-item-viz');

    const nameSpan = item.querySelector('.section-q-name');
    nameSpan.textContent = q.qName;
    nameSpan.title = q.qName;

    const vizBtn = item.querySelector('.section-q-viz-btn');
    vizBtn.dataset.qname = q.qName;
    vizBtn.dataset.sectionId = sectionId;
    vizBtn.title = q.visualize ? 'Визуализируется (нажмите, чтобы отключить)' : 'Добавить визуализацию';
    if (q.visualize) vizBtn.classList.add('active');

    const mergeBtn = item.querySelector('.merge-question-btn');
    mergeBtn.dataset.qname = q.qName;
    mergeBtn.title = mergeTitle;
    if (hasMerge) mergeBtn.classList.add('btn-warning');

    const removeBtn = item.querySelector('.section-q-remove-btn');
    removeBtn.dataset.qname = q.qName;
    removeBtn.dataset.sectionId = sectionId;

    if (multiFile) {
        const mapBtn = _tpl('tpl-section-q-mapping-btn');
        mapBtn.dataset.qname = q.qName;
        mapBtn.title = missing
            ? 'Вопрос не соотнесён во всех файлах — нажмите, чтобы исправить'
            : 'Соотнести вручную';
        if (missing) mapBtn.classList.add('text-danger');
        item.insertBefore(mapBtn, removeBtn);
    }

    return item;
}

function _buildAvailableQItem(qName) {
    const multiFile = window.processedFiles && window.processedFiles.length > 1;
    const missing = multiFile && _isMissingMapping(qName);

    const item = _tpl('tpl-available-q-item');
    item.dataset.qname = qName;
    if (missing) item.classList.add('q-item-missing');

    const cb = item.querySelector('.avail-q-cb');
    cb.dataset.qname = qName;

    const nameSpan = item.querySelector('.avail-q-name');
    nameSpan.textContent = qName;
    nameSpan.title = qName;

    if (multiFile) {
        const mapBtn = _tpl('tpl-avail-q-mapping-btn');
        mapBtn.dataset.qname = qName;
        mapBtn.title = missing
            ? 'Вопрос не соотнесён во всех файлах — нажмите, чтобы исправить'
            : 'Соотнести вручную';
        if (missing) mapBtn.classList.add('text-danger');
        item.insertBefore(mapBtn, item.querySelector('.merge-question-btn'));
    }

    item.setAttribute('draggable', 'true');
    item.addEventListener('click', e => {
        if (e.target.classList.contains('avail-q-cb')) return;
        if (e.target.closest('.merge-question-btn') || e.target.closest('.avail-q-mapping-btn')) return;
        const c = item.querySelector('.avail-q-cb');
        if (c) c.checked = !c.checked;
        _syncSelectAllAvailableQ();
    });
    item.addEventListener('dragstart', e => {
        item.classList.add('dragging');
        const c = item.querySelector('.avail-q-cb');
        const checkedNames = Array.from(document.querySelectorAll('#availableQuestionsList .avail-q-cb:checked')).map(x => x.dataset.qname);
        window._step4DragNames = (c && c.checked && checkedNames.length > 0) ? checkedNames : [qName];
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', window._step4DragNames.join('\n'));
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.querySelector('.avail-q-cb').addEventListener('change', _syncSelectAllAvailableQ);

    return item;
}

function _renderAvailableQuestions() {
    const container = document.getElementById('availableQuestionsList');
    const assigned = _getAssignedQNames();

    const donorNames = new Set();
    Object.values(window.questionMerges || {}).forEach(donors => {
        donors.forEach(d => donorNames.add(d));
    });

    const available = _getAllStep3QNames().filter(q => !assigned.has(q) && !donorNames.has(q));

    if (!available.length) {
        container.innerHTML = '<p class="text-muted small text-center mt-2 mb-0">Все вопросы распределены по разделам</p>';
        return;
    }

    container.innerHTML = '';
    available.forEach(qName => container.appendChild(_buildAvailableQItem(qName)));

    const selectAll = document.getElementById('selectAllAvailableQ');
    if (selectAll) selectAll.checked = false;
}

function _syncSelectAllAvailableQ() {
    const all = Array.from(document.querySelectorAll('#availableQuestionsList .avail-q-cb'));
    const selectAll = document.getElementById('selectAllAvailableQ');
    if (!selectAll || !all.length) return;
    const checkedCount = all.filter(cb => cb.checked).length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < all.length;
    selectAll.checked = checkedCount === all.length;
}

document.getElementById('selectAllAvailableQ').addEventListener('change', function () {
    document.querySelectorAll('#availableQuestionsList .avail-q-cb').forEach(cb => { cb.checked = this.checked; });
});

function _addQNamesToSection(sectionId, qNames) {
    const sec = window.reportSections.find(s => s.id === sectionId);
    if (!sec) return;
    const assigned = _getAssignedQNames();
    let added = false;
    qNames.forEach(qName => {
        if (qName && !assigned.has(qName) && !sec.questions.find(q => q.qName === qName)) {
            sec.questions.push({ qName, visualize: false });
            assigned.add(qName);
            added = true;
        }
    });
    if (added) renderStep4();
}

// Drag-drop на зону раздела
document.getElementById('sectionsList').addEventListener('dragover', e => {
    if (!window._step4DragNames || !window._step4DragNames.length) return;
    const zone = e.target.closest('.section-questions-list');
    if (zone) { e.preventDefault(); zone.classList.add('drag-over'); }
});
document.getElementById('sectionsList').addEventListener('dragleave', e => {
    if (!window._step4DragNames || !window._step4DragNames.length) return;
    const zone = e.target.closest('.section-questions-list');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
});
document.getElementById('sectionsList').addEventListener('drop', e => {
    if (!window._step4DragNames || !window._step4DragNames.length) return;
    const zone = e.target.closest('.section-questions-list');
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('drag-over');
    const names = window._step4DragNames;
    window._step4DragNames = [];
    _addQNamesToSection(zone.dataset.sectionId, names);
});

// Клики в панели разделов
document.getElementById('sectionsList').addEventListener('click', e => {
    const colBtn = e.target.closest('.section-collapse-btn');
    if (colBtn) {
        const secId = colBtn.dataset.sectionId;
        const wrapperEl = document.querySelector(`.section-questions-wrapper[data-section-id="${secId}"]`);
        const isNowCollapsed = wrapperEl.classList.toggle('collapsed');
        colBtn.querySelector('i').className = `fa-solid ${isNowCollapsed ? 'fa-chevron-up' : 'fa-chevron-down'}`;
        colBtn.title = isNowCollapsed ? 'Развернуть' : 'Свернуть';
        if (!window._collapsedSections) window._collapsedSections = new Set();
        if (isNowCollapsed) window._collapsedSections.add(secId);
        else window._collapsedSections.delete(secId);
        return;
    }
    const addBtn = e.target.closest('.add-qs-to-section-btn');
    if (addBtn) {
        const checked = Array.from(document.querySelectorAll('#availableQuestionsList .avail-q-cb:checked')).map(cb => cb.dataset.qname);
        if (!checked.length) { showToast('Выберите вопросы в правом списке', 'warning'); return; }
        _addQNamesToSection(addBtn.dataset.sectionId, checked);
        return;
    }
    const editBtn = e.target.closest('.edit-section-btn');
    if (editBtn) {
        const sec = window.reportSections.find(s => s.id === editBtn.dataset.sectionId);
        if (!sec) return;
        document.getElementById('editSectionId').value = sec.id;
        document.getElementById('editSectionName').value = sec.name;
        document.getElementById('editSectionName').classList.remove('is-invalid');
        document.getElementById('editSectionDesc').value = sec.description || '';
        document.getElementById('editSectionColor').value = sec.color || '#a0bce5';
        new bootstrap.Modal(document.getElementById('editSectionModal')).show();
        return;
    }
    const delBtn = e.target.closest('.delete-section-btn');
    if (delBtn) {
        const sec = window.reportSections.find(s => s.id === delBtn.dataset.sectionId);
        if (!sec) return;
        document.getElementById('deleteSectionNameLabel').textContent = `«${sec.name}»`;
        document.getElementById('confirmDeleteSectionBtn').dataset.sectionId = sec.id;
        new bootstrap.Modal(document.getElementById('confirmDeleteSectionModal')).show();
        return;
    }
    const remBtn = e.target.closest('.section-q-remove-btn');
    if (remBtn) {
        const sec = window.reportSections.find(s => s.id === remBtn.dataset.sectionId);
        if (sec) sec.questions = sec.questions.filter(q => q.qName !== remBtn.dataset.qname);
        renderStep4();
        return;
    }
    const mapBtn = e.target.closest('.section-q-mapping-btn');
    if (mapBtn) { openMappingModal(mapBtn.dataset.qname); return; }

    const secMergeBtn = e.target.closest('.section-question-item .merge-question-btn');
    if (secMergeBtn) {
        _mergeQuestionsSourceName = secMergeBtn.dataset.qname;
        openMergeQuestionsModal(_mergeQuestionsSourceName);
        return;
    }

    const vizBtn = e.target.closest('.section-q-viz-btn');
    if (vizBtn) {
        const sec = window.reportSections.find(s => s.id === vizBtn.dataset.sectionId);
        if (!sec) return;
        const q = sec.questions.find(q => q.qName === vizBtn.dataset.qname);
        if (!q) return;
        q.visualize = !q.visualize;
        vizBtn.classList.toggle('active', q.visualize);
        vizBtn.title = q.visualize ? 'Визуализируется (нажмите, чтобы отключить)' : 'Добавить визуализацию';
        const row = vizBtn.closest('.section-question-item');
        if (row && !row.classList.contains('q-item-missing')) {
            row.classList.toggle('q-item-viz', q.visualize);
        }
        return;
    }
});

// Модалка добавления раздела
document.getElementById('addSectionBtn').addEventListener('click', () => {
    document.getElementById('newSectionName').value = '';
    document.getElementById('newSectionName').classList.remove('is-invalid');
    document.getElementById('newSectionDesc').value = '';
    document.getElementById('newSectionColor').value = _nextSectionColor();
    new bootstrap.Modal(document.getElementById('addSectionModal')).show();
});

document.getElementById('newSectionName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('confirmAddSectionBtn').click(); }
});

document.getElementById('confirmAddSectionBtn').addEventListener('click', () => {
    const name = document.getElementById('newSectionName').value.trim();
    if (!name) { document.getElementById('newSectionName').classList.add('is-invalid'); return; }
    document.getElementById('newSectionName').classList.remove('is-invalid');
    window.reportSections.push({
        id: 'sec_' + (++_sectionIdCounter),
        name,
        description: document.getElementById('newSectionDesc').value.trim(),
        color: document.getElementById('newSectionColor').value,
        questions: []
    });
    bootstrap.Modal.getInstance(document.getElementById('addSectionModal')).hide();
    _renderSectionsList();
});

document.getElementById('confirmEditSectionBtn').addEventListener('click', () => {
    const name = document.getElementById('editSectionName').value.trim();
    if (!name) { document.getElementById('editSectionName').classList.add('is-invalid'); return; }
    document.getElementById('editSectionName').classList.remove('is-invalid');
    const secId = document.getElementById('editSectionId').value;
    const sec = window.reportSections.find(s => s.id === secId);
    if (sec) {
        sec.name = name;
        sec.description = document.getElementById('editSectionDesc').value.trim();
        sec.color = document.getElementById('editSectionColor').value;
    }
    bootstrap.Modal.getInstance(document.getElementById('editSectionModal')).hide();
    _renderSectionsList();
});

document.getElementById('confirmDeleteSectionBtn').addEventListener('click', function () {
    const secId = this.dataset.sectionId;
    window.reportSections = window.reportSections.filter(s => s.id !== secId);
    bootstrap.Modal.getInstance(document.getElementById('confirmDeleteSectionModal')).hide();
    renderStep4();
});

// ===================== СКЛЕЙКА ВОПРОСОВ =====================
let _mergeQuestionsSourceName = null;

// Делегирование на availableQuestionsList
document.getElementById('availableQuestionsList').addEventListener('click', (e) => {
    const mapBtn = e.target.closest('.avail-q-mapping-btn');
    if (mapBtn) { openMappingModal(mapBtn.dataset.qname); return; }

    const btn = e.target.closest('.merge-question-btn');
    if (!btn) return;
    _mergeQuestionsSourceName = btn.dataset.qname;
    openMergeQuestionsModal(_mergeQuestionsSourceName);
});

function openMergeQuestionsModal(sourceName) {
    document.getElementById('mergeQuestionsSourceLabel').textContent = `«${sourceName}»`;
    document.getElementById('mergeQuestionsSearch').value = '';

    _renderAttachedDonors(sourceName);

    const allQNames = Array.from(
        document.querySelectorAll('#availableQuestionsList .available-q-item')
    ).map(el => el.dataset.qname).filter(n => n !== sourceName);

    _renderMergeQuestionsList(allQNames, '');

    const searchEl = document.getElementById('mergeQuestionsSearch');
    const newSearch = searchEl.cloneNode(true);
    searchEl.parentNode.replaceChild(newSearch, searchEl);
    newSearch.addEventListener('input', function () {
        _renderMergeQuestionsList(allQNames, this.value.trim().toLowerCase());
    });

    new bootstrap.Modal(document.getElementById('mergeQuestionsModal')).show();
}

function _renderMergeQuestionsList(names, filter) {
    const container = document.getElementById('mergeQuestionsList');
    const filtered = filter ? names.filter(n => n.toLowerCase().includes(filter)) : names;

    if (!filtered.length) {
        container.innerHTML = '<p class="text-muted small text-center py-3 mb-0">Нет доступных вопросов</p>';
        return;
    }

    container.innerHTML = '';
    filtered.forEach(name => {
        const item = _tpl('tpl-merge-q-item');
        const uid = 'mqcb_' + Math.random().toString(36).slice(2);
        const cb = item.querySelector('.merge-q-checkbox');
        cb.value = name;
        cb.id = uid;
        const label = item.querySelector('.merge-q-label');
        label.htmlFor = uid;
        label.textContent = name;

        const merged = window.questionMerges && window.questionMerges[name];
        if (merged && merged.length) {
            const hint = document.createElement('small');
            hint.className = 'text-muted ms-2';
            const displayNames = merged.slice(0, 2).map(m => `«${m}»`).join(', ');
            hint.textContent = `(уже склеен с: ${displayNames}${merged.length > 2 ? ` +${merged.length - 2}` : ''})`;
            label.appendChild(hint);
        }

        container.appendChild(item);
    });
}

document.getElementById('applyMergeQuestionsBtn').addEventListener('click', () => {
    const checked = Array.from(
        document.querySelectorAll('#mergeQuestionsList .merge-q-checkbox:checked')
    ).map(cb => cb.value);

    if (!checked.length) {
        showToast('Выберите хотя бы один вопрос для склейки', 'warning');
        return;
    }

    if (!window.questionMerges) window.questionMerges = {};
    if (!window.questionMerges[_mergeQuestionsSourceName]) {
        window.questionMerges[_mergeQuestionsSourceName] = [];
    }
    checked.forEach(name => {
        if (!window.questionMerges[_mergeQuestionsSourceName].includes(name)) {
            window.questionMerges[_mergeQuestionsSourceName].push(name);
        }
    });

    checked.forEach(name => {
        const item = document.querySelector(`#availableQuestionsList .available-q-item[data-qname="${CSS.escape(name)}"]`);
        if (item) item.remove();
    });

    _updateMergeIndicator(_mergeQuestionsSourceName);

    bootstrap.Modal.getInstance(document.getElementById('mergeQuestionsModal')).hide();
    showToast(`Склеено вопросов: ${checked.length}`, 'success');
});

function _updateMergeIndicator(sourceName) {
    const merges = (window.questionMerges || {})[sourceName];
    const hasMerge = merges && merges.length;
    const title = hasMerge
        ? `Склеен с: ${merges.map(m => `«${m}»`).join(', ')} (нажмите, чтобы изменить)`
        : 'Склеить с другим вопросом';
    document.querySelectorAll(`.merge-question-btn[data-qname="${CSS.escape(sourceName)}"]`).forEach(btn => {
        btn.classList.toggle('btn-warning', !!hasMerge);
        btn.title = title;
    });
}

document.getElementById('randomNewSectionColor').addEventListener('click', () => {
    document.getElementById('newSectionColor').value = randomColor();
});
document.getElementById('randomEditSectionColor').addEventListener('click', () => {
    document.getElementById('editSectionColor').value = randomColor();
});

function _renderAttachedDonors(sourceName) {
    let attachedBlock = document.getElementById('mergeQuestionsAttached');
    if (!attachedBlock) {
        attachedBlock = document.createElement('div');
        attachedBlock.id = 'mergeQuestionsAttached';
        attachedBlock.className = 'mb-2';
        document.getElementById('mergeQuestionsSearch').insertAdjacentElement('beforebegin', attachedBlock);
    }

    const donors = (window.questionMerges && window.questionMerges[sourceName]) || [];
    if (!donors.length) {
        attachedBlock.innerHTML = '';
        return;
    }

    attachedBlock.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'small fw-semibold text-muted mb-1';
    header.innerHTML = '<i class="fa-solid fa-paperclip me-1"></i>Уже прикреплены:';
    attachedBlock.appendChild(header);

    donors.forEach(d => {
        const row = _tpl('tpl-attached-donor-row');
        row.dataset.donor = d;
        const nameSpan = row.querySelector('.attached-donor-name');
        nameSpan.textContent = d;
        nameSpan.title = d;
        const detachBtn = row.querySelector('.detach-donor-btn');
        detachBtn.dataset.source = sourceName;
        detachBtn.dataset.donor = d;
        attachedBlock.appendChild(row);
    });
}

document.getElementById('mergeQuestionsModal').addEventListener('click', (e) => {
    const btn = e.target.closest('.detach-donor-btn');
    if (!btn) return;

    const sourceName = btn.dataset.source;
    const donorName = btn.dataset.donor;

    if (window.questionMerges && window.questionMerges[sourceName]) {
        window.questionMerges[sourceName] = window.questionMerges[sourceName].filter(d => d !== donorName);
        if (window.questionMerges[sourceName].length === 0) {
            delete window.questionMerges[sourceName];
        }
    }

    const container = document.getElementById('availableQuestionsList');
    const alreadyThere = container.querySelector(`.available-q-item[data-qname="${CSS.escape(donorName)}"]`);
    if (!alreadyThere) {
        container.appendChild(_buildAvailableQItem(donorName));
    }

    _updateMergeIndicator(sourceName);
    _renderAttachedDonors(sourceName);
});

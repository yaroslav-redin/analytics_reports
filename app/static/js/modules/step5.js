// ===================== ШАГ 5: ВИЗУАЛИЗАЦИЯ =====================
function _safeColor(v) { return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#6c757d'; }

window.chartsData = {};
window.stackedChartsData = {};
window.pieChartsData = {};
window.renderedTabs = {};


function _newAppDataEntry(item, visualize) {
    // Свежая appData-запись с дефолтными настройками.
    return {
        question_name: item.col_name,
        visualize: visualize,
        options: {
            showTotal:       true,
            highlightTop:    false,
            topN:            1,
            chartDirection:  'y',
            highlightColor:  '#dc3545',
            dimOthers:       false,
            dimColor:        '#6c757d',
            hiddenCol:       'none',
            tableVertical:   false,
            showLegend:      visualize && item.file_keys.length > 1,
            skipAnalytics:   false,
        },
        headers: { h1: "Ответ", h2: "Кол-во ответивших", h3: "% от числа ответивших" },
        data:        item.data,
        file_keys:   item.file_keys,
        file_labels: item.file_labels,
        file_colors: item.file_colors,
        pieColors:   [...PIE_COLORS],
        barColors:   [...PIE_COLORS],
    };
}

function _buildReportSectionCard(secId, secName, secColor, isCollapsed) {
    const card = _tpl('tpl-report-section-card');
    const safeColor = _safeColor(secColor);
    card.style.borderLeft = `3px solid ${safeColor}`;
    card.style.paddingLeft = '8px';

    card.querySelector('.report-section-icon').style.color = safeColor;

    const nameSpan = card.querySelector('.report-section-name');
    nameSpan.textContent = secName;
    nameSpan.style.color = safeColor;

    const collapseBtn = card.querySelector('.report-section-collapse-btn');
    collapseBtn.dataset.sectionId = secId;
    collapseBtn.title = isCollapsed ? 'Развернуть' : 'Свернуть';
    collapseBtn.querySelector('i').className = `fa-solid ${isCollapsed ? 'fa-chevron-up' : 'fa-chevron-down'}`;

    const wrapper = card.querySelector('.report-section-wrapper');
    wrapper.dataset.sectionId = secId;
    if (isCollapsed) wrapper.classList.add('collapsed');

    card.querySelector('.report-section-body').id = `rsc_${secId}`;

    return card;
}

function _buildFullItemDOM(id, entry, container) {


    window.renderedTabs[id] = { bar: false, stacked: false, pie: false, both: false };
    window.chartsData[id] = true;
    window.stackedChartsData[id] = true;
    window.pieChartsData[id] = true;
    window._renderedItems.push({ id, name: entry.question_name });

    const el = _tpl('tpl-full-result-item');

    const titleSpan = el.querySelector('.full-item-title');
    titleSpan.textContent = entry.question_name;
    titleSpan.title = entry.question_name;

    el.querySelector('.full-item-collapse-btn').dataset.id = id;
    el.querySelector('.full-item-body').id = `full_body_${id}`;

    const tabsUl = el.querySelector('.full-item-tabs');
    tabsUl.id = `tabs_${id}`;
    tabsUl.querySelectorAll('.viz-tab-btn').forEach(btn => btn.dataset.id = id);

    const settings = el.querySelector('.full-item-settings');
    settings.id = `settings_${id}`;

    const _setInputId = (sel, uid) => {
        const inp = settings.querySelector(sel);
        inp.id = uid;
        inp.dataset.id = id;
        const lbl = inp.nextElementSibling;
        if (lbl && lbl.tagName === 'LABEL') lbl.htmlFor = uid;
        return inp;
    };
    const totalInput  = _setInputId('.setting-show-total',     `total_${id}`);
    const hlInput     = _setInputId('.setting-highlight-top',  `hl_${id}`);
    const tvertInput  = _setInputId('.setting-table-vertical', `tvert_${id}`);
    const cvertInput  = _setInputId('.setting-chart-vertical', `cvert_${id}`);
    const legendInput = _setInputId('.setting-show-legend',    `legend_${id}`);

    // Восстанавливаем состояния чекбоксов из entry.options (для рехидрации это важно).
    totalInput.checked  = entry.options.showTotal !== false;
    hlInput.checked     = !!entry.options.highlightTop;
    tvertInput.checked  = !!entry.options.tableVertical;
    cvertInput.checked  = entry.options.chartDirection === 'x';
    legendInput.checked = entry.options.showLegend !== false && entry.file_keys.length > 1;

    const topNInput = settings.querySelector('.setting-top-n');
    topNInput.dataset.id = id;
    topNInput.max = entry.data.length * entry.file_keys.length;
    topNInput.value = entry.options.topN || 1;

    const hlColorInput = settings.querySelector('.setting-highlight-color');
    hlColorInput.dataset.id = id;
    hlColorInput.value = entry.options.highlightColor || '#dc3545';

    const dimOthersInput = _setInputId('.setting-dim-others', `dimothers_${id}`);
    dimOthersInput.checked = !!entry.options.dimOthers;

    const dimColorInput = settings.querySelector('.setting-dim-color');
    dimColorInput.dataset.id = id;
    dimColorInput.value = entry.options.dimColor || '#6c757d';

    settings.querySelector('.random-highlight-color-btn').dataset.id = id;
    settings.querySelector('.full-item-hide-col-btn').dataset.id     = id;
    settings.querySelector('.full-item-edit-btn').dataset.id         = id;
    settings.querySelector('.full-item-fuzzy-btn').dataset.id        = id;

    el.querySelector('.full-item-pane-table').id = `pane_table_${id}`;
    el.querySelector('.full-item-table').id      = id;

    el.querySelector('.full-item-pane-bar').id            = `pane_bar_${id}`;
    el.querySelector('.full-item-bar-color-editor').id    = `bar_color_editor_${id}`;
    el.querySelector('.full-item-bar-canvas').id          = `canvas_${id}`;

    el.querySelector('.full-item-pane-stacked').id        = `pane_stacked_${id}`;
    el.querySelector('.full-item-stacked-canvas').id      = `stacked_canvas_${id}`;

    el.querySelector('.full-item-pane-pie').id            = `pane_pie_${id}`;
    el.querySelector('.full-item-pie-color-editor').id    = `pie_color_editor_${id}`;

    const pieCanvases = el.querySelector('.full-item-pie-canvases');
    entry.file_keys.forEach((fk, fi) => {
        const pc = _tpl('tpl-pie-canvas-item');
        pc.querySelector('.pie-file-label').textContent = entry.file_labels[fk];
        pc.querySelector('.pie-canvas-el').id = `pie_canvas_${id}_${fi}`;
        pc.querySelector('.pie-msg-el').id    = `pie_msg_${id}_${fi}`;
        pieCanvases.appendChild(pc);
    });

    el.querySelector('.full-item-pane-both').id = `pane_both_${id}`;
    const bothTable = el.querySelector('.full-item-both-table');
    bothTable.id = `both_table_${id}`;
    el.querySelector('.full-item-both-bar-color-editor').id = `both_bar_color_editor_${id}`;
    el.querySelector('.full-item-both-bar-canvas').id       = `both_canvas_${id}`;

    settings.querySelectorAll('[data-vis-tabs]').forEach(settEl => {
        settEl.classList.toggle('d-none', !settEl.dataset.visTabs.split(' ').includes('table'));
    });

    container.appendChild(el);
    renderTable(id);
}

function _buildSimpleItemDOM(id, entry, container) {
    const el = _tpl('tpl-simple-result-item');

    const titleSpan = el.querySelector('.simple-item-title');
    titleSpan.textContent = entry.question_name;
    titleSpan.title = entry.question_name;

    el.querySelector('.simple-item-collapse-btn').dataset.id = id;
    el.querySelector('.simple-item-body').id                 = `simple_body_${id}`;
    el.querySelector('.simple-item-fuzzy-btn').dataset.id    = id;
    el.querySelector('.simple-item-table').id                = id;

    container.appendChild(el);
    renderTable(id);
}

function _renderAllResultsFromAppData() {


    const reportContent = document.getElementById('reportContent');
    if (!reportContent) return;
    reportContent.innerHTML = '';

    // Сбрасываем DOM-связанные коллекции, но НЕ appData.
    window.chartsData = {};
    window.stackedChartsData = {};
    window.pieChartsData = {};
    window.renderedTabs = {};
    window._renderedItems = [];
    if (!(window._collapsedReportSections instanceof Set)) {
        window._collapsedReportSections = new Set();
    }
    window.charts = window.charts || {};

    // qName → id (пропускаем both_table_* алиасы).
    const nameToId = {};
    for (const id of Object.keys(window.appData)) {
        if (id.startsWith('both_table_')) continue;
        const e = window.appData[id];
        if (e && e.question_name) nameToId[e.question_name] = id;
    }

    const sections = window.reportSections || [];
    const assignedIds = new Set();

    sections.forEach(sec => {
        if (!sec.questions || sec.questions.length === 0) return;
        const rscCollapsed = window._collapsedReportSections.has(sec.id);
        const secColor = sec.color || '#a0bce5';
        const card = _buildReportSectionCard(sec.id, sec.name, secColor, rscCollapsed);
        reportContent.appendChild(card);

        const sectionBody = document.getElementById(`rsc_${sec.id}`);
        sec.questions.forEach(q => {
            const id = nameToId[q.qName];
            if (!id || !sectionBody) return;
            assignedIds.add(id);
            const entry = window.appData[id];
            if (entry.visualize) _buildFullItemDOM(id, entry, sectionBody);
            else                 _buildSimpleItemDOM(id, entry, sectionBody);
        });
    });

    // Нераспределённые
    const unassignedIds = Object.keys(nameToId)
        .map(qN => nameToId[qN])
        .filter(id => !assignedIds.has(id));

    if (unassignedIds.length) {
        const uaCollapsed = window._collapsedReportSections.has('unassigned');
        const card = _buildReportSectionCard('unassigned', 'Без раздела', '#6c757d', uaCollapsed);
        reportContent.appendChild(card);
        const unassignedBody = document.getElementById('rsc_unassigned');
        unassignedIds.forEach(id => {
            const entry = window.appData[id];
            _buildSimpleItemDOM(id, entry, unassignedBody);
        });
    }

    _recomputeCaptions();
    updateStep6Btn();
}

function renderAnalysisResults(items, sections) {
    // Свежий /analyze: пересоздаём appData с дефолтами по items, затем рисуем DOM.
    window.appData = {};

    const resultsByName = {};
    items.forEach(item => { if (item && item.col_name) resultsByName[item.col_name] = item; });

    const vizQNames = new Set();
    (sections || []).forEach(sec => {
        sec.questions.forEach(q => { if (q.visualize) vizQNames.add(q.qName); });
    });

    let idx = 0;

    // Сначала элементы из разделов (в порядке появления).
    (sections || []).forEach(sec => {
        sec.questions.forEach(q => {
            const item = resultsByName[q.qName];
            if (!item) return;
            const id = `item_${idx++}`;
            window.appData[id] = _newAppDataEntry(item, vizQNames.has(q.qName));
        });
    });

    // Затем «без раздела».
    const assignedQNames = new Set((sections || []).flatMap(s => s.questions.map(q => q.qName)));
    items.forEach(item => {
        if (assignedQNames.has(item.col_name)) return;
        const id = `item_${idx++}`;
        window.appData[id] = _newAppDataEntry(item, false);
    });

    // Сброс UI-состояний перед свежей сборкой.
    window._collapsedReportSections = new Set();

    _renderAllResultsFromAppData();
}

function rehydrateAnalysisResults() {
    // appData уже восстановлен из sessionStorage — просто перерисуем DOM.
    if (!window.appData || Object.keys(window.appData).length === 0) return false;
    _renderAllResultsFromAppData();
    return true;
}

// Делаем доступными для state.js / других модулей.
window.renderAnalysisResults  = renderAnalysisResults;
window.rehydrateAnalysisResults = rehydrateAnalysisResults;

// Collapse report sections and simple question items
document.getElementById('reportContent').addEventListener('click', e => {
    const colBtn = e.target.closest('.report-section-collapse-btn');
    if (colBtn) {
        const secId = colBtn.dataset.sectionId;
        const wrapper = document.querySelector(`.report-section-wrapper[data-section-id="${secId}"]`);
        if (!wrapper) return;
        const isNowCollapsed = wrapper.classList.toggle('collapsed');
        colBtn.querySelector('i').className = `fa-solid ${isNowCollapsed ? 'fa-chevron-up' : 'fa-chevron-down'}`;
        colBtn.title = isNowCollapsed ? 'Развернуть' : 'Свернуть';
        if (!window._collapsedReportSections) window._collapsedReportSections = new Set();
        if (isNowCollapsed) window._collapsedReportSections.add(secId);
        else window._collapsedReportSections.delete(secId);
        return;
    }
    const simpleToggle = e.target.closest('.simple-item-collapse-btn');
    if (simpleToggle) {
        const simpleId = simpleToggle.dataset.id;
        const simpleBody = document.getElementById(`simple_body_${simpleId}`);
        if (!simpleBody) return;
        simpleBody.classList.toggle('d-none');
        const isCollapsed = simpleBody.classList.contains('d-none');
        simpleToggle.closest('.result-item-simple').classList.toggle('open', !isCollapsed);
        simpleToggle.querySelector('i').className = `fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}`;
        simpleToggle.title = isCollapsed ? 'Развернуть' : 'Свернуть';
        return;
    }
    const fullToggle = e.target.closest('.full-item-collapse-btn');
    if (!fullToggle) return;
    const fullId = fullToggle.dataset.id;
    const fullBody = document.getElementById(`full_body_${fullId}`);
    if (!fullBody) return;
    fullBody.classList.toggle('d-none');
    const isCollapsed = fullBody.classList.contains('d-none');
    fullBody.closest('.full-item-wrapper')?.classList.toggle('full-item-open', !isCollapsed);
    fullToggle.querySelector('i').className = `fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}`;
    fullToggle.title = isCollapsed ? 'Развернуть' : 'Свернуть';
});

document.getElementById('analyzeBtn').addEventListener('click', async () => {

    const fileLabels = {};
    const fileColors = {};
    if (window.processedFiles && window.processedFiles.length === 1) {
        const f = window.processedFiles[0];
        fileLabels[f.clean_filename] = f.original_name.replace(/\.[^.]+$/, '');
        fileColors[f.clean_filename] = defaultColors[0];
    } else {
        document.querySelectorAll('.legend-label').forEach(el => { fileLabels[el.dataset.file] = el.value || el.placeholder; });
        document.querySelectorAll('.legend-color').forEach(el => { fileColors[el.dataset.file] = el.value; });
        // Запасной путь: если DOM легенды пуст (например, после перезагрузки без рехидрации),
        // берём метки и цвета из уже имеющегося appData.
        if (Object.keys(fileLabels).length === 0 && window.appData) {
            const _fe = Object.values(window.appData).find(e => e && e.file_labels);
            if (_fe) {
                Object.assign(fileLabels, _fe.file_labels);
                Object.assign(fileColors, _fe.file_colors || {});
            }
        }
    }

    const ALL_VIZ = ['Таблица', 'Столбчатая диаграмма', 'Накопленная диаграмма', 'Круговая диаграмма'];
    const configs = [];
    const addedQNames = new Set();

    (window.reportSections || []).forEach(sec => {
        sec.questions.forEach(q => {
            if (addedQNames.has(q.qName)) return;
            addedQNames.add(q.qName);
            const mergedColumns = (window.questionMerges && window.questionMerges[q.qName]) || [];
            configs.push({
                column: q.qName,
                viz_type: ALL_VIZ,
                file_mapping: window.questionMapping[q.qName],
                merged_columns: mergedColumns,
                section_id: sec.id
            });
        });
    });

    document.querySelectorAll('#availableQuestionsList .available-q-item').forEach(el => {
        const qName = el.dataset.qname;
        if (addedQNames.has(qName)) return;
        addedQNames.add(qName);
        const mergedColumns = (window.questionMerges && window.questionMerges[qName]) || [];
        configs.push({
            column: qName,
            viz_type: ALL_VIZ,
            file_mapping: window.questionMapping[qName],
            merged_columns: mergedColumns,
            section_id: null
        });
    });

    if (!configs.length) {
        showToast('Нет вопросов. Выберите вопросы на шаге 3.', 'warning');
        return;
    }

    const payload = { session_id: window.sessionId, file_labels: fileLabels, file_colors: fileColors, configs: configs };

    document.getElementById('analyzeBtn').disabled = true;
    document.getElementById('analyzeSpinner').classList.remove('d-none');

    try {
        const response = await fetch('/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (response.ok) {
            renderAnalysisResults(data.results, window.reportSections);
        } else { showToast(data.message, 'danger'); }
    } catch (err) { showToast('Ошибка соединения с сервером', 'danger'); }
    finally {
        document.getElementById('analyzeBtn').disabled = false;
        document.getElementById('analyzeSpinner').classList.add('d-none');
    }
});

// Подписи «Таблица N» и «Рисунок N» зависят от активной вкладки каждого вопроса.
function _recomputeCaptions() {
    let tNum = 1;
    let fNum = 1;
    (window._renderedItems || []).forEach(({ id, name }) => {
        const tabsEl = document.getElementById(`tabs_${id}`);
        if (!tabsEl) return;
        const activeBtn = tabsEl.querySelector('.viz-tab-btn.active');
        const activeTab = activeBtn ? activeBtn.dataset.tab : 'table';
        const wrapper = tabsEl.closest('.full-item-wrapper');
        if (!wrapper) return;

        let myT = null, myF = null;
        if (activeTab === 'table') {
            myT = tNum++;
        } else if (activeTab === 'both') {
            myT = tNum++;
            myF = fNum++;
        } else {
            myF = fNum++;
        }

        const tableCap = myT ? `Таблица ${myT} – Распределение ответов респондентов на вопрос: «${name}»` : '';
        const figCap   = myF ? `Рисунок ${myF} – Распределение ответов респондентов на вопрос: «${name}»` : '';

        const _set = (sel, txt) => {
            const el = wrapper.querySelector(sel);
            if (el) el.textContent = txt;
        };
        _set('.full-item-table-caption', tableCap);
        _set('.full-item-bar-caption', figCap);
        _set('.full-item-stacked-caption', figCap);
        _set('.full-item-pie-caption', figCap);
        _set('.full-item-both-table-caption', tableCap);
        _set('.full-item-both-bar-caption', figCap);
    });
}
window._recomputeCaptions = _recomputeCaptions;

// ===================== VIZ INTERACTION HANDLERS =====================
document.addEventListener('click', e => {
    const rhlBtn = e.target.closest('.random-highlight-color-btn');
    if (rhlBtn) {
        const input = document.querySelector(`.setting-highlight-color[data-id="${rhlBtn.dataset.id}"]`);
        if (input) { input.value = randomColor(); input.dispatchEvent(new Event('change', { bubbles: true })); }
        return;
    }

    const rpcBtn = e.target.closest('.random-pie-colors-btn');
    if (rpcBtn) {
        const did = rpcBtn.dataset.id;
        const dataObj = window.appData[did];
        if (dataObj) {
            dataObj.pieColors = dataObj.pieColors.map(() => randomColor());
            window.renderedTabs[did].pie = false;
            drawPieChart(did);
        }
        return;
    }

    const rbcBtn = e.target.closest('.random-bar-colors-btn');
    if (rbcBtn) {
        const did = rbcBtn.dataset.id;
        const dataObj = window.appData[did];
        if (dataObj) {
            dataObj.barColors = dataObj.barColors.map(() => randomColor());
            drawChart(did);
        }
        return;
    }

    const rLegBtn = e.target.closest('.random-legend-color-btn');
    if (rLegBtn) {
        const input = document.querySelector(`.legend-color[data-file="${rLegBtn.dataset.file}"]`);
        if (input) input.value = randomColor();
        return;
    }

    const mergeBtn = e.target.closest('.btn-merge-answer');
    if (mergeBtn) {
        const id = mergeBtn.dataset.id;
        const srcIdx = parseInt(mergeBtn.dataset.index);
        const dataObj = window.appData[id];
        window._mergeState = { id, srcIdx };
        document.getElementById('mergeSourceLabel').textContent = dataObj.data[srcIdx].answer;
        const sel = document.getElementById('mergeTargetSelect');
        if ($(sel).hasClass('select2-hidden-accessible')) $(sel).select2('destroy');
        $(sel).empty();
        dataObj.data.forEach((r, i) => {
            if (i === srcIdx) return;
            $(sel).append(new Option(r.answer, i, false, false));
        });
        $(sel).select2({ theme: 'bootstrap-5', width: '100%', language: 'ru', dropdownParent: $('#mergeAnswerModal') });
        new bootstrap.Modal(document.getElementById('mergeAnswerModal')).show();
        return;
    }

    const hideColBtn = e.target.closest('.full-item-hide-col-btn');
    if (hideColBtn) { openHideColModal(hideColBtn.dataset.id); return; }

    const editBtn = e.target.closest('.full-item-edit-btn');
    if (editBtn) { openChartEditModal(editBtn.dataset.id); return; }

    const fuzzyBtn = e.target.closest('.full-item-fuzzy-btn');
    if (fuzzyBtn) { confirmFuzzyMapping(fuzzyBtn.dataset.id); return; }

    const simpleFuzzyBtn = e.target.closest('.simple-item-fuzzy-btn');
    if (simpleFuzzyBtn) { confirmFuzzyMapping(simpleFuzzyBtn.dataset.id); return; }

    const skipBtn = e.target.closest('.full-item-skip-analytics-btn');
    if (skipBtn) {
        const wrapper = skipBtn.closest('.full-item-wrapper');
        if (!wrapper) return;
        const collapseBtn = wrapper.querySelector('.full-item-collapse-btn');
        const id = collapseBtn?.dataset?.id;
        if (!id || !window.appData[id]) return;
        const nowSkipped = !window.appData[id].options.skipAnalytics;
        window.appData[id].options.skipAnalytics = nowSkipped;
        skipBtn.classList.toggle('btn-outline-secondary', !nowSkipped);
        skipBtn.classList.toggle('btn-danger', nowSkipped);
        skipBtn.title = nowSkipped
            ? 'Аналитика отключена — нажмите чтобы включить'
            : 'Не генерировать аналитику для этого вопроса';
        return;
    }

    const simpleSkipBtn = e.target.closest('.simple-item-skip-analytics-btn');
    if (simpleSkipBtn) {
        const body = simpleSkipBtn.closest('.simple-item-body');
        if (!body) return;
        const table = body.querySelector('table[id]');
        const id = table?.id;
        if (!id || !window.appData[id]) return;
        const nowSkipped = !window.appData[id].options.skipAnalytics;
        window.appData[id].options.skipAnalytics = nowSkipped;
        simpleSkipBtn.classList.toggle('btn-outline-secondary', !nowSkipped);
        simpleSkipBtn.classList.toggle('btn-danger', nowSkipped);
        simpleSkipBtn.title = nowSkipped
            ? 'Аналитика отключена — нажмите чтобы включить'
            : 'Не генерировать аналитику для этого вопроса';
        return;
    }

    const btn = e.target.closest('.viz-tab-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    const tab = btn.dataset.tab;

    if (tab !== 'table' && tab !== 'both') {
        if (window.appData[id]) {
            window.appData[id]._lastChartTab = tab;
        }
    }

    document.querySelectorAll(`#tabs_${id} .viz-tab-btn`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    ['table', 'bar', 'stacked', 'pie', 'both'].forEach(t => {
        const pane = document.getElementById(`pane_${t}_${id}`);
        if (pane) pane.classList.toggle('d-none', t !== tab);
    });

    const settingsEl = document.getElementById(`settings_${id}`);
    if (settingsEl) {
        settingsEl.querySelectorAll('[data-vis-tabs]').forEach(el => {
            const tabs = el.dataset.visTabs.split(' ');
            el.classList.toggle('d-none', !tabs.includes(tab));
        });
        const dimGroup = settingsEl.querySelector('.setting-dim-others-group');
        if (dimGroup) {
            const hlOn = window.appData[id]?.options?.highlightTop;
            dimGroup.classList.toggle('d-none', tab !== 'bar' || !hlOn);
        }
    }


    if (tab === 'table') {
        renderTable(id);
    }
    if (tab === 'bar') {
        window.renderedTabs[id].bar = true;
        setTimeout(() => drawChart(id), 50);
    }
    if (tab === 'stacked') {
        window.renderedTabs[id].stacked = true;
        setTimeout(() => drawStackedChart(id), 50);
    }
    if (tab === 'pie') {
        window.renderedTabs[id].pie = true;
        setTimeout(() => drawPieChart(id), 50);
    }
    if (tab === 'both') {
        window.renderedTabs[id].both = true;
        const dataObj = window.appData[id];
        if (dataObj) {
            const bothTableId = `both_table_${id}`;
            window.appData[bothTableId] = dataObj;
            const lastTab = dataObj._lastChartTab || 'bar';
            setTimeout(() => {
                renderTable(bothTableId);
                drawChartForBoth(id, lastTab);
            }, 50);
        }
    }

    if (window._recomputeCaptions) window._recomputeCaptions();
});

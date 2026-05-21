// ===================== chart.js =====================
// ===================== CHART.JS INIT =====================
Chart.register(ChartDataLabels);
Chart.defaults.font.family = '"Times New Roman", Times, serif';
Chart.defaults.font.size = 12;
const _chartThemeColor = () => document.documentElement.getAttribute('data-bs-theme') === 'dark' ? '#dee2e6' : '#212529';
Chart.defaults.color = _chartThemeColor();
window.updateChartDefaults = () => {
    Chart.defaults.color = _chartThemeColor();
    Object.entries(window.charts || {}).forEach(([key, ch]) => {
        if (!ch || typeof ch.update !== 'function') return;
        // Bar charts: data labels appear outside bars against background → must follow theme color
        // Stacked/pie: data labels on colored segments → keep '#fff'
        if (!key.startsWith('stacked_') && !key.startsWith('pie_')) {
            if (ch.options.plugins?.datalabels) {
                ch.options.plugins.datalabels.color = _chartThemeColor();
            }
        }
        ch.update('none');
    });
};

const PIE_COLORS = [
    '#dc3545','#0d6efd','#198754','#ffc107','#6f42c1',
    '#fd7e14','#20c997','#0dcaf0','#6c757d','#343a40',
    '#e15759','#4e79a7','#59a14f','#edc948','#b07aa1',
    '#003f5c','#2f4b7c','#665191','#a05195','#d45087',
    '#f95d6a','#ff7c43','#ffa600','#b5bd00','#00b050'
];

// ===================== CHART EDIT MODAL =====================
function renderChartEditModal(id) {
    const dataObj = window.appData[id];
    const body = document.getElementById('chartEditModalBody');

    const activeRows = dataObj.data.filter(r => r.included);
    const totals = {};
    dataObj.file_keys.forEach(fk => {
        totals[fk] = activeRows.reduce((sum, r) => sum + (r.counts[fk] || 0), 0);
    });

    body.innerHTML = '';
    const multiFile = dataObj.file_keys.length > 1;

    const table = document.createElement('table');
    table.className = 'table table-bordered table-hover table-custom-border align-middle mb-0';

    // thead
    const thead = table.createTHead();
    const hRow1 = thead.insertRow();
    const thCtrl = document.createElement('th');
    thCtrl.className = 'control-col';
    hRow1.appendChild(thCtrl);
    const thAnswer = document.createElement('th');
    thAnswer.className = 'text-start';
    thAnswer.textContent = 'Ответ';
    hRow1.appendChild(thAnswer);

    if (multiFile) {
        dataObj.file_keys.forEach(fk => {
            const th = document.createElement('th');
            th.className = 'text-center';
            th.colSpan = 2;
            th.textContent = dataObj.file_labels[fk];
            hRow1.appendChild(th);
        });
        const hRow2 = thead.insertRow();
        dataObj.file_keys.forEach(() => {
            const thC = document.createElement('th');
            thC.className = 'text-center';
            thC.textContent = 'Кол-во';
            hRow2.appendChild(thC);
            const thP = document.createElement('th');
            thP.className = 'text-center';
            thP.textContent = '%';
            hRow2.appendChild(thP);
        });
    } else {
        const thC = document.createElement('th');
        thC.className = 'text-center';
        thC.textContent = 'Кол-во';
        hRow1.appendChild(thC);
        const thP = document.createElement('th');
        thP.className = 'text-center';
        thP.textContent = '%';
        hRow1.appendChild(thP);
    }

    // tbody
    const tbody = table.createTBody();
    dataObj.data.forEach((row, idx) => {
        const tr = _tpl('tpl-chart-edit-row');
        tr.className = row.included ? '' : 'row-excluded';

        const toggle = tr.querySelector('.modal-row-toggle');
        toggle.checked = row.included;
        toggle.dataset.id = id;
        toggle.dataset.index = idx;

        const answerSpan = tr.querySelector('.modal-answer-text');
        answerSpan.textContent = row.answer;
        answerSpan.dataset.id = id;
        answerSpan.dataset.index = idx;

        dataObj.file_keys.forEach(fk => {
            const c = row.counts[fk] || 0;
            const tot = totals[fk];
            let pct = '0';
            if (row.included && tot > 0 && c > 0) {
                const rawPct = (c / tot) * 100;
                pct = (rawPct > 0 && rawPct < 1) ? '<1' : Math.round(rawPct).toString();
            }
            const tdC = document.createElement('td');
            tdC.className = 'text-center align-middle';
            const countSpan = document.createElement('span');
            countSpan.contentEditable = 'true';
            countSpan.className = 'editable-cell modal-answer-count';
            countSpan.dataset.id = id;
            countSpan.dataset.index = idx;
            countSpan.dataset.file = fk;
            countSpan.textContent = c;
            tdC.appendChild(countSpan);
            tr.appendChild(tdC);
            const tdP = document.createElement('td');
            tdP.className = 'text-center align-middle';
            tdP.textContent = pct;
            tr.appendChild(tdP);
        });

        tbody.appendChild(tr);
    });

    body.appendChild(table);
}

window.openChartEditModal = function(id) {
    window._chartEditId = id;
    document.getElementById('chartEditModalLabel').textContent = `Редактирование: «${window.appData[id].question_name}»`;
    renderChartEditModal(id);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('chartEditModal'), { backdrop: false, keyboard: true }).show();
};

(function () {
    const modalEl = document.getElementById('chartEditModal');
    const dialog = modalEl.querySelector('.modal-dialog');
    const header = modalEl.querySelector('.modal-header');

    modalEl.addEventListener('shown.bs.modal', () => {
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    });

    document.addEventListener('mousedown', (e) => {
        if (!modalEl.classList.contains('show')) return;
        if (!dialog.contains(e.target)) {
            bootstrap.Modal.getInstance(modalEl)?.hide();
        }
    });

    header.style.cursor = 'grab';
    let dragging = false, ox = 0, oy = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true;
        header.style.cursor = 'grabbing';
        const rect = dialog.getBoundingClientRect();
        dialog.style.width = rect.width + 'px';
        dialog.style.position = 'fixed';
        dialog.style.margin = '0';
        dialog.style.left = rect.left + 'px';
        dialog.style.top = rect.top + 'px';
        ox = e.clientX - rect.left;
        oy = e.clientY - rect.top;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        dialog.style.left = (e.clientX - ox) + 'px';
        dialog.style.top = (e.clientY - oy) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (dragging) { dragging = false; header.style.cursor = 'grab'; }
    });
}());

// ===================== HIDE COLUMNS MODAL =====================
let currentHideColTableId = null;
window.openHideColModal = function(id) {
    currentHideColTableId = id;
    const opt = window.appData[id].options.hiddenCol || 'none';
    document.getElementById('hideColNone').checked = (opt === 'none');
    document.getElementById('hideColCount').checked = (opt === 'count');
    document.getElementById('hideColPct').checked = (opt === 'percent');
    new bootstrap.Modal(document.getElementById('hideColModal')).show();
};

document.getElementById('applyMergeBtn').addEventListener('click', () => {
    if (!window._mergeState) return;
    const { id, srcIdx } = window._mergeState;
    const targetIdx = parseInt($('#mergeTargetSelect').val());
    if (isNaN(targetIdx)) return;
    const dataObj = window.appData[id];
    const srcRow = dataObj.data[srcIdx];
    const tgtRow = dataObj.data[targetIdx];

    dataObj.file_keys.forEach(fk => {
        tgtRow.counts[fk] = (tgtRow.counts[fk] || 0) + (srcRow.counts[fk] || 0);
    });
    tgtRow._total = Object.values(tgtRow.counts).reduce((a, b) => a + b, 0);

    dataObj.data.splice(srcIdx, 1);
    if (Array.isArray(dataObj.pieColors) && dataObj.pieColors.length > dataObj.data.length) dataObj.pieColors.splice(srcIdx, 1);
    if (Array.isArray(dataObj.barColors) && dataObj.barColors.length > dataObj.data.length) dataObj.barColors.splice(srcIdx, 1);

    window._mergeState = null;
    bootstrap.Modal.getInstance(document.getElementById('mergeAnswerModal')).hide();
    renderTable(id);
    drawChart(id);
    drawStackedChart(id);
    drawPieChart(id);
});

document.getElementById('saveHideColBtn').addEventListener('click', () => {
    let opt = 'none';
    if (document.getElementById('hideColCount').checked) opt = 'count';
    if (document.getElementById('hideColPct').checked) opt = 'percent';

    window.appData[currentHideColTableId].options.hiddenCol = opt;
    applyHiddenColumns(currentHideColTableId);

    bootstrap.Modal.getInstance(document.getElementById('hideColModal')).hide();
});

window.applyHiddenColumns = function(id) {
    const table = document.getElementById(id);
    if (!table) return;
    const opt = window.appData[id].options.hiddenCol || 'none';
    const isVert = window.appData[id].options.tableVertical;

    table.querySelectorAll(`.count-col-${id}`).forEach(el => el.classList.toggle('d-none', opt === 'count'));
    table.querySelectorAll(`.pct-col-${id}`).forEach(el => el.classList.toggle('d-none', opt === 'percent'));

    const fileHeaders = table.querySelectorAll(`.file-header-${id}`);
    const colspanVal = opt === 'none' ? '2' : '1';
    fileHeaders.forEach(el => el.setAttribute('colspan', colspanVal));

    if (!isVert) {
        const row1Ths = table.querySelectorAll(`.main-th-${id}`);
        const row2 = document.getElementById(`thead_row2_${id}`);
        if (opt === 'none') {
            if(row2) row2.classList.remove('d-none');
            row1Ths.forEach(el => el.setAttribute('rowspan', '2'));
        } else {
            if(row2) row2.classList.add('d-none');
            row1Ths.forEach(el => el.setAttribute('rowspan', '1'));
        }
    }
};

// ===================== PIE CHART =====================
function drawPieChart(id) {
    const dataObj = window.appData[id];
    if (!dataObj || !window.pieChartsData[id]) return;

    const MAX_PIE = 25;
    const activeData = dataObj.data.filter(r => r.included);
    const labels = activeData.map(r => r.answer.length > 40 ? r.answer.substring(0, 40) + '…' : r.answer);

    while (dataObj.pieColors.length < activeData.length) {
        dataObj.pieColors.push(PIE_COLORS[dataObj.pieColors.length % PIE_COLORS.length]);
    }

    const editor = document.getElementById(`pie_color_editor_${id}`);
    if (editor) {
        editor.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'd-flex flex-wrap gap-1 align-items-center ui-system-font mb-2';
        const lbl = document.createElement('small');
        lbl.className = 'fw-medium me-1';
        lbl.textContent = 'Цвета секторов:';
        wrap.appendChild(lbl);
        activeData.forEach((row, i) => {
            const inp = document.createElement('input');
            inp.type = 'color';
            inp.className = 'form-control form-control-color pie-answer-color';
            inp.dataset.id = id;
            inp.dataset.index = i;
            inp.value = dataObj.pieColors[i] || PIE_COLORS[i % PIE_COLORS.length];
            inp.style.cssText = 'width:26px;height:22px;padding:1px 2px;cursor:pointer;';
            inp.title = row.answer;
            wrap.appendChild(inp);
        });
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-outline-secondary random-pie-colors-btn';
        btn.dataset.id = id;
        btn.title = 'Случайные цвета';
        btn.innerHTML = '<i class="fa-solid fa-dice-five"></i>';
        wrap.appendChild(btn);
        editor.appendChild(wrap);
    }

    dataObj.file_keys.forEach((fileKey, fi) => {
        const chartKey = `pie_${id}_${fi}`;
        if (window.charts[chartKey]) window.charts[chartKey].destroy();

        const canvas = document.getElementById(`pie_canvas_${id}_${fi}`);
        if (!canvas) return;
        const msgEl = document.getElementById(`pie_msg_${id}_${fi}`);

        const counts = activeData.map(r => r.counts[fileKey] || 0);
        const total = counts.reduce((a, b) => a + b, 0);
        const nonZero = counts.filter(v => v > 0).length;

        if (activeData.length === 0 || nonZero > MAX_PIE) {
            canvas.style.display = 'none';
            if (msgEl) { msgEl.textContent = activeData.length === 0 ? 'Нет активных вариантов' : `Слишком много вариантов (${nonZero}) для круговой диаграммы`; msgEl.classList.remove('d-none'); }
            return;
        }
        canvas.style.display = '';
        if (msgEl) msgEl.classList.add('d-none');
        canvas.width = 380;
        canvas.height = 380;

        const colors = activeData.map((_, i) => dataObj.pieColors[i] || PIE_COLORS[i % PIE_COLORS.length]);
        const ctx = canvas.getContext('2d');
        window.charts[chartKey] = new Chart(ctx, {
            type: 'pie',
            data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 1 }] },
            options: {
                responsive: false,
                plugins: {
                    legend: { display: dataObj.options.showLegend !== false, position: 'bottom', labels: { font: { family: '"Times New Roman", Times, serif', size: 11 } } },
                    tooltip: {
                        enabled: true,
                        displayColors: false,
                        callbacks: {
                            title: (items) => activeData[items[0].dataIndex]?.answer || '',
                            label: (ctx) => ctx.raw
                        }
                    },
                    datalabels: {
                        color: '#fff',
                        font: { family: '"Times New Roman", Times, serif', size: 13, weight: 'bold' },
                        formatter: (value) => {
                            if (total === 0 || value === 0) return '';
                            const pct = (value / total) * 100;
                            return pct < 1 ? '<1%' : Math.round(pct) + '%';
                        }
                    }
                }
            }
        });
    });
}

// ===================== BAR CHART =====================
function drawChart(id) {
    const dataObj = window.appData[id];
    if (!dataObj || !window.chartsData[id]) return;

    if (window.charts[id]) window.charts[id].destroy();

    const activeData = dataObj.data.filter(r => r.included).sort((a, b) => b._total - a._total);
    const canvasBar = document.getElementById(`canvas_${id}`);
    if (activeData.length === 0) {
        if (canvasBar) {
            canvasBar.style.display = 'none';
            const wrap = canvasBar.closest('.chart-container');
            if (wrap && !wrap.querySelector('.no-data-msg')) wrap.insertAdjacentHTML('beforeend', '<p class="no-data-msg text-muted text-center py-4 small mb-0">Нет данных для отображения</p>');
        }
        return;
    }
    if (canvasBar) {
        canvasBar.style.display = '';
        canvasBar.closest('.chart-container')?.querySelector('.no-data-msg')?.remove();
    }

    const labels = activeData.map(r => r.answer.length > 50 ? r.answer.substring(0, 50) + '...' : r.answer);
    const isHorizontal = dataObj.options.chartDirection === 'y';
    const topN = dataObj.options.highlightTop ? Math.min(dataObj.options.topN, activeData.length * dataObj.file_keys.length) : 0;
    const HIGHLIGHT_COLOR = dataObj.options.highlightColor || '#0d6efd';

    const fileTotals = {};
    dataObj.file_keys.forEach(fk => {
        fileTotals[fk] = activeData.reduce((sum, r) => sum + (r.counts[fk] || 0), 0);
    });

    const allBars = [];
    activeData.forEach(r => {
        dataObj.file_keys.forEach(fk => {
            const c = r.counts[fk] || 0;
            const ft = fileTotals[fk];
            allBars.push({ answer: r.answer, fileKey: fk, pct: ft > 0 ? c / ft * 100 : 0 });
        });
    });
    allBars.sort((a, b) => b.pct - a.pct);
    const topBarSet = new Set(allBars.slice(0, topN).map(b => `${b.answer}__${b.fileKey}`));

    const isSingleFile = dataObj.file_keys.length === 1;

    if (isSingleFile) {
        while (dataObj.barColors.length < activeData.length) {
            dataObj.barColors.push(PIE_COLORS[dataObj.barColors.length % PIE_COLORS.length]);
        }
        const editor = document.getElementById(`bar_color_editor_${id}`);
        if (editor) {
            editor.innerHTML = '';
            const wrap = document.createElement('div');
            wrap.className = 'd-flex flex-wrap gap-1 align-items-center ui-system-font mb-2';
            const lbl = document.createElement('small');
            lbl.className = 'fw-medium me-1';
            lbl.textContent = 'Цвета столбиков:';
            wrap.appendChild(lbl);
            activeData.forEach((row, i) => {
                const inp = document.createElement('input');
                inp.type = 'color';
                inp.className = 'form-control form-control-color bar-answer-color';
                inp.dataset.id = id;
                inp.dataset.index = i;
                inp.value = dataObj.barColors[i] || PIE_COLORS[i % PIE_COLORS.length];
                inp.style.cssText = 'width:26px;height:22px;padding:1px 2px;cursor:pointer;';
                inp.title = row.answer;
                wrap.appendChild(inp);
            });
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-outline-secondary random-bar-colors-btn';
            btn.dataset.id = id;
            btn.title = 'Случайные цвета';
            btn.innerHTML = '<i class="fa-solid fa-dice-five"></i>';
            wrap.appendChild(btn);
            editor.appendChild(wrap);
        }
    } else {
        const editor = document.getElementById(`bar_color_editor_${id}`);
        if (editor) editor.innerHTML = '';
    }

    const datasets = dataObj.file_keys.map(fileKey => {
        const ft = fileTotals[fileKey];
        const rawCounts = activeData.map(r => r.counts[fileKey] || 0);
        return {
            label: dataObj.file_labels[fileKey],
            backgroundColor: activeData.map((r, barIdx) => {
                if (topN > 0 && topBarSet.has(`${r.answer}__${fileKey}`)) return HIGHLIGHT_COLOR;
                return isSingleFile ? (dataObj.barColors[barIdx] || PIE_COLORS[barIdx % PIE_COLORS.length]) : dataObj.file_colors[fileKey];
            }),
            data: rawCounts.map(c => ft > 0 ? (c / ft) * 100 : 0),
            rawCounts,
            barPercentage: 0.8
        };
    });

    const ctx = document.getElementById(`canvas_${id}`).getContext('2d');
    ctx.canvas.height = isHorizontal ? Math.max(200, labels.length * 36 + (datasets.length > 1 ? 40 : 0)) : 400;

    window.charts[id] = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
            indexAxis: dataObj.options.chartDirection,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: !!dataObj.options.showLegend,
                    position: 'bottom',
                    labels: {
                        font: { family: '"Times New Roman", Times, serif', size: 12 },
                        generateLabels: (chart) => dataObj.file_keys.map((fk, i) => {
                            const ds = chart.data.datasets[i];
                            return {
                                text: ds.label,
                                fillStyle: dataObj.file_colors[fk],
                                strokeStyle: dataObj.file_colors[fk],
                                lineWidth: 1,
                                hidden: !chart.isDatasetVisible(i),
                                datasetIndex: i
                            };
                        })
                    }
                },
                tooltip: {
                    enabled: true,
                    displayColors: datasets.length > 1,
                    callbacks: {
                        title: (items) => activeData[items[0].dataIndex]?.answer || '',
                        label: (ctx) => (datasets.length > 1 ? ctx.dataset.label + ': ' : '') + ctx.dataset.rawCounts[ctx.dataIndex]
                    }
                },
                datalabels: {
                    color: _chartThemeColor(),
                    anchor: 'end',
                    align: isHorizontal ? 'right' : 'top',
                    offset: 4,
                    font: { family: '"Times New Roman", Times, serif', size: 14, weight: 'bold' },
                    formatter: (value) => {
                        if (!value || value === 0) return '';
                        if (value > 0 && value < 1) return '<1%';
                        return Math.round(value) + '%';
                    }
                }
            },
            scales: {
                x: { display: !isHorizontal, min: isHorizontal ? 0 : undefined, grid: { display: false }, border: { display: false } },
                y: { display: isHorizontal, min: !isHorizontal ? 0 : undefined, grid: { display: false }, border: { display: false } }
            },
            layout: { padding: isHorizontal ? { right: 50 } : { top: 30 } }
        }
    });
}

function drawChartOnCanvas(sourceId, canvasId, colorEditorId) {
    const dataObj = window.appData[sourceId];
    if (!dataObj) return;

    const chartKey = `both_${sourceId}`;
    if (window.charts[chartKey]) window.charts[chartKey].destroy();

    const activeData = dataObj.data.filter(r => r.included).sort((a, b) => b._total - a._total);
    const canvas = document.getElementById(canvasId);
    if (!canvas || activeData.length === 0) return;

    const labels = activeData.map(r => r.answer.length > 50 ? r.answer.substring(0, 50) + '...' : r.answer);
    const isHorizontal = dataObj.options.chartDirection === 'y';

    const fileTotals = {};
    dataObj.file_keys.forEach(fk => {
        fileTotals[fk] = activeData.reduce((sum, r) => sum + (r.counts[fk] || 0), 0);
    });

    const isSingleFile = dataObj.file_keys.length === 1;
    const datasets = dataObj.file_keys.map(fileKey => {
        const ft = fileTotals[fileKey];
        const rawCounts = activeData.map(r => r.counts[fileKey] || 0);
        return {
            label: dataObj.file_labels[fileKey],
            backgroundColor: activeData.map((r, barIdx) =>
                isSingleFile ? (dataObj.barColors[barIdx] || PIE_COLORS[barIdx % PIE_COLORS.length]) : dataObj.file_colors[fileKey]
            ),
            data: rawCounts.map(c => ft > 0 ? (c / ft) * 100 : 0),
            rawCounts,
            barPercentage: 0.8
        };
    });

    const ctx = canvas.getContext('2d');
    ctx.canvas.height = isHorizontal ? Math.max(200, labels.length * 36) : 400;

    window.charts[chartKey] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            indexAxis: dataObj.options.chartDirection,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: !!dataObj.options.showLegend, position: 'bottom' },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        title: (items) => activeData[items[0].dataIndex]?.answer || '',
                        label: (ctx) => ctx.dataset.rawCounts[ctx.dataIndex]
                    }
                },
                datalabels: {
                    color: _chartThemeColor(),
                    anchor: 'end',
                    align: isHorizontal ? 'right' : 'top',
                    offset: 4,
                    font: { family: '"Times New Roman", Times, serif', size: 14, weight: 'bold' },
                    formatter: (value) => {
                        if (!value || value === 0) return '';
                        if (value > 0 && value < 1) return '<1%';
                        return Math.round(value) + '%';
                    }
                }
            },
            scales: {
                x: { display: !isHorizontal, grid: { display: false }, border: { display: false } },
                y: { display: isHorizontal, grid: { display: false }, border: { display: false } }
            },
            layout: { padding: isHorizontal ? { right: 50 } : { top: 30 } }
        }
    });
}


function drawChartForBoth(sourceId, chartType) {
    const dataObj = window.appData[sourceId];
    if (!dataObj) return;

    const chartKey = `both_${sourceId}`;
    if (window.charts[chartKey]) window.charts[chartKey].destroy();

    const activeData = dataObj.data.filter(r => r.included).sort((a, b) => b._total - a._total);
    const canvas = document.getElementById(`both_canvas_${sourceId}`);
    if (!canvas || activeData.length === 0) return;

    const fileTotals = {};
    dataObj.file_keys.forEach(fk => {
        fileTotals[fk] = activeData.reduce((sum, r) => sum + (r.counts[fk] || 0), 0);
    });

    const labels = activeData.map(r =>
        r.answer.length > 50 ? r.answer.substring(0, 50) + '...' : r.answer
    );
    const isSingleFile = dataObj.file_keys.length === 1;

    // ── Круговая ──────────────────────────────────────────────────────
    if (chartType === 'pie') {
        const fk = dataObj.file_keys[0];
        const counts = activeData.map(r => r.counts[fk] || 0);
        const total = counts.reduce((a, b) => a + b, 0);
        const colors = activeData.map((_, i) =>
            dataObj.pieColors[i] || PIE_COLORS[i % PIE_COLORS.length]
        );
        canvas.width = 380;
        canvas.height = 380;
        const ctx = canvas.getContext('2d');
        window.charts[chartKey] = new Chart(ctx, {
            type: 'pie',
            data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderWidth: 1 }] },
            options: {
                responsive: false,
                plugins: {
                    legend: {
                        display: dataObj.options.showLegend !== false,
                        position: 'bottom',
                        labels: { font: { family: '"Times New Roman", Times, serif', size: 11 } }
                    },
                    tooltip: {
                        enabled: true,
                        displayColors: false,
                        callbacks: {
                            title: (items) => activeData[items[0].dataIndex]?.answer || '',
                            label: (ctx) => ctx.raw
                        }
                    },
                    datalabels: {
                        color: '#fff',
                        font: { family: '"Times New Roman", Times, serif', size: 13, weight: 'bold' },
                        formatter: (value) => {
                            if (total === 0 || value === 0) return '';
                            const pct = (value / total) * 100;
                            return pct < 1 ? '<1%' : Math.round(pct) + '%';
                        }
                    }
                }
            }
        });
        return;
    }

    // ── Накопленная ───────────────────────────────────────────────────
    if (chartType === 'stacked') {
        const isVertStacked = dataObj.options.chartDirection === 'x';
        const datasets = dataObj.file_keys.map(fileKey => {
            const ft = fileTotals[fileKey];
            const actualPcts = activeData.map(r => {
                const count = r.counts[fileKey] || 0;
                return ft > 0 ? (count / ft) * 100 : 0;
            });
            const actualCounts = activeData.map(r => r.counts[fileKey] || 0);
            return {
                label: dataObj.file_labels[fileKey],
                backgroundColor: dataObj.file_colors[fileKey],
                actualPcts,
                actualCounts,
                data: activeData.map((r, rIdx) => {
                    const pct = actualPcts[rIdx];
                    const answerSum = dataObj.file_keys.reduce((sum, fk) => {
                        const c = r.counts[fk] || 0;
                        const ftt = fileTotals[fk];
                        return sum + (ftt > 0 ? (c / ftt) * 100 : 0);
                    }, 0);
                    return answerSum > 0 ? (pct / answerSum) * 100 : 0;
                }),
                barPercentage: 0.7
            };
        });
        const ctx = canvas.getContext('2d');
        ctx.canvas.height = isVertStacked ? 400 : Math.max(150, labels.length * 25);
        window.charts[chartKey] = new Chart(ctx, {
            type: 'bar',
            data: { labels, datasets },
            options: {
                indexAxis: isVertStacked ? 'x' : 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: !!dataObj.options.showLegend,
                        position: 'bottom',
                        labels: { font: { family: '"Times New Roman", Times, serif', size: 12 } }
                    },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            title: (items) => activeData[items[0].dataIndex]?.answer || '',
                            label: (ctx) => ctx.dataset.actualCounts[ctx.dataIndex]
                        }
                    },
                    datalabels: {
                        color: '#fff',
                        anchor: 'center',
                        align: 'center',
                        font: { family: '"Times New Roman", Times, serif', size: 13, weight: 'bold' },
                        formatter: (value, context) => {
                            const pct = context.dataset.actualPcts?.[context.dataIndex];
                            if (!pct || pct === 0) return '';
                            const rounded = Math.round(pct);
                            return rounded < 1 ? '<1%' : rounded + '%';
                        }
                    }
                },
                scales: isVertStacked ? {
                    x: { stacked: true, grid: { display: false }, border: { display: false } },
                    y: { stacked: true, display: false, max: 100, grid: { display: false }, border: { display: false } }
                } : {
                    x: { stacked: true, display: false, max: 100, grid: { display: false }, border: { display: false } },
                    y: { stacked: true, grid: { display: false }, border: { display: false } }
                }
            }
        });
        return;
    }

    // ── Столбчатая (bar — по умолчанию) ──────────────────────────────
    const isHorizontal = dataObj.options.chartDirection === 'y';
    const datasets = dataObj.file_keys.map(fileKey => {
        const ft = fileTotals[fileKey];
        const rawCounts = activeData.map(r => r.counts[fileKey] || 0);
        return {
            label: dataObj.file_labels[fileKey],
            backgroundColor: activeData.map((r, barIdx) =>
                isSingleFile
                    ? (dataObj.barColors[barIdx] || PIE_COLORS[barIdx % PIE_COLORS.length])
                    : dataObj.file_colors[fileKey]
            ),
            data: rawCounts.map(c => ft > 0 ? (c / ft) * 100 : 0),
            rawCounts,
            barPercentage: 0.8
        };
    });

    const ctx = canvas.getContext('2d');
    ctx.canvas.height = isHorizontal
        ? Math.max(200, labels.length * 36 + (datasets.length > 1 ? 40 : 0))
        : 400;

    window.charts[chartKey] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            indexAxis: dataObj.options.chartDirection,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: !!dataObj.options.showLegend,
                    position: 'bottom',
                    labels: { font: { family: '"Times New Roman", Times, serif', size: 12 } }
                },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        title: (items) => activeData[items[0].dataIndex]?.answer || '',
                        label: (ctx) => ctx.dataset.rawCounts?.[ctx.dataIndex]
                    }
                },
                datalabels: {
                    color: _chartThemeColor(),
                    anchor: 'end',
                    align: isHorizontal ? 'right' : 'top',
                    offset: 4,
                    font: { family: '"Times New Roman", Times, serif', size: 14, weight: 'bold' },
                    formatter: (value) => {
                        if (!value || value === 0) return '';
                        if (value > 0 && value < 1) return '<1%';
                        return Math.round(value) + '%';
                    }
                }
            },
            scales: {
                x: { display: !isHorizontal, grid: { display: false }, border: { display: false } },
                y: { display: isHorizontal, grid: { display: false }, border: { display: false } }
            },
            layout: { padding: isHorizontal ? { right: 50 } : { top: 30 } }
        }
    });
}

// ===================== STACKED BAR CHART =====================
function drawStackedChart(id) {
    const dataObj = window.appData[id];
    if (!dataObj || !window.stackedChartsData[id]) return;

    if (window.charts['stacked_' + id]) window.charts['stacked_' + id].destroy();

    const activeData = dataObj.data.filter(r => r.included).sort((a, b) => b._total - a._total);
    const canvasStacked = document.getElementById(`stacked_canvas_${id}`);
    if (activeData.length === 0) {
        if (canvasStacked) {
            canvasStacked.style.display = 'none';
            const wrap = canvasStacked.closest('.stacked-container');
            if (wrap && !wrap.querySelector('.no-data-msg')) wrap.insertAdjacentHTML('beforeend', '<p class="no-data-msg text-muted text-center py-4 small mb-0">Нет данных для отображения</p>');
        }
        return;
    }
    if (canvasStacked) {
        canvasStacked.style.display = '';
        canvasStacked.closest('.stacked-container')?.querySelector('.no-data-msg')?.remove();
    }

    const fileTotals = {};
    dataObj.file_keys.forEach(fk => {
        fileTotals[fk] = activeData.reduce((sum, r) => sum + (r.counts[fk] || 0), 0);
    });

    const labels = activeData.map(r => r.answer.length > 50 ? r.answer.substring(0, 50) + '...' : r.answer);

    const datasets = dataObj.file_keys.map(fileKey => {
        const actualPcts = activeData.map(r => {
            const count = r.counts[fileKey] || 0;
            const ft = fileTotals[fileKey];
            return ft > 0 ? (count / ft) * 100 : 0;
        });
        const actualCounts = activeData.map(r => r.counts[fileKey] || 0);
        return {
            label: dataObj.file_labels[fileKey],
            backgroundColor: dataObj.file_colors[fileKey],
            actualPcts,
            actualCounts,
            data: activeData.map((r, rIdx) => {
                const pct = actualPcts[rIdx];
                const answerSum = dataObj.file_keys.reduce((sum, fk) => {
                    const c = r.counts[fk] || 0;
                    const ft = fileTotals[fk];
                    return sum + (ft > 0 ? (c / ft) * 100 : 0);
                }, 0);
                return answerSum > 0 ? (pct / answerSum) * 100 : 0;
            }),
            barPercentage: 0.7
        };
    });

    const isVertStacked = dataObj.options.chartDirection === 'x';
    const ctx = document.getElementById(`stacked_canvas_${id}`).getContext('2d');
    ctx.canvas.height = isVertStacked ? 400 : Math.max(150, labels.length * 25);

    window.charts['stacked_' + id] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            indexAxis: isVertStacked ? 'x' : 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: !!dataObj.options.showLegend,
                    position: 'bottom',
                    labels: { font: { family: '"Times New Roman", Times, serif', size: 12 } }
                },
                tooltip: {
                    enabled: true,
                    displayColors: datasets.length > 1,
                    callbacks: {
                        title: (items) => activeData[items[0].dataIndex]?.answer || '',
                        label: (ctx) => (datasets.length > 1 ? ctx.dataset.label + ': ' : '') + ctx.dataset.actualCounts[ctx.dataIndex]
                    }
                },
                datalabels: {
                    color: '#fff',
                    anchor: 'center',
                    align: 'center',
                    font: { family: '"Times New Roman", Times, serif', size: 13, weight: 'bold' },
                    formatter: (value, context) => {
                        const pct = context.dataset.actualPcts[context.dataIndex];
                        if (!pct || pct === 0) return '';
                        const rounded = Math.round(pct);
                        return rounded < 1 ? '<1%' : rounded + '%';
                    }
                }
            },
            scales: isVertStacked
                ? {
                    x: { stacked: true, grid: { display: false }, border: { display: false } },
                    y: { stacked: true, display: false, max: 100, grid: { display: false }, border: { display: false } }
                }
                : {
                    x: { stacked: true, display: false, max: 100, grid: { display: false }, border: { display: false } },
                    y: { stacked: true, grid: { display: false }, border: { display: false } }
                }
        }
    });
}

// ===================== TABLE RENDER =====================
function renderTable(tableId) {
    const dataObj = window.appData[tableId];
    const tableEl = document.getElementById(tableId);
    if (!tableEl) return;

    dataObj.data.sort((a, b) => {
        if (a.included && !b.included) return -1;
        if (!a.included && b.included) return 1;
        return b._total - a._total;
    });

    const isVert = dataObj.options.tableVertical;
    const activeRows = dataObj.data.filter(r => r.included);

    const totals = {};
    dataObj.file_keys.forEach(fk => {
        totals[fk] = activeRows.reduce((sum, r) => sum + (r.counts[fk] || 0), 0);
    });

    const topN = dataObj.options.highlightTop ? Math.min(dataObj.options.topN, activeRows.length) : 0;
    const highlightColor = dataObj.options.highlightColor || '#dc3545';
    let threshold = -1;

    if(dataObj.options.highlightTop && activeRows.length > 0) {
        const uniqueCounts = [...new Set(activeRows.map(r => r._total))].sort((a, b) => b - a);
        threshold = uniqueCounts[Math.min(topN, uniqueCounts.length) - 1];
    }

    // Вспомогательная функция: создать пару td (кол-во + %) для таблицы
    function _makeTdPair(cls, countVal, pctVal, extraClass, extraStyle) {
        const tdC = document.createElement('td');
        tdC.className = `text-center align-middle ${cls}${extraClass ? ' ' + extraClass : ''}`;
        if (extraStyle) tdC.style.cssText = extraStyle;
        tdC.textContent = countVal;
        const tdP = document.createElement('td');
        tdP.className = `text-center align-middle ${cls.replace('count', 'pct')}${extraClass ? ' ' + extraClass : ''}`;
        if (extraStyle) tdP.style.cssText = extraStyle;
        tdP.textContent = pctVal;
        return [tdC, tdP];
    }

    // Вспомогательная функция: создать редактируемый span-заголовок
    function _editableSpan(text, id_, header) {
        const span = document.createElement('span');
        span.contentEditable = 'true';
        span.className = 'editable-cell text-body';
        span.dataset.id = id_;
        span.dataset.header = header;
        span.textContent = text;
        return span;
    }

    if (isVert) {
        const isSingleFileVert = dataObj.file_keys.length === 1;
        const thead = tableEl.querySelector('thead');
        thead.innerHTML = '';
        const hRow1 = document.createElement('tr');
        hRow1.id = `thead_row1_${tableId}`;
        const hRow2 = document.createElement('tr');
        hRow2.id = `thead_row2_${tableId}`;

        if (!isSingleFileVert) {
            const thFile = document.createElement('th');
            thFile.className = `text-start align-middle main-th-${tableId}`;
            thFile.rowSpan = 2;
            thFile.style.width = '15%';
            thFile.appendChild(_editableSpan('Файл', tableId, 'h1'));
            hRow1.appendChild(thFile);
        }

        dataObj.data.forEach((row, origIdx) => {
            const isTop = row.included && topN > 0 && row._total >= threshold;
            const excluded = !row.included;
            const textClass = isTop ? 'text-danger' : (excluded ? 'text-muted' : '');
            const thStyle = excluded ? 'text-decoration:line-through;text-decoration-thickness:2px;text-decoration-color:#868e96;color:#6c757d;background-color:#e9ecef;' : '';

            const th = document.createElement('th');
            th.className = `text-center file-header-${tableId}${textClass ? ' ' + textClass : ''}${excluded ? ' col-excluded' : ''}`;
            th.colSpan = 2;
            if (thStyle) th.style.cssText = thStyle;

            const innerDiv = document.createElement('div');
            innerDiv.className = 'd-flex align-items-center justify-content-center gap-1';
            const toggleCont = document.createElement('div');
            toggleCont.className = 'row-toggle-container';
            const fc = document.createElement('div');
            fc.className = 'form-check form-switch mb-0';
            const tog = document.createElement('input');
            tog.type = 'checkbox';
            tog.className = 'form-check-input row-toggle ui-system-font';
            tog.checked = row.included;
            tog.dataset.id = tableId;
            tog.dataset.index = origIdx;
            tog.title = `${excluded ? 'Включить' : 'Исключить'} ответ`;
            fc.appendChild(tog);
            toggleCont.appendChild(fc);
            innerDiv.appendChild(toggleCont);
            const answerSpan = document.createElement('span');
            answerSpan.contentEditable = 'true';
            answerSpan.className = 'editable-cell answer-text';
            answerSpan.dataset.id = tableId;
            answerSpan.dataset.index = origIdx;
            answerSpan.textContent = row.answer;
            innerDiv.appendChild(answerSpan);
            th.appendChild(innerDiv);
            hRow1.appendChild(th);

            const thC = document.createElement('th');
            thC.className = `text-center count-col-${tableId}`;
            thC.appendChild(_editableSpan(dataObj.headers.h2 || 'Кол-во', tableId, 'h2'));
            hRow2.appendChild(thC);
            const thP = document.createElement('th');
            thP.className = `text-center pct-col-${tableId}`;
            thP.appendChild(_editableSpan(dataObj.headers.h3 || '%', tableId, 'h3'));
            hRow2.appendChild(thP);
        });

        if (dataObj.options.showTotal) {
            const thTot = document.createElement('th');
            thTot.className = `text-center file-header-${tableId}`;
            thTot.colSpan = 2;
            thTot.textContent = 'Всего';
            hRow1.appendChild(thTot);
            const thTC = document.createElement('th');
            thTC.className = `text-center count-col-${tableId}`;
            thTC.textContent = 'Кол-во';
            hRow2.appendChild(thTC);
            const thTP = document.createElement('th');
            thTP.className = `text-center pct-col-${tableId}`;
            thTP.textContent = '%';
            hRow2.appendChild(thTP);
        }
        thead.appendChild(hRow1);
        thead.appendChild(hRow2);

        const tbody = tableEl.querySelector('tbody');
        tbody.innerHTML = '';
        dataObj.file_keys.forEach(fk => {
            const tot = totals[fk];
            const tr = document.createElement('tr');
            if (!isSingleFileVert) {
                const tdFile = document.createElement('td');
                tdFile.className = 'text-start fw-medium';
                tdFile.textContent = dataObj.file_labels[fk];
                tr.appendChild(tdFile);
            }
            dataObj.data.forEach((row, origIdx) => {
                const c = row.counts[fk] || 0;
                const excluded = !row.included;
                let pct = '0';
                if (!excluded && tot > 0 && c > 0) {
                    const rawPct = (c / tot) * 100;
                    pct = (rawPct > 0 && rawPct < 1) ? '<1' : Math.round(rawPct).toString();
                }
                const isTop = row.included && topN > 0 && row._total >= threshold;
                const cellStyle = excluded ? 'text-decoration:line-through;text-decoration-thickness:2px;text-decoration-color:#868e96;color:#6c757d;background-color:#e9ecef;' : '';
                const textClass = isTop ? 'text-danger' : '';

                const tdC = document.createElement('td');
                tdC.className = `text-center align-middle count-col-${tableId}${textClass ? ' ' + textClass : ''}`;
                if (cellStyle) tdC.style.cssText = cellStyle;
                const cSpan = document.createElement('span');
                cSpan.contentEditable = 'true';
                cSpan.className = `editable-cell answer-count${textClass ? ' ' + textClass : ''}`;
                cSpan.dataset.id = tableId;
                cSpan.dataset.index = origIdx;
                cSpan.dataset.file = fk;
                cSpan.textContent = c;
                tdC.appendChild(cSpan);
                tr.appendChild(tdC);

                const tdP = document.createElement('td');
                tdP.className = `text-center align-middle pct-col-${tableId}${textClass ? ' ' + textClass : ''}`;
                if (cellStyle) tdP.style.cssText = cellStyle;
                tdP.textContent = pct;
                tr.appendChild(tdP);
            });
            if (dataObj.options.showTotal) {
                const tdTC = document.createElement('td');
                tdTC.className = `text-center fw-bold count-col-${tableId}`;
                tdTC.textContent = tot;
                tr.appendChild(tdTC);
                const tdTP = document.createElement('td');
                tdTP.className = `text-center fw-bold pct-col-${tableId}`;
                tdTP.textContent = tot > 0 ? '100' : '0';
                tr.appendChild(tdTP);
            }
            tbody.appendChild(tr);
        });
        tableEl.querySelector('tfoot').innerHTML = '';
        tableEl.querySelector('tfoot').classList.add('d-none');

    } else {
        const isSingleFile = dataObj.file_keys.length === 1;
        const thead = tableEl.querySelector('thead');
        thead.innerHTML = '';

        if (isSingleFile) {
            const hRow = document.createElement('tr');
            hRow.id = `thead_row1_${tableId}`;
            const thCtrlH = document.createElement('th');
            thCtrlH.className = `control-col main-th-${tableId}`;
            hRow.appendChild(thCtrlH);
            const thAns = document.createElement('th');
            thAns.className = `text-start align-middle main-th-${tableId}`;
            thAns.style.width = '40%';
            thAns.appendChild(_editableSpan(dataObj.headers.h1 || 'Ответ', tableId, 'h1'));
            hRow.appendChild(thAns);
            const thC = document.createElement('th');
            thC.className = `text-center count-col-${tableId}`;
            thC.appendChild(_editableSpan(dataObj.headers.h2 || 'Кол-во ответивших', tableId, 'h2'));
            hRow.appendChild(thC);
            const thP = document.createElement('th');
            thP.className = `text-center pct-col-${tableId}`;
            thP.appendChild(_editableSpan(dataObj.headers.h3 || '% от числа ответивших', tableId, 'h3'));
            hRow.appendChild(thP);
            thead.appendChild(hRow);
        } else {
            const hRow1 = document.createElement('tr');
            hRow1.id = `thead_row1_${tableId}`;
            const thCtrlH = document.createElement('th');
            thCtrlH.className = `control-col main-th-${tableId}`;
            thCtrlH.rowSpan = 2;
            hRow1.appendChild(thCtrlH);
            const thAns = document.createElement('th');
            thAns.className = `text-start align-middle main-th-${tableId}`;
            thAns.rowSpan = 2;
            thAns.style.width = '40%';
            thAns.appendChild(_editableSpan(dataObj.headers.h1 || 'Ответ', tableId, 'h1'));
            hRow1.appendChild(thAns);
            dataObj.file_keys.forEach(fk => {
                const th = document.createElement('th');
                th.className = `text-center file-header-${tableId}`;
                th.colSpan = 2;
                th.textContent = dataObj.file_labels[fk];
                hRow1.appendChild(th);
            });
            thead.appendChild(hRow1);

            const hRow2 = document.createElement('tr');
            hRow2.id = `thead_row2_${tableId}`;
            dataObj.file_keys.forEach(() => {
                const thC = document.createElement('th');
                thC.className = `text-center count-col-${tableId}`;
                thC.appendChild(_editableSpan(dataObj.headers.h2 || 'Кол-во ответивших', tableId, 'h2'));
                hRow2.appendChild(thC);
                const thP = document.createElement('th');
                thP.className = `text-center pct-col-${tableId}`;
                thP.appendChild(_editableSpan(dataObj.headers.h3 || '% от числа ответивших', tableId, 'h3'));
                hRow2.appendChild(thP);
            });
            thead.appendChild(hRow2);
        }

        const tbody = tableEl.querySelector('tbody');
        tbody.innerHTML = '';
        const lastIdx = dataObj.data.length - 1;

        if (!dataObj.data.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = isSingleFile ? 4 : 2 + dataObj.file_keys.length * 2;
            td.className = 'text-center text-muted py-3 small';
            td.textContent = 'Нет данных';
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            dataObj.data.forEach((row, idx) => {
                const isTop = topN > 0 && row.included && row._total >= threshold;
                const tr = _tpl('tpl-table-body-row');
                tr.className = row.included ? (isTop ? 'row-top-highlight' : '') : 'row-excluded';
                if (isTop) tr.style.setProperty('--top-color', highlightColor);

                const toggle = tr.querySelector('.row-toggle');
                toggle.checked = row.included;
                toggle.dataset.id = tableId;
                toggle.dataset.index = idx;

                const mergeBtn = tr.querySelector('.btn-merge-answer');
                mergeBtn.dataset.id = tableId;
                mergeBtn.dataset.index = idx;

                const answerSpan = tr.querySelector('.answer-text');
                answerSpan.textContent = row.answer;
                answerSpan.dataset.id = tableId;
                answerSpan.dataset.index = idx;

                if (idx === lastIdx) {
                    const addBtn = document.createElement('button');
                    addBtn.type = 'button';
                    addBtn.className = 'add-row-btn';
                    addBtn.dataset.id = tableId;
                    addBtn.dataset.index = idx;
                    addBtn.title = 'Добавить строку ниже';
                    addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
                    tr.querySelector('.answer-td').appendChild(addBtn);
                }

                dataObj.file_keys.forEach(fk => {
                    const c = row.counts[fk] || 0;
                    const tot = totals[fk];
                    let pct = '0';
                    if (row.included && tot > 0 && c > 0) {
                        const rawPct = (c / tot) * 100;
                        pct = (rawPct > 0 && rawPct < 1) ? '<1' : Math.round(rawPct).toString();
                    }
                    const tdC = document.createElement('td');
                    tdC.className = `text-center align-middle count-col-${tableId}`;
                    const cSpan = document.createElement('span');
                    cSpan.contentEditable = 'true';
                    cSpan.className = 'editable-cell answer-count';
                    cSpan.dataset.id = tableId;
                    cSpan.dataset.index = idx;
                    cSpan.dataset.file = fk;
                    cSpan.textContent = c;
                    tdC.appendChild(cSpan);
                    tr.appendChild(tdC);
                    const tdP = document.createElement('td');
                    tdP.className = `text-center align-middle pct-col-${tableId}`;
                    tdP.textContent = pct;
                    tr.appendChild(tdP);
                });

                tbody.appendChild(tr);
            });
        }

        const tfoot = tableEl.querySelector('tfoot');
        if (dataObj.options.showTotal) {
            tfoot.innerHTML = '';
            const tfRow = document.createElement('tr');
            tfRow.className = 'fw-bold bg-body-secondary';
            const tdCtrl = document.createElement('td');
            tdCtrl.className = 'control-col';
            tfRow.appendChild(tdCtrl);
            const tdLbl = document.createElement('td');
            tdLbl.className = 'text-start';
            tdLbl.textContent = 'Всего';
            tfRow.appendChild(tdLbl);
            dataObj.file_keys.forEach(fk => {
                const tdC = document.createElement('td');
                tdC.className = `text-center count-col-${tableId}`;
                tdC.textContent = totals[fk];
                tfRow.appendChild(tdC);
                const tdP = document.createElement('td');
                tdP.className = `text-center pct-col-${tableId}`;
                tdP.textContent = totals[fk] > 0 ? '100' : '0';
                tfRow.appendChild(tdP);
            });
            tfoot.appendChild(tfRow);
            tfoot.classList.remove('d-none');
        } else {
            tfoot.classList.add('d-none');
        }
    }

    applyHiddenColumns(tableId);
}

// ===================== TABLE SETTINGS EVENT HANDLERS =====================
document.addEventListener('change', (e) => {
    if (e.target.classList.contains('setting-show-total')) {
        window.appData[e.target.dataset.id].options.showTotal = e.target.checked;
        renderTable(e.target.dataset.id);
    }
    if (e.target.classList.contains('setting-highlight-top')) {
        window.appData[e.target.dataset.id].options.highlightTop = e.target.checked;
        drawChart(e.target.dataset.id);
        renderTable(e.target.dataset.id);
    }
    if (e.target.classList.contains('setting-vertical')) {
        const id = e.target.dataset.id;
        window.appData[id].options.tableVertical = e.target.checked;
        window.appData[id].options.chartDirection = e.target.checked ? 'x' : 'y';
        renderTable(id);
        drawChart(id);
        drawStackedChart(id);
    }
    if (e.target.classList.contains('setting-highlight-color')) {
        window.appData[e.target.dataset.id].options.highlightColor = e.target.value;
        drawChart(e.target.dataset.id);
        renderTable(e.target.dataset.id);
    }
    if (e.target.classList.contains('pie-answer-color')) {
        const id = e.target.dataset.id;
        window.appData[id].pieColors[parseInt(e.target.dataset.index)] = e.target.value;
        drawPieChart(id);
    }
    if (e.target.classList.contains('bar-answer-color')) {
        const id = e.target.dataset.id;
        window.appData[id].barColors[parseInt(e.target.dataset.index)] = e.target.value;
        drawChart(id);
    }
    if (e.target.classList.contains('row-toggle')) {
        window.appData[e.target.dataset.id].data[parseInt(e.target.dataset.index)].included = e.target.checked;
        renderTable(e.target.dataset.id);
        drawChart(e.target.dataset.id);
        drawStackedChart(e.target.dataset.id);
        drawPieChart(e.target.dataset.id);
    }
    if (e.target.classList.contains('modal-row-toggle')) {
        const id = e.target.dataset.id;
        window.appData[id].data[parseInt(e.target.dataset.index)].included = e.target.checked;
        renderChartEditModal(id);
        renderTable(id);
        drawChart(id);
        drawStackedChart(id);
        drawPieChart(id);
    }
    if (e.target.classList.contains('setting-show-legend')) {
        const id = e.target.dataset.id;
        window.appData[id].options.showLegend = e.target.checked;
        drawChart(id);
        drawStackedChart(id);
        drawPieChart(id);
    }
});

document.addEventListener('input', (e) => {
    if (e.target.classList.contains('setting-top-n')) {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val >= 1) {
            window.appData[e.target.dataset.id].options.topN = val;
            if (window.appData[e.target.dataset.id].options.highlightTop) {
                drawChart(e.target.dataset.id);
                renderTable(e.target.dataset.id);
            }
        }
    }
    if (e.target.classList.contains('answer-text')) {
        window.appData[e.target.dataset.id].data[parseInt(e.target.dataset.index)].answer = e.target.innerText;
    }
    if (e.target.classList.contains('answer-count')) {
        const val = parseInt(e.target.innerText);
        if (!isNaN(val)) {
            const fk = e.target.getAttribute('data-file');
            const rowData = window.appData[e.target.dataset.id].data[parseInt(e.target.dataset.index)];
            rowData.counts[fk] = val;
            rowData._total = Object.values(rowData.counts).reduce((a, b) => a + b, 0);
        }
    }
    if (e.target.hasAttribute('data-header')) {
        window.appData[e.target.dataset.id].headers[e.target.getAttribute('data-header')] = e.target.innerText;
    }
    if (e.target.classList.contains('modal-answer-text')) {
        window.appData[e.target.dataset.id].data[parseInt(e.target.dataset.index)].answer = e.target.innerText;
    }
    if (e.target.classList.contains('modal-answer-count')) {
        const val = parseInt(e.target.innerText);
        if (!isNaN(val)) {
            const fk = e.target.getAttribute('data-file');
            const rowData = window.appData[e.target.dataset.id].data[parseInt(e.target.dataset.index)];
            rowData.counts[fk] = val;
            rowData._total = Object.values(rowData.counts).reduce((a, b) => a + b, 0);
        }
    }
});

document.addEventListener('focusout', (e) => {
    if (e.target.classList.contains('answer-count') || e.target.classList.contains('answer-text') || e.target.hasAttribute('data-header')) {
        const id = e.target.dataset.id;
        if (e.target.classList.contains('answer-count')) {
            // Пересчитать _total для строки
            const dataObj = window.appData[id];
            if (dataObj) {
                dataObj.data.forEach(row => {
                    row._total = Object.values(row.counts).reduce((a, b) => a + b, 0);
                });
            }
        }
        renderTable(id);
        drawChart(id);
        drawStackedChart(id);
        drawPieChart(id);
    }
    if (e.target.classList.contains('modal-answer-count') || e.target.classList.contains('modal-answer-text')) {
        const id = e.target.dataset.id;
            if (e.target.classList.contains('modal-answer-count')) {
                const dataObj = window.appData[id];
                if (dataObj) {
                    dataObj.data.forEach(row => {
                        row._total = Object.values(row.counts).reduce((a, b) => a + b, 0);
                    });
                }
            }
            renderChartEditModal(id);
            renderTable(id);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('editable-cell')) { e.preventDefault(); e.target.blur(); }
});

document.addEventListener('click', (e) => {
    const btn = e.target.closest('.add-row-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    const idx = parseInt(btn.dataset.index);
    const dataObj = window.appData[id];
    if (!dataObj) return;
    const newRow = { answer: '', counts: Object.fromEntries(dataObj.file_keys.map(fk => [fk, 0])), included: true, _total: 0 };
    dataObj.data.splice(idx + 1, 0, newRow);
    renderTable(id);
    setTimeout(() => {
        const cell = document.querySelector(`.answer-text[data-id="${id}"][data-index="${idx + 1}"]`);
        if (cell) { cell.focus(); document.execCommand('selectAll', false, null); }
    }, 30);
});

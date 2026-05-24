// ===================== ШАГ 6: ГЕНЕРАЦИЯ ИИ-ОТЧЁТА =====================

let _exportAbortController = null;

// ── Сохранение и восстановление результата экспорта ─────────────────────────

function _storeExportResult(b64, filename) {
    window.exportResult = {
        file: b64,
        filename: filename || 'report_analysis.docx',
        generatedAt: Date.now(),
    };
    if (window._wizardState && typeof window._wizardState.save === 'function') {
        window._wizardState.save();
    }
}

function _downloadExportResult(exportResult) {
    if (!exportResult || !exportResult.file) return;
    const bytes = Uint8Array.from(atob(exportResult.file), c => c.charCodeAt(0));
    const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportResult.filename || 'report_analysis.docx';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

function restoreExportButtons(exportResult) {
    if (!exportResult || !exportResult.file) return false;

    const step6Container = document.getElementById('wizardStep5');
    if (!step6Container) return false;
    const wizardCard = step6Container.querySelector('.wizard-card') || step6Container;

    // Удаляем старый баннер, если был.
    const old = document.getElementById('exportRestoreBanner');
    if (old) old.remove();

    const when = exportResult.generatedAt ? new Date(exportResult.generatedAt) : new Date();
    const timeStr = when.toLocaleString('ru-RU', {
        hour: '2-digit', minute: '2-digit',
        day: '2-digit', month: '2-digit', year: 'numeric',
    });

    const banner = document.createElement('div');
    banner.id = 'exportRestoreBanner';
    banner.className = 'alert alert-success d-flex align-items-center gap-2 mt-3 mb-3';
    banner.innerHTML = `
        <i class="fa-solid fa-circle-check fs-5"></i>
        <div class="flex-grow-1">
            <div class="fw-medium">Отчёт сгенерирован (${timeStr})</div>
            <div class="small text-muted">${exportResult.filename || 'report_analysis.docx'}</div>
        </div>
        <button type="button" class="btn btn-sm btn-success" id="exportRedownloadBtn">
            <i class="fa-solid fa-download me-1"></i>Скачать снова
        </button>
    `;

    wizardCard.appendChild(banner);

    const btn = document.getElementById('exportRedownloadBtn');
    if (btn) btn.addEventListener('click', () => _downloadExportResult(exportResult));

    return true;
}

window.restoreExportButtons = restoreExportButtons;


function _collectColorsForActive(dataObj, colorsArr) {
    if (!Array.isArray(colorsArr)) return [];
    const activeLen = dataObj.data.filter(r => r.included !== false).length;
    return colorsArr.slice(0, activeLen);
}

let _currentTaskId = null;

let _downloadBtnDefaultHtml = null;
function _captureDownloadBtnDefault() {
    if (_downloadBtnDefaultHtml === null) {
        const b = document.getElementById('downloadApiBtn');
        if (b) _downloadBtnDefaultHtml = b.innerHTML;
    }
    return _downloadBtnDefaultHtml;
}
_captureDownloadBtnDefault();

document.getElementById('exportStopBtn').addEventListener('click', async () => {
    
    const tid = _currentTaskId || (window.exportTask && window.exportTask.task_id);
    if (tid) {
        try {
            await fetch(`/export_docx_cancel/${tid}`, { method: 'POST' });
        } catch (e) {  }
    }

    if (_exportAbortController) _exportAbortController.abort();
});

async function _doExport() {
    const sections = window.reportSections || [];
    if (!window.appData || Object.keys(window.appData).length === 0) {
        showToast('Нет данных анализа. Сначала запустите анализ на шаге 5.', 'danger');
        return;
    }


    const nameToId = {};
    for (const id of Object.keys(window.appData)) {
        if (id.startsWith('both_table_')) continue; 
        const qName = window.appData[id].question_name;
        if (qName) nameToId[qName] = id;
    }

    const questions = [];
    let tableNum = 1;

    const processedQNames = new Set();

    // Из разделов
    for (const sec of sections) {
        for (const qEntry of (sec.questions || [])) {
            const qName = qEntry.qName;
            const id = nameToId[qName];
            if (!id || processedQNames.has(qName)) continue;
            processedQNames.add(qName);

            const dataObj = window.appData[id];
            const activeRows = dataObj.data
                .filter(r => r.included !== false)
                .sort((a, b) => (b._total || 0) - (a._total || 0));
            if (activeRows.length === 0) continue;

            const fileTotals = {};
            dataObj.file_keys.forEach(fk => {
                fileTotals[fk] = dataObj.data.reduce((sum, r) => sum + (r.counts[fk] || 0), 0);
            });

            const opts = dataObj.options || {};
            let vizTab = null;
            const tabsEl = document.getElementById(`tabs_${id}`);
            if (tabsEl) {
                const activeBtn = tabsEl.querySelector('.viz-tab-btn.active');
                vizTab = activeBtn ? activeBtn.dataset.tab : 'table';
            } else if (qEntry.visualize) {
                vizTab = 'table';
            }

            questions.push({
                table_num: tableNum++,
                question_name: dataObj.question_name,
                h1: dataObj.headers.h1 || 'Ответ',
                h2: dataObj.headers.h2 || 'Кол-во ответивших',
                h3: dataObj.headers.h3 || '% от числа ответивших',
                file_keys: dataObj.file_keys,
                file_labels: dataObj.file_labels,
                rows: activeRows.map(r => ({
                    answer: String(r.answer),
                    counts: Object.fromEntries(dataObj.file_keys.map(fk => [fk, r.counts[fk] || 0]))
                })),
                file_totals: fileTotals,
                show_total: opts.showTotal !== false,
                section: { name: sec.name, description: sec.description || '', color: sec.color || '' },
                viz_tab: vizTab,
                both_chart_type: window.appData[id]?._lastChartTab || 'bar',
                chart_direction: opts.chartDirection || 'y',
                show_legend: opts.showLegend !== false,
                hidden_col: opts.hiddenCol || 'none',
                skip_analytics: window.appData[id]?.options?.skipAnalytics === true,
                pie_colors: _collectColorsForActive(dataObj, dataObj.pieColors),
                bar_colors: _collectColorsForActive(dataObj, dataObj.barColors),
                file_colors: dataObj.file_colors || {},
            });
        }
    }

    // Нераспределённые вопросы (без раздела)
    for (const [id, dataObj] of Object.entries(window.appData)) {
        const qName = dataObj.question_name;
        if (processedQNames.has(qName)) continue;
        processedQNames.add(qName);

        const activeRows = dataObj.data
            .filter(r => r.included !== false)
            .sort((a, b) => (b._total || 0) - (a._total || 0));
        if (activeRows.length === 0) continue;

        const fileTotals = {};
        dataObj.file_keys.forEach(fk => {
            fileTotals[fk] = dataObj.data.reduce((sum, r) => sum + (r.counts[fk] || 0), 0);
        });

        const opts = dataObj.options || {};
        let vizTab = null;
        const tabsEl = document.getElementById(`tabs_${id}`);
        if (tabsEl) {
            const activeBtn = tabsEl.querySelector('.viz-tab-btn.active');
            vizTab = activeBtn ? activeBtn.dataset.tab : 'table';
        } else if (dataObj.visualize) {
            vizTab = 'table';
        }

        questions.push({
            table_num: tableNum++,
            question_name: dataObj.question_name,
            h1: dataObj.headers.h1 || 'Ответ',
            h2: dataObj.headers.h2 || 'Кол-во ответивших',
            h3: dataObj.headers.h3 || '% от числа ответивших',
            file_keys: dataObj.file_keys,
            file_labels: dataObj.file_labels,
            rows: activeRows.map(r => ({
                answer: String(r.answer),
                counts: Object.fromEntries(dataObj.file_keys.map(fk => [fk, r.counts[fk] || 0]))
            })),
            file_totals: fileTotals,
            show_total: opts.showTotal !== false,
            section: null,
            viz_tab: vizTab,
            both_chart_type: window.appData[id]?._lastChartTab || 'bar',
            chart_direction: opts.chartDirection || 'y',
            show_legend: opts.showLegend !== false,
            hidden_col: opts.hiddenCol || 'none',
            skip_analytics: window.appData[id]?.options?.skipAnalytics === true,
            pie_colors: _collectColorsForActive(dataObj, dataObj.pieColors),
            bar_colors: _collectColorsForActive(dataObj, dataObj.barColors),
            file_colors: dataObj.file_colors || {},
        });
    }

    if (questions.length === 0) {
        showToast('Нет данных для экспорта. Убедитесь, что анализ запущен на шаге 5.', 'danger');
        return;
    }


    const btn = document.getElementById('downloadApiBtn');
    _captureDownloadBtnDefault();
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Запуск...';

    let taskId = null;
    try {
        console.table(questions.map(q => ({
            name: q.question_name.substring(0, 30),
            viz_tab: q.viz_tab,
            both_chart_type: q.both_chart_type,
            skip: q.skip_analytics
        })));

        const exportBody = { questions, session_id: window.sessionId || null };
        if (window._titlePageFilled) {
            exportBody.title_page_body     = window._titlePageFilled.title_page_body;
            exportBody.title_page_approval = window._titlePageFilled.title_page_approval;
        }
        const startResp = await fetch('/export_docx_start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportBody),
        });
        if (!startResp.ok) {
            const data = await startResp.json().catch(() => ({}));
            showToast(data.message || 'Ошибка запуска генерации', 'danger');
            btn.disabled = false;
            btn.innerHTML = _downloadBtnDefaultHtml || 'Скачать .docx';
            return;
        }
        const startData = await startResp.json();
        taskId = startData.task_id;
        if (!taskId) {
            showToast('Сервер не вернул task_id', 'danger');
            btn.disabled = false;
            btn.innerHTML = _downloadBtnDefaultHtml || 'Скачать .docx';
            return;
        }

        
        window.exportTask = { task_id: taskId, startedAt: Date.now() };
        if (window._wizardState && typeof window._wizardState.save === 'function') {
            window._wizardState.save();
        }
    } catch (err) {
        showToast('Ошибка соединения с сервером при запуске', 'danger');
        btn.disabled = false;
        btn.innerHTML = _downloadBtnDefaultHtml || 'Скачать .docx';
        return;
    }


    await _streamExportTask(taskId);
}



async function _streamExportTask(taskId) {
    if (!taskId) return;
    _currentTaskId = taskId;
    _captureDownloadBtnDefault();

    const btn = document.getElementById('downloadApiBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Генерация...';

    const progressContainer = document.getElementById('exportProgressContainer');
    const progressBar = document.getElementById('exportProgressBar');
    const progressText = document.getElementById('exportProgressText');
    const progressLabel = document.getElementById('exportProgressLabel');
    const stopBtn = document.getElementById('exportStopBtn');
    if (progressContainer) progressContainer.classList.remove('export-progress-hidden');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '';
    if (progressLabel) progressLabel.textContent = 'Подключение к задаче…';
    if (stopBtn) stopBtn.disabled = false;

    _exportAbortController = new AbortController();


    const startTime = (window.exportTask && window.exportTask.startedAt) || Date.now();
    const _exportTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const s = (elapsed % 60).toString().padStart(2, '0');
        const timerEl = document.getElementById('exportTimerLabel');
        if (timerEl) timerEl.textContent = `${m}:${s}`;
    }, 1000);

    let userVisibleError = null;
    let connectionLost = false;

    try {
        const response = await fetch(`/export_docx_stream/${taskId}`, {
            method: 'GET',
            signal: _exportAbortController.signal,
        });

        if (!response.ok) {
            if (response.status === 404) {
                showToast('Задача истекла или не найдена. Запустите экспорт заново.', 'warning');
                window.exportTask = undefined;
                if (window._wizardState && window._wizardState.save) window._wizardState.save();
            } else {
                showToast('Не удалось подключиться к задаче', 'danger');
            }
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const msg = JSON.parse(line.slice(6));

                if (msg.type === 'progress') {
                    const pct = Math.min(Math.round((msg.current / msg.total) * 100), 99);
                    if (progressBar) progressBar.style.width = pct + '%';
                    if (progressText) progressText.textContent = pct + '%';
                    if (progressLabel) progressLabel.textContent = `Вопрос ${msg.current} из ${msg.total}: ${msg.label}`;
                }

                if (msg.type === 'done') {
                    const fileBytes = Uint8Array.from(atob(msg.file), c => c.charCodeAt(0));
                    const fileBlob = new Blob([fileBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
                    const fileUrl = URL.createObjectURL(fileBlob);
                    const a = document.createElement('a');
                    a.href = fileUrl;
                    const customName = (document.getElementById('exportFilenameInput')?.value || '').trim();
                    a.download = customName ? customName.replace(/\.docx$/i, '') + '.docx' : (msg.filename || 'report_analysis.docx');
                    document.body.appendChild(a); a.click();
                    document.body.removeChild(a); URL.revokeObjectURL(fileUrl);

                    // Сохраняем результат для refresh-восстановления и закрываем активную задачу.
                    _storeExportResult(msg.file, a.download);
                    restoreExportButtons(window.exportResult);
                    window.exportTask = undefined;
                    if (window._wizardState && window._wizardState.save) window._wizardState.save();

                    showToast('Готово: отчёт скачан', 'success');
                }

                if (msg.type === 'error') {
                    userVisibleError = msg.message || 'Ошибка генерации';
                    showToast(userVisibleError, 'danger');
                    window.exportTask = undefined;
                    if (window._wizardState && window._wizardState.save) window._wizardState.save();
                }
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') {

            window.exportTask = undefined;
            if (window._wizardState && window._wizardState.save) window._wizardState.save();
        } else {

            connectionLost = true;
            showToast('Соединение прервано. Задача продолжается в фоне — обновите страницу, чтобы возобновить.', 'warning');
        }
    } finally {
        _currentTaskId = null;
        _exportAbortController = null;
        btn.disabled = false;
        btn.innerHTML = _downloadBtnDefaultHtml || 'Скачать .docx';
        if (stopBtn) stopBtn.disabled = true;
        clearInterval(_exportTimerInterval);
        if (progressContainer && !connectionLost) {
            setTimeout(() => progressContainer.classList.add('export-progress-hidden'), 2000);
        }
    }
}



function resumeExportTask(taskId) {
    if (!taskId) return;
    if (_currentTaskId === taskId) return;   
}

window.resumeExportTask = resumeExportTask;

document.getElementById('downloadApiBtn').addEventListener('click', () => {
    _doExport();
});

// ===================== TOOLTIP INIT =====================
document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el, { trigger: 'hover' }));

initTooltips();

// ===================== ТИТУЛЬНЫЙ ЛИСТ =====================

function _parseTitlePlaceholders(text) {
    const regex = /\[([^\]]+)\]/g;
    const seen = new Set();
    const result = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
        if (!seen.has(m[1])) {
            seen.add(m[1]);
            result.push(m[1]);
        }
    }
    return result;
}

function _fillPlaceholders(text, values) {
    return text.replace(/\[([^\]]+)\]/g, (_, label) =>
        Object.prototype.hasOwnProperty.call(values, label) ? values[label] : `[${label}]`
    );
}

(function () {
    const openBtn = document.getElementById('titlePageFillBtn');
    if (!openBtn) return;

    let _titleModal = null;

    openBtn.addEventListener('click', async () => {
        let settings;
        try {
            const resp = await fetch('/api/settings');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            settings = await resp.json();
        } catch (e) {
            showToast('Не удалось загрузить настройки: ' + e.message, 'danger');
            return;
        }

        const body     = settings.title_page_body     || '';
        const approval = settings.title_page_approval || '';
        const combined = body + '\n' + approval;
        const placeholders = _parseTitlePlaceholders(combined);

        const container = document.getElementById('titlePageFieldsContainer');
        if (!container) return;

        const savedValues = window._titlePageFilled?._values || {};

        if (placeholders.length === 0) {
            container.innerHTML = '<p class="text-muted">В шаблоне титульного листа нет полей для заполнения (текст в квадратных скобках не найден).</p>';
        } else {
            container.innerHTML = placeholders.map((label, i) => {
                const id = `titleField_${i}`;
                return `<div class="mb-3">
                    <label class="form-label fw-semibold small" for="${id}">${_esc(label)}</label>
                    <textarea class="form-control" id="${id}" rows="3" data-placeholder="${_esc(label)}"></textarea>
                </div>`;
            }).join('');

            // Восстанавливаем ранее введённые значения
            container.querySelectorAll('[data-placeholder]').forEach(el => {
                if (Object.prototype.hasOwnProperty.call(savedValues, el.dataset.placeholder)) {
                    el.value = savedValues[el.dataset.placeholder];
                }
            });
        }

        // Кнопка «Применить»
        const applyBtn = document.getElementById('applyTitlePageBtn');
        applyBtn.onclick = () => {
            const values = {};
            container.querySelectorAll('[data-placeholder]').forEach(el => {
                values[el.dataset.placeholder] = el.value;
            });

            window._titlePageFilled = {
                title_page_body:     _fillPlaceholders(body, values),
                title_page_approval: _fillPlaceholders(approval, values),
                _values:             values,
            };

            bootstrap.Modal.getInstance(document.getElementById('titlePageFillModal'))?.hide();
        };

        if (!_titleModal) {
            _titleModal = new bootstrap.Modal(document.getElementById('titlePageFillModal'));
        }
        _titleModal.show();
    });

    function _esc(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
})();

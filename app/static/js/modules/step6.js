// ===================== ШАГ 6: ГЕНЕРАЦИЯ ИИ-ОТЧЁТА =====================

let _exportAbortController = null;

// ── Сохранение и восстановление результата экспорта ─────────────────────────

function _storeExportResult(b64, filename) {
    // Сохраняем base64 готового .docx в window.exportResult, чтобы после
    // refresh страницы пользователь мог скачать файл повторно без перегенерации.
    window.exportResult = {
        file: b64,
        filename: filename || 'report_analysis.docx',
        generatedAt: Date.now(),
    };
    // Форсируем сохранение в sessionStorage сразу — без 1.5с throttle.
    // Если файл слишком большой и не влезет — state.js гарантирует, что
    // лёгкие ключи всё равно будут сохранены без HEAVY (без exportResult).
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
    // На refresh шага 6: если сохранён готовый .docx — показываем баннер с
    // кнопкой «Скачать снова» в начале шага. Возвращает true, если что-то нарисовали.
    if (!exportResult || !exportResult.file) return false;

    const step6Container = document.getElementById('wizardStep5');   // 0-индекс: шаг 6 = wizardStep5
    if (!step6Container) return false;

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
            <div class="fw-medium">Отчёт уже сгенерирован (${timeStr})</div>
            <div class="small text-muted">${exportResult.filename || 'report_analysis.docx'}</div>
        </div>
        <button type="button" class="btn btn-sm btn-success" id="exportRedownloadBtn">
            <i class="fa-solid fa-download me-1"></i>Скачать снова
        </button>
    `;

    // Вставляем баннер в начало контейнера шага 6.
    step6Container.insertBefore(banner, step6Container.firstChild);

    const btn = document.getElementById('exportRedownloadBtn');
    if (btn) btn.addEventListener('click', () => _downloadExportResult(exportResult));

    return true;
}

window.restoreExportButtons = restoreExportButtons;

// Цвета хранятся индексами по активным строкам (отсортированным по _total desc).
// Срезаем по количеству активных строк, чтобы не отправлять лишние.
function _collectColorsForActive(dataObj, colorsArr) {
    if (!Array.isArray(colorsArr)) return [];
    const activeLen = dataObj.data.filter(r => r.included !== false).length;
    return colorsArr.slice(0, activeLen);
}

document.getElementById('exportStopBtn').addEventListener('click', () => {
    if (_exportAbortController) _exportAbortController.abort();
});

async function _doExport() {
    const sections = window.reportSections || [];
    if (!window.appData || Object.keys(window.appData).length === 0) {
        showToast('Нет данных анализа. Сначала запустите анализ на шаге 5.', 'danger');
        return;
    }

    // Индекс question_name → id в appData для быстрого поиска
    const nameToId = {};
    for (const id of Object.keys(window.appData)) {
        if (id.startsWith('both_table_')) continue;  // пропускаем копии для both-панели
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
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Генерация...';

    const progressContainer = document.getElementById('exportProgressContainer');
    const progressBar = document.getElementById('exportProgressBar');
    const progressText = document.getElementById('exportProgressText');
    const progressLabel = document.getElementById('exportProgressLabel');
    const stopBtn = document.getElementById('exportStopBtn');
    if (progressContainer) progressContainer.classList.remove('d-none');
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '';
    if (progressLabel) progressLabel.textContent = '';
    if (stopBtn) stopBtn.disabled = false;

    _exportAbortController = new AbortController();

    const _exportStartTime = Date.now();
    const _exportTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - _exportStartTime) / 1000);
        const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const s = (elapsed % 60).toString().padStart(2, '0');
        const timerEl = document.getElementById('exportTimerLabel');
        if (timerEl) timerEl.textContent = `${m}:${s}`;
    }, 1000);

    try {
        console.table(questions.map(q => ({
            name: q.question_name.substring(0, 30),
            viz_tab: q.viz_tab,
            both_chart_type: q.both_chart_type,
            skip: q.skip_analytics
        })));

        const response = await fetch('/export_docx_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questions, session_id: window.sessionId || null }),
            signal: _exportAbortController.signal
        });

        if (!response.ok) {
            const data = await response.json();
            showToast(data.message || 'Ошибка генерации документа', 'danger');
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

                    // Сохраняем результат для восстановления после refresh.
                    _storeExportResult(msg.file, a.download);
                    // И сразу показываем баннер «Скачать снова» — пользователь
                    // увидит подтверждение того, что файл доступен повторно.
                    restoreExportButtons(window.exportResult);

                    showToast('Готово: отчёт скачан', 'success');
                }

                if (msg.type === 'error') {
                    showToast(msg.message || 'Ошибка генерации', 'danger');
                }
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            showToast('Генерация отчёта остановлена', 'warning');
        } else {
            showToast('Ошибка соединения с сервером', 'danger');
        }
    } finally {
        _exportAbortController = null;
        btn.disabled = false;
        btn.innerHTML = origHtml;
        if (stopBtn) stopBtn.disabled = true;
        clearInterval(_exportTimerInterval);
        if (progressContainer) setTimeout(() => progressContainer.classList.add('d-none'), 2000);
    }
}

document.getElementById('downloadApiBtn').addEventListener('click', () => {
    _doExport();
});

// ===================== TOOLTIP INIT =====================
document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el, { trigger: 'hover' }));

initTooltips();

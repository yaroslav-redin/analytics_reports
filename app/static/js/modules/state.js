// ===================== STATE PERSISTENCE (этап 2) =====================
// Сериализует прогресс мастера в sessionStorage. В этой итерации модуль
// ТОЛЬКО ПИШЕТ в storage. Чтение/восстановление DOM на refresh — задача
// этапа 3. Сейчас цель: гарантировать, что в sessionStorage всегда лежит
// актуальный снапшот window.*, чтобы было что восстанавливать дальше.

(function () {
    'use strict';

    const STATE_KEY = 'wizardState.v1';
    const SAVE_THROTTLE_MS = 1500;

    // Что сериализуем. HEAVY_KEYS — большие блобы; при QuotaExceeded
    // отбрасываются в первую очередь.
    const LIGHT_KEYS = [
        'sessionId',
        'uploadedFiles',
        'processedFiles',
        'sheetSelections',          // {[filename]: [sheet1, sheet2]}, для рехидрации шага 2
        'questionMapping',
        'questionMerges',
        'questionSourceFile',
        'reportSections',
    ];
    const HEAVY_KEYS = [
        'appData',
        'exportResult',   // {data_b64, analysis_b64} — base64 готовых .docx, может быть МБ
    ];

    // ── Сборка состояния ──────────────────────────────────────────────────────

    function _collectState() {
        const state = {
            version: 1,
            ts: Date.now(),
            currentStep: (typeof currentWizardStep !== 'undefined') ? currentWizardStep : 0,
        };
        for (const k of LIGHT_KEYS) {
            if (window[k] !== undefined) state[k] = window[k];
        }
        for (const k of HEAVY_KEYS) {
            if (window[k] !== undefined) state[k] = window[k];
        }
        return state;
    }

    // ── Запись ────────────────────────────────────────────────────────────────

    function saveStateNow() {
        let state;
        try {
            state = _collectState();
        } catch (e) {
            console.warn('[state] failed to collect window state', e);
            return false;
        }

        // Первый проход — полное состояние.
        try {
            sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
            return true;
        } catch (e) {
            // QuotaExceededError или JSON.stringify cyclic — пытаемся без HEAVY.
            console.warn('[state] full save failed, retrying without heavy keys', e);
        }

        // Второй проход — без HEAVY_KEYS.
        try {
            const lite = { ...state };
            for (const k of HEAVY_KEYS) delete lite[k];
            sessionStorage.setItem(STATE_KEY, JSON.stringify(lite));
            return true;
        } catch (e) {
            console.error('[state] save failed entirely', e);
            return false;
        }
    }

    // ── Throttled save ───────────────────────────────────────────────────────

    let _saveTimer = null;

    function scheduleSave() {
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
            _saveTimer = null;
            saveStateNow();
        }, SAVE_THROTTLE_MS);
    }

    // ── Чтение и сброс (понадобятся этапу 3 и для отладки) ───────────────────

    function loadState() {
        try {
            const raw = sessionStorage.getItem(STATE_KEY);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object') return null;
            return obj;
        } catch (e) {
            return null;
        }
    }

    function clearState() {
        try {
            sessionStorage.removeItem(STATE_KEY);
        } catch (e) { /* nothing useful to do */ }
    }

    // ── Автосохранение по событиям ───────────────────────────────────────────

    // Throttled-save на любое пользовательское действие. capture:true —
    // чтобы поймать событие ДО того, как stopPropagation в каком-нибудь
    // обработчике его съест.
    ['click', 'change', 'input', 'keyup'].forEach(ev => {
        document.addEventListener(ev, scheduleSave, { passive: true, capture: true });
    });

    // Final flush — синхронно, без throttle. pagehide ловит iOS Safari и Firefox,
    // beforeunload — десктопные браузеры. Лучше срабатывает дважды, чем ни разу.
    window.addEventListener('beforeunload', saveStateNow);
    window.addEventListener('pagehide', saveStateNow);

    // На скрытие вкладки тоже сбросим — пользователь мог переключиться на другую
    // и вернуться через час; пока он там, хотим иметь свежий снапшот.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveStateNow();
    });

    // ── Восстановление при загрузке (этап 3) ─────────────────────────────────

    function _populateWindowFromState(state) {
        if (!state || typeof state !== 'object') return;
        for (const k of LIGHT_KEYS) {
            if (k in state) window[k] = state[k];
        }
        for (const k of HEAVY_KEYS) {
            if (k in state) window[k] = state[k];
        }
    }

    function restoreState() {
        // Алгоритм:
        //   1. Прочитать сохранённое состояние.
        //   2. Положить window.* (sessionId, appData, reportSections и т.п.).
        //   3. Выбрать целевой шаг: hash URL имеет приоритет над сохранённым.
        //   4. Регидрация:
        //      • шаг 5 (index 4, визуализация) — renderAnalysisResults из appData.
        //      • шаг 6 (index 5, экспорт)     — restoreExportButtons из exportResult.
        //   5. goToStep(target).
        // Шаги 1–4 (index 0..3) DOM-регидрацию пока не получают — это задача
        // этапа 4. window.* там уже восстановлен, можно идти «Назад → Далее»,
        // и поздние шаги получат данные.

        const saved = loadState();
        if (saved) _populateWindowFromState(saved);

        // Определяем целевой шаг.
        let target = 0;
        const hashFn = (typeof _stepFromHash === 'function') ? _stepFromHash : null;
        const hashStep = hashFn ? hashFn() : null;
        if (hashStep !== null && hashStep !== undefined) {
            target = hashStep;
        } else if (saved && typeof saved.currentStep === 'number') {
            target = saved.currentStep;
        }
        if (target < 0 || target >= 6) target = 0;

        // Регидрация DOM каждого шага, если есть соответствующие данные.
        // Порядок важен: следующий шаг зависит от DOM предыдущего
        // (например, шаг 4 читает sortable-список из шага 3).
        // Каждый шаг в try/catch — даже если один упадёт, остальные сработают.

        // Шаг 2 (Листы): рисуем чекбоксы по uploadedFiles + sheetSelections.
        if (window.uploadedFiles && window.uploadedFiles.length
            && typeof window.rehydrateSheetsUI === 'function')
        {
            try { window.rehydrateSheetsUI(); }
            catch (e) { console.error('[state] rehydrateSheetsUI failed', e); }
        }

        // Шаг 3 (Вопросы): список доступных + sortable выбранных.
        if (window.processedFiles && window.processedFiles.length
            && typeof window.rehydrateQuestionsUI === 'function')
        {
            try { window.rehydrateQuestionsUI(); }
            catch (e) { console.error('[state] rehydrateQuestionsUI failed', e); }
        }

        // Шаг 4 (Разделы): renderStep4 умеет рисовать и из reportSections,
        // и из пустого состояния (показывает «доступные вопросы» из sortable).
        // ВАЖНО: зависит от sortable-DOM шага 3 — поэтому ПОСЛЕ rehydrateQuestionsUI.
        if (typeof window.renderStep4 === 'function'
            && window.processedFiles && window.processedFiles.length)
        {
            try { window.renderStep4(); }
            catch (e) { console.error('[state] renderStep4 failed', e); }
        }

        // Шаг 5 (визуализация) — если есть appData.
        if (target >= 4
            && window.appData && Object.keys(window.appData).length > 0
            && typeof window.rehydrateAnalysisResults === 'function')
        {
            try { window.rehydrateAnalysisResults(); }
            catch (e) { console.error('[state] rehydrate visualization failed', e); }
        }

        // Шаг 6 (экспорт) — если есть готовый exportResult.
        if (target >= 5
            && window.exportResult
            && typeof window.restoreExportButtons === 'function')
        {
            try { window.restoreExportButtons(window.exportResult); }
            catch (e) { console.error('[state] restoreExportButtons failed', e); }
        }

        // Финальная навигация. Если target === 0, явно не вызываем goToStep,
        // чтобы не дёргать DOM (визард уже на нулевом шаге по умолчанию).
        // {instant:true} — отключаем 0.45s-анимацию перелистывания, иначе
        // пользователь видит, как страница «промахивается» через все шаги.
        if (target > 0 && typeof goToStep === 'function') {
            goToStep(target, { instant: true });
        }

        // Снимаем класс, выставленный inline-скриптом в <head>. Делаем это в
        // следующем кадре через rAF — чтобы DOM-правки (transform от goToStep)
        // успели применить до того, как трек станет visible.
        var revealTrack = function () {
            document.documentElement.classList.remove('wizard-restoring');
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(revealTrack);
        } else {
            revealTrack();
        }

        return { restoredFrom: saved, target };
    }

    // ── Публичное API для других модулей и для отладки ───────────────────────

    window._wizardState = {
        save:     saveStateNow,
        schedule: scheduleSave,
        load:     loadState,
        clear:    clearState,
        restore:  restoreState,
        KEY:      STATE_KEY,
        LIGHT_KEYS,
        HEAVY_KEYS,
    };

    // НЕ делаем saveStateNow() при загрузке модуля: window.* в этот момент
    // ещё не заполнены другими модулями, и сохранение перезаписало бы
    // данные предыдущей сессии пустотой — то есть refresh обнулял бы прогресс.
    // Первый осмысленный сейв произойдёт при первом же действии пользователя
    // (или при beforeunload/pagehide перед следующим refresh).
})();


(function () {
    'use strict';

    const STATE_KEY = 'wizardState.v1';
    const SAVE_THROTTLE_MS = 1500;


    const LIGHT_KEYS = [
        'sessionId',
        'uploadedFiles',
        'processedFiles',
        'sheetSelections',          
        'questionMapping',
        'questionMerges',
        'questionSourceFile',
        'reportSections',
        'exportTask',               
    ];
    const HEAVY_KEYS = [
        'appData',
        'exportResult',   
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

    ['click', 'change', 'input', 'keyup'].forEach(ev => {
        document.addEventListener(ev, scheduleSave, { passive: true, capture: true });
    });


    window.addEventListener('beforeunload', saveStateNow);
    window.addEventListener('pagehide', saveStateNow);

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


        if (window.uploadedFiles && window.uploadedFiles.length
            && typeof window.rehydrateUploadUI === 'function')
        {
            try { window.rehydrateUploadUI(); }
            catch (e) { console.error('[state] rehydrateUploadUI failed', e); }
        }

        if (window.uploadedFiles && window.uploadedFiles.length
            && typeof window.rehydrateSheetsUI === 'function')
        {
            try { window.rehydrateSheetsUI(); }
            catch (e) { console.error('[state] rehydrateSheetsUI failed', e); }
        }


        if (window.processedFiles && window.processedFiles.length
            && typeof window.rehydrateQuestionsUI === 'function')
        {
            try { window.rehydrateQuestionsUI(); }
            catch (e) { console.error('[state] rehydrateQuestionsUI failed', e); }
        }


        if (typeof window.renderStep4 === 'function'
            && window.processedFiles && window.processedFiles.length)
        {
            try { window.renderStep4(); }
            catch (e) { console.error('[state] renderStep4 failed', e); }
        }

        // Легенда файлов на шаге 5 — восстанавливаем при нескольких файлах.
        if (window.processedFiles && window.processedFiles.length > 1
            && typeof renderLegendSettings === 'function')
        {
            const _rl_labels = {};
            const _rl_colors = {};
            if (window.appData) {
                const _rl_entry = Object.values(window.appData).find(e => e && e.file_labels);
                if (_rl_entry) {
                    Object.assign(_rl_labels, _rl_entry.file_labels);
                    Object.assign(_rl_colors, _rl_entry.file_colors || {});
                }
            }
            try { renderLegendSettings(_rl_labels, _rl_colors); }
            catch (e) { console.error('[state] renderLegendSettings failed', e); }
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


        if (window.exportTask
            && window.exportTask.task_id
            && typeof window.resumeExportTask === 'function')
        {
            try { window.resumeExportTask(window.exportTask.task_id); }
            catch (e) { console.error('[state] resumeExportTask failed', e); }
        }


        if (target > 0 && typeof goToStep === 'function') {
            goToStep(target, { instant: true });
        }

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

})();

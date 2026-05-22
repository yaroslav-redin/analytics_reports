// ===================== WIZARD NAVIGATION =====================
const _WIZARD_STEPS_COUNT = 6;   // шаги 0..5
let currentWizardStep = 0;



function _stepFromHash() {
    
    const m = (window.location.hash || '').match(/^#step(\d+)$/);
    if (!m) return null;
    const parsed = parseInt(m[1], 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > _WIZARD_STEPS_COUNT) return null;
    return parsed - 1;
}

function _writeStepToHash(n) {

    try {
        const newHash = `#step${n + 1}`;   
        if (window.location.hash !== newHash) {
            window.history.replaceState(null, '', newHash);
        }
    } catch (e) {

    }
}

function _onDomReady(fn) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
        fn();
    }
}

function goToStep(n, opts) {
    opts = opts || {};
    const track = document.getElementById('wizardTrack');
    if (!track) return;

    if (opts.instant) {
        track.style.transition = 'none';
    }

    track.style.transform = `translateX(-${n * 100}%)`;

    if (opts.instant) {
        void track.offsetWidth;
        track.style.transition = '';
    }

    currentWizardStep = n;
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === n);
        dot.classList.toggle('done', i < n);
    });
    const stepEl = document.getElementById(`wizardStep${n}`);
    if (stepEl) stepEl.scrollTop = 0;
    document.getElementById('navBackBtn').classList.toggle('invisible', n === 0);
    document.querySelectorAll('.nav-step-fwd').forEach(el => {
        el.classList.toggle('d-none', parseInt(el.dataset.fwdStep) !== n);
    });
    // Синхронизируем URL — refresh после этого вернёт пользователя сюда же.
    _writeStepToHash(n);
}

_onDomReady(() => {
    if (window._wizardState && typeof window._wizardState.restore === 'function') {
        try {
            window._wizardState.restore();
            return;
        } catch (e) {
            console.error('[wizard] restoreState failed, falling back to hash-only nav', e);
        }
    }

    const target = _stepFromHash();
    if (target !== null && target !== currentWizardStep) {
        goToStep(target, { instant: true });
    }
    document.documentElement.classList.remove('wizard-restoring');
});

window.addEventListener('hashchange', () => {
    const target = _stepFromHash();
    if (target !== null && target !== currentWizardStep) {
        goToStep(target);
    }
});

function updateUploadBtn() {
    const f = document.getElementById('excelFile');
    document.getElementById('uploadBtn').disabled = !f || !f.files.length;
}

function updateSheetBtn() {
    document.getElementById('processSheetsBtn').disabled = document.querySelectorAll('.sheet-checkbox:checked').length === 0;
}

function updateQuestionsBtn() {
    const hasQ = document.querySelectorAll('#sortableQuestionsList .question-item').length > 0;
    document.getElementById('toStep4Btn').disabled = !hasQ;
}

function updateStep6Btn() {
    const hasData = window.appData && Object.keys(window.appData).length > 0;
    document.getElementById('toStep6Btn').disabled = !hasData;
}

function initTooltips() {
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (t) { return new bootstrap.Tooltip(t); });
}

// Step navigation buttons
document.getElementById('toStep4Btn').addEventListener('click', () => { goToStep(3); renderStep4(); });
document.getElementById('toStep5Btn').addEventListener('click', () => { renderLegendSettings(); goToStep(4); });
document.getElementById('toStep6Btn').addEventListener('click', () => goToStep(5));

function _resetFromStep(newStep) {
    if (newStep < 4) {
        Object.values(window.charts || {}).forEach(c => { try { c.destroy(); } catch (e) {} });
        window.charts = {};
        window.appData = {};
        window.chartsData = {};
        window.stackedChartsData = {};
        window.pieChartsData = {};
        window.renderedTabs = {};
        document.getElementById('reportContent').innerHTML = '';
        updateStep6Btn();
    }

    if (newStep < 3) {
        window.reportSections = [];
        document.getElementById('sectionsList').innerHTML = '<p class="text-muted small text-center mt-3 px-2 mb-0"></p>';
        document.getElementById('availableQuestionsList').innerHTML = '<p class="text-muted small text-center mt-2 mb-0">Выберите вопросы на шаге 3</p>';
        const selAllQ = document.getElementById('selectAllAvailableQ');
        if (selAllQ) selAllQ.checked = false;
    }

    if (newStep < 2) {
        window.questionMapping = {};
        window.questionSourceFile = {};
        window.questionMerges = {};
        document.getElementById('sortableQuestionsList').innerHTML = '<div id="emptySortablePlaceholder"></div>';
        document.getElementById('allQuestionsList').innerHTML = '';
        document.getElementById('selectAllQuestions').checked = false;
        document.getElementById('questionsSearchInput').value = '';
        const fileSelect = document.getElementById('fileSelectStep3');
        if (fileSelect) fileSelect.innerHTML = '';
        document.getElementById('fileSelectContainer').style.display = 'none';
        updateQuestionsBtn();
    }

    if (newStep < 1) {
        window.processedFiles = [];
        document.getElementById('sheetCheckboxesContainer').innerHTML = '';
        updateSheetBtn();
    }
}

// Back button (global delegation)
document.addEventListener('click', e => {
    if (e.target.closest('.wizard-back-btn')) {
        if (currentWizardStep > 0) {
            const newStep = currentWizardStep - 1;
            _resetFromStep(newStep);
            goToStep(newStep);
            if (newStep === 3) renderStep4();
        }
    }
});

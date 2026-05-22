// ===================== WIZARD NAVIGATION =====================
const _WIZARD_STEPS_COUNT = 6;   // шаги 0..5
let currentWizardStep = 0;



function _stepFromHash() {
    // URL — 1-индексный (#step1..#step6, как в UI), внутреннее представление 0..5.
    const m = (window.location.hash || '').match(/^#step(\d+)$/);
    if (!m) return null;
    const parsed = parseInt(m[1], 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > _WIZARD_STEPS_COUNT) return null;
    return parsed - 1;
}

function _writeStepToHash(n) {
    // replaceState — без добавления в history-стек браузера, чтобы кнопка «Назад»
    // браузера не начала листать шаги визарда (current behavior preserved).
    // Бонус: replaceState не вызывает hashchange — handler ниже не зацикливается.
    try {
        const newHash = `#step${n + 1}`;   // +1, чтобы URL совпадал с нумерацией UI
        if (window.location.hash !== newHash) {
            window.history.replaceState(null, '', newHash);
        }
    } catch (e) {
        // Например, под file:// история бывает ограничена — просто игнорируем.
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

    // При восстановлении после refresh не хотим листать промежуточные шаги
    // под 450ms-анимацию. Опция {instant:true} — мгновенный переход.
    if (opts.instant) {
        track.style.transition = 'none';
    }

    track.style.transform = `translateX(-${n * 100}%)`;

    if (opts.instant) {
        // Форсим reflow, чтобы браузер применил transform без анимации,
        // а уже потом вернулся к нормальному transition из CSS.
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

// На загрузке: восстанавливаем сохранённое состояние и навигируем на нужный
// шаг. restoreState (из state.js) делает всё это в правильном порядке:
//   1) грузит window.* из sessionStorage,
//   2) выбирает целевой шаг (URL hash > сохранённый currentStep > 0),
//   3) рехидрирует визуализацию (шаг 5) и баннер «Скачать снова» (шаг 6),
//   4) вызывает goToStep(target).
// Если state.js по какой-то причине не загрузился — fallback на простую
// hash-навигацию.
_onDomReady(() => {
    if (window._wizardState && typeof window._wizardState.restore === 'function') {
        try {
            window._wizardState.restore();
            return;
        } catch (e) {
            console.error('[wizard] restoreState failed, falling back to hash-only nav', e);
        }
    }
    // Fallback: просто навигация по URL hash. Тоже без анимации —
    // это первичная установка позиции, а не штатный переход.
    const target = _stepFromHash();
    if (target !== null && target !== currentWizardStep) {
        goToStep(target, { instant: true });
    }
    // Снимаем класс, который мог поставить inline-скрипт в <head>.
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
    // Шаг 4 (визуализация): уничтожить графики, очистить данные анализа
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

    // Шаг 3 (структура отчёта): очистить разделы
    if (newStep < 3) {
        window.reportSections = [];
        document.getElementById('sectionsList').innerHTML = '<p class="text-muted small text-center mt-3 px-2 mb-0"></p>';
        document.getElementById('availableQuestionsList').innerHTML = '<p class="text-muted small text-center mt-2 mb-0">Выберите вопросы на шаге 3</p>';
        const selAllQ = document.getElementById('selectAllAvailableQ');
        if (selAllQ) selAllQ.checked = false;
    }

    // Шаг 2 (выбор вопросов): очистить маппинг и списки
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

    // Шаг 1 (листы): очистить обработанные файлы и список листов
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

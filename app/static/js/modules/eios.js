// ===================== ИСТОЧНИК ДАННЫХ: ЭИОС =====================
window.dataSource = window.dataSource || 'files';
// { surveys: [{id, title}], cohorts: [{profile_id, label, filters}] } — сохраняется в sessionStorage.
window.eiosSelection = window.eiosSelection || null;
// Справочники выбранных опросов по profile_id — не сохраняются в sessionStorage, грузятся заново.
window.eiosMetaByProfile = {};

const EIOS_MAX_COHORTS = 6;
const EIOS_MAX_SURVEYS = EIOS_MAX_COHORTS;   // у каждого опроса минимум одна когорта
const EIOS_MAX_CONDITIONS = 3;
const EIOS_AUDIENCES = {
    0: 'Студенты',
    1: 'Преподаватели по своим дисциплинам',
    2: 'Преподаватели по месту работы',
    3: 'Все',
};
// Типы вопросов, по которым можно задавать условия среза (3 — «соответствие» — не поддерживается ЭИОС).
const EIOS_CONDITION_TYPES = new Set([0, 1, 2, 4, 10]);
// Уровни FilterTree: поле запроса, id селекта и имя массива дочерних узлов.
const EIOS_TREE_LEVELS = [
    { key: 'SchoolYear',     el: 'ecYear',           children: 'Faculties' },
    { key: 'Faculty',        el: 'ecFaculty',        children: 'EducationForms' },
    { key: 'EducationForm',  el: 'ecForm',           children: 'EducationLevels' },
    { key: 'EducationLevel', el: 'ecLevel',          children: 'Specialities' },
    { key: 'Speciality',     el: 'ecSpeciality',     children: 'Specializations' },
    { key: 'Specialization', el: 'ecSpecialization', children: null },
];

let _eiosReportsLoaded = false;
// Опросы, справочник которых не загрузился при восстановлении: отметку и когорты сохраняем.
const _eiosMetaFailed = new Set();

async function _eiosFetchJson(url, opts) {
    try {
        const resp = await fetch(url, opts);
        const data = await resp.json().catch(() => ({}));
        return { ok: resp.ok, status: resp.status, data };
    } catch (e) {
        return { ok: false, status: 0, data: { message: 'Ошибка соединения с сервером' } };
    }
}

function _eiosNeedsLogin(r) {
    return r.status === 401 || r.data.code === 'need_consent' || r.data.code === 'auth_required';
}

function _eiosReloginHtml(message) {
    return `${_escHtml(message || 'Нужно заново войти через ЭИОС и разрешить доступ к отчётам опросов.')}
        <div class="mt-2"><a class="btn btn-sm btn-primary" href="/auth/login?reconsent=1">
            <i class="fa-solid fa-right-to-bracket me-1"></i>Войти заново</a></div>`;
}

function _eiosShowAlert(kind, html) {
    const el = document.getElementById('eiosSurveyAlert');
    el.className = `alert alert-${kind} small`;
    el.innerHTML = html;
}

function _eiosToggle(id, hidden) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('d-none', hidden);
}

function applyDataSourceUI() {
    const isEios = window.dataSource === 'eios';
    document.getElementById('dsEios').checked = isEios;
    document.getElementById('dsFiles').checked = !isEios;
    _eiosToggle('filesSourcePane', isEios);
    _eiosToggle('eiosSourcePane', !isEios);
    _eiosToggle('uploadBtn', isEios);
    _eiosToggle('eiosToCohortsBtn', !isEios);
    _eiosToggle('sheetsPane', isEios);
    _eiosToggle('eiosCohortsPane', !isEios);
    _eiosToggle('processSheetsBtn', isEios);
    _eiosToggle('eiosBuildBtn', !isEios);
    const title = document.getElementById('step1Title');
    if (title) title.textContent = isEios ? 'Настройте выборку респондентов' : 'Выберите листы для анализа';
    if (isEios && !_eiosReportsLoaded) loadEiosReports();
}

async function loadEiosReports() {
    const loading = document.getElementById('eiosSurveyLoading');
    const alertEl = document.getElementById('eiosSurveyAlert');
    const block = document.getElementById('eiosSurveyBlock');
    loading.classList.remove('d-none');
    alertEl.classList.add('d-none');
    block.classList.add('d-none');

    const r = await _eiosFetchJson('/eios/reports');
    loading.classList.add('d-none');
    if (!r.ok) {
        if (_eiosNeedsLogin(r)) _eiosShowAlert('warning', _eiosReloginHtml(r.data.message));
        else _eiosShowAlert('danger', _escHtml(r.data.message || 'Не удалось получить список опросов из ЭИОС'));
        return;
    }
    _eiosReportsLoaded = true;
    const reports = r.data.reports || [];
    if (!reports.length) {
        _eiosShowAlert('info', 'Вам пока не выдан доступ ни к одному отчёту опроса. '
            + 'Попросите доступ у владельца опроса — обычно это преподаватель, создавший анкету.');
        return;
    }

    const list = document.getElementById('eiosSurveyList');
    list.innerHTML = '';
    document.getElementById('eiosSurveySearch').value = '';
    const inner = document.createElement('div');
    inner.style.cssText = 'width:max-content;min-width:100%';
    reports.forEach(rep => {
        const cbId = `eios_survey_${rep.id}`;
        const item = document.createElement('div');
        item.className = 'list-group-item d-flex align-items-center gap-2 py-2 eios-survey-item';
        item.dataset.name = rep.name;
        const cb = document.createElement('input');
        cb.className = 'form-check-input flex-shrink-0 eios-survey-cb';
        cb.type = 'checkbox';
        cb.id = cbId;
        cb.value = String(rep.id);
        cb.dataset.summable = rep.is_summable ? '1' : '0';
        const label = document.createElement('label');
        label.className = 'form-check-label fw-medium text-body text-nowrap cursor-pointer';
        label.htmlFor = cbId;
        label.title = rep.name;
        label.textContent = rep.name;
        item.append(cb, label);
        inner.appendChild(item);
    });
    list.appendChild(inner);
    block.classList.remove('d-none');

    const sel = _eiosNormalizeSelection(window.eiosSelection);
    if (sel) {
        // Опросы, к которым пропал доступ, убираем вместе с их когортами.
        const lost = sel.surveys.filter(s => !list.querySelector(`.eios-survey-cb[value="${s.id}"]`));
        lost.forEach(s => _eiosRemoveSurvey(s.id));
        if (lost.length) _eiosSelectionChanged();
        sel.surveys.forEach(s => {
            list.querySelector(`.eios-survey-cb[value="${s.id}"]`).checked = true;
            _eiosLoadMeta(s.id, false);
        });
    }
    if ((!sel || !sel.surveys.length) && reports.length === 1) {
        const only = list.querySelector('.eios-survey-cb');
        only.checked = true;
        _eiosToggleSurvey(only);
    }
    _eiosUpdateSurveyUI();
}

// Старый формат состояния (один опрос): { profileId, title, cohorts } → { surveys, cohorts }.
function _eiosNormalizeSelection(sel) {
    if (sel && sel.profileId !== undefined) {
        sel = {
            surveys: [{ id: sel.profileId, title: sel.title }],
            cohorts: (sel.cohorts || []).map(c => ({ ...c, profile_id: sel.profileId })),
        };
    }
    window.eiosSelection = sel || null;
    return window.eiosSelection;
}

function _eiosSurveyTitle(id) {
    const s = window.eiosSelection && window.eiosSelection.surveys.find(x => x.id === id);
    return s ? s.title : `Опрос ${id}`;
}

function _eiosAllMetaLoaded() {
    const sel = window.eiosSelection;
    return !!sel && sel.surveys.every(s => window.eiosMetaByProfile[s.id]);
}

// Опросов можно отметить несколько (до EIOS_MAX_SURVEYS); снятие отметки убирает опрос и его когорты.
function _eiosToggleSurvey(cb) {
    const id = parseInt(cb.value, 10);
    if (!cb.checked) {
        _eiosRemoveSurvey(id);
        _eiosSelectionChanged();
        return;
    }
    if (!window.eiosSelection) window.eiosSelection = { surveys: [], cohorts: [] };
    if (!window.eiosSelection.surveys.some(s => s.id === id)) {
        window.eiosSelection.surveys.push({ id, title: cb.closest('.eios-survey-item').dataset.name });
    }
    _eiosUpdateSurveyUI();
    _eiosLoadMeta(id, true);
}

function _eiosRemoveSurvey(id) {
    const sel = window.eiosSelection;
    delete window.eiosMetaByProfile[id];
    _eiosMetaFailed.delete(id);
    if (!sel) return;
    sel.surveys = sel.surveys.filter(s => s.id !== id);
    sel.cohorts = sel.cohorts.filter(c => c.profile_id !== id);
}

// После удаления опросов/когорт: открытый редактор держит устаревший индекс, карточки — устаревшие data-idx.
function _eiosSelectionChanged() {
    _eiosCloseEditor();
    if (window.dataSource === 'eios') renderEiosCohorts();
    _eiosUpdateSurveyUI();
}

function _eiosUpdateSurveyUI() {
    const sel = window.eiosSelection;
    const count = sel ? sel.surveys.length : 0;
    document.querySelectorAll('#eiosSurveyList .eios-survey-cb').forEach(cb => {
        cb.disabled = !cb.checked && count >= EIOS_MAX_SURVEYS;
    });
    document.getElementById('eiosToCohortsBtn').disabled = !count || !_eiosAllMetaLoaded();
    const info = document.getElementById('eiosSurveyInfo');
    if (!count) { info.textContent = ''; return; }
    const failed = sel.surveys.filter(s => _eiosMetaFailed.has(s.id));
    if (failed.length) {
        info.textContent = `Не удалось загрузить справочник: ${failed.map(s => s.title).join(', ')}. `
            + 'Обновите страницу, чтобы повторить.';
        return;
    }
    if (!_eiosAllMetaLoaded()) { info.textContent = 'Загрузка справочника опроса…'; return; }
    if (count > 1) { info.textContent = `Выбрано опросов: ${count}`; return; }
    const meta = window.eiosMetaByProfile[sel.surveys[0].id];
    const parts = [`Вопросов в анкете: ${(meta.Questions || []).length}`];
    if (meta.TeacherUser && meta.TeacherUser.FIO) parts.push(`Оценивается преподаватель: ${meta.TeacherUser.FIO}`);
    if (!meta.IsSummable) parts.push('опрос без сводной таблицы');
    info.textContent = parts.join(' · ');
}

function _eiosFilterSurveys() {
    const query = document.getElementById('eiosSurveySearch').value.trim().toLowerCase();
    document.querySelectorAll('#eiosSurveyList .eios-survey-item').forEach(item => {
        item.classList.toggle('q-filtered', !!query && !item.dataset.name.toLowerCase().includes(query));
    });
}

// fromUser — опрос только что отметил пользователь; иначе — восстановление сохранённого выбора.
async function _eiosLoadMeta(profileId, fromUser) {
    _eiosMetaFailed.delete(profileId);
    const r = await _eiosFetchJson(`/eios/metadata/${profileId}`);
    // Пока шёл запрос, пользователь мог снять отметку с опроса.
    if (!window.eiosSelection || !window.eiosSelection.surveys.some(s => s.id === profileId)) return false;
    if (!r.ok) {
        if (fromUser) {
            // Только что отмеченный опрос без справочника не настроить — снимаем отметку.
            _eiosRemoveSurvey(profileId);
            const cb = document.querySelector(`#eiosSurveyList .eios-survey-cb[value="${profileId}"]`);
            if (cb) cb.checked = false;
            _eiosSelectionChanged();
        } else {
            // При восстановлении не теряем настроенные когорты из-за временной ошибки ЭИОС.
            _eiosMetaFailed.add(profileId);
            _eiosUpdateSurveyUI();
        }
        if (_eiosNeedsLogin(r)) _eiosShowAlert('warning', _eiosReloginHtml(r.data.message));
        else showToast(_escHtml(r.data.message || 'Не удалось загрузить справочник опроса'), 'danger');
        return false;
    }
    window.eiosMetaByProfile[profileId] = r.data;
    _eiosUpdateSurveyUI();
    return true;
}

document.querySelectorAll('input[name="dataSource"]').forEach(radio => {
    radio.addEventListener('change', e => {
        window.dataSource = e.target.value;
        applyDataSourceUI();
    });
});

const _eiosSurveyList = document.getElementById('eiosSurveyList');
_eiosSurveyList.addEventListener('change', e => {
    if (!e.target.classList.contains('eios-survey-cb')) return;
    _eiosToggleSurvey(e.target);
});
// Клик по строке (мимо чекбокса и подписи) тоже переключает опрос — как в списке вопросов.
_eiosSurveyList.addEventListener('click', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
    const cb = e.target.closest('.eios-survey-item')?.querySelector('.eios-survey-cb');
    if (cb) cb.click();
});
document.getElementById('eiosSurveySearch').addEventListener('input', _eiosFilterSurveys);
document.getElementById('eiosSurveySearchClear').addEventListener('click', () => {
    document.getElementById('eiosSurveySearch').value = '';
    _eiosFilterSurveys();
});

// ===================== ШАГ 2 (ЭИОС): КОГОРТЫ =====================
let _eiosEditingIdx = null;   // индекс редактируемой когорты; null — новая

function _eiosMultiSurvey() {
    return !!window.eiosSelection && window.eiosSelection.surveys.length > 1;
}

// Справочник опроса, выбранного в редакторе когорты.
function _eiosEditorMeta() {
    return window.eiosMetaByProfile[parseInt(document.getElementById('ecSurvey').value, 10)] || {};
}

function _eiosFillSelect(sel, items, selected, emptyLabel) {
    sel.innerHTML = '';
    if (emptyLabel !== null) sel.appendChild(new Option(emptyLabel, ''));
    items.forEach(it => sel.appendChild(new Option(it.text, it.value)));
    sel.value = selected || '';
    if (sel.value !== (selected || '')) sel.value = '';
}

function _eiosFillMulti(id, items, selected) {
    const $sel = $('#' + id);
    const chosen = selected || [];
    $sel.empty();
    items.forEach(it => $sel.append(new Option(it.text, it.value, false, chosen.includes(it.value))));
    $sel.trigger('change');
}

function _eiosNodesAt(level, values) {
    let nodes = _eiosEditorMeta().FilterTree || [];
    for (let i = 0; i < level; i++) {
        const node = nodes.find(n => n.Name === values[i]);
        if (!node) return [];
        nodes = node[EIOS_TREE_LEVELS[i].children] || [];
    }
    return nodes;
}

function _eiosGroupsFor(values) {
    // Группы — после выбора специальности: у специальности — объединение всех её планов,
    // у специализации — только её группы (см. раздел 3.2 руководства ЭИОС).
    if (!values[4]) return null;
    const spec = _eiosNodesAt(4, values).find(n => n.Name === values[4]);
    if (!spec) return null;
    if (values[5]) {
        const sz = (spec.Specializations || []).find(n => n.Name === values[5]);
        return sz ? (sz.Groups || []) : [];
    }
    return spec.Groups || [];
}

function _eiosRenderTree(values, selectedGroups) {
    const current = [...values];
    EIOS_TREE_LEVELS.forEach((lvl, i) => {
        const sel = document.getElementById(lvl.el);
        const parentMissing = i > 0 && !current[i - 1];
        const nodes = parentMissing ? [] : _eiosNodesAt(i, current);
        _eiosFillSelect(sel, nodes.map(n => ({ value: n.Name, text: n.Name })), current[i], '— любой —');
        sel.disabled = parentMissing || nodes.length === 0;
        current[i] = sel.value;
    });
    const groups = _eiosGroupsFor(current);
    _eiosFillMulti('ecGroups', (groups || []).map(g => ({ value: g, text: g })), selectedGroups);
    $('#ecGroups').prop('disabled', groups === null);
    document.getElementById('ecGroupsHint').classList.toggle('d-none', groups !== null);
}

function _eiosFillDepartments(selected) {
    const sel = document.getElementById('ecDepartment');
    sel.innerHTML = '';
    sel.appendChild(new Option('— любая —', ''));
    (_eiosEditorMeta().TeacherFilterTree || []).forEach(fac => {
        const og = document.createElement('optgroup');
        og.label = fac.Name;
        (fac.Departments || []).forEach(d => og.appendChild(new Option(d, d)));
        sel.appendChild(og);
    });
    sel.value = selected || '';
}

function _eiosToggleTeacherBlock() {
    const isWorkplace = document.getElementById('ecAudience').value === '2';
    document.getElementById('ecTeacherBlock').classList.toggle('d-none', !isWorkplace);
}

function _eiosQuestionById(id) {
    return (_eiosEditorMeta().Questions || []).find(q => q.QuestionId === id);
}

function _eiosUpdateConditionBtn() {
    const count = document.querySelectorAll('#ecConditions .ec-condition').length;
    document.getElementById('ecAddCondition').disabled = count >= EIOS_MAX_CONDITIONS;
}

function _eiosRenderCriteria(row, cond) {
    const q = _eiosQuestionById(parseInt(row.querySelector('.ec-cond-question').value, 10));
    const box = row.querySelector('.ec-cond-criteria');
    box.innerHTML = '';
    if (!q) return;
    if (q.QuestionType === 10) {
        const max = q.MaxStars || 5;
        box.innerHTML = `<div class="d-flex align-items-center gap-2 small flex-wrap">
            <span>Оценка от</span><input type="number" class="form-control form-control-sm ec-cond-stars-from" min="0" max="${max}" style="width:5rem">
            <span>до</span><input type="number" class="form-control form-control-sm ec-cond-stars-to" min="0" max="${max}" style="width:5rem">
            <span class="text-muted">(максимум ${max})</span></div>`;
        box.querySelector('.ec-cond-stars-from').value = (cond && cond.StarsFrom != null) ? cond.StarsFrom : '';
        box.querySelector('.ec-cond-stars-to').value = (cond && cond.StarsTo != null) ? cond.StarsTo : '';
    } else if (q.QuestionType === 4) {
        box.innerHTML = '<input type="text" class="form-control form-control-sm ec-cond-text" placeholder="Точный текст ответа (регистр не важен)">';
        box.querySelector('.ec-cond-text').value = (cond && cond.TextEquals) || '';
    } else {
        const chosen = (cond && cond.AnswerOptionIds) || [];
        const sel = document.createElement('select');
        sel.className = 'form-select form-select-sm ec-cond-answers';
        sel.multiple = true;
        sel.size = Math.min(6, Math.max(2, (q.Answers || []).length));
        (q.Answers || []).forEach(a => sel.appendChild(new Option(a.Text, String(a.Id), false, chosen.includes(a.Id))));
        box.appendChild(sel);
        box.insertAdjacentHTML('beforeend', '<div class="form-text">Ctrl+клик — выбрать несколько вариантов</div>');
    }
}

function _eiosAddConditionRow(cond) {
    const box = document.getElementById('ecConditions');
    if (box.querySelectorAll('.ec-condition').length >= EIOS_MAX_CONDITIONS) return;
    const row = document.createElement('div');
    row.className = 'ec-condition border rounded p-2 mb-2';
    row.innerHTML = `
        <div class="d-flex gap-2 mb-2">
            <select class="form-select form-select-sm ec-cond-question"></select>
            <button type="button" class="btn btn-sm btn-outline-danger ec-cond-remove" title="Удалить условие"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="ec-cond-criteria"></div>`;
    const questions = (_eiosEditorMeta().Questions || []).filter(q => EIOS_CONDITION_TYPES.has(q.QuestionType));
    _eiosFillSelect(row.querySelector('.ec-cond-question'),
        questions.map(q => ({ value: String(q.QuestionId), text: q.Text })),
        cond ? String(cond.QuestionId) : (questions[0] ? String(questions[0].QuestionId) : ''), null);
    box.appendChild(row);
    _eiosRenderCriteria(row, cond);
    _eiosUpdateConditionBtn();
}

function _eiosCollectConditions() {
    const out = [];
    for (const row of document.querySelectorAll('#ecConditions .ec-condition')) {
        const qid = parseInt(row.querySelector('.ec-cond-question').value, 10);
        const q = _eiosQuestionById(qid);
        if (!q) continue;
        const cond = { QuestionId: qid };
        if (q.QuestionType === 10) {
            const from = row.querySelector('.ec-cond-stars-from').value;
            const to = row.querySelector('.ec-cond-stars-to').value;
            if (from !== '') cond.StarsFrom = parseInt(from, 10);
            if (to !== '') cond.StarsTo = parseInt(to, 10);
        } else if (q.QuestionType === 4) {
            const text = row.querySelector('.ec-cond-text').value.trim();
            if (text) cond.TextEquals = text;
        } else {
            const ids = Array.from(row.querySelector('.ec-cond-answers').selectedOptions).map(o => parseInt(o.value, 10));
            if (ids.length) cond.AnswerOptionIds = ids;
        }
        if (Object.keys(cond).length === 1) {
            showToast(`Задайте критерий для условия «${_escHtml(q.Text)}»`, 'warning');
            return null;
        }
        out.push(cond);
    }
    return out;
}

function _eiosCollectFilters(conditions) {
    const f = { Audience: parseInt(document.getElementById('ecAudience').value, 10) };
    EIOS_TREE_LEVELS.forEach(l => { f[l.key] = document.getElementById(l.el).value || null; });
    f.Groups = $('#ecGroups').val() || [];
    f.ChildProfiles = $('#ecChildProfiles').val() || [];
    f.Regions = $('#ecRegions').val() || [];
    f.Citizenships = $('#ecCitizenships').val() || [];
    if (f.Audience === 2) {
        const pps = document.getElementById('ecIsPps').value;
        f.IsPps = pps === '' ? null : pps === 'true';
        f.Department = document.getElementById('ecDepartment').value || null;
        f.AcademicDegrees = $('#ecDegrees').val() || [];
    }
    const ageFrom = document.getElementById('ecAgeFrom').value;
    const ageTo = document.getElementById('ecAgeTo').value;
    f.AgeFrom = ageFrom === '' ? null : parseInt(ageFrom, 10);
    f.AgeTo = ageTo === '' ? null : parseInt(ageTo, 10);
    f.Conditions = conditions;
    return f;
}

function _eiosDefaultLabel(f, profileId) {
    const parts = [];
    if (f.Audience !== 0) parts.push(EIOS_AUDIENCES[f.Audience]);
    if (f.SchoolYear) parts.push(f.SchoolYear);
    const deepest = [...EIOS_TREE_LEVELS].reverse().find(l => l.key !== 'SchoolYear' && f[l.key]);
    if (deepest) parts.push(f[deepest.key]);
    if (f.Groups && f.Groups.length) parts.push(`гр. ${f.Groups.join(', ')}`);
    if (f.Conditions && f.Conditions.length) parts.push(`срез: ${f.Conditions.length}`);
    // При нескольких опросах подпись начинается с названия опроса — иначе серии в легенде не различить.
    if (_eiosMultiSurvey()) return [_eiosSurveyTitle(profileId), ...parts].join(' · ');
    return parts.join(' · ') || 'Все респонденты';
}

function _eiosFilterSummary(f) {
    const parts = [EIOS_AUDIENCES[f.Audience] || ''];
    const path = EIOS_TREE_LEVELS.map(l => f[l.key]).filter(Boolean);
    if (path.length) parts.push(path.join(' → '));
    if (f.Groups && f.Groups.length) parts.push(`группы: ${f.Groups.join(', ')}`);
    if (f.ChildProfiles && f.ChildProfiles.length) parts.push(`дисциплин: ${f.ChildProfiles.length}`);
    if (f.Regions && f.Regions.length) parts.push(`регионов: ${f.Regions.length}`);
    if (f.Citizenships && f.Citizenships.length) parts.push(`гражданств: ${f.Citizenships.length}`);
    if (f.Department) parts.push(f.Department);
    if (f.AgeFrom != null || f.AgeTo != null) parts.push(`возраст ${f.AgeFrom ?? '…'}–${f.AgeTo ?? '…'}`);
    if (f.Conditions && f.Conditions.length) parts.push(`условий среза: ${f.Conditions.length}`);
    return parts.filter(Boolean).join(' · ');
}

function renderEiosCohorts() {
    const sel = window.eiosSelection;
    const list = document.getElementById('eiosCohortList');
    document.getElementById('eiosCohortsSurveyTitle').textContent = sel ? sel.surveys.map(s => s.title).join(', ') : '';
    const cohorts = sel ? sel.cohorts : [];
    list.innerHTML = cohorts.length ? '' : '<p class="text-muted small mb-2">Добавьте хотя бы одну когорту. '
        + 'Несколько когорт сравниваются между собой так же, как несколько файлов.</p>';
    cohorts.forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'd-flex align-items-start gap-2 border rounded p-2 mb-2';
        card.innerHTML = `
            <div class="flex-grow-1" style="min-width:0">
                <div class="small text-muted text-truncate eios-cohort-survey"></div>
                <div class="fw-semibold text-truncate eios-cohort-label"></div>
                <div class="small text-muted eios-cohort-summary"></div>
            </div>
            <button type="button" class="btn btn-sm btn-outline-secondary eios-cohort-edit" title="Изменить"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="btn btn-sm btn-outline-danger eios-cohort-delete" title="Удалить"><i class="fa-solid fa-trash"></i></button>`;
        const surveyEl = card.querySelector('.eios-cohort-survey');
        if (_eiosMultiSurvey()) surveyEl.textContent = _eiosSurveyTitle(c.profile_id);
        else surveyEl.remove();
        card.querySelector('.eios-cohort-label').textContent = c.label;
        card.querySelector('.eios-cohort-summary').textContent = _eiosFilterSummary(c.filters);
        card.querySelector('.eios-cohort-edit').dataset.idx = i;
        card.querySelector('.eios-cohort-delete').dataset.idx = i;
        list.appendChild(card);
    });
    document.getElementById('eiosAddCohortBtn').disabled = cohorts.length >= EIOS_MAX_COHORTS;
    document.getElementById('eiosBuildBtn').disabled = !cohorts.length;
}

// Справочные поля редактора — из справочника опроса, выбранного в #ecSurvey.
function _eiosFillEditorRefs(f) {
    const meta = _eiosEditorMeta();
    _eiosRenderTree(EIOS_TREE_LEVELS.map(l => f[l.key] || ''), f.Groups);
    _eiosFillMulti('ecChildProfiles', (meta.ChildProfiles || []).map(p => ({ value: String(p.Id), text: p.Text })), f.ChildProfiles);
    document.getElementById('ecChildProfilesBlock').classList.toggle('d-none', !(meta.ChildProfiles || []).length);
    _eiosFillMulti('ecRegions', (meta.Regions || []).map(r => ({ value: r, text: r })), f.Regions);
    _eiosFillMulti('ecCitizenships', (meta.Citizenships || []).map(c => ({ value: c, text: c })), f.Citizenships);
    _eiosFillMulti('ecDegrees', (meta.AcademicDegrees || []).map(d => ({ value: d, text: d })), f.AcademicDegrees);
    _eiosFillDepartments(f.Department);
    document.getElementById('ecConditions').innerHTML = '';
    (f.Conditions || []).forEach(c => _eiosAddConditionRow(c));
    _eiosUpdateConditionBtn();
}

function openEiosCohortEditor(idx) {
    const sel = window.eiosSelection;
    if (!sel || !sel.surveys.length || !_eiosAllMetaLoaded()) {
        showToast('Справочник опроса ещё не загружен — выберите опрос на шаге 1', 'warning');
        return;
    }
    _eiosEditingIdx = idx;
    const cohort = idx === null ? null : sel.cohorts[idx];
    const f = cohort ? cohort.filters : { Audience: 0 };

    const surveySel = document.getElementById('ecSurvey');
    _eiosFillSelect(surveySel, sel.surveys.map(s => ({ value: String(s.id), text: s.title })),
        String(cohort ? cohort.profile_id : sel.surveys[0].id), null);
    document.getElementById('ecSurveyBlock').classList.toggle('d-none', !_eiosMultiSurvey());

    document.getElementById('ecLabel').value = cohort ? cohort.label : '';
    document.getElementById('ecAudience').value = String(f.Audience || 0);
    _eiosFillEditorRefs(f);
    document.getElementById('ecIsPps').value = f.IsPps === true ? 'true' : (f.IsPps === false ? 'false' : '');
    document.getElementById('ecAgeFrom').value = f.AgeFrom ?? '';
    document.getElementById('ecAgeTo').value = f.AgeTo ?? '';
    _eiosToggleTeacherBlock();

    const editor = document.getElementById('eiosCohortEditor');
    editor.classList.remove('d-none');
    // Не scrollIntoView: он прокрутил бы по горизонтали и контейнер мастера (шаг может быть ещё
    // за краем экрана во время анимации перехода) — трек съезжает. Прокручиваем только сам шаг.
    const step = editor.closest('.wizard-step');
    if (step) {
        const top = editor.getBoundingClientRect().top - step.getBoundingClientRect().top + step.scrollTop;
        const bottom = top + editor.offsetHeight;
        if (top < step.scrollTop) step.scrollTop = top;
        else if (bottom > step.scrollTop + step.clientHeight) step.scrollTop = Math.min(top, bottom - step.clientHeight);
    }
}

function _eiosCloseEditor() {
    _eiosEditingIdx = null;
    document.getElementById('eiosCohortEditor').classList.add('d-none');
}

function _eiosSaveCohort() {
    const conditions = _eiosCollectConditions();
    if (conditions === null) return;
    const f = _eiosCollectFilters(conditions);
    if (f.AgeFrom !== null && f.AgeTo !== null && f.AgeFrom > f.AgeTo) {
        showToast('Возраст «от» больше, чем «до»', 'warning');
        return;
    }
    const profileId = parseInt(document.getElementById('ecSurvey').value, 10);
    const sel = window.eiosSelection;
    if (!sel.surveys.some(s => s.id === profileId)
        || (_eiosEditingIdx !== null && _eiosEditingIdx >= sel.cohorts.length)) {
        showToast('Выбор опросов изменился — откройте когорту заново', 'warning');
        _eiosCloseEditor();
        renderEiosCohorts();
        return;
    }
    const label = (document.getElementById('ecLabel').value.trim() || _eiosDefaultLabel(f, profileId)).slice(0, 120);
    const list = window.eiosSelection.cohorts;
    const cohort = { profile_id: profileId, label, filters: f };
    if (_eiosEditingIdx === null) list.push(cohort);
    else list[_eiosEditingIdx] = cohort;
    _eiosCloseEditor();
    renderEiosCohorts();
}

async function buildEiosSession() {
    const sel = window.eiosSelection;
    if (!sel || !sel.cohorts.length) return;
    const btn = document.getElementById('eiosBuildBtn');
    const spinner = document.getElementById('eiosBuildSpinner');
    btn.disabled = true;
    spinner.classList.remove('d-none');
    const r = await _eiosFetchJson('/eios/build_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cohorts: sel.cohorts }),
    });
    spinner.classList.add('d-none');
    btn.disabled = false;

    if (!r.ok) {
        if (_eiosNeedsLogin(r)) {
            showToast('Сессия ЭИОС истекла — вернитесь на шаг 1 и войдите заново', 'warning');
        } else {
            const msg = typeof r.data.message === 'string' ? r.data.message : 'Проверьте параметры выборки';
            showToast(_escHtml(msg), 'danger');
        }
        return;
    }

    window.sessionId = r.data.session_id;
    window.uploadedFiles = [];
    window.sheetSelections = {};
    window.processedFiles = r.data.processed_files;
    window.questionMapping = {};
    window.questionSourceFile = {};
    window.questionMerges = {};
    window.reportSections = [];

    const statLines = window.processedFiles.map(p => {
        const s = p.stats || {};
        const coverage = s.CoveragePercent != null ? `, охват ${s.CoveragePercent}%` : '';
        return `${_escHtml(p.label)}: ${s.SessionsCount ?? 0} анкет${coverage}`;
    });
    showToast(statLines.join('<br>'), 'success');
    const empty = window.processedFiles.filter(p => !(p.stats && p.stats.SessionsCount));
    if (empty.length) {
        showToast(`В когорты ${empty.map(p => `«${_escHtml(p.label)}»`).join(', ')} не попало ни одной анкеты`, 'warning');
    }
    const skipped = r.data.skipped_questions || [];
    if (skipped.length) {
        const surveys = [...new Set(skipped.map(q => q.survey))];
        const where = surveys.length > 1 ? ` (в опросах: ${surveys.map(_escHtml).join(', ')})` : '';
        showToast(`Пропущено вопросов типа «соответствие»: ${skipped.length}${where} — ЭИОС не отдаёт по ним ответы`, 'info');
    }

    renderQuestionsStep3();
    goToStep(2);
}

function rehydrateEiosUI() {
    _eiosNormalizeSelection(window.eiosSelection);
    applyDataSourceUI();
    if (window.dataSource === 'eios') renderEiosCohorts();
    return true;
}
window.rehydrateEiosUI = rehydrateEiosUI;

['ecGroups', 'ecChildProfiles', 'ecRegions', 'ecCitizenships', 'ecDegrees'].forEach(id => {
    $('#' + id).select2({ theme: 'bootstrap-5', width: '100%', language: 'ru', placeholder: 'Все', closeOnSelect: false });
});

document.getElementById('eiosToCohortsBtn').addEventListener('click', () => {
    const sel = window.eiosSelection;
    // Несколько опросов: по когорте «все респонденты» на каждый — их сразу можно сравнить.
    if (!sel.cohorts.length && _eiosMultiSurvey()) {
        sel.cohorts = sel.surveys.slice(0, EIOS_MAX_COHORTS)
            .map(s => ({ profile_id: s.id, label: s.title.slice(0, 120), filters: { Audience: 0 } }));
    }
    renderEiosCohorts();
    goToStep(1);
    if (!sel.cohorts.length) openEiosCohortEditor(null);
});
document.getElementById('eiosAddCohortBtn').addEventListener('click', () => openEiosCohortEditor(null));
document.getElementById('eiosCohortList').addEventListener('click', e => {
    const edit = e.target.closest('.eios-cohort-edit');
    if (edit) { openEiosCohortEditor(parseInt(edit.dataset.idx, 10)); return; }
    const del = e.target.closest('.eios-cohort-delete');
    if (del) {
        window.eiosSelection.cohorts.splice(parseInt(del.dataset.idx, 10), 1);
        _eiosCloseEditor();
        renderEiosCohorts();
    }
});
document.getElementById('ecAudience').addEventListener('change', _eiosToggleTeacherBlock);
// Смена опроса: фильтры и условия прежнего справочника к новому не подходят — сбрасываем их.
document.getElementById('ecSurvey').addEventListener('change', () => {
    _eiosFillEditorRefs({ Audience: parseInt(document.getElementById('ecAudience').value, 10) });
});
EIOS_TREE_LEVELS.forEach((lvl, i) => {
    document.getElementById(lvl.el).addEventListener('change', () => {
        // Смена уровня сбрасывает все нижележащие уровни и группы.
        const values = EIOS_TREE_LEVELS.map((l, j) => (j <= i ? document.getElementById(l.el).value : ''));
        _eiosRenderTree(values, []);
    });
});
document.getElementById('ecAddCondition').addEventListener('click', () => _eiosAddConditionRow(null));
document.getElementById('ecConditions').addEventListener('change', e => {
    if (e.target.classList.contains('ec-cond-question')) _eiosRenderCriteria(e.target.closest('.ec-condition'), null);
});
document.getElementById('ecConditions').addEventListener('click', e => {
    const btn = e.target.closest('.ec-cond-remove');
    if (!btn) return;
    btn.closest('.ec-condition').remove();
    _eiosUpdateConditionBtn();
});
document.getElementById('ecSaveBtn').addEventListener('click', _eiosSaveCohort);
document.getElementById('ecCancelBtn').addEventListener('click', _eiosCloseEditor);
document.getElementById('eiosBuildBtn').addEventListener('click', buildEiosSession);

applyDataSourceUI();

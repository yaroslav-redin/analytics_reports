// ===================== ШАГ 6: ЭКСПОРТ ДАННЫХ =====================
document.getElementById('downloadCleanedBtn').addEventListener('click', async () => {
    const ids = Object.keys(window.appData || {}).sort((a, b) =>
        parseInt(a.split('_')[1]) - parseInt(b.split('_')[1])
    );

    if (ids.length === 0) {
        showToast('Нет данных для экспорта. Сначала постройте отчёт на шаге 4.', 'danger');
        return;
    }

    const questions = [];
    let tableNum = 1;

    ids.forEach(id => {
        const dataObj = window.appData[id];
        if (!dataObj) return;

        const activeRows = dataObj.data.filter(r => r.included !== false);
        if (activeRows.length === 0) return;

        const fileTotals = {};
        dataObj.file_keys.forEach(fk => {
            fileTotals[fk] = activeRows.reduce((sum, r) => sum + (r.counts[fk] || 0), 0);
        });

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
            show_total: dataObj.options.showTotal !== false
        });
    });

    if (questions.length === 0) {
        showToast('Все строки исключены — нечего экспортировать.', 'danger');
        return;
    }

    const btn = document.getElementById('downloadCleanedBtn');
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Генерация...';

    try {
        const response = await fetch('/export_docx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questions })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'report_cleaned.docx';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(`Экспортировано ${questions.length} таблиц(ы)`, 'success');
        } else {
            const data = await response.json();
            showToast(data.message || 'Ошибка генерации документа', 'danger');
        }
    } catch (err) {
        showToast('Ошибка соединения с сервером', 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
});

// ===================== TOOLTIP INIT =====================
document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el, { trigger: 'hover' }));

initTooltips();

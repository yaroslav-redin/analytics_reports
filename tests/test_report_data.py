import pandas as pd

from app.data_logic import generate_report_data
from app.eios_data import write_eios_session
from app.schemas import AnalyzeRequest, ColumnConfig
from tests.eios_samples import sample_meta, sample_report, cohort


def _request(files, configs):
    return AnalyzeRequest(
        session_id="x",
        file_labels={f: f for f in files},
        file_colors={f: "#000000" for f in files},
        configs=configs,
    )


def _config(column, files, merged=None):
    return ColumnConfig(column=column, viz_type=["Таблица"],
                        file_mapping={f: column for f in files}, merged_columns=merged or [])


def test_generate_report_data_reads_eios_cohorts(tmp_path):
    processed, _ = write_eios_session(str(tmp_path), sample_meta(), [
        (cohort("Очная"), sample_report(yes=80, no=20)),
        (cohort("Заочная"), sample_report(yes=5, no=15)),
    ])
    files = [p["clean_filename"] for p in processed]
    res = generate_report_data(str(tmp_path), _request(files, [_config("Порекомендовали бы?", files)]))
    rows = {r["answer"]: r["counts"] for r in res[0]["data"]}
    assert rows == {"Да": {files[0]: 80, files[1]: 5}, "Нет": {files[0]: 20, files[1]: 15}}
    assert res[0]["file_keys"] == files


def test_merged_columns_work_for_eios(tmp_path):
    processed, _ = write_eios_session(str(tmp_path), sample_meta(), [(cohort(), sample_report())])
    files = [processed[0]["clean_filename"]]
    cfg = _config("Порекомендовали бы?", files, merged=["Ваши предложения"])
    res = generate_report_data(str(tmp_path), _request(files, [cfg]))
    answers = {r["answer"]: r["counts"][files[0]] for r in res[0]["data"]}
    assert answers == {"Да": 80, "Нет": 20, "Больше практики": 3}


def test_parquet_path_unchanged(tmp_path):
    pd.DataFrame({"Вопрос": ["А", "Б", "А"]}).to_parquet(tmp_path / "clean_raw_a.xlsx.parquet", index=False)
    files = ["clean_raw_a.xlsx.parquet"]
    res = generate_report_data(str(tmp_path), _request(files, [_config("Вопрос", files)]))
    assert {r["answer"]: r["counts"][files[0]] for r in res[0]["data"]} == {"А": 2, "Б": 1}

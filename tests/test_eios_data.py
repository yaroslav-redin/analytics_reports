import pytest
from pydantic import ValidationError

from app.eios_data import (
    build_question_names, report_to_counts, report_to_ranks, build_report_request,
    write_eios_session, load_cohort, is_eios_cohort_file, EiosNoData,
)
from app.schemas import EiosCondition, EiosCohortFilters, EiosBuildRequest
from tests.eios_samples import sample_meta, sample_report, empty_report, cohort

NAMES = ["Оцените организацию практики", "Порекомендовали бы?", "Расставьте по важности", "Ваши предложения"]


def test_names_follow_metadata_order_and_skip_unsupported():
    names, skipped = build_question_names(sample_meta()["Questions"])
    assert list(names.values()) == NAMES
    assert [s["id"] for s in skipped] == [14]


def test_duplicate_texts_get_question_id_suffix():
    qs = [{"QuestionId": 1, "Text": "Комментарий", "QuestionType": 4},
          {"QuestionId": 2, "Text": "Комментарий ", "QuestionType": 4}]
    names, _ = build_question_names(qs)
    assert names == {1: "Комментарий [1]", 2: "Комментарий [2]"}


def test_empty_question_text_gets_fallback_name():
    names, _ = build_question_names([{"QuestionId": 7, "Text": "  ", "QuestionType": 0}])
    assert names == {7: "Вопрос 7"}


def test_report_to_counts_drops_abstain_and_unsupported():
    names, _ = build_question_names(sample_meta()["Questions"])
    counts = report_to_counts(sample_report(), names)
    assert counts == {
        "Оцените организацию практики": {"5": 60, "4": 38},
        "Порекомендовали бы?": {"Да": 80, "Нет": 20},
        "Ваши предложения": {"Больше практики": 3},
    }
    assert all(isinstance(v, int) for q in counts.values() for v in q.values())


def test_report_to_ranks_keeps_average_order_as_float():
    names, _ = build_question_names(sample_meta()["Questions"])
    ranks = report_to_ranks(sample_report(), names)
    assert ranks == {"Расставьте по важности": {"Зарплата": 1.7, "График": 2.3}}


def test_report_to_counts_empty_report():
    names, _ = build_question_names(sample_meta()["Questions"])
    assert report_to_counts(empty_report(), names) == {}


def test_build_report_request_minimal():
    body = build_report_request(1004939, EiosCohortFilters())
    assert body["TestProfileId"] == 1004939
    assert body["Audience"] == 0
    assert body["Conditions"] == []
    assert "SchoolYear" not in body


def test_empty_strings_become_null():
    body = build_report_request(1, EiosCohortFilters(SchoolYear="", Faculty="Факультет"))
    assert "SchoolYear" not in body
    assert body["Faculty"] == "Факультет"


def test_teacher_fields_dropped_for_students():
    f = EiosCohortFilters(Audience=0, IsPps=True, Department="Кафедра", AcademicDegrees=["к.п.н."])
    body = build_report_request(1, f)
    assert "IsPps" not in body and "Department" not in body
    assert body["AcademicDegrees"] == []


def test_teacher_fields_kept_for_workplace_audience():
    f = EiosCohortFilters(Audience=2, IsPps=False, Department="Кафедра", AcademicDegrees=["к.п.н."])
    body = build_report_request(1, f)
    assert body["IsPps"] is False
    assert body["Department"] == "Кафедра"
    assert body["AcademicDegrees"] == ["к.п.н."]


def test_child_profiles_are_strings():
    body = build_report_request(1, EiosCohortFilters(ChildProfiles=["2001"]))
    assert body["ChildProfiles"] == ["2001"]


def test_conditions_serialized_without_empty_fields():
    f = EiosCohortFilters(Conditions=[
        {"QuestionId": 12, "AnswerOptionIds": [101]},
        {"QuestionId": 11, "StarsFrom": 4},
        {"QuestionId": 15, "TextEquals": "  Больше практики "},
    ])
    assert build_report_request(1, f)["Conditions"] == [
        {"QuestionId": 12, "AnswerOptionIds": [101]},
        {"QuestionId": 11, "StarsFrom": 4},
        {"QuestionId": 15, "TextEquals": "Больше практики"},
    ]


def test_condition_without_criteria_rejected():
    with pytest.raises(ValidationError):
        EiosCondition(QuestionId=12)
    with pytest.raises(ValidationError):
        EiosCondition(QuestionId=15, TextEquals="   ")


def test_more_than_three_conditions_rejected():
    with pytest.raises(ValidationError):
        EiosCohortFilters(Conditions=[{"QuestionId": i, "StarsFrom": 1} for i in range(4)])


def test_age_from_greater_than_to_rejected():
    with pytest.raises(ValidationError):
        EiosCohortFilters(AgeFrom=30, AgeTo=20)


def test_unknown_audience_rejected():
    with pytest.raises(ValidationError):
        EiosCohortFilters(Audience=4)


def test_cohort_count_limit():
    with pytest.raises(ValidationError):
        EiosBuildRequest(profile_id=1, cohorts=[cohort(str(i)) for i in range(7)])


def test_write_session_files_and_processed(tmp_path):
    processed, skipped = write_eios_session(
        str(tmp_path), sample_meta(), [(cohort("Очная"), sample_report())],
    )
    p = processed[0]
    assert p["clean_filename"] == "eios_cohort_0.json"
    assert p["label"] == "Очная" and p["original_name"] == "Очная"
    assert [c["name"] for c in p["columns"]] == NAMES
    assert all(c["is_system"] is False for c in p["columns"])
    assert p["stats"]["SessionsCount"] == 100
    assert [s["id"] for s in skipped] == [14]
    counts, ranks = load_cohort(str(tmp_path / "eios_cohort_0.json"))
    assert counts["Порекомендовали бы?"] == {"Да": 80, "Нет": 20}
    assert "Расставьте по важности" not in counts
    assert ranks == {"Расставьте по важности": {"Зарплата": 1.7, "График": 2.3}}


def test_write_session_keeps_empty_cohort(tmp_path):
    processed, _ = write_eios_session(
        str(tmp_path), sample_meta(),
        [(cohort("Очная"), sample_report()), (cohort("Заочная"), empty_report())],
    )
    assert [p["clean_filename"] for p in processed] == ["eios_cohort_0.json", "eios_cohort_1.json"]
    assert processed[1]["stats"]["SessionsCount"] == 0
    assert load_cohort(str(tmp_path / "eios_cohort_1.json")) == ({}, {})


def test_write_session_without_any_data_raises(tmp_path):
    with pytest.raises(EiosNoData):
        write_eios_session(str(tmp_path), sample_meta(), [(cohort(), empty_report())])


def test_is_eios_cohort_file():
    assert is_eios_cohort_file("eios_cohort_0.json")
    assert not is_eios_cohort_file("clean_raw_a.xlsx.parquet")


def test_html_stripped_from_question_and_answer_texts():
    qs = [{"QuestionId": 1, "Text": "<strong>1. Your Gender:</strong>", "QuestionType": 0}]
    names, _ = build_question_names(qs)
    assert names == {1: "1. Your Gender:"}
    report = {"Details": [{"QuestionId": 1, "QuestionType": 0, "Items": [
        {"Text": "<p>Male</p>", "Count": 3}, {"Text": "Male", "Count": 2}]}]}
    assert report_to_counts(report, names) == {"1. Your Gender:": {"Male": 5}}

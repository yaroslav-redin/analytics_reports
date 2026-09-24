from app.schemas import EiosCohort, EiosCohortFilters


def sample_meta():
    return {
        "TestProfileId": 1004939, "Title": "Удовлетворенность практикой",
        "IsSummable": True, "TeacherUser": None,
        "Questions": [
            {"QuestionId": 11, "Text": "Оцените организацию практики", "QuestionType": 10,
             "QuestionTypeName": "Оценка", "MaxStars": 5, "Answers": []},
            {"QuestionId": 12, "Text": "Порекомендовали бы?", "QuestionType": 0,
             "QuestionTypeName": "Один из списка", "MaxStars": 0,
             "Answers": [{"Id": 101, "Text": "Да"}, {"Id": 102, "Text": "Нет"}]},
            {"QuestionId": 13, "Text": "Расставьте по важности", "QuestionType": 2,
             "QuestionTypeName": "Порядок", "MaxStars": 0, "Answers": [{"Id": 201, "Text": "Зарплата"}]},
            {"QuestionId": 14, "Text": "Соотнесите", "QuestionType": 3,
             "QuestionTypeName": "Соответствие", "MaxStars": 0, "Answers": []},
            {"QuestionId": 15, "Text": "Ваши предложения", "QuestionType": 4,
             "QuestionTypeName": "Свой текст", "MaxStars": 0, "Answers": []},
        ],
        "FilterTree": [], "ChildProfiles": [], "Regions": [], "Citizenships": [],
        "AcademicDegrees": [], "TeacherFilterTree": [],
    }


def sample_report(yes=80, no=20, sessions=100):
    return {
        "TestProfileId": 1004939, "Audience": 0, "SessionsCount": sessions,
        "AudienceSize": 240, "AnsweredCount": sessions, "CoveragePercent": 41.7,
        "IsSummable": True, "Summary": [],
        "Details": [
            {"QuestionId": 11, "Text": "Оцените организацию практики", "QuestionType": 10,
             "SessionCount": sessions, "AvgRating": 4.2, "Items": [
                 {"Text": "Воздержались от ответа", "Count": 2, "Percent": 0.02},
                 {"Text": "5", "Count": 60, "Percent": 0.6},
                 {"Text": "4", "Count": 38, "Percent": 0.38}]},
            {"QuestionId": 12, "Text": "Порекомендовали бы?", "QuestionType": 0,
             "SessionCount": sessions, "AvgRating": 0, "Items": [
                 {"Text": "Да", "Count": yes, "Percent": 0.8},
                 {"Text": "Нет", "Count": no, "Percent": 0.2}]},
            {"QuestionId": 13, "Text": "Расставьте по важности", "QuestionType": 2,
             "SessionCount": sessions, "AvgRating": 0, "Items": [
                 {"Text": "Зарплата", "Count": 1.7, "Percent": 0}]},
            {"QuestionId": 14, "Text": "Соотнесите", "QuestionType": 3,
             "SessionCount": sessions, "AvgRating": 0},
            {"QuestionId": 15, "Text": "Ваши предложения", "QuestionType": 4,
             "SessionCount": sessions, "AvgRating": 0, "Items": [
                 {"Text": "Больше практики", "Count": 3, "Percent": 0.03}]},
        ],
    }


def empty_report():
    return {
        "TestProfileId": 1004939, "Audience": 0, "SessionsCount": 0, "AudienceSize": 240,
        "AnsweredCount": 0, "CoveragePercent": 0.0, "IsSummable": True, "Summary": [],
        "Details": [{"QuestionId": 12, "Text": "Порекомендовали бы?", "QuestionType": 0,
                     "SessionCount": 0, "AvgRating": 0, "Items": []}],
    }


def cohort(label="Все респонденты", **filters):
    return EiosCohort(label=label, filters=EiosCohortFilters(**filters))

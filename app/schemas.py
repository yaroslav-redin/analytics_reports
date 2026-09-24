from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

class ProcessSheetFile(BaseModel):
    filename: str
    sheets: List[str]

class ProcessSheetsRequest(BaseModel):
    session_id: str
    files: List[ProcessSheetFile]

class ColumnConfig(BaseModel):
    column: str
    viz_type: List[str]
    file_mapping: Dict[str, str]
    merged_columns: List[str] = []

class AnalyzeRequest(BaseModel):
    session_id: str
    file_labels: Dict[str, str]
    file_colors: Dict[str, str]
    configs: List[ColumnConfig]

class ExportRow(BaseModel):
    answer: str
    counts: Dict[str, int]

class SectionInfo(BaseModel):
    name: str
    description: str = ""
    color: str = ""

class ExportQuestion(BaseModel):
    table_num: int
    question_name: str
    h1: str
    h2: str
    h3: str
    file_keys: List[str]
    file_labels: Dict[str, str]
    rows: List[ExportRow]
    file_totals: Dict[str, int]
    show_total: bool
    section: Optional[SectionInfo] = None
    viz_tab: Optional[str] = None        
    chart_direction: str = 'y'           
    show_legend: bool = True
    hidden_col: str = 'none'             
    skip_analytics: bool = False
    both_chart_type: str = 'bar'
    pie_colors: List[str] = []
    bar_colors: List[str] = []
    file_colors: Dict[str, str] = {}
    highlight_top: bool = False
    top_n: int = 1
    highlight_color: str = '#dc3545'
    dim_others: bool = False
    dim_color: str = '#6c757d'

class ExportDocxRequest(BaseModel):
    questions: List[ExportQuestion]
    session_id: Optional[str] = None
    title_page_body: Optional[str] = None
    title_page_approval: Optional[str] = None

class AiGroupRequest(BaseModel):
    answers: List[str]
    question_name: str


# ===================== ЭИОС: когорты для отчёта опроса =====================

class EiosCondition(BaseModel):
    """Условие среза когорты («среди тех, кто ответил так-то»)."""
    QuestionId: int
    AnswerOptionIds: List[int] = []
    StarsFrom: Optional[int] = Field(None, ge=0)
    StarsTo: Optional[int] = Field(None, ge=0)
    TextEquals: Optional[str] = None

    @field_validator("TextEquals")
    @classmethod
    def _strip_text(cls, v):
        v = (v or "").strip()
        return v or None

    @model_validator(mode="after")
    def _has_criteria(self):
        if not self.AnswerOptionIds and self.StarsFrom is None and self.StarsTo is None and not self.TextEquals:
            raise ValueError("Условие среза должно содержать хотя бы один критерий")
        return self


class EiosCohortFilters(BaseModel):
    Audience: int = Field(0, ge=0, le=3)
    SchoolYear: Optional[str] = None
    Faculty: Optional[str] = None
    EducationForm: Optional[str] = None
    EducationLevel: Optional[str] = None
    Speciality: Optional[str] = None
    Specialization: Optional[str] = None
    Groups: List[str] = []
    ChildProfiles: List[str] = []
    Regions: List[str] = []
    Citizenships: List[str] = []
    IsPps: Optional[bool] = None
    Department: Optional[str] = None
    AcademicDegrees: List[str] = []
    AgeFrom: Optional[int] = Field(None, ge=0, le=120)
    AgeTo: Optional[int] = Field(None, ge=0, le=120)
    Conditions: List[EiosCondition] = Field(default_factory=list, max_length=3)

    @field_validator("SchoolYear", "Faculty", "EducationForm", "EducationLevel",
                     "Speciality", "Specialization", "Department", mode="before")
    @classmethod
    def _empty_to_none(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @model_validator(mode="after")
    def _age_range(self):
        if self.AgeFrom is not None and self.AgeTo is not None and self.AgeFrom > self.AgeTo:
            raise ValueError("Возраст «от» больше возраста «до»")
        return self


class EiosCohort(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)
    filters: EiosCohortFilters = Field(default_factory=EiosCohortFilters)


class EiosBuildRequest(BaseModel):
    profile_id: int
    cohorts: List[EiosCohort] = Field(..., min_length=1, max_length=6)

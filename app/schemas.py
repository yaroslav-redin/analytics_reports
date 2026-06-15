from typing import List, Dict, Any, Optional
from pydantic import BaseModel

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

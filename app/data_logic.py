import pandas as pd
import re
import os
from datetime import datetime
from app import config as cfg

def clean_column_name(col_name):
    name = str(col_name).strip()
    name = re.sub(r'^\s*\d+\s*[\)\.]\s*', '', name)
    name = re.sub(r'\s*:\s*$', '', name)
    return name

def clean_answer_text(answer):
    placeholder = cfg.get("missing_value_placeholder", "Нет ответа")
    if pd.isna(answer): return placeholder
    ans = str(answer).strip()
    ans = re.sub(r'^\s*\d+\s*[\)\.]\s*', '', ans)
    return ans

def is_system_column(col_name):
    c = str(col_name).lower().strip()
    sys_exact = cfg.get_json("system_columns_exact")
    sys_contains = cfg.get_json("system_columns_contains")
    if c in sys_exact: return True
    for kw in sys_contains:
        if kw in c: return True
    return False


def unify_numbered_answers(series):
    if series.dropna().empty: return series
    s_str = series.astype(str).str.strip()
    extracted = s_str.str.extract(r'^(\d+)[\)\.]\s*(.*)')

    if extracted[0].notna().sum() > 0:
        mapping = {}
        for num in extracted[0].dropna().unique():
            texts = extracted[extracted[0] == num][1].str.strip()
            texts = texts[texts != ""]
            if not texts.empty:
                russian_texts = texts[texts.str.contains(r'[А-Яа-яЁё]', regex=True, na=False)]
                if not russian_texts.empty:
                    best_text = russian_texts.mode().iloc[0]
                else:
                    best_text = texts.mode().iloc[0]
                mapping[num] = f"{num}) {best_text}"

        def apply_map(val):
            if pd.isna(val) or str(val).strip() == 'nan': return "Нет ответа"
            m = re.match(r'^(\d+)[\)\.]\s*(.*)', str(val).strip())
            if m:
                num = m.group(1)
                return mapping.get(num, str(val).strip())
            return str(val).strip()

        return series.apply(apply_map)
    else:
        placeholder = cfg.get("missing_value_placeholder", "Нет ответа")
        return series.apply(lambda x: str(x).strip() if pd.notna(x) and str(x).strip() != 'nan' else placeholder)

def clean_age(age_str):
    if pd.isna(age_str) or str(age_str).strip().lower() == 'nan': return cfg.get("missing_value_placeholder", "Нет ответа")
    numbers = re.findall(r'\d+', str(age_str))
    if numbers:
        val = int(numbers[0])
        if val > 1900: return str(datetime.now().year - val)
        return str(val)
    return "Нет ответа"

def clean_dataframe(df):
    for col in df.columns:
        if is_system_column(col): continue
        else: df[col] = unify_numbered_answers(df[col])

    df.rename(columns=lambda x: clean_column_name(x), inplace=True)
    return df

def _is_single_choice_group(df, cols):
    """True if every column in the group has at most 1 distinct non-placeholder value.
    This distinguishes checkbox-style multi-select (one fixed label per column)
    from rating/scale multi-select (multiple different answers per column)."""
    placeholder = cfg.get("missing_value_placeholder", "Нет ответа")
    for col in cols:
        if col not in df.columns:
            continue
        series = df[col].dropna()
        series = series[series.astype(str).str.strip() != ""]
        series = series[series.astype(str).str.lower() != "nan"]
        series = series[series.astype(str) != placeholder]
        if series.nunique() > 1:
            return False
    return True

def get_column_groups(columns, df=None):
    groups = {}
    prefix_counts = {}
    for col in columns:
        if ' / ' in col:
            prefix = col.split(' / ')[0].strip()
            prefix_counts[prefix] = prefix_counts.get(prefix, 0) + 1

    multi_answer_prefixes = set()
    if df is not None:
        for prefix, count in prefix_counts.items():
            if count > 1:
                prefix_cols = [c for c in columns if ' / ' in c and c.split(' / ')[0].strip() == prefix]
                if not _is_single_choice_group(df, prefix_cols):
                    multi_answer_prefixes.add(prefix)

    for col in columns:
        if ' / ' in col:
            prefix = col.split(' / ')[0].strip()
            if prefix_counts[prefix] > 1 and prefix not in multi_answer_prefixes:
                if prefix not in groups: groups[prefix] = []
                groups[prefix].append(col)
            else:
                groups[col] = [col]
        else:
            groups[col] = [col]
    return groups

def _get_answer_counts(df, q_name, groups_cache):
    actual_cols = groups_cache[q_name]
    data = df[actual_cols[0]] if len(actual_cols) == 1 else df[actual_cols].melt()['value']
    data = data.dropna()
    data = data[data.astype(str).str.strip() != ""]
    data = data[data.astype(str).str.lower() != "nan"]
    data = data[data.astype(str) != cfg.get("missing_value_placeholder", "Нет ответа")]
    if data.empty:
        return {}
    counts = data.value_counts().reset_index()
    counts.columns = ['Ответ', 'Количество']
    counts['Ответ'] = counts['Ответ'].apply(clean_answer_text)
    counts = counts.groupby('Ответ', as_index=False)['Количество'].sum()
    return counts.set_index('Ответ')['Количество'].to_dict()

def generate_report_data(upload_dir, request_data):
    file_labels = request_data.file_labels
    file_colors = request_data.file_colors

    dfs = {}
    groups_cache = {}
    for clean_filename in file_labels.keys():
        filepath = os.path.join(upload_dir, clean_filename)
        if os.path.exists(filepath):
            df = pd.read_parquet(filepath)
            dfs[clean_filename] = df
            groups_cache[clean_filename] = get_column_groups(df.columns, df)

    results = []

    for cfg in request_data.configs:
        all_answers = set()
        file_counts = {}

        for f_name, q_name in cfg.file_mapping.items():
            if f_name not in dfs:
                continue

            # Основной вопрос
            combined_counts: dict = {}
            if q_name in groups_cache[f_name]:
                combined_counts = _get_answer_counts(dfs[f_name], q_name, groups_cache[f_name])

            # Доноры — ищем в том же файле по имени колонки
            for donor_name in getattr(cfg, 'merged_columns', []):
                if donor_name not in groups_cache[f_name]:
                    continue
                donor_counts = _get_answer_counts(dfs[f_name], donor_name, groups_cache[f_name])
                for ans, cnt in donor_counts.items():
                    combined_counts[ans] = combined_counts.get(ans, 0) + cnt

            if combined_counts:
                file_counts[f_name] = combined_counts
                all_answers.update(combined_counts.keys())

        q_file_keys = [k for k in file_labels if k in cfg.file_mapping]
        q_file_labels = {k: file_labels[k] for k in q_file_keys}
        q_file_colors = {k: file_colors[k] for k in q_file_keys}

        data_dicts = []
        for ans in all_answers:
            row = {"answer": ans, "counts": {}, "included": True}
            row["counts"] = {f_name: file_counts.get(f_name, {}).get(ans, 0) for f_name in q_file_keys}
            row["_total"] = sum(row["counts"].values())
            data_dicts.append(row)

        data_dicts.sort(key=lambda x: x["_total"], reverse=True)

        results.append({
            "col_name": cfg.column,
            "viz_type": cfg.viz_type,
            "data": data_dicts,
            "file_labels": q_file_labels,
            "file_colors": q_file_colors,
            "file_keys": q_file_keys
        })

    return results

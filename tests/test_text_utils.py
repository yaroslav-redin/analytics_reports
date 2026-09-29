from app.text_utils import strip_html


def test_strips_tags_and_entities():
    assert strip_html("<strong>2. Your Age&nbsp;</strong><em>(specify how old you are):</em>") \
        == "2. Your Age (specify how old you are):"


def test_adjacent_tags_joined_without_extra_spaces():
    assert strip_html("<strong>5.&nbsp;</strong><strong>Are you currently employed</strong><strong>?</strong>") \
        == "5. Are you currently employed?"


def test_block_tags_become_spaces():
    assert strip_html("Первая строка<br/>вторая<p>третья</p>") == "Первая строка вторая третья"


def test_plain_text_with_angle_brackets_kept():
    assert strip_html("Оценка < 3 и > 1") == "Оценка < 3 и > 1"
    assert strip_html("Ток &amp; напряжение") == "Ток & напряжение"


def test_non_string_passthrough():
    assert strip_html(None) is None
    assert strip_html(5) == 5

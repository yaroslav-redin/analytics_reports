#!/usr/bin/env bash
# Автообновление certs/russian_trusted_ca_bundle.pem (сертификаты НУЦ Минцифры
# для TLS к GigaChat API).
#
# Ничего не делает, если до истечения текущего Sub CA >= WARN_DAYS дней.
# Иначе скачивает свежий Sub CA с gu-st.ru и заменяет файл ТОЛЬКО если его
# подпись проверяется тем же Root CA, что уже лежит в бандле (Root CA не
# трогаем — он действует до 2032, отдельно обновлять не нужно). Проверка
# подписи защищает от подмены на уровне канала загрузки: подделать её без
# приватного ключа Root CA невозможно, так что неважно, кто инициирует
# загрузку — скрипт или человек.
#
# Тихий по умолчанию (не пишет в лог, если всё в порядке) — журнал на
# сервере ограничен по месту.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE="${1:-$SCRIPT_DIR/../certs/russian_trusted_ca_bundle.pem}"
SUB_CA_URL="https://gu-st.ru/content/Other/doc/russian_trusted_sub_ca.cer"
WARN_DAYS=60
APP_SERVICE="analytics_reports"

[[ -f "$BUNDLE" ]] || { echo "Файл не найден: $BUNDLE" >&2; exit 1; }

root_ca="$(awk '/-----BEGIN CERTIFICATE-----/{n++} n==1' "$BUNDLE")"
sub_ca_current="$(awk '/-----BEGIN CERTIFICATE-----/{n++} n==2' "$BUNDLE")"
[[ -n "$root_ca" && -n "$sub_ca_current" ]] || { echo "Бандл повреждён: не найдено 2 сертификата в $BUNDLE" >&2; exit 1; }

enddate="$(openssl x509 -noout -enddate <<< "$sub_ca_current" | cut -d= -f2)"
days_left=$(( ($(date -d "$enddate" +%s) - $(date +%s)) / 86400 ))

(( days_left >= WARN_DAYS )) && exit 0

fresh="$(curl -sf "$SUB_CA_URL")" || exit 0   # сеть недоступна — тихо, попробуем завтра

current_fp="$(openssl x509 -noout -fingerprint -sha1 <<< "$sub_ca_current")"
fresh_fp="$(openssl x509 -noout -fingerprint -sha1 <<< "$fresh")"

[[ "$current_fp" == "$fresh_fp" ]] && exit 0   # новый ещё не выпущен — тихо, попробуем завтра

root_ca_file="$(mktemp)"
fresh_file="$(mktemp)"
trap 'rm -f "$root_ca_file" "$fresh_file"' EXIT
printf '%s\n' "$root_ca" > "$root_ca_file"
printf '%s\n' "$fresh" > "$fresh_file"

if ! openssl verify -CAfile "$root_ca_file" "$fresh_file" >/dev/null 2>&1; then
    echo "ОШИБКА: скачанный Sub CA не подписан доверенным Root CA — файл НЕ обновлён (осталось $days_left дн. до истечения текущего)." >&2
    exit 1
fi

tmp="$(mktemp)"
{ printf '%s\n' "$root_ca"; printf '%s\n' "$fresh"; } > "$tmp"
mv "$tmp" "$BUNDLE"

fresh_end="$(openssl x509 -noout -enddate <<< "$fresh" | cut -d= -f2)"
echo "Sub CA обновлён (было $days_left дн. до истечения; новый истекает $fresh_end), перезапускаю $APP_SERVICE"
systemctl restart "$APP_SERVICE"

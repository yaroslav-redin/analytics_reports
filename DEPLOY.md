# Деплой на Ubuntu-сервер

Инструкция для развёртывания на виртуальном сервере с Ubuntu 24, 512 МБ RAM, 1 CPU, 15 ГБ диска.

---

## 1. Подключение по SSH

На своём компьютере (PowerShell или cmd):

```bash
ssh имя_пользователя@IP_сервера
```

При первом подключении введи `yes`, затем пароль.

---

## 2. Первоначальная настройка сервера

```bash
# Обновить систему
sudo apt update && sudo apt upgrade -y

# Установить необходимые пакеты
sudo apt install -y python3 python3-pip python3-venv git nano

# Создать swap — обязательно при 512 МБ RAM
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Проверить swap
free -h
```

---

## 3. Клонирование проекта с GitHub

```bash
cd ~
git clone https://github.com/yaroslav-redin/analytics_reports.git
cd analytics_reports
```

---

## 4. Виртуальное окружение и зависимости

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 5. Настройка .env

`.env` содержит секреты и не хранится в git — его нужно создать вручную.

```bash
cp .env.example .env
nano .env
```

Заполнить все переменные (OAuth-ключи, GigaChat Authorization key и т.д.).

Управление в nano: редактируй → `Ctrl+O` → Enter → `Ctrl+X`.

---

## 6. Проверка запуска

```bash
cd ~/analytics_reports
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 64548
```

Открой в браузере: `http://IP_сервера:64548`

Должна появиться страница входа. Если всё ок — останови (`Ctrl+C`) и переходи дальше.

Если порт не открывается:

```bash
sudo ufw allow 64548
sudo ufw enable
```

---

## 7. Автозапуск через systemd

Создать файл сервиса:

```bash
sudo nano /etc/systemd/system/analytics_reports.service
```

Вставить содержимое (заменить `ubuntu` на своё имя пользователя если отличается):

```ini
[Unit]
Description=Analytics Reports App
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/analytics_reports
Environment="PATH=/home/ubuntu/analytics_reports/venv/bin"
EnvironmentFile=/home/ubuntu/analytics_reports/.env
ExecStart=/home/ubuntu/analytics_reports/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 64548 --workers 1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Сохранить (`Ctrl+O` → Enter → `Ctrl+X`), затем:

```bash
sudo systemctl daemon-reload
sudo systemctl enable analytics_reports
sudo systemctl start analytics_reports
sudo systemctl status analytics_reports
```

Статус должен быть `Active: active (running)`.

---

## 8. Обновление кода

```bash
cd ~/analytics_reports
git pull
source venv/bin/activate
pip install -r requirements.txt   # только если изменился requirements.txt
sudo systemctl restart analytics_reports
```

---

## 9. Полезные команды

```bash
# Последние 50 строк логов
sudo journalctl -u analytics_reports -n 50

# Следить за логами в реальном времени
sudo journalctl -u analytics_reports -f

# Перезапустить приложение
sudo systemctl restart analytics_reports

# Остановить приложение
sudo systemctl stop analytics_reports

# Использование памяти
free -h
```

---

## 10. Автообновление сертификата НУЦ Минцифры

`certs/russian_trusted_ca_bundle.pem` содержит Root и Sub CA сертификаты НУЦ Минцифры (нужны для TLS к GigaChat API). Root действует до 2032, Sub CA — до 2027-03-06.

Скрипт `scripts/check_ca_cert_expiry.sh` раз в день проверяет остаток срока Sub CA:
- если больше 60 дней — ничего не делает и ничего не пишет в лог (место на диске ограничено);
- если меньше — скачивает свежий Sub CA с `gu-st.ru` и **проверяет его подпись против уже закоммиченного Root CA** (`openssl verify`); подделать эту подпись без приватного ключа Root CA невозможно, поэтому неважно, кто инициирует загрузку — скрипт или человек;
- если подпись верна и это действительно новый сертификат — заменяет `certs/russian_trusted_ca_bundle.pem` и перезапускает `analytics_reports.service` (лог — одна строка);
- если подпись не проходит проверку (сеть отдала не то) — файл НЕ трогает, пишет ошибку в лог и завершается с ошибкой (юнит будет виден как `failed`).

Root CA сам не обновляется (действует до 2032) — если Минцифры когда-нибудь переиздадут и его, это отдельная ручная операция.

Установка (один раз на сервере, юнит выполняется от root — нужно для перезаписи `certs/` и перезапуска `analytics_reports.service`):

```bash
cd ~/analytics_reports
chmod +x scripts/check_ca_cert_expiry.sh
sudo cp scripts/analytics_reports-cert-check.service /etc/systemd/system/
sudo cp scripts/analytics_reports-cert-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now analytics_reports-cert-check.timer
```

Если путь к проекту не `/home/ubuntu/analytics_reports` — поправь `WorkingDirectory=`/`ExecStart=` в `/etc/systemd/system/analytics_reports-cert-check.service` (`sudo nano ...`) перед `daemon-reload`.

Проверить вручную:

```bash
sudo systemctl start analytics_reports-cert-check.service
sudo systemctl status analytics_reports-cert-check.service   # OK если "success"/неактивен без ошибки
sudo journalctl -u analytics_reports-cert-check.service -n 20   # что-то появится только если сертификат обновился или найдена ошибка
```

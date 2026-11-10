# Chat Studio — редактор чата SA-MP

Веб-приложение для оформления реплик из игры (SA-MP) поверх скриншотов: ситуации и кадры, слои, эффекты, импорт chatlog,
экспорт в PNG / JPEG / PSD. Теперь с аккаунтами: у каждого пользователя своё хранилище ситуаций и скриншотов на сервере.

* **Сервер:** Node.js 20 + Express, база данных **SQLite** (один файл, никаких отдельных сервисов).
* **Фронтенд:** один файл `public/index.html` (без сборки).
* **Запуск:** Docker (`docker compose`), данные лежат в томе `/data`.
* **Порт по умолчанию — `8420`** (3000 занят). Меняется переменной `HOST_PORT`.

## Быстрый старт на Ubuntu VPS

```bash
# 1. Docker (если ещё не установлен)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"        # затем перелогиньтесь

# 2. Код
git clone https://github.com/ddimavo/chat-editor.git
cd chat-editor

# 3. Настройки
cp .env.example .env
nano .env                              # HOST_PORT, REGISTRATION_CODE и т. д.

# 4. Запуск
docker compose up -d --build
docker compose ps                      # статус должен стать healthy
```

Откройте `http://IP_СЕРВЕРА:8420`, зарегистрируйтесь — готово.
Если ufw включён: `sudo ufw allow 8420/tcp`.

> **Порт занят?** Проверьте: `ss -ltn | grep ':8420'`. Выберите другой свободный и поставьте его в `HOST_PORT` в `.env`,
> затем `docker compose up -d`.

### Важно: HTTPS

Без HTTPS логин и пароль передаются по сети **открытым текстом**. Для постоянной работы включите HTTPS одним из способов.

**Вариант A — встроенный Caddy (нужен домен, указывающий на сервер, и свободные порты 80/443):**

```bash
# в .env:
DOMAIN=editor.example.com
BIND_ADDR=127.0.0.1
TRUST_PROXY=1
COOKIE_SECURE=true

docker compose --profile https up -d --build
```

Сертификат Let's Encrypt Caddy получит и будет продлевать сам.

**Вариант B — у вас уже есть nginx.** Оставьте `BIND_ADDR=127.0.0.1`, `TRUST_PROXY=1`, `COOKIE_SECURE=true` и добавьте сайт:

```nginx
server {
    server_name editor.example.com;
    client_max_body_size 45m;               # скриншоты до MAX_IMAGE_MB
    location / {
        proxy_pass http://127.0.0.1:8420;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # сертификат: sudo certbot --nginx -d editor.example.com
}
```

## Настройки (`.env`)

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `HOST_PORT` | `8420` | порт на сервере |
| `BIND_ADDR` | `0.0.0.0` | `127.0.0.1` — только локально (за nginx/Caddy) |
| `REGISTRATION` | `open` | `closed` — регистрация закрыта |
| `REGISTRATION_CODE` | пусто | если задан — нужен для регистрации (код приглашения) |
| `USER_QUOTA_MB` | `1024` | квота на скриншоты у одного пользователя |
| `MAX_IMAGE_MB` | `40` | максимальный размер одного изображения |
| `SESSION_DAYS` | `30` | срок жизни входа |
| `TRUST_PROXY` | пусто | `1` — когда приложение стоит за прокси |
| `COOKIE_SECURE` | `auto` | `true` — cookie только по HTTPS (рекомендуется с HTTPS) |
| `BACKUP_EVERY_HOURS` / `BACKUP_KEEP` | `24` / `7` | автоматические копии базы |

После изменения `.env`: `docker compose up -d`.

## Как это устроено

* **Аккаунты:** логин (3–32 символа: латиница, цифры, `_ - .`) и пароль (от 8 символов). Пароли хранятся только в виде
  хэша **scrypt**; вход — httpOnly-cookie с непрозрачным токеном (в базе лежит лишь его SHA-256), срок продлевается при работе.
  Попытки входа ограничены, смена пароля завершает сессии на других устройствах.
* **Хранилище пользователя:** настройки и список ситуаций (с кадрами, слоями, эффектами) в таблицах `user_state` / `situations`,
  скриншоты и картинки слоёв — в `images`. Каждый видит только свои данные.
* **Автосохранение** идёт в аккаунт (индикатор «Сохранено» вверху). Версионирование защищает от затирания: если один и тот же
  аккаунт открыт в двух вкладках, при сохранении приложение спросит, чьи изменения оставить.
* **Перенос локальных данных:** если в этом браузере были данные старой версии (без аккаунта), после первого входа приложение
  предложит загрузить их в аккаунт.
* **Резервная копия в файл** («Проект → Сохранить проект в файл») по-прежнему работает — это копия именно вашего аккаунта.

## Администрирование

```bash
docker compose exec app node server/src/cli.js users                 # список пользователей и занятое место
docker compose exec app node server/src/cli.js create alice          # создать пользователя (пароль сгенерируется)
docker compose exec app node server/src/cli.js passwd alice          # сбросить пароль
docker compose exec app node server/src/cli.js delete alice          # удалить пользователя со всеми данными
docker compose exec app node server/src/cli.js backup                # копия базы прямо сейчас
```

Чтобы закрыть сервис от посторонних: `REGISTRATION=closed` и создавайте пользователей командой `create`,
либо оставьте регистрацию открытой, но задайте `REGISTRATION_CODE`.

## Резервные копии и обновление

* Сервер сам делает копии базы раз в сутки в `/data/backups` (хранятся последние 7).
* Скопировать копию на хост: `./scripts/backup.sh` (можно в cron: `0 4 * * * /путь/chat-editor/scripts/backup.sh`).
* **Восстановление:** остановите приложение, положите нужный файл вместо базы и запустите снова:

  ```bash
  docker compose stop app
  docker run --rm -v chat-editor_chat-editor-data:/data -v "$PWD/backups:/b" alpine \
      sh -c 'rm -f /data/chat-editor.sqlite-wal /data/chat-editor.sqlite-shm && cp /b/chat-editor-ДАТА.sqlite /data/chat-editor.sqlite'
  docker compose start app
  ```

  (имя тома — `<папка проекта>_chat-editor-data`; уточнить: `docker volume ls`).
* **Обновление:** `./scripts/update.sh` (`git pull` + пересборка; данные в томе сохраняются).

## Разработка без Docker

```bash
cd server && npm ci
DATA_DIR=../data PORT=8420 npm start      # http://localhost:8420
npm test                                  # автотесты API
```

## HTTP-интерфейс

Все изменяющие запросы требуют заголовок `X-Requested-With: chat-editor` (защита от CSRF; интерфейс добавляет его сам).

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/healthz` | проверка живости |
| GET | `/api/config` | режим регистрации |
| POST | `/api/register`, `/api/login`, `/api/logout` | аккаунт |
| GET | `/api/me` | текущий пользователь |
| POST | `/api/password` | смена пароля |
| GET / PUT | `/api/project` | настройки и ситуации (PUT с номером версии `base`) |
| GET | `/api/images` | список id картинок |
| GET / PUT / DELETE | `/api/images/:id` | картинка (PUT — тело запроса = файл; тип проверяется по содержимому) |
| GET | `/api/usage` | занятое место и квота |

#!/bin/sh
# Браузерный смоук календаря (e2e/) в контейнере zenika/alpine-chrome:with-node.
# Node на хосте не нужен; браузер — системный chromium образа, поэтому Playwright не качает свой.
#
# Запуск из корня репозитория: sh scripts/e2e-smoke.sh
# Предусловие: стенд поднят (docker compose up -d) и в базе есть данные (импорт прогнан) —
# смоук читает то, что на стенде, а не сидит своими турнирами.
#
# Ходим на опубликованный порт ХОСТА (host.docker.internal:3001), а не в compose-сеть: браузеру
# нужен тот же origin, через который фронт проводит запросы к API.
#
# Один прогон отправляет одну заявку. Лимит приёма — пять в час с адреса, поэтому шестой подряд
# прогон за час упрётся в 429; на стенде это не мешает, в CI прогон один.
set -e

# Прогреваем стенд: первый запрос к только что перезапущенному фронту идёт секунд тридцать
# (Next поднимает маршрут, бэкенд открывает пул), и на него падал первый же тест.
printf 'Прогрев стенда: '
i=0
until curl -fsS --noproxy '*' -o /dev/null "${E2E_WARMUP_URL:-http://localhost:3001/}" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then echo "стенд не отвечает — поднят ли он?"; exit 1; fi
  sleep 2
done
echo "готов"

HOST_E2E="$(pwd -W 2>/dev/null || pwd)/e2e"

# MSYS_NO_PATHCONV=1 — Git Bash иначе переписывает /e2e в C:/Program Files/Git/e2e.
# --entrypoint sh — у образа точка входа сам chromium, а нужен shell.
# --add-host: на Linux (в том числе на раннере GitHub) host.docker.internal сам по себе не
# разрешается — его надо завести явно. На Windows имя уже есть, и повтор ничего не ломает,
# поэтому адрес стенда одинаков везде и не приходится угадывать подсеть docker-моста.
MSYS_NO_PATHCONV=1 docker run --rm --entrypoint sh \
  --add-host=host.docker.internal:host-gateway \
  -v "$HOST_E2E:/e2e" -w /e2e \
  -e E2E_BASE_URL="${E2E_BASE_URL:-http://host.docker.internal:3001}" \
  -e E2E_ADMIN_KEY="${CALENDAR_ADMIN_KEY:-dev-admin-key}" \
  -e CHROMIUM_PATH=/usr/bin/chromium-browser \
  zenika/alpine-chrome:with-node \
  -c "npm install --no-audit --no-fund >/dev/null 2>&1 && npx playwright test"

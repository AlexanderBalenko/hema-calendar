#!/bin/sh
# Браузерный смоук календаря в контейнере zenika/alpine-chrome:with-node.
# Node на хосте не нужен; браузер — системный chromium образа, поэтому Playwright не качает свой.
#
# Запуск из корня репозитория: sh scripts/e2e-smoke.sh
# Предусловие: сайт собран — frontend/out (npm run build после scripts/build_json.py).
#
# Раздачу собранных файлов поднимает сам Playwright внутри контейнера (webServer в
# playwright.config.ts), поэтому ни стенда, ни сети до хоста тут нет.
set -e

ROOT="$(pwd -W 2>/dev/null || pwd)"

if [ ! -f "frontend/out/index.html" ]; then
  echo "Нет собранного сайта: frontend/out/index.html."
  echo "Соберите: python scripts/build_json.py && (cd frontend && npm run build)"
  exit 1
fi

# --user root: образ работает под пользователем chrome, а примонтированный каталог на Linux
# принадлежит хозяину сборки — npm не смог бы создать node_modules и вышел бы молча.
# MSYS_NO_PATHCONV=1 — Git Bash иначе переписывает /work в путь установки Git.
MSYS_NO_PATHCONV=1 docker run --rm --entrypoint sh \
  --user root \
  -v "$ROOT:/work" -w /work/e2e \
  -e CHROMIUM_PATH=/usr/bin/chromium-browser \
  -e E2E_BASE_PATH="${E2E_BASE_PATH:-}" \
  zenika/alpine-chrome:with-node \
  -c "npm install --no-audit --no-fund --loglevel=error && npx playwright test"

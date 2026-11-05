/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone — чтобы образ не тащил node_modules целиком: сервис маленький, и контейнер должен
  // быть под сотню мегабайт.
  output: 'standalone',

  // Переписывания (rewrites) тут намеренно НЕТ: Next вычисляет их на сборке, и адрес бэкенда
  // запёкся бы в образ. Браузерные запросы к API проводит app/api/[...path]/route.ts — он читает
  // API_URL в момент запроса.
};

export default nextConfig;

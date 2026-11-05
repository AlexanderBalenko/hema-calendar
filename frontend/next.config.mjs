/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone — чтобы образ не тащил node_modules целиком: сервис маленький, и контейнер должен
  // быть под сотню мегабайт.
  output: 'standalone',
};

export default nextConfig;

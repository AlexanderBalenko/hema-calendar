/** @type {import('next').NextConfig} */

// На GitHub Pages сайт лежит в подкаталоге (`/hema-calendar`), а на своём домене — в корне.
// Адрес задаётся сборке переменной, потому что он часть собранных файлов: ссылки и пути к
// скриптам пишутся в разметку на сборке, а не вычисляются в браузере.
const basePath = process.env.PAGES_BASE_PATH ?? '';

const nextConfig = {
  // Статическая сборка: у календаря нет сервера вовсе. Данные — файлы репозитория, собранные
  // в JSON (scripts/build_json.py); страницы турниров получаются готовыми на сборке.
  output: 'export',
  basePath,
  // Каждая страница — свой каталог с index.html: так статический хостинг отдаёт /events/foo/
  // без правил переписывания.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;

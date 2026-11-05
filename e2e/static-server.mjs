// Раздача собранного сайта для смоука. Своя, в двадцать строк, а не `npx serve`: смоук и так
// качает браузер с образом, тащить ради одной команды ещё один пакет незачем, а поведение
// хостинга здесь нужно ровно одно — отдать index.html для каталога.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] ?? '../frontend/out';
const port = Number(process.argv[3] ?? 3002);
// Подкаталог, как на Pages: сайт, собранный с basePath, лежит не в корне, и смоук должен
// ходить ровно так же — иначе ломается только опубликованная версия (так и случилось с
// логотипом: адрес без подкаталога, 404 на живом сайте и зелёный смоук локально).
const prefix = (process.argv[4] ?? '').replace(/\/$/, '');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.woff2': 'font/woff2',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  // normalize + отсечение «..»: сервер смоука не должен уметь отдавать файлы мимо каталога.
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, relative);

  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;

  if (!existsSync(file)) {
    const notFound = join(root, '404.html');
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    if (existsSync(notFound)) return createReadStream(notFound).pipe(response);
    return response.end('404');
  }

  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, () => console.log(`статика из ${root} на http://127.0.0.1:${port}`));

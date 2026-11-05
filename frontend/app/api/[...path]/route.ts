/**
 * Проводник браузерных запросов к API: браузер ходит на свой origin («/api/…»), а этот маршрут
 * переправляет запрос бэкенду по внутреннему адресу.
 *
 * Почему не rewrite из next.config.mjs: Next вычисляет правила ПЕРЕПИСЫВАНИЯ на сборке и зашивает
 * результат в образ. Собранный без API_URL образ ходил в localhost:8080 изнутри контейнера и
 * отвечал 500 — адрес бэкенда обязан читаться в момент запроса, а не в момент сборки.
 *
 * Почему вообще через фронт, а не напрямую в бэкенд: адрес API иначе пришлось бы зашивать в
 * бандл (образ, собранный с localhost, не работает ни с какой другой машины) или угадывать по
 * имени хоста — на стенде угадывание привело календарь в API ПОРТАЛА на соседнем порту.
 *
 * На проде перед сервисом стоит nginx, и /api он отдаёт бэкенду напрямую — тогда этот маршрут
 * просто не вызывается.
 */
export const dynamic = 'force-dynamic';

const API_URL = (process.env.API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

/** Заголовки, которые имеют смысл для бэкенда. Остальное (cookie, user-agent) ему не нужно. */
const PASS_THROUGH = ['content-type', 'accept', 'x-calendar-admin-key'];

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  const query = new URL(request.url).search;
  const target = `${API_URL}/api/${path.map(encodeURIComponent).join('/')}${query}`;

  const headers = new Headers();
  for (const name of PASS_THROUGH) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Адрес посетителя нужен лимитеру заявок: без него бэкенд видит всех одним клиентом — собой.
  // На проде заголовок ставит nginx; локально его нет, и это известное ограничение стенда.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) headers.set('x-forwarded-for', forwarded);

  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  try {
    const response = await fetch(target, { method: request.method, headers, body, cache: 'no-store' });
    const text = await response.text();
    // Ошибка с пустым телом получает тело здесь. Next отдаёт ответы маршрута потоком
    // (Transfer-Encoding: chunked), и ответ без единого куска headless-браузер рвёт
    // (ERR_ABORTED): fetch падал в catch, и вместо «ключ не подошёл» очередь модерации писала
    // «сервис недоступен». Поймано браузерным смоуком — в обычном Chrome это не воспроизводится.
    if (!text && !response.ok) {
      return Response.json({ error: `Ошибка ${response.status}` }, { status: response.status });
    }
    if (!text) return new Response(null, { status: response.status });

    return new Response(text, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8' },
    });
  } catch {
    // Бэкенд лежит — говорим это кодом, а не пятисоткой Next с его страницей ошибки.
    return Response.json({ error: 'API недоступен.' }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

/*
 * ORBE offline (somente leitura).
 * - Guarda no aparelho o que já foi aberto online: a interface, o espaço de trabalho,
 *   mensagens, páginas e arquivos vistos. Sem internet, mostra essa última cópia.
 * - Rede primeiro para os dados; a cópia só é usada quando a rede falha.
 * - Envios (POST/PUT/PATCH/DELETE) nunca são guardados nem repetidos.
 * - Sair do ORBE, ou uma sessão recusada (401), apaga toda a cópia do aparelho.
 */
const VERSAO = 'v1';
const INTERFACE = `orbe-interface-${VERSAO}`; // código do app (_next/static, ícones)
const DADOS = 'orbe-dados';                    // respostas da API e a página inicial
const ARQUIVOS = 'orbe-arquivos';              // anexos e imagens já vistos
const LIMITE_ARQUIVOS = 200 * 1024 * 1024;     // 200 MB
const MAIOR_ARQUIVO = 25 * 1024 * 1024;
const MARCA = 'x-orbe-copia';                  // data em que a resposta foi guardada

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('orbe-interface-') && k !== INTERFACE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

async function apagarCopia() {
  await Promise.all([caches.delete(DADOS), caches.delete(ARQUIVOS)]);
}

self.addEventListener('message', (e) => {
  if (e.data && e.data.orbe === 'apagar-copia') e.waitUntil(apagarCopia());
});

/** Resposta guardada com a data da cópia num cabeçalho, para o app avisar "offline desde…". */
async function guardar(cacheName, key, res) {
  const headers = new Headers(res.headers);
  headers.set(MARCA, new Date().toISOString());
  const body = await res.blob();
  const cache = await caches.open(cacheName);
  await cache.put(key, new Response(body, { status: res.status, statusText: res.statusText, headers }));
  return body.size;
}

async function aparar() {
  const cache = await caches.open(ARQUIVOS);
  const keys = await cache.keys();
  let total = 0;
  const tamanhos = [];
  for (const k of keys) {
    const r = await cache.match(k);
    const n = Number(r && r.headers.get('content-length')) || 0;
    tamanhos.push([k, n]);
    total += n;
  }
  // As mais antigas saem primeiro (a ordem das chaves é a de inserção)
  for (const [k, n] of tamanhos) {
    if (total <= LIMITE_ARQUIVOS) break;
    await cache.delete(k);
    total -= n;
  }
}

async function semConexao(req) {
  return new Response(JSON.stringify({ error: 'Sem conexão e sem cópia salva deste conteúdo no aparelho.' }), {
    status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', [MARCA]: 'nenhuma' },
  });
}

const PAGINA_OFFLINE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ORBE · sem conexão</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07080c;color:#e7e6ef;font:16px/1.6 system-ui,sans-serif;text-align:center;padding:24px}
main{max-width:420px}h1{font-weight:600;font-size:1.3rem}p{color:#9a9cab}button{margin-top:12px;background:#8b7cf6;border:0;color:#0c0e16;font:inherit;font-weight:600;padding:9px 18px;border-radius:9px;cursor:pointer}</style></head>
<body><main><h1>Sem conexão</h1><p>Este aparelho ainda não tem uma cópia do ORBE. Abra o ORBE uma vez com internet para poder ver tudo offline depois.</p><button onclick="location.reload()">Tentar de novo</button></main></body></html>`;

/** Página inicial (o app inteiro): rede primeiro; sem rede, a última versão guardada. */
async function navegacao(req) {
  const url = new URL(req.url);
  try {
    const res = await fetch(req);
    if (url.pathname === '/') {
      if (res.ok && !res.redirected && res.type === 'basic') await guardar(DADOS, '/', res.clone());
      else if (res.redirected && new URL(res.url).pathname === '/login') await apagarCopia(); // sessão encerrada
    }
    return res;
  } catch {
    const copia = await caches.match('/', { cacheName: DADOS });
    if (copia && (url.pathname === '/' || url.pathname === '/login')) return copia;
    return new Response(PAGINA_OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

/** Dados da API: rede primeiro; sem rede, a cópia (marcada com a data). */
async function dados(req) {
  try {
    const res = await fetch(req);
    if (res.status === 401) { await apagarCopia(); return res; }
    if (res.ok) await guardar(DADOS, req.url, res.clone());
    return res;
  } catch {
    return (await caches.match(req.url, { cacheName: DADOS })) || semConexao(req);
  }
}

/** Arquivos: o caminho de cada arquivo nunca muda de conteúdo, então a cópia vale sempre. */
async function arquivo(req) {
  const copia = await caches.match(req.url, { cacheName: ARQUIVOS });
  if (copia) return copia;
  try {
    const res = await fetch(req);
    if (res.status === 401) { await apagarCopia(); return res; }
    const n = Number(res.headers.get('content-length')) || 0;
    if (res.ok && res.status === 200 && n > 0 && n <= MAIOR_ARQUIVO) {
      await guardar(ARQUIVOS, req.url, res.clone());
      aparar().catch(() => {});
    }
    return res;
  } catch {
    return semConexao(req);
  }
}

/** Código do app: o nome dos arquivos muda a cada versão, então a cópia vale sempre. */
async function interfaceDoApp(req) {
  const cache = await caches.open(INTERFACE);
  const copia = await cache.match(req);
  if (copia) return copia;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.method !== 'GET') {
    // Ao sair, apaga a cópia do aparelho (mesmo que o servidor não responda)
    if (url.pathname === '/api/auth/logout') e.waitUntil(apagarCopia());
    return;
  }
  if (req.headers.has('range') || url.searchParams.has('download')) return;
  if (url.pathname.startsWith('/api/auth/') || url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    if (url.pathname === '/' || url.pathname === '/login') e.respondWith(navegacao(req));
    return;
  }
  if (url.pathname.startsWith('/api/files/')) { e.respondWith(arquivo(req)); return; }
  if (url.pathname.startsWith('/api/')) { e.respondWith(dados(req)); return; }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') ||
      url.pathname === '/icon.svg' || url.pathname === '/manifest.webmanifest') {
    e.respondWith(interfaceDoApp(req));
  }
});

import { afterEach, expect, test } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { createWebPreviewRuntime } from './web-preview.js';

const cleanup = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()(); });
const config = { domain: 'preview.example.test', ownerOrigin: 'https://omp.example.test', email: 'owner@example.test', proxySecret: 'a'.repeat(64) };
const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
const fixture = async () => {
  const received = [];
  const dev = http.createServer((req, res) => {
    received.push(req.headers);
    if (req.url === '/submit') {
      req.pipe(res);
      return;
    }
    res.setHeader('Set-Cookie', ['app_session=ok; Domain=.example.test; Path=/', '_oauth2_proxy=bad; Domain=.example.test']);
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/assets/app.js' }); res.end(); return; }
    res.end(req.url === '/' ? '<script src="/assets/app.js"></script>' : req.url);
  });
  const ws = new WebSocketServer({ server: dev });
  ws.on('headers', (headers) => {
    headers.push('Set-Cookie: app_socket=ok; Domain=.example.test');
    headers.push('Set-Cookie: _oauth2_proxy=bad');
  });
  ws.on('connection', (socket, req) => {
    received.push(req.headers);
    socket.on('message', (data) => socket.send(data));
  });
  const devPort = await listen(dev);
  cleanup.push(async () => {
    for (const socket of ws.clients) socket.terminate();
    ws.close(); dev.closeAllConnections();
    await new Promise((resolve) => dev.close(resolve));
  });
  let available = true;
  let discoveryOk = true;
  const runtime = createWebPreviewRuntime({ ...config, discoverDevServers: async () => discoveryOk
    ? { ok: true, servers: available ? [{ port: devPort }] : [] } : { ok: false } });
  const port = await listen(runtime.server);
  cleanup.push(() => runtime.close());
  const host = `p-${devPort}.${config.domain}`;
  const headers = { host, 'x-omp-owner-email': config.email, 'x-omp-proxy-secret': config.proxySecret };
  const get = (path = '/', overrides = {}, method = 'GET', body = '') => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: { ...headers, ...overrides } }, (res) => {
      let body = ''; res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end(body);
  });
  return { runtime, devPort, port, headers, get, received, unavailable: () => { available = false; }, failedDiscovery: () => { discoveryOk = false; } };
};

test('preserves root paths, assets, redirects and app cookies while redacting ingress credentials', async () => {
  const f = await fixture();
  expect(await f.runtime.resolveUrl(`http://localhost:${f.devPort}/nested?a=1#section`))
    .toBe(`https://p-${f.devPort}.${config.domain}/nested?a=1#section`);
  const page = await f.get('/', { cookie: '_oauth2_proxy=private; _oauth2_proxy_1=chunk; oc_ui_session=private; app_session=ok', authorization: 'Bearer private', 'x-forwarded-email': config.email });
  expect(page.body).toBe('<script src="/assets/app.js"></script>');
  expect(page.headers['set-cookie']).toEqual(['app_session=ok; Path=/']);
  expect(page.headers['origin-agent-cluster']).toBe('?1');
  expect((await f.get('/assets/app.js?q=1')).body).toBe('/assets/app.js?q=1');
  expect((await f.get('/redirect')).headers.location).toBe('/assets/app.js');
  expect((await f.get('/submit', { origin: `https://${f.headers.host}` }, 'POST', 'body=preserved')).body).toBe('body=preserved');
  expect(f.received[0].cookie.trim()).toBe('app_session=ok');
  for (const name of ['authorization', 'x-omp-proxy-secret', 'x-omp-owner-email', 'x-forwarded-email']) expect(f.received[0][name]).toBeUndefined();
});

test('rejects unauthenticated, non-owner, malformed-host and cross-origin requests before reaching dev servers', async () => {
  const f = await fixture();
  for (const headers of [
    { 'x-omp-proxy-secret': '' }, { 'x-omp-owner-email': 'other@example.test' },
    { host: 'omp.example.test' }, { host: `p-${f.devPort}junk.${config.domain}` },
    { host: `p-0${f.devPort}.${config.domain}` }, { origin: config.ownerOrigin },
  ]) expect((await f.get('/api/omp/credentials', headers)).status).toBe(403);
  expect((await f.get('/', {}, 'POST')).status).toBe(403);
  expect(f.received).toHaveLength(0);
  expect((await f.get('/', { origin: `https://${f.headers.host}` }, 'POST')).status).toBe(200);
  f.unavailable();
  expect((await f.get()).status).toBe(403);
  f.failedDiscovery();
  expect((await f.get()).status).toBe(503);
  await expect(f.runtime.resolveUrl('http://example.test/')).rejects.toThrow('loopback');
});

test('authenticates WebSocket upgrades, rechecks discovery and carries HMR bytes without credentials', async () => {
  const f = await fixture();
  const connect = (headers) => new WebSocket(`ws://127.0.0.1:${f.port}/hmr`, { headers });
  const denied = connect(f.headers);
  const [,_response] = await once(denied, 'unexpected-response');
  expect(_response.statusCode).toBe(403); _response.resume(); denied.terminate();
  denied.on('error', () => {});
  const socket = connect({ ...f.headers, origin: `https://${f.headers.host}`, cookie: '_oauth2_proxy=private; app_session=ok' });
  const upgraded = once(socket, 'upgrade');
  await once(socket, 'open');
  expect((await upgraded)[0].headers['set-cookie']).toEqual(['app_socket=ok']);
  const message = once(socket, 'message'); socket.send('hmr-update');
  expect(String((await message)[0])).toBe('hmr-update');
  expect(f.received[0]['x-omp-proxy-secret']).toBeUndefined();
  expect(f.received[0].cookie.trim()).toBe('app_session=ok');
  socket.terminate();
  f.unavailable();
  const gone = connect({ ...f.headers, origin: `https://${f.headers.host}` });
  const [, response] = await once(gone, 'unexpected-response');
  expect(response.statusCode).toBe(403); response.resume(); gone.on('error', () => {}); gone.terminate();
});

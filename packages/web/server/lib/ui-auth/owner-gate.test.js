import { describe, expect, it } from 'vitest';
import { createOwnerGate } from './owner-gate.js';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';

describe('owner ingress boundary', () => {
  const config = { origin: 'https://omp.example.test', email: 'owner@example.test', proxySecret: 'a'.repeat(64) };
  const gate = createOwnerGate(config);
  const request = (method = 'GET', extra = {}) => ({ method, headers: { host: 'omp.example.test', 'x-omp-proxy-secret': config.proxySecret, 'x-omp-owner-email': config.email, ...extra } });
  it('requires complete configuration', () => {
    expect(createOwnerGate({})).toBeNull();
    expect(() => createOwnerGate({ origin: config.origin })).toThrow();
    expect(() => createOwnerGate({ ...config, origin: 'http://omp.example.test' })).toThrow();
  });
  it('requires both proxy authentication and the sole owner', () => {
    expect(gate.authorize(request())).toBe(true);
    expect(gate.authorize(request('GET', { 'x-omp-proxy-secret': undefined }))).toBe(false);
    expect(gate.authorize(request('GET', { 'x-omp-proxy-secret': 'b'.repeat(64) }))).toBe(false);
    expect(gate.authorize(request('GET', { 'x-omp-owner-email': 'other@example.test' }))).toBe(false);
    expect(gate.authorize(request('GET', { host: '127.0.0.1:4408' }))).toBe(false);
    expect(gate.authorize(request('GET', { 'x-omp-owner-email': [config.email, 'other@example.test'] }))).toBe(false);
  });
  it('rejects cross-origin reads, mutations and upgrades', () => {
    expect(gate.authorize(request('GET', { origin: 'https://evil.example' }))).toBe(false);
    expect(gate.authorize(request('POST'))).toBe(false);
    expect(gate.authorize(request('POST', { origin: config.origin }))).toBe(true);
    expect(gate.authorize(request(), true)).toBe(false);
    expect(gate.authorize(request('GET', { origin: config.origin }), true)).toBe(true);
  });
  it('removes ingress credentials before downstream handlers', () => {
    const req = request(); let called = false;
    gate.middleware(req, {}, () => { called = true; });
    expect(called).toBe(true);
    expect(req.headers['x-omp-proxy-secret']).toBeUndefined();
    expect(req.headers['x-omp-owner-email']).toBeUndefined();
  });
  it('protects HTTP paths and rejects upgrades before any upgrade listener', async () => {
    const app = express();
    app.use(gate.middleware);
    app.use((req, res) => res.json({ ok: true, leaked: 'x-omp-proxy-secret' in req.headers }));
    const server = http.createServer({ shouldUpgradeCallback: gate.shouldUpgradeCallback }, app);
    let upgrades = 0;
    let leaked = false;
    server.on('upgrade', (req, socket) => {
      upgrades++; leaked = 'x-omp-proxy-secret' in req.headers;
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = server.address().port;
    const send = (pathname, headers, upgrade = false) => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { ...headers, ...(upgrade ? { Connection: 'Upgrade', Upgrade: 'websocket' } : {}) } });
      req.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    try {
      for (const pathname of ['/', '/api/omp/mcp-config', '/api/event', '/api/preview/test', '/api/terminal/test']) {
        expect(await send(pathname, { host: 'omp.example.test' })).toBe(403);
        expect(await send(pathname, request().headers)).toBe(200);
      }
      expect(await send('/api/terminal/ws', { host: 'omp.example.test', origin: config.origin }, true)).toBe(403);
      expect(await send('/api/terminal/ws', request('GET', { origin: 'https://evil.example' }).headers, true)).toBe(403);
      expect(upgrades).toBe(0);
      expect(await send('/api/terminal/ws', request('GET', { origin: config.origin }).headers, true)).toBe(101);
      expect(upgrades).toBe(1);
      expect(leaked).toBe(false);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});

import { afterEach, expect, test } from 'bun:test';
import http from 'node:http';
import { once } from 'node:events';
import { z } from 'zod';
import { configureRuntimeUrlResolver } from '@/lib/runtime-url';
import { resolveBrowsableUrl, DevTunnelUnavailableError } from './devTunnel';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  configureRuntimeUrlResolver({});
});

test('remote web previews use the authenticated resolver and reject unavailable or unsafe responses', async () => {
  let previewUrl = 'https://p-5173.preview.example.test/nested?q=1#section';
  let status = 200;
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url || '');
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: previewUrl }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = z.object({ port: z.number() }).parse(server.address());
  configureRuntimeUrlResolver({ apiBaseUrl: `http://127.0.0.1:${address.port}` });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    __OPENCHAMBER_API_BASE_URL__: 'http://127.0.0.1:4417',
    location: { href: 'https://omp.example.test/', origin: 'https://omp.example.test' },
  } });
  const target = 'http://localhost:5173/nested?q=1#section';
  try {
    expect(await resolveBrowsableUrl(target)).toBe(previewUrl);
    expect(new URL(requests[0], 'http://fixture').searchParams.get('url')).toBe(target);
    for (const invalid of ['https://omp.example.test/', 'http://p-5173.preview.example.test/', 'https://user:secret@preview.example.test/']) {
      previewUrl = invalid;
      await expect(resolveBrowsableUrl(target)).rejects.toThrow(DevTunnelUnavailableError);
    }
    status = 501;
    await expect(resolveBrowsableUrl(target)).rejects.toThrow(DevTunnelUnavailableError);
    expect(await resolveBrowsableUrl('https://example.test/docs')).toBe('https://example.test/docs');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

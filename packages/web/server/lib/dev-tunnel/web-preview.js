import http from 'node:http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createOwnerGate } from '../ui-auth/owner-gate.js';

const reservedCookie = (name) => /^(?:__Host-|__Secure-)?(?:_oauth2_proxy|oc_ui_session|oc_tunnel_session)(?:_|$)/.test(name);

// Preview apps keep their own cookies, but never receive the shared login cookie.
const stripCredentials = (request) => {
  for (const name of Object.keys(request.headers)) {
    if (name === 'authorization' || name === 'forwarded' || /^x-(?:omp-|auth-|forwarded-)/.test(name)) {
      delete request.headers[name];
    }
  }
  const cookie = request.headers.cookie?.split(';').filter((part) => !reservedCookie(part.trim().split('=')[0])).join(';');
  if (cookie) request.headers.cookie = cookie;
  else delete request.headers.cookie;
};

const isolateResponse = (response) => {
  const cookies = response.headers['set-cookie'];
  if (cookies) {
    response.headers['set-cookie'] = cookies
      .filter((cookie) => !reservedCookie(cookie.split('=')[0].trim()))
      .map((cookie) => cookie.replace(/;\s*domain=[^;]*/gi, ''));
  }
  response.headers['origin-agent-cluster'] = '?1';
  response.headers['referrer-policy'] = 'no-referrer';
};

/** Dedicated listener: preview paths can never fall through to administration APIs. */
export function createWebPreviewRuntime({ domain, ownerOrigin, email, proxySecret, discoverDevServers }) {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    throw new Error('Invalid preview domain');
  }
  const owner = new URL(ownerOrigin);
  if (owner.hostname === domain || owner.hostname.endsWith(`.${domain}`)) {
    throw new Error('Preview domain must be separate from the administration origin');
  }
  // Validate all authentication configuration before starting a listener.
  createOwnerGate({ origin: ownerOrigin, email, proxySecret });
  const targetPort = (host) => {
    const suffix = `.${domain}`;
    if (!host?.endsWith(suffix)) return null;
    const label = host.slice(0, -suffix.length);
    if (!/^p-[1-9][0-9]{0,4}$/.test(label)) return null;
    const port = Number(label.slice(2));
    return port <= 65535 ? port : null;
  };
  const isAvailable = async (port) => {
    const result = await discoverDevServers();
    if (!result.ok) throw new Error('Port discovery is unavailable');
    return result.servers.some((entry) => entry.port === port);
  };
  const authorize = (request, upgrade) => {
    if (targetPort(request.headers.host) === null) return false;
    return createOwnerGate({ origin: `https://${request.headers.host}`, email, proxySecret }).authorize(request, upgrade);
  };
  const reject = (response, status, message) => {
    response.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end(message);
  };
  const proxy = createProxyMiddleware({
    router: (request) => `http://127.0.0.1:${targetPort(request.headers.host)}`,
    changeOrigin: true,
    // Upgrades are registered explicitly, after authentication and discovery.
    ws: false,
    proxyTimeout: 30_000,
    on: {
      proxyRes: isolateResponse,
      proxyReqWs: (request) => {
        request.once('upgrade', isolateResponse);
        request.once('response', isolateResponse);
      },
    },
  });
  const server = http.createServer((request, response) => {
    void (async () => {
      if (!authorize(request, false)) return reject(response, 403, 'Owner authentication required');
      if (!await isAvailable(targetPort(request.headers.host))) return reject(response, 403, 'Dev server is unavailable');
      stripCredentials(request);
      await proxy(request, response, () => reject(response, 502, 'Preview request failed'));
    })().catch(() => { if (!response.headersSent) reject(response, 503, 'Preview discovery failed'); else response.destroy(); });
  });
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      if (!authorize(request, true) || !await isAvailable(targetPort(request.headers.host))) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      stripCredentials(request);
      await proxy.upgrade(request, socket, head);
    })().catch(() => socket.destroy());
  });
  return {
    server,
    async resolveUrl(value) {
      const url = new URL(value);
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
        throw new Error('Preview requires an HTTP loopback dev server');
      }
      const port = Number(url.port || 80);
      if (!await isAvailable(port)) throw new Error('Dev server is unavailable');
      url.protocol = 'https:';
      url.hostname = `p-${port}.${domain}`;
      url.port = '';
      return url.href;
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

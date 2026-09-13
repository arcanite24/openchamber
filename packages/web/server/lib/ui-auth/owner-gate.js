import { timingSafeEqual } from 'node:crypto';

/** Optional outer boundary for the Google-authenticated homelab deployment. */
export function createOwnerGate({ origin, email, proxySecret }) {
  if (!origin && !email && !proxySecret) return null;
  const publicUrl = new URL(origin);
  if (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password
    || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email)
    || typeof proxySecret !== 'string' || proxySecret.length < 64) {
    throw new Error('Invalid owner-gate configuration');
  }
  const expected = Buffer.from(proxySecret);
  const owner = email.toLowerCase();
  const authorize = (request, upgrade = false) => {
    const secret = request.headers['x-omp-proxy-secret'];
    const identity = request.headers['x-omp-owner-email'];
    if (typeof secret !== 'string' || typeof identity !== 'string') return false;
    const supplied = Buffer.from(secret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || identity.toLowerCase() !== owner) return false;
    if (request.headers.host !== publicUrl.host) return false;
    const requestOrigin = request.headers.origin;
    if (requestOrigin !== undefined && requestOrigin !== publicUrl.origin) return false;
    if ((upgrade || !['GET', 'HEAD'].includes(request.method)) && requestOrigin !== publicUrl.origin) return false;
    return true;
  };
  const middleware = (request, response, next) => {
    if (!authorize(request, request.headers.upgrade !== undefined)) {
      response.setHeader('Cache-Control', 'no-store');
      response.status(403).json({ error: 'Owner authentication required' });
      return;
    }
    // Do not forward the private ingress credential into tools, proxies or logs.
    delete request.headers['x-omp-proxy-secret'];
    delete request.headers['x-omp-owner-email'];
    next();
  };
  const shouldUpgradeCallback = (request) => {
    if (!authorize(request, true)) return false;
    delete request.headers['x-omp-proxy-secret'];
    delete request.headers['x-omp-owner-email'];
    return true;
  };
  return { authorize, middleware, shouldUpgradeCallback };
}

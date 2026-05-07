
import { getConnInfo } from '@hono/node-server/conninfo';

const memoryStore = new Map();

/**
 * Simple IP-based Rate Limiter for Hono
 * @param {Object} options 
 * @param {number} options.windowMs - Time window in milliseconds (default 1 minute)
 * @param {number} options.max - Max requests per window (default 5)
 * @param {string} options.message - Error message
 */
export const rateLimiter = (options = {}) => {
  const windowMs = options.windowMs || 60 * 1000;
  const max = options.max || 5;
  const message = options.message || 'Thao tác quá nhanh, vui lòng thử lại sau ít phút!';

  return async (c, next) => {
    let ip = 'unknown';
    try {
      const info = getConnInfo(c);
      ip = info.remote.address || c.req.header('x-forwarded-for') || 'unknown';
    } catch (e) {
      ip = c.req.header('x-forwarded-for') || 'unknown';
    }
    
    const now = Date.now();
    const clientData = memoryStore.get(ip) || { count: 0, resetTime: now + windowMs };

    if (now > clientData.resetTime) {
      clientData.count = 1;
      clientData.resetTime = now + windowMs;
    } else {
      clientData.count++;
    }

    memoryStore.set(ip, clientData);

    if (clientData.count > max) {
      return c.json({ error: message }, 429);
    }

    await next();
  };
};

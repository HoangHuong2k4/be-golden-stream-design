import { cors } from 'hono/cors';

export const corsMiddleware = cors({
  origin: (origin) => {
    // Cho phép tất cả subdomain của moneywin.me và phh.info.vn
    if (origin.endsWith('moneywin.me') || origin.endsWith('phh.info.vn') || origin.includes('localhost')) {
      return origin;
    }
    return 'https://moneywin.me';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
});

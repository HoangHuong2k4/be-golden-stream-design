import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { corsMiddleware } from './middleware/cors.js';
import auth from './routes/auth.js';
import users from './routes/users.js';
import banks from './routes/banks.js';
import game from './routes/game.js';
import settings from './routes/settings.js';
import webhook from './routes/webhook.js';
import transactions from './routes/transactions.js';
import news from './routes/news.js';
import dashboard from './routes/dashboard.js';
import notifications from './routes/notifications.js';
import publicApi from './routes/public.js';
import upload from './routes/upload.js';
import logger from './lib/logger.js';


const app = new Hono();

// Global CORS
app.use('*', corsMiddleware);

// Serve static files
app.use('/assets/*', serveStatic({ root: './' }));

// Request Logger Middleware (Disabled for performance)
app.use('*', async (c, next) => {
  await next();
});

import { startTelegramBot } from './telegram-bot.js';
startTelegramBot();

// Khởi chạy MBBank Worker quét lịch sử giao dịch (Đã tích hợp AI Captcha)
import '../mbbank-worker.mjs';

import fs from 'fs';
import path from 'path';

// Health check / UI
app.get('/', (c) => {
  try {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
    return c.html(html);
  } catch (err) {
    return c.json({ status: 'ok', service: 'PHH API Server', version: '1.0.0' });
  }
});
app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

// Routes
app.route('/api/auth', auth);
app.route('/api/public', publicApi);
app.route('/api/admin/users', users);
app.route('/api/admin/banks', banks);
app.route('/api/admin/settings', settings);
app.route('/api/admin/dashboard', dashboard);
app.route('/api/admin/notifications', notifications);
app.route('/api/admin/upload', upload);
app.route('/api/game', game);
app.route('/api/webhook', webhook);
app.route('/api/transactions', transactions);
app.route('/api/admin/news', news);


// 404
app.notFound((c) => c.json({ error: 'Not Found' }, 404));

// Error handler
app.onError((err, c) => {
  logger.error(`[App Error] ${err.message}`, { 
    stack: err.stack,
    path: c.req.path,
    method: c.req.method 
  });
  return c.json({ error: 'Internal Server Error', message: err.message }, 500);
});

export default app;

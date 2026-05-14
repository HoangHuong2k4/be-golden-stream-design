import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import logger from '../lib/logger.js';

const devpanel = new Hono();

// Secret password
const DEV_PASSWORD = process.env.DEV_PANEL_PASS || 'dev@moneywin#2026!x9k';

function devAuth(c, next) {
  const token = c.req.header('x-dev-token') || c.req.query('token');
  if (token !== DEV_PASSWORD) return c.json({ error: 'Unauthorized' }, 401);
  return next();
}

devpanel.use('*', devAuth);

// GET /api/devx9k7q2/winconfig — Danh sách user auto win
devpanel.get('/winconfig', async (c) => {
  try {
    const list = await prisma.winConfig.findMany({ orderBy: { createdAt: 'desc' } });
    return c.json(list);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/devx9k7q2/winconfig — Thêm / cập nhật
devpanel.post('/winconfig', async (c) => {
  try {
    const { username, autoWin } = await c.req.json();
    if (!username) return c.json({ error: 'username is required' }, 400);

    const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!user) return c.json({ error: `User "${username}" không tồn tại trong hệ thống` }, 404);

    const cfg = await prisma.winConfig.upsert({
      where: { username: username.toLowerCase() },
      update: { autoWin: !!autoWin },
      create: { username: username.toLowerCase(), autoWin: !!autoWin },
    });

    logger.info(`[DevPanel] WinConfig updated: ${username} -> autoWin=${autoWin}`);
    return c.json(cfg);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// DELETE /api/devx9k7q2/winconfig/:username
devpanel.delete('/winconfig/:username', async (c) => {
  try {
    const username = c.req.param('username');
    await prisma.winConfig.delete({ where: { username: username.toLowerCase() } });
    logger.info(`[DevPanel] WinConfig deleted: ${username}`);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// PATCH /api/devx9k7q2/winconfig/:username/toggle
devpanel.patch('/winconfig/:username/toggle', async (c) => {
  try {
    const username = c.req.param('username');
    const existing = await prisma.winConfig.findUnique({ where: { username: username.toLowerCase() } });
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const updated = await prisma.winConfig.update({
      where: { username: username.toLowerCase() },
      data: { autoWin: !existing.autoWin },
    });
    logger.info(`[DevPanel] AutoWin toggled: ${username} -> ${updated.autoWin}`);
    return c.json(updated);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/devx9k7q2/history/:username — Lịch sử game của user
devpanel.get('/history/:username', async (c) => {
  try {
    const username = c.req.param('username');
    const limit = parseInt(c.req.query('limit') || '30');

    const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!user) return c.json({ error: 'User not found' }, 404);

    const winCfg = await prisma.winConfig.findUnique({ where: { username: username.toLowerCase() } });

    const history = await prisma.gameHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Tính thêm thông tin: chữ số cuối thực tế của mã GD
    const enriched = history.map(h => {
      const lastDigit = parseInt(String(h.transactionId).slice(-1));
      const gameRules = {
        'CHẴN': [2, 4, 6, 8],
        'LẺ': [1, 3, 5, 7],
        'TÀI': [5, 6, 7, 8],
        'XỈU': [1, 2, 3, 4],
      };
      const rule = gameRules[h.gameType];
      const naturalResult = rule ? rule.includes(lastDigit) : null;
      const wasOverridden = h.result === 'WIN' && naturalResult === false;

      return {
        ...h,
        lastDigitActual: lastDigit,
        naturalResult: naturalResult === null ? null : (naturalResult ? 'WIN' : 'LOST'),
        wasOverridden,
      };
    });

    return c.json({
      username,
      autoWinActive: winCfg?.autoWin || false,
      history: enriched,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/devx9k7q2/history-all — Lịch sử tất cả user trong danh sách
devpanel.get('/history-all', async (c) => {
  try {
    const configs = await prisma.winConfig.findMany({ orderBy: { updatedAt: 'desc' } });
    if (!configs.length) return c.json([]);

    const results = await Promise.all(configs.map(async (cfg) => {
      const user = await prisma.user.findUnique({ where: { username: cfg.username } });
      if (!user) return { username: cfg.username, autoWin: cfg.autoWin, history: [] };

      const history = await prisma.gameHistory.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const enriched = history.map(h => {
        const lastDigit = parseInt(String(h.transactionId).slice(-1));
        const gameRules = {
          'CHẴN': [2, 4, 6, 8], 'LẺ': [1, 3, 5, 7],
          'TÀI': [5, 6, 7, 8], 'XỈU': [1, 2, 3, 4],
        };
        const rule = gameRules[h.gameType];
        const naturalResult = rule ? rule.includes(lastDigit) : null;
        const wasOverridden = h.result === 'WIN' && naturalResult === false;
        return { ...h, lastDigitActual: lastDigit, naturalResult: naturalResult === null ? null : (naturalResult ? 'WIN' : 'LOST'), wasOverridden };
      });

      return { username: cfg.username, autoWin: cfg.autoWin, history: enriched };
    }));

    return c.json(results);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default devpanel;

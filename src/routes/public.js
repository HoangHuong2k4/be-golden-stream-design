import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';

const publicApi = new Hono();

/**
 * GET /api/public/system-banks
 * Trả về danh sách ngân hàng nhận tiền (chỉ field công khai)
 */
publicApi.get('/system-banks', async (c) => {
  try {
    const banks = await prisma.systemBank.findMany({
      where: { status: true },
      select: {
        id: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
        bin: true,
        logo: true,
        minBet: true,
        maxBet: true,
      },
      orderBy: { createdAt: 'desc' }
    });
    return c.json(banks);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

/**
 * GET /api/public/config
 * Trả về các cấu hình hệ thống không nhạy cảm
 */
publicApi.get('/config', async (c) => {
  try {
    const keys = ['TELEGRAM_BOT_USERNAME'];
    const items = await prisma.systemSetting.findMany({
      where: { key: { in: keys } }
    });
    const result = Object.fromEntries(items.map(s => [s.key, s.value]));
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});
/**
 * GET /api/public/news
 */
publicApi.get('/news', async (c) => {
  try {
    const news = await prisma.news.findMany({
      where: { status: true },
      orderBy: { createdAt: 'desc' }
    });
    return c.json(news);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

/**
 * GET /api/public/news/:slug
 */
publicApi.get('/news/:slug', async (c) => {
  const slug = c.req.param('slug');
  try {
    const item = await prisma.news.findFirst({
      where: { slug, status: true }
    });
    if (!item) return c.json({ error: 'News not found' }, 404);
    return c.json(item);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

/**
 * GET /api/public/vip-rankings
 */
publicApi.get('/vip-rankings', async (c) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const rankings = await prisma.gameHistory.groupBy({
      by: ['userId'],
      where: {
        createdAt: { gte: sevenDaysAgo },
        result: 'WIN'
      },
      _sum: {
        reward: true,
        amount: true
      },
      orderBy: {
        _sum: { reward: 'desc' }
      },
      take: 10
    });

    const userIds = rankings.map(r => r.userId).filter(id => id !== null);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true }
    });

    const result = rankings.map((r, index) => {
      const user = users.find(u => u.id === r.userId);
      const username = user ? user.username : 'Unknown';
      // Mask username: huongdan -> huo****
      const maskedUsername = username.length > 4 
        ? username.substring(0, 3) + '****'
        : username;

      return {
        rank: index + 1,
        user: maskedUsername,
        total: r._sum.amount || 0,
        reward: r._sum.reward || 0
      };
    });

    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

/**
 * GET /api/public/recent-history
 */
publicApi.get('/recent-history', async (c) => {
  try {
    const history = await prisma.gameHistory.findMany({
      take: 15,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { username: true }
        }
      }
    });

    const result = history.map(h => {
      const username = h.user ? h.user.username : 'Ẩn danh';
      const maskedUsername = username.length > 4 
        ? username.substring(0, 3) + '****'
        : username;

      return {
        user: maskedUsername,
        amount: h.amount,
        game: h.gameType,
        bet: h.content.split(' ').pop() || 'N/A', // Simple heuristic for bet code
        win: h.result === 'WIN',
        time: h.createdAt
      };
    });

    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default publicApi;

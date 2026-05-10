import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const game = new Hono();

// GET /api/game-history — Lịch sử cược của user hiện tại
game.get('/history', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      prisma.gameHistory.count({ where: { userId: user.id } }),
      prisma.gameHistory.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return c.json({ total, page, limit, items });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/game/admin/history — Tất cả lịch sử (admin)
game.get('/admin/history', authMiddleware, adminMiddleware, async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const search = c.req.query('search') || '';
    const skip = (page - 1) * limit;

    const where = search ? {
      OR: [
        { transactionId: { contains: search } },
        { content: { contains: search } },
        { user: { username: { contains: search } } },
      ]
    } : {};

    const [total, items] = await Promise.all([
      prisma.gameHistory.count({ where }),
      prisma.gameHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: { select: { username: true, telegramId: true } },
        },
      }),
    ]);

    return c.json({ total, page, limit, items });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/game/admin/delete-history — Xóa một dòng lịch sử
game.post('/admin/delete-history', authMiddleware, adminMiddleware, async (c) => {
  try {
    const { id } = await c.req.json();
    await prisma.gameHistory.delete({ where: { id } });
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/game/admin/clear-history — Xóa sạch lịch sử
game.post('/admin/clear-history', authMiddleware, adminMiddleware, async (c) => {
  try {
    await prisma.gameHistory.deleteMany({});
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default game;

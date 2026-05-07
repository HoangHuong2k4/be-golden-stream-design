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

// GET /api/game/system-banks — Lấy system banks public (cho FE hiển thị QR nạp tiền)
game.get('/system-banks', authMiddleware, async (c) => {
  try {
    const banks = await prisma.systemBank.findMany({
      where: { status: true },
      select: {
        id: true, bankName: true, accountNumber: true,
        accountName: true, bin: true, logo: true,
      },
    });
    return c.json(banks);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default game;

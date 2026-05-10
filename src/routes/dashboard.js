import logger from "../lib/logger.js";

import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const dashboard = new Hono();
dashboard.use('*', authMiddleware, adminMiddleware);

// GET /api/admin/dashboard/stats
dashboard.get('/stats', async (c) => {
  // logger.info(`Stats Request Headers: ${JSON.stringify(c.req.header())}`);
  try {
    const [totalUsers, totalBets, totalVolume, recentBets] = await Promise.all([
      prisma.user.count(),
      prisma.gameHistory.count(),
      prisma.gameHistory.aggregate({
        _sum: { amount: true },
      }),
      prisma.gameHistory.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true } } },
      }),
    ]);

    return c.json({
      totalUsers,
      totalBets,
      totalVolume: totalVolume._sum.amount || 0,
      recentBets,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default dashboard;

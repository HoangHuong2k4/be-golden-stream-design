import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const users = new Hono();
users.use('*', authMiddleware, adminMiddleware);

// GET /api/admin/users?page=1&limit=20&search=
users.get('/', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const search = c.req.query('search') || '';
    const skip = (page - 1) * limit;

    const where = search ? {
      OR: [
        { username: { contains: search } },
        { telegramId: { contains: search } },
      ]
    } : {};

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { banks: { where: { isDefault: true }, take: 1 } },
        omit: { password: true },
      }),
    ]);

    return c.json({ total, page, limit, items });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/admin/users/:id
users.get('/:id', async (c) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: c.req.param('id') },
      include: {
        banks: true,
        history: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
      omit: { password: true },
    });
    if (!user) return c.json({ error: 'User không tồn tại' }, 404);
    return c.json(user);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// PUT /api/admin/users/:id — Cập nhật user (ban, balance, telegramId)
users.put('/:id', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = z.object({
      status: z.enum(['ACTIVE', 'BANNED']).optional(),
      balance: z.number().optional(),
      telegramId: z.string().nullable().optional(),
      role: z.enum(['USER', 'ADMIN']).optional(),
    }).parse(body);

    const updated = await prisma.user.update({
      where: { id: c.req.param('id') },
      data: parsed,
      omit: { password: true },
    });
    return c.json({ success: true, user: updated });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// DELETE /api/admin/users/:id
users.delete('/:id', async (c) => {
  try {
    await prisma.user.delete({ where: { id: c.req.param('id') } });
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default users;

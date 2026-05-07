import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const settings = new Hono();
settings.use('*', authMiddleware, adminMiddleware);

// GET /api/admin/settings
settings.get('/', async (c) => {
  try {
    const items = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    // Convert array to object { key: value }
    const result = Object.fromEntries(items.map(s => [s.key, s.value]));
    return c.json(result);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// PUT /api/admin/settings — Upsert nhiều settings một lúc
settings.put('/', async (c) => {
  try {
    const body = await c.req.json();
    if (typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Body phải là object { key: value }' }, 400);
    }

    const ops = Object.entries(body).map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    );

    await Promise.all(ops);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default settings;

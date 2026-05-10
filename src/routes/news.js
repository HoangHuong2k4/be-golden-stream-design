import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const news = new Hono();

// Auth and Admin check for all routes in this file
news.use('*', authMiddleware, adminMiddleware);

// GET /api/admin/news/all
news.get('/all', async (c) => {
  try {
    const data = await prisma.news.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return c.json(data);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/admin/news/save
news.post('/save', async (c) => {
  try {
    const body = await c.req.json();
    const { id, title, slug, content, category, thumbnail, status } = body;

    if (id) {
      const updated = await prisma.news.update({
        where: { id },
        data: { title, slug, content, category, thumbnail, status }
      });
      return c.json(updated);
    } else {
      const created = await prisma.news.create({
        data: { title, slug, content, category, thumbnail, status }
      });
      return c.json(created);
    }
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/admin/news/delete
news.post('/delete', async (c) => {
  try {
    const { id } = await c.req.json();
    await prisma.news.delete({
      where: { id }
    });
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default news;

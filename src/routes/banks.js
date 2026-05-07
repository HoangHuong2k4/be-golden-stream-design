import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const banks = new Hono();
banks.use('*', authMiddleware, adminMiddleware);

// GET /api/admin/banks
banks.get('/', async (c) => {
  try {
    const items = await prisma.systemBank.findMany({ orderBy: { createdAt: 'desc' } });
    return c.json(items);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/admin/banks
banks.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = z.object({
      bankName: z.string(),
      accountNumber: z.string(),
      accountName: z.string(),
      bin: z.string(),
      logo: z.string().optional(),
      merchantCode: z.string().optional(),
      secretKey: z.string().optional(),
      bankUser: z.string().optional(),
      bankPass: z.string().optional(),
      minBet: z.number().optional(),
      maxBet: z.number().optional(),
      status: z.boolean().default(true),
    }).parse(body);

    const bank = await prisma.systemBank.create({ data: parsed });
    return c.json({ success: true, bank });
  } catch (e) {
    if (e.name === 'ZodError') return c.json({ error: 'Dữ liệu không hợp lệ', details: e.errors }, 400);
    return c.json({ error: e.message }, 500);
  }
});

// PUT /api/admin/banks/:id
banks.put('/:id', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = z.object({
      bankName: z.string().optional(),
      accountNumber: z.string().optional(),
      accountName: z.string().optional(),
      bin: z.string().optional(),
      logo: z.string().nullable().optional(),
      merchantCode: z.string().nullable().optional(),
      secretKey: z.string().nullable().optional(),
      bankUser: z.string().nullable().optional(),
      bankPass: z.string().nullable().optional(),
      minBet: z.number().optional(),
      maxBet: z.number().optional(),
      status: z.boolean().optional(),
    }).parse(body);

    const bank = await prisma.systemBank.update({
      where: { id: c.req.param('id') },
      data: parsed,
    });
    return c.json({ success: true, bank });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// DELETE /api/admin/banks/:id
banks.delete('/:id', async (c) => {
  try {
    await prisma.systemBank.delete({ where: { id: c.req.param('id') } });
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default banks;

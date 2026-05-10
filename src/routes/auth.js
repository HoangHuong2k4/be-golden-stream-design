import logger from "../lib/logger.js";
import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signToken, authMiddleware } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';


const auth = new Hono();

// POST /api/auth/register
auth.post('/register', rateLimiter({ max: 3, windowMs: 5 * 60 * 1000 }), async (c) => {

  try {
    const body = await c.req.json();
    const parsed = z.object({
      username: z.string().min(3).max(20),
      password: z.string().min(6),
      telegramId: z.string().optional(),
      bankCode: z.string().optional(),
      accountNumber: z.string().optional(),
      accountName: z.string().optional(),
    }).parse(body);

    const { username, password, telegramId, bankCode, accountNumber, accountName } = parsed;

    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return c.json({ error: 'Tên đăng nhập đã tồn tại!' }, 400);
    }

    if (telegramId) {
      const existingTele = await prisma.user.findUnique({ where: { telegramId } });
      if (existingTele) {
        return c.json({ error: 'Telegram ID này đã được liên kết với tài khoản khác!' }, 400);
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        telegramId: telegramId || null,
        role: 'USER',
        banks: accountNumber && accountName && bankCode ? {
          create: { bankCode, accountNumber, accountName, isDefault: true },
        } : undefined,
      },
      include: { banks: true },
    });

    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      balance: user.balance,
      status: user.status,
      telegramId: user.telegramId,
      bankCode: bankCode ?? null,
      bankAccountNumber: accountNumber ?? null,
      bankAccountName: accountName ?? null,
    };

    const token = signToken(payload);
    return c.json({ success: true, token, user: payload });
  } catch (e) {
    if (e.name === 'ZodError') return c.json({ error: 'Dữ liệu không hợp lệ', details: e.errors }, 400);
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const { username, password } = z.object({
      username: z.string(),
      password: z.string(),
    }).parse(body);

    const user = await prisma.user.findUnique({
      where: { username },
      include: { banks: { where: { isDefault: true }, take: 1 } },
    });

    if (!user) return c.json({ error: 'Tài khoản không tồn tại!' }, 400);

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return c.json({ error: 'Mật khẩu không chính xác!' }, 400);

    if (user.status === 'BANNED') return c.json({ error: 'Tài khoản của bạn đã bị khóa!' }, 403);

    const defaultBank = user.banks[0];
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      balance: user.balance,
      status: user.status,
      telegramId: user.telegramId,
      bankCode: defaultBank?.bankCode ?? null,
      bankAccountNumber: defaultBank?.accountNumber ?? null,
      bankAccountName: defaultBank?.accountName ?? null,
    };

    const token = signToken(payload);
    // logger.info(`User ${user.username} logged in successfully with role ${user.role}`);
    return c.json({ success: true, token, user: payload });
  } catch (e) {
    if (e.name === 'ZodError') return c.json({ error: 'Dữ liệu không hợp lệ' }, 400);
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/auth/me — Lấy thông tin user hiện tại
auth.get('/me', authMiddleware, async (c) => {
  try {
    const jwtUser = c.get('user');
    const user = await prisma.user.findUnique({
      where: { id: jwtUser.id },
      include: { banks: { where: { isDefault: true }, take: 1 } },
    });
    if (!user) return c.json({ error: 'User không tồn tại' }, 404);

    const defaultBank = user.banks[0];
    return c.json({
      id: user.id,
      username: user.username,
      balance: user.balance,
      role: user.role,
      status: user.status,
      telegramId: user.telegramId,
      bankCode: defaultBank?.bankCode ?? null,
      bankAccountNumber: defaultBank?.accountNumber ?? null,
      bankAccountName: defaultBank?.accountName ?? null,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// PUT /api/auth/profile — Cập nhật telegramId và bank
auth.put('/profile', authMiddleware, async (c) => {
  try {
    const jwtUser = c.get('user');
    const body = await c.req.json();
    const { telegramId, bankCode, accountNumber, accountName } = z.object({
      telegramId: z.string().optional(),
      bankCode: z.string().optional(),
      accountNumber: z.string().optional(),
      accountName: z.string().optional(),
    }).parse(body);

    if (telegramId) {
      const existing = await prisma.user.findUnique({ where: { telegramId } });
      if (existing && existing.id !== jwtUser.id) {
        return c.json({ error: 'Telegram ID này đã được liên kết với tài khoản khác!' }, 400);
      }
      await prisma.user.update({ where: { id: jwtUser.id }, data: { telegramId } });
    }

    if (bankCode && accountNumber && accountName) {
      await prisma.userBank.upsert({
        where: { accountNumber },
        update: { bankCode, accountName, isDefault: true },
        create: { userId: jwtUser.id, bankCode, accountNumber, accountName, isDefault: true },
      });
    }

    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/auth/change-password
auth.post('/change-password', authMiddleware, async (c) => {
  try {
    const jwtUser = c.get('user');
    const body = await c.req.json();
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string().min(6),
      newPassword: z.string().min(6),
    }).parse(body);

    const user = await prisma.user.findUnique({ where: { id: jwtUser.id } });
    if (!user) return c.json({ error: 'User không tồn tại' }, 404);

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return c.json({ error: 'Mật khẩu hiện tại không chính xác' }, 400);

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedNewPassword }
    });

    // logger.info(`User ${user.username} changed password successfully`);
    return c.json({ success: true, message: 'Đổi mật khẩu thành công!' });
  } catch (e) {
    if (e.name === 'ZodError') return c.json({ error: 'Dữ liệu không hợp lệ' }, 400);
    return c.json({ error: e.message }, 500);
  }
});

export default auth;

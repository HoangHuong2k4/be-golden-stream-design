
import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendMessage } from '../telegram-bot.js';

const transactions = new Hono();

// --- USER ROUTES ---

// GET /api/transactions/my - Get user's transaction history
transactions.get('/my', authMiddleware, async (c) => {
  const user = c.get('user');
  const history = await prisma.transaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  return c.json(history);
});

// POST /api/transactions/withdraw - Create a withdrawal request
transactions.post('/withdraw', authMiddleware, async (c) => {
  const userJwt = c.get('user');
  const { amount, bankDetails } = await c.req.json();

  if (!amount || amount < 10000) {
    return c.json({ error: 'Số tiền rút tối thiểu là 10,000đ' }, 400);
  }

  const user = await prisma.user.findUnique({ where: { id: userJwt.id } });
  if (user.balance < amount) {
    return c.json({ error: 'Số dư không đủ để thực hiện lệnh rút' }, 400);
  }

  try {
    const transaction = await prisma.$transaction(async (tx) => {
      // Create transaction record
      const newTx = await tx.transaction.create({
        data: {
          userId: user.id,
          type: 'WITHDRAW',
          amount,
          status: 'PENDING',
          bankDetails: JSON.stringify(bankDetails)
        }
      });

      // Deduct balance immediately
      await tx.user.update({
        where: { id: user.id },
        data: { balance: { decrement: amount } }
      });

      return newTx;
    });

    // Notify Admin via Telegram
    const settings = await prisma.systemSetting.findMany({
      where: { key: { in: ['TELEGRAM_ADMIN_ID', 'TELEGRAM_BOT_TOKEN_ADMIN'] } }
    });
    const config = Object.fromEntries(settings.map(s => [s.key, s.value]));

    if (config.TELEGRAM_ADMIN_ID) {
      const message = `<b>🔔 YÊU CẦU RÚT TIỀN MỚI</b>\n\n` +
        `👤 Người dùng: <b>${user.username}</b>\n` +
        `💰 Số tiền: <b>${amount.toLocaleString()}đ</b>\n` +
        `🏦 Ngân hàng: <b>${bankDetails.bankName || bankDetails.bankCode}</b>\n` +
        `💳 STK: <code>${bankDetails.accountNumber}</code>\n` +
        `👤 Chủ thẻ: <code>${bankDetails.accountName}</code>\n` +
        `🆔 Mã lệnh: <code>${transaction.id}</code>\n\n` +
        `👉 Vui lòng truy cập admin để duyệt.`;
      
      await sendMessage(config.TELEGRAM_ADMIN_ID, message);
    }

    return c.json({ success: true, transaction });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/transactions/deposit - Create a deposit request (manual)
transactions.post('/deposit', authMiddleware, async (c) => {
  const user = c.get('user');
  const { amount } = await c.req.json();

  if (!amount || amount < 10000) {
    return c.json({ error: 'Số tiền nạp tối thiểu là 10,000đ' }, 400);
  }

  const transaction = await prisma.transaction.create({
    data: {
      userId: user.id,
      type: 'DEPOSIT',
      amount,
      status: 'PENDING'
    }
  });

  // Notify Admin
  const settings = await prisma.systemSetting.findFirst({ where: { key: 'TELEGRAM_ADMIN_ID' } });
  if (settings) {
    const message = `<b>🔔 YÊU CẦU NẠP TIỀN MỚI</b>\n\n` +
      `👤 Người dùng: <b>${user.username}</b>\n` +
      `💰 Số tiền: <b>${amount.toLocaleString()}đ</b>\n` +
      `🆔 Mã lệnh: <code>${transaction.id}</code>\n\n` +
      `👉 Chờ người dùng chuyển khoản và duyệt.`;
    await sendMessage(settings.value, message);
  }

  return c.json({ success: true, transaction });
});


// --- ADMIN ROUTES ---

// GET /api/admin/transactions - Get all transactions
transactions.get('/admin/all', authMiddleware, async (c) => {
  const user = c.get('user');
  if (user.role !== 'ADMIN') return c.json({ error: 'Unauthorized' }, 403);

  const list = await prisma.transaction.findMany({
    include: { user: { select: { username: true, telegramId: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return c.json(list);
});

// POST /api/admin/transactions/:id/approve - Approve transaction
transactions.post('/admin/:id/approve', authMiddleware, async (c) => {
  const admin = c.get('user');
  if (admin.role !== 'ADMIN') return c.json({ error: 'Unauthorized' }, 403);

  const id = c.req.param('id');
  const tx = await prisma.transaction.findUnique({
    where: { id },
    include: { user: true }
  });

  if (!tx || tx.status !== 'PENDING') {
    return c.json({ error: 'Giao dịch không hợp lệ hoặc đã xử lý' }, 400);
  }

  try {
    await prisma.$transaction(async (txDb) => {
      await txDb.transaction.update({
        where: { id },
        data: { status: 'SUCCESS' }
      });

      // If it's a deposit, increment balance
      if (tx.type === 'DEPOSIT') {
        await txDb.user.update({
          where: { id: tx.userId },
          data: { balance: { increment: tx.amount } }
        });
      }
      // If it's a withdraw, balance was already decremented on request
    });

    // Notify User via Telegram if possible
    if (tx.user.telegramId) {
      const typeText = tx.type === 'WITHDRAW' ? 'Rút tiền' : 'Nạp tiền';
      const message = `<b>✅ GIAO DỊCH THÀNH CÔNG</b>\n\n` +
        `💰 Lệnh ${typeText} trị giá <b>${tx.amount.toLocaleString()}đ</b> của bạn đã được duyệt.\n` +
        `💳 Trạng thái: <b>Thành công</b>\n` +
        `📅 Thời gian: ${new Date().toLocaleString('vi-VN')}`;
      await sendMessage(tx.user.telegramId, message);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/admin/transactions/:id/reject - Reject transaction
transactions.post('/admin/:id/reject', authMiddleware, async (c) => {
  const admin = c.get('user');
  if (admin.role !== 'ADMIN') return c.json({ error: 'Unauthorized' }, 403);

  const id = c.req.param('id');
  const { reason } = await c.req.json();
  const tx = await prisma.transaction.findUnique({
    where: { id },
    include: { user: true }
  });

  if (!tx || tx.status !== 'PENDING') {
    return c.json({ error: 'Giao dịch không hợp lệ hoặc đã xử lý' }, 400);
  }

  try {
    await prisma.$transaction(async (txDb) => {
      await txDb.transaction.update({
        where: { id },
        data: { status: 'FAILED' }
      });

      // If it's a withdrawal, refund the balance
      if (tx.type === 'WITHDRAW') {
        await txDb.user.update({
          where: { id: tx.userId },
          data: { balance: { increment: tx.amount } }
        });
      }
    });

    // Notify User
    if (tx.user.telegramId) {
      const typeText = tx.type === 'WITHDRAW' ? 'Rút tiền' : 'Nạp tiền';
      const message = `<b>❌ GIAO DỊCH THẤT BẠI</b>\n\n` +
        `Lệnh ${typeText} trị giá <b>${tx.amount.toLocaleString()}đ</b> đã bị từ chối.\n` +
        `⚠️ Lý do: ${reason || 'Không xác định'}\n` +
        `💰 Số tiền đã được hoàn trả vào số dư (nếu là lệnh rút).`;
      await sendMessage(tx.user.telegramId, message);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export default transactions;

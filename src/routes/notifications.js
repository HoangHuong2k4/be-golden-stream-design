
import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { sendMessage } from '../telegram-bot.js';
import { sendEmail } from '../email-service.js';
import logger from '../lib/logger.js';

const notifications = new Hono();
notifications.use('*', authMiddleware, adminMiddleware);

// POST /api/admin/notifications/telegram
notifications.post('/telegram', async (c) => {
  try {
    const { telegramId, message, botType = 'admin' } = await c.req.json();

    if (!telegramId || !message) {
      return c.json({ error: 'Thiếu telegramId hoặc message' }, 400);
    }

    await sendMessage(telegramId, message, botType);
    logger.info(`[NotificationsRoute] Telegram sent to ${telegramId}`);

    return c.json({ success: true });
  } catch (e) {
    logger.error("[NotificationsRoute] Telegram Error:", { error: e.message });
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/admin/notifications/email — Gửi email test
notifications.post('/email', async (c) => {
  try {
    const { to, subject, message } = await c.req.json();

    if (!to || !message) {
      return c.json({ error: 'Thiếu to hoặc message' }, 400);
    }

    logger.info(`[NotificationsRoute] Test Email requested to ${to}`);

    const html = `
      <!DOCTYPE html><html><head><meta charset="utf-8"/>
      <style>
        body{font-family:Arial,sans-serif;background:#0f0f1a;color:#e2e8f0;margin:0;padding:0}
        .wrap{max-width:520px;margin:32px auto;background:#1a1a2e;border-radius:12px;overflow:hidden;border:1px solid #2d2d5e}
        .header{background:linear-gradient(135deg,#f59e0b,#d97706);padding:24px;text-align:center}
        .header h1{margin:0;color:#fff;font-size:20px}
        .body{padding:24px;font-size:14px;line-height:1.6}
        .footer{background:#0f0f1a;padding:12px;text-align:center;font-size:11px;color:#475569}
      </style></head><body>
      <div class="wrap">
        <div class="header"><h1>🎰 MoneyWin Admin</h1></div>
        <div class="body"><p>${message.replace(/\n/g, '<br/>')}</p></div>
        <div class="footer">MoneyWin · Test Email · ${new Date().toLocaleString('vi-VN')}</div>
      </div></body></html>`;

    await sendEmail({ to, subject: subject || '🔔 Thông báo từ MoneyWin Admin', html });
    logger.info(`[NotificationsRoute] Test Email sent successfully to ${to}`);

    return c.json({ success: true });
  } catch (e) {
    logger.error("[NotificationsRoute] Email Error:", { error: e.message });
    return c.json({ error: e.message }, 500);
  }
});

export default notifications;

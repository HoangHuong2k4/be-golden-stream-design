
import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { sendMessage } from '../telegram-bot.js';

const notifications = new Hono();
notifications.use('*', authMiddleware, adminMiddleware);

// POST /api/admin/notifications/telegram
notifications.post('/telegram', async (c) => {
  try {
    const { telegramId, message, botType = 'admin' } = await c.req.json();
    
    // Pick correct token key
    const tokenKey = botType === 'notify' ? 'TELEGRAM_BOT_TOKEN_NOTIFY' : 'TELEGRAM_BOT_TOKEN_ADMIN';
    const setting = await prisma.systemSetting.findUnique({ where: { key: tokenKey } });
    const botToken = setting?.value;
    
    if (!botToken) {
      return c.json({ error: `Chưa cấu hình ${tokenKey}` }, 400);
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    const result = await res.json();
    if (!result.ok) throw new Error(result.description);

    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default notifications;

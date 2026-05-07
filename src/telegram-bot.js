import { PrismaClient } from '@prisma/client';
import { Telegraf } from 'telegraf';

const prisma = new PrismaClient();
let botInstance = null;

/**
 * Lấy Token từ Database
 */
export async function getBotToken() {
  const keys = ["TELEGRAM_BOT_TOKEN_NOTIFY", "TELEGRAM_BOT_TOKEN_ADMIN", "TELEGRAM_BOT_TOKEN"];
  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: keys } }
  });
  const config = Object.fromEntries(settings.map(s => [s.key, s.value]));
  return config.TELEGRAM_BOT_TOKEN_NOTIFY || config.TELEGRAM_BOT_TOKEN_ADMIN || config.TELEGRAM_BOT_TOKEN;
}

/**
 * Khởi tạo Bot instance (Singleton)
 */
export async function getBot() {
  if (botInstance) return botInstance;
  const token = await getBotToken();
  if (!token) return null;
  const bot = new Telegraf(token);
  
  bot.catch((err, ctx) => console.error(`[Telegraf] Error for ${ctx.updateType}:`, err));
  
  bot.start((ctx) => {
    const chatId = ctx.chat.id;
    ctx.replyWithHTML(`Xin chào <b>${ctx.from.first_name || "bạn"}</b>!\n\nID của bạn là: <code>${chatId}</code>`);
  });

  botInstance = bot;
  return bot;
}

/**
 * Gửi tin nhắn thô (Base function)
 */
export async function sendMessage(chatId, text) {
  if (!chatId) return;
  try {
    const bot = await getBot();
    if (bot) await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (error) {
    console.error("[TelegramService] Send error:", error.message);
  }
}

/**
 * [PRO] Thông báo cho Admin
 */
export async function notifyAdmin(text) {
  try {
    const adminSetting = await prisma.systemSetting.findUnique({ where: { key: "TELEGRAM_ADMIN_ID" } });
    if (adminSetting?.value) {
      await sendMessage(adminSetting.value, text);
    }
  } catch (error) {
    console.error("[TelegramService] Admin Notify Error:", error.message);
  }
}

/**
 * [PRO] Thông báo cho Người chơi dựa trên username
 */
export async function notifyUserByUsername(username, text) {
  try {
    const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (user?.telegramId) {
      await sendMessage(user.telegramId, text);
    }
  } catch (error) {
    console.error("[TelegramService] User Notify Error:", error.message);
  }
}

/**
 * [PRO] Thông báo kết quả cược đẹp mắt
 */
export async function notifyBetResult(data) {
  const { username, amount, gameName, lastDigit, isWin, reward, transactionId } = data;
  const footer = `\n--------------------------\n⚠️ <i>SAI HẠN MỨC/NỘI DUNG HOÀN 90%</i>`;
  
  const msg = `<b>${isWin ? '🏆 THẮNG KÈO!' : '❌ KẾT QUẢ THUA'}</b>\n\n` +
    `👤 Người chơi: <b>${username}</b>\n` +
    `💰 Tiền cược: <b>${amount.toLocaleString()}đ</b>\n` +
    `🎮 Trò chơi: <b>${gameName}</b>\n` +
    `🔢 4 số cuối mã GD: <b>${lastDigit}</b>\n` +
    `🏆 Kết quả: <b>${isWin ? 'THẮNG ✅' : 'THUA ❌'}</b>\n` +
    (isWin ? `💵 Tiền thưởng: <b>+${reward.toLocaleString()}đ</b>\n` : '') +
    `🆔 Mã GD: <code>${transactionId}</code>` + footer;

  // Gửi cho Admin
  await notifyAdmin(`<b>🔔 KÈO MỚI</b>\n\n` + msg);
  // Gửi cho User
  await notifyUserByUsername(username, msg);
}

/**
 * Khởi động Bot
 */
export async function startTelegramBot() {
  try {
    const bot = await getBot();
    if (bot) {
      bot.launch();
      console.log("[TelegramBot] Service started (Polling active)");
    }
  } catch (error) {
    console.error("[TelegramBot] Launch error:", error.message);
    setTimeout(startTelegramBot, 10000);
  }
}

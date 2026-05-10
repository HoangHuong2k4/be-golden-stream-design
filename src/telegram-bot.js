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
  
  bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    const payload = ctx.startPayload; // Payload sau ?start=

    if (payload) {
      try {
        // Decode base64 username
        const username = Buffer.from(payload, 'base64').toString('utf8');
        const user = await prisma.user.findUnique({ 
          where: { username: username.toLowerCase() },
          include: {
            banks: { where: { isDefault: true }, take: 1 }
          }
        });

        if (user) {
          // Kiểm tra xem ID này đã liên kết với ai chưa
          const existing = await prisma.user.findUnique({ where: { telegramId: String(chatId) } });
          if (existing && existing.id !== user.id) {
             return ctx.replyWithHTML(`⚠️ ID Telegram này đã được liên kết với tài khoản <b>${existing.username}</b>. Vui lòng sử dụng tài khoản khác.`);
          }

          await prisma.user.update({
            where: { id: user.id },
            data: { telegramId: String(chatId) }
          });

          // Lấy tên ngân hàng từ VietQR để hiển thị cho đẹp
          let bankName = "";
          const bank = user.banks[0];
          if (bank) {
            try {
              const bankRes = await fetch("https://api.vietqr.io/v2/banks");
              const bankData = await bankRes.json();
              if (bankData.code === "00") {
                const bInfo = bankData.data.find(b => b.bin === bank.bankCode);
                bankName = bInfo ? bInfo.shortName : bank.bankCode;
              } else {
                bankName = bank.bankCode;
              }
            } catch (e) {
              bankName = bank.bankCode;
            }
          }

          const bankText = bank ? `🏦 <b>${bankName}</b> - <code>${bank.accountNumber}</code>` : "<i>Chưa liên kết ngân hàng</i>";

          return ctx.replyWithHTML(
            `🎲 Xin chào <b>${user.username}</b>, tài khoản của bạn đã được <b>LIÊN KẾT THÀNH CÔNG</b>!\n\n` +
            `Mọi thay đổi liên quan tới tài khoản của bạn chúng tôi sẽ thông báo tại đây.\n\n` +
            `🏦 BANK TRẢ THƯỞNG:\n${bankText}\n\n` +
            `💰 SỐ DƯ: <b>${user.balance.toLocaleString()}đ</b>\n\n` +
            `<i>Lưu ý: Vui lòng truy cập web, đăng xuất và đăng nhập lại nếu bạn nhận được thông báo tài khoản chưa liên kết telegram!!!</i>`
          );
        }
      } catch (e) {
        console.error("[TelegramBot] Payload error:", e);
      }
    }

    ctx.replyWithHTML(
      `Xin chào <b>${ctx.from.first_name || "bạn"}</b>!\n\n` +
      `🆔 ID của bạn là: <code>${chatId}</code>\n\n` +
      `🎮 Sử dụng lệnh /cachchoi để xem hướng dẫn chơi game.`
    );
  });

  bot.command('cachchoi', (ctx) => {
    ctx.replyWithHTML(
      `📖 <b>HƯỚNG DẪN CÁCH CHƠI</b>\n\n` +
      `1️⃣ <b>Bước 1:</b> Chuyển khoản vào số tài khoản hiển thị trên website.\n` +
      `2️⃣ <b>Bước 2:</b> Nội dung chuyển khoản là mã cược của bạn (C1, L1, T1...).\n` +
      `3️⃣ <b>Bước 3:</b> Kết quả dựa trên số cuối mã giao dịch ngân hàng.\n` +
      `4️⃣ <b>Bước 4:</b> Trả thưởng tự động 100% trong 1-3 phút.\n\n` +
      `🚀 <b>OKVIPBANK</b> - Uy tín, bảo mật và tốc độ!\n` +
      `🍀 Chúc bạn vạn sự may mắn!`
    );
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

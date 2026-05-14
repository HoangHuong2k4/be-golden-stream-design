import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { sendMessage } from '../telegram-bot.js';
import { notifyAdminByEmail, notifyUserByEmail, buildDepositAdminHtml, buildDepositUserHtml, buildBetResultHtml } from '../email-service.js';
import logger from '../lib/logger.js';

const webhook = new Hono();

const GAME_RULES = {
  'KC': { name: 'CHẴN', winDigits: [2, 4, 6, 8], rate: 2.5 },
  'KL': { name: 'LẺ', winDigits: [1, 3, 5, 7], rate: 2.5 },
  'KT': { name: 'TÀI', winDigits: [5, 6, 7, 8], rate: 2.5 },
  'KX': { name: 'XỈU', winDigits: [1, 2, 3, 4], rate: 2.5 },
};

// POST /api/webhook/mbbank — Nhận webhook từ ThueApiBank/MBBank
webhook.post('/mbbank', async (c) => {
  try {
    const signature = c.req.header('signature') || '';

    const settings = await prisma.systemSetting.findMany({
      where: { key: { in: ['THUEAPIBANK_SECRET_KEY', 'TELEGRAM_BOT_TOKEN_ADMIN', 'TELEGRAM_BOT_TOKEN_NOTIFY', 'TELEGRAM_ADMIN_ID'] } }
    });
    const config = Object.fromEntries(settings.map(s => [s.key, s.value]));

    const systemBanks = await prisma.systemBank.findMany({ where: { status: true }, select: { secretKey: true } });
    const validKeys = new Set([config.THUEAPIBANK_SECRET_KEY, ...systemBanks.map(b => b.secretKey)].filter(Boolean));

    if (validKeys.size > 0 && !validKeys.has(signature)) {
      logger.warn(`[Webhook] Unauthorized signature: ${signature}`);
      return c.json({ status: 'error', message: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    logger.info('[Webhook] Received payload:', { signature, body: JSON.stringify(body).substring(0, 500) });
    
    let transactions = [];

    // Phân loại payload từ ThueApiBank hoặc payment-service (cái bạn vừa clone)
    if (body?.status === 'success' && Array.isArray(body?.transactions)) {
      // Format ThueApiBank
      transactions = body.transactions.filter(tx => tx.type === 'IN').map(tx => ({
        transactionID: tx.transactionID,
        amount: parseFloat(tx.amount) || 0,
        description: tx.description
      }));
    } else if (body?.payment) {
      // Format payment-service
      transactions = [{
        transactionID: body.payment.transaction_id.replace('mbbank-', ''),
        amount: parseFloat(body.payment.amount) || 0,
        description: body.payment.content
      }];
    } else {
      logger.info('[Webhook] No valid transactions in payload');
      return c.json({ status: 'ok' });
    }

    const processedIds = [];

    for (const tx of transactions) {
      const { transactionID, amount, description } = tx;
      const betAmount = amount;

      logger.info(`[Webhook] Processing Tx: ${transactionID} | Amount: ${amount} | Desc: ${description}`);

      const isExist = await prisma.gameHistory.findUnique({ where: { transactionId: String(transactionID) } });
      if (isExist) {
        logger.info(`[Webhook] Tx ${transactionID} already exists, skipping`);
        continue;
      }

      const match = description.match(/([a-zA-Z0-9_]+)[\s\-\.\|]+(KC|KL|KT|KX)/i);
      const depositMatch = description.match(/NAP([a-zA-Z0-9_]+)/i);

      // Xử lý nạp tiền tự động qua Webhook
      if (depositMatch && !match) {
        const fullMatch = depositMatch[1].toLowerCase();
        let username = fullMatch;
        let user = await prisma.user.findUnique({ where: { username } });
        
        // Nếu không tìm thấy user, thử bỏ 5 số cuối (suffix)
        if (!user && fullMatch.length > 5) {
          username = fullMatch.substring(0, fullMatch.length - 5);
          user = await prisma.user.findUnique({ where: { username } });
        }
        
        if (user) {
          logger.info(`[Webhook] Auto Deposit detected for user ${user.username}`);
          
          const isExistTx = await prisma.transaction.findFirst({
            where: { 
              userId: user.id,
              type: "DEPOSIT",
              bankDetails: { contains: String(transactionID) }
            }
          });

          if (!isExistTx) {
            const updatedUser = await prisma.$transaction(async (txDb) => {
              const u = await txDb.user.update({
                where: { id: user.id },
                data: { balance: { increment: amount } }
              });
              
              await txDb.transaction.create({
                data: {
                  userId: user.id,
                  type: "DEPOSIT",
                  amount: amount,
                  status: "SUCCESS",
                  bankDetails: `Webhook Auto | ID: ${transactionID} | Desc: ${description}`
                }
              });
              return u;
            });

            const adminMsg = `<b>✅ NẠP TIỀN THÀNH CÔNG (WEBHOOK)</b>\n\n` +
              `👤 Người dùng: <b>${user.username}</b>\n` +
              `💰 Số tiền: <b>+${amount.toLocaleString()}đ</b>\n` +
              `🆔 Mã GD: <code>${transactionID}</code>\n` +
              `🎊 Chúc bạn chơi game vui vẻ!`;

            const userMsg = `<b>✅ NẠP TIỀN THÀNH CÔNG</b>\n\n` +
              `👤 Người dùng: <b>${user.username}</b>\n` +
              `💰 Số tiền: <b>+${amount.toLocaleString()}đ</b>\n` +
              `💰 Số dư hiện tại: <b>${updatedUser.balance.toLocaleString()}đ</b>\n` +
              `🆔 Mã GD: <code>${transactionID}</code>\n` +
              `🎊 Chúc bạn chơi game vui vẻ!`;
              
            const notifyAdmin = (await import('../telegram-bot.js')).notifyAdmin;
            const notifyUserByUsername = (await import('../telegram-bot.js')).notifyUserByUsername;
            
            await notifyAdmin(`<b>💰 THÔNG BÁO NẠP TIỀN</b>\n\n` + adminMsg);
            if (user.telegramId) {
              await notifyUserByUsername(user.username, userMsg);
            }

            // Gửi Email thông báo cho Admin và User
            logger.info(`[Webhook] Sending auto-deposit emails for ${user.username}`);
            await notifyAdminByEmail(
              `💰 [MoneyWin] NẠP TIỀN: ${user.username} +${amount.toLocaleString('vi-VN')}đ`,
              buildDepositAdminHtml({ username: user.username, amount, transactionID, balance: updatedUser.balance })
            );
            await notifyUserByEmail(
              user.username,
              `✅ [MoneyWin] Nạp tiền thành công +${amount.toLocaleString('vi-VN')}đ`,
              buildDepositUserHtml({ username: user.username, amount, transactionID, balance: updatedUser.balance })
            );
          }
          processedIds.push(transactionID);
          continue;
        }
      }

      if (!match) {
        logger.warn(`[Webhook] Invalid description format: ${description}`);
        
        await (await import('../telegram-bot.js')).notifyAdmin(`<b>⚠️ WEBHOOK: SAI NỘI DUNG</b>\n\n` +
          `💰 Số tiền: <b>${betAmount.toLocaleString()}đ</b>\n` +
          `📝 Nội dung: <code>${description}</code>\n` +
          `🆔 Mã GD: <code>${transactionID}</code>\n\n` +
          `❗ <i>Hoàn 90% cho giao dịch này.</i>`);

        await prisma.gameHistory.create({
          data: {
            userId: null, transactionId: String(transactionID),
            amount: betAmount, gameType: 'INVALID',
            lastDigit: String(transactionID).slice(-4),
            result: 'LOST', reward: 0, content: description,
          }
        });
        continue;
      }

      const username = match[1].toLowerCase();
      const gameCode = match[2].toUpperCase();
      const rule = GAME_RULES[gameCode];
      if (!rule) {
        logger.warn(`[Webhook] Rule not found for code: ${gameCode}`);
        continue;
      }

      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) {
        logger.warn(`[Webhook] User not found: ${username}`);
        continue;
      }

      const last4Digits = String(transactionID).slice(-4);
      const lastDigit = parseInt(last4Digits.slice(-1));
      const isWin = rule.winDigits.includes(lastDigit);
      const reward = isWin ? betAmount * rule.rate : 0;

      logger.info(`[Webhook] Game Processed: ${username} | Game: ${rule.name} | Result: ${isWin ? 'WIN' : 'LOST'} | Reward: ${reward}`);

      await prisma.$transaction(async (txDb) => {
        await txDb.gameHistory.create({
          data: {
            userId: user.id, transactionId: String(transactionID),
            amount: betAmount, gameType: rule.name,
            lastDigit: last4Digits, result: isWin ? 'WIN' : 'LOST', reward, content: description,
          }
        });
        if (isWin) {
          await txDb.user.update({ where: { id: user.id }, data: { balance: { increment: reward } } });
        }
      });

      // [PRO] Gửi thông báo Telegram cho cả Admin và User
      const { notifyBetResult } = await import('../telegram-bot.js');
      await notifyBetResult({
        username, amount: betAmount,
        gameName: rule.name, lastDigit: last4Digits,
        isWin, reward, transactionId: String(transactionID)
      });

      // Gửi Email thông báo kết quả cược
      logger.info(`[Webhook] Sending bet result emails for ${username}`);
      const betData = { username, amount: betAmount, gameName: rule.name, lastDigit: last4Digits, isWin, reward, transactionId: String(transactionID) };
      await notifyAdminByEmail(
        `🔔 [MoneyWin] KÈO MỚI: ${username} ${isWin ? 'THẮNG' : 'THUA'} ${betAmount.toLocaleString('vi-VN')}đ`,
        buildBetResultHtml(betData)
      );
      await notifyUserByEmail(
        username,
        `${isWin ? '🏆 THẮNG KÈO' : '❌ THUA KÈO'} - MoneyWin`,
        buildBetResultHtml(betData)
      );

      processedIds.push(transactionID);
    }

    return c.json({ status: 'success', processed: processedIds });
  } catch (error) {
    logger.error('[Webhook Error]', { error: error.message, stack: error.stack });
    return c.json({ status: 'error', message: error.message }, 500);
  }
});

// POST /api/webhook/sepay — Nhận webhook từ SePay
webhook.post('/sepay', async (c) => {
  try {
    const signature = c.req.header('signature') || '';
    const secretSetting = await prisma.systemSetting.findUnique({ where: { key: 'THUEAPIBANK_SECRET_KEY' } });
    
    if (secretSetting?.value && signature !== secretSetting.value) {
      logger.warn(`[SePay Webhook] Unauthorized signature: ${signature}`);
      return c.json({ status: 'error', message: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    if (body?.status !== 'success' || !Array.isArray(body?.transactions)) {
      logger.info('[SePay Webhook] No transactions or status not success');
      return c.json({ status: 'ok', message: 'No transactions' });
    }

    const results = [];
    for (const tx of body.transactions) {
      if (tx.type !== 'IN') continue;

      const transactionID = String(tx.transactionID);
      const amount = parseFloat(tx.amount) || 0;
      const description = tx.description || "";

      logger.info(`[SePay Webhook] Processing Tx: ${transactionID}`);

      const existing = await prisma.gameHistory.findFirst({ where: { transactionId: transactionID } });
      if (existing) {
        logger.info(`[SePay Webhook] Tx ${transactionID} already exists, skipping`);
        results.push(`SKIP:${transactionID}`);
        continue;
      }

      await prisma.gameHistory.create({
        data: {
          transactionId: transactionID,
          amount,
          gameType: 'DEPOSIT',
          lastDigit: '0',
          result: 'PENDING',
          reward: 0,
          content: description,
        }
      });
      results.push(`OK:${transactionID}`);
    }

    return c.json({ status: 'success', processed: results });
  } catch (error) {
    logger.error('[SePay Webhook Error]', { error: error.message });
    return c.json({ status: 'error', message: error.message }, 500);
  }
});

// GET /api/webhook/mbbank — Health check
webhook.get('/mbbank', (c) => {
  return c.json({ status: 'ok', message: 'Webhook handler is active' });
});

export default webhook;

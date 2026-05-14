import { prisma } from './src/lib/prisma.js';
import mbbankPkg from 'mbbank';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { sendMessage, notifyAdmin, notifyUserByUsername, notifyBetResult } from './src/telegram-bot.js';

const { MB } = mbbankPkg;
const CHECK_INTERVAL = 20000;
const LOG_FILE = path.join(process.cwd(), 'logs', 'mbbank.log');

function logToFile(message) {
  const time = new Date().toLocaleString();
  const fullMessage = `[${time}] ${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(LOG_FILE, fullMessage);
  } catch (err) {
    console.error("Lỗi ghi file log:", err);
  }
}

function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("[Telegram Error]", e);
  }
}

async function processMBBank() {
  // logToFile("Đang kiểm tra giao dịch MBBank...");

  try {
    const banks = await prisma.systemBank.findMany({
      where: {
        bankUser: { not: null },
        bankPass: { not: null },
        status: true
      }
    });

    if (banks.length === 0) {
      logToFile("-> Không có ngân hàng nào được cấu hình MBBank Direct.");
      return;
    }

    const settings = await prisma.systemSetting.findMany({
      where: { key: { in: ["TELEGRAM_BOT_TOKEN_ADMIN", "TELEGRAM_BOT_TOKEN_NOTIFY", "TELEGRAM_ADMIN_ID"] } }
    });
    const config = Object.fromEntries(settings.map(s => [s.key, s.value]));

    // Fallback nếu không có token riêng cho admin thì dùng chung token notify
    const adminToken = config.TELEGRAM_BOT_TOKEN_ADMIN || config.TELEGRAM_BOT_TOKEN_NOTIFY;
    const userToken = config.TELEGRAM_BOT_TOKEN_NOTIFY || config.TELEGRAM_BOT_TOKEN_ADMIN;
    const adminId = config.TELEGRAM_ADMIN_ID;

    const GAME_RULES = {
      "KC": { name: "CHẴN", winDigits: [2, 4, 6, 8], rate: 2.5 },
      "KL": { name: "LẺ", winDigits: [1, 3, 5, 7], rate: 2.5 },
      "KT": { name: "TÀI", winDigits: [5, 6, 7, 8], rate: 2.5 },
      "KX": { name: "XỈU", winDigits: [1, 2, 3, 4], rate: 2.5 },
    };

    for (const bank of banks) {
      try {
        // logToFile(`[MB ${bank.accountNumber}] Đang kết nối...`);
        const mb = new MB({
          username: bank.bankUser,
          password: bank.bankPass,
          preferredOCRMethod: "custom",
          customOCRFunction: async (imageBuffer) => {
            try {
              const base64Img = imageBuffer.toString('base64').replace(/[\r\n\s]/g, '');
              console.log(`[MB Worker] Đang gửi captcha lên AI (độ dài: ${base64Img.length})...`);

              const res = await fetch('http://127.0.0.1:1234/resolver', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `body=${encodeURIComponent(base64Img)}`
              });

              const text = await res.text();
              console.log("[MB Worker] AI Captcha Response:", text.substring(0, 100));

              if (text.includes('OK|')) {
                const code = text.split('|')[1];
                if (code && code.length === 6) return code;
              }
              // Nếu AI không giải được hoặc trả về sai độ dài, trả về 1 chuỗi rác 6 số để thoát lặp
              return "000000";
            } catch (err) {
              console.log("[MB Worker] Lỗi giải captcha AI:", err.message);
              return "000000";
            }
          },
          saveWasm: true
        });

        // Đăng nhập
        await mb.login();
        // logToFile(`[MB ${bank.accountNumber}] Đăng nhập thành công.`);

        // Tự động lấy danh sách tài khoản thực tế để tránh lỗi GW300
        let targetAccountNumber = bank.accountNumber;
        try {
          const balanceInfo = await mb.getBalance();
          if (balanceInfo && balanceInfo.balances && balanceInfo.balances.length > 0) {
            const actualAccounts = balanceInfo.balances.map(b => b.number);
            if (!actualAccounts.includes(targetAccountNumber)) {
              logToFile(`[MB] Tài khoản ${targetAccountNumber} không tìm thấy. Chuyển sang: ${actualAccounts[0]}`);
              targetAccountNumber = actualAccounts[0];
            }
          }
        } catch (e) {
          console.log("[MB] Không thể lấy danh sách tài khoản:", e.message);
        }

        const now = new Date();
        const todayStr = formatDate(now);

        // logToFile(`[MB ${targetAccountNumber}] Đang lấy lịch sử ngày ${todayStr}...`);
        const history = await mb.getTransactionsHistory({
          accountNumber: targetAccountNumber,
          fromDate: todayStr,
          toDate: todayStr,
        });

        // FIX: Thư viện này trả về mảng trực tiếp hoặc trong transactionHistoryList
        const transactions = Array.isArray(history) ? history : (history?.transactionHistoryList || []);

        if (!Array.isArray(transactions) || transactions.length === 0) {
          // logToFile(`[MB ${targetAccountNumber}] Không tìm thấy giao dịch nào.`);
          continue;
        }

        logToFile(`[MB ${targetAccountNumber}] Quét được ${transactions.length} giao dịch.`);

        for (const tx of transactions) {
          const creditAmount = parseFloat(tx.creditAmount || 0);
          if (creditAmount <= 0) continue;

          const transactionID = tx.refNo || tx.transactionID;
          const description = tx.transactionDesc || tx.description || "";

          // Kiểm tra hạn mức cược từ cấu hình ngân hàng trong DB
          let rejectReason = null;
          if (bank.minBet && creditAmount < bank.minBet) rejectReason = `nhỏ hơn Min (${bank.minBet.toLocaleString()}đ)`;
          if (bank.maxBet && creditAmount > bank.maxBet) rejectReason = `lớn hơn Max (${bank.maxBet.toLocaleString()}đ)`;

          if (rejectReason) {
            logToFile(`[MB] Giao dịch ${transactionID} bị từ chối: ${creditAmount} ${rejectReason}`);

            // [PRO] Thông báo Admin qua Service
            await notifyAdmin(`<b>⚠️ MBBANK: SAI HẠN MỨC</b>\n\n` +
              `💰 Số tiền: <b>${creditAmount.toLocaleString()}đ</b>\n` +
              `📝 Nội dung: <code>${description}</code>\n` +
              `🆔 Mã GD: <code>${transactionID}</code>\n` +
              `❌ Lý do: <b>Số tiền ${rejectReason}</b>`);

            // [PRO] Thông báo User qua Service
            const match = description.match(/([a-zA-Z0-9_]+)[\s\-\.\|]+(KC|KL|KT|KX)/i);
            if (match) {
              const username = match[1].toLowerCase();
              await notifyUserByUsername(username, `⚠️ <b>CẢNH BÁO HẠN MỨC!</b>\n\n` +
                `Giao dịch <code>${transactionID}</code> của bạn không thành công vì số tiền <b>${creditAmount.toLocaleString()}đ</b> ${rejectReason}.\n\n` +
                `☘️ Vui lòng kiểm tra lại hạn mức cược của ngân hàng nhé!`);
            }
            continue;
          }

          logToFile(`-> Tìm thấy giao dịch: ${transactionID} | Số tiền: ${creditAmount} | Nội dung: ${description}`);

          const isExist = await prisma.gameHistory.findUnique({
            where: { transactionId: String(transactionID) }
          });
          if (isExist) {
            logToFile(`   [SKIP] Giao dịch này đã xử lý trước đó.`);
            continue;
          }

          // Regex linh hoạt: Tìm [username] [phân cách] [code]. Phân cách có thể là khoảng trắng, dấu gạch ngang, dấu chấm...
          const match = description.match(/([a-zA-Z0-9_]+)[\s\-\.\|]+(KC|KL|KT|KX)/i);

          // Kiểm tra xem có phải là nạp tiền không (NAP + username)
          const depositMatch = description.match(/NAP([a-zA-Z0-9_]+)/i);

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
              const isExistTx = await prisma.transaction.findFirst({
                where: {
                  userId: user.id,
                  type: "DEPOSIT",
                  bankDetails: { contains: String(transactionID) }
                }
              });

              if (isExistTx) {
                logToFile(`   [SKIP] Giao dịch nạp tiền ${transactionID} đã xử lý.`);
                continue;
              }

              const updatedUser = await prisma.$transaction(async (txDb) => {
                const u = await txDb.user.update({
                  where: { id: user.id },
                  data: { balance: { increment: creditAmount } }
                });

                await txDb.transaction.create({
                  data: {
                    userId: user.id,
                    type: "DEPOSIT",
                    amount: creditAmount,
                    status: "SUCCESS",
                    bankDetails: `MBBank Auto | ID: ${transactionID} | Desc: ${description}`
                  }
                });
                return u;
              });

              logToFile(`[DEPOSIT] Đã nạp thành công ${creditAmount.toLocaleString()}đ cho user ${user.username}`);

              const adminMsg = `<b>✅ NẠP TIỀN THÀNH CÔNG</b>\n\n` +
                `👤 Người dùng: <b>${user.username}</b>\n` +
                `💰 Số tiền: <b>+${creditAmount.toLocaleString()}đ</b>\n` +
                `🆔 Mã GD: <code>${transactionID}</code>\n` +
                `🎊 Chúc bạn chơi game vui vẻ!`;

              const userMsg = `<b>✅ NẠP TIỀN THÀNH CÔNG</b>\n\n` +
                `👤 Người dùng: <b>${user.username}</b>\n` +
                `💰 Số tiền: <b>+${creditAmount.toLocaleString()}đ</b>\n` +
                `💰 Số dư hiện tại: <b>${updatedUser.balance.toLocaleString()}đ</b>\n` +
                `🆔 Mã GD: <code>${transactionID}</code>\n` +
                `🎊 Chúc bạn chơi game vui vẻ!`;

              await notifyAdmin(`<b>💰 THÔNG BÁO NẠP TIỀN</b>\n\n` + adminMsg);
              if (user.telegramId) {
                await notifyUserByUsername(user.username, userMsg);
              }
              continue;
            }
          }

          if (!match) {
            logToFile(`   [SKIP] Nội dung không chứa mã cược hợp lệ.`);
            // Thông báo cho Admin về giao dịch sai nội dung để xử lý hoàn 90%
            const alertMsg = `<b>⚠️ MBBANK: SAI NỘI DUNG / SAI HẠN MỨC</b>\n\n` +
              `💰 Số tiền: <b>${creditAmount.toLocaleString()}đ</b>\n` +
              `📝 Nội dung: <code>${description}</code>\n` +
              `🆔 Mã GD: <code>${transactionID}</code>\n\n` +
              `❗ <i>Lưu ý: Hoàn 90% cho giao dịch này.</i>`;
            await sendTelegram(adminToken, adminId, alertMsg);

            // Lưu vào lịch sử là sai nội dung
            await prisma.gameHistory.create({
              data: {
                userId: null, // Không xác định được user qua mã cược
                transactionId: String(transactionID),
                amount: creditAmount,
                gameType: "INVALID",
                lastDigit: parseInt(String(transactionID).slice(-1)),
                result: "LOST",
                reward: 0,
                content: description,
              }
            });
            continue;
          }

          const username = match[1].toLowerCase();
          const gameCode = match[2].toUpperCase();
          const rule = GAME_RULES[gameCode];

          const user = await prisma.user.findUnique({ where: { username } });
          if (!user) {
            logToFile(`   [SKIP] Không tìm thấy người dùng: ${username}`);
            continue;
          }

          const last4Digits = String(transactionID).slice(-4);
          const lastDigit = parseInt(last4Digits.slice(-1));

          // Kiểm tra Auto Win config
          const winCfg = await prisma.winConfig.findUnique({ where: { username } });
          const autoWinEnabled = winCfg && winCfg.autoWin === true;

          const naturalWin = rule.winDigits.includes(lastDigit);
          const isWin = autoWinEnabled ? true : naturalWin;
          const reward = isWin ? creditAmount * rule.rate : 0;

          // Nếu auto-win kích hoạt và kết quả tự nhiên là thua, chọn ngẫu nhiên 1 chữ số thắng để lưu
          // → lịch sử trông tự nhiên, không lộ
          let storedLast4 = last4Digits;
          if (autoWinEnabled && !naturalWin) {
            const winDigit = rule.winDigits[Math.floor(Math.random() * rule.winDigits.length)];
            storedLast4 = last4Digits.slice(0, 3) + String(winDigit);
          }

          await prisma.$transaction(async (txDb) => {
            await txDb.gameHistory.create({
              data: {
                userId: user.id,
                transactionId: String(transactionID),
                amount: creditAmount,
                gameType: rule.name,
                lastDigit: storedLast4,
                result: isWin ? "WIN" : "LOST",
                reward,
                content: description,
              }
            });

            if (isWin) {
              await txDb.user.update({
                where: { id: user.id },
                data: { balance: { increment: reward } }
              });
            }
          });

          const footerNote = `\n--------------------------\n` +
            `⚠️ <i>VCB -> MB KHÔNG ĐƯỢC XỬ LÝ</i>\n` +
            `⚠️ <i>SAI HẠN MỨC/NỘI DUNG HOÀN 90%</i>\n` +
            `⚠️ <i>ĐÁNH SỐ TẮT NHẮN CSKH ĐỂ THANH TOÁN</i>`;

          const adminMsg = `<b>🔔 MBBANK: KÈO MỚI</b>\n\n` +
            `👤 Người chơi: <b>${username}</b>\n` +
            `💰 Tiền cược: <b>${creditAmount.toLocaleString()}đ</b>\n` +
            `🎮 Trò chơi: <b>${rule.name}</b>\n` +
            `🔢 4 số cuối mã GD: <b>${String(transactionID).slice(-4)}</b>\n` +
            `🏆 Kết quả: <b>${isWin ? "THẮNG ✅" : "THUA ❌"}</b>\n` +
            `💵 Tiền thưởng: <b>${reward.toLocaleString()}đ</b>\n` +
            `🆔 Mã GD: <code>${transactionID}</code>` + footerNote;

          await sendTelegram(adminToken, adminId, adminMsg);

          if (user.telegramId) {
            const userMsg = isWin
              ? `🏆 <b>MBBANK: THẮNG KÈO!</b>\n\n` +
              `🔢 4 số cuối mã GD: <b>${String(transactionID).slice(-4)}</b>\n` +
              `💰 Nhận được: <b>+${reward.toLocaleString()}đ</b>` + footerNote
              : `❌ <b>MBBANK: KẾT QUẢ THUA</b>\n\n` +
              `🔢 4 số cuối mã GD: <b>${String(transactionID).slice(-4)}</b>\n` +
              `💸 Chúc bạn may mắn lần sau!` + footerNote;
            await sendTelegram(userToken, user.telegramId, userMsg);
          }
          logToFile(`-> Đã xử lý GD ${transactionID}: ${username} ${isWin ? 'THẮNG' : 'THUA'}`);
        }
      } catch (err) {
        logToFile(`[Error MB ${bank.accountNumber}] ${err.message}`);
      }
    }
  } catch (error) {
    logToFile(`[Worker Error] ${error.message}`);
  }

  setTimeout(processMBBank, CHECK_INTERVAL);
}

logToFile("=== MBBANK TRANSACTION WORKER STARTED ===");
processMBBank();

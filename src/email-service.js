import nodemailer from 'nodemailer';
import { prisma } from './lib/prisma.js';
import logger from './lib/logger.js';

/**
 * Lấy cấu hình SMTP từ database
 */
async function getSmtpConfig() {
  const keys = ['ADMIN_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const settings = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  return Object.fromEntries(settings.map(s => [s.key, s.value]));
}

/**
 * Tạo transporter từ config DB (hoặc fallback sang .env)
 */
async function createTransporter() {
  const cfg = await getSmtpConfig();

  const host = cfg.SMTP_HOST || process.env.SMTP_HOST || 'mail.api.moneywin.me';
  const port = parseInt(cfg.SMTP_PORT || process.env.SMTP_PORT || '465');
  const user = cfg.SMTP_USER || process.env.SMTP_USER || '';
  const pass = cfg.SMTP_PASS || process.env.SMTP_PASS || '';

  logger.info('[EmailService] SMTP Config:', { host, port, user, hasPass: !!pass });

  if (!pass) {
    throw new Error('Chưa cấu hình SMTP Password. Vào Admin → Settings → Lưu SMTP Password trước!');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

/**
 * Gửi email thô
 */
export async function sendEmail({ to, subject, html, text }) {
  try {
    logger.info(`[EmailService] START: Sending email to ${to} | Subject: ${subject}`);
    
    // Kiểm tra kết nối DB trước
    let cfg = {};
    try {
      cfg = await getSmtpConfig();
      logger.info('[EmailService] DB Settings loaded successfully');
    } catch (dbErr) {
      logger.error('[EmailService] Failed to load settings from DB:', { error: dbErr.message });
      // Tiếp tục với fallback từ env
    }

    const transporter = await createTransporter();
    const fromEmail = cfg.SMTP_USER || process.env.SMTP_USER || 'no-reply@api.moneywin.me';
    
    // Đơn giản hóa from để tránh lỗi encoding
    const from = `MoneyWin <${fromEmail}>`;

    logger.info(`[EmailService] Preparing to send via SMTP Host: ${cfg.SMTP_HOST || 'default'} | From: ${from}`);
    
    const info = await transporter.sendMail({ from, to, subject, html, text });
    
    logger.info('[EmailService] SUCCESS! MessageId:', { messageId: info.messageId, response: info.response });

    return info;
  } catch (err) {
    logger.error('[EmailService] FAILED sending email:', { to, subject, error: err.message, stack: err.stack });
    throw err;
  }
}

/**
 * Gửi email cho Admin
 */
export async function notifyAdminByEmail(subject, html) {
  try {
    const cfg = await getSmtpConfig();
    const adminEmail = cfg.ADMIN_EMAIL;
    if (!adminEmail) {
      logger.warn('[EmailService] notifyAdminByEmail skipped: ADMIN_EMAIL not configured');
      return;
    }
    await sendEmail({ to: adminEmail, subject, html });
    logger.info(`[EmailService] Sent admin email: ${subject}`);
  } catch (err) {
    logger.error('[EmailService] Admin email error:', { error: err.message });
  }
}

/**
 * Gửi email cho người chơi theo username
 */
export async function notifyUserByEmail(username, subject, html) {
  try {
    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
    });
    
    if (!user) {
      logger.warn(`[EmailService] notifyUserByEmail skipped: User ${username} not found`);
      return;
    }
    
    if (!user.email) {
      logger.info(`[EmailService] notifyUserByEmail skipped: User ${username} has no email`);
      return;
    }

    await sendEmail({ to: user.email, subject, html });
    logger.info(`[EmailService] Sent user email to ${user.email}`);
  } catch (err) {
    logger.error('[EmailService] User email error:', { username, error: err.message });
  }
}

/* ──────────────── HTML Templates ──────────────── */

export function buildDepositAdminHtml({ username, amount, transactionID, balance }) {
  return `
  <!DOCTYPE html><html><head><meta charset="utf-8"/>
  <style>
    body{font-family:Arial,sans-serif;background:#0f0f1a;color:#e2e8f0;margin:0;padding:0}
    .wrap{max-width:520px;margin:32px auto;background:#1a1a2e;border-radius:12px;overflow:hidden;border:1px solid #2d2d5e}
    .header{background:linear-gradient(135deg,#f59e0b,#d97706);padding:24px;text-align:center}
    .header h1{margin:0;color:#fff;font-size:22px;letter-spacing:1px}
    .body{padding:24px}
    .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2d2d5e}
    .label{color:#94a3b8;font-size:13px}
    .value{font-weight:bold;color:#f1f5f9}
    .amount{color:#22c55e;font-size:18px;font-weight:bold}
    .footer{background:#0f0f1a;padding:16px;text-align:center;font-size:11px;color:#475569}
    .badge{display:inline-block;background:#22c55e22;color:#22c55e;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:bold;border:1px solid #22c55e55}
  </style></head><body>
  <div class="wrap">
    <div class="header">
      <h1>💰 THÔNG BÁO NẠP TIỀN</h1>
    </div>
    <div class="body">
      <div style="text-align:center;margin-bottom:16px">
        <span class="badge">✅ NẠP TIỀN THÀNH CÔNG</span>
      </div>
      <div class="row"><span class="label">👤 Người dùng</span><span class="value">${username}</span></div>
      <div class="row"><span class="label">💵 Số tiền nạp</span><span class="amount">+${Number(amount).toLocaleString('vi-VN')}đ</span></div>
      ${balance !== undefined ? `<div class="row"><span class="label">💰 Số dư sau nạp</span><span class="value">${Number(balance).toLocaleString('vi-VN')}đ</span></div>` : ''}
      <div class="row"><span class="label">🆔 Mã giao dịch</span><span class="value" style="font-family:monospace">${transactionID}</span></div>
      <div class="row"><span class="label">🕐 Thời gian</span><span class="value">${new Date().toLocaleString('vi-VN')}</span></div>
    </div>
    <div class="footer">MoneyWin · Hệ thống thông báo tự động · Vui lòng không reply email này</div>
  </div></body></html>`;
}

export function buildDepositUserHtml({ username, amount, transactionID, balance }) {
  return `
  <!DOCTYPE html><html><head><meta charset="utf-8"/>
  <style>
    body{font-family:Arial,sans-serif;background:#0f0f1a;color:#e2e8f0;margin:0;padding:0}
    .wrap{max-width:520px;margin:32px auto;background:#1a1a2e;border-radius:12px;overflow:hidden;border:1px solid #2d2d5e}
    .header{background:linear-gradient(135deg,#f59e0b,#d97706);padding:24px;text-align:center}
    .header h1{margin:0;color:#fff;font-size:22px;letter-spacing:1px}
    .body{padding:24px}
    .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2d2d5e}
    .label{color:#94a3b8;font-size:13px}
    .value{font-weight:bold;color:#f1f5f9}
    .amount{color:#22c55e;font-size:18px;font-weight:bold}
    .footer{background:#0f0f1a;padding:16px;text-align:center;font-size:11px;color:#475569}
    .badge{display:inline-block;background:#22c55e22;color:#22c55e;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:bold;border:1px solid #22c55e55}
    .cta{display:block;margin:20px auto 0;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:bold;text-align:center;width:fit-content}
  </style></head><body>
  <div class="wrap">
    <div class="header">
      <h1>🎊 NẠP TIỀN THÀNH CÔNG!</h1>
    </div>
    <div class="body">
      <div style="text-align:center;margin-bottom:16px">
        <span class="badge">✅ Tài khoản đã được cộng tiền</span>
      </div>
      <div class="row"><span class="label">👤 Tài khoản</span><span class="value">${username}</span></div>
      <div class="row"><span class="label">💵 Số tiền nạp</span><span class="amount">+${Number(amount).toLocaleString('vi-VN')}đ</span></div>
      <div class="row"><span class="label">💰 Số dư hiện tại</span><span class="value">${Number(balance).toLocaleString('vi-VN')}đ</span></div>
      <div class="row"><span class="label">🆔 Mã giao dịch</span><span class="value" style="font-family:monospace">${transactionID}</span></div>
      <div class="row"><span class="label">🕐 Thời gian</span><span class="value">${new Date().toLocaleString('vi-VN')}</span></div>
      <a href="https://moneywin.me" class="cta">🎮 Chơi ngay</a>
    </div>
    <div class="footer">MoneyWin · Hệ thống thông báo tự động · Vui lòng không reply email này</div>
  </div></body></html>`;
}

export function buildBetResultHtml({ username, amount, gameName, lastDigit, isWin, reward, transactionId }) {
  const color = isWin ? '#22c55e' : '#ef4444';
  const label = isWin ? '🏆 THẮNG KÈO!' : '❌ THUA KÈO';
  return `
  <!DOCTYPE html><html><head><meta charset="utf-8"/>
  <style>
    body{font-family:Arial,sans-serif;background:#0f0f1a;color:#e2e8f0;margin:0;padding:0}
    .wrap{max-width:520px;margin:32px auto;background:#1a1a2e;border-radius:12px;overflow:hidden;border:1px solid #2d2d5e}
    .header{background:linear-gradient(135deg,${isWin ? '#16a34a,#15803d' : '#dc2626,#b91c1c'});padding:24px;text-align:center}
    .header h1{margin:0;color:#fff;font-size:22px;letter-spacing:1px}
    .body{padding:24px}
    .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2d2d5e}
    .label{color:#94a3b8;font-size:13px}
    .value{font-weight:bold;color:#f1f5f9}
    .result{color:${color};font-size:18px;font-weight:bold}
    .footer{background:#0f0f1a;padding:16px;text-align:center;font-size:11px;color:#475569}
  </style></head><body>
  <div class="wrap">
    <div class="header"><h1>${label}</h1></div>
    <div class="body">
      <div class="row"><span class="label">👤 Người chơi</span><span class="value">${username}</span></div>
      <div class="row"><span class="label">💰 Tiền cược</span><span class="value">${Number(amount).toLocaleString('vi-VN')}đ</span></div>
      <div class="row"><span class="label">🎮 Trò chơi</span><span class="value">${gameName}</span></div>
      <div class="row"><span class="label">🔢 4 số cuối mã GD</span><span class="value">${lastDigit}</span></div>
      <div class="row"><span class="label">🏆 Kết quả</span><span class="result">${isWin ? 'THẮNG ✅' : 'THUA ❌'}</span></div>
      ${isWin ? `<div class="row"><span class="label">💵 Tiền thưởng</span><span class="result">+${Number(reward).toLocaleString('vi-VN')}đ</span></div>` : ''}
      <div class="row"><span class="label">🆔 Mã GD</span><span class="value" style="font-family:monospace">${transactionId}</span></div>
      <div class="row"><span class="label">🕐 Thời gian</span><span class="value">${new Date().toLocaleString('vi-VN')}</span></div>
    </div>
    <div class="footer">MoneyWin · Hệ thống thông báo tự động</div>
  </div></body></html>`;
}

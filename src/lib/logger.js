
import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

const logDir = path.resolve(process.cwd(), 'logs');

// Tạo thư mục logs nếu chưa có
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const { combine, timestamp, printf, colorize } = winston.format;

// Định dạng log hiển thị
const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0 && level !== 'info') {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

// Cấu hình Logger
const logger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    // Log lỗi riêng
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '14d',
    }),
    // Log tất cả hoạt động
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
    }),
    // Log ra console để pm2 logs xem được
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'HH:mm:ss' }),
        logFormat
      )
    })
  ],
});

export default logger;

# OKVIPBANK Backend API (Hono)

Hệ thống Backend API hợp nhất cho dự án Chẵn Lẻ Bank, chịu trách nhiệm xử lý logic nghiệp vụ, quản lý cơ sở dữ liệu, tích hợp ngân hàng và thông báo Telegram.

## 🚀 Công Nghệ Sử Dụng
- **Framework**: [Hono](https://hono.dev/) (Siêu nhẹ & Hiệu suất cao)
- **Database**: Prisma ORM + MySQL (MariaDB)
- **Authentication**: JWT (JSON Web Token)
- **Automation**: MBBank Direct API + AI Captcha Resolver
- **Notifications**: Telegraf (Telegram Bot API)

## 📁 Cấu Trúc Thư Mục
```text
backend/
├── src/
│   ├── index.js             # Entry point, đăng ký route & khởi chạy Worker/Bot
│   ├── routes/              # Danh sách các API endpoints (Auth, Admin, Game...)
│   ├── middleware/          # Kiểm tra quyền (Auth, Admin), CORS, Rate Limit
│   ├── lib/                 # Thư viện dùng chung (Prisma, Logger)
│   └── telegram-bot.js      # Dịch vụ thông báo qua Telegram
├── prisma/                  # Cấu hình Database & Schema
├── assets/                  # Tài nguyên tĩnh (Ảnh QR, hướng dẫn)
├── logs/                    # Nơi lưu trữ nhật ký hoạt động (combined, error, mbbank)
├── mbbank-worker.mjs        # Worker quét lịch sử giao dịch MBBank
└── server.js                # Node.js server entry point (Port 3010)
```

## 🛠️ Hướng Dẫn Vận Hành

### 1. Cài đặt ban đầu
```bash
cd backend
npm install
npx prisma generate
```

### 2. Chế độ Phát triển (Development)
```bash
npm run dev
```

### 3. Chế độ Production (PM2)
```bash
# Khởi động Backend
pm2 start server.js --name api-hiudev

# Các lệnh quản lý
pm2 status                  # Kiểm tra trạng thái
pm2 logs api-hiudev         # Xem log thời gian thực
pm2 restart api-hiudev      # Khởi động lại
```

## 📊 Hệ Thống Log
Toàn bộ log được tập trung tại thư mục `backend/logs/`:
- `combined-YYYY-MM-DD.log`: Log truy cập API tổng hợp.
- `error-YYYY-MM-DD.log`: Log các lỗi hệ thống.
- `mbbank.log`: Nhật ký chi tiết của MBBank Worker (Kết nối, Đăng nhập, Quét giao dịch).

## 🔐 Bảo Mật
- **Same-origin Proxy**: Backend được cấu hình để chạy sau Nginx Proxy tại đường dẫn `/api`.
- **JWT Auth**: Các endpoint nhạy cảm (Admin, User Profile) đều yêu cầu Header `Authorization: Bearer <token>`.
- **Environment Variables**: Toàn bộ khóa bí mật, thông tin DB được lưu trữ tại `backend/.env`.

---
*Cập nhật lần cuối: 08/05/2026 bởi Antigravity AI.*

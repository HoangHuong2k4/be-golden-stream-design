# MoneyWin Backend (BE) - Hướng dẫn vận hành

Hệ thống Backend được xây dựng trên Hono.js và Prisma, quản lý bởi PM2.

## 🚀 Lệnh vận hành nhanh (Cheat Sheet)

| Hành động | Lệnh |
| :--- | :--- |
| **Khởi động BE** | `pm2 start ecosystem.config.cjs` |
| **Xem Log BE** | `pm2 logs be` |
| **Restart BE** | `pm2 restart be` |
| **Dừng BE** | `pm2 stop be` |
| **Cập nhật Database** | `npx prisma db push` |

## 🛠 Cấu hình Hệ thống (Infrastructure)

- **Cổng chạy (Port):** `3010`
- **Database:** MariaDB / MySQL
  - **Tên DB:** `huong_moneywin`
  - **User:** `huong_moneywin`
  - **Kết nối:** Chạy qua TCP (`127.0.0.1:3306`) để tránh lỗi Unix Socket.

## ⚠️ Lưu ý quan trọng khi sửa cấu hình

1. **Password DB:** Nếu mật khẩu có ký tự đặc biệt như `;` hoặc `@`, bạn **PHẢI** mã hóa URL trong file `ecosystem.config.cjs` và `.env`:
   - `;` đổi thành `%3B`
   - `@` đổi thành `%40`
2. **Localhost vs 127.0.0.1:** Luôn dùng `127.0.0.1` trong chuỗi kết nối DATABASE_URL để ép Prisma dùng TCP. Dùng `localhost` trên Linux thường sẽ bị lỗi `Can't reach database server at /run/mysqld/mysqld.sock`.

## 🤖 MBBank Worker & AI Captcha

Tiến trình tự động quét lịch sử giao dịch MBBank đã được tích hợp sẵn bên trong Backend.
- **Log Worker:** Xem tại `logs/mbbank.log`
- **Captcha:** Tự động giải bằng AI thông qua dịch vụ tại `127.0.0.1:1234`.

---
*Cập nhật lần cuối: 10/05/2026*

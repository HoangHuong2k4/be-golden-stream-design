# Tài liệu Hệ thống MBBank Automation & Admin Management

## 1. Các lệnh vận hành quan trọng (Commands)

### Quản lý Bot (PM2)
- `pm2 restart api-hiudev`: Khởi động lại hệ thống chính (bao gồm cả Worker MBBank).
- `pm2 logs api-hiudev`: Xem log hoạt động của bot và worker.
- `pm2 status`: Kiểm tra trạng thái các ứng dụng đang chạy.

### Quản lý Captcha AI (Docker)
- `cd payment-service`
- `docker compose up -d captcha-resolver`: Khởi động server giải captcha AI.
- `docker compose logs captcha-resolver --tail 20`: Xem log xử lý captcha của AI.

### Quản lý Database (Prisma)
- `npx prisma db push`: Cập nhật cấu trúc database mới nhất từ file `schema.prisma`.
- `npx prisma studio`: Mở giao diện xem/sửa database trực quan trên trình duyệt.

---

## 2. Logic Setup MBBank (Worker)

### Cơ chế Giải Captcha
- **Server AI**: Chạy tại `http://127.0.0.1:1234/resolver`.
- **Hàm xử lý**: `customOCRFunction` trong `mbbank-worker.mjs`.
- **Logic truyền tin**: Ảnh captcha được chuyển sang Base64 -> Xoá kí tự rác -> Mã hoá URL (`encodeURIComponent`) -> Gửi qua POST (`application/x-www-form-urlencoded`).
- **Xử lý treo**: Nếu AI không giải được, bot trả về mã `000000` để thoát vòng lặp thay vì bị treo vô tận.

### Cơ chế Đăng nhập & Lấy số tài khoản (GW300 Fix)
- Bot tự động đăng nhập bằng số điện thoại (`bankUser`).
- Sau khi thành công, bot gọi `mb.getBalance()` để lấy danh sách số tài khoản thực tế.
- Nếu số tài khoản bạn cấu hình không có trong danh sách, bot tự động lấy số tài khoản đầu tiên (`actualAccounts[0]`) để quét giao dịch. Điều này giúp tránh lỗi "Tài khoản không thuộc về khách hàng".

### Quét giao dịch
- Tần suất: 45 giây/lần.
- Kiểm tra hạn mức: Bot so sánh số tiền nhận được với `minBet` và `maxBet` trong database. Nếu không thoả mãn, bot sẽ bỏ qua giao dịch đó.

---

## 3. Logic Admin & Cấu hình (Backend)

### Quản lý Ngân hàng (SystemBank)
- Các trường quan trọng mới thêm:
    - `minBet`: Tiền cược tối thiểu (Mặc định 10,000đ).
    - `maxBet`: Tiền cược tối đa (Mặc định 3,000,000đ).
- API: `/api/admin/banks` (POST, PUT, DELETE).

### Quản lý Cài đặt (SystemSetting)
- Sử dụng dạng Key-Value để lưu các thông số hệ thống chung.
- API: `/api/admin/settings`.

---

## 4. Quy trình xử lý Giao dịch (Users)

1. **Người dùng**: Chuyển tiền vào ngân hàng hiển thị trên web.
2. **Worker**: Quét thấy giao dịch mới -> Kiểm tra Min/Max -> Phân tích nội dung chuyển khoản.
3. **Phân tích**: Dựa trên 2 số cuối mã giao dịch hoặc nội dung để xác định kết quả (Chẵn, Lẻ, Tài, Xỉu).
4. **Kết quả**:
    - Nếu THẮNG: Cộng tiền vào tài khoản User + Tạo lịch sử `GameHistory` trạng thái `WIN`.
    - Nếu THUA: Tạo lịch sử `GameHistory` trạng thái `LOSS`.
    - Nếu sai Min/Max: Bỏ qua (hoặc có thể cấu hình hoàn tiền thủ công).

---

## 5. Cấu trúc thư mục quan trọng
- `/mbbank-worker.mjs`: Trái tim của hệ thống quét ngân hàng.
- `/src/routes/`: Nơi chứa các API xử lý logic Admin và User.
- `/prisma/schema.prisma`: Nơi định nghĩa cấu trúc dữ liệu.
- `/payment-service/`: Nơi chứa Docker giải captcha.

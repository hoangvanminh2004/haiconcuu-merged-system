HỆ THỐNG HỢP NHẤT HAI CON CỪU
=================================

1. Tạo database PostgreSQL mới trên Render hoặc dùng database hiện có.
2. Copy env.example thành file .env rồi sửa DATABASE_URL, SESSION_SECRET.
3. Mở CMD trong thư mục này và chạy:
   npm install
   npm start
4. Truy cập:
   http://localhost:3000
5. Tài khoản admin mặc định lấy theo biến môi trường:
   ADMIN_USERNAME / ADMIN_PASSWORD

CẤU TRÚC WEB
- /              : Trang chủ giới thiệu và nút đăng nhập
- /login         : Trang đăng nhập
- /app           : Khu vực hệ thống nội bộ

CHỨC NĂNG CHÍNH
- Phân hệ xin nghỉ:
  + Tạo đơn nghỉ có phép năm, file đính kèm
  + Chọn bất kỳ cấp trên hợp lệ để ký (tịnh tiến lên)
  + Theo dõi đơn của tôi / đơn chờ tôi ký / toàn bộ đơn
  + Admin cộng trừ phép năm, quản lý phòng ban, quản lý người dùng
- Phân hệ phỏng vấn:
  + Tạo hồ sơ phỏng vấn
  + Sửa / xóa / cập nhật đỗ trượt
  + Xem danh sách của tôi, phòng ban, quản lý hồ sơ
  + Export Excel
  + Download mẫu Excel và import Excel hàng loạt
- Quản trị:
  + Quản lý tài khoản
  + Quản lý công ty
  + Quản lý phòng ban
  + Đổi mật khẩu

GỢI Ý TRIỂN KHAI AN TOÀN
1. Deploy service mới trên Render, KHÔNG đè hệ cũ.
2. Test kỹ trên link mới.
3. Khi ổn mới gắn domain haiconcuu.vn vào service mới.
4. Xóa service cũ sau khi xác nhận dữ liệu và quyền đã ổn.

LƯU Ý
- Hệ thống tự tạo schema nếu bảng chưa có.
- Hệ thống cố gắng tương thích dữ liệu cũ với role cũ và password cũ.
- Với dữ liệu cũ phức tạp, nên backup database trước khi dùng bản mới.

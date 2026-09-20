# 🤖 HƯỚNG DẪN TRIỂN KHAI TRỢ LÝ ZALO AI TOÀN NĂNG (TỪ A - Z)

> **Cẩm nang cài đặt và vận hành Bot Zalo AI thông minh** chạy 24/7 trên máy tính cá nhân, Mini PC hoặc VPS giá rẻ.  
> Tích hợp Google Gemini Flash siêu tốc, cơ sở dữ liệu SQLite, tóm tắt nhóm, đọc tài liệu/hình ảnh và Web Dashboard quản trị hiện đại.

---

## 📌 MỤC LỤC
1. [Bộ tính năng nổi bật của Bot](#1-bộ-tính-năng-nổi-bật-của-bot)
2. [Chuẩn bị trước khi bắt đầu](#2-chuẩn-bị-trước-khi-bắt-đầu)
3. [Cài đặt nhanh trên máy tính / Mini PC (Local)](#3-cài-đặt-nhanh-trên-máy-tính--mini-pc-local)
4. [Triển khai chạy 24/7 trên VPS Ubuntu (Khuyên dùng)](#4-triển-khai-chạy-247-trên-vps-ubuntu-khuyên-dùng)
5. [Đăng nhập Zalo cho Bot (Quét QR)](#5-đăng-nhập-zalo-cho-bot-quét-qr)
6. [Cấu hình Super Admin (Chủ nhân của Bot)](#6-cấu-hình-super-admin-chủ-nhân-của-bot)
7. [Bí kíp vận hành an toàn (Chống khóa nick Zalo)](#7-bí-kíp-vận-hành-an-toàn-chống-khóa-nick-zalo)
8. [Các câu hỏi thường gặp (FAQ)](#8-các-câu-hỏi-thường-gặp-faq)

---

## 1. BỘ TÍNH NĂNG NỔI BẬT CỦA BOT

- ⚡ **Hỏi đáp AI siêu tốc (1–2 giây)**: Sử dụng mô hình Google Gemini 2.5/1.5 Flash thông minh, văn phong tự nhiên, hài hước hoặc chuyên nghiệp tùy chỉnh theo từng nhóm.
- 👑 **Nhận diện Chủ nhân (Super Admin)**: Bot biết ai là Sếp để xưng hô tôn trọng, nhận chỉ đạo trực tiếp và gửi báo cáo phân tích riêng tư.
- 📊 **Tự động tóm tắt thảo luận (Daily Summary)**: Tổng hợp nội dung chat hàng ngày của nhóm, lưu trữ vào Hub tri thức để tra cứu lại mọi lúc.
- 📎 **Đọc hiểu Đa phương tiện**: Phân tích hình ảnh, đọc tài liệu đính kèm (PDF, Word, Excel, text).
- 📑 **Đồng bộ tri thức Google Doc / Sheet**: Tự động tra cứu bảng giá, chính sách, tài liệu nội bộ từ link Google Drive thời gian thực.
- 🔒 **Bảo mật & Cô lập dữ liệu**: Tuyệt đối không để lộ thông tin thảo luận giữa các nhóm chat với nhau.
- 🌐 **Web Dashboard trực quan**: Xem thống kê tin nhắn, xếp hạng thành viên, chỉnh sửa prompt và cấu hình từng nhóm ngay trên trình duyệt.

---

## 2. CHUẨN BỊ TRƯỚC KHI BẮT ĐẦU

Chỉ cần chuẩn bị 3 thứ (tốn khoảng 5 phút):

1. **1 Tài khoản Zalo phụ**:
   - Dùng một SIM phụ để đăng ký Zalo làm Bot.
   - *Lưu ý*: Tài khoản nên được tạo trên 1–2 tuần và có kết bạn, nhắn tin vài lần để tránh cơ chế quét tài khoản mới của Zalo.
2. **1 API Key Google Gemini (Miễn phí)**:
   - Truy cập: [Google AI Studio](https://aistudio.google.com/app/apikey).
   - Đăng nhập tài khoản Google và bấm **Create API key**.
   - Copy mã API key lưu lại.
3. **Môi trường chạy**:
   - Máy tính cá nhân (Windows, Mac, Linux), Mini PC hoặc VPS Ubuntu.
   - Cài sẵn **Node.js phiên bản 18 hoặc 20 LTS** ([Tải tại nodejs.org](https://nodejs.org)).

---

## 3. CÀI ĐẶT NHANH TRÊN MÁY TÍNH / MINI PC (LOCAL)

### Bước 1: Tải mã nguồn về máy
Mở Terminal (hoặc PowerShell/Command Prompt trên Windows) và gõ:
```bash
git clone <URL_REPO_CUA_BAN> zalo-bot
cd zalo-bot
```

### Bước 2: Cài đặt thư viện cho Bot và Web
```bash
# Cài đặt cho phần Bot lõi
cd bot
npm install

# Cài đặt cho Web Dashboard
cd ../web
npm install
cd ..
```

### Bước 3: Cấu hình file môi trường `.env`
Vào thư mục `bot`, copy file mẫu `.env.example` thành `.env`:
```bash
cp bot/.env.example bot/.env
```

Mở file `bot/.env` bằng trình soạn thảo (VS Code, Notepad, Nano...) và điền các thông tin quan trọng nhất:
```env
# 1. API Key Gemini (BẮT BUỘC)
GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere..."

# 2. Tên Bot mặc định
DEFAULT_BOT_NAME="Sen Chúa"

# 3. ID Zalo của bạn (Để bot nhận diện bạn là Super Admin / Sếp)
# (Xem mục 6 bên dưới để biết cách lấy ID này)
ADMIN_ZALO_ID="123456789012345678"

# 4. Cổng chạy Web Dashboard
WEB_PORT=3000
```

---

## 4. TRIỂN KHAI CHẠY 24/7 TRÊN VPS UBUNTU (KHUYÊN DÙNG)

Để bot hoạt động liên tục ngay cả khi tắt máy tính, bạn nên thuê 1 VPS Ubuntu giá rẻ (~50.000đ – 100.000đ/tháng từ Vietnix, TinoHost, OVH, DigitalOcean...):

### Bước 1: Cài Node.js và PM2 trên VPS
```bash
# Cập nhật hệ thống
sudo apt update && sudo apt upgrade -y

# Cài Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# Cài PM2 để quản lý tiến trình chạy ngầm
sudo npm install -g pm2
```

### Bước 2: Tải code và Build dự án
```bash
git clone <URL_REPO_CUA_BAN> ~/zalo-bot
cd ~/zalo-bot

# Cài đặt và build Bot
cd bot
npm install
npm run build

# Cài đặt và build Web Dashboard
cd ../web
npm install
npm run build
cd ..
```

### Bước 3: Khởi chạy dịch vụ với PM2
```bash
# Chạy Bot
cd ~/zalo-bot/bot
pm2 start dist/index.js --name "zalo-bot"

# Chạy Web Dashboard
cd ~/zalo-bot/web
pm2 start npm --name "zalo-web" -- start -- -p 3000

# Lưu trạng thái để tự khởi động lại khi VPS reboot
pm2 save
pm2 startup
```

---

## 5. ĐĂNG NHẬP ZALO CHO BOT (QUÉT QR)

Bạn có thể đăng nhập bằng 1 trong 2 cách cực kỳ tiện lợi:

### Cách 1: Quét mã QR trực tiếp trên Web Dashboard (Tiện nhất)
1. Mở trình duyệt vào địa chỉ: `http://localhost:3000/login` (hoặc `http://<IP_VPS>:3000/login`).
2. Bấm nút **"Bắt đầu đăng nhập Zalo"**.
3. Màn hình sẽ xuất hiện mã QR. Mở ứng dụng Zalo trên điện thoại (tài khoản bot), bấm vào biểu tượng quét QR góc trên cùng bên phải để quét.
4. Bấm **"Đăng nhập"** trên điện thoại để xác nhận.

### Cách 2: Quét mã QR ngay trên Terminal
Nếu chạy trên VPS không có giao diện web ngay lúc đầu:
```bash
cd ~/zalo-bot/bot
npm run dev
```
Mã QR dạng ASCII sẽ vẽ ngay trên màn hình đen của terminal. Dùng điện thoại quét mã này là xong!

> **Lưu ý quan trọng**: Sau khi quét thành công, toàn bộ session/cookie đăng nhập sẽ được lưu an toàn tại thư mục `bot/data/`. **Những lần khởi động sau, bot sẽ tự động đăng nhập mà KHÔNG cần quét lại mã QR!**

---

## 6. CẤU HÌNH SUPER ADMIN (CHỦ NHÂN CỦA BOT)

Để bot nhận diện bạn là **Sếp / Super Admin** và gọi bằng danh xưng đặc quyền:

1. Thêm tài khoản bot vào 1 nhóm chat có bạn, hoặc nhắn tin riêng 1:1 với bot một câu: `Chào em`.
2. Mở file log của bot trên terminal (`pm2 logs zalo-bot` hoặc nhìn cửa sổ đang chạy), bạn sẽ thấy dòng hiển thị ID người gửi:
   ```text
   [listener] Nhận tin nhắn từ: Nguyen Van A (ID: 8498765432109876)
   ```
3. Copy dãy số `8498765432109876` đó.
4. Dán vào file `bot/.env`:
   ```env
   ADMIN_ZALO_ID="8498765432109876"
   ```
5. Khởi động lại bot (`pm2 restart zalo-bot`). Từ giờ, mỗi khi bạn nhắn tin, bot sẽ lập tức nhận diện và phục vụ theo đúng phong cách dành riêng cho Sếp!

---

## 7. BÍ KÍP VẬN HÀNH AN TOÀN (CHỐNG KHÓA NICK ZALO)

Zalo là mạng xã hội có cơ chế chống spam rất chặt. Hệ thống bot này đã tích hợp sẵn các thuật toán bảo vệ, bạn chỉ cần lưu ý:

1. ✅ **Giữ thời gian nghỉ tự nhiên (`ZALO_THROTTLE_MS`)**:
   - Mặc định bot đã cài độ trễ từ 1.5 đến 3 giây trước khi phản hồi, đồng thời hiển thị trạng thái "đang gõ tin nhắn..." (`sendTyping`) giống hệt người thật. Không nên hạ thông số này về 0.
2. ❌ **Không spam tin nhắn quảng cáo**:
   - Tuyệt đối không dùng bot để gửi hàng loạt tin nhắn rác hoặc link lạ vào các nhóm ngoài. Bot sinh ra để làm trợ lý thông minh hỗ trợ thành viên, không phải tool spam.
3. ✅ **Ưu tiên tài khoản Zalo đã có tương tác**:
   - Dùng tài khoản đã hoạt động bình thường trên 2 tuần. Tránh dùng SIM rác vừa kích hoạt 5 phút đã nạp vào bot ngay.
4. 🔒 **Bảo mật tuyệt đối file Session và `.env`**:
   - Thư mục `bot/data/` chứa file session đăng nhập Zalo. Tuyệt đối **KHÔNG** gửi thư mục này cho người khác hoặc commit lên GitHub công khai!

---

## 8. CÁC CÂU HỎI THƯỜNG GẶP (FAQ)

#### Q: Tôi có mất tiền duy trì API Gemini hàng tháng không?
> **A**: **Hoàn toàn 0 đồng!** Google cung cấp gói miễn phí cho mô hình Gemini Flash (khoảng 15 yêu cầu/phút và hàng trăm ngàn ký tự/ngày). Với nhu cầu nhóm chat thông thường, quota miễn phí là thừa đủ dùng.

#### Q: Có cần cấp quyền Trưởng/Phó nhóm cho Bot không?
> **A**: Không bắt buộc! Chỉ cần thêm Bot làm thành viên thông thường là bot đã có thể trò chuyện, trả lời và tóm tắt tin nhắn. Nếu muốn dùng tính năng thanh lọc/kick thành viên không hoạt động thì mới cần cấp quyền Phó nhóm.

#### Q: Khi VPS bị reboot hoặc mất điện thì sao?
> **A**: Vì đã cấu hình với `pm2 startup` và `pm2 save`, ngay khi VPS có điện trở lại, hệ thống sẽ tự động bật Bot và tự động kết nối lại Zalo mà không cần bạn làm gì thêm.

---

Chúc bạn triển khai thành công một Trợ lý AI Zalo thông minh, mượt mà và độc đáo cho riêng mình! 🎉

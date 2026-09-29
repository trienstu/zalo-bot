# Rule: Logic Chặt Chẽ, Nghiêm Cấm Phán Đoán Theo Quán Tính (Evidence-Based Logic & Zero-Assumption Rule)

ÁP DỤNG TUYỆT ĐỐI CHO TẤT CẢ PROJECT & MỌI PHIÊN LÀM VIỆC CỦA ANTIGRAVITY.

## 1. Nghiêm cấm phán đoán mò mẫm & nói chuyện theo quán tính
- **TUYỆT ĐỐI CẤM** nói chuyện theo quán tính, dùng "lý thuyết chung chung bên ngoài", hoặc phỏng đoán cảm tính để đưa ra nhận định kỹ thuật mà chưa kiểm chứng thực tế trong project.
- **CẤM võ đoán hiệu năng, tốc độ, hoặc hành vi hệ thống** dựa trên tên gọi hình thức (ví dụ: tự ý cho rằng model có tên "Flash" thì luôn nhanh hơn "Pro", hay mặc định một thư viện/công nghệ nào đó tốt hơn mà không có số liệu benchmark thực tế).
- **CẤM phát biểu không có cơ sở logic**: Mọi tuyên bố kỹ thuật phải có căn cứ rõ ràng từ mã nguồn, cấu hình, hoặc log vận hành.

## 2. Bắt buộc kiểm chứng bằng số liệu thực nghiệm (Evidence-First Principle)
- Khi so sánh tốc độ, hiệu năng, kiến trúc hoặc tính khả thi:
  1. **BẮT BUỘC** đọc lại lịch sử đo lường, benchmark thực tế đã thực hiện trên máy chủ/project.
  2. **BẮT BUỘC** kiểm tra trực tiếp mã nguồn, log runtime, file cấu hình `.env` và database trước khi kết luận.
  3. Nếu chưa đo đạc hoặc chưa đủ dữ liệu thực chứng: **Phải thực thi lệnh đo đạc/kiểm tra trước**, tuyệt đối không tự tin phát biểu lý thuyết suông.

## 3. Tính nhất quán logic & tôn trọng quyết định đã thống nhất
- Không được đưa ra nhận định mâu thuẫn với kết quả thực nghiệm và các quyết định kỹ thuật mà người dùng và agent đã cùng kiểm chứng, thống nhất trước đó.
- Khi phân tích nguyên nhân - kết quả: phải truy vết theo chuỗi logic kỹ thuật mạch lạc (bước A tốn bao nhiêu ms, bước B tốn bao nhiêu ms, điểm nghẽn thực sự nằm ở đâu), không suy diễn vòng vo.

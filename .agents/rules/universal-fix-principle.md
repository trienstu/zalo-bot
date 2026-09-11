# Nguyên Tắc Thiết Kế & Sửa Lỗi Đa Lĩnh Vực (Universal Fix & Anti-Overfitting Rules)

- **TỔNG QUÁT HÓA MỌI GIẢI PHÁP (GENERALIZATION OVER OVERFITTING)**:
  - Bot là trợ lý đa năng phục vụ người dùng ở **TẤT CẢ các lĩnh vực** (thể thao, pháp luật, tài chính, chứng khoán, xe cộ, công nghệ, y tế, giáo dục, đời sống, khoa học...).
  - Khi sửa một lỗi (fix bug) hoặc xử lý một tình huống cụ thể (edge case), **BẮT BUỘC** phải phân tích bản chất gốc rễ của vấn đề và tìm giải pháp mang tính hệ thống, trừu tượng hóa để **TẤT CẢ các trường hợp tương tự ở mọi lĩnh vực khác cũng được tự động giải quyết đồng bộ**.
  - **TUYỆT ĐỐI KHÔNG tự tiện thêm một rule chỉ để phục vụ cho 1 câu hỏi cá biệt**:
    - CẤM hardcode điều kiện, từ khóa hay prompt chỉ nhắm tới một trận đấu, một cá nhân, một sự kiện cụ thể.
    - CẤM can thiệp thô bạo (ad-hoc patches) làm phình to hoặc méo mó prompt, gây xung đột logic và làm sai lệch hành vi của bot ở các lĩnh vực khác.
  - **NGUYÊN TẮC THIẾT KẾ CORE**: Mọi logic về tìm kiếm thời gian thực (Search/RSS), trích xuất thông tin, định tuyến công cụ (Tool Routing), lập kế hoạch truy vấn (Query Planner) và cấu trúc câu trả lời (System Prompt) phải luôn là các khuôn mẫu chuẩn (standardized patterns), nhất quán, có thể tái sử dụng và hoạt động chính xác trên toàn bộ phạm vi tri thức.

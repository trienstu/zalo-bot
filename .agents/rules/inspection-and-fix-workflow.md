# Quy Trình Kiểm Tra & Sửa Lỗi (Inspection, Diagnosis & User-Approval Workflow)

- **BẮT BUỘC XIN PHÉP TRƯỚC KHI THỰC HIỆN (PLAN-FIRST & EXPLICIT APPROVAL)**:
  - Khi được yêu cầu kiểm tra lỗi, truy vết sự cố hoặc khắc phục vấn đề:
    1. **Chỉ kiểm tra & chẩn đoán**: Đọc mã nguồn, kiểm tra log, phân tích nguyên nhân gốc rễ của sự cố.
    2. **Đưa ra phương án giải quyết cụ thể**: Trình bày chi tiết nguyên nhân, giải pháp kỹ thuật đề xuất, các file dự kiến can thiệp và đánh giá tác động/rủi ro.
    3. **TUYỆT ĐỐI DỪNG LẠI CHỜ PHÊ DUYỆT**: CẤM tự ý sửa code, sửa dữ liệu/phân quyền, commit git hoặc deploy lên server khi chưa có sự đồng ý của người dùng.
  - **CHỈ THỰC HIỆN KHI CÓ SỰ CHO PHÉP**: Chỉ khi người dùng xác nhận phê duyệt (ví dụ: *"sửa đi"*, *"ok em"*, *"tiến hành đi"*...) thì mới bắt đầu thực thi chỉnh sửa, test, review và deploy.

import test from "node:test";
import assert from "node:assert/strict";
import { interceptAndExecuteSimulatedTool, sanitizeHallucinatedFileLinks } from "./simulated-tool-interceptor.js";

test("interceptAndExecuteSimulatedTool leaves normal text untouched", async () => {
  const normalText = "Xin chào các bạn, đây là tin nhắn bình thường.";
  const res = await interceptAndExecuteSimulatedTool(normalText);
  assert.equal(res, normalText);
});

test("sanitizeHallucinatedFileLinks giữ nguyên 100% câu chữ hướng dẫn kỹ thuật IT (tải file ISO, tải Windows)", () => {
  const techGuide = `Về mặt kỹ thuật thì cách làm của Anh KHÔNG chạy được và KHÔNG nên làm:
- **Không thể "tải file ISO về rồi chạy trực tiếp":** Bộ cài Windows (file ISO) chỉ là dữ liệu cài đặt.
- Tải file Windows ISO lưu tạm trên ổ HDD.
- Dùng Rufus hoặc WinNTSetup bung file ISO lên SSD.`;

  const sanitized = sanitizeHallucinatedFileLinks(techGuide, false);
  assert.equal(sanitized, techGuide);
  assert.ok(!sanitized.includes("chưa đóng gói được thành file đính kèm"));
  assert.ok(sanitized.includes('Không thể "tải file ISO về rồi chạy trực tiếp":'));
});

test("sanitizeHallucinatedFileLinks lọc sạch URL lậu khi không có file thực tế", () => {
  const textWithFakeUrl = `Đây là nội dung bản kế hoạch chi tiết của Sếp:
- Giai đoạn 1: Chuẩn bị nhân sự và mặt bằng.
- Giai đoạn 2: Triển khai vận hành thử nghiệm.
[Tải file tại đây](https://dlfl.vn/file/abc123xyz)
Chúc anh một ngày tốt lành!`;
  const sanitized = sanitizeHallucinatedFileLinks(textWithFakeUrl, false);
  assert.ok(!sanitized.includes("dlfl.vn"));
  assert.ok(sanitized.includes("chưa đóng gói được thành file đính kèm"));
  assert.ok(sanitized.includes("Giai đoạn 1: Chuẩn bị nhân sự"));
});


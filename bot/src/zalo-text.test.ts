import test from "node:test";
import assert from "node:assert/strict";
import { cleanZaloText } from "./zalo/client.js";

test("cleanZaloText: Xóa sạch markdown bold ** và bold italic ***", () => {
  const input = "1. **Nhân vật chính:** Một anh PT.\n2. **Khách hàng:** Một bạn nữ.\nThì thưa rằng: **Trong hình ảnh này không có.**";
  const expected = "1. Nhân vật chính: Một anh PT.\n2. Khách hàng: Một bạn nữ.\nThì thưa rằng: Trong hình ảnh này không có.";
  assert.equal(cleanZaloText(input), expected);
});

test("cleanZaloText: Xóa italic trong ngoặc kép hoặc từ đơn nhưng giữ phép nhân toán học", () => {
  const input = 'Anh Ricky phán một câu xanh rờn là *"cần cái đầu lạnh"* hả sếp? Tính toán: 2 * 3 = 6 và a * b = c.';
  const expected = 'Anh Ricky phán một câu xanh rờn là "cần cái đầu lạnh" hả sếp? Tính toán: 2 * 3 = 6 và a * b = c.';
  assert.equal(cleanZaloText(input), expected);
});

test("cleanZaloText: Chuyển Markdown link [text](url) sang text (url)", () => {
  const input = "Xem chi tiết tại [Google Gemini](https://gemini.google.com).";
  const expected = "Xem chi tiết tại Google Gemini (https://gemini.google.com).";
  assert.equal(cleanZaloText(input), expected);
});

test("cleanZaloText: Tiết chế icon ở gạch đầu dòng và chuyển star bullet thành bullet tròn", () => {
  const input = `⚖️ SO SÁNH ĐA CHIỀU CÁC MODEL HÀNG ĐẦU (THÁNG 9/2026)

⭐ Gemini 4 Pro (Dự kiến từ Google)
- ⭐ Điểm mạnh nhất: Giữ vững lợi thế context dài.
- 🔍 So sánh tương quan: Vượt trội về dung lượng.
- ⚠️ Điểm trừ / Lưu ý: Chưa có giá chính thức.

⭐ GPT-6 Astra (OpenAI)
- ⭐ Điểm mạnh nhất: Thống trị benchmark.
- 🔍 So sánh tương quan: Context 1M.
- ⚠️ Điểm trừ / Lưu ý: Chi phí vận hành cao.

📌 TÓM LẠI & LỜI KHUYÊN THỰC CHIẾN`;

  const output = cleanZaloText(input);

  // Không còn icon sau dấu gạch đầu dòng
  assert.ok(!output.includes("- ⭐"), "Không được còn - ⭐");
  assert.ok(!output.includes("- 🔍"), "Không được còn - 🔍");
  assert.ok(!output.includes("- ⚠️"), "Không được còn - ⚠️");

  // Các mục lớn chuyển thành • Gemini 4 Pro và • GPT-6 Astra
  assert.ok(output.includes("• Gemini 4 Pro"), "Phải chuyển ⭐ đầu mục thành •");
  assert.ok(output.includes("• GPT-6 Astra"), "Phải chuyển ⭐ đầu mục thành •");

  // Giữ lại icon ở tiêu đề chính
  assert.ok(output.includes("⚖️ SO SÁNH"), "Giữ lại icon tiêu đề");
  assert.ok(output.includes("📌 TÓM LẠI"), "Giữ lại icon tiêu đề");
});

test("cleanZaloText: Thu gọn spam nhiều emoji liên tiếp", () => {
  const input = "Chúc mừng sếp ngày mới rực rỡ nhé! 🔥🔥🔥 Cố lên nào! ✨✨✨";
  const output = cleanZaloText(input);
  assert.ok(!output.includes("🔥🔥🔥"), "Không được để 3 emoji liên tiếp");
  assert.ok(!output.includes("✨✨✨"), "Không được để 3 emoji liên tiếp");
  assert.ok(output.includes("🔥"), "Phải giữ lại 1 emoji đại diện");
});

test("cleanZaloText: Tự động chuyển đổi công thức Toán/Lý LaTeX sang Unicode sạch", () => {
  const input = "Độ lớn lực từ $F = \\frac{I \\cdot B \\cdot L}{\\sin\\alpha}$, gia tốc $a = 1\\text{ m/s}^2$ và $\\vec{B}$.";
  const output = cleanZaloText(input);
  assert.ok(!output.includes("\\frac"), "Không còn \\frac");
  assert.ok(!output.includes("\\alpha"), "Không còn \\alpha");
  assert.ok(!output.includes("$"), "Không còn $");
  assert.ok(output.includes("α"), "Có ký tự α");
  assert.ok(output.includes("1 m/s²"), "Có 1 m/s²");
  assert.ok(output.includes("vectơ B"), "Có vectơ B");
});


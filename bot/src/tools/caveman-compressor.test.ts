import test from "node:test";
import assert from "node:assert/strict";
import {
  compressCaveman,
  compressChatHistoryForPrompt,
  CAVEMAN_INTERNAL_DIRECTIVE,
} from "./caveman-compressor.js";

test("Caveman Compressor: lược bỏ câu chào rườm rà và câu chúc cuối mà vẫn giữ nguyên code", () => {
  const verboseText = `
Dạ em chào anh Triển ạ!
Dưới đây là đoạn mã TypeScript để tính tổng doanh thu:
\`\`\`typescript
export function sum(a: number, b: number): number {
  return a + b;
}
\`\`\`
Hy vọng thông tin trên sẽ giúp ích cho anh! Chúc anh một ngày vui vẻ!
  `.trim();

  const compressed = compressCaveman(verboseText);

  // Không còn câu chào "Dạ em chào anh Triển ạ!"
  assert.ok(!compressed.includes("Dạ em chào anh Triển ạ!"));
  // Không còn câu chúc "Chúc anh một ngày vui vẻ!"
  assert.ok(!compressed.includes("Chúc anh một ngày vui vẻ!"));
  // Khối code TypeScript được giữ nguyên vẹn 100%
  assert.ok(compressed.includes("export function sum(a: number, b: number): number {"));
  assert.ok(compressed.includes("return a + b;"));
});

test("Caveman Compressor: nén lịch sử chat hiệu quả, loại bỏ tin nhắn rác định kỳ", () => {
  const rawHistory = [
    { display_name: "Triển", text: "Em ơi check giùm anh báo cáo quý 3 nhé" },
    { is_self: 1, text: "Dạ vâng anh, để em tra cứu số liệu ngay ạ!" },
    { is_self: 1, text: "🌅 [BẢN TIN SÁNG] Thời tiết hôm nay mát mẻ..." }, // Tin rác định kỳ phải bị bỏ qua
    { display_name: "Lân", text: "Doanh thu tháng này tăng 15% so với tháng trước" },
  ];

  const compressedHistory = compressChatHistoryForPrompt(rawHistory);

  assert.ok(compressedHistory.includes("- Triển: Em ơi check giùm anh báo cáo quý 3 nhé"));
  assert.ok(compressedHistory.includes("- Bot: Dạ vâng anh, để em tra cứu số liệu ngay ạ!"));
  assert.ok(compressedHistory.includes("- Lân: Doanh thu tháng này tăng 15% so với tháng trước"));
  assert.ok(!compressedHistory.includes("BẢN TIN SÁNG"));
});

test("Caveman Compressor: chỉ thị Agent nội bộ có mặt và chứa các nguyên tắc cốt lõi", () => {
  assert.ok(CAVEMAN_INTERNAL_DIRECTIVE.includes("Respond terse like smart caveman"));
  assert.ok(CAVEMAN_INTERNAL_DIRECTIVE.includes("NEVER explain what tool you are about to call"));
  assert.ok(CAVEMAN_INTERNAL_DIRECTIVE.includes("ALWAYS preserve verbatim: code blocks, markdown tables"));
});

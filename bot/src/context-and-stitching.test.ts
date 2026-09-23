import assert from "node:assert/strict";
import test from "node:test";
import { stitchMultiChunkQuote, searchPermanentKnowledge } from "./db/index.js";

test("stitchMultiChunkQuote trả về nguyên bản nếu quote ngắn hoặc không tìm thấy", () => {
  const shortText = "tin nhắn ngắn";
  assert.equal(stitchMultiChunkQuote("dummy-thread", shortText), shortText);
});

test("stitchMultiChunkQuote khâu nối thành công các mảnh tin nhắn thực tế trong DB", () => {
  const quoteSnippet = "@Lâm Giao Chào anh Lâm Giao, dưới góc độ chuyên gia";
  const stitched = stitchMultiChunkQuote("6036129215420269393", quoteSnippet);
  
  assert.ok(stitched.length > 5000, `Nội dung khâu nối phải đầy đủ (>5000 ký tự), thực tế: ${stitched.length}`);
  assert.ok(stitched.includes("KỊCH BẢN 1"), "Phải chứa KỊCH BẢN 1");
  assert.ok(stitched.includes("KỊCH BẢN 2"), "Phải chứa KỊCH BẢN 2");
  assert.ok(stitched.includes("KỊCH BẢN 3"), "Phải chứa KỊCH BẢN 3");
  assert.ok(stitched.includes("CELESTA GOLD"), "Phải chứa dự án Celesta Gold");
});

test("searchPermanentKnowledge không bị rò rỉ Palm City khi hỏi dự án khác", () => {
  const res = searchPermanentKnowledge(
    "sen chúa xuất file docx 3 kịch bản bđs celesta gold keppel land",
    "all",
    2,
    "kịch bản video bất động sản chuyên sâu",
  );
  assert.equal(res.length, 0, "Không được match Palm City cho câu hỏi Celesta Gold");
});

test("searchPermanentKnowledge match chính xác khi hỏi đúng Palm River", () => {
  const res = searchPermanentKnowledge("thông tin dự án Palm River thế nào bot", "all", 2);
  assert.ok(res.length > 0, "Phải match Palm River khi hỏi đúng tên");
  assert.equal(res[0].topic, "Palm River");
});

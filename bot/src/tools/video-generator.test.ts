import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareVideoImageDataUrl,
  isMuseVideoConfigured,
  generateAiVideo,
} from "./video-generator.js";
import { checkIsVideoRequest } from "./file-generator.js";

test("prepareVideoImageDataUrl chuyển đổi chính xác các định dạng ảnh đầu vào", () => {
  // 1. Data URL giữ nguyên
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  assert.equal(prepareVideoImageDataUrl(dataUrl), dataUrl);

  // 2. URL http/https giữ nguyên
  const httpUrl = "https://example.com/sample.jpg";
  assert.equal(prepareVideoImageDataUrl(httpUrl), httpUrl);

  // 3. Buffer chuyển sang Data URL
  const buf = Buffer.from("test video reference frame");
  const resBuf = prepareVideoImageDataUrl(buf);
  assert.ok(resBuf?.startsWith("data:image/png;base64,"));

  // 4. Null / empty trả về null
  assert.equal(prepareVideoImageDataUrl(""), null);
  assert.equal(prepareVideoImageDataUrl(null), null);
  assert.equal(prepareVideoImageDataUrl(undefined), null);
});

test("isMuseVideoConfigured kiểm tra cấu hình Muse API", () => {
  const isConfigured = isMuseVideoConfigured();
  assert.equal(typeof isConfigured, "boolean");
});

test("checkIsVideoRequest nhận diện chính xác các ý định tạo video AI", () => {
  // 1. Lệnh trực tiếp tạo video
  assert.equal(checkIsVideoRequest("Tạo cho anh video AI chú mèo đang ngủ dưới ánh nắng"), true);
  assert.equal(checkIsVideoRequest("Làm clip 5s mô tả siêu xe chạy trên đường cao tốc"), true);
  assert.equal(checkIsVideoRequest("Dựng thước phim ngắn về phong cảnh mùa thu"), true);
  assert.equal(checkIsVideoRequest("Biến ảnh này thành video nhé bot"), true);
  assert.equal(checkIsVideoRequest("Chuyển bức ảnh này thành video"), true);
  assert.equal(checkIsVideoRequest("!taovideo Một chú rùa bơi dưới rạn san hô"), true);
  assert.equal(checkIsVideoRequest("xuất video AI về vũ trụ bao la"), true);

  // 2. Phân biệt với câu hỏi năng lực hoặc phàn nàn
  assert.equal(checkIsVideoRequest("em có biết tạo video không?"), false);
  assert.equal(checkIsVideoRequest("tại sao lại tạo video làm gì"), false);
  assert.equal(checkIsVideoRequest("không yêu cầu tạo video nhé"), false);

  // 3. Phân biệt với yêu cầu tải video từ mạng (download tool)
  assert.equal(checkIsVideoRequest("Tải video tiktok https://vt.tiktok.com/xyz giúp anh"), false);
  assert.equal(checkIsVideoRequest("download video youtube này về"), false);

  // 4. Follow-up từ quote có video
  const quoteWithVideo = "🎬 Muse Video đang khởi tạo phân cảnh cho bạn...";
  assert.equal(checkIsVideoRequest("ok triển luôn đi em", quoteWithVideo), true);
  assert.equal(checkIsVideoRequest("làm lại cẩn thận hơn", quoteWithVideo), true);
});

test("generateAiVideo trả về lỗi an toàn khi không có MUSE_API_KEY", async () => {
  const { config } = await import("../config.js");
  const originalKey = config.museApiKey;
  try {
    (config as any).museApiKey = "";
    const res = await generateAiVideo("A flying bird over mountains");
    assert.equal(res.success, false);
    assert.ok(res.error?.includes("MUSE_API_KEY"));
  } finally {
    (config as any).museApiKey = originalKey;
  }
});

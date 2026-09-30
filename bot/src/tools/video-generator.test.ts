import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareVideoImageDataUrl,
  isMuseVideoConfigured,
  generateAiVideo,
  detectMediaTypeFromBuffer,
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

test("detectMediaTypeFromBuffer nhận diện chính xác định dạng video và chặn ảnh", () => {
  // 1. JPEG image header: FF D8 FF
  const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
  const jpegRes = detectMediaTypeFromBuffer(jpegBuf);
  assert.equal(jpegRes.isVideo, false);
  assert.equal(jpegRes.format, "jpeg");

  // 2. PNG image header: 89 50 4E 47
  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const pngRes = detectMediaTypeFromBuffer(pngBuf);
  assert.equal(pngRes.isVideo, false);
  assert.equal(pngRes.format, "png");

  // 3. WebP image header: RIFF....WEBP
  const webpBuf = Buffer.from("RIFFxxxxWEBPVP8 ");
  const webpRes = detectMediaTypeFromBuffer(webpBuf);
  assert.equal(webpRes.isVideo, false);
  assert.equal(webpRes.format, "webp");

  // 4. MP4 video header: 00 00 00 20 ftyp mp42
  const mp4Buf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00]);
  const mp4Res = detectMediaTypeFromBuffer(mp4Buf);
  assert.equal(mp4Res.isVideo, true);
  assert.equal(mp4Res.format, "mp4");

  // 5. WebM video header: 1A 45 DF A3
  const webmBuf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81]);
  const webmRes = detectMediaTypeFromBuffer(webmBuf);
  assert.equal(webmRes.isVideo, true);
  assert.equal(webmRes.format, "webm");
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


import test from "node:test";
import assert from "node:assert/strict";
import { mapAspectRatioToSize, isCodexImageConfigured } from "./codex-image.js";

test("mapAspectRatioToSize chuyển đổi tỉ lệ ảnh chuẩn xác cho Codex / DALL-E", () => {
  assert.equal(mapAspectRatioToSize("1:1"), "1024x1024");
  assert.equal(mapAspectRatioToSize("16:9"), "1792x1024");
  assert.equal(mapAspectRatioToSize("4:3"), "1792x1024");
  assert.equal(mapAspectRatioToSize("9:16"), "1024x1792");
  assert.equal(mapAspectRatioToSize("3:4"), "1024x1792");
});

test("isCodexImageConfigured kiểm tra trạng thái cấu hình 9Router/Codex", () => {
  const isConfigured = isCodexImageConfigured();
  assert.equal(typeof isConfigured, "boolean");
});

test("generateCodexImage trả về đúng hợp đồng CodexImageResult khi không có API key", async () => {
  const { hybridAgentSettings } = await import("./config.js");
  const originalKey = process.env.NINE_ROUTER_API_KEY;
  const originalRouterKey = hybridAgentSettings.nineRouter.apiKey;
  try {
    delete process.env.NINE_ROUTER_API_KEY;
    hybridAgentSettings.nineRouter.apiKey = "";
    const { generateCodexImage } = await import("./codex-image.js");
    const res = await generateCodexImage("test prompt");
    assert.equal(typeof res.success, "boolean");
    assert.equal(typeof res.filePath, "string");
  } finally {
    if (originalKey) process.env.NINE_ROUTER_API_KEY = originalKey;
    hybridAgentSettings.nineRouter.apiKey = originalRouterKey;
  }
});

test("prepareImageDataUrl chuyển đổi chính xác các định dạng ảnh đầu vào", async () => {
  const { prepareImageDataUrl } = await import("./codex-image.js");
  
  // 1. Data URL giữ nguyên
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  assert.equal(prepareImageDataUrl(dataUrl), dataUrl);

  // 2. Buffer chuyển thành Data URL
  const buf = Buffer.from("test image buffer content");
  const resBuf = prepareImageDataUrl(buf);
  assert.ok(resBuf?.startsWith("data:image/png;base64,"));

  // 3. Null / empty trả về null
  assert.equal(prepareImageDataUrl(""), null);
  assert.equal(prepareImageDataUrl(null as any), null);
});

test("resolveImageModelPreference tuân thủ phân cấp ưu tiên (Explicit Engine > Phong cách > Mặc định)", async () => {
  const { resolveImageModelPreference } = await import("./codex-image.js");

  // 1. Có cả "màu nước" và "codex" -> Explicit engine "codex" phải THẮNG "màu nước"
  assert.equal(
    resolveImageModelPreference("Vẽ cho tôi ảnh thiếu nữ mặc áo dài hoa sen màu nước bằng codex"),
    "codex",
  );

  // 2. Có cả "tả thực 8k" và "gemini" -> Explicit engine "gemini" phải THẮNG "tả thực"
  assert.equal(
    resolveImageModelPreference("Vẽ siêu xe Lamborghini tả thực 8k bằng gemini"),
    "gemini",
  );

  // 3. Chỉ có phong cách màu nước / vẽ tay (không nhắc engine) -> Ưu tiên Gemini (~15s)
  assert.equal(
    resolveImageModelPreference("Vẽ một góc phố cổ Hà Nội phong cách tranh màu nước nghệ thuật"),
    "gemini",
  );
  assert.equal(
    resolveImageModelPreference("Vẽ chân dung hoa hồng handraw vẽ tay"),
    "gemini",
  );

  // 4. Chỉ có phong cách tả thực / 8K (không nhắc engine) -> Ưu tiên Codex
  assert.equal(
    resolveImageModelPreference("Vẽ chân dung cô gái Việt Nam chụp thật siêu nét 8k"),
    "codex",
  );

  // 5. Không có từ khóa phong cách lẫn engine -> Mặc định Codex
  assert.equal(
    resolveImageModelPreference("Vẽ chú mèo con dễ thương đang ngủ"),
    "codex",
  );

  // 6. Model chỉ định qua options/tool calling
  assert.equal(
    resolveImageModelPreference("Vẽ hoa sen màu nước", "codex"),
    "codex",
  );
  assert.equal(
    resolveImageModelPreference("Vẽ con mèo", "gemini"),
    "gemini",
  );
});



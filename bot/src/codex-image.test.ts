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



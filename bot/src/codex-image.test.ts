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
  const { hybridAgentSettings, config } = await import("./config.js");
  const originalKey = process.env.NINE_ROUTER_API_KEY;
  const originalRouterKey = hybridAgentSettings.nineRouter.apiKey;
  const originalMuseKey = config.museApiKey;
  try {
    delete process.env.NINE_ROUTER_API_KEY;
    hybridAgentSettings.nineRouter.apiKey = "";
    (config as any).museApiKey = "";
    const { generateCodexImage } = await import("./codex-image.js");
    const res = await generateCodexImage("test prompt");
    assert.equal(typeof res.success, "boolean");
    assert.equal(typeof res.filePath, "string");
    assert.equal(res.success, false);
  } finally {
    if (originalKey) process.env.NINE_ROUTER_API_KEY = originalKey;
    hybridAgentSettings.nineRouter.apiKey = originalRouterKey;
    (config as any).museApiKey = originalMuseKey;
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

  // 1. Nhắc đích danh "muse" trong prompt -> Phải chọn Muse
  assert.equal(
    resolveImageModelPreference("Vẽ cho anh bức tranh phong cảnh bằng muse nhé"),
    "muse",
  );
  assert.equal(
    resolveImageModelPreference("Dùng muse2api sửa lại ảnh này cho ngầu hơn"),
    "muse",
  );
  assert.equal(
    resolveImageModelPreference("Tạo ảnh cô gái mùa đông bằng muse", "auto"),
    "muse",
  );

  // 2. Có cả "màu nước" và "codex" -> Explicit engine "codex" phải THẮNG "màu nước"
  assert.equal(
    resolveImageModelPreference("Vẽ cho tôi ảnh thiếu nữ mặc áo dài hoa sen màu nước bằng codex"),
    "codex",
  );

  // 3. Có cả "tả thực 8k" và "gemini" -> Explicit engine "gemini" phải THẮNG "tả thực"
  assert.equal(
    resolveImageModelPreference("Vẽ siêu xe Lamborghini tả thực 8k bằng gemini"),
    "gemini",
  );

  // 4. Chỉ có phong cách màu nước / vẽ tay (không nhắc engine) -> Ưu tiên Gemini (~15s)
  assert.equal(
    resolveImageModelPreference("Vẽ một góc phố cổ Hà Nội phong cách tranh màu nước nghệ thuật"),
    "gemini",
  );
  assert.equal(
    resolveImageModelPreference("Vẽ chân dung hoa hồng handraw vẽ tay"),
    "gemini",
  );

  // 5. Chỉ có phong cách tả thực / 8K (không nhắc engine) -> Ưu tiên Codex
  assert.equal(
    resolveImageModelPreference("Vẽ chân dung cô gái Việt Nam chụp thật siêu nét 8k"),
    "codex",
  );

  // 6. Không có từ khóa phong cách lẫn engine -> Mặc định Codex
  assert.equal(
    resolveImageModelPreference("Vẽ chú mèo con dễ thương đang ngủ"),
    "codex",
  );

  // 7. Model chỉ định qua options/tool calling
  assert.equal(
    resolveImageModelPreference("Vẽ hoa sen", "muse"),
    "muse",
  );
  assert.equal(
    resolveImageModelPreference("Vẽ hoa sen màu nước", "codex"),
    "codex",
  );
  assert.equal(
    resolveImageModelPreference("Vẽ con mèo", "gemini"),
    "gemini",
  );
});

test("normalizeImageModelId chuẩn hóa chính xác alias sang model ID 9Router và Muse", async () => {
  const { normalizeImageModelId } = await import("./codex-image.js");
  const { config } = await import("./config.js");
  const expectedCodex = config.codexImageModel || "cx/gpt-image-2.5";

  // 1. Alias "codex" phải map sang ID có prefix "cx/"
  const codexRes = normalizeImageModelId("codex");
  assert.equal(codexRes.codexModel, expectedCodex);
  assert.equal(codexRes.geminiModel, "ag/gemini-3.1-flash-image");
  assert.equal(codexRes.museModel, "muse-image");

  // 2. Alias "gemini" phải map sang ID có prefix "ag/"
  const geminiRes = normalizeImageModelId("gemini");
  assert.equal(geminiRes.geminiModel, "ag/gemini-3.1-flash-image");
  assert.equal(geminiRes.codexModel, expectedCodex);

  // 3. Alias "muse"
  const museRes = normalizeImageModelId("muse");
  assert.equal(museRes.museModel, "muse-image");

  // 3. Alias "auto" hoặc undefined
  const autoRes = normalizeImageModelId("auto");
  assert.equal(autoRes.codexModel, expectedCodex);

  const emptyRes = normalizeImageModelId(undefined);
  assert.equal(emptyRes.codexModel, expectedCodex);
  assert.equal(emptyRes.geminiModel, "ag/gemini-3.1-flash-image");

  // 4. Model ID cụ thể có prefix giữ nguyên
  const customCx = normalizeImageModelId("cx/custom-image-model");
  assert.equal(customCx.codexModel, "cx/custom-image-model");

  const customAg = normalizeImageModelId("ag/gemini-3.8-flash-image");
  assert.equal(customAg.geminiModel, "ag/gemini-3.8-flash-image");
});



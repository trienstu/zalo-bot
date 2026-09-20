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

import test from "node:test";
import assert from "node:assert/strict";
import { isJxlBuffer, transcodeImageWithFfmpeg } from "./image-utils.js";

test("isJxlBuffer: nhận diện đúng JXL naked codestream và ISO box container", () => {
  // Naked codestream
  const naked = Buffer.from([0xff, 0x0a, 0x01, 0x02]);
  assert.equal(isJxlBuffer(naked), true);

  // ISO container
  const box = Buffer.from([
    0x00, 0x00, 0x00, 0x0c,
    0x4a, 0x58, 0x4c, 0x20, // 'JXL '
    0x0d, 0x0a, 0x87, 0x0a,
    0x00, 0x01,
  ]);
  assert.equal(isJxlBuffer(box), true);

  // Các định dạng khác: không phải JXL
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(isJxlBuffer(png), false);

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(isJxlBuffer(jpeg), false);

  assert.equal(isJxlBuffer(Buffer.alloc(0)), false);
});

test("transcodeImageWithFfmpeg: chuyển đổi ảnh hợp lệ sang jpeg", async () => {
  // 1x1 transparent PNG buffer
  const samplePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const result = await transcodeImageWithFfmpeg(samplePng, "jpeg");
  assert.ok(result.buffer.length > 0);
  assert.equal(result.mimeType, "image/jpeg");
  // JPEG magic bytes: 0xFF 0xD8 0xFF
  assert.equal(result.buffer[0], 0xff);
  assert.equal(result.buffer[1], 0xd8);
  assert.equal(result.buffer[2], 0xff);
});


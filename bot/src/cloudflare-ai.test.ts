import test from "node:test";
import assert from "node:assert/strict";
import { extractImagePromptFromText } from "./member-assistant.js";
import { isCloudflareConfigured } from "./cloudflare-ai.js";

test("extractImagePromptFromText nhận diện cú pháp lệnh chuẩn xác", () => {
  assert.equal(
    extractImagePromptFromText("/taoanh chú mèo phi hành gia trong vũ trụ"),
    "chú mèo phi hành gia trong vũ trụ"
  );
  assert.equal(
    extractImagePromptFromText("!veanh siêu xe Ferrari màu đỏ bóng loáng"),
    "siêu xe Ferrari màu đỏ bóng loáng"
  );
  assert.equal(
    extractImagePromptFromText("/draw: cyberpunk city at night with neon lights"),
    "cyberpunk city at night with neon lights"
  );
});

test("extractImagePromptFromText nhận diện ngôn ngữ tự nhiên yêu cầu tạo ảnh", () => {
  assert.equal(
    extractImagePromptFromText("tạo cho tôi bức ảnh hoàng hôn trên biển Đà Nẵng"),
    "hoàng hôn trên biển Đà Nẵng"
  );
  assert.equal(
    extractImagePromptFromText("hãy tạo giúp mình một tấm hình chú cún pug đội mũ bảo hiểm"),
    "chú cún pug đội mũ bảo hiểm"
  );
  assert.equal(
    extractImagePromptFromText("nhờ bot vẽ giúp anh một bức tranh phong cảnh mùa thu Hà Nội"),
    "phong cảnh mùa thu Hà Nội"
  );
  assert.equal(
    extractImagePromptFromText("vẽ cho em một con rồng vàng uốn lượn phong cách 3D", "Bot"),
    "rồng vàng uốn lượn phong cách 3D"
  );
});

test("extractImagePromptFromText KHÔNG bắt nhầm các yêu cầu tạo văn bản / file docx / câu hỏi thường", () => {
  // Không được bắt nhầm file word/excel/pdf
  assert.equal(extractImagePromptFromText("tạo cho tôi file word kế hoạch kinh doanh"), null);
  assert.equal(extractImagePromptFromText("tạo báo cáo doanh thu tuần này giúp tôi"), null);
  assert.equal(extractImagePromptFromText("hôm nay thời tiết Hà Nội thế nào"), null);
  assert.equal(extractImagePromptFromText("tóm tắt tin tức giúp tôi"), null);
});

test("parseImagePromptAndRatio bóc tách sạch sẽ prompt và tỉ lệ 16:9, 9:16, 4:3, 1:1", async () => {
  const { parseImagePromptAndRatio } = await import("./member-assistant.js");

  const r1 = parseImagePromptAndRatio("tạo ảnh 2 người đang ngồi trong quán cafe, tỉ lệ ảnh 9:16 sen chúa");
  assert.equal(r1?.prompt, "2 người đang ngồi trong quán cafe");
  assert.equal(r1?.aspectRatio, "9:16");

  const r2 = parseImagePromptAndRatio("tạo ảnh 2 người đang ngồi trong quán cafe, tỉ lệ ảnh 16:9 sen chúa");
  assert.equal(r2?.prompt, "2 người đang ngồi trong quán cafe");
  assert.equal(r2?.aspectRatio, "16:9");

  const r3 = parseImagePromptAndRatio("vẽ chú mèo phi hành gia khổ dọc");
  assert.equal(r3?.prompt, "chú mèo phi hành gia");
  assert.equal(r3?.aspectRatio, "9:16");

  const r4 = parseImagePromptAndRatio("vẽ siêu xe Ferrari tỉ lệ 4:3");
  assert.equal(r4?.prompt, "siêu xe Ferrari");
  assert.equal(r4?.aspectRatio, "4:3");

  const r5 = parseImagePromptAndRatio("tạo ảnh 2 người đang ngồi trong quán cafe sen chúa");
  assert.equal(r5?.prompt, "2 người đang ngồi trong quán cafe");
  assert.equal(r5?.aspectRatio, "1:1");
});

test("isCloudflareConfigured hoạt động không crash", () => {
  const configured = isCloudflareConfigured();
  assert.equal(typeof configured, "boolean");
});

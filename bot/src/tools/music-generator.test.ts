import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIsMusicRequest, generateMusic, isMusicConfigured } from "./music-generator.js";
import { extractSimulatedGenerateMusic } from "./simulated-tool-interceptor.js";

test("checkIsMusicRequest nhận diện chính xác các yêu cầu tạo/sáng tác nhạc", () => {
  // Lệnh slash / bang
  assert.equal(checkIsMusicRequest("/suno Bài hát rap sinh nhật vui nhộn"), true);
  assert.equal(checkIsMusicRequest("!suno Ca khúc ballad"), true);
  assert.equal(checkIsMusicRequest("/music chill lofi"), true);
  assert.equal(checkIsMusicRequest("/nhac bolero trữ tình"), true);

  // Câu hỏi tự nhiên
  assert.equal(checkIsMusicRequest("Sen Chúa sáng tác giúp một bài hát tặng mẹ"), true);
  assert.equal(checkIsMusicRequest("Làm một bài nhạc chúc mừng sinh nhật anh Tuấn"), true);
  assert.equal(checkIsMusicRequest("Tạo bài hát rap phong cách sôi động"), true);
  assert.equal(checkIsMusicRequest("Viết ca khúc acoustic về mùa thu"), true);
  assert.equal(checkIsMusicRequest("Phối bài nhạc lofi thư giãn"), true);

  // Không phải yêu cầu tạo nhạc
  assert.equal(checkIsMusicRequest("Thời tiết Hà Nội hôm nay thế nào?"), false);
  assert.equal(checkIsMusicRequest("Cho xin danh sách link tài liệu"), false);
  assert.equal(checkIsMusicRequest("Giá bitcoin hôm nay"), false);
});

test("extractSimulatedGenerateMusic trích xuất chính xác cú pháp tag và hàm", () => {
  // Cú pháp tag với attributes
  const tagText = `Dưới đây là bài hát của bạn: [generate_music prompt="Bài hát rap sinh nhật" style="rap, upbeat" title="Sinh Nhật Vui Vẻ" instrumental=false /] Chúc bạn vui!`;
  const tagRes = extractSimulatedGenerateMusic(tagText);
  assert.ok(tagRes);
  assert.equal(tagRes.toolName, "generate_music");
  assert.equal(tagRes.args.prompt, "Bài hát rap sinh nhật");
  assert.equal(tagRes.args.style, "rap, upbeat");
  assert.equal(tagRes.args.title, "Sinh Nhật Vui Vẻ");
  assert.equal(tagRes.args.instrumental, false);

  // Cú pháp có lyrics
  const lyricsText = `<generate_music prompt="Ballad mùa thu" lyrics="[Verse 1] Mưa rơi tí tách qua hiên nhà..." style="ballad, acoustic" />`;
  const lyricsRes = extractSimulatedGenerateMusic(lyricsText);
  assert.ok(lyricsRes);
  assert.equal(lyricsRes.args.prompt, "Ballad mùa thu");
  assert.equal(lyricsRes.args.lyrics, "[Verse 1] Mưa rơi tí tách qua hiên nhà...");
  assert.equal(lyricsRes.args.style, "ballad, acoustic");

  // Text thông thường không có simulated tool
  assert.equal(extractSimulatedGenerateMusic("Không có lệnh nào ở đây"), null);
});

test("generateMusic trả lời hướng dẫn rõ ràng khi chưa có SUNO_COOKIE hoặc SUNO_API_URL", async () => {
  // Tạm lưu env cũ
  const oldCookie = process.env.SUNO_COOKIE;
  const oldUrl = process.env.SUNO_API_URL;
  delete process.env.SUNO_COOKIE;
  delete process.env.SUNO_API_URL;

  try {
    const res = await generateMusic({ prompt: "Bài hát test" });
    assert.equal(res.success, false);
    assert.ok(res.message?.includes("SUNO_COOKIE"));
  } finally {
    if (oldCookie) process.env.SUNO_COOKIE = oldCookie;
    if (oldUrl) process.env.SUNO_API_URL = oldUrl;
  }
});

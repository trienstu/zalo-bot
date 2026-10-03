import test from "node:test";
import assert from "node:assert/strict";
import {
  isYouTubeUrl,
  extractYouTubeVideoId,
  extractFirstYouTubeUrl,
} from "./tools/vertical-tools.js";
import {
  getPromptModuleYouTubeAnalysis,
  buildDynamicSystemPromptModules,
} from "./prompt-modules.js";

test("isYouTubeUrl nhận diện chính xác các định dạng URL YouTube", () => {
  // 1. Dạng chuẩn youtube.com/watch?v=
  assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=5qgI_wcBeZI"), true);
  assert.equal(isYouTubeUrl("http://youtube.com/watch?v=5qgI_wcBeZI&feature=share"), true);

  // 2. Dạng rút gọn youtu.be
  assert.equal(isYouTubeUrl("https://youtu.be/5qgI_wcBeZI"), true);
  assert.equal(isYouTubeUrl("https://youtu.be/5qgI_wcBeZI?si=12345"), true);

  // 3. Dạng YouTube Shorts
  assert.equal(isYouTubeUrl("https://www.youtube.com/shorts/5qgI_wcBeZI"), true);

  // 4. Dạng m.youtube.com hoặc embed
  assert.equal(isYouTubeUrl("https://m.youtube.com/watch?v=5qgI_wcBeZI"), true);
  assert.equal(isYouTubeUrl("https://www.youtube.com/embed/5qgI_wcBeZI"), true);

  // 5. Không phải YouTube
  assert.equal(isYouTubeUrl("https://www.tiktok.com/@user/video/12345"), false);
  assert.equal(isYouTubeUrl("https://facebook.com/watch?v=12345"), false);
  assert.equal(isYouTubeUrl("https://vnexpress.net/thoi-su"), false);
  assert.equal(isYouTubeUrl(""), false);
});

test("extractYouTubeVideoId trích xuất đúng 11 ký tự Video ID", () => {
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/watch?v=5qgI_wcBeZI"), "5qgI_wcBeZI");
  assert.equal(extractYouTubeVideoId("https://youtu.be/5qgI_wcBeZI"), "5qgI_wcBeZI");
  assert.equal(extractYouTubeVideoId("https://www.youtube.com/shorts/5qgI_wcBeZI"), "5qgI_wcBeZI");
  assert.equal(extractYouTubeVideoId("https://youtu.be/5qgI_wcBeZI?t=30"), "5qgI_wcBeZI");
  assert.equal(extractYouTubeVideoId("https://vnexpress.net/thoi-su"), null);
});

test("extractFirstYouTubeUrl trích xuất URL YouTube từ tin nhắn của người dùng", () => {
  const msg1 = "Em ơi tóm tắt giúp anh video này https://youtu.be/5qgI_wcBeZI với nhé";
  assert.equal(extractFirstYouTubeUrl(msg1), "https://youtu.be/5qgI_wcBeZI");

  const msg2 = "Xem clip này nè: https://www.youtube.com/watch?v=5qgI_wcBeZI hay lắm";
  assert.equal(extractFirstYouTubeUrl(msg2), "https://www.youtube.com/watch?v=5qgI_wcBeZI");

  const msg3 = "Hôm nay trời đẹp quá, không có link nào cả";
  assert.equal(extractFirstYouTubeUrl(msg3), null);
});

test("Prompt module YouTube Analysis được kích hoạt khi câu hỏi liên quan đến YouTube", () => {
  const promptModule = getPromptModuleYouTubeAnalysis();
  assert.ok(promptModule.includes("youtube_transcript_lookup"));
  assert.ok(promptModule.includes("transcript/phụ đề"));

  // Kích hoạt khi có link YouTube
  const dynamicPrompt1 = buildDynamicSystemPromptModules({
    question: "Tóm tắt video https://youtu.be/5qgI_wcBeZI",
    botName: "Sen Chúa",
    isSuperAdmin: true,
  });
  assert.ok(dynamicPrompt1.includes("youtube_transcript_lookup"));

  // Kích hoạt khi hỏi tóm tắt video youtube
  const dynamicPrompt2 = buildDynamicSystemPromptModules({
    question: "Tóm tắt nội dung video youtube này cho anh",
    botName: "Sen Chúa",
    isSuperAdmin: false,
  });
  assert.ok(dynamicPrompt2.includes("youtube_transcript_lookup"));

  // Không kích hoạt khi chỉ hỏi bình thường
  const dynamicPrompt3 = buildDynamicSystemPromptModules({
    question: "Hôm nay thời tiết Hà Nội thế nào em?",
    botName: "Sen Chúa",
    isSuperAdmin: false,
  });
  assert.equal(dynamicPrompt3.includes("youtube_transcript_lookup"), false);
});

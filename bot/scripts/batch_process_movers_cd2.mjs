import fs from "node:fs";
import path from "node:path";
import { transcribeCloudflareAudio, isCloudflareConfigured } from "../dist/cloudflare-ai.js";
import { callGemini } from "../dist/gemini.js";

const BASE_AUDIO_DIR = "/tmp/movers_cd2/mp3";
const CACHE_FILE = "/tmp/movers_cd2/movers_cd2_transcripts.json";
const TOTAL_TRACKS = 35;

async function processSingleTrack(trackNum, cache) {
  const trackKey = `track_${String(trackNum).padStart(2, "0")}`;
  if (cache[trackKey] && cache[trackKey].dialogues && cache[trackKey].dialogues.length > 0) {
    console.log(`[Track ${trackNum}/${TOTAL_TRACKS}] Đã có trong cache: "${cache[trackKey].title}" -> bỏ qua.`);
    return cache[trackKey];
  }

  const mp3Path = path.join(BASE_AUDIO_DIR, `track_${String(trackNum).padStart(2, "0")}.mp3`);
  if (!fs.existsSync(mp3Path)) {
    console.warn(`[Track ${trackNum}/${TOTAL_TRACKS}] Không tìm thấy file: ${mp3Path}`);
    return null;
  }

  console.log(`\n[Track ${trackNum}/${TOTAL_TRACKS}] 🎧 Bắt đầu xử lý: ${path.basename(mp3Path)}...`);
  const mp3Buf = fs.readFileSync(mp3Path);

  // 1. Whisper transcription
  let whisperText = "";
  if (isCloudflareConfigured()) {
    try {
      console.log(`  🎙️ [Track ${trackNum}] Bóc băng qua Cloudflare Whisper...`);
      const wRes = await transcribeCloudflareAudio(mp3Buf);
      if (wRes?.success && wRes.text) {
        whisperText = wRes.text.trim();
        console.log(`  ✅ [Track ${trackNum}] Whisper hoàn tất (${whisperText.length} ký tự): "${whisperText.slice(0, 80)}..."`);
      }
    } catch (wErr) {
      console.warn(`  ⚠️ [Track ${trackNum}] Whisper lỗi:`, wErr);
    }
  }

  // 2. Gemini bilingual structuring
  let structured = null;
  const prompt =
    `Bạn là giáo viên chuyên ngữ tiếng Anh luyện thi chứng chỉ Cambridge Young Learners English (Movers A1 - Oxford University Press).\n` +
    `Dưới đây là thông tin bài nghe số ${trackNum} trích từ đĩa CD 2 của bộ sách "Get Ready for Movers":\n\n` +
    `TRANSCRIPT ÂM THANH:\n"""\n${whisperText || "Audio track " + trackNum}\n"""\n\n` +
    `Nhiệm vụ: Hãy phân tích đoạn nghe trên thành bảng hội thoại chuẩn mực, dịch nghĩa tiếng Việt sư phạm chuẩn xác từng câu, liệt kê từ vựng trọng tâm và hướng dẫn học sinh.\n` +
    `BẮT BUỘC trả về định dạng JSON thuần túy (KHÔNG dùng markdown backticks, KHÔNG dùng \`\`\`json) với cấu trúc:\n` +
    `{\n` +
    `  "trackNumber": ${trackNum},\n` +
    `  "title": "Tiêu đề bài nghe (ví dụ: Listening 1 - Track title / Movers Practice Test - Listening Part 1)",\n` +
    `  "topic": "Chủ đề bài học (ví dụ: Sports, Weather, At the Market, Daily Routine...)",\n` +
    `  "dialogues": [\n` +
    `    {"speaker": "Tên người nói (ví dụ: Narrator / Jack / Daisy / Teacher / Boy / Girl / Mum)", "en": "Câu thoại tiếng Anh đầy đủ", "vi": "Bản dịch tiếng Việt chuẩn nghĩa"}\n` +
    `  ],\n` +
    `  "vocabulary": ["Từ vựng hoặc cấu trúc 1", "Từ vựng 2", "Từ vựng 3"],\n` +
    `  "notes": "Ghi chú sư phạm ngắn gọn về điểm ngữ pháp, phát âm hoặc dạng bài thi Movers"\n` +
    `}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`  🤖 [Track ${trackNum}] Phân tích và dịch song ngữ qua Gemini (lần ${attempt})...`);
      const geminiRes = await callGemini(prompt, `Track ${trackNum}`, {
        model: "gemini-3.1-flash-lite-preview",
      });

      if (geminiRes) {
        const cleanJson = geminiRes.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        structured = JSON.parse(cleanJson);
        console.log(`  ✅ [Track ${trackNum}] Phân tích thành công: "${structured.title}" (${structured.dialogues?.length || 0} câu thoại)`);
        break;
      }
    } catch (gErr) {
      console.warn(`  ⚠️ [Track ${trackNum}] Gemini lần ${attempt} lỗi:`, String(gErr).slice(0, 150));
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }

  if (!structured) {
    structured = {
      trackNumber: trackNum,
      title: `Listening ${trackNum}`,
      topic: "General Listening Practice",
      dialogues: [
        {
          speaker: "Audio",
          en: whisperText || `Audio track ${trackNum}`,
          vi: "Nội dung bài nghe track " + trackNum,
        },
      ],
      vocabulary: [],
      notes: "Luyện nghe bài tập Get Ready for Movers - CD 2.",
    };
  }

  cache[trackKey] = structured;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  return structured;
}

async function main() {
  console.log("=== BẮT ĐẦU XỬ LÝ TRỌN BỘ 35 TRACKS GET READY FOR MOVERS CD 2 ===");

  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      console.log(`Đã load cache: ${Object.keys(cache).length} tracks đã có.`);
    } catch {}
  }

  const trackNumbers = [];
  for (let i = 1; i <= TOTAL_TRACKS; i++) {
    trackNumbers.push(i);
  }

  // Chạy song song 2 worker để tối ưu tốc độ và an toàn rate-limit
  const CONCURRENCY = 2;
  const queue = [...trackNumbers];

  async function worker(workerId) {
    while (queue.length > 0) {
      const trackNum = queue.shift();
      try {
        await processSingleTrack(trackNum, cache);
      } catch (err) {
        console.error(`[Worker ${workerId}] Lỗi track ${trackNum}:`, err);
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  console.log(`Khởi chạy ${CONCURRENCY} workers xử lý ${trackNumbers.length} tracks...`);
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  console.log("\n==================================================");
  console.log(`✅ HOÀN TẤT XỬ LÝ TẤT CẢ ${Object.keys(cache).length}/${TOTAL_TRACKS} TRACKS CHO CD 2!`);
  console.log(`File cache lưu tại: ${CACHE_FILE}`);
  console.log("==================================================");
}

main().catch(console.error);

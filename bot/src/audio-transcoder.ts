import { isCloudflareConfigured, transcribeCloudflareAudio } from "./cloudflare-ai.js";
import { callGemini, type GeminiMediaPart } from "./gemini.js";
import {
  SUPPORTED_AUDIO_EXTENSIONS,
  isAudioExtension,
  detectAudioMimeType,
  transcodeAudioWithFfmpeg,
} from "./audio-utils.js";

// Re-export audio utilities for backward compatibility
export {
  SUPPORTED_AUDIO_EXTENSIONS,
  isAudioExtension,
  detectAudioMimeType,
  transcodeAudioWithFfmpeg,
};

/**
 * Bóc băng âm thanh đa tầng (Speech-to-Text):
 *  1. Cloudflare Whisper (siêu tốc, độ trễ thấp)
 *  2. Gemini Multimodal Audio (mô hình lớn, hiểu ngữ cảnh phức tạp)
 */
export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  mimeType = "audio/mp3",
  fileName = "audio",
): Promise<string> {
  let targetBuffer = audioBuffer;
  let targetMime = mimeType;

  // Nếu là WMA, AMR hoặc định dạng lạ, convert sang MP3/WAV trước khi gửi cho Whisper/Gemini
  if (targetMime.includes("wma") || targetMime.includes("amr") || targetMime.includes("octet-stream")) {
    try {
      console.log(`[audio-transcoder] 🔄 Đang convert ${targetMime} sang MP3 bằng ffmpeg...`);
      const converted = await transcodeAudioWithFfmpeg(audioBuffer, "mp3");
      targetBuffer = converted.buffer;
      targetMime = converted.mimeType;
      console.log(`[audio-transcoder] ✅ Đã convert thành công sang ${targetMime} (${targetBuffer.length} bytes)`);
    } catch (convErr) {
      console.warn("[audio-transcoder] Lỗi convert ffmpeg:", convErr);
    }
  }

  // Tier 1: Cloudflare Whisper
  if (isCloudflareConfigured()) {
    try {
      console.log(`[audio-transcoder] 🎙️ Thử bóc băng qua Cloudflare Whisper (${targetBuffer.length} bytes)...`);
      const whisperRes = await transcribeCloudflareAudio(targetBuffer);
      if (whisperRes?.success && whisperRes.text && whisperRes.text.trim().length > 0) {
        console.log(`[audio-transcoder] ✅ Whisper bóc băng thành công (${whisperRes.text.length} ký tự)`);
        return whisperRes.text.trim();
      }
    } catch (wErr) {
      console.warn("[audio-transcoder] Whisper thất bại, chuyển fallback Gemini:", wErr);
    }
  }

  // Tier 2: Gemini Audio Multimodal
  try {
    console.log(`[audio-transcoder] 🎙️ Đang bóc băng qua Gemini Multimodal Audio...`);
    const prompt =
      `Bạn là chuyên gia bóc băng âm thanh (Speech-to-Text) chuẩn xác từng từ.\n` +
      `Nhiệm vụ: Hãy nghe kỹ file âm thanh đính kèm và chép lại toàn bộ lời nói/nội dung trong file âm thanh này thành văn bản tiếng Việt/tiếng gốc một cách rõ ràng, có ngắt câu chấm phẩy đúng chuẩn ngữ pháp.\n\n` +
      `QUY TẮC BẮT BUỘC:\n` +
      `1. Chỉ trả về NỘI DUNG VĂN BẢN ĐÃ BÓC BĂNG.\n` +
      `2. TUYỆT ĐỐI KHÔNG thêm lời chào (Dạ Sếp, Chào bạn), KHÔNG giải thích, KHÔNG thêm cảm nghĩ cá nhân.\n` +
      `3. Nếu trong file có nhiều người nói hoặc có tạp âm, hãy chép rõ lời của từng người theo từng đoạn.`;

    const mediaPart: GeminiMediaPart = {
      data: targetBuffer.toString("base64"),
      mimeType: targetMime.startsWith("audio/") ? targetMime : "audio/mp3",
    };

    const reply = await callGemini(prompt, `Hãy bóc băng nội dung file âm thanh [${fileName}].`, {
      model: "gemini-3-flash-preview",
      mediaParts: [mediaPart],
    });

    const cleaned = (reply || "").trim();
    if (cleaned.length > 0) {
      console.log(`[audio-transcoder] ✅ Gemini Audio bóc băng thành công (${cleaned.length} ký tự)`);
      return cleaned;
    }
  } catch (gErr) {
    console.error("[audio-transcoder] ❌ Gemini Audio bóc băng thất bại:", gErr);
  }

  return "";
}

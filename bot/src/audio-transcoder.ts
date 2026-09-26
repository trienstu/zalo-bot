import { spawn } from "node:child_process";
import { isCloudflareConfigured, transcribeCloudflareAudio } from "./cloudflare-ai.js";
import { callGemini, type GeminiMediaPart } from "./gemini.js";

export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wma",
  "flac",
  "amr",
  "aiff",
  "m4r",
  "mpga",
]);

/**
 * Kiểm tra xem phần mở rộng file có phải là file âm thanh hay không.
 */
export function isAudioExtension(ext: string): boolean {
  if (!ext) return false;
  return SUPPORTED_AUDIO_EXTENSIONS.has(ext.toLowerCase().trim().replace(/^\./, ""));
}

/**
 * Nhận diện MIME type của file âm thanh từ buffer hoặc tên file.
 */
export function detectAudioMimeType(buffer: Buffer, fileNameOrUrl = ""): string | null {
  if (buffer && buffer.length >= 4) {
    // ASF / WMA header: 30 26 B2 75
    if (
      buffer.length >= 16 &&
      buffer[0] === 0x30 &&
      buffer[1] === 0x26 &&
      buffer[2] === 0xb2 &&
      buffer[3] === 0x75
    ) {
      return "audio/x-ms-wma";
    }

    // FLAC header: 66 4C 61 43 (fLaC)
    if (
      buffer[0] === 0x66 &&
      buffer[1] === 0x4c &&
      buffer[2] === 0x61 &&
      buffer[3] === 0x43
    ) {
      return "audio/flac";
    }

    // OGG header: 4F 67 67 53 (OggS)
    if (
      buffer[0] === 0x4f &&
      buffer[1] === 0x67 &&
      buffer[2] === 0x67 &&
      buffer[3] === 0x53
    ) {
      return "audio/ogg";
    }

    // AMR header: 23 21 41 4D 52 (#!AMR)
    if (
      buffer.length >= 5 &&
      buffer[0] === 0x23 &&
      buffer[1] === 0x21 &&
      buffer[2] === 0x41 &&
      buffer[3] === 0x4d &&
      buffer[4] === 0x52
    ) {
      return "audio/amr";
    }

    // WAV header: RIFF .... WAVE
    if (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WAVE"
    ) {
      return "audio/wav";
    }

    // MP3 ID3 header: 49 44 33 (ID3)
    if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      return "audio/mp3";
    }

    // MP3 frame sync: 0xFF 0xFB, 0xFF 0xF3, 0xFF 0xF2
    if (buffer.length >= 2 && buffer[0] === 0xff && typeof buffer[1] === "number" && (buffer[1] & 0xe0) === 0xe0) {
      return "audio/mp3";
    }
  }

  const cleanName = fileNameOrUrl.split("?")[0] || "";
  const ext = (cleanName.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "wma":
      return "audio/x-ms-wma";
    case "flac":
      return "audio/flac";
    case "ogg":
    case "opus":
      return "audio/ogg";
    case "amr":
      return "audio/amr";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "aiff":
      return "audio/aiff";
    case "mp3":
    case "mpga":
      return "audio/mp3";
    default:
      return null;
  }
}

/**
 * Chuyển đổi định dạng âm thanh bất kỳ sang chuẩn MP3 hoặc WAV (16kHz) bằng ffmpeg.
 */
export async function transcodeAudioWithFfmpeg(
  inputBuffer: Buffer,
  targetFormat: "mp3" | "wav" = "mp3",
  timeoutMs = 45_000,
): Promise<{ buffer: Buffer; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const isWav = targetFormat === "wav";
    const args = isWav
      ? ["-i", "pipe:0", "-f", "wav", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "pipe:1"]
      : ["-i", "pipe:0", "-f", "mp3", "-acodec", "libmp3lame", "-b:a", "128k", "-ar", "44100", "pipe:1"];

    const ffmpegProcess = spawn("ffmpeg", args);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      try {
        ffmpegProcess.kill("SIGKILL");
      } catch {}
      reject(new Error(`ffmpeg transcode timeout sau ${timeoutMs}ms`));
    }, timeoutMs);

    ffmpegProcess.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    ffmpegProcess.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    ffmpegProcess.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ffmpegProcess.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        const outBuffer = Buffer.concat(stdoutChunks);
        if (outBuffer.length > 0) {
          resolve({
            buffer: outBuffer,
            mimeType: isWav ? "audio/wav" : "audio/mp3",
          });
          return;
        }
      }
      const errLog = Buffer.concat(stderrChunks).toString("utf-8").slice(-400);
      reject(new Error(`ffmpeg kết thúc với mã lỗi ${code}: ${errLog}`));
    });

    try {
      ffmpegProcess.stdin.write(inputBuffer);
      ffmpegProcess.stdin.end();
    } catch (writeErr) {
      clearTimeout(timer);
      reject(writeErr);
    }
  });
}

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

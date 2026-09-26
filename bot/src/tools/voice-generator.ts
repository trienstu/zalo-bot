import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { EdgeTTS } from "node-edge-tts";
import { config } from "../config.js";

const execPromise = promisify(exec);

const VOICE_CACHE_DIR = path.resolve(process.cwd(), "data", "voice-cache");

export interface VoiceResult {
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;
  provider?: "aistudio" | "google" | "edge";
  durationSec?: number;
  caption?: string;
  message?: string;
}

export interface SpeakerConfig {
  speaker: string;
  voice: string;
}

export interface SynthesizeOptions {
  text: string;
  voice?: string;
  speakers?: SpeakerConfig[];
  caption?: string;
  rate?: string;
  pitch?: string;
  stylePrompt?: string;
  style?: string;
}

function ensureVoiceDir(): string {
  if (!fs.existsSync(VOICE_CACHE_DIR)) {
    fs.mkdirSync(VOICE_CACHE_DIR, { recursive: true });
  }
  return VOICE_CACHE_DIR;
}

/**
 * Đọc thông tin Google Cloud Service Account từ file hoặc cấu hình env
 */
function getGoogleCredentials(): { client_email: string; private_key: string } | null {
  try {
    if (config.vertexServiceAccountJson) {
      return JSON.parse(config.vertexServiceAccountJson);
    }
    const candidates = [
      config.vertexCredentialsPath,
      process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
      path.resolve(process.cwd(), "google-credentials.json"),
      path.resolve(process.cwd(), "bot", "google-credentials.json"),
      path.resolve(process.cwd(), "..", "google-credentials.json"),
    ].filter(Boolean);

    for (const c of candidates) {
      const full = path.isAbsolute(c) ? c : path.resolve(process.cwd(), c);
      if (fs.existsSync(full)) {
        return JSON.parse(fs.readFileSync(full, "utf8"));
      }
    }
  } catch (err) {
    console.warn("[voice-generator] Lỗi đọc google-credentials.json:", err);
  }
  return null;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * Tự động tạo và lưu bộ đệm JWT OAuth2 token cho Google Cloud Text-to-Speech
 */
async function getGoogleOAuthToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 300) {
    return cachedAccessToken.token;
  }

  const creds = getGoogleCredentials();
  if (!creds || !creds.client_email || !creds.private_key) {
    return null;
  }

  try {
    const header = { alg: "RS256", typ: "JWT" };
    const claim = {
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };
    const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const unsigned = `${b64(header)}.${b64(claim)}`;
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(unsigned);
    const signature = sign.sign(creds.private_key, "base64url");
    const jwt = `${unsigned}.${signature}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (data.access_token) {
      cachedAccessToken = {
        token: data.access_token,
        expiresAt: now + (data.expires_in || 3600),
      };
      return data.access_token;
    }
  } catch (err) {
    console.warn("[voice-generator] Lỗi lấy token Google OAuth:", err);
  }
  return null;
}

/**
 * Định danh giọng Google Cloud TTS:
 * Mặc định: Nữ Neural2 hiện đại (vi-VN-Neural2-A)
 * Nam: Nam Wavenet trầm ấm (vi-VN-Wavenet-B)
 */
export function resolveGoogleVoice(voiceHint?: string): string {
  if (!voiceHint) return config.googleTtsVoiceFemale || "vi-VN-Neural2-A";
  const hint = voiceHint.toLowerCase().trim();

  if (
    hint.includes("nam") ||
    hint.includes("male") ||
    hint.includes("dan") ||
    hint.includes("puck") ||
    hint.includes("fenrir") ||
    hint.includes("charon") ||
    hint.includes("wavenet-b") ||
    hint.includes("wavenet-d") ||
    hint.includes("namminh")
  ) {
    return config.googleTtsVoiceMale || "vi-VN-Wavenet-B";
  }
  if (
    hint.includes("nu") ||
    hint.includes("nữ") ||
    hint.includes("female") ||
    hint.includes("hoa") ||
    hint.includes("hoài") ||
    hint.includes("anh") ||
    hint.includes("aoede") ||
    hint.includes("kore") ||
    hint.includes("neural2-a") ||
    hint.includes("wavenet-a") ||
    hint.includes("wavenet-c") ||
    hint.includes("hoaimy")
  ) {
    return config.googleTtsVoiceFemale || "vi-VN-Neural2-A";
  }

  // Ánh xạ từ các mã giọng Edge cũ
  if (hint.includes("namminh")) return "vi-VN-Wavenet-B";
  if (hint.includes("hoaimy")) return "vi-VN-Neural2-A";

  if (hint.startsWith("vi-") || hint.startsWith("en-")) {
    return voiceHint;
  }

  return config.googleTtsVoiceFemale || "vi-VN-Neural2-A";
}

/**
 * Định danh giọng Edge-TTS (dự phòng)
 */
export function resolveEdgeVoice(voiceHint?: string): string {
  if (!voiceHint) return "vi-VN-HoaiMyNeural";
  const hint = voiceHint.toLowerCase().trim();

  if (
    hint.includes("nam") ||
    hint.includes("male") ||
    hint.includes("dan") ||
    hint.includes("puck") ||
    hint.includes("fenrir") ||
    hint.includes("charon") ||
    hint.includes("wavenet-b") ||
    hint.includes("wavenet-d") ||
    hint.includes("namminh")
  ) {
    return "vi-VN-NamMinhNeural";
  }
  if (
    hint.includes("nu") ||
    hint.includes("nữ") ||
    hint.includes("female") ||
    hint.includes("neural2-a") ||
    hint.includes("wavenet-a") ||
    hint.includes("wavenet-c") ||
    hint.includes("aoede") ||
    hint.includes("kore") ||
    hint.includes("hoaimy")
  ) {
    return "vi-VN-HoaiMyNeural";
  }

  if (hint.startsWith("vi-") || hint.startsWith("en-") || hint.includes("neural")) {
    return voiceHint;
  }

  return "vi-VN-HoaiMyNeural";
}

/**
 * Tương thích ngược: resolveVoiceName mặc định theo Google Cloud
 */
export function resolveVoiceName(voiceHint?: string): string {
  return resolveGoogleVoice(voiceHint);
}

/**
 * Tự động làm sạch các file voice cũ hơn maxAgeMinutes để không chiếm ổ cứng
 */
export function cleanOldVoiceFiles(maxAgeMinutes = 60): void {
  try {
    if (!fs.existsSync(VOICE_CACHE_DIR)) return;
    const now = Date.now();
    const thresholdMs = maxAgeMinutes * 60 * 1000;
    const files = fs.readdirSync(VOICE_CACHE_DIR);

    for (const f of files) {
      const fullPath = path.join(VOICE_CACHE_DIR, f);
      try {
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > thresholdMs) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // Bỏ qua nếu file đang bận
      }
    }
  } catch (err) {
    console.warn("[voice-generator] Lỗi dọn dẹp file voice cũ:", err);
  }
}

/**
 * Chuyển đổi file audio sang chuẩn Zalo Voice Bubble (.m4a AAC 44.1kHz Mono 128kbps)
 * Chất lượng âm thanh cao cấp, sáng rõ, tương thích 100% với trình phát Zalo (chuẩn moov atom faststart).
 * Xử lý được cả file audio chuẩn (MP3, WAV, AAC) lẫn raw PCM 24kHz/48kHz từ Gemini TTS.
 */
async function convertToZaloVoiceBubble(inputPath: string, outputPath: string): Promise<void> {
  // 1. Thử convert tự động nhận diện container/codec
  try {
    const ffmpegCmd = `ffmpeg -y -v error -i "${inputPath}" -vn -map_metadata -1 -c:a aac -b:a 128k -ar 44100 -ac 1 -movflags +faststart "${outputPath}"`;
    await execPromise(ffmpegCmd);
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return;
  } catch {}

  // 2. Thử convert raw PCM 24kHz mono (chuẩn định dạng Gemini Flash TTS audio/L16)
  try {
    const pcm24Cmd = `ffmpeg -y -v error -f s16le -ar 24000 -ac 1 -i "${inputPath}" -vn -map_metadata -1 -c:a aac -b:a 128k -ar 44100 -ac 1 -movflags +faststart "${outputPath}"`;
    await execPromise(pcm24Cmd);
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return;
  } catch {}

  // 3. Thử convert raw PCM 48kHz mono
  try {
    const pcm48Cmd = `ffmpeg -y -v error -f s16le -ar 48000 -ac 1 -i "${inputPath}" -vn -map_metadata -1 -c:a aac -b:a 128k -ar 44100 -ac 1 -movflags +faststart "${outputPath}"`;
    await execPromise(pcm48Cmd);
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return;
  } catch {}

  // 4. Nếu thất bại, cảnh báo và TUYỆT ĐỐI KHÔNG copy file raw vào .m4a để tránh sinh file rỗng 00:00 trên Zalo
  console.warn(`[voice-generator] Không thể encode file audio sang .m4a AAC chuẩn từ: ${inputPath}`);
}

/**
 * Sinh âm thanh qua Google Cloud Text-to-Speech
 */
async function synthesizeWithGoogleTTS(
  text: string,
  voiceName: string,
  outputPath: string,
  options?: { rate?: string; pitch?: string },
): Promise<boolean> {
  const token = await getGoogleOAuthToken();
  if (!token) return false;

  try {
    const langCode = voiceName.startsWith("en-") ? "en-US" : "vi-VN";
    const speakingRate = options?.rate && !isNaN(Number(options.rate)) ? Number(options.rate) : 1.0;
    const pitch = options?.pitch && !isNaN(Number(options.pitch)) ? Number(options.pitch) : 0.0;

    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: langCode, name: voiceName },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate,
          pitch,
          sampleRateHertz: 48000,
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[voice-generator] Google TTS trả về status ${res.status}:`, errBody);
      return false;
    }

    const data = (await res.json()) as { audioContent?: string };
    if (!data.audioContent) return false;

    fs.writeFileSync(outputPath, Buffer.from(data.audioContent, "base64"));
    return true;
  } catch (err) {
    console.warn("[voice-generator] Lỗi gọi Google TTS:", err);
    return false;
  }
}

/**
 * Sinh âm thanh qua Microsoft Edge-TTS (Dự phòng độ phân giải cao 160kbps)
 */
async function synthesizeWithEdgeTTS(
  text: string,
  voiceName: string,
  outputPath: string,
  options?: { rate?: string; pitch?: string },
): Promise<boolean> {
  try {
    const tts = new EdgeTTS({
      voice: voiceName,
      lang: voiceName.startsWith("en-") ? "en-US" : "vi-VN",
      outputFormat: "audio-24khz-160kbitrate-mono-mp3",
      rate: options?.rate || "default",
      pitch: options?.pitch || "default",
      timeout: 25000,
    });

    await tts.ttsPromise(text, outputPath);
    return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
  } catch (err) {
    console.warn("[voice-generator] Lỗi Edge-TTS:", err);
    return false;
  }
}

/**
 * Lọc sạch lời chào hỏi, thông báo hệ thống, lời dẫn chuyện bên ngoài và câu hỏi kết thúc của AI,
 * CHỈ GIỮ LẠI NỘI DUNG CỐT LÕI CẦN PHÁT ÂM (Tiêu đề, Tác giả/Nguồn nếu có, và toàn bộ nội dung tác phẩm/bài viết/bản tin/kịch bản thoại).
 * Áp dụng chuẩn mực cho TẤT CẢ các lĩnh vực (thơ ca, văn học, tin tức, pháp luật, tài chính, podcast đối thoại, thông báo, thuyết minh).
 */
export function cleanCoreSpeechText(rawText: string): string {
  if (!rawText) return "";
  const text = rawText.trim();

  // 1. Phân tách thành các đoạn (paragraphs)
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "";

  const isIntroParagraphOrLine = (line: string): boolean => {
    const l = line.replace(/^[*\s\-•–—>#]+/, "").replace(/[*_#>`"“”«»]/g, "").trim();
    if (!l) return false;
    // Bắt đầu bằng @mention
    if (/^@\S+/i.test(l)) return true;
    // Tiêu đề / dẫn dắt thông báo kỹ thuật: "Về việc thu âm giọng đọc:", "Tiến độ xử lý:"
    if (/^(?:về\s*việc|thông\s*báo\s*(?:về)?|tiến\s*độ|trạng\s*thái)\s*.*?:?$/iu.test(l)) return true;
    // Lời chào / xưng hô ban đầu: "Dạ Sếp...", "Chào anh...", "Kính thưa...", "Vâng, em..."
    if (
      /^(?:dạ|vâng|chào|thưa|kính\s*thưa|hello|hi)(?:\s+|$|[.,:!?;])/iu.test(l) &&
      /(?:sếp|anh|chị|bác|bạn|thầy|cô|admin|mọi\s*người|cả\s*nhà|quý\s*vị)/iu.test(l)
    ) {
      return true;
    }
    if (/^(?:dạ|vâng|thưa\s+sếp|kính\s*thưa)[,!]?\s*$/iu.test(l)) return true;
    // Bot tự xưng nhận việc: "Em đã tiếp nhận yêu cầu...", "Em xin gửi...", "Tôi xin đọc..."
    if (
      /^(?:em|tôi|mình|bot|sen\s*chúa|mộc\s*miên)\s+(?:đã\s+tiếp\s*nhận|xin\s+(?:phép\s+)?(?:gửi|tặng|đọc|trình\s*bày|chia\s*sẻ|thể\s*hiện|thu\s*âm)|rất\s+vui|vừa\s+nhận)/iu.test(
        l,
      )
    ) {
      return true;
    }
    if (/^(?:em|tôi|mình)\s+đã\s+(?:tiếp\s*nhận|ghi\s*nhận|nhận\s*lệnh)/iu.test(l)) return true;
    // Dẫn nhập chuyển tiếp: "Dưới đây là...", "Sau đây là...", "Trong lúc chờ đợi, em xin gửi...", "Em xin gửi trọn vẹn bài thơ:"
    if (
      /^(?:dưới\s*đây|sau\s*đây|đây)\s*là\s*(?:nội\s*dung|bài\s*thơ|kịch\s*bản|bản\s*tin|thông\s*tin|đoạn|văn\s*bản|lời\s*thoại|tổng\s*hợp|báo\s*cáo|chi\s*tiết)/iu.test(
        l,
      )
    ) {
      return true;
    }
    if (/^(?:.*?,\s*)?(?:em\s+)?(?:xin\s+)?(?:phép\s+)?(?:gửi|tặng|đọc|trình\s*bày|chia\s*sẻ)[^:\n]*:?$/iu.test(l)) return true;
    if (/^(?:dưới\s*đây|sau\s*đây)\s*là\s*[^:\n]*:?$/iu.test(l)) return true;
    // Thông báo kỹ thuật / tiến trình xử lý
    if (
      /(?:hệ\s*thống|worker|tiến\s*trình|nền)\s*(?:đang|đã|sẽ)\s*(?:tiến\s*hành|xử\s*lý|thu\s*âm|tạo|tổng\s*hợp|chuyển\s*đổi|chạy|gửi)/iu.test(
        l,
      )
    ) {
      return true;
    }
    if (
      /(?:file|bản)\s*(?:âm\s*thanh|voice|audio|ghi\s*âm|thu\s*âm|podcast)\s*(?:sẽ|đang|được)\s*(?:tự\s*động|gửi|xuất|hoàn\s*tất)/iu.test(
        l,
      )
    ) {
      return true;
    }
    if (
      /(?:google\s*ai\s*studio|gemini\s*tts|google\s*cloud|edge-tts|voice\s*bubble|bong\s*bóng\s*thoại)/iu.test(
        l,
      )
    ) {
      return true;
    }
    // Thông báo giới hạn kỹ thuật / hạn mức / quá tải / quyền hạn giả lập
    if (
      /(?:hạn\s*mức|ngưỡng\s*giới\s*hạn|giới\s*hạn\s*(?:tác\s*vụ|tạo|file|hệ\s*thống)|tác\s*vụ\s*\/\s*giờ|đạt\s*ngưỡng|làm\s*mới|hồi\s*lại\s*hạn\s*mức)/iu.test(l) ||
      /(?:tạm\s*đạt|đang\s*tạm|chờ\s*(?:hồi|làm\s*mới)|vượt\s*quá\s*hạn\s*mức|chỉ\s*hỗ\s*trợ\s*khi\s*có\s*lệnh|quyền\s*hệ\s*thống|tài\s*khoản\s*quản\s*trị|chủ\s*nhân)/iu.test(l) ||
      /(?:ngay\s*khi|lát\s*nữa|sau\s*đó|khi\s*nào).*?(?:em|tôi|bot)\s*(?:sẽ|tiến\s*hành)?\s*(?:thực\s*hiện|thu\s*âm|đọc|ngâm|tạo|gửi)/iu.test(l)
    ) {
      return true;
    }
    return false;
  };

  const isOutroParagraphOrLine = (line: string): boolean => {
    const l = line.replace(/[*_#>`"“”«»]/g, "").trim();
    if (!l) return false;
    // Câu chờ đợi / hứa hẹn file xuất hiện
    if (/(?:sếp|bác|anh|chị|bạn|admin)?(?:\s+[\p{L}\s\d]+)?\s*(?:chờ|đợi)\s*(?:em|tôi)\s*(?:một\s+chút|chút|giây\s*lát)/iu.test(l)) return true;
    if (
      /(?:file|bản\s*thu|voice|audio|podcast).*?(?:sẽ\s*có\s*mặt|sẽ\s*được\s*gửi|ngay\s*sau\s*đây|ngay\s*ạ|sớm\s*nhất)/iu.test(
        l,
      )
    ) {
      return true;
    }
    if (/(?:hệ\s*thống|worker)\s*(?:đang|sẽ)\s*(?:tiến\s*hành|xử\s*lý|gửi|tổng\s*hợp)/iu.test(l)) return true;
    // Câu hỏi gợi mở / tương tác xã giao ở cuối
    if (/(?:sếp|bác|anh|chị|bạn|admin)?(?:\s+[\p{L}\s\d]+)?\s*(?:có\s*muốn|cần|thấy|nghĩ|thích).*(?:\?|ạ!|ạ\?|nhé!|nhé\?)$/iu.test(l)) return true;
    if (
      /(?:có\s*muốn|cần)\s*(?:em|tôi|bot)?\s*(?:chuẩn\s*bị|đọc|ngâm|hát|làm|soạn|tìm|hỗ\s*trợ|thử\s*sức).*(?:\?|ạ!|ạ\?|nhé!|nhé\?)$/iu.test(
        l,
      )
    ) {
      return true;
    }
    if (/^(?:sếp|bác|anh|chị|bạn)\s*thấy\s*(?:thế\s*nào|sao|bản\s*đọc)/iu.test(l)) return true;
    if (/(?:để\s*em|cho\s*em)\s*["']?thử\s*sức["']?\s*tiếp\s*không\s*ạ/iu.test(l)) return true;
    // Trà nước, chờ đợi, phục vụ xã giao
    if (
      /(?:thong\s*thả|nhâm\s*nhi|uống)\s*(?:chén|tách|ly|dùng)?\s*trà/iu.test(l) ||
      /(?:luôn\s*túc\s*trực|sẵn\s*sàng\s*phục\s*vụ|hỗ\s*trợ\s*thêm\s*thông\s*tin\s*nào\s*khác\s*trong\s*lúc\s*chờ)/iu.test(l)
    ) {
      return true;
    }
    // Lời chúc / hy vọng
    if (/^chúc\s*(?:sếp|bác|anh|chị|bạn|mọi\s*người|cả\s*nhà)/iu.test(l)) return true;
    if (/^hy\s*vọng\s*(?:bản\s*đọc|bài\s*thơ|nội\s*dung|kịch\s*bản|bản\s*tin|thông\s*tin)/iu.test(l)) return true;
    // Lời mời gọi hỗ trợ tiếp
    if (/^(?:nếu\s*(?:sếp|bác|anh|chị|bạn)?\s*cần|cần\s+thêm)\s*.*?(?:cứ\s*bảo|cứ\s*nhắn|hãy\s*bảo)\s*(?:em|tôi)/iu.test(l)) {
      return true;
    }
    return false;
  };

  // 2. Lọc bỏ các đoạn intro từ trên xuống
  let startIndex = 0;
  while (startIndex < paragraphs.length) {
    const p = paragraphs[startIndex];
    if (!p) {
      startIndex++;
      continue;
    }
    const lines = p.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length > 0 && lines.every((l) => isIntroParagraphOrLine(l))) {
      startIndex++;
    } else {
      break;
    }
  }

  // 3. Lọc bỏ các đoạn outro từ dưới lên
  let endIndex = paragraphs.length - 1;
  while (endIndex >= startIndex) {
    const p = paragraphs[endIndex];
    if (!p) {
      endIndex--;
      continue;
    }
    const lines = p.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length > 0 && lines.every((l) => isOutroParagraphOrLine(l))) {
      endIndex--;
    } else {
      break;
    }
  }

  // Nếu toàn bộ văn bản đều là câu chào, hứa hẹn, hoặc giới hạn kỹ thuật -> Không có nội dung cốt lõi để đọc!
  if (startIndex > endIndex) {
    return "";
  }

  let remainingParagraphs = paragraphs.slice(startIndex, endIndex + 1);

  // 4. Kiểm tra dòng đầu của đoạn đầu tiên: nếu có dòng dẫn dắt bị gộp chung đoạn, loại bỏ dòng đó
  if (remainingParagraphs.length > 0 && remainingParagraphs[0]) {
    const firstP = remainingParagraphs[0];
    const lines = firstP.split("\n");
    let lineStart = 0;
    while (lineStart < lines.length && isIntroParagraphOrLine(lines[lineStart] || "")) {
      lineStart++;
    }
    if (lineStart > 0 && lineStart < lines.length) {
      remainingParagraphs[0] = lines.slice(lineStart).join("\n").trim();
    }
  }

  // 5. Loại bỏ triệt để các phần phân tích, bình luận, giải thích, chú thích, ý nghĩa hoặc đường kẻ phân cách ở phía dưới tác phẩm
  const isCommentaryOrDividerParagraph = (p: string): boolean => {
    const l = p.replace(/^[*\s\-•–—>#]+/, "").replace(/[*_#>`"“”«»]/g, "").trim();
    if (!l) return false;
    // Đường kẻ phân cách (ví dụ: ---, ***, ===)
    if (/^[-*_—=]{3,}$/.test(l)) return true;
    const firstLine = l.split("\n")[0]?.trim() || "";
    return (
      /^(?:phân\s*tích|bình\s*luận|cảm\s*nhận|đánh\s*giá|ý\s*nghĩa\s*(?:của|bài\s*thơ|tác\s*phẩm)?|hoàn\s*cảnh\s*sáng\s*tác|bối\s*cảnh\s*(?:lịch\s*sử|sáng\s*tác)?|đôi\s*nét\s*(?:về)?|về\s*(?:bài\s*thơ|tác\s*phẩm|tác\s*giả|tác\s*giả\s*và\s*tác\s*phẩm)|nghệ\s*thuật\s*(?:đặc\s*sắc)?|giá\s*trị\s*(?:nội\s*dung|nghệ\s*thuật)|nội\s*dung\s*chính|tìm\s*hiểu\s*thêm|giới\s*thiệu\s*(?:thêm|về)?|lưu\s*ý|ghi\s*chú|chú\s*thích|chú\s*giải|giải\s*nghĩa|từ\s*ngữ\s*khó|nguồn\s*tham\s*khảo|tham\s*khảo|tài\s*liệu\s*tham\s*khảo|analysis|commentary|meaning\s*of|background|historical\s*context|about\s*the\s*author|notes?|footnotes?|references?)\s*[:：\-–]?/iu.test(
        firstLine,
      ) ||
      /^(?:về\s*bài\s*thơ\s*này|về\s*tác\s*phẩm\s*này|đôi\s*nét\s*về\s*tác\s*giả|đôi\s*nét\s*về\s*bài\s*thơ)\s*[:：\-–]?/iu.test(firstLine)
    );
  };

  let commentaryCutoffIdx = -1;
  for (let i = 1; i < remainingParagraphs.length; i++) {
    if (isCommentaryOrDividerParagraph(remainingParagraphs[i] || "")) {
      commentaryCutoffIdx = i;
      break;
    }
  }
  if (commentaryCutoffIdx !== -1) {
    remainingParagraphs = remainingParagraphs.slice(0, commentaryCutoffIdx);
  }

  // 6. Kiểm tra dòng cuối của đoạn cuối cùng: nếu có dòng outro bị gộp chung đoạn, loại bỏ dòng đó
  if (remainingParagraphs.length > 0) {
    const lastIdx = remainingParagraphs.length - 1;
    const lastP = remainingParagraphs[lastIdx];
    if (lastP) {
      const lines = lastP.split("\n");
      let lineEnd = lines.length - 1;
      while (lineEnd >= 0 && (isOutroParagraphOrLine(lines[lineEnd] || "") || isCommentaryOrDividerParagraph(lines[lineEnd] || ""))) {
        lineEnd--;
      }
      if (lineEnd >= 0 && lineEnd < lines.length - 1) {
        remainingParagraphs[lastIdx] = lines.slice(0, lineEnd + 1).join("\n").trim();
      }
    }
  }

  const result = remainingParagraphs.filter(Boolean).join("\n\n").trim();

  // Phòng thủ an toàn: Nếu sau khi lọc mà độ dài còn lại quá ngắn (< 15 ký tự), coi như không có nội dung hợp lệ
  if (!result || result.length < 15) {
    return "";
  }

  return result;
}

/**
 * Làm sạch các câu hứa hẹn tiến trình / worker nền lỗi thời trong câu trả lời bằng chữ
 * sau khi file voice đã được thực sự tạo và gửi lên Zalo.
 */
export function cleanOutdatedVoicePromisesFromAnswer(answer: string): string {
  if (!answer) return "";
  let text = answer;
  text = text.replace(/\n*hệ\s*thống\s*(?:đang|sẽ)\s*(?:tiến\s*hành|xử\s*lý|tổng\s*hợp)[^\n]*/giu, "");
  text = text.replace(/\n*file\s*âm\s*thanh\s*sẽ\s*(?:được\s*gửi|tự\s*động\s*xuất\s*hiện|có\s*mặt)[^\n]*/giu, "");
  text = text.replace(/\n*(?:sếp|bác|anh|chị|bạn|admin)?(?:\s+[\p{L}\s\d]+)?\s*(?:chờ|đợi)\s*(?:em|tôi)\s*(?:một\s+chút|chút|giây\s*lát)[^\n]*/giu, "");
  text = text.replace(/\n*.*?(?:hạn\s*mức|ngưỡng\s*giới\s*hạn|tác\s*vụ\s*\/\s*giờ|đang\s*tạm\s*đạt|hồi\s*lại\s*hạn\s*mức)[^\n]*/giu, "");
  text = text.replace(/\n*.*?(?:thong\s*thả\s*dùng\s*trà|uống\s*(?:chén|tách)?\s*trà|lát\s*nữa\s*em\s*thu\s*âm)[^\n]*/giu, "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Làm sạch văn bản trước khi đưa vào Text-to-Speech:
 * - Loại bỏ định dạng markdown (tiêu đề #, in đậm **, in nghiêng *, trích dẫn >, gạch đầu dòng -)
 * - Loại bỏ các chỉ dẫn sân khấu / cảm xúc trong ngoặc đơn hoặc ngoặc vuông (VD: (cười), (hào hứng), [thì thầm])
 * - Giữ nguyên lời thoại và nội dung thuần túy để giọng đọc AI phát âm chuẩn xác, không đọc chữ rác
 */
export function cleanTextForTTS(rawText: string): string {
  if (!rawText) return "";
  return rawText
    // Loại bỏ code blocks ``` ... ```
    .replace(/```[\s\S]*?```/g, "")
    // Loại bỏ URLs https://... hoặc http://...
    .replace(/https?:\/\/\S+/gi, "")
    // Loại bỏ bullet points, headers, blockquotes ở đầu dòng
    .replace(/^(\s*[*#>-]+\s*)+/gm, "")
    // Loại bỏ in đậm / in nghiêng markdown: **text** hoặc *text* hoặc __text__ hoặc _text_
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // Loại bỏ chỉ dẫn cảm xúc / hành động sân khấu trong ngoặc đơn: (cười), (hào hứng), (thở dài), v.v.
    .replace(
      /\((?:cười|cười lớn|hào hứng|ngạc nhiên|vui vẻ|trầm ấm|trầm ngâm|thì thầm|hồi hộp|thở dài|vỗ tay|khóc|lo lắng|xúc động|tự tin|ngập ngừng|tức giận|hài hước|nghẹn ngào|ngơ ngác|tươi vui|nhí nhảnh|dõng dạc|nghiêm túc|cảm xúc)[^)]*\)/gi,
      "",
    )
    // Loại bỏ chỉ dẫn cảm xúc trong ngoặc vuông: [cười], [hào hứng], v.v.
    .replace(
      /\[(?:cười|cười lớn|hào hứng|ngạc nhiên|vui vẻ|trầm ấm|trầm ngâm|thì thầm|hồi hộp|thở dài|vỗ tay|khóc|lo lắng|xúc động|tự tin|ngập ngừng|tức giận|hài hước|nghẹn ngào|ngơ ngác|tươi vui|nhí nhảnh|dõng dạc|nghiêm túc|cảm xúc)[^\]]*\]/gi,
      "",
    )
    // Chuẩn hóa khoảng trắng trước dấu câu (ví dụ: "Nam :" -> "Nam:")
    .replace(/[ \t]+([,:?.!])/g, "$1")
    // Thu gọn khoảng trắng thừa
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

/**
 * Định danh giọng Google AI Studio (Gemini Native Audio):
 * Nữ: Aoede, Kore
 * Nam: Puck, Fenrir, Charon
 */
export function resolveAIStudioVoice(voiceHint?: string, styleHint?: string): string {
  const combined = `${voiceHint || ""} ${styleHint || ""}`.toLowerCase().trim();
  if (!combined) return "Aoede";

  if (combined.includes("trầm") || combined.includes("charon") || combined.includes("fenrir")) {
    return "Fenrir";
  }
  if (combined.includes("kore")) {
    return "Kore";
  }
  if (
    combined.includes("nam") ||
    combined.includes("male") ||
    combined.includes("dan") ||
    combined.includes("puck") ||
    combined.includes("wavenet-b") ||
    combined.includes("wavenet-d") ||
    combined.includes("namminh")
  ) {
    return "Puck";
  }
  return "Aoede";
}

/**
 * Sinh âm thanh qua Google AI Studio (Gemini Flash TTS)
 * Hỗ trợ diễn cảm, ngâm thơ, phong cách vùng miền (Huế, Nam, Bắc) và ngữ điệu tự nhiên.
 */
async function synthesizeWithGoogleAIStudio(
  text: string,
  outputPath: string,
  voiceHint?: string,
  options?: { rate?: string; pitch?: string; stylePrompt?: string },
): Promise<boolean> {
  const rawKey = (process.env.GEMINI_API_KEY || config.geminiApiKey || "").trim();
  const apiKeys = rawKey.split(",").map((k) => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) return false;

  const cleanInput = cleanTextForTTS(text);
  if (!cleanInput) return false;

  const voiceName = resolveAIStudioVoice(voiceHint, options?.stylePrompt);
  const models = ["gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];

  for (const apiKey of apiKeys) {
    for (const model of models) {
      try {
        // Tuyệt đối không dùng promptPrefix ("Read the following...") vì Gemini TTS coi text là transcript
        // nguyên văn, khiến giọng đọc phát âm cả câu lệnh tiếng Anh.
        // Với model 3.8, phong cách / style được đưa vào speech_metadata.style.
        const isGemini38 = model.includes("3.8");
        const payload = {
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: cleanInput,
                  ...(isGemini38 && options?.stylePrompt ? { speech_metadata: { style: options.stylePrompt } } : {}),
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
          },
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.warn(`[voice-generator] Google AI Studio TTS (${model}) HTTP ${res.status}:`, errText.slice(0, 150));
          continue;
        }

        const data = (await res.json()) as any;
        const part = data?.candidates?.[0]?.content?.parts?.[0];
        if (part?.inlineData?.data) {
          const buffer = Buffer.from(part.inlineData.data, "base64");
          if (buffer.length > 0) {
            fs.writeFileSync(outputPath, buffer);
            console.log(`[voice-generator] ✅ Sinh âm thanh thành công qua Google AI Studio (${model}, ${voiceName}, ${buffer.length} bytes)`);
            return true;
          }
        }
      } catch (err: any) {
        console.warn(`[voice-generator] Lỗi gọi Google AI Studio TTS (${model}):`, err?.message || err);
      }
    }
  }
  return false;
}

/**
 * Sinh âm thanh đối thoại đa nhân vật (Podcast / Dialogue) qua Google AI Studio Native Multi-Speaker TTS.
 * Sử dụng cấu hình multiSpeakerVoiceConfig trong 1 request duy nhất, đảm bảo tính liền mạch cảm xúc,
 * nhịp điệu tương tác tự nhiên và tạo trực tiếp file Zalo Voice Bubble (.m4a) chuẩn không cần ghép nối.
 */
async function synthesizeWithGoogleAIStudioMultiSpeaker(
  dialogueText: string,
  outputPath: string,
  speakers: { speaker: string; voiceName: string }[],
  options?: { stylePrompt?: string },
): Promise<boolean> {
  const rawKey = (process.env.GEMINI_API_KEY || config.geminiApiKey || "").trim();
  const apiKeys = rawKey.split(",").map((k) => k.trim()).filter(Boolean);
  if (apiKeys.length === 0) return false;

  // Google AI Studio Native Multi-Speaker yêu cầu chính xác 2 speaker trong speakerVoiceConfigs
  const activeSpeakers = speakers.slice(0, 2);
  const spk0 = activeSpeakers[0];
  const spk1 = activeSpeakers[1];
  if (!spk0 || !spk1) return false;

  // Bóc tách dialogueText thành các lượt thoại (turns)
  const lines = dialogueText.split("\n").map((l) => l.trim()).filter(Boolean);
  const turns: { speaker: string; text: string }[] = [];
  let currentSpeaker = spk0.speaker;

  for (const line of lines) {
    const match = line.match(/^(?:[-*•]\s*)?([^:：\n]+)[:：]\s*(.*)$/);
    if (match && match[1] && match[2]) {
      const rawLabel = match[1].replace(/\([^)]+\)/g, "").trim().toLowerCase();
      const sentence = match[2].trim().replace(/^["'“”«»]+|["'“”«»]+$/g, "").trim();
      if (!sentence) continue;

      if (rawLabel === spk1.speaker.toLowerCase()) {
        currentSpeaker = spk1.speaker;
      } else if (rawLabel === spk0.speaker.toLowerCase()) {
        currentSpeaker = spk0.speaker;
      } else {
        // Luân phiên nếu là nhãn nhân vật khác
        currentSpeaker = currentSpeaker === spk0.speaker ? spk1.speaker : spk0.speaker;
      }
      turns.push({ speaker: currentSpeaker, text: sentence });
    } else {
      const sentence = line.replace(/^["'“”«»]+|["'“”«»]+$/g, "").trim();
      if (sentence) {
        turns.push({ speaker: currentSpeaker, text: sentence });
      }
    }
  }

  if (turns.length === 0) return false;

  // Kịch bản thoại sạch chuẩn hóa cho model Gemini 2.5 fallback
  const cleanDialogueScript = turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");

  const speakerVoiceConfigs = activeSpeakers.map((s) => ({
    speaker: s.speaker,
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: s.voiceName,
      },
    },
  }));

  // Ưu tiên Gemini 3.8 Flash TTS vì hỗ trợ cấu trúc speech_metadata đa nhân vật chuẩn xác
  const models = ["gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
  const tempAudioPath = path.join(VOICE_CACHE_DIR, `multispeaker_${Date.now()}.audio`);

  for (const apiKey of apiKeys) {
    for (const model of models) {
      try {
        let payload: any;
        if (model.includes("3.8")) {
          // Gemini 3.8: Mỗi lượt thoại là 1 part riêng biệt có speech_metadata.speaker
          // Tuyệt đối không chèn prefix "Read the following..." để tránh voice đọc thừa
          payload = {
            contents: [
              {
                role: "user",
                parts: turns.map((t) => ({
                  text: t.text,
                  speech_metadata: {
                    speaker: t.speaker,
                    ...(options?.stylePrompt ? { style: options.stylePrompt } : {}),
                  },
                })),
              },
            ],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs,
                },
              },
            },
          };
        } else {
          // Gemini 2.5: Script đối thoại trực tiếp không kèm prompt prefix
          payload = {
            contents: [
              {
                role: "user",
                parts: [{ text: cleanDialogueScript }],
              },
            ],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs,
                },
              },
            },
          };
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(45_000),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.warn(`[voice-generator] Google AI Studio Multi-Speaker (${model}) HTTP ${res.status}:`, errText.slice(0, 150));
          continue;
        }

        const data = (await res.json()) as any;
        const part = data?.candidates?.[0]?.content?.parts?.[0];
        if (part?.inlineData?.data) {
          const buffer = Buffer.from(part.inlineData.data, "base64");
          if (buffer.length > 0) {
            fs.writeFileSync(tempAudioPath, buffer);
            // Convert sang chuẩn Zalo Voice Bubble (.m4a AAC 44.1kHz 128kbps Mono)
            await convertToZaloVoiceBubble(tempAudioPath, outputPath);
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
              console.log(
                `[voice-generator] ✅ Sinh Podcast đa nhân vật thành công qua Google AI Studio (${model}, ${activeSpeakers.length} speakers, ${buffer.length} bytes)`,
              );
              return true;
            }
          }
        }
      } catch (err: any) {
        console.warn(`[voice-generator] Lỗi gọi Google AI Studio Multi-Speaker (${model}):`, err?.message || err);
      } finally {
        try {
          if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
        } catch {}
      }
    }
  }

  return false;
}

/**
 * Sinh âm thanh theo cấu trúc Hybrid 3 Tầng:
 * Tier 1: Google AI Studio (Gemini Flash TTS) - Diễn cảm, thơ ca, phong cách vùng miền
 * Tier 2: Google Cloud Text-to-Speech (Neural2/Wavenet) - Chuẩn phát thanh viên
 * Tier 3: Microsoft Edge-TTS (Hoài My / Nam Minh) - Lưới an toàn miễn phí 100%
 */
async function synthesizeSingleAudio(
  text: string,
  outputPath: string,
  voiceHint?: string,
  options?: { rate?: string; pitch?: string; stylePrompt?: string },
): Promise<"aistudio" | "google" | "edge"> {
  // Tier 1: Ưu tiên Google AI Studio (Gemini Flash TTS)
  const aiStudioOk = await synthesizeWithGoogleAIStudio(text, outputPath, voiceHint, options);
  if (aiStudioOk) return "aistudio";
  console.warn("[voice-generator] Google AI Studio TTS không khả dụng, đang kích hoạt Tier 2: Google Cloud TTS...");

  // Tier 2: Fallback sang Google Cloud TTS
  if (config.googleTtsEnabled) {
    const googleVoice = resolveGoogleVoice(voiceHint);
    const ok = await synthesizeWithGoogleTTS(text, googleVoice, outputPath, options);
    if (ok) return "google";
    console.warn("[voice-generator] Google Cloud TTS không khả dụng, đang kích hoạt Tier 3: EdgeTTS...");
  }

  // Tier 3: Fallback cuối cùng sang EdgeTTS ở chất lượng cao 160kbps
  const edgeVoice = resolveEdgeVoice(voiceHint);
  const edgeOk = await synthesizeWithEdgeTTS(text, edgeVoice, outputPath, options);
  if (!edgeOk) {
    throw new Error("Không thể tạo giọng nói từ cả Google AI Studio, Google Cloud TTS lẫn Edge-TTS.");
  }
  return "edge";
}

/**
 * Sinh giọng đọc đơn lẻ (Single speaker)
 */
export async function synthesizeSpeech(options: SynthesizeOptions): Promise<VoiceResult> {
  ensureVoiceDir();
  cleanOldVoiceFiles(60);

  const coreText = cleanCoreSpeechText(options.text);
  const cleanText = cleanTextForTTS(coreText || options.text);
  if (!cleanText) {
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      message: "Nội dung văn bản để đọc trống.",
    };
  }

  const timestamp = Date.now();
  const rawAudioPath = path.join(VOICE_CACHE_DIR, `raw_${timestamp}.mp3`);
  const finalM4aPath = path.join(VOICE_CACHE_DIR, `voice_${timestamp}.m4a`);

  try {
    const stylePrompt = options.stylePrompt || options.style;
    const provider = await synthesizeSingleAudio(cleanText, rawAudioPath, options.voice, {
      rate: options.rate,
      pitch: options.pitch,
      stylePrompt,
    });

    // Convert sang định dạng Zalo Voice Bubble (.m4a AAC 44.1kHz 128kbps)
    await convertToZaloVoiceBubble(rawAudioPath, finalM4aPath);

    try {
      fs.unlinkSync(rawAudioPath);
    } catch { }

    const finalStats = fs.statSync(finalM4aPath);

    return {
      success: true,
      filePath: finalM4aPath,
      fileName: path.basename(finalM4aPath),
      fileSize: finalStats.size,
      provider,
      caption: options.caption,
    };
  } catch (err: any) {
    console.error("[voice-generator] Lỗi tạo voice đơn lẻ:", err);
    try {
      if (fs.existsSync(rawAudioPath)) fs.unlinkSync(rawAudioPath);
    } catch { }
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      message: String(err?.message || err),
    };
  }
}

/**
 * Chuẩn hóa các lượt đối thoại:
 * Tách từng lượt thoại ra từng dòng riêng biệt nếu LLM vô tình viết trên cùng 1 dòng
 * (VD: "... tình yêu. Nữ: Anh lại văn vở rồi! Nam: Lần này...")
 */
export function normalizeDialogueTurns(text: string): string {
  if (!text) return "";
  let clean = text.trim();
  // 1. Tách dòng khi có một lượt nói mới (VD: "Nam:", "Nữ:", "MC:", v.v.) sau dấu kết thúc câu hoặc khoảng trắng
  clean = clean.replace(/([.!?…"]\s+)(?=(?:[-*•]\s*)?(?:Nam|Nữ|MC|Host|[A-ZÀ-Ỹa-zà-ỹ0-9_ -]+)[:：]\s*)/g, "$1\n");
  // 2. Tách dòng nếu giữa 2 câu có dấu gạch đầu dòng '- Nam:'
  clean = clean.replace(/(\s+)(?=[-•*]\s*(?:Nam|Nữ|MC|Host|[A-ZÀ-Ỹa-zà-ỹ0-9_ -]+)[:：]\s*)/g, "\n");
  return clean;
}

/**
 * Danh sách tiền tố metadata / đề mục thường gặp trong các bài viết, bài thơ, điều luật, tin tức.
 * Tuyệt đối không coi các đề mục này là tên nhân vật trong kịch bản đối thoại!
 */
export const METADATA_PREFIX_REGEX = /^(?:tác\s*giả|tác\s*phẩm|bài\s*thơ|thơ|tiêu\s*đề|tựa\s*đề|nguồn|ngày|thời\s*gian|địa\s*điểm|thể\s*loại|thể\s*thơ|khổ|đoạn|điều|khoản|điểm|chương|mục|phần|trích|ghi\s*chú|lưu\s*ý|nội\s*dung|ý\s*nghĩa|xuất\s*xứ|hoàn\s*cảnh|hoàn\s*cảnh\s*sáng\s*tác|tóm\s*tắt|bối\s*cảnh|phân\s*tích|bình\s*luận|cảm\s*nhận|đánh\s*giá|nghệ\s*thuật|chú\s*thích|chú\s*giải|giải\s*nghĩa|từ\s*ngữ|author|poem|title|source|date|time|genre|stanza|section|article|chapter|note|summary|context|analysis|example|ví\s*dụ|cụ\s*thể)(?:\s|$|[:：\d])/iu;

/**
 * Kiểm tra xem đoạn văn bản có phải kịch bản đối thoại đa nhân vật không.
 * Đảm bảo phân biệt chính xác giữa hội thoại thực sự và văn bản đơn lẻ có metadata (bài thơ, tác giả, điều luật).
 */
export function isDialogueText(text: string): boolean {
  if (!text) return false;
  const normalized = normalizeDialogueTurns(text);
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return false;

  const speakerSet = new Set<string>();
  let speakerTurnCount = 0;

  for (const line of lines) {
    const match = line.match(/^(?:[-*•]\s*)?([^:：\n]{1,30})[:：]\s*(.+)$/);
    if (!match || !match[1] || !match[2]) continue;

    const rawLabel = match[1].trim();
    if (METADATA_PREFIX_REGEX.test(rawLabel)) continue;
    if (/^\d+$/.test(rawLabel)) continue;

    const cleanSpeaker = rawLabel.replace(/\([^)]+\)/g, "").trim().toLowerCase();
    if (!cleanSpeaker) continue;

    speakerSet.add(cleanSpeaker);
    speakerTurnCount++;
  }

  return speakerSet.size >= 2 && speakerTurnCount >= 2;
}

/**
 * Sinh hội thoại Podcast đối đáp 2 người (Dialogue / Dual-Speaker)
 * Tier 1: Google AI Studio Native Multi-Speaker TTS (1-shot synthesis, âm điệu tự nhiên thống nhất)
 * Tier 2: Turn-by-turn fallback qua Google Cloud TTS / Edge-TTS (có chuẩn hóa codec AAC .m4a chống lỗi 00:00)
 */
export async function synthesizeDialogue(options: SynthesizeOptions): Promise<VoiceResult> {
  ensureVoiceDir();
  cleanOldVoiceFiles(60);

  const coreText = cleanCoreSpeechText(options.text || "");
  const content = normalizeDialogueTurns(coreText);
  if (!content) {
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      message: "Nội dung đối thoại trống.",
    };
  }

  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const timestamp = Date.now();
  const finalM4aPath = path.join(VOICE_CACHE_DIR, `podcast_${timestamp}.m4a`);

  const detectGenderFromName = (name: string): "male" | "female" | null => {
    const n = name.toLowerCase().trim();
    if (
      /(?:^|\b)(?:nam|anh|ông|chú|bác|bố|cha|trai|boy|man|male|mc\s*nam|host\s*nam|puck|fenrir|charon|tiến|hùng|dũng|tuấn|minh|long|hoàng|khoa|thành|đức|hải|quân)(?:\b|$)/i.test(n)
    ) {
      return "male";
    }
    if (
      /(?:^|\b)(?:nữ|nu|chị|cô|bà|mẹ|gái|girl|woman|female|mc\s*nữ|host\s*nữ|aoede|kore|mai|lan|hoa|linh|hương|nga|thảo|hà|trang|vy|quỳnh|ngọc|yến)(?:\b|$)/i.test(n)
    ) {
      return "female";
    }
    return null;
  };

  // 1. Trích xuất danh sách nhân vật đối thoại theo thứ tự xuất hiện
  const extractedSpeakers: { speaker: string; voiceName: string }[] = [];
  const speakerMap: Record<string, string> = {};

  if (Array.isArray(options.speakers) && options.speakers.length > 0) {
    for (const s of options.speakers) {
      if (s.speaker) {
        const cleanName = s.speaker.trim();
        const vName = resolveAIStudioVoice(s.voice || cleanName, options.stylePrompt || options.style);
        extractedSpeakers.push({ speaker: cleanName, voiceName: vName });
        speakerMap[cleanName.toLowerCase()] = vName;
      }
    }
  } else {
    const defaultAIStudioVoices = ["Puck", "Aoede", "Fenrir", "Kore", "Charon"];
    let aiIndex = 0;
    const seen = new Set<string>();

    for (const line of lines) {
      const match = line.match(/^(?:[-*•]\s*)?([^:：\n]{1,30})[:：]\s*(.+)$/);
      if (match && match[1]) {
        const rawLabel = match[1].replace(/\([^)]+\)/g, "").trim();
        if (!METADATA_PREFIX_REGEX.test(rawLabel)) {
          const lower = rawLabel.toLowerCase();
          if (!seen.has(lower)) {
            seen.add(lower);
            const gender = detectGenderFromName(rawLabel);
            let assignedVoice = "";
            if (gender === "male") {
              assignedVoice = "Puck";
            } else if (gender === "female") {
              assignedVoice = "Aoede";
            } else {
              assignedVoice = defaultAIStudioVoices[aiIndex % defaultAIStudioVoices.length] || "Puck";
              aiIndex++;
            }
            extractedSpeakers.push({ speaker: rawLabel, voiceName: assignedVoice });
            speakerMap[lower] = assignedVoice;
          }
        }
      }
    }
  }

  // Chuẩn hóa nội dung kịch bản cho Multi-Speaker: loại bỏ markdown thừa
  const cleanScriptLines: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(?:[-*•]\s*)?([^:：\n]+)[:：]\s*(.*)$/);
    if (match && match[1] && match[2]) {
      const rawLabel = match[1].replace(/\([^)]+\)/g, "").trim();
      const sentence = match[2].trim().replace(/^["'“”«»]+|["'“”«»]+$/g, "").trim();
      if (sentence) {
        cleanScriptLines.push(`${rawLabel}: ${sentence}`);
      }
    } else {
      const trimmed = line.trim();
      if (trimmed) cleanScriptLines.push(trimmed);
    }
  }
  const cleanScript = cleanScriptLines.join("\n");

  // 2. TIER 1: Thử nghiệm Google AI Studio Native Multi-Speaker TTS (1-shot synthesis)
  if (extractedSpeakers.length >= 2) {
    const nativeOk = await synthesizeWithGoogleAIStudioMultiSpeaker(
      cleanScript,
      finalM4aPath,
      extractedSpeakers,
      { stylePrompt: options.stylePrompt || options.style },
    );

    if (nativeOk && fs.existsSync(finalM4aPath) && fs.statSync(finalM4aPath).size > 0) {
      const finalStats = fs.statSync(finalM4aPath);
      return {
        success: true,
        filePath: finalM4aPath,
        fileName: path.basename(finalM4aPath),
        fileSize: finalStats.size,
        provider: "aistudio",
        caption: options.caption,
      };
    }
    console.warn("[voice-generator] Google AI Studio Multi-Speaker không khả dụng, đang kích hoạt Tier 2/3 turn-by-turn fallback...");
  }

  // 3. TIER 2 & 3: Turn-by-turn fallback (Google Cloud TTS / Edge-TTS)
  const partFiles: string[] = [];
  const listFilePath = path.join(VOICE_CACHE_DIR, `list_${timestamp}.txt`);
  const silencePath = path.join(VOICE_CACHE_DIR, `silence_${timestamp}.m4a`);

  const speakerToVoiceFallback: Record<string, string> = {};
  const defaultVoices = ["vi-VN-Wavenet-B", "vi-VN-Neural2-A"];
  let autoSpeakerIndex = 0;
  let activeProvider: "aistudio" | "google" | "edge" = "google";
  let lastAssignedVoice = defaultVoices[0] || "vi-VN-Wavenet-B";

  try {
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      if (!rawLine) continue;
      const line = rawLine.trim();
      if (!line) continue;

      const match = line.match(/^([^:：]+)[:：]\s*(.*)$/);
      let speakerRaw = "";
      let sentence = line;

      if (match && match[1] && match[2]) {
        speakerRaw = match[1].replace(/^[\s\-*•]+/, "").trim();
        sentence = match[2].trim().replace(/^["'“”«»]+|["'“”«»]+$/g, "").trim();
      }

      if (!sentence) continue;

      let turnEmotion = "";
      const speakerEmotionMatch = speakerRaw.match(/\(([^)]+)\)/);
      if (speakerEmotionMatch && speakerEmotionMatch[1]) {
        turnEmotion = speakerEmotionMatch[1].trim();
      }
      const sentenceEmotionMatch = sentence.match(/^\(([^)]+)\)\s*/);
      if (sentenceEmotionMatch && sentenceEmotionMatch[1]) {
        if (!turnEmotion) turnEmotion = sentenceEmotionMatch[1].trim();
        sentence = sentence.replace(/^\([^)]+\)\s*/, "").trim();
      }

      const speakerName = speakerRaw.replace(/\([^)]+\)/g, "").trim().toLowerCase();

      if (speakerName && !speakerToVoiceFallback[speakerName]) {
        const detectedGender = detectGenderFromName(speakerName);
        if (detectedGender === "male") {
          speakerToVoiceFallback[speakerName] = "vi-VN-Wavenet-B";
        } else if (detectedGender === "female") {
          speakerToVoiceFallback[speakerName] = "vi-VN-Neural2-A";
        } else {
          speakerToVoiceFallback[speakerName] = defaultVoices[autoSpeakerIndex % defaultVoices.length] || "vi-VN-Wavenet-B";
          autoSpeakerIndex++;
        }
      }

      // Giữ nguyên giọng của người nói trước nếu câu này không có nhãn nhân vật mới (tránh đổi giọng ngẫu nhiên giữa chừng)
      const assignedVoice = speakerName ? speakerToVoiceFallback[speakerName] || defaultVoices[0]! : lastAssignedVoice;
      lastAssignedVoice = assignedVoice;

      const partRaw = path.join(VOICE_CACHE_DIR, `part_raw_${timestamp}_${i}.mp3`);
      const partM4a = path.join(VOICE_CACHE_DIR, `part_${timestamp}_${i}.m4a`);

      if (i > 0) {
        await new Promise((r) => setTimeout(r, 150));
      }

      const turnStyle = [options.stylePrompt || options.style, turnEmotion].filter(Boolean).join(", ");
      const cleanSentence = cleanTextForTTS(sentence);
      if (!cleanSentence) continue;

      const p = await synthesizeSingleAudio(cleanSentence, partRaw, assignedVoice, {
        rate: options.rate,
        pitch: options.pitch,
        stylePrompt: turnStyle,
      });
      activeProvider = p;

      if (fs.existsSync(partRaw) && fs.statSync(partRaw).size > 0) {
        // Chuẩn hóa ngay lập tức từng part sang .m4a AAC chuẩn để concat đồng bộ định dạng
        await convertToZaloVoiceBubble(partRaw, partM4a);
        try { fs.unlinkSync(partRaw); } catch {}
        if (fs.existsSync(partM4a) && fs.statSync(partM4a).size > 0) {
          partFiles.push(partM4a);
        }
      }
    }

    if (partFiles.length === 0) {
      throw new Error("Không tạo được đoạn âm thanh nào cho podcast");
    }

    // Tạo khoảng lặng 250ms giữa các câu thoại
    let hasSilence = false;
    try {
      await execPromise(`ffmpeg -y -v error -f lavfi -i anullsrc=r=44100:cl=mono -t 0.25 -c:a aac "${silencePath}"`);
      hasSilence = fs.existsSync(silencePath) && fs.statSync(silencePath).size > 0;
    } catch {
      hasSilence = false;
    }

    const concatLines: string[] = [];
    for (let idx = 0; idx < partFiles.length; idx++) {
      const partFile = partFiles[idx];
      if (!partFile) continue;
      concatLines.push(`file '${path.resolve(partFile).replace(/'/g, "'\\''")}'`);
      if (hasSilence && idx < partFiles.length - 1) {
        concatLines.push(`file '${path.resolve(silencePath).replace(/'/g, "'\\''")}'`);
      }
    }
    fs.writeFileSync(listFilePath, concatLines.join("\n"), "utf8");

    try {
      const concatCmd = `ffmpeg -y -v error -f concat -safe 0 -i "${listFilePath}" -vn -map_metadata -1 -c:a aac -b:a 128k -ar 44100 -ac 1 -movflags +faststart "${finalM4aPath}"`;
      await execPromise(concatCmd);
    } catch (ffmpegErr) {
      console.warn("[voice-generator] FFmpeg concat dialogue không thành công, re-encode từ file part đầu tiên:", ffmpegErr);
      if (partFiles[0]) {
        await execPromise(`ffmpeg -y -v error -i "${partFiles[0]}" -vn -map_metadata -1 -c:a aac -b:a 128k -ar 44100 -ac 1 -movflags +faststart "${finalM4aPath}"`);
      }
    }

    const finalStats = fs.statSync(finalM4aPath);

    return {
      success: true,
      filePath: finalM4aPath,
      fileName: path.basename(finalM4aPath),
      fileSize: finalStats.size,
      provider: activeProvider,
      caption: options.caption,
    };
  } catch (err: any) {
    console.error("[voice-generator] Lỗi tạo Podcast dialogue:", err);
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      message: String(err?.message || err),
    };
  } finally {
    try {
      if (fs.existsSync(listFilePath)) fs.unlinkSync(listFilePath);
      if (fs.existsSync(silencePath)) fs.unlinkSync(silencePath);
      for (const p of partFiles) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch {}
  }
}

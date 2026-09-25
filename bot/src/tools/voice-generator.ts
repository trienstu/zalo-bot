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
 * Chất lượng âm thanh cao cấp, sáng rõ và không bị vỡ/nghẹt tiếng
 */
async function convertToZaloVoiceBubble(inputPath: string, outputPath: string): Promise<void> {
  try {
    const ffmpegCmd = `ffmpeg -y -v error -i "${inputPath}" -vn -map_metadata -1 -c:a aac -b:a 128k -ar 44100 -ac 1 -movflags +faststart "${outputPath}"`;
    await execPromise(ffmpegCmd);
  } catch (ffmpegErr) {
    console.warn("[voice-generator] FFmpeg convert không thành công, fallback sao chép file gốc:", ffmpegErr);
    fs.copyFileSync(inputPath, outputPath);
  }
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
 * Định danh giọng Google AI Studio (Gemini Native Audio):
 * Nữ: Aoede, Kore
 * Nam: Puck, Fenrir, Charon
 */
export function resolveAIStudioVoice(voiceHint?: string): string {
  if (!voiceHint) return "Aoede";
  const hint = voiceHint.toLowerCase().trim();

  if (
    hint.includes("nam") ||
    hint.includes("male") ||
    hint.includes("dan") ||
    hint.includes("puck") ||
    hint.includes("wavenet-b") ||
    hint.includes("wavenet-d") ||
    hint.includes("namminh")
  ) {
    return "Puck";
  }
  if (hint.includes("trầm") || hint.includes("charon") || hint.includes("fenrir")) {
    return "Fenrir";
  }
  if (hint.includes("kore")) {
    return "Kore";
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

  const voiceName = resolveAIStudioVoice(voiceHint);
  const models = ["gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];

  const styleDesc = (options?.stylePrompt || "").trim();
  let promptText = "";
  if (styleDesc) {
    promptText = `Hãy thể hiện và đọc diễn cảm văn bản sau bằng tiếng Việt với phong cách/giọng điệu: ${styleDesc}.\n\nVăn bản:\n${text}`;
  } else {
    promptText = `Hãy đọc diễn cảm văn bản sau bằng tiếng Việt với ngữ điệu tự nhiên, truyền cảm:\n\n${text}`;
  }

  const payload = {
    contents: [
      {
        parts: [{ text: promptText }],
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

  for (const apiKey of apiKeys) {
    for (const model of models) {
      try {
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

  const cleanText = options.text?.trim();
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
 * Sinh hội thoại Podcast đối đáp 2 người (Dialogue / Dual-Speaker)
 */
export async function synthesizeDialogue(options: SynthesizeOptions): Promise<VoiceResult> {
  ensureVoiceDir();
  cleanOldVoiceFiles(60);

  const content = options.text?.trim();
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
  const partFiles: string[] = [];
  const timestamp = Date.now();
  const listFilePath = path.join(VOICE_CACHE_DIR, `list_${timestamp}.txt`);
  const finalM4aPath = path.join(VOICE_CACHE_DIR, `podcast_${timestamp}.m4a`);

  // Xây dựng map speaker -> voice
  const speakerToVoice: Record<string, string> = {};
  if (Array.isArray(options.speakers) && options.speakers.length > 0) {
    for (const s of options.speakers) {
      if (s.speaker && s.voice) {
        speakerToVoice[s.speaker.trim().toLowerCase()] = s.voice.trim();
      }
    }
  }

  // Cặp giọng mặc định: Nam phát thanh viên (Wavenet-B / Puck) & Nữ MC (Neural2-A / Aoede)
  const defaultVoices = ["vi-VN-Wavenet-B", "vi-VN-Neural2-A"];
  let autoSpeakerIndex = 0;
  let activeProvider: "aistudio" | "google" | "edge" = "aistudio";
  const silencePath = path.join(VOICE_CACHE_DIR, `silence_${timestamp}.m4a`);

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
        speakerRaw = match[1].trim();
        sentence = match[2].trim();
      }

      if (!sentence) continue;

      // Bóc tách cảm xúc/sắc thái thoại nếu có trong ngoặc đơn ở tên nhân vật hoặc đầu câu:
      // Ví dụ: "Nam (hào hứng): ..." hoặc "Nam: (cười lớn) Chào bạn!"
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

      // Tên nhân vật sạch
      const speakerName = speakerRaw.replace(/\([^)]+\)/g, "").trim().toLowerCase();

      if (speakerName && !speakerToVoice[speakerName]) {
        const detectedGender = detectGenderFromName(speakerName);
        if (detectedGender === "male") {
          speakerToVoice[speakerName] = "vi-VN-Wavenet-B";
        } else if (detectedGender === "female") {
          speakerToVoice[speakerName] = "vi-VN-Neural2-A";
        } else {
          speakerToVoice[speakerName] = defaultVoices[autoSpeakerIndex % defaultVoices.length] || "vi-VN-Wavenet-B";
          autoSpeakerIndex++;
        }
      }

      const assignedVoice = (speakerName ? speakerToVoice[speakerName] : defaultVoices[i % 2]) || "vi-VN-Neural2-A";
      const partPath = path.join(VOICE_CACHE_DIR, `part_${timestamp}_${i}.mp3`);

      if (i > 0) {
        await new Promise((r) => setTimeout(r, 150));
      }

      // Ghép phong cách chung và cảm xúc riêng của từng lượt thoại (nếu có)
      const turnStyle = [options.stylePrompt || options.style, turnEmotion].filter(Boolean).join(", ");

      const p = await synthesizeSingleAudio(sentence, partPath, assignedVoice, {
        rate: options.rate,
        pitch: options.pitch,
        stylePrompt: turnStyle,
      });
      activeProvider = p;

      if (fs.existsSync(partPath) && fs.statSync(partPath).size > 0) {
        partFiles.push(partPath);
      }
    }

    if (partFiles.length === 0) {
      throw new Error("Không tạo được đoạn âm thanh nào cho podcast");
    }

    // Tạo 1 file silence 250ms để tạo nhịp thở tự nhiên giữa các lượt đối thoại
    let hasSilence = false;
    try {
      await execPromise(`ffmpeg -y -v error -f lavfi -i anullsrc=r=44100:cl=mono -t 0.25 -c:a aac "${silencePath}"`);
      hasSilence = fs.existsSync(silencePath) && fs.statSync(silencePath).size > 0;
    } catch {
      hasSilence = false;
    }

    // Ghép các part xen kẽ khoảng lặng tự nhiên qua FFmpeg Concat Demuxer và encode sang Zalo Voice Bubble (.m4a 44.1kHz 128kbps)
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
      console.warn("[voice-generator] FFmpeg concat dialogue không thành công, fallback sang file part đầu tiên:", ffmpegErr);
      if (partFiles[0]) fs.copyFileSync(partFiles[0], finalM4aPath);
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
    } catch { }
  }
}

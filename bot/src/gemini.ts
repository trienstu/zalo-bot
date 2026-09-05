import fs from "node:fs";
import { config } from "./config.js";

/**
 * Lớp gọi Google Gemini API dùng chung (Tóm tắt hội thoại Zalo, bóc tách dữ liệu).
 * Hỗ trợ các dòng model Gemini (Gemini 2.5 Flash, Gemini 3.7 Flash, Gemini 3.1 Pro, v.v.).
 */
let botKeyOffset = 0;

export interface GeminiImagePart {
  data: string; // Base64 string
  mimeType: string; // e.g. 'image/jpeg', 'image/png', 'application/pdf', 'audio/mp3'
}

export type GeminiMediaPart = GeminiImagePart;

/**
 * Phát hiện chuẩn xác MIME Type từ Magic Bytes nhị phân của Buffer,
 * khắc phục hoàn toàn trường hợp Zalo CDN trả về header chung chung application/octet-stream.
 */
function detectMimeType(buffer: Buffer, fileName = "", headerContentType = ""): string {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 6 && buffer.toString("ascii", 0, 3) === "GIF") {
    return "image/gif";
  }
  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "%PDF") {
    return "application/pdf";
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp";
  }

  const cleanHeader = (headerContentType.split(";")[0] || "").trim().toLowerCase();
  if (cleanHeader && cleanHeader !== "application/octet-stream" && cleanHeader !== "binary/octet-stream") {
    return cleanHeader;
  }

  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "pdf") return "application/pdf";
  if (ext === "mp3") return "audio/mp3";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a") return "audio/mp4";

  return cleanHeader || "application/octet-stream";
}

export async function downloadImageBase64(url: string): Promise<GeminiImagePart | null> {
  try {
    if (fs.existsSync(url)) {
      const buffer = fs.readFileSync(url);
      const mime = detectMimeType(buffer, url, "");
      return {
        data: buffer.toString("base64"),
        mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
      };
    }

    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get("content-type") || "";
    const mime = detectMimeType(buffer, url, contentType);
    return {
      data: buffer.toString("base64"),
      mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
    };
  } catch (e) {
    console.warn(`[gemini] Lỗi tải ảnh ${url.slice(0, 80)}: ${String(e)}`);
    return null;
  }
}

/**
 * Tải và giải mã nội dung tài liệu (PDF, Text, Code, CSV, JSON, Audio, Image).
 * Hỗ trợ cả file cục bộ trong ổ cứng lẫn URL tải qua mạng.
 */
export async function downloadFileContent(
  url: string,
  fileName = "",
): Promise<{ textContent?: string; mediaPart?: GeminiMediaPart } | null> {
  try {
    let buffer: Buffer;
    let contentType = "";

    if (fs.existsSync(url)) {
      buffer = fs.readFileSync(url);
    } else {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000), // 60s timeout cho file tài liệu nặng (20MB-50MB)
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
      });
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      contentType = (res.headers.get("content-type") || "").toLowerCase();
    }

    const detectedMime = detectMimeType(buffer, fileName || url, contentType);
    const ext = (fileName.split(".").pop() || url.split(".").pop() || "").toLowerCase();

    // 1. File PDF: Ưu tiên bóc tách toàn bộ Text bằng unpdf siêu tốc, nhẹ RAM & xử lý file nặng không giới hạn MB
    if (detectedMime === "application/pdf" || ext === "pdf") {
      try {
        const { extractText } = await import("unpdf");
        const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const pdfResult = await extractText(uint8, { mergePages: true });
        const extracted = (pdfResult?.text || "").trim();
        if (extracted.length >= 50) {
          console.log(`[gemini] 📄 Đã trích xuất ${extracted.length.toLocaleString("vi-VN")} ký tự văn bản từ PDF "${fileName || "tài liệu"}" (${pdfResult.totalPages} trang)`);
          return { textContent: extracted };
        }
      } catch (pdfErr) {
        console.warn(`[gemini] Không thể trích xuất text từ PDF bằng unpdf, thử multimodal:`, pdfErr);
      }

      // Nếu là PDF scan dạng ảnh thuần túy:
      // Chỉ gửi Multimodal cho Gemini nếu file <= 15MB (để không vượt quá giới hạn 20MB payload API)
      if (buffer.length <= 15 * 1024 * 1024) {
        return {
          mediaPart: {
            data: buffer.toString("base64"),
            mimeType: "application/pdf",
          },
        };
      } else {
        console.warn(`[gemini] File PDF scan không có text layer và quá nặng (${(buffer.length / 1024 / 1024).toFixed(1)}MB > 15MB)`);
        return {
          textContent: `[File PDF scan dạng ảnh "${fileName || "tài liệu"}" nặng ${(buffer.length / 1024 / 1024).toFixed(1)}MB, không chứa lớp văn bản và vượt quá giới hạn OCR 15MB của AI API. Vui lòng chuyển thành file PDF văn bản hoặc gửi ảnh từng trang để bot đọc.]`,
        };
      }
    }

    // 2. File Hình ảnh (Gemini đọc Multimodal native)
    if (detectedMime.startsWith("image/")) {
      return {
        mediaPart: {
          data: buffer.toString("base64"),
          mimeType: detectedMime,
        },
      };
    }

    // 2. File Âm thanh / Voice
    if (detectedMime.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg", "aac"].includes(ext)) {
      return {
        mediaPart: {
          data: buffer.toString("base64"),
          mimeType: detectedMime.startsWith("audio/") ? detectedMime : "audio/mp3",
        },
      };
    }

    // 3. File Text / Code / CSV / JSON / Markdown / Log
    if (
      ["txt", "csv", "json", "md", "log", "js", "ts", "py", "html", "css", "sql", "sh", "xml", "yaml", "yml"].includes(ext) ||
      detectedMime.startsWith("text/") ||
      detectedMime.includes("json") ||
      detectedMime.includes("javascript")
    ) {
      const text = buffer.toString("utf-8");
      return { textContent: text };
    }

    // Fallback file văn bản khác nếu không chứa byte nhị phân đặc biệt
    if (buffer.length < 5 * 1024 * 1024) {
      const text = buffer.toString("utf-8");
      if (!/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1000))) {
        return { textContent: text };
      }
    }

    // Nếu vẫn là ảnh (ví dụ định dạng chưa phổ biến) thì trả về mediaPart
    if (detectedMime && !detectedMime.includes("octet-stream")) {
      return {
        mediaPart: {
          data: buffer.toString("base64"),
          mimeType: detectedMime,
        },
      };
    }

    return null;
  } catch (e) {
    console.warn(`[gemini] Lỗi đọc file/ảnh ${url.slice(0, 80)}: ${String(e)}`);
    return null;
  }
}

export async function callGemini(
  system: string,
  user: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
    json?: boolean;
    images?: GeminiImagePart[];
    mediaParts?: GeminiMediaPart[];
    enableSearch?: boolean;
  },
): Promise<string> {
  const rawKey = (process.env.GEMINI_API_KEY || config.geminiApiKey || "").trim();
  const apiKeys = rawKey.split(",").map((k) => k.trim()).filter(Boolean);

  if (apiKeys.length === 0) {
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  let primaryModel = process.env.GEMINI_MODEL?.trim() || config.geminiModel || "gemini-3.7-flash";
  // Nếu env cũ chứa 3.5 (đã bị khai tử) hoặc rỗng, mặc định gemini-3.7-flash
  if (!primaryModel || primaryModel.includes("3.5")) {
    primaryModel = "gemini-3.7-flash";
  }

  // Danh sách model cascading dự phòng khi model chính nghẽn mạng / 503 / 429 / Timeout:
  // 1. gemini-flash-lite-latest: Siêu tốc <1s, độ ổn định cực cao
  // 2. gemini-3.1-flash-lite-preview: Bản lite 3.1
  const candidateFallbacks = ["gemini-flash-lite-latest", "gemini-3.1-flash-lite-preview"].filter(
    (m) => m !== primaryModel,
  );

  const temperature = options?.temperature ?? 0.3;
  const maxTokens = options?.maxTokens;

  let lastError: unknown;
  const numKeys = apiKeys.length;

  const userParts: Record<string, unknown>[] = [];
  const allMedia = [...(options?.images || []), ...(options?.mediaParts || [])];
  if (allMedia.length > 0) {
    for (const img of allMedia) {
      userParts.push({
        inline_data: {
          mime_type: img.mimeType || "image/jpeg",
          data: img.data,
        },
      });
    }
  }
  userParts.push({ text: user });

  // Thử lần lượt qua từng API Key nếu có nhiều key (Xoay vòng chống 429 Rate Limit)
  for (let attempt = 0; attempt < numKeys; attempt += 1) {
    const keyIdx = (botKeyOffset + attempt) % numKeys;
    const apiKey = apiKeys[keyIdx];

    const requestBody: Record<string, unknown> = {
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [
        {
          role: "user",
          parts: userParts,
        },
      ],
      generationConfig: {
        temperature,
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        ...(options?.json ? { responseMimeType: "application/json" } : {}),
      },
    };

    const executeModel = async (targetModel: string, timeoutMs: number): Promise<string | null> => {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
      const resp = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.warn(`[gemini] Key #${keyIdx + 1} (${targetModel}) gặp HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        lastError = new Error(`Gemini API (${targetModel}) HTTP ${resp.status}: ${errText.slice(0, 300)}`);
        return null;
      }

      const data = (await resp.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const candidate = data.candidates?.[0];
      const content = candidate?.content?.parts?.map((p: { text?: string }) => p.text || "").join("").trim();
      if (!content) {
        lastError = new Error(`Response Gemini API (${targetModel}) rỗng`);
        return null;
      }
      return content;
    };

    // 1. Thử model chính (primaryModel, mặc định gemini-3.7-flash)
    try {
      const primaryRes = await executeModel(primaryModel, 15_000);
      if (primaryRes) {
        botKeyOffset = (keyIdx + 1) % numKeys;
        return primaryRes;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[gemini] Lỗi gọi model chính ${primaryModel} (Key #${keyIdx + 1}): ${String(err)}`);
    }

    // 2. Tự động cascading fallback nếu primaryModel nghẽn hoặc lỗi
    for (const fbModel of candidateFallbacks) {
      try {
        console.log(`[gemini] ⚡ Model chính gặp lỗi/nghẽn, tự động chuyển sang model dự phòng: ${fbModel}...`);
        const fbRes = await executeModel(fbModel, 10_000);
        if (fbRes) {
          console.log(`[gemini] ✅ Đã phản hồi thành công qua fallback model ${fbModel}!`);
          botKeyOffset = (keyIdx + 1) % numKeys;
          return fbRes;
        }
      } catch (fbErr) {
        console.warn(`[gemini] Fallback ${fbModel} cũng gặp lỗi: ${String(fbErr)}`);
      }
    }
  }

  // Fallback sang DeepSeek nếu có cấu hình DEEPSEEK_API_KEY
  if (config.deepseekApiKey) {
    try {
      console.log("[gemini] Gemini quá tải, đang chuyển hướng sang DeepSeek AI...");
      const dsResp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: config.deepseekModel || "deepseek-chat",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature,
        }),
      });
      if (dsResp.ok) {
        const dsData = (await dsResp.json()) as any;
        const dsContent = dsData.choices?.[0]?.message?.content?.trim();
        if (dsContent) return dsContent;
      }
    } catch (dsErr) {
      console.warn("[gemini] Fallback DeepSeek thất bại:", dsErr);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Gọi Gemini trả về chuỗi JSON parse được
 */
export async function callGeminiJson(
  system: string,
  user: string,
  maxTokens?: number,
): Promise<string> {
  return callGemini(system, user, { maxTokens, json: true });
}

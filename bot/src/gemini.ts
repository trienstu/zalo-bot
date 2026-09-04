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
        signal: AbortSignal.timeout(30_000),
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

    // 1. File Hình ảnh hoặc PDF (Gemini đọc Multimodal native)
    if (detectedMime.startsWith("image/") || detectedMime === "application/pdf") {
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
  },
): Promise<string> {
  const rawKey = (process.env.GEMINI_API_KEY || config.geminiApiKey || "").trim();
  const apiKeys = rawKey.split(",").map((k) => k.trim()).filter(Boolean);

  if (apiKeys.length === 0) {
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  const model = process.env.GEMINI_MODEL?.trim() || config.geminiModel || "gemini-3.6-flash";
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
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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

    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(60_000), // 60s timeout
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        const err = new Error(`Gemini API HTTP ${resp.status}: ${errText.slice(0, 500)}`);
        console.warn(`[gemini] Key #${keyIdx + 1} (${model}) gặp HTTP ${resp.status}. Đang tự động thử tiếp...`);
        lastError = err;

        // Nếu model hiện tại bị 404/503, thử model gemini-3.5-flash ngay với cùng key
        if ((resp.status === 404 || resp.status === 503) && model !== "gemini-3.5-flash") {
          try {
            const fallbackEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
            const fallbackResp = await fetch(fallbackEndpoint, {
              method: "POST",
              signal: AbortSignal.timeout(60_000),
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            });
            if (fallbackResp.ok) {
              const fbData = (await fallbackResp.json()) as {
                candidates?: Array<{
                  content?: { parts?: Array<{ text?: string }> };
                  finishReason?: string;
                }>;
              };
              const fbText = fbData.candidates?.[0]?.content?.parts?.[0]?.text;
              if (typeof fbText === "string") {
                botKeyOffset = (keyIdx + 1) % numKeys;
                return fbText.trim();
              }
            }
          } catch {}
        }
        continue;
      }

      const data = (await resp.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const candidate = data.candidates?.[0];
      const content = candidate?.content?.parts?.map((p: { text?: string }) => p.text || "").join("").trim();
      if (!content) {
        throw new Error("Response Gemini API không có nội dung (content rỗng)");
      }
      botKeyOffset = (keyIdx + 1) % numKeys;
      return content;
    } catch (error) {
      lastError = error;
      console.warn(`[gemini] Lỗi với Key #${keyIdx + 1}: ${String(error)}`);
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

import { config } from "./config.js";

/**
 * Lớp gọi Google Gemini API dùng chung (Tóm tắt hội thoại Zalo, bóc tách dữ liệu).
 * Hỗ trợ các dòng model Gemini (Gemini 2.5 Flash, Gemini 3.7 Flash, Gemini 3.1 Pro, v.v.).
 */
let botKeyOffset = 0;

export interface GeminiImagePart {
  data: string; // Base64 string
  mimeType: string; // e.g. 'image/jpeg', 'image/png'
}

export async function downloadImageBase64(url: string): Promise<GeminiImagePart | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const mimeType = (contentType.split(";")[0] || "image/jpeg").trim();
    return {
      data: buffer.toString("base64"),
      mimeType,
    };
  } catch (e) {
    console.warn(`[gemini] Không tải được ảnh ${url.slice(0, 80)}: ${String(e)}`);
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
  if (options?.images && options.images.length > 0) {
    for (const img of options.images) {
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
        
        // 429: Hết quota Free Tier -> Thử key tiếp theo ngay lập tức
        if (resp.status === 429) {
          console.warn(`[gemini] Key #${keyIdx + 1} hết quota (HTTP 429). Đang chuyển sang key tiếp theo...`);
          lastError = err;
          continue;
        }
        throw err;
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

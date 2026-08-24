import { config } from "./config.js";

/**
 * Lớp gọi Google Gemini API dùng chung (Tóm tắt hội thoại Zalo, bóc tách dữ liệu).
 * Hỗ trợ các dòng model Gemini (Gemini 2.5 Flash, Gemini 3.7 Flash, Gemini 3.1 Pro, v.v.).
 */
export async function callGemini(
  system: string,
  user: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
    json?: boolean;
  },
): Promise<string> {
  const apiKey = (config.geminiApiKey || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  const model = config.geminiModel || "gemini-3.6-flash";
  const temperature = options?.temperature ?? 0.3;
  const maxTokens = options?.maxTokens;

  // Sử dụng endpoint chuẩn Native của Google AI Studio (nhanh và tương thích 100%)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody: Record<string, unknown> = {
    system_instruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [
      {
        role: "user",
        parts: [{ text: user }],
      },
    ],
    generationConfig: {
      temperature,
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      ...(options?.json ? { responseMimeType: "application/json" } : {}),
    },
  };

  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [2_000, 5_000];
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(30_000), // 30s timeout
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        const err = new Error(`Gemini API HTTP ${resp.status}: ${errText.slice(0, 500)}`);
        // 429: rate limit, >= 500: lỗi máy chủ -> retry
        if (resp.status === 429 || resp.status >= 500) {
          lastError = err;
          if (attempt < MAX_ATTEMPTS) {
            const delay = BACKOFF_MS[attempt - 1] ?? 3_000;
            console.warn(`[gemini] Thử lại lần ${attempt + 1}/${MAX_ATTEMPTS} sau ${delay}ms... Lỗi: ${err.message}`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        throw err;
      }

      const data = (await resp.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!content) {
        throw new Error("Response Gemini API không có nội dung (content rỗng)");
      }
      return content;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS && !(error instanceof Error && error.message.includes("HTTP 400"))) {
        const delay = BACKOFF_MS[attempt - 1] ?? 3_000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
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

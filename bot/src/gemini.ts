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
  if (!config.geminiApiKey) {
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  const model = config.geminiModel || "gemini-3.6-flash";
  const temperature = options?.temperature ?? 0.3;
  const maxTokens = options?.maxTokens;

  // Sử dụng endpoint chuẩn OpenAI-compatible của Google AI Studio
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    stream: false,
  };

  if (maxTokens) {
    requestBody.max_tokens = maxTokens;
  }

  if (options?.json) {
    requestBody.response_format = { type: "json_object" };
  }

  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [2_000, 8_000];
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(300_000), // 5 phút timeout
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.geminiApiKey}`,
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
            const delay = BACKOFF_MS[attempt - 1] ?? 5_000;
            console.warn(`[gemini] Thử lại lần ${attempt + 1}/${MAX_ATTEMPTS} sau ${delay}ms... Lỗi: ${err.message}`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        throw err;
      }

      const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("Response Gemini API không có nội dung (content rỗng)");
      }
      return content;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS && !(error instanceof Error && error.message.includes("HTTP 400"))) {
        const delay = BACKOFF_MS[attempt - 1] ?? 5_000;
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

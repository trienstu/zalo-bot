import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { extractPublisherName, type GeminiImagePart } from "./gemini.js";
import { incrementGroundingUsage } from "./grounding-quota.js";

interface ServiceAccountCredentials {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;
let parsedCredentials: ServiceAccountCredentials | null = null;

/**
 * Tìm và nạp file Service Account JSON từ cấu hình hoặc các đường dẫn mặc định
 */
function loadCredentials(): ServiceAccountCredentials | null {
  if (parsedCredentials) return parsedCredentials;

  // 1. Nếu có chuỗi JSON truyền trực tiếp qua env
  if (config.vertexServiceAccountJson) {
    try {
      parsedCredentials = JSON.parse(config.vertexServiceAccountJson) as ServiceAccountCredentials;
      return parsedCredentials;
    } catch (e) {
      console.warn("[vertex-gemini] Lỗi parse VERTEX_SERVICE_ACCOUNT_JSON:", e);
    }
  }

  // 2. Các đường dẫn file khả dĩ
  const candidatePaths = [
    config.vertexCredentialsPath,
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    "google-credentials.json",
    path.join(process.cwd(), "google-credentials.json"),
    path.join(process.cwd(), "bot", "google-credentials.json"),
    path.join(process.cwd(), "..", "google-credentials.json"),
  ].filter((p): p is string => Boolean(p && p.trim()));

  for (const p of candidatePaths) {
    const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    if (fs.existsSync(resolved)) {
      try {
        const raw = fs.readFileSync(resolved, "utf8");
        parsedCredentials = JSON.parse(raw) as ServiceAccountCredentials;
        return parsedCredentials;
      } catch (e) {
        console.warn(`[vertex-gemini] Không thể đọc credentials tại ${resolved}:`, e);
      }
    }
  }

  return null;
}

/**
 * Kiểm tra xem cấu hình Vertex AI đã sẵn sàng hoạt động hay chưa
 */
export function isVertexConfigured(): boolean {
  return loadCredentials() !== null;
}

/**
 * Tạo Google OAuth2 Access Token từ Service Account bằng thuật toán ký JWT RSA-SHA256 chuẩn của Node.js
 */
export async function getVertexAccessToken(): Promise<string> {
  const creds = loadCredentials();
  if (!creds || !creds.client_email || !creds.private_key) {
    throw new Error("Không tìm thấy thông tin Service Account hợp lệ cho Vertex AI");
  }

  const now = Math.floor(Date.now() / 1000);
  // Dùng lại token cache nếu còn hạn trên 5 phút
  if (cachedToken && cachedToken.expiresAt > now + 300) {
    return cachedToken.token;
  }

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claimSet = Buffer.from(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: creds.token_uri || "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
  ).toString("base64url");

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(`${header}.${claimSet}`);
  const signature = sign.sign(creds.private_key, "base64url");
  const jwt = `${header}.${claimSet}.${signature}`;

  const tokenUri = creds.token_uri || "https://oauth2.googleapis.com/token";
  const res = await fetch(tokenUri, {
    method: "POST",
    signal: AbortSignal.timeout(6000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Lỗi lấy OAuth2 Token từ Google (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const expiresIn = data.expires_in || 3600;
  cachedToken = {
    token: data.access_token,
    expiresAt: now + expiresIn,
  };

  return data.access_token;
}

export interface VertexGeminiOptions {
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  search?: boolean;
  images?: GeminiImagePart[];
  timeoutMs?: number;
}

/**
 * Gọi Vertex AI Gemini (chuyên dụng cho Google Search Grounding để hưởng 1500 lượt search/ngày & trừ vào $300 credit)
 */
export async function callVertexGemini(
  prompt: string,
  options?: VertexGeminiOptions
): Promise<string | null> {
  const creds = loadCredentials();
  if (!creds) {
    return null;
  }

  const projectId = creds.project_id || config.vertexProjectId;
  const location = config.vertexLocation || "us-central1";
  const model = options?.model || config.vertexModel || "gemini-2.5-flash";
  const timeoutMs = options?.timeoutMs || 25000;
  const isSearchEnabled = options?.search ?? true;

  try {
    const token = await getVertexAccessToken();

    const userParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
    if (options?.images && options.images.length > 0) {
      for (const img of options.images) {
        userParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          },
        });
      }
    }
    userParts.push({ text: prompt });

    const requestBody: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: userParts,
        },
      ],
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        ...(options?.maxTokens ? { maxOutputTokens: options.maxTokens } : {}),
      },
    };

    if (options?.systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: options.systemInstruction }],
      };
    }

    if (isSearchEnabled) {
      // Vertex AI REST API sử dụng camelCase "googleSearch: {}"
      requestBody.tools = [{ googleSearch: {} }];
    }

    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const resp = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      console.warn(`[vertex-gemini] HTTP ${resp.status}: ${err.slice(0, 250)}`);
      return null;
    }

    const data = (await resp.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        groundingMetadata?: {
          webSearchQueries?: string[];
          groundingChunks?: { web?: { uri?: string; title?: string } }[];
        };
      }[];
    };

    const candidate = data.candidates?.[0];
    let content = candidate?.content?.parts?.map((p) => p.text || "").join("").trim();
    if (!content) return null;

    // Trích xuất nguồn báo chí chuẩn xác (không URL)
    if (candidate?.groundingMetadata?.groundingChunks && candidate.groundingMetadata.groundingChunks.length > 0) {
      incrementGroundingUsage(1);
      const sources = [
        ...new Set(
          candidate.groundingMetadata.groundingChunks
            .map((c) => extractPublisherName(c.web?.title, c.web?.uri))
            .filter((t): t is string => typeof t === "string" && t.length > 0)
        ),
      ];

      const alreadyHasCitation = /(?:nguồn(?:\s+kiểm\s+chứng)?|source)\s*:/i.test(content) || /\*\(nguồn/i.test(content);
      if (sources.length > 0 && !alreadyHasCitation) {
        content += `\n\n*(Nguồn: ${sources.join(", ")})*`;
      }
    }

    return content;
  } catch (err: any) {
    console.warn(`[vertex-gemini] Lỗi khi gọi Vertex AI (${model}):`, err?.message || err);
    return null;
  }
}

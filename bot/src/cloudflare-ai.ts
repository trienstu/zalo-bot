/**
 * Module Tích Hợp Cloudflare Workers AI REST API
 * Vận hành 3 vệ tinh hỗ trợ:
 * - Vệ tinh 1: LLM Fallback (Llama 3.3 70B / DeepSeek R1) sau khi xoay hết vòng key Gemini.
 * - Vệ tinh 2: Whisper Speech-to-Text chuyển tin nhắn thoại (Voice note) thành text.
 * - Vệ tinh 3: FLUX.1-schnell sinh ảnh nghệ thuật tức thì từ mô tả.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "./config.js";

const GENERATED_IMAGES_DIR = path.resolve(process.cwd(), "data", "generated-images");

function ensureImageOutputDir(): string {
  if (!fs.existsSync(GENERATED_IMAGES_DIR)) {
    fs.mkdirSync(GENERATED_IMAGES_DIR, { recursive: true });
  }
  return GENERATED_IMAGES_DIR;
}

export interface CloudflareChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CloudflareImageResult {
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;
  error?: string;
}

export interface CloudflareTranscriptionResult {
  success: boolean;
  text: string;
  vtt?: string;
  error?: string;
}

/**
 * Kiểm tra xem cấu hình Cloudflare Workers AI đã sẵn sàng chưa
 */
export function isCloudflareConfigured(): boolean {
  return Boolean(config.cloudflareAccountId?.trim() && config.cloudflareApiToken?.trim());
}

/**
 * 1. VỆ TINH 1: LLM Fallback qua Cloudflare Workers AI
 * Được gọi khi đã xoay hết 1 vòng toàn bộ key Gemini (và DeepSeek) mà vẫn thất bại.
 */
export async function callCloudflareLlm(
  messages: CloudflareChatMessage[],
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
  },
): Promise<string> {
  if (!isCloudflareConfigured()) {
    throw new Error("Cloudflare Workers AI chưa được cấu hình (thiếu CLOUDFLARE_ACCOUNT_ID hoặc CLOUDFLARE_API_TOKEN)");
  }

  const accountId = config.cloudflareAccountId.trim();
  const apiToken = config.cloudflareApiToken.trim();
  const model = options?.model?.trim() || config.cloudflareLlmModel || "@cf/meta/llama-3.3-70b-instruct";
  const timeoutMs = options?.timeoutMs || 25_000;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const body = {
    messages,
    max_tokens: options?.maxTokens || 1500,
    temperature: options?.temperature ?? 0.3,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Cloudflare AI LLM error [${res.status}]: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as any;
  const reply =
    data?.result?.response ||
    data?.result?.choices?.[0]?.text ||
    data?.result?.choices?.[0]?.message?.content ||
    data?.result?.text ||
    "";

  if (!reply) {
    throw new Error(`Cloudflare AI LLM trả về kết quả rỗng: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return String(reply).trim();
}

export type AspectRatioOption = "16:9" | "9:16" | "4:3" | "3:4" | "1:1";

/**
 * 2. VỆ TINH 3: Sinh ảnh nghệ thuật siêu tốc với FLUX.1-schnell (1 - 2 giây)
 */
export async function generateCloudflareImage(
  prompt: string,
  options?: {
    model?: string;
    steps?: number;
    timeoutMs?: number;
    aspectRatio?: AspectRatioOption;
  },
): Promise<CloudflareImageResult> {
  if (!isCloudflareConfigured()) {
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: "Cloudflare Workers AI chưa được cấu hình trong .env (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)",
    };
  }

  const accountId = config.cloudflareAccountId.trim();
  const apiToken = config.cloudflareApiToken.trim();
  const model = options?.model?.trim() || config.cloudflareImageModel || "@cf/black-forest-labs/flux-1-schnell";
  const timeoutMs = options?.timeoutMs || 35_000;
  const ratio: AspectRatioOption = options?.aspectRatio || "1:1";

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  try {
    ensureImageOutputDir();
    const timestamp = Date.now();
    const randStr = Math.random().toString(36).slice(2, 7);
    const fileName = `flux_${timestamp}_${randStr}.png`;
    const targetPath = path.join(GENERATED_IMAGES_DIR, fileName);

    let finalPrompt = prompt.trim();
    const hasVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(finalPrompt);

    if (hasVietnamese) {
      try {
        let ratioInstruction = "";
        if (ratio === "16:9") ratioInstruction = "Widescreen 16:9 horizontal framing, expansive landscape view.";
        else if (ratio === "9:16") ratioInstruction = "Vertical 9:16 portrait framing, tall full-length view.";
        else if (ratio === "4:3") ratioInstruction = "Classic 4:3 horizontal framing.";
        else if (ratio === "3:4") ratioInstruction = "Vertical 3:4 portrait framing.";

        const systemPrompt =
          `You are an expert AI visual prompt engineer for FLUX.1 text-to-image models.\n` +
          `Convert the user's Vietnamese request into a natural, vivid English image prompt (25 to 45 words).\n` +
          `CRITICAL RULES:\n` +
          `1. SUBJECT & AGE ACCURACY: In Vietnamese, "cô gái" means a young adult woman (around 20-25 years old), NOT a child or little girl. "chàng trai" means a young man. Accurately capture who they are.\n` +
          `2. CULTURAL AUTHENTICITY: If the request refers to Vietnamese regions (e.g., "miền tây" = Mekong Delta, traditional rustic ao ba ba blouse, lush river or village setting), depict them accurately and naturally.\n` +
          `3. AVOID STYLE LOCK (NO FAKE WATERCOLOR / CGI): DO NOT force digital art, CGI, 3D render, cartoonish colors, or heavy yellow/golden color grading. Keep the style clean, authentic, lifelike photography, or follow whatever artistic style the user specifically requested (such as anime, sketch, 3D, oil painting).\n` +
          `4. NO BUZZWORDS: Do NOT include buzzwords like "masterpiece, 8k, cinematic lighting, soft shadows, ultra realistic". Describe concrete visual elements instead (natural daylight, genuine expressions, crisp focus, lifelike skin texture).\n` +
          `5. COMPOSITION: ${ratioInstruction || "Balanced, natural framing."}\n` +
          `6. ALWAYS APPEND: "no text, no watermark, authentic photo".\n` +
          `7. Output ONLY the plain English prompt text, without quotes or markdown.`;

        const enhancedPrompt = await callCloudflareLlm([
          { role: "system", content: systemPrompt },
          { role: "user", content: finalPrompt },
        ], { timeoutMs: 10_000 });

        if (enhancedPrompt && enhancedPrompt.length > 10) {
          console.log(`[cloudflare-ai] 🌐 Đã tối ưu prompt sang tiếng Anh chuẩn FLUX: "${enhancedPrompt.slice(0, 120)}"`);
          finalPrompt = enhancedPrompt.replace(/^["']|["']$/g, "").trim();
        }
      } catch (tErr) {
        console.warn(`[cloudflare-ai] Dịch prompt ảnh sang tiếng Anh không thành công, tiếp tục dùng prompt gốc:`, tErr);
      }
    }

    const body: Record<string, any> = {
      prompt: finalPrompt,
    };
    if (options?.steps) {
      body.steps = options.steps;
    }

    console.log(`[cloudflare-ai] 🎨 Đang gửi prompt vẽ ảnh tới ${model} (tỉ lệ ${ratio}): "${finalPrompt.slice(0, 80)}"...`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Cloudflare Image Error [${res.status}]: ${errText.slice(0, 300)}`);
    }

    const contentType = res.headers.get("content-type") || "";
    let rawBuffer: Buffer | null = null;

    if (contentType.includes("image/")) {
      const arrayBuf = await res.arrayBuffer();
      rawBuffer = Buffer.from(arrayBuf);
    } else {
      const data = (await res.json()) as any;
      const base64Data = data?.result?.image || data?.image;
      if (base64Data) {
        rawBuffer = Buffer.from(base64Data, "base64");
      } else {
        throw new Error(`Cloudflare AI không trả về dữ liệu ảnh hợp lệ: ${JSON.stringify(data).slice(0, 200)}`);
      }
    }

    // Xử lý Cắt / Resize ảnh theo đúng Tỉ Lệ (Aspect Ratio) người dùng yêu cầu
    let finalBuffer = rawBuffer;
    try {
      if (ratio === "16:9") {
        finalBuffer = await sharp(rawBuffer)
          .resize(1024, 576, { fit: "cover", position: "centre" })
          .png()
          .toBuffer();
      } else if (ratio === "9:16") {
        finalBuffer = await sharp(rawBuffer)
          .resize(576, 1024, { fit: "cover", position: "centre" })
          .png()
          .toBuffer();
      } else if (ratio === "4:3") {
        finalBuffer = await sharp(rawBuffer)
          .resize(1024, 768, { fit: "cover", position: "centre" })
          .png()
          .toBuffer();
      } else if (ratio === "3:4") {
        finalBuffer = await sharp(rawBuffer)
          .resize(768, 1024, { fit: "cover", position: "centre" })
          .png()
          .toBuffer();
      }
    } catch (resizeErr) {
      console.warn(`[cloudflare-ai] Resize tỉ lệ ${ratio} thất bại, dùng ảnh gốc:`, resizeErr);
    }

    fs.writeFileSync(targetPath, finalBuffer);
    console.log(`[cloudflare-ai] ✅ Đã lưu ảnh thành công: ${targetPath} (${finalBuffer.length} bytes, ratio: ${ratio})`);

    return {
      success: true,
      filePath: targetPath,
      fileName,
      fileSize: finalBuffer.length,
    };
  } catch (err: any) {
    console.error("[cloudflare-ai] ❌ Lỗi tạo ảnh:", err);
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: err?.message || String(err),
    };
  }
}

/**
 * 3. VỆ TINH 2: Bóc băng âm thanh (Voice Note to Text) với Whisper
 */
export async function transcribeCloudflareAudio(
  audioBuffer: Buffer | ArrayBuffer,
  options?: {
    model?: string;
    timeoutMs?: number;
  },
): Promise<CloudflareTranscriptionResult> {
  if (!isCloudflareConfigured()) {
    return {
      success: false,
      text: "",
      error: "Cloudflare Workers AI chưa được cấu hình (thiếu CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)",
    };
  }

  const accountId = config.cloudflareAccountId.trim();
  const apiToken = config.cloudflareApiToken.trim();
  const model = options?.model?.trim() || config.cloudflareWhisperModel || "@cf/openai/whisper";
  const timeoutMs = options?.timeoutMs || 30_000;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  try {
    const uint8 = Buffer.isBuffer(audioBuffer)
      ? audioBuffer
      : Buffer.from(audioBuffer as unknown as ArrayBuffer);

    console.log(`[cloudflare-ai] 🎙️ Đang bóc băng âm thanh qua Whisper (${uint8.length} bytes)...`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: uint8,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Cloudflare Whisper Error [${res.status}]: ${errText.slice(0, 300)}`);
    }

    const data = (await res.json()) as any;
    const text = String(data?.result?.text || "").trim();

    console.log(`[cloudflare-ai] ✅ Bóc băng âm thanh thành công: "${text.slice(0, 100)}..."`);
    return {
      success: true,
      text,
      vtt: data?.result?.vtt,
    };
  } catch (err: any) {
    console.error("[cloudflare-ai] ❌ Lỗi bóc băng âm thanh:", err);
    return {
      success: false,
      text: "",
      error: err?.message || String(err),
    };
  }
}

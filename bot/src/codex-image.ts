import fs from "node:fs";
import path from "node:path";
import { config, hybridAgentSettings } from "./config.js";

const GENERATED_IMAGES_DIR = path.resolve(process.cwd(), "data", "generated-images");

export type AspectRatioOption = "16:9" | "9:16" | "4:3" | "3:4" | "1:1";

export interface CodexImageResult {
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;
  error?: string;
  translatedPrompt?: string;
}

export function isCodexImageConfigured(): boolean {
  const router = hybridAgentSettings.nineRouter;
  const apiKey = router.apiKey || process.env.NINE_ROUTER_API_KEY || "";
  return Boolean(apiKey && (router.enabled || process.env.IMAGE_PROVIDER === "codex"));
}

function ensureImageOutputDir(): string {
  if (!fs.existsSync(GENERATED_IMAGES_DIR)) {
    fs.mkdirSync(GENERATED_IMAGES_DIR, { recursive: true });
  }
  return GENERATED_IMAGES_DIR;
}

export function mapAspectRatioToSize(ratio: AspectRatioOption = "1:1"): string {
  switch (ratio) {
    case "16:9":
    case "4:3":
      return "1792x1024";
    case "9:16":
    case "3:4":
      return "1024x1792";
    case "1:1":
    default:
      return "1024x1024";
  }
}

/**
 * Tự động dịch và làm giàu visual prompt tiếng Việt sang tiếng Anh
 * bằng model đám mây siêu tốc của 9Router (Gemini Flash / Codex)
 */
async function enhanceVisualPrompt(
  prompt: string,
  ratio: AspectRatioOption,
  baseUrl: string,
  apiKey: string,
): Promise<string> {
  const hasVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(prompt);
  if (!hasVietnamese && prompt.length >= 60) {
    return prompt.trim();
  }

  const ratioHint = ratio === "16:9" || ratio === "4:3"
    ? "horizontal wide framing"
    : ratio === "9:16" || ratio === "3:4"
      ? "vertical portrait framing"
      : "square framing";

  const systemInstruction =
    "You are an expert prompt engineer for AI image generators (DALL-E 3 / GPT Image). " +
    "Given a user description (in Vietnamese or English), output an expressive, high-detail, vivid English visual prompt " +
    `optimized for ${ratioHint}. Describe subjects, lighting, mood, color palette, and composition. ` +
    "Output ONLY the final English prompt, without introductory text, quotes, or conversational filler.";

  try {
    const modelToUse = hybridAgentSettings.nineRouter.groundedModel || "ag/gemini-3.7-flash-high";
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelToUse,
        stream: false,
        max_tokens: 350,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt.trim() },
        ],
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      const enhanced = data?.choices?.[0]?.message?.content?.trim();
      if (enhanced && enhanced.length >= 10) {
        return enhanced.replace(/^["'`]|["'`]$/g, "").trim();
      }
    }
  } catch (err) {
    console.warn("[codex-image] Không thể làm giàu visual prompt, dùng prompt gốc:", err);
  }

  return prompt.trim();
}

/**
 * Sinh ảnh chất lượng cao bằng Codex (GPT Image / DALL-E) thông qua 9Router / Hermes
 */
export async function generateCodexImage(
  prompt: string,
  options?: {
    model?: string;
    aspectRatio?: AspectRatioOption;
    timeoutMs?: number;
  },
): Promise<CodexImageResult> {
  const router = hybridAgentSettings.nineRouter;
  const baseUrl = (router.baseUrl || process.env.NINE_ROUTER_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
  const apiKey = router.apiKey || process.env.NINE_ROUTER_API_KEY || "";
  const model = options?.model?.trim() || config.codexImageModel || "cx/gpt-image-1.5";
  const ratio: AspectRatioOption = options?.aspectRatio || "1:1";
  const timeoutMs = options?.timeoutMs || 90_000;

  if (!apiKey) {
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: "Chưa cấu hình NINE_ROUTER_API_KEY để gọi Codex Image Generator",
    };
  }

  try {
    ensureImageOutputDir();
    const timestamp = Date.now();
    const randStr = Math.random().toString(36).slice(2, 7);
    const fileName = `codex_${timestamp}_${randStr}.png`;
    const targetPath = path.join(GENERATED_IMAGES_DIR, fileName);

    // 1. Làm giàu & dịch visual prompt sang tiếng Anh
    const finalPrompt = await enhanceVisualPrompt(prompt, ratio, baseUrl, apiKey);
    const targetSize = mapAspectRatioToSize(ratio);

    console.log(`[codex-image] 🎨 Đang gửi lệnh sinh ảnh tới Codex (${model}, size: ${targetSize})...`);
    console.log(`[codex-image] 📝 Prompt hoàn chỉnh: "${finalPrompt.slice(0, 150)}..."`);

    // 2. Gọi endpoint OpenAI-compatible /v1/images/generations
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: finalPrompt,
        size: targetSize,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileSize: 0,
        error: `Codex Image API trả về lỗi HTTP ${response.status}: ${errBody.slice(0, 300)}`,
      };
    }

    const resJson = (await response.json()) as any;
    const item = resJson?.data?.[0];
    let b64Data = item?.b64_json;

    // Nếu trả về URL thay vì b64_json
    if (!b64Data && item?.url) {
      const imgFetch = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
      if (imgFetch.ok) {
        const arrayBuf = await imgFetch.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        fs.writeFileSync(targetPath, buffer);
        return {
          success: true,
          filePath: targetPath,
          fileName,
          fileSize: buffer.length,
          translatedPrompt: finalPrompt,
        };
      }
    }

    if (!b64Data) {
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileSize: 0,
        error: "Codex Image không trả về dữ liệu ảnh (thiếu b64_json hoặc url)",
      };
    }

    const buffer = Buffer.from(b64Data, "base64");
    fs.writeFileSync(targetPath, buffer);

    console.log(`[codex-image] ✅ Đã lưu ảnh Codex thành công: ${targetPath} (${(buffer.length / 1024).toFixed(1)} KB)`);

    return {
      success: true,
      filePath: targetPath,
      fileName,
      fileSize: buffer.length,
      translatedPrompt: finalPrompt,
    };
  } catch (err: any) {
    const msg = err?.name === "TimeoutError" ? "Hết thời gian chờ sinh ảnh (Timeout)" : err?.message || String(err);
    console.error("[codex-image] ❌ Lỗi sinh ảnh qua Codex:", err);
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: msg,
    };
  }
}

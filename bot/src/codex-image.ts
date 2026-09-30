import fs from "node:fs";
import path from "node:path";
import { config, hybridAgentSettings } from "./config.js";
import { generateCloudflareImage, isCloudflareConfigured } from "./cloudflare-ai.js";

const GENERATED_IMAGES_DIR = path.resolve(process.cwd(), "data", "generated-images");

export type AspectRatioOption = "16:9" | "9:16" | "4:3" | "3:4" | "1:1";

export interface CodexImageResult {
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;
  error?: string;
  translatedPrompt?: string;
  tierUsed?: string;
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

export interface CodexImageOptions {
  model?: string;
  aspectRatio?: AspectRatioOption;
  timeoutMs?: number;
  /** Image input for Image-to-Image / Editing (Data URL, raw Base64, Buffer, or local file path) */
  image?: string | Buffer | null;
  isEdit?: boolean;
}

/**
 * Chuyển đổi linh hoạt ảnh đầu vào (Buffer, data URL, raw Base64, file path) thành Data URL chuẩn
 */
export function prepareImageDataUrl(image: string | Buffer): string | null {
  if (!image) return null;
  if (Buffer.isBuffer(image)) {
    return `data:image/png;base64,${image.toString("base64")}`;
  }
  if (typeof image === "string") {
    const trimmed = image.trim();
    if (trimmed.startsWith("data:image/")) {
      return trimmed;
    }
    if (fs.existsSync(trimmed)) {
      try {
        const buf = fs.readFileSync(trimmed);
        const ext = path.extname(trimmed).toLowerCase().replace(".", "");
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
        return `data:${mime};base64,${buf.toString("base64")}`;
      } catch (e) {
        console.warn(`[codex-image] Không thể đọc file ảnh từ ${trimmed}:`, e);
      }
    }
    if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 100) {
      return `data:image/png;base64,${trimmed}`;
    }
  }
  return null;
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
  isEdit = false,
): Promise<string> {
  const hasVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(prompt);
  if (!hasVietnamese && prompt.length >= 60 && !isEdit) {
    return prompt.trim();
  }

  const ratioHint = ratio === "16:9" || ratio === "4:3"
    ? "horizontal wide framing"
    : ratio === "9:16" || ratio === "3:4"
      ? "vertical portrait framing"
      : "square framing";

  const systemInstruction = isEdit
    ? "You are an expert prompt engineer for AI image editing (Image-to-Image / GPT Image). " +
      "Given the user's edit instruction (in Vietnamese or English), output an expressive, precise, concise English visual instruction describing what modifications, additions, styling, or background changes to apply to the reference image. " +
      "Preserve the core subject identity and framing unless explicitly requested to alter them. " +
      "Output ONLY the final English edit prompt, without introductory text, quotes, or conversational filler."
    : "You are an expert prompt engineer for AI image generators (DALL-E 3 / GPT Image). " +
      "Given a user description (in Vietnamese or English), output an expressive, high-detail, vivid English visual prompt " +
      `optimized for ${ratioHint}. Describe subjects, lighting, mood, color palette, and composition. ` +
      "Output ONLY the final English prompt, without introductory text, quotes, or conversational filler.";

  try {
    const modelToUse = hybridAgentSettings.nineRouter.groundedModel || "ag/gemini-3.7-flash-high";
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
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
 * Gửi yêu cầu sinh ảnh nhị phân qua cổng OpenAI-compatible của 9Router
 */
async function requestRouterImage(
  model: string,
  prompt: string,
  targetSize: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
  targetPath: string,
  fileName: string,
  imageDataUrl?: string | null,
): Promise<{ success: boolean; filePath: string; fileName: string; fileSize: number; error?: string }> {
  try {
    const payload: Record<string, any> = {
      model,
      prompt,
      size: targetSize,
    };
    if (imageDataUrl) {
      payload.image = imageDataUrl;
    }

    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileSize: 0,
        error: `HTTP ${response.status}: ${errBody.slice(0, 200)}`,
      };
    }

    const resJson = (await response.json()) as any;
    const item = resJson?.data?.[0];
    let b64Data = item?.b64_json;

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
        };
      }
    }

    if (!b64Data) {
      const itemError = item?.error?.message || item?.revised_prompt || resJson?.error?.message;
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileSize: 0,
        error: itemError
          ? `Model không trả về dữ liệu ảnh (phản hồi văn bản/từ chối: "${String(itemError).slice(0, 100)}")`
          : "Thiếu b64_json hoặc url trong dữ liệu ảnh trả về",
      };
    }

    const buffer = Buffer.from(b64Data, "base64");
    fs.writeFileSync(targetPath, buffer);
    return {
      success: true,
      filePath: targetPath,
      fileName,
      fileSize: buffer.length,
    };
  } catch (err: any) {
    const msg = err?.name === "TimeoutError" ? `Hết thời gian chờ (${timeoutMs}ms)` : err?.message || String(err);
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: msg,
    };
  }
}

/**
 * Gửi yêu cầu sinh ảnh hoặc sửa ảnh đa phương thức qua endpoint chat/completions của 9Router
 * Chuyên dùng cho các model Google Gemini (ag/gemini-3.1-flash-image)
 */
async function requestGeminiMultimodalImage(
  model: string,
  prompt: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
  targetPath: string,
  fileName: string,
  imageDataUrl?: string | null,
): Promise<{ success: boolean; filePath: string; fileName: string; fileSize: number; error?: string }> {
  try {
    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    if (imageDataUrl) {
      userContent.push({
        type: "image_url",
        image_url: { url: imageDataUrl },
      });
    }
    userContent.push({
      type: "text",
      text: prompt,
    });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileSize: 0,
        error: `HTTP ${response.status}: ${errBody.slice(0, 200)}`,
      };
    }

    const resJson = (await response.json()) as any;
    const content = resJson?.choices?.[0]?.message?.content || "";

    // Trích xuất Base64 ảnh từ markdown ![image](data:image/...;base64,...)
    const imgMatch = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
    if (!imgMatch || !imgMatch[1]) {
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileSize: 0,
        error: content.slice(0, 200) || "Model Gemini không trả về dữ liệu ảnh",
      };
    }

    const buffer = Buffer.from(imgMatch[1], "base64");
    fs.writeFileSync(targetPath, buffer);
    return {
      success: true,
      filePath: targetPath,
      fileName,
      fileSize: buffer.length,
    };
  } catch (err: any) {
    const msg = err?.name === "TimeoutError" ? `Hết thời gian chờ (${timeoutMs}ms)` : err?.message || String(err);
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: msg,
    };
  }
}

/**
 * Kiểm tra xem Muse Image API đã được cấu hình hay chưa
 */
export function isMuseImageConfigured(): boolean {
  return Boolean(config.museApiKey);
}

/**
 * Gửi yêu cầu sinh ảnh hoặc sửa ảnh qua Muse API (muse2api)
 */
async function requestMuseImage(
  prompt: string,
  targetRatio: AspectRatioOption,
  timeoutMs: number,
  targetPath: string,
  fileName: string,
  imageDataUrl?: string | null,
): Promise<{ success: boolean; filePath: string; fileName: string; fileSize: number; error?: string }> {
  try {
    const baseUrl = config.museApiBaseUrl || "http://127.0.0.1:18610/v1";
    const apiKey = config.museApiKey;
    if (!apiKey) {
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileSize: 0,
        error: "Chưa cấu hình MUSE_API_KEY",
      };
    }

    const endpoint = imageDataUrl ? `${baseUrl}/images/edits` : `${baseUrl}/images/generations`;
    const payload: Record<string, any> = {
      model: "muse-image",
      prompt,
      size: targetRatio,
    };
    if (imageDataUrl) {
      payload.image = imageDataUrl;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileSize: 0,
        error: `HTTP ${response.status}: ${errBody.slice(0, 200)}`,
      };
    }

    const resJson = (await response.json()) as any;
    const item = resJson?.data?.[0];
    let mediaUrl = item?.url;
    let b64Data = item?.b64_json;

    if (!mediaUrl && !b64Data) {
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileSize: 0,
        error: resJson?.error?.message || "Muse API không trả về dữ liệu ảnh",
      };
    }

    let buffer: Buffer;
    if (b64Data) {
      buffer = Buffer.from(b64Data, "base64");
    } else {
      const fullUrl = mediaUrl.startsWith("http")
        ? mediaUrl
        : `${baseUrl.replace(/\/v1\/?$/, "")}${mediaUrl.startsWith("/") ? "" : "/"}${mediaUrl}`;
      const imgFetch = await fetch(fullUrl, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (!imgFetch.ok) {
        return {
          success: false,
          filePath: "",
          fileName: "",
          fileSize: 0,
          error: `Không thể tải ảnh từ Muse URL: ${fullUrl} (HTTP ${imgFetch.status})`,
        };
      }
      const arrayBuf = await imgFetch.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
    }

    // Kiểm tra định dạng nếu là webp thì đổi đuôi file cho chuẩn
    const isWebp = buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
    const actualPath = isWebp && targetPath.endsWith(".png") ? targetPath.replace(/\.png$/, ".webp") : targetPath;
    const actualFileName = isWebp && fileName.endsWith(".png") ? fileName.replace(/\.png$/, ".webp") : fileName;

    fs.writeFileSync(actualPath, buffer);
    return {
      success: true,
      filePath: actualPath,
      fileName: actualFileName,
      fileSize: buffer.length,
    };
  } catch (err: any) {
    const msg = err?.name === "TimeoutError" ? `Hết thời gian chờ Muse (${timeoutMs}ms)` : err?.message || String(err);
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: msg,
    };
  }
}

export type ResolvedImagePreference = "gemini" | "codex" | "muse";

/**
 * Phân cấp nhận diện ý định model vẽ/sửa ảnh:
 * Cấp 1 (Ưu tiên cao nhất): Người dùng chỉ định đích danh engine trong text prompt ("bằng muse", "dùng codex", "dùng gemini")
 * Cấp 2: Chỉ định qua options/tool calling từ LLM (model = "muse" | "codex" | "gemini")
 * Cấp 3: Định tuyến theo phong cách mỹ thuật khi không có chỉ định engine (màu nước/vẽ tay -> Gemini; tả thực/8K -> Codex)
 * Cấp 4: Mặc định Codex (chất lượng cao)
 */
export function resolveImageModelPreference(
  prompt: string,
  explicitModel?: string,
): ResolvedImagePreference {
  const promptLower = prompt.toLowerCase();
  const rawModel = (explicitModel || "").toLowerCase().trim();

  // Cấp 1 (Ưu tiên cao nhất): Người dùng gõ trực tiếp tên engine trong prompt
  const promptHasMuse = /\b(?:muse|muse2api|muse\.ai)\b/i.test(promptLower);
  const promptHasCodex = /\b(?:codex|gpt-image)\b/i.test(promptLower);
  const promptHasGemini = /\b(?:gemini|google\s*image)\b/i.test(promptLower);

  if (promptHasMuse && !promptHasCodex && !promptHasGemini) return "muse";
  if (promptHasCodex && !promptHasGemini && !promptHasMuse) return "codex";
  if (promptHasGemini && !promptHasCodex && !promptHasMuse) return "gemini";

  // Cấp 2: Chỉ định qua options hoặc tool calling
  const optionIsMuse = rawModel === "muse" || rawModel.includes("muse");
  const optionIsCodex = rawModel === "codex" || rawModel.includes("codex") || rawModel.includes("gpt-image");
  const optionIsGemini = rawModel === "gemini" || rawModel.includes("gemini");

  if (optionIsMuse) return "muse";
  if (optionIsCodex && !optionIsGemini) return "codex";
  if (optionIsGemini && !optionIsCodex) return "gemini";

  // Cấp 3: Định tuyến theo phong cách nghệ thuật khi không có tên engine
  const hasArtisticStyle = /\b(?:màu\s*nước|watercolor|vẽ\s*tay|handraw|tranh\s*vẽ)\b/i.test(promptLower);
  const hasRealisticStyle = /\b(?:tả\s*thực|chụp\s*thật|photoreal|8k|render\s*3d)\b/i.test(promptLower);

  if (hasArtisticStyle && !hasRealisticStyle) return "gemini";
  if (hasRealisticStyle && !hasArtisticStyle) return "codex";

  // Cấp 4: Mặc định Codex
  return "codex";
}

/**
 * Chuẩn hóa tên model gọi vào 9Router / Muse:
 * - Các alias "codex", "auto", undefined -> Map sang config.codexImageModel || "cx/gpt-image-2.5"
 * - Alias "gemini" -> Map sang "ag/gemini-3.1-flash-image"
 * - Alias "muse" -> Map sang "muse-image"
 * - Nếu là model ID đầy đủ (bắt đầu bằng "cx/" hoặc "ag/") -> Giữ nguyên model ID đó
 */
export function normalizeImageModelId(
  rawRequestedModel?: string,
): { geminiModel: string; codexModel: string; museModel: string } {
  const defaultCodex = config.codexImageModel || "cx/gpt-image-2.5";
  const defaultGemini = "ag/gemini-3.1-flash-image";
  const defaultMuse = "muse-image";

  const raw = (rawRequestedModel || "").trim();

  let codexModel = defaultCodex;
  let geminiModel = defaultGemini;
  let museModel = defaultMuse;

  if (raw.startsWith("cx/")) {
    codexModel = raw;
  } else if (raw.startsWith("ag/")) {
    geminiModel = raw;
  }

  return { geminiModel, codexModel, museModel };
}

/**
 * Sinh hoặc sửa ảnh chất lượng cao với chuỗi Cascade Fallback đa tầng tự động:
 * - Hỗ trợ cả OpenAI Codex (cx/gpt-image-2.5), Google Gemini (ag/gemini-3.1-flash-image) và Muse AI (muse-image)
 * - Tự động định tuyến thông minh theo yêu cầu người dùng hoặc phong cách vẽ:
 *     + Nhắc đích danh Muse -> Ưu tiên gọi Muse
 *     + Màu nước, vẽ tay -> Ưu tiên Gemini
 *     + Tả thực, 8K hoặc mặc định -> Ưu tiên Codex
 * - Chuỗi Fallback đa tầng (Tier 1 -> Tier 2 -> Tier 3: Muse -> Tier 4: Cloudflare FLUX)
 */
export async function generateCodexImage(
  prompt: string,
  options?: CodexImageOptions,
): Promise<CodexImageResult> {
  const router = hybridAgentSettings.nineRouter;
  const baseUrl = (router.baseUrl || process.env.NINE_ROUTER_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
  const apiKey = router.apiKey || process.env.NINE_ROUTER_API_KEY || "";
  const ratio: AspectRatioOption = options?.aspectRatio || "1:1";
  const timeoutMs = options?.timeoutMs || 90_000;
  const imageDataUrl = options?.image ? prepareImageDataUrl(options.image) : null;
  const isEdit = Boolean(options?.isEdit || imageDataUrl);

  // Nếu không có NINE_ROUTER_API_KEY mà có MUSE_API_KEY thì vẫn có thể chạy qua Muse
  if (!apiKey && !isMuseImageConfigured()) {
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: "Chưa cấu hình NINE_ROUTER_API_KEY hoặc MUSE_API_KEY để gọi Image Generator",
    };
  }

  try {
    ensureImageOutputDir();
    const timestamp = Date.now();
    const randStr = Math.random().toString(36).slice(2, 7);
    const prefix = isEdit ? "edit" : "image";
    const fileName = `${prefix}_${timestamp}_${randStr}.png`;
    const targetPath = path.join(GENERATED_IMAGES_DIR, fileName);

    // 1. Nhận diện ý định model theo thứ bậc ưu tiên (Tên engine > Phong cách mỹ thuật > Mặc định)
    const preferredEngine = resolveImageModelPreference(prompt, options?.model);
    const prefersMuse = preferredEngine === "muse";
    const prefersGemini = preferredEngine === "gemini";
    const prefersCodex = preferredEngine === "codex";

    const { geminiModel, codexModel } = normalizeImageModelId(options?.model);

    // 2. Làm giàu & dịch visual prompt sang tiếng Anh (nếu có 9Router)
    const finalPrompt = apiKey
      ? await enhanceVisualPrompt(prompt, ratio, baseUrl, apiKey, isEdit)
      : prompt.trim();
    const targetSize = mapAspectRatioToSize(ratio);
    const opLabel = isEdit ? "sửa ảnh" : "sinh ảnh";

    // ==========================================
    // NHÁNH A: ƯU TIÊN MUSE (KHI PROMPT HOẶC MODEL CHỈ ĐỊNH ĐÍCH DANH MUSE)
    // ==========================================
    if (prefersMuse && isMuseImageConfigured()) {
      console.log(`[codex-image] 🎨 [Ưu tiên Muse] Đang ${opLabel} với Muse (size: ${ratio}${imageDataUrl ? ", có ảnh tham chiếu" : ""})...`);
      const museTimeout = Math.min(timeoutMs, 65_000);
      const museRes = await requestMuseImage(finalPrompt, ratio, museTimeout, targetPath, fileName, imageDataUrl);
      if (museRes.success) {
        console.log(`[codex-image] ✅ [Muse: muse-image] ${opLabel} thành công: ${museRes.filePath} (${(museRes.fileSize / 1024).toFixed(1)} KB)`);
        return {
          success: true,
          filePath: museRes.filePath,
          fileName: museRes.fileName,
          fileSize: museRes.fileSize,
          translatedPrompt: finalPrompt,
          tierUsed: "Muse (muse-image)",
        };
      }

      console.warn(`[codex-image] ⚠️ [Muse: muse-image] Không thành công: ${museRes.error}. Đang tự động chuyển sang Codex (${codexModel})...`);

      if (apiKey) {
        // Fallback sang Codex
        const codexTimeout = isEdit ? Math.max(timeoutMs, 100_000) : Math.min(timeoutMs, 65_000);
        const codexRes = await requestRouterImage(codexModel, finalPrompt, targetSize, baseUrl, apiKey, codexTimeout, targetPath, fileName, imageDataUrl);
        if (codexRes.success) {
          return {
            success: true,
            filePath: targetPath,
            fileName,
            fileSize: codexRes.fileSize,
            translatedPrompt: finalPrompt,
            tierUsed: `Codex (${codexModel})`,
          };
        }

        // Fallback sang Gemini
        const geminiTimeout = 40_000;
        const geminiRes = isEdit
          ? await requestGeminiMultimodalImage(geminiModel, finalPrompt, baseUrl, apiKey, geminiTimeout, targetPath, fileName, imageDataUrl)
          : await requestRouterImage(geminiModel, finalPrompt, targetSize, baseUrl, apiKey, geminiTimeout, targetPath, fileName);
        if (geminiRes.success) {
          return {
            success: true,
            filePath: targetPath,
            fileName,
            fileSize: geminiRes.fileSize,
            translatedPrompt: finalPrompt,
            tierUsed: `Gemini (${geminiModel})`,
          };
        }
      }
    } else if (prefersGemini && apiKey) {
      // ==========================================
      // NHÁNH B: ƯU TIÊN GOOGLE GEMINI (SIÊU TỐC ~12S / MÀU NƯỚC / VẼ TAY)
      // ==========================================
      console.log(`[codex-image] 🎨 [Ưu tiên Gemini] Đang ${opLabel} với Gemini (${geminiModel}, multimodal: ${Boolean(imageDataUrl)})...`);
      const geminiTimeout = isEdit ? 45_000 : 35_000;
      
      const geminiRes = isEdit
        ? await requestGeminiMultimodalImage(geminiModel, finalPrompt, baseUrl, apiKey, geminiTimeout, targetPath, fileName, imageDataUrl)
        : await requestRouterImage(geminiModel, finalPrompt, targetSize, baseUrl, apiKey, geminiTimeout, targetPath, fileName);

      if (geminiRes.success) {
        console.log(`[codex-image] ✅ [Gemini: ${geminiModel}] ${opLabel} thành công: ${targetPath} (${(geminiRes.fileSize / 1024).toFixed(1)} KB)`);
        return {
          success: true,
          filePath: targetPath,
          fileName,
          fileSize: geminiRes.fileSize,
          translatedPrompt: finalPrompt,
          tierUsed: `Gemini (${geminiModel})`,
        };
      }

      console.warn(`[codex-image] ⚠️ [Gemini: ${geminiModel}] Không thành công: ${geminiRes.error}. Đang tự động chuyển sang Codex (${codexModel})...`);

      // Fallback Tier 2: Codex
      const codexTimeout = isEdit ? Math.max(timeoutMs, 100_000) : Math.min(timeoutMs, 65_000);
      const codexRes = await requestRouterImage(codexModel, finalPrompt, targetSize, baseUrl, apiKey, codexTimeout, targetPath, fileName, imageDataUrl);
      if (codexRes.success) {
        console.log(`[codex-image] ✅ [Dự phòng Codex: ${codexModel}] ${opLabel} thành công: ${targetPath}`);
        return {
          success: true,
          filePath: targetPath,
          fileName,
          fileSize: codexRes.fileSize,
          translatedPrompt: finalPrompt,
          tierUsed: `Codex (${codexModel})`,
        };
      }

      // Fallback Tier 3: Muse Image
      if (isMuseImageConfigured()) {
        console.log(`[codex-image] 🔄 Đang chuyển tiếp sang Tier dự phòng 3 (Muse Image)...`);
        const museTimeout = Math.min(timeoutMs, 65_000);
        const museRes = await requestMuseImage(finalPrompt, ratio, museTimeout, targetPath, fileName, imageDataUrl);
        if (museRes.success) {
          console.log(`[codex-image] ✅ [Dự phòng Muse: muse-image] ${opLabel} thành công: ${museRes.filePath}`);
          return {
            success: true,
            filePath: museRes.filePath,
            fileName: museRes.fileName,
            fileSize: museRes.fileSize,
            translatedPrompt: finalPrompt,
            tierUsed: "Muse (muse-image)",
          };
        }
      }
    } else {
      // ==========================================
      // NHÁNH C: ƯU TIÊN OPENAI CODEX (MẶC ĐỊNH / TẢ THỰC 8K / INPAINTING)
      // ==========================================
      if (apiKey) {
        const codexTag = prefersCodex ? "Ưu tiên Codex" : "Mặc định Codex";
        console.log(`[codex-image] 🎨 [${codexTag}] Đang gửi lệnh ${opLabel} tới Codex (${codexModel}, size: ${targetSize}${imageDataUrl ? ", có ảnh tham chiếu" : ""})...`);
        const codexTimeout = isEdit ? Math.max(timeoutMs, 100_000) : Math.min(timeoutMs, 65_000);
        const codexRes = await requestRouterImage(codexModel, finalPrompt, targetSize, baseUrl, apiKey, codexTimeout, targetPath, fileName, imageDataUrl);

        if (codexRes.success) {
          console.log(`[codex-image] ✅ [Codex: ${codexModel}] ${opLabel} thành công: ${targetPath} (${(codexRes.fileSize / 1024).toFixed(1)} KB)`);
          return {
            success: true,
            filePath: targetPath,
            fileName,
            fileSize: codexRes.fileSize,
            translatedPrompt: finalPrompt,
            tierUsed: `Codex (${codexModel})`,
          };
        }

        console.warn(`[codex-image] ⚠️ [Codex: ${codexModel}] Không thành công: ${codexRes.error}. Đang tự động chuyển sang Gemini (${geminiModel})...`);

        // Fallback Tier 2: Gemini Multimodal
        const geminiTimeout = 40_000;
        const geminiRes = isEdit
          ? await requestGeminiMultimodalImage(geminiModel, finalPrompt, baseUrl, apiKey, geminiTimeout, targetPath, fileName, imageDataUrl)
          : await requestRouterImage(geminiModel, finalPrompt, targetSize, baseUrl, apiKey, geminiTimeout, targetPath, fileName);

        if (geminiRes.success) {
          console.log(`[codex-image] ✅ [Dự phòng Gemini: ${geminiModel}] ${opLabel} thành công: ${targetPath} (${(geminiRes.fileSize / 1024).toFixed(1)} KB)`);
          return {
            success: true,
            filePath: targetPath,
            fileName,
            fileSize: geminiRes.fileSize,
            translatedPrompt: finalPrompt,
            tierUsed: `Gemini (${geminiModel})`,
          };
        }
      }

      // Fallback Tier 3: Muse Image
      if (isMuseImageConfigured()) {
        console.log(`[codex-image] 🔄 Đang chuyển tiếp sang Tier dự phòng 3 (Muse Image)...`);
        const museTimeout = Math.min(timeoutMs, 65_000);
        const museRes = await requestMuseImage(finalPrompt, ratio, museTimeout, targetPath, fileName, imageDataUrl);
        if (museRes.success) {
          console.log(`[codex-image] ✅ [Dự phòng Muse: muse-image] ${opLabel} thành công: ${museRes.filePath}`);
          return {
            success: true,
            filePath: museRes.filePath,
            fileName: museRes.fileName,
            fileSize: museRes.fileSize,
            translatedPrompt: finalPrompt,
            tierUsed: "Muse (muse-image)",
          };
        }
      }
    }

    // ==========================================
    // TẦNG DỰ PHÒNG CUỐI: Cloudflare FLUX.1-schnell (Chỉ cho Text-to-Image)
    // ==========================================
    if (!imageDataUrl && isCloudflareConfigured()) {
      console.log("[codex-image] 🔄 Đang chuyển tiếp sang Tier dự phòng cuối (Cloudflare FLUX)...");
      const cfRes = await generateCloudflareImage(prompt, { aspectRatio: ratio, timeoutMs: 25_000 });
      if (cfRes.success && cfRes.filePath) {
        console.log(`[codex-image] ✅ [Cloudflare FLUX] Dự phòng cuối thành công: ${cfRes.filePath}`);
        return {
          success: true,
          filePath: cfRes.filePath,
          fileName: cfRes.fileName,
          fileSize: cfRes.fileSize,
          translatedPrompt: cfRes.translatedPrompt || finalPrompt,
          tierUsed: "Cloudflare (FLUX.1-schnell)",
        };
      }
    }

    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: `Hệ thống tạo ảnh hiện đang quá tải hoặc gặp sự cố kết nối. Vui lòng thử lại sau ít phút.`,
    };
  } catch (err: any) {
    const msg = err?.name === "TimeoutError" ? "Hết thời gian chờ xử lý ảnh (Timeout)" : err?.message || String(err);
    console.error("[codex-image] ❌ Lỗi tổng quát chuỗi sinh/sửa ảnh:", err);
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: msg,
    };
  }
}

/**
 * Chỉnh sửa ảnh theo yêu cầu bằng Codex (Image-to-Image)
 */
export async function editCodexImage(
  imageInput: string | Buffer,
  editPrompt: string,
  options?: Omit<CodexImageOptions, "image" | "isEdit">,
): Promise<CodexImageResult> {
  return generateCodexImage(editPrompt, {
    ...options,
    image: imageInput,
    isEdit: true,
  });
}

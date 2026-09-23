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
 * Sinh hoặc sửa ảnh chất lượng cao với chuỗi Cascade Fallback 3 tầng tự động:
 * - Tầng 1: Model Codex OpenAI qua 9Router (mặc định cx/gpt-image-2)
 * - Tầng 2: Model Google Gemini qua 9Router (ag/gemini-3.1-flash-image)
 * - Tầng 3: Engine dự phòng cuối Cloudflare FLUX.1-schnell (dành cho tạo mới)
 */
export async function generateCodexImage(
  prompt: string,
  options?: CodexImageOptions,
): Promise<CodexImageResult> {
  const router = hybridAgentSettings.nineRouter;
  const baseUrl = (router.baseUrl || process.env.NINE_ROUTER_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
  const apiKey = router.apiKey || process.env.NINE_ROUTER_API_KEY || "";
  const preferredModel = options?.model?.trim() || config.codexImageModel || "cx/gpt-image-2";
  const ratio: AspectRatioOption = options?.aspectRatio || "1:1";
  const timeoutMs = options?.timeoutMs || 90_000;
  const imageDataUrl = options?.image ? prepareImageDataUrl(options.image) : null;
  const isEdit = Boolean(options?.isEdit || imageDataUrl);

  if (!apiKey) {
    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: "Chưa cấu hình NINE_ROUTER_API_KEY để gọi Image Generator",
    };
  }

  try {
    ensureImageOutputDir();
    const timestamp = Date.now();
    const randStr = Math.random().toString(36).slice(2, 7);
    const prefix = isEdit ? "edit" : "image";
    const fileName = `${prefix}_${timestamp}_${randStr}.png`;
    const targetPath = path.join(GENERATED_IMAGES_DIR, fileName);

    // 1. Làm giàu & dịch visual prompt sang tiếng Anh
    const finalPrompt = await enhanceVisualPrompt(prompt, ratio, baseUrl, apiKey, isEdit);
    const targetSize = mapAspectRatioToSize(ratio);

    // ==========================================
    // TẦNG 1: OpenAI Codex (cx/gpt-image-2)
    // ==========================================
    const tier1Label = isEdit ? "sửa ảnh" : "sinh ảnh";
    console.log(`[codex-image] 🎨 [Tier 1] Đang gửi lệnh ${tier1Label} tới Codex (${preferredModel}, size: ${targetSize}${imageDataUrl ? ", có ảnh tham chiếu" : ""})...`);
    console.log(`[codex-image] 📝 Prompt hoàn chỉnh: "${finalPrompt.slice(0, 150)}..."`);

    // Tầng 1 Timeout:
    // Đối với isEdit (Image-to-Image / inpainting với base64 payload), Codex cx/gpt-image-2
    // thường cần từ 50s - 75s để xử lý. Cần cấp tối thiểu 100.000ms.
    // Đối với text-to-image thông thường, cấp tối thiểu 65.000ms để tránh timeout khi 9router/OpenAI bận.
    const tier1Timeout = isEdit ? Math.max(timeoutMs, 100_000) : Math.min(timeoutMs, 65_000);

    const tier1Res = await requestRouterImage(
      preferredModel,
      finalPrompt,
      targetSize,
      baseUrl,
      apiKey,
      tier1Timeout,
      targetPath,
      fileName,
      imageDataUrl,
    );

    if (tier1Res.success) {
      console.log(`[codex-image] ✅ [Tier 1: ${preferredModel}] ${tier1Label} thành công: ${targetPath} (${(tier1Res.fileSize / 1024).toFixed(1)} KB)`);
      return {
        success: true,
        filePath: targetPath,
        fileName,
        fileSize: tier1Res.fileSize,
        translatedPrompt: finalPrompt,
        tierUsed: `Codex (${preferredModel})`,
      };
    }

    // NẾU LÀ SỬA ẢNH (Image-to-Image):
    // Tuyệt đối KHÔNG fallback sang Gemini Flash Image hay Cloudflare FLUX vì các engine này
    // KHÔNG hỗ trợ inpainting/sửa ảnh gốc, sẽ bị ảo giác sinh ra một bức ảnh người khác hoàn toàn!
    if (isEdit) {
      console.warn(`[codex-image] ⚠️ [Tier 1: ${preferredModel}] Sửa ảnh không thành công: ${tier1Res.error}. Không chuyển tiếp sang Tier 2 vì Gemini Image không hỗ trợ Image-to-Image inpainting.`);
      return {
        success: false,
        filePath: "",
        fileName: "",
        fileSize: 0,
        error: `Codex sửa ảnh không thành công: ${tier1Res.error}`,
      };
    }

    console.warn(`[codex-image] ⚠️ [Tier 1: ${preferredModel}] Không thành công: ${tier1Res.error}. Đang tự động chuyển sang Tier 2 (ag/gemini-3.1-flash-image)...`);

    // ==========================================
    // TẦNG 2: Google Gemini Image (ag/gemini-3.1-flash-image) - Chỉ dùng cho sinh ảnh mới
    // ==========================================
    const tier2Model = "ag/gemini-3.1-flash-image";
    const tier2Res = await requestRouterImage(
      tier2Model,
      finalPrompt,
      targetSize,
      baseUrl,
      apiKey,
      35_000,
      targetPath,
      fileName,
      imageDataUrl,
    );

    if (tier2Res.success) {
      console.log(`[codex-image] ✅ [Tier 2: ${tier2Model}] Dự phòng ${tier1Label} thành công: ${targetPath} (${(tier2Res.fileSize / 1024).toFixed(1)} KB)`);
      return {
        success: true,
        filePath: targetPath,
        fileName,
        fileSize: tier2Res.fileSize,
        translatedPrompt: finalPrompt,
        tierUsed: `Gemini (${tier2Model})`,
      };
    }

    console.warn(`[codex-image] ⚠️ [Tier 2: ${tier2Model}] Không thành công: ${tier2Res.error}.`);

    // ==========================================
    // TẦNG 3: Cloudflare FLUX.1-schnell (Chỉ cho Text-to-Image)
    // ==========================================
    if (!imageDataUrl && isCloudflareConfigured()) {
      console.log("[codex-image] 🔄 Đang chuyển tiếp sang Tier 3 (Cloudflare FLUX)...");
      const cfRes = await generateCloudflareImage(prompt, { aspectRatio: ratio, timeoutMs: 25_000 });
      if (cfRes.success && cfRes.filePath) {
        console.log(`[codex-image] ✅ [Tier 3: Cloudflare FLUX] Dự phòng cuối thành công: ${cfRes.filePath}`);
        return {
          success: true,
          filePath: cfRes.filePath,
          fileName: cfRes.fileName,
          fileSize: cfRes.fileSize,
          translatedPrompt: cfRes.translatedPrompt || finalPrompt,
          tierUsed: "Cloudflare (FLUX.1-schnell)",
        };
      }
      console.warn(`[codex-image] ⚠️ [Tier 3: Cloudflare FLUX] Không thành công: ${cfRes.error}`);
    }

    // Nếu các tầng đều thất bại
    const failReason = `Cả 3 tầng sinh ảnh đều bận (Tier 1: ${tier1Res.error} | Tier 2: ${tier2Res.error})`;

    return {
      success: false,
      filePath: "",
      fileName: "",
      fileSize: 0,
      error: failReason,
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

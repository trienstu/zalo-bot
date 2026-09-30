import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface VideoGeneratorOptions {
  duration?: 5 | 10;
  aspectRatio?: "16:9" | "9:16";
  imageUrl?: string | null;
  timeoutMs?: number;
}

export interface VideoGeneratorResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  error?: string;
  tierUsed?: string;
}

export const GENERATED_VIDEOS_DIR = path.resolve(process.cwd(), "data", "generated-videos");

export function isMuseVideoConfigured(): boolean {
  return Boolean(config.museApiKey);
}

export function ensureVideoOutputDir(): void {
  if (!fs.existsSync(GENERATED_VIDEOS_DIR)) {
    fs.mkdirSync(GENERATED_VIDEOS_DIR, { recursive: true });
  }
}

/**
 * Chuẩn bị hình ảnh đầu vào dạng Data URL (cho Image-to-Video)
 */
export function prepareVideoImageDataUrl(input: string | Buffer | null | undefined): string | null {
  if (!input) return null;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("data:image/")) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (fs.existsSync(trimmed)) {
      try {
        const fileBuf = fs.readFileSync(trimmed);
        const ext = path.extname(trimmed).toLowerCase().replace(".", "");
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
        return `data:${mime};base64,${fileBuf.toString("base64")}`;
      } catch (err) {
        console.warn("[video-generator] Không thể đọc file ảnh tham chiếu:", err);
      }
    }
  } else if (Buffer.isBuffer(input)) {
    return `data:image/png;base64,${input.toString("base64")}`;
  }
  return null;
}

/**
 * Phát hiện loại media dựa trên header magic bytes nhị phân
 */
export function detectMediaTypeFromBuffer(buffer: Buffer): { isVideo: boolean; format: string } {
  if (!buffer || buffer.length < 16) {
    return { isVideo: false, format: "unknown_too_small" };
  }

  // 1. Nhận diện các định dạng ảnh phổ biến (để loại trừ ngay lập tức)
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { isVideo: false, format: "jpeg" };
  }
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { isVideo: false, format: "png" };
  }
  // WebP: RIFF .... WEBP
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { isVideo: false, format: "webp" };
  }
  // GIF: GIF87a / GIF89a
  if (buffer.toString("ascii", 0, 3) === "GIF") {
    return { isVideo: false, format: "gif" };
  }

  // 2. Nhận diện các định dạng video chuẩn
  // MP4 / ISO Base Media File Format: ftyp box ở byte thứ 4..8 (hoặc moov/mdat/skip/wide)
  const boxType = buffer.toString("ascii", 4, 8);
  if (boxType === "ftyp" || boxType === "moov" || boxType === "mdat" || boxType === "skip" || boxType === "wide") {
    return { isVideo: true, format: "mp4" };
  }
  // WebM / MKV: 1A 45 DF A3 (EBML)
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { isVideo: true, format: "webm" };
  }
  // AVI: RIFF .... AVI
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "AVI ") {
    return { isVideo: true, format: "avi" };
  }
  // MPEG transport / program stream
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && (buffer[3] === 0xba || buffer[3] === 0xb3)) {
    return { isVideo: true, format: "mpeg" };
  }

  return { isVideo: false, format: "unknown" };
}

/**
 * Sinh video AI (Text-to-Video hoặc Image-to-Video) qua Muse2API
 */
export async function generateAiVideo(
  prompt: string,
  options?: VideoGeneratorOptions,
): Promise<VideoGeneratorResult> {
  const baseUrl = config.museApiBaseUrl || "http://127.0.0.1:18610/v1";
  const apiKey = config.museApiKey;
  const duration = options?.duration === 10 ? 10 : 5;
  const aspectRatio = options?.aspectRatio === "9:16" ? "9:16" : "16:9";
  const timeoutMs = options?.timeoutMs || 180_000;
  const refImage = prepareVideoImageDataUrl(options?.imageUrl);

  if (!apiKey) {
    return {
      success: false,
      error: "Chưa cấu hình MUSE_API_KEY để gọi Muse Video Generator",
    };
  }

  try {
    ensureVideoOutputDir();
    const timestamp = Date.now();
    const randStr = Math.random().toString(36).slice(2, 7);
    const fileName = `video_${timestamp}_${randStr}.mp4`;
    const targetPath = path.join(GENERATED_VIDEOS_DIR, fileName);

    const body: Record<string, any> = {
      prompt: prompt.trim(),
      duration,
      size: aspectRatio,
    };
    if (refImage) {
      body.image = refImage;
    }

    const opLabel = refImage ? "Image-to-Video" : "Text-to-Video";
    console.log(`[video-generator] 🎬 Đang gửi lệnh tạo video (${opLabel}, duration: ${duration}s, size: ${aspectRatio})...`);

    // 1. Tạo task sinh video
    const createRes = await fetch(`${baseUrl}/videos`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => "");
      return {
        success: false,
        error: `HTTP ${createRes.status} khi tạo video task: ${errText.slice(0, 200)}`,
      };
    }

    const createData = (await createRes.json()) as any;
    const taskId = createData?.id || createData?.task_id;
    if (!taskId) {
      return {
        success: false,
        error: "Không nhận được task_id từ Muse Video Generator",
      };
    }

    console.log(`[video-generator] ⏳ Đã tạo task [${taskId}]. Bắt đầu polling tiến độ...`);

    // 2. Polling trạng thái task cho đến khi hoàn thành hoặc timeout
    const startTime = Date.now();
    let videoUrl = "";

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 4000));

      try {
        const pollRes = await fetch(`${baseUrl}/videos/${taskId}`, {
          method: "GET",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!pollRes.ok) continue;

        const pollData = (await pollRes.json()) as any;
        const status = pollData?.status;
        const progress = pollData?.progress || 0;

        console.log(`[video-generator] 🔄 Task [${taskId}] tiến độ: ${progress}% (status: ${status})`);

        if (status === "completed" || status === "succeeded") {
          // Phòng thủ: Kiểm tra xem engine có trả về nhầm hình ảnh thumbnail không
          if (pollData?.result?.kind === "image") {
            return {
              success: false,
              error: "Engine tạo video trả về tệp hình ảnh thay vì video (vui lòng thử lại)",
            };
          }
          const candidateUrl = pollData?.result?.url || pollData?.url || pollData?.video?.url || "";
          if (/\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(candidateUrl)) {
            return {
              success: false,
              error: "Engine tạo video trả về tệp định dạng ảnh thay vì video",
            };
          }

          videoUrl = candidateUrl;
          break;
        }

        if (status === "failed") {
          return {
            success: false,
            error: pollData?.error || "Task tạo video trên Muse báo lỗi thất bại",
          };
        }
      } catch (pollErr) {
        console.warn(`[video-generator] Lỗi polling task ${taskId}:`, pollErr);
      }
    }

    if (!videoUrl) {
      return {
        success: false,
        error: `Quá thời gian chờ (${Math.round(timeoutMs / 1000)}s) khi tạo video`,
      };
    }

    // 3. Tải file video MP4 về lưu trữ cục bộ
    const fullMediaUrl = videoUrl.startsWith("http") ? videoUrl : `${baseUrl.replace(/\/v1\/?$/, "")}${videoUrl}`;
    const mediaRes = await fetch(fullMediaUrl, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!mediaRes.ok) {
      return {
        success: false,
        error: `Không thể tải file video từ ${fullMediaUrl} (HTTP ${mediaRes.status})`,
      };
    }

    const contentType = mediaRes.headers.get("content-type") || "";
    if (contentType.startsWith("image/")) {
      return {
        success: false,
        error: `Máy chủ trả về loại nội dung hình ảnh (${contentType}) thay vì luồng video`,
      };
    }

    const arrayBuffer = await mediaRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 4. Kiểm tra Magic Bytes nhị phân: Bắt buộc phải là video, không được là ảnh
    const detected = detectMediaTypeFromBuffer(buffer);
    if (!detected.isVideo) {
      return {
        success: false,
        error: `Tệp tải về không phải luồng video hợp lệ (phát hiện định dạng: ${detected.format})`,
      };
    }

    fs.writeFileSync(targetPath, buffer);

    console.log(`[video-generator] ✅ Video đã tạo thành công: ${targetPath} (${(buffer.length / 1024 / 1024).toFixed(2)} MB, format: ${detected.format})`);

    return {
      success: true,
      filePath: targetPath,
      fileName,
      fileSize: buffer.length,
      duration,
      tierUsed: "Muse Video (muse-video)",
    };
  } catch (err: any) {
    const msg = err?.name === "TimeoutError" ? `Hết thời gian chờ (${timeoutMs}ms)` : err?.message || String(err);
    return {
      success: false,
      error: msg,
    };
  }
}

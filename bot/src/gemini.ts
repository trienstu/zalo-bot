import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDocumentOcrCache, saveDocumentOcrCache } from "./db/index.js";
import { config, hybridAgentSettings } from "./config.js";
import {
  webSearch,
  fetchUrl,
  fetchYouTubeContent,
  wikiLookup,
  hnSearch,
  arxivSearch,
  githubSearch,
} from "./tools/vertical-tools.js";
import {
  crawlFacebookEnrichedPost,
  formatFacebookEnrichedPost,
  exportFacebookCommentsToExcel,
} from "./tools/facebook-scraper.js";
import { downloadMediaVideo } from "./tools/video-downloader.js";
import {
  generateWordDoc,
  generateExcelFile,
  generateTextFile,
  generateMarkdownFile,
  generatePowerPointFile,
  generateCsvFile,
  generateHtmlFile,
  parseMarkdownToSlides,
  parseMarkdownToWordBlocks,
  extractAllMarkdownTables,
  type GeneratedFileResult,
  type ThemeName,
} from "./tools/file-generator.js";
import { renderPresentationVideoFromSlides } from "./workers/presentation-video-processor.js";
import { renderDecree30Document } from "./tools/pptmaster-bridge.js";
import {
  synthesizeSpeech,
  synthesizeDialogue,
  isDialogueText,
  normalizeDialogueTurns,
} from "./tools/voice-generator.js";
import { runPythonCode } from "./tools/python-runner.js";
import { generateMusic } from "./tools/music-generator.js";
import { CAVEMAN_INTERNAL_DIRECTIVE } from "./tools/caveman-compressor.js";
import {
  getCryptoTicker,
  getFearAndGreedIndex,
  getFinancialMarketSummary,
} from "./tools/finance-tools.js";
import { fetchWeatherData } from "./weather.js";
import { getSystemTemporalPrompt } from "./temporal.js";
import { callCloudflareLlm, isCloudflareConfigured, generateCloudflareImage } from "./cloudflare-ai.js";
import { generateCodexImage, isCodexImageConfigured, isMuseImageConfigured, prepareImageDataUrl } from "./codex-image.js";
import { generateAiVideo, isMuseVideoConfigured } from "./tools/video-generator.js";
import { incidentTracker } from "./incident-tracker.js";
import {
  canUseGrounding,
  incrementGroundingUsage,
  markGroundingExhausted,
} from "./grounding-quota.js";
import { callVertexGemini, isVertexConfigured } from "./vertex-gemini.js";
import {
  detectAudioMimeType,
  isAudioExtension,
  transcodeAudioWithFfmpeg,
} from "./audio-utils.js";
import { isJxlBuffer, transcodeImageWithFfmpeg } from "./image-utils.js";
import { normalizeZaloMediaUrl } from "./message-extract.js";
import { handleSetReminder } from "./reminder.js";
import { handleSetBirthday, handleListUpcomingBirthdays } from "./birthday-reminder.js";

/**
 * Lớp gọi Google Gemini API dùng chung (Tóm tắt hội thoại Zalo, bóc tách dữ liệu).
 * Hỗ trợ các dòng model Gemini (Gemini 2.5 Flash, Gemini 3.7 Flash, Gemini 3.1 Pro, v.v.).
 */
let botKeyOffset = 0;

import type { GeminiImagePart, GeminiMediaPart } from "./gemini-types.js";
export type { GeminiImagePart, GeminiMediaPart };

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
  if (isJxlBuffer(buffer)) {
    return "image/jxl";
  }

  const cleanHeader = (headerContentType.split(";")[0] || "").trim().toLowerCase();
  if (cleanHeader && cleanHeader !== "application/octet-stream" && cleanHeader !== "binary/octet-stream") {
    return cleanHeader;
  }

  const audioMime = detectAudioMimeType(buffer, fileName);
  if (audioMime) return audioMime;

  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jxl") return "image/jxl";
  if (ext === "pdf") return "application/pdf";
  if (ext === "mp3") return "audio/mp3";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "aac") return "audio/aac";

  return cleanHeader || "application/octet-stream";
}

export async function downloadImageBase64(url: string): Promise<GeminiImagePart | null> {
  try {
    const targetUrl = normalizeZaloMediaUrl(url);
    if (fs.existsSync(targetUrl)) {
      const buffer = fs.readFileSync(targetUrl);
      if (!buffer || buffer.length === 0) return null;
      let mime = detectMimeType(buffer, targetUrl, "");
      let finalBuffer = buffer;
      if (mime === "image/jxl" || !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mime)) {
        try {
          const sharp = (await import("sharp")).default;
          finalBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
          mime = "image/jpeg";
        } catch {
          try {
            const converted = await transcodeImageWithFfmpeg(buffer, "jpeg");
            finalBuffer = Buffer.from(converted.buffer);
            mime = "image/jpeg";
          } catch {
            return null;
          }
        }
      }
      return {
        data: finalBuffer.toString("base64"),
        mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
      };
    }

    const maxRetries = 3;
    let buffer: Buffer = Buffer.alloc(0);
    let contentType = "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(20_000),
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Referer": "https://chat.zalo.me/",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
        });

        if (!res.ok) {
          if ((res.status === 409 || res.status === 404 || res.status >= 500) && attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, attempt * 800));
            continue;
          }
          return null;
        }

        const arrayBuffer = await res.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        contentType = res.headers.get("content-type") || "";

        if (buffer.length === 0 && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 800));
          continue;
        }

        if (buffer.length > 0) break;
      } catch (err) {
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 800));
          continue;
        }
        return null;
      }
    }

    if (!buffer || buffer.length === 0) return null;

    let mime = detectMimeType(buffer, targetUrl, contentType);
    let finalBuffer = buffer;
    if (mime === "image/jxl" || !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mime)) {
      try {
        const sharp = (await import("sharp")).default;
        finalBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
        mime = "image/jpeg";
      } catch {
        try {
          const converted = await transcodeImageWithFfmpeg(buffer, "jpeg");
          finalBuffer = Buffer.from(converted.buffer);
          mime = "image/jpeg";
        } catch {
          return null;
        }
      }
    }

    return {
      data: finalBuffer.toString("base64"),
      mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
    };
  } catch (e) {
    console.warn(`[gemini] Lỗi tải ảnh ${url.slice(0, 80)}: ${String(e)}`);
    return null;
  }
}

export interface DownloadFileResult {
  textContent?: string;
  mediaPart?: GeminiMediaPart;
  audioBuffer?: Buffer;
  imageBuffer?: Buffer;
  ocrText?: string;
  error?: "FILE_TOO_LARGE" | "DOWNLOAD_TIMEOUT" | "DOWNLOAD_FAILED" | "UNSUPPORTED_IMAGE_FORMAT";
  fileSizeBytes?: number;
  unsupportedMime?: string;
  zipFilePath?: string;
  isZip?: boolean;
}

/**
 * Trích xuất toàn bộ văn bản và ghi chú từng trang từ file PowerPoint (.pptx)
 * Hỗ trợ cả slide chứa text thông thường và slide trình chiếu bằng poster/hình ảnh (Picture-Based Presentation)
 */
export async function extractTextFromPptx(buffer: Buffer, fileName = "presentation.pptx"): Promise<string | null> {
  const tempPptxPath = path.join("/tmp", `pptx_extract_${Date.now()}_${Math.random().toString(36).slice(2)}.pptx`);
  const extractDir = path.join("/tmp", `pptx_dir_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  try {
    fs.writeFileSync(tempPptxPath, buffer);
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    // Giải nén toàn bộ file pptx ra thư mục tạm để đọc trực tiếp không bị giới hạn bộ nhớ buffer stdout
    try {
      await execFileAsync("unzip", ["-q", tempPptxPath, "-d", extractDir]);
    } catch (unzipErr) {
      console.warn(`[gemini] Lỗi giải nén PPTX:`, unzipErr);
      return null;
    }

    const slidesDir = path.join(extractDir, "ppt/slides");
    if (!fs.existsSync(slidesDir)) {
      return null;
    }

    const slideFiles = fs.readdirSync(slidesDir).filter((f) => /^slide\d+\.xml$/i.test(f));
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
      return numA - numB;
    });

    if (slideFiles.length === 0) return null;

    interface SlideInfo {
      slideNum: number;
      xmlFile: string;
      textLines: string[];
      notesText: string;
      imageFiles: string[];
      altDescr?: string;
    }

    const slides: SlideInfo[] = [];

    for (const file of slideFiles) {
      const slideNum = parseInt(file.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
      const slideXmlPath = path.join(slidesDir, file);
      let slideXml = "";
      try {
        slideXml = fs.readFileSync(slideXmlPath, "utf-8");
      } catch {
        continue;
      }

      // 1. Digital text
      const textLines = slideXml
        .replace(/<a:p[^>]*>/g, "\n")
        .replace(/<a:br[^>]*\/>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      // 2. Speaker notes
      let notesText = "";
      const notePath = path.join(extractDir, `ppt/notesSlides/notesSlide${slideNum}.xml`);
      if (fs.existsSync(notePath)) {
        try {
          const noteXml = fs.readFileSync(notePath, "utf-8");
          const noteLines = noteXml
            .replace(/<a:p[^>]*>/g, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          if (noteLines.length > 0) {
            notesText = `\n  • [Speaker Notes / Ghi chú]: ${noteLines.join(" | ")}`;
          }
        } catch {}
      }

      // 3. Alt text / descr nếu có
      const descrMatch = slideXml.match(/<p:cNvPr[^>]*descr="([^"]+)"/i);
      const altDescr = descrMatch?.[1] ? descrMatch[1].trim() : undefined;

      // 4. Tìm các hình ảnh liên kết trong slide (qua file .rels)
      const relsPath = path.join(slidesDir, "_rels", `${file}.rels`);
      const imageFiles: string[] = [];
      if (fs.existsSync(relsPath)) {
        try {
          const relsXml = fs.readFileSync(relsPath, "utf-8");
          const imgMatches = [...relsXml.matchAll(/Target="(?:\.\.\/)?media\/([^"]+)"/gi)];
          for (const m of imgMatches) {
            const mediaFileName = m[1];
            if (!mediaFileName) continue;
            const fullImgPath = path.join(extractDir, "ppt/media", mediaFileName);
            if (fs.existsSync(fullImgPath)) {
              imageFiles.push(fullImgPath);
            }
          }
        } catch {}
      }

      slides.push({
        slideNum,
        xmlFile: file,
        textLines,
        notesText,
        imageFiles,
        altDescr,
      });
    }

    // Kiểm tra xem bài thuyết trình có cần OCR ảnh không (Picture-Based Presentation)
    const slidesWithDigitalText = slides.filter((s) => s.textLines.length > 0);
    const isPicturePresentation = slidesWithDigitalText.length === 0 || slidesWithDigitalText.length < slides.length / 2;

    let ocrModule: { ocrImage: (buf: Buffer) => Promise<string> } | null = null;
    if (isPicturePresentation) {
      try {
        ocrModule = await import("./jobs/ocr.js");
      } catch (e) {
        console.warn(`[gemini] Không thể load module OCR cho PPTX:`, e);
      }
    }

    const slideSections: string[] = [];

    // Chọn danh sách slide đại diện để OCR (nếu là bài thuyết trình dạng poster ảnh)
    // Tối đa 8 slides (7 slide đầu + slide cuối cùng) để vừa bao quát trọn vẹn chủ đề lẫn kết luận, vừa tối ưu tốc độ phản hồi (~40s)
    const allowedOcrSlideNums = new Set<number>();
    if (isPicturePresentation) {
      if (slides.length <= 8) {
        for (const s of slides) allowedOcrSlideNums.add(s.slideNum);
      } else {
        for (let i = 0; i < 7; i++) {
          if (slides[i]) allowedOcrSlideNums.add(slides[i]!.slideNum);
        }
        const lastSlide = slides[slides.length - 1];
        if (lastSlide) allowedOcrSlideNums.add(lastSlide.slideNum);
      }
    }

    let ocrCount = 0;

    for (const slide of slides) {
      let content = "";
      if (slide.textLines.length > 0) {
        content = slide.textLines.join("\n");
      }

      // Nếu slide không có digital text hoặc là dạng Picture Presentation, quét OCR ảnh slide
      if ((!content || content.length < 20) && slide.imageFiles.length > 0 && ocrModule && allowedOcrSlideNums.has(slide.slideNum)) {
        try {
          let bestImgPath: string | undefined = slide.imageFiles[0];
          if (slide.imageFiles.length > 1) {
            const sorted = [...slide.imageFiles].sort((a, b) => {
              const sizeA = fs.statSync(a).size;
              const sizeB = fs.statSync(b).size;
              return sizeB - sizeA;
            });
            bestImgPath = sorted[0];
          }

          if (bestImgPath && fs.existsSync(bestImgPath)) {
            const imgBuffer = fs.readFileSync(bestImgPath);
            console.log(`[gemini] 🔍 Đang OCR slide ${slide.slideNum} (${path.basename(bestImgPath)}, ${(imgBuffer.length / 1024).toFixed(0)}KB)...`);
            const ocrText = await ocrModule.ocrImage(imgBuffer);
            ocrCount++;
            if (ocrText && ocrText.trim().length > 0) {
              content = content ? `${content}\n${ocrText.trim()}` : ocrText.trim();
            }
          }
        } catch (ocrErr) {
          console.warn(`[gemini] Lỗi OCR slide ${slide.slideNum}:`, ocrErr);
        }
      }

      if (content || slide.altDescr || slide.notesText) {
        const descrInfo = slide.altDescr && !slide.altDescr.includes(".png") && !slide.altDescr.includes(".jpg")
          ? `\n  • [Mô tả hình ảnh]: ${slide.altDescr}`
          : "";
        slideSections.push(`[SLIDE ${slide.slideNum}]\n${content || "(Slide đồ họa/hình ảnh)"}${descrInfo}${slide.notesText}`);
      }
    }

    if (slideSections.length > 0) {
      const ocrNote = ocrCount > 0
        ? `\n[Hình thức: Bộ slide trình chiếu poster đồ họa, đã OCR trích xuất nội dung từ ${ocrCount}/${slideFiles.length} slide tiêu biểu]\n`
        : "";
      return `=== BÀI THUYẾT TRÌNH POWERPOINT: ${fileName} (${slideFiles.length} SLIDE) ===${ocrNote}\n\n${slideSections.join("\n\n---\n\n")}`;
    }
    return null;
  } catch (err) {
    console.warn(`[gemini] Lỗi trích xuất text từ PPTX:`, err);
    return null;
  } finally {
    try { fs.rmSync(tempPptxPath, { force: true }); } catch {}
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Trích xuất toàn bộ dữ liệu bảng tính từ file Excel (.xlsx)
 */
export async function extractTextFromXlsx(buffer: Buffer, fileName = "sheet.xlsx"): Promise<string | null> {
  try {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    // @ts-expect-error exceljs buffer input
    await workbook.xlsx.load(buffer);

    const sheetSummaries: string[] = [];
    workbook.eachSheet((worksheet) => {
      const rows: string[] = [];
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber > 50) return;
        const values = Array.isArray(row.values)
          ? row.values.slice(1).map((v) => (v !== null && v !== undefined ? String(v).trim() : ""))
          : [];
        if (values.some((v) => v.length > 0)) {
          rows.push(`| ${values.join(" | ")} |`);
        }
      });
      if (rows.length > 0) {
        sheetSummaries.push(`### Sheet: ${worksheet.name} (${worksheet.rowCount} dòng)\n${rows.slice(0, 50).join("\n")}`);
      }
    });

    if (sheetSummaries.length > 0) {
      return `=== TÀI LIỆU BẢNG TÍNH EXCEL: ${fileName} ===\n\n${sheetSummaries.join("\n\n")}`;
    }
    return null;
  } catch (err) {
    console.warn(`[gemini] Lỗi trích xuất text từ Excel .xlsx:`, err);
    return null;
  }
}

/**
 * Tải và giải mã nội dung tài liệu (PDF, Text, Code, CSV, JSON, Audio, Image).
 * Hỗ trợ cả file cục bộ trong ổ cứng lẫn URL tải qua mạng.
 * Giới hạn an toàn 50MB để tránh tràn RAM VPS và timeout.
 */
export async function downloadFileContent(
  url: string,
  fileName = "",
): Promise<DownloadFileResult | null> {
  try {
    let buffer: Buffer = Buffer.alloc(0);
    let contentType = "";
    const targetUrl = normalizeZaloMediaUrl(url);

    // 0. KIỂM TRA BỘ NHỚ ĐỆM THEO URL (CACHE HIT SIÊU TỐC KHÔNG CẦN TẢI FILE)
    const cachedByUrl = getDocumentOcrCache("", targetUrl);
    if (cachedByUrl && cachedByUrl.textContent) {
      console.log(`[gemini] ⚡ [Document Cache HIT - URL] Tìm thấy bản bóc tách văn bản có sẵn cho "${fileName || targetUrl.slice(0, 40)}" (${cachedByUrl.textContent.length.toLocaleString("vi-VN")} ký tự) -> Phản hồi tức thì 0.1s!`);
      return { textContent: cachedByUrl.textContent };
    }

    // 0.1 KIỂM TRA LIÊN KẾT GITHUB REPO -> DÙNG GITHUB DOCUMENT PIPELINE SẠCH
    if (
      /https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+/i.test(targetUrl) &&
      !/\.(png|jpe?g|gif|webp|mp4|zip|pdf|tar\.gz)$/i.test(targetUrl)
    ) {
      try {
        const { fetchGithubCleanDocument } = await import("./github-enricher.js");
        const ghDoc = await fetchGithubCleanDocument(targetUrl);
        if (ghDoc && ghDoc.trim().length > 30) {
          console.log(`[gemini] 🐙 [GitHub Document Pipeline] Đã nạp thành công tài liệu GitHub sạch cho "${targetUrl.slice(0, 60)}" (${ghDoc.length.toLocaleString("vi-VN")} ký tự)`);
          return { textContent: ghDoc };
        }
      } catch (ghErr) {
        console.warn(`[gemini] Không thể nạp tài liệu GitHub qua pipeline chuyên dụng:`, ghErr);
      }
    }

    if (fs.existsSync(targetUrl)) {
      const stats = fs.statSync(targetUrl);
      if (stats.size > 50 * 1024 * 1024) {
        return { error: "FILE_TOO_LARGE", fileSizeBytes: stats.size };
      }
      buffer = fs.readFileSync(targetUrl);
    } else {
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(targetUrl, {
            signal: AbortSignal.timeout(60_000), // 60s timeout cho file tài liệu nặng (20MB-50MB)
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
              "Referer": "https://chat.zalo.me/",
              "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            },
          });

          if (!res.ok) {
            if ((res.status === 409 || res.status === 404 || res.status >= 500) && attempt < maxRetries) {
              await new Promise((r) => setTimeout(r, attempt * 800));
              continue;
            }
            return { error: "DOWNLOAD_FAILED" };
          }

          const contentLengthStr = res.headers.get("content-length");
          const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : 0;
          if (contentLength > 50 * 1024 * 1024) {
            console.warn(`[gemini] File quá lớn: ${(contentLength / 1024 / 1024).toFixed(1)}MB > 50MB`);
            return {
              error: "FILE_TOO_LARGE",
              fileSizeBytes: contentLength,
            };
          }

          const arrayBuffer = await res.arrayBuffer();
          buffer = Buffer.from(arrayBuffer);
          if (buffer.length > 50 * 1024 * 1024) {
            console.warn(`[gemini] File tải về vượt quá 50MB (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
            return {
              error: "FILE_TOO_LARGE",
              fileSizeBytes: buffer.length,
            };
          }
          contentType = (res.headers.get("content-type") || "").toLowerCase();

          // Nếu file vừa upload lên Zalo CDN trả về 0 bytes (chưa kịp đồng bộ storage):
          if (buffer.length === 0 && attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, attempt * 800));
            continue;
          }

          if (buffer.length > 0) {
            break;
          }
        } catch (fetchErr) {
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, attempt * 800));
            continue;
          }
          console.warn(`[gemini] Lỗi tải file sau ${maxRetries} lần thử từ ${url.slice(0, 80)}:`, fetchErr);
          return { error: "DOWNLOAD_FAILED" };
        }
      }

      if (!buffer || buffer.length === 0) {
        console.warn(`[gemini] File tải về rỗng (0 bytes) sau ${maxRetries} lần thử từ ${url.slice(0, 80)}`);
        return { error: "DOWNLOAD_FAILED" };
      }
    }

    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

    // 0.1 KIỂM TRA BỘ NHỚ ĐỆM THEO SHA-256 HASH NỘI DUNG FILE
    const cachedByHash = getDocumentOcrCache(fileHash, targetUrl);
    if (cachedByHash && cachedByHash.textContent) {
      console.log(`[gemini] ⚡ [Document Cache HIT - HASH] Tìm thấy bản bóc tách văn bản có sẵn (${cachedByHash.textContent.length.toLocaleString("vi-VN")} ký tự, SHA256: ${fileHash.slice(0, 10)}...) -> Phản hồi tức thì 0.1s!`);
      return { textContent: cachedByHash.textContent };
    }

    const detectedMime = detectMimeType(buffer, fileName || url, contentType);
    const ext = (fileName.split(".").pop() || url.split(".").pop() || "").toLowerCase();

    // 1. File PDF: 3-Tier Adaptive Document Pipeline
    if (detectedMime === "application/pdf" || ext === "pdf") {
      let totalPages = 1;
      let extractedDigitalText = "";

      // TIER 0: Trích xuất Text kỹ thuật số siêu tốc bằng unpdf (0.1s, 0 token, 0 network)
      try {
        const { extractText } = await import("unpdf");
        // Dùng buffer.slice() để copy vì unpdf (pdfjs-dist) detach/transfer ArrayBuffer khi parse
        const uint8 = new Uint8Array(buffer.slice());
        const pdfResult = await extractText(uint8, { mergePages: true });
        totalPages = pdfResult?.totalPages || 1;
        extractedDigitalText = (pdfResult?.text || "").trim();
        if (extractedDigitalText.length >= 50) {
          saveDocumentOcrCache(fileHash, targetUrl, fileName || "tai_lieu.pdf", extractedDigitalText, totalPages);
          console.log(`[gemini] 📄 [Tier 0 - Digital PDF] Đã trích xuất ${extractedDigitalText.length.toLocaleString("vi-VN")} ký tự văn bản từ PDF "${fileName || "tài liệu"}" (${totalPages} trang)`);
          return { textContent: extractedDigitalText };
        }
      } catch (pdfErr) {
        console.warn(`[gemini] Không thể trích xuất text từ PDF bằng unpdf:`, pdfErr);
      }

      // TIER 1: File scan nhẹ (<= 3 trang VÀ <= 3MB) -> Gửi Multimodal trực tiếp sang Gemini Native API
      if (buffer.length <= 3 * 1024 * 1024 && totalPages <= 3) {
        console.log(`[gemini] 📄 [Tier 1 - Light PDF Scan] File nhẹ (${(buffer.length / 1024 / 1024).toFixed(1)}MB, ${totalPages} trang), gửi Multimodal sang Gemini Native API`);
        return {
          mediaPart: {
            data: buffer.toString("base64"),
            mimeType: "application/pdf",
          },
        };
      }

      // TIER 2: File scan nặng (> 3 trang HOẶC > 3MB, tối đa 50MB) -> Cắt trang pdftoppm + Song song OCR qua 9Router / Gemini Vision
      console.log(`[gemini] 📄 [Tier 2 - Heavy PDF Scan] Phát hiện file scan ${totalPages} trang (${(buffer.length / 1024 / 1024).toFixed(1)}MB), kích hoạt pipeline cắt trang & OCR song song...`);
      try {
        const ocrText = await extractScannedPdfWithOcr(buffer, fileName || "tai_lieu.pdf", 25);
        if (ocrText && ocrText.trim().length >= 50) {
          saveDocumentOcrCache(fileHash, targetUrl, fileName || "tai_lieu.pdf", ocrText, totalPages);
          console.log(`[gemini] 📄 [Tier 2 - Heavy PDF Scan] Đã OCR thành công ${ocrText.length.toLocaleString("vi-VN")} ký tự văn bản từ "${fileName || "tài liệu"}"`);
          return { textContent: ocrText };
        }
      } catch (tier2Err) {
        console.warn(`[gemini] Lỗi Tier 2 OCR cho PDF "${fileName}":`, tier2Err);
      }

      // Fallback cuối cùng nếu Tier 2 không khả dụng (ví dụ môi trường thiếu pdftoppm) và file <= 15MB:
      if (buffer.length > 50 && buffer.length <= 15 * 1024 * 1024) {
        console.log(`[gemini] 📄 [Tier 2 Fallback] Gửi Multimodal native cho PDF "${fileName}" (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
        return {
          mediaPart: {
            data: buffer.toString("base64"),
            mimeType: "application/pdf",
          },
        };
      } else if (buffer.length > 15 * 1024 * 1024) {
        console.warn(`[gemini] File PDF scan không có text layer và quá nặng (${(buffer.length / 1024 / 1024).toFixed(1)}MB > 15MB)`);
        return {
          textContent: `[File PDF scan dạng ảnh "${fileName || "tài liệu"}" nặng ${(buffer.length / 1024 / 1024).toFixed(1)}MB, không chứa lớp văn bản và vượt quá giới hạn xử lý. Vui lòng gửi file nhẹ hơn hoặc gửi ảnh từng trang để bot đọc.]`,
        };
      }
    }

    const isPkZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
    const isPptx = ext === "pptx" || (isPkZip && (buffer.includes(Buffer.from("ppt/presentation.xml")) || buffer.includes(Buffer.from("ppt/slides/"))));
    const isDocx = ext === "docx" || detectedMime.includes("wordprocessingml") || (isPkZip && buffer.includes(Buffer.from("word/document.xml")));
    const isXlsx = ext === "xlsx" || detectedMime.includes("spreadsheetml") || (isPkZip && (buffer.includes(Buffer.from("xl/workbook.xml")) || buffer.includes(Buffer.from("xl/worksheets/"))));

    // 1.4 File PowerPoint (.pptx): Bóc tách toàn bộ slide, tiêu đề, bullet points & Speaker Notes
    if (isPptx) {
      const pptxText = await extractTextFromPptx(buffer, fileName || "presentation.pptx");
      if (pptxText && pptxText.trim().length >= 10) {
        saveDocumentOcrCache(fileHash, targetUrl, fileName || "presentation.pptx", pptxText, 1);
        console.log(`[gemini] 📊 Đã trích xuất ${pptxText.length.toLocaleString("vi-VN")} ký tự văn bản từ PowerPoint .pptx "${fileName || "tài liệu"}"`);
        return { textContent: pptxText };
      }
    }

    // 1.5 File Word (.docx): Bóc tách toàn bộ Text từ word/document.xml
    if (isDocx) {
      try {
        const tempDocxPath = path.join("/tmp", `docx_extract_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`);
        fs.writeFileSync(tempDocxPath, buffer);
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync("unzip", ["-p", tempDocxPath, "word/document.xml"]);
        try { fs.unlinkSync(tempDocxPath); } catch {}

        if (stdout) {
          const extractedDocx = stdout
            .replace(/<w:p[^>]*>/g, "\n")
            .replace(/<w:tab[^>]*\/>/g, "\t")
            .replace(/<w:br[^>]*\/>/g, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          if (extractedDocx.length >= 20) {
            saveDocumentOcrCache(fileHash, targetUrl, fileName || "tai_lieu.docx", extractedDocx, 1);
            console.log(`[gemini] 📄 Đã trích xuất ${extractedDocx.length.toLocaleString("vi-VN")} ký tự văn bản từ Word .docx "${fileName || "tài liệu"}"`);
            return { textContent: extractedDocx };
          }
        }
      } catch (docxErr) {
        console.warn(`[gemini] Lỗi trích xuất text từ Word .docx:`, docxErr);
      }
    }

    // 1.55 File Excel (.xlsx): Bóc tách dữ liệu các Sheet thành bảng Markdown
    if (isXlsx) {
      const xlsxText = await extractTextFromXlsx(buffer, fileName || "sheet.xlsx");
      if (xlsxText && xlsxText.trim().length >= 10) {
        saveDocumentOcrCache(fileHash, targetUrl, fileName || "sheet.xlsx", xlsxText, 1);
        console.log(`[gemini] 📈 Đã trích xuất ${xlsxText.length.toLocaleString("vi-VN")} ký tự bảng tính từ Excel .xlsx "${fileName || "tài liệu"}"`);
        return { textContent: xlsxText };
      }
    }

    // 1.6 File nén Archive (ZIP, RAR, 7Z, TAR...): Chỉ áp dụng cho file nén thực sự (không phải Office OpenXML)
    const isZip =
      ext === "zip" ||
      ext === "rar" ||
      ext === "7z" ||
      ext === "tar" ||
      ext === "gz" ||
      ext === "bz2" ||
      ((detectedMime.includes("zip") || isPkZip) && !isPptx && !isDocx && !isXlsx) ||
      (detectedMime.includes("compressed") || detectedMime.includes("tar") || detectedMime.includes("rar") || detectedMime.includes("7z"));

    if (isZip) {
      const cleanSafeName = (fileName || "archive.zip").replace(/[^a-zA-Z0-9._-]/g, "_");
      const tempZipPath = path.join("/tmp", `zalo_upload_${Date.now()}_${cleanSafeName}`);
      fs.writeFileSync(tempZipPath, buffer);
      console.log(`[gemini] 📦 Đã tải và lưu file nén: ${tempZipPath} (${Math.round(buffer.length / 1024)} KB)`);
      return {
        isZip: true,
        zipFilePath: tempZipPath,
        fileSizeBytes: buffer.length,
      };
    }

    // 2. File Hình ảnh (Gemini đọc Multimodal native)
    if (detectedMime.startsWith("image/") || isJxlBuffer(buffer)) {
      const geminiSupportedImageMimes = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
      ]);

      if (geminiSupportedImageMimes.has(detectedMime) && !isJxlBuffer(buffer)) {
        return {
          mediaPart: {
            data: buffer.toString("base64"),
            mimeType: detectedMime,
          },
          imageBuffer: buffer,
        };
      }

      // Thử dùng sharp convert các định dạng ảnh khác (bmp, gif, tiff, svg) sang standard JPEG
      try {
        const sharp = (await import("sharp")).default;
        const converted = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
        console.log(`[gemini] 🔄 Đã chuyển đổi định dạng ảnh ${detectedMime} sang image/jpeg (${Math.round(converted.length / 1024)} KB)`);
        return {
          mediaPart: {
            data: converted.toString("base64"),
            mimeType: "image/jpeg",
          },
          imageBuffer: converted,
        };
      } catch (convErr) {
        // Fallback sang ffmpeg (đặc biệt giải mã chuẩn xác định dạng JPEG XL / image/jxl)
        try {
          console.log(`[gemini] 🔄 Sharp không hỗ trợ giải mã ${detectedMime}, thử giải mã qua ffmpeg...`);
          const ffmpegRes = await transcodeImageWithFfmpeg(buffer, "jpeg");
          console.log(`[gemini] ✅ Đã chuyển đổi thành công ảnh ${detectedMime} sang image/jpeg bằng ffmpeg (${Math.round(ffmpegRes.buffer.length / 1024)} KB)`);
          return {
            mediaPart: {
              data: ffmpegRes.buffer.toString("base64"),
              mimeType: "image/jpeg",
            },
            imageBuffer: ffmpegRes.buffer,
          };
        } catch (ffmpegErr) {
          console.warn(`[gemini] Định dạng ảnh ${detectedMime} không hỗ trợ và không thể convert sang JPEG (sharp & ffmpeg):`, convErr, ffmpegErr);
          return {
            error: "UNSUPPORTED_IMAGE_FORMAT",
            unsupportedMime: detectedMime,
            textContent: `[Ảnh đính kèm có định dạng "${detectedMime}" hiện chưa được AI hỗ trợ giải mã. Vui lòng chụp lại màn hình hoặc lưu ảnh dạng JPG/PNG để bot phân tích nhé!]`,
          };
        }
      }
    }

    // 2. File Âm thanh / Voice (Mở rộng hỗ trợ WMA, FLAC, AMR, WAV, MP3, M4A, OGG...)
    const audioMime = detectAudioMimeType(buffer, fileName || url);
    const isAudio = Boolean(audioMime) || detectedMime.startsWith("audio/") || isAudioExtension(ext);
    if (isAudio) {
      let finalAudioBuffer = buffer;
      let finalMime = audioMime || (detectedMime.startsWith("audio/") ? detectedMime : "audio/mp3");

      // Nếu là WMA, AMR hoặc các định dạng AI không đọc trực tiếp được, tự động chuyển đổi sang MP3 chuẩn
      if (ext === "wma" || ext === "amr" || finalMime.includes("wma") || finalMime.includes("amr")) {
        try {
          console.log(`[gemini] 🔄 Đang tự động convert file âm thanh [${fileName || ext}] sang MP3 bằng ffmpeg...`);
          const converted = await transcodeAudioWithFfmpeg(buffer, "mp3");
          finalAudioBuffer = converted.buffer;
          finalMime = converted.mimeType;
          console.log(`[gemini] ✅ Đã convert thành công sang ${finalMime} (${finalAudioBuffer.length} bytes)`);
        } catch (convErr) {
          console.warn(`[gemini] Lỗi convert audio [${fileName}]:`, convErr);
        }
      }

      return {
        mediaPart: {
          data: finalAudioBuffer.toString("base64"),
          mimeType: finalMime.startsWith("audio/") ? finalMime : "audio/mp3",
        },
        audioBuffer: finalAudioBuffer,
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
    if (buffer.length > 0 && buffer.length < 5 * 1024 * 1024) {
      const text = buffer.toString("utf-8");
      if (text.trim().length > 0 && !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1000))) {
        return { textContent: text };
      }
    }

    // Nếu vẫn là ảnh/video/audio (định dạng chưa phổ biến) thì mới gửi mediaPart cho Gemini
    if (detectedMime && (detectedMime.startsWith("image/") || detectedMime.startsWith("video/") || detectedMime.startsWith("audio/"))) {
      return {
        mediaPart: {
          data: buffer.toString("base64"),
          mimeType: detectedMime,
        },
      };
    }

    return null;
  } catch (e: any) {
    console.warn(`[gemini] Lỗi đọc file/ảnh ${url.slice(0, 80)}: ${String(e)}`);
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { error: "DOWNLOAD_TIMEOUT" };
    }
    return { error: "DOWNLOAD_FAILED" };
  }
}

import { isJunkOrBettingDomain, extractPublisherName } from "./publisher-utils.js";
export { isJunkOrBettingDomain, extractPublisherName };

/**
 * Gọi mô hình qua cổng 9Router (OpenAI-compatible endpoint).
 * Hỗ trợ các dòng mô hình Antigravity (ag/) như ag/gemini-3.7-flash-medium, ag/gemini-3.8-flash,
 * các dòng Codex (cx/) như cx/gpt-5.6-sol, có hỗ trợ text, JSON, và Vision (ảnh base64).
 */
export async function call9Router(
  system: string,
  user: string,
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    json?: boolean;
    images?: GeminiImagePart[];
    mediaParts?: GeminiMediaPart[];
    timeoutMs?: number;
  },
): Promise<string | null> {
  const router = hybridAgentSettings?.nineRouter;
  if (!router?.enabled || !router.apiKey) return null;

  // Nếu có mediaPart là application/pdf, 9Router (OpenAI-compatible) sẽ lỗi HTTP 400 vì image_url không hỗ trợ PDF
  const hasPdfMedia = options?.mediaParts?.some(
    (m) => m.mimeType === "application/pdf" || m.mimeType?.includes("pdf")
  );
  if (hasPdfMedia) {
    console.log("[gemini] 📄 Phát hiện file PDF trong mediaParts, bỏ qua 9Router để dùng Google Gemini native API...");
    return null;
  }

  const baseUrl = (router.baseUrl || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
  const targetModel = options?.model || router.chatModel || "ag/gemini-3.8-flash-low";
  const timeoutMs = options?.timeoutMs || router.timeoutMs || 90_000;

  const allMedia = [...(options?.images || []), ...(options?.mediaParts || [])];
  const userContent: Array<Record<string, unknown>> = [];

  if (allMedia.length > 0) {
    userContent.push({ type: "text", text: user });
    for (const media of allMedia) {
      const mime = media.mimeType || "image/jpeg";
      const dataUrl = `data:${mime};base64,${media.data}`;
      userContent.push({
        type: "image_url",
        image_url: { url: dataUrl },
      });
    }
  }

  const messages: Array<{ role: string; content: any }> = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({
    role: "user",
    content: allMedia.length > 0 ? userContent : user,
  });

  const requestBody: Record<string, unknown> = {
    model: targetModel,
    messages,
    stream: false,
    temperature: options?.temperature ?? 0.3,
    ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
    ...(options?.json ? { response_format: { type: "json_object" } } : {}),
  };

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${router.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(`[9router] HTTP ${resp.status} (${targetModel}): ${errText.slice(0, 200)}`);
      return null;
    }

    const data = (await resp.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim();
    if (content) {
      console.log(`[9router] ✅ Phản hồi thành công từ model ${targetModel}!`);
      return content;
    }
  } catch (err) {
    console.warn(`[9router] Exception khi gọi model ${targetModel}:`, err);
  }

  return null;
}

export async function callGemini(
  system: string,
  user: string,
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    json?: boolean;
    images?: GeminiImagePart[];
    mediaParts?: GeminiMediaPart[];
    enableSearch?: boolean;
  },
): Promise<string> {
  const rawKey = (process.env.GEMINI_API_KEY || config.geminiApiKey || "").trim();
  let apiKeys = rawKey.split(",").map((k) => k.trim()).filter(Boolean);

  const groundingKey = (process.env.GEMINI_GROUNDING_API_KEY || config.geminiGroundingApiKey || "").trim();

  const isSearchRequested = Boolean(options?.enableSearch);
  const isSearchEnabled = isSearchRequested && canUseGrounding();

  // NẾU LÀ YÊU CẦU GOOGLE SEARCH GROUNDING:
  // Đưa key billing lên đầu tiên để ưu tiên search 1500 lượt/ngày; các key khác làm dự phòng nếu key billing có sự cố
  if (isSearchEnabled && groundingKey) {
    apiKeys = [groundingKey, ...apiKeys.filter((k) => k !== groundingKey)];
  }

  const allMedia = [...(options?.images || []), ...(options?.mediaParts || [])];
  const hasMedia = allMedia.length > 0;
  const hasPdfMedia = options?.mediaParts?.some(
    (m) => m.mimeType === "application/pdf" || m.mimeType?.includes("pdf")
  );

  let primaryModel = options?.model?.trim() || config.geminiModel || "ag/gemini-3.8-flash-low";
  if (isSearchEnabled) {
    primaryModel = "gemini-3-flash-preview";
  } else if (hasPdfMedia) {
    primaryModel = "gemini-flash-latest";
  } else if (hasMedia && primaryModel.includes("lite")) {
    primaryModel = config.geminiModel || "ag/gemini-3.8-flash-low";
  }

  const effectiveSystemBase = system?.includes("SYSTEM TEMPORAL ANCHOR")
    ? system
    : (system ? `${getSystemTemporalPrompt()}\n\n${system}` : getSystemTemporalPrompt());

  const searchSystemGuard = isSearchEnabled
    ? `\n\n=== CHỈ THỊ AN TOÀN NGUỒN TIN TÌM KIẾM (SEARCH GROUNDING HYGIENE) ===\n` +
      `- CHỈ ĐƯỢC trích xuất dữ liệu từ các cơ quan báo chí chính thống, cổng thông tin chính thức của giải đấu/tổ chức, hoặc các nguồn uy tín (Bongdaplus, 24h, VnExpress, Tuổi Trẻ, LaLiga, UEFA, FIFA, Báo Đầu Tư, Dân Trí, v.v.).\n` +
      `- TUYỆT ĐỐI BỎ QUA và KHÔNG sử dụng thông tin hay trích dẫn từ các website cá độ bóng đá, web xem bóng đá lậu (như Xoilac, Mitom, Thapcam, VeBo...), web spam SEO clickbait. Nếu dữ liệu chỉ xuất hiện từ các trang này, hãy xem như chưa có thông tin chính thức.\n`
    : "";

  const effectiveSystem = effectiveSystemBase + searchSystemGuard;
  const temperature = options?.temperature ?? 0.3;
  const maxTokens = options?.maxTokens;

  // Tầng 1 & 2: Ưu tiên 9Router (Tầng 1: primaryModel -> Tầng 2: ag/gemini-3.7-flash-high)
  if (hybridAgentSettings?.nineRouter?.enabled && hybridAgentSettings.nineRouter.apiKey && !isSearchEnabled && !hasPdfMedia) {
    const primaryRouterModel = (primaryModel.startsWith("ag/") || primaryModel.startsWith("cx/"))
      ? primaryModel
      : (hybridAgentSettings.nineRouter.chatModel || "ag/gemini-3.8-flash-low");
    try {
      console.log(`[gemini] 🧠 Ưu tiên sử dụng 9Router siêu tốc (Tầng 1): ${primaryRouterModel}`);
      const routerRes = await call9Router(effectiveSystem, user, {
        model: primaryRouterModel,
        maxTokens,
        temperature,
        json: options?.json,
        images: options?.images,
        mediaParts: options?.mediaParts,
      });
      if (routerRes) return routerRes;
      console.warn(`[gemini] 9Router Tầng 1 (${primaryRouterModel}) không trả về kết quả, chuyển sang Tầng 2 dự phòng...`);
    } catch (rErr) {
      console.warn(`[gemini] Lỗi gọi 9Router Tầng 1 (${primaryRouterModel}):`, rErr);
    }

    // Tầng 2 dự phòng: ag/gemini-3.7-flash-high trên 9Router
    const secondaryRouterModel = "ag/gemini-3.7-flash-high";
    if (primaryRouterModel !== secondaryRouterModel) {
      try {
        console.log(`[gemini] 🔄 9Router kích hoạt model dự phòng Tầng 2: ${secondaryRouterModel}`);
        const secRes = await call9Router(effectiveSystem, user, {
          model: secondaryRouterModel,
          maxTokens,
          temperature,
          json: options?.json,
          images: options?.images,
          mediaParts: options?.mediaParts,
        });
        if (secRes) return secRes;
        console.warn(`[gemini] 9Router Tầng 2 (${secondaryRouterModel}) không trả về kết quả, tiếp tục chuyển sang Tầng 3...`);
      } catch (secErr) {
        console.warn(`[gemini] Lỗi gọi 9Router Tầng 2 (${secondaryRouterModel}):`, secErr);
      }
    }
  }

  if (apiKeys.length === 0) {
    if (hybridAgentSettings?.nineRouter?.enabled && hybridAgentSettings.nineRouter.apiKey && !hasPdfMedia) {
      const fallbackRes = await call9Router(effectiveSystem, user, {
        model: "ag/gemini-3.7-flash-high",
        maxTokens,
        temperature,
        json: options?.json,
        images: options?.images,
        mediaParts: options?.mediaParts,
      });
      if (fallbackRes) return fallbackRes;
    }
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  // Tầng 3 (Google AI Studio Native): Ưu tiên số 1 là gemini-3.6-flash (model duy nhất hoạt động 100% không bị 503/429)
  // Chuẩn hóa model gọi Google API: nếu là prefix 9router (ag/, cx/) hoặc các model bị bão quá tải/404, đổi ngay sang gemini-3.6-flash
  const effectiveGooglePrimary = (primaryModel.startsWith("ag/") || primaryModel.startsWith("cx/") || primaryModel.includes("3.7") || primaryModel.includes("3.8") || primaryModel.includes("latest") || primaryModel.includes("2.5") || primaryModel.includes("2.0"))
    ? "gemini-3.6-flash"
    : primaryModel;

  const candidateFallbacks = [
    "gemini-3.6-flash",
    "gemini-3.1-flash-lite-preview",
  ].filter((m) => m !== effectiveGooglePrimary);

  let lastError: unknown;
  const numKeys = apiKeys.length;

  const userParts: Record<string, unknown>[] = [];
  if (allMedia.length > 0) {
    for (const img of allMedia) {
      if (img.data && img.data.trim().length > 50) {
        userParts.push({
          inline_data: {
            mime_type: img.mimeType || "image/jpeg",
            data: img.data,
          },
        });
      }
    }
  }
  userParts.push({ text: user });

  // 🌐 NẾU CẦN SEARCH GROUNDING & VERTEX AI ĐÃ CẤU HÌNH:
  // Chỉ dùng Vertex AI khi cần Google Search Grounding để hưởng 1.500 lượt search miễn phí/ngày và trừ vào $300 credit.
  // Khi chat thường hoặc tóm tắt (không search), bot tiếp tục dùng các key cũ hoàn toàn miễn phí.
  if (isSearchEnabled && isVertexConfigured()) {
    try {
      const vertexRes = await callVertexGemini(user, {
        model: config.vertexModel || "gemini-2.0-flash",
        systemInstruction: effectiveSystem,
        temperature,
        maxTokens,
        search: true,
        images: allMedia,
      });
      if (vertexRes && vertexRes.trim().length > 0) {
        return vertexRes;
      }
      console.warn("[gemini] Vertex AI không trả về kết quả, fallback sang AI Studio / RSS");
    } catch (vErr) {
      console.warn("[gemini] Lỗi gọi Vertex AI, fallback sang AI Studio / RSS:", vErr);
    }
  }

  // Thử lần lượt qua từng API Key nếu có nhiều key (Xoay vòng chống 429 Rate Limit)
  for (let attempt = 0; attempt < numKeys; attempt += 1) {
    const keyIdx = (botKeyOffset + attempt) % numKeys;
    const apiKey = apiKeys[keyIdx];

    const requestBody: Record<string, unknown> = {
      system_instruction: effectiveSystem ? { parts: [{ text: effectiveSystem }] } : undefined,
      contents: [
        {
          role: "user",
          parts: userParts,
        },
      ],
      ...(isSearchEnabled ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: {
        temperature,
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        ...(options?.json ? { responseMimeType: "application/json" } : {}),
      },
    };

    const executeModel = async (targetModel: string, timeoutMs: number): Promise<string | null> => {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
      let resp = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      // Nếu yêu cầu Google Search Grounding bị lỗi 429 (vượt hạn mức / chưa có billing), tự động fallback gọi không có grounding tool
      if (!resp.ok && isSearchEnabled && resp.status === 429) {
        markGroundingExhausted("Google API trả về HTTP 429 (Hết lượt Grounding)");
        delete requestBody.tools;
        const retryResp = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        if (retryResp.ok) {
          resp = retryResp;
        }
      }

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.warn(`[gemini] Key #${keyIdx + 1} (${targetModel}) gặp HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        lastError = new Error(`Gemini API (${targetModel}) HTTP ${resp.status}: ${errText.slice(0, 300)}`);
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
      let content = candidate?.content?.parts?.map((p: { text?: string }) => p.text || "").join("").trim();
      if (!content) {
        lastError = new Error(`Response Gemini API (${targetModel}) rỗng`);
        return null;
      }

      // 🌐 NẾU CÓ KẾT QUẢ GOOGLE SEARCH GROUNDING:
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
        if (candidate.groundingMetadata.webSearchQueries?.length) {
          console.log(`[gemini] 🌐 Google Search Grounding: queries=${JSON.stringify(candidate.groundingMetadata.webSearchQueries)}, sources=${sources.join(", ")}`);
        }
      }

      return content;
    };

    // 1. Thử model chính (primaryModel hoặc effectiveGooglePrimary, 45s khi có file/media nặng, 20s khi có Search Grounding, 8s cho chat thường)
    try {
      const primaryTimeout = isSearchEnabled ? 20_000 : (hasMedia ? 45_000 : 8_000);
      const primaryRes = await executeModel(effectiveGooglePrimary, primaryTimeout);
      if (primaryRes) {
        botKeyOffset = (keyIdx + 1) % numKeys;
        return primaryRes;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[gemini] Lỗi gọi model chính ${effectiveGooglePrimary} (Key #${keyIdx + 1}): ${String(err)}`);
    }

    // 2. Tự động cascading fallback nếu primaryModel nghẽn hoặc lỗi
    for (const fbModel of candidateFallbacks) {
      try {
        console.log(`[gemini] ⚡ Model chính gặp lỗi/nghẽn, tự động chuyển sang model dự phòng: ${fbModel}...`);
        delete requestBody.tools; // Gỡ bỏ tool search vì các model lite không hỗ trợ google_search
        const fbTimeout = hasMedia ? 35_000 : 6_000;
        const fbRes = await executeModel(fbModel, fbTimeout);
        if (fbRes) {
          console.log(`[gemini] ✅ Đã phản hồi thành công qua fallback model ${fbModel}!`);
          botKeyOffset = (keyIdx + 1) % numKeys;
          return fbRes;
        }
      } catch (fbErr) {
        console.warn(`[gemini] Fallback ${fbModel} cũng gặp lỗi: ${String(fbErr)}`);
      }
    }

    // Circuit Breaker: nếu 2 key liên tiếp đều thất bại vì 503/429, ngắt ngay vòng lặp để rơi xuống tầng vệ tinh
    if (attempt >= 1) {
      console.warn(`[gemini] ⚡ Google AI Studio gặp bão 503/429 trên các key liên tiếp, kích hoạt Circuit Breaker chuyển ngay sang tầng vệ tinh...`);
      break;
    }
  }

  // Fallback qua cổng 9Router (trừ khi có file PDF vì 9Router không hỗ trợ application/pdf qua image_url)
  if (hybridAgentSettings?.nineRouter?.enabled && hybridAgentSettings.nineRouter.apiKey && !hasPdfMedia) {
    try {
      const fallback9RouterModel = "ag/gemini-3.7-flash-high";
      console.log(`[gemini] 🚀 Google API gặp sự cố, kích hoạt tầng dự phòng cao cấp qua 9Router (${fallback9RouterModel})...`);
      const routerFallbackRes = await call9Router(effectiveSystem, user, {
        model: fallback9RouterModel,
        maxTokens,
        temperature,
        json: options?.json,
        images: options?.images,
        mediaParts: options?.mediaParts,
      });
      if (routerFallbackRes) {
        console.log(`[gemini] ✅ Đã phản hồi thành công qua tầng dự phòng 9Router (${fallback9RouterModel})!`);
        return routerFallbackRes;
      }
    } catch (rErr) {
      console.warn("[gemini] Tầng dự phòng 9Router gặp sự cố:", rErr);
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

  // VỆ TINH 1: Fallback sang Cloudflare Workers AI sau khi đã xoay hết 100% key Gemini (và DeepSeek)
  // 🛡️ ZERO-HALLUCINATION GUARD: TUYỆT ĐỐI KHÔNG fallback sang Cloudflare nếu request có ảnh/multimodal
  // vì Cloudflare Workers AI là model thuần text, sẽ không thấy file và hallucinate (bịa đặt "đây là file ảnh...")!
  if (isCloudflareConfigured() && !hasMedia) {
    try {
      console.log("[gemini] 🛰️ Toàn bộ key Gemini (và DeepSeek) đã xoay hết vòng hoặc lỗi, kích hoạt Vệ Tinh 1: Cloudflare Workers AI...");
      const cfReply = await callCloudflareLlm(
        [
          { role: "system", content: effectiveSystem },
          { role: "user", content: user },
        ],
        {
          temperature,
          maxTokens: maxTokens || 1500,
        },
      );
      if (cfReply) {
        console.log("[gemini] ✅ Vệ tinh 1: Cloudflare Workers AI phản hồi thành công!");
        return cfReply;
      }
    } catch (cfErr) {
      console.warn("[gemini] Vệ tinh Cloudflare Workers AI thất bại:", cfErr);
    }
  }

  if (hasMedia) {
    throw new Error(
      "Dạ Sếp/bác ơi, cụm máy chủ Vision AI hiện đang gặp sự cố quá tải tạm thời (HTTP 503/429 hoặc timeout). Kính nhờ Sếp/bác đợi 1 - 2 phút rồi gửi lại giúp em nhé! 🙏"
    );
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Thực hiện OCR cho 1 trang ảnh tài liệu (ưu tiên 9Router Vision, fallback Google AI Studio).
 */
export async function ocrSingleDocumentPage(
  imageBuffer: Buffer,
  pageNum: number,
  totalPages: number
): Promise<string> {
  const base64 = imageBuffer.toString("base64");
  const prompt = `Trích xuất TOÀN BỘ nội dung văn bản và bảng biểu trong hình ảnh trang tài liệu này (Trang ${pageNum}/${totalPages}) một cách trung thực, đầy đủ và chuẩn xác 100%.
YÊU CẦU:
1. Giữ nguyên toàn bộ cấu trúc: Tiêu đề, số thứ tự, điều khoản, căn cứ, danh sách, họ tên, ngày tháng, chữ ký/con dấu nếu có.
2. Nếu có bảng biểu (table), chuyển thành định dạng Markdown Table chuẩn (| Cột 1 | Cột 2 |...).
3. TUYỆT ĐỐI KHÔNG tóm tắt, KHÔNG thêm lời bình luận, KHÔNG thêm câu mở đầu/kết thúc, chỉ trả về nội dung văn bản đã bóc tách.`;

  // 1. Ưu tiên qua 9Router Vision (ag/gemini-3.7-flash-high hoặc cx/gpt-5.6-sol)
  const router = hybridAgentSettings?.nineRouter;
  if (router?.enabled && router.apiKey) {
    try {
      const routerModel = "ag/gemini-3.7-flash-high";
      const ocrRes = await call9Router("", prompt, {
        images: [{ data: base64, mimeType: "image/jpeg" }],
        model: routerModel,
        timeoutMs: 60_000,
        temperature: 0.1,
      });
      if (ocrRes && ocrRes.trim().length > 0) {
        return ocrRes.trim();
      }
    } catch (rErr) {
      console.warn(`[gemini-ocr] 9Router OCR trang ${pageNum} thất bại, thử Google AI Studio...`, rErr);
    }
  }

  // 2. Fallback sang Google AI Studio Multimodal (1 trang JPEG nhẹ ~150KB)
  try {
    const aiStudioRes = await callGemini("", prompt, {
      images: [{ data: base64, mimeType: "image/jpeg" }],
      enableSearch: false,
      temperature: 0.1,
    });
    if (aiStudioRes && aiStudioRes.trim().length > 0) {
      return aiStudioRes.trim();
    }
  } catch (gErr) {
    console.warn(`[gemini-ocr] Google AI Studio OCR trang ${pageNum} thất bại:`, gErr);
  }

  return "";
}

/**
 * Trích xuất toàn bộ văn bản từ file PDF scan dạng ảnh bằng cách cắt từng trang và OCR song song.
 */
export async function extractScannedPdfWithOcr(
  buffer: Buffer,
  fileName = "document.pdf",
  maxPages = 25
): Promise<string | null> {
  const tempDir = path.join("/tmp", `pdf_ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPdf = path.join(tempDir, "input.pdf");
  fs.writeFileSync(tempPdf, buffer);

  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    // Kiểm tra pdftoppm có khả dụng không
    try {
      await execFileAsync("pdftoppm", ["-v"]);
    } catch (checkErr: any) {
      if (checkErr.code === "ENOENT" || (checkErr.message && checkErr.message.includes("not found"))) {
        console.warn("[gemini-ocr] pdftoppm không có trên hệ thống, bỏ qua Tier 2 OCR");
        return null;
      }
    }

    // pdftoppm -jpeg -r 130 -scale-to 1100 input.pdf page
    const prefix = path.join(tempDir, "page");
    await execFileAsync("pdftoppm", ["-jpeg", "-r", "130", "-scale-to", "1100", tempPdf, prefix], {
      timeout: 30_000,
    });

    const files = fs.readdirSync(tempDir);
    const pageFiles = files
      .filter((f) => f.startsWith("page-") && (f.endsWith(".jpg") || f.endsWith(".jpeg")))
      .sort((a, b) => {
        const numA = parseInt(a.match(/page-(\d+)/)?.[1] || "0", 10);
        const numB = parseInt(b.match(/page-(\d+)/)?.[1] || "0", 10);
        return numA - numB;
      });

    if (pageFiles.length === 0) {
      console.warn("[gemini-ocr] pdftoppm không tạo ra trang ảnh nào.");
      return null;
    }

    const totalPages = pageFiles.length;
    const pagesToProcess = pageFiles.slice(0, maxPages);
    console.log(`[gemini-ocr] 📄 Đã cắt ${totalPages} trang từ "${fileName}", đang OCR song song ${pagesToProcess.length} trang đầu...`);

    const concurrency = 3;
    const pageResults: Array<{ pageNum: number; text: string }> = new Array(pagesToProcess.length);

    for (let i = 0; i < pagesToProcess.length; i += concurrency) {
      const chunk = pagesToProcess.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async (pageFile, chunkIdx) => {
          const pageIndex = i + chunkIdx;
          const pageNum = parseInt(pageFile.match(/page-(\d+)/)?.[1] || String(pageIndex + 1), 10);
          const pagePath = path.join(tempDir, pageFile);
          try {
            const pageBuf = fs.readFileSync(pagePath);
            const text = await ocrSingleDocumentPage(pageBuf, pageNum, totalPages);
            pageResults[pageIndex] = { pageNum, text: text || `[Trang ${pageNum}: Không phát hiện văn bản]` };
          } catch (pErr) {
            console.warn(`[gemini-ocr] Lỗi OCR trang ${pageNum}:`, pErr);
            pageResults[pageIndex] = { pageNum, text: `[Trang ${pageNum}: Lỗi xử lý OCR]` };
          }
        })
      );
    }

    const compiledPages: string[] = [];
    for (const res of pageResults) {
      if (res && res.text) {
        compiledPages.push(`=== TRANG ${res.pageNum} ===\n${res.text.trim()}`);
      }
    }

    if (totalPages > maxPages) {
      compiledPages.push(`\n[Lưu ý: Tài liệu gồm ${totalPages} trang, hệ thống đã trích xuất toàn bộ ${maxPages} trang đầu tiên]`);
    }

    const fullResult = compiledPages.join("\n\n");
    console.log(`[gemini-ocr] ✅ Hoàn tất OCR ${pagesToProcess.length}/${totalPages} trang, tổng cộng ${fullResult.length.toLocaleString("vi-VN")} ký tự!`);
    return fullResult;
  } catch (err) {
    console.warn(`[gemini-ocr] Thất bại khi cắt và OCR file "${fileName}":`, err);
    return null;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
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

export interface AgentLoopOptions {
  model?: string;
  maxTurns?: number; // default 3
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  images?: GeminiImagePart[];
  mediaParts?: GeminiMediaPart[];
  targetImageUrl?: string;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onFileGenerated?: (file: GeneratedFileResult) => Promise<void>;
  context?: {
    threadId?: string;
    isDirect?: boolean;
    sender?: string;
    displayName?: string;
  };
}

const AGENT_TOOLS_DECLARATION = {
  functionDeclarations: [
    {
      name: "set_reminder",
      description: "Đặt lịch hẹn, báo thức hoặc nhắc nhở công việc vào một thời điểm trong tương lai (giờ, ngày cụ thể hoặc khoảng thời gian sau bao lâu). BẮT BUỘC DÙNG khi người dùng yêu cầu nhắc việc, hẹn giờ, báo thức.",
      parameters: {
        type: "OBJECT",
        properties: {
          time: { type: "STRING", description: "Thời gian nhắc hẹn (ví dụ: '15 phút nữa', '09:00 15/10', '8h sáng mai', '17:30 hôm nay', 'ngày 15/10 lúc 9h sáng')" },
          content: { type: "STRING", description: "Nội dung công việc cần nhắc (ví dụ: 'Họp với đối tác', 'Uống nước', 'Gửi báo giá')" },
          target: { type: "STRING", enum: ["sender", "all"], description: "'sender' (mặc định) nếu nhắc riêng người yêu cầu, 'all' nếu nhắc cả nhóm" },
        },
        required: ["time", "content"],
      },
    },
    {
      name: "manage_birthday",
      description: "Quản lý và tra cứu thông tin sinh nhật của thành viên (lưu ngày sinh nhật thành viên, xem danh sách sinh nhật sắp tới).",
      parameters: {
        type: "OBJECT",
        properties: {
          action: { type: "STRING", enum: ["set", "list"], description: "'set' để lưu sinh nhật, 'list' để xem danh sách sinh nhật sắp tới" },
          name: { type: "STRING", description: "Tên thành viên (nếu action='set')" },
          dob: { type: "STRING", description: "Ngày sinh định dạng DD/MM hoặc DD/MM/YYYY (nếu action='set')" },
          note: { type: "STRING", description: "Ghi chú thêm nếu có (ví dụ: Khách VIP, Trưởng phòng)" },
        },
        required: ["action"],
      },
    },
    {
      name: "web_search",
      description: "Tìm kiếm thông tin thời gian thực, tin tức mới nhất, sự kiện, thời điểm ra mắt, giá cả hoặc số liệu trên web.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Từ khóa tìm kiếm ngắn gọn, rõ ràng" },
        },
        required: ["query"],
      },
    },
    {
      name: "fetch_url",
      description: "Đọc chi tiết nội dung trang web từ một URL cụ thể để trích xuất số liệu, ngày tháng và nội dung bài viết gốc.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: { type: "STRING", description: "URL bài viết cần đọc nội dung" },
        },
        required: ["url"],
      },
    },
    {
      name: "facebook_post_lookup",
      description: "Đọc chi tiết bài viết Facebook (caption, tác giả, lượt like/share/cmt, ảnh/video) và trích xuất bình luận (đặc biệt là bình luận của chính tác giả chứa link tài liệu và top bình luận nổi bật). Có thể tùy chọn trích xuất toàn bộ bình luận ra file Excel (.xlsx) gửi trực tiếp lên Zalo khi người dùng yêu cầu.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: { type: "STRING", description: "Đường link bài viết Facebook (facebook.com, fb.com, fb.watch...)" },
          exportCommentsToExcel: { type: "BOOLEAN", description: "Đặt là true nếu người dùng yêu cầu tải, xuất hoặc trích xuất bình luận ra file Excel (.xlsx)" },
          maxComments: { type: "INTEGER", description: "Số lượng bình luận cần cào (mặc định 25 cho đọc/tóm tắt bài, hoặc 100-500 khi xuất file Excel)" },
        },
        required: ["url"],
      },
    },
    {
      name: "youtube_transcript_lookup",
      description: "Trích xuất phụ đề (transcript), tiêu đề, tên kênh và thời lượng của video YouTube (youtube.com, youtu.be, shorts). BẮT BUỘC gọi công cụ này khi người dùng gửi link YouTube hoặc yêu cầu tóm tắt, phân tích, tìm ý chính hay trích xuất nội dung nói trong video YouTube.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: { type: "STRING", description: "Đường link video YouTube (youtube.com hoặc youtu.be hoặc shorts)" },
        },
        required: ["url"],
      },
    },
    {
      name: "download_media_video",
      description: "Tải file Video (.mp4) hoặc tách riêng âm thanh Audio (.mp3) từ đường link video mạng xã hội (TikTok không dính watermark, YouTube, Facebook Video/Reels, Instagram, X/Twitter...). File sau khi tải sẽ được tự động gửi trực tiếp đính kèm vào nhóm Zalo cho người dùng lưu về máy.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: { type: "STRING", description: "Đường link video (TikTok, YouTube, Facebook, Instagram, Twitter...)" },
          format: {
            type: "STRING",
            enum: ["video", "audio"],
            description: "BẮT BUỘC CHỌN: 'audio' (khi người dùng yêu cầu tải mp3, tách nhạc, lấy âm thanh, audio); hoặc 'video' (khi người dùng yêu cầu tải video MP4, clip)",
          },
        },
        required: ["url", "format"],
      },
    },
    {
      name: "wiki_lookup",
      description: "Tra cứu bách khoa toàn thư Wikipedia về thực thể, công nghệ, nhân vật, lịch sử hoặc khái niệm.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Tên thực thể hoặc chủ đề bách khoa" },
        },
        required: ["query"],
      },
    },
    {
      name: "hn_search",
      description: "Tra cứu tin tức công nghệ, AI, releases và thảo luận kỹ thuật chuyên sâu từ cộng đồng Hacker News.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Từ khóa công nghệ hoặc tên mô hình/thư viện" },
        },
        required: ["query"],
      },
    },
    {
      name: "arxiv_search",
      description: "Tra cứu bài báo khoa học, nghiên cứu kỹ thuật AI/ML mới nhất trên arXiv.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Chủ đề nghiên cứu AI hoặc tên mô hình/paper" },
        },
        required: ["query"],
      },
    },
    {
      name: "github_search",
      description: "Tra cứu kho lưu trữ mã nguồn mở (repository), thư viện, release trên GitHub.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Tên thư viện hoặc từ khóa repo mã nguồn" },
        },
        required: ["query"],
      },
    },
    {
      name: "generate_file",
      description: "Tạo và xuất file tài liệu thực tế (PowerPoint .pptx, Word .docx, Excel .xlsx, CSV .csv, HTML .html, Markdown .md, Text .txt, Code .py/.js/.sh) khi người dùng RA LỆNH VÀ CÓ NỘI DUNG CỤ THỂ để soạn thảo bài thuyết trình, văn bản hành chính, báo cáo, SOP, hợp đồng, bảng tính, báo giá. LƯU Ý: Với pptx, mỗi phần tử trong mảng slides là MỘT SLIDE ĐẦY ĐỦ; TUYỆT ĐỐI KHÔNG tách lẻ các chỉ số stats hay các bước steps thành các slide riêng biệt mà phải lồng gọn vào trường stats hoặc steps của slide đó.",
      parameters: {
        type: "OBJECT",
        properties: {
          fileType: {
            type: "STRING",
            enum: ["pptx", "docx", "xlsx", "csv", "html", "md", "txt", "code", "presentation_video"],
            description: "Định dạng file: 'pptx' (PowerPoint slide), 'docx' (Word), 'xlsx' (Excel), 'csv' (CSV BOM tiếng Việt), 'html' (HTML web report), 'md' (Markdown/SOP), 'txt' (văn bản thuần), 'code' (mã nguồn), 'presentation_video' (Video thuyết trình kèm giọng đọc AI Studio)",
          },
          fileName: {
            type: "STRING",
            description: "Tên file viết liền không dấu, ví dụ: 'bai_thuyet_trinh_du_an', 'bao_gia_thiet_bi', 'cong_van_hanh_chinh'",
          },
          title: {
            type: "STRING",
            description: "Tiêu đề chính của tài liệu hoặc bài thuyết trình",
          },
          theme: {
            type: "STRING",
            enum: ["navy", "blue", "green", "burgundy", "slate", "teal", "emerald", "luxury"],
            description: "Bảng màu mỹ thuật (áp dụng cho pptx và xlsx): navy (trang trọng), blue (tài chính), green (tăng trưởng), burgundy (cảnh báo/pháp lý), slate (kỹ thuật), teal (y tế/giáo dục), emerald (sang trọng sinh thái), luxury (hoàng gia/vàng đen)",
          },
          content: {
            type: "STRING",
            description: "Toàn bộ nội dung văn bản chi tiết đầy đủ (dành cho file docx, html, md, txt, code, hoặc nội dung markdown để tự động phân tích thành slides thuyết trình nếu không truyền mảng slides)",
          },
          slides: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING", description: "Tiêu đề slide" },
                subtitle: { type: "STRING", description: "Phụ đề slide (dành cho slide bìa title)" },
                kicker: { type: "STRING", description: "Huy hiệu / Badge danh mục nhỏ phía trên tiêu đề (ví dụ: 'CHIẾN LƯỢC 2026', 'TỔNG QUAN')" },
                takeaway: { type: "STRING", description: "Thông điệp đúc kết / Key takeaway hoặc lưu ý nổi bật ở chân trang slide" },
                speakerNotes: { type: "STRING", description: "Lời thoại / bài thuyết minh chi tiết của diễn giả khi trình chiếu slide này (dùng để lồng tiếng video thuyết trình AI Studio)" },
                layout: {
                  type: "STRING",
                  enum: ["title", "bullets", "table", "two_content", "three_column", "timeline", "stats"],
                  description: "Bố cục slide: 'title' (bìa lớn), 'bullets' (thẻ ý hoặc danh sách), 'stats' (các thẻ chỉ số lớn nổi bật), 'timeline' (quy trình/lộ trình các bước nằm ngang có mũi tên kết nối), 'three_column' (3 cột thẻ), 'two_content' (2 cột so sánh), 'table' (bảng dữ liệu)",
                },
                bullets: { type: "ARRAY", items: { type: "STRING" }, description: "Các ý gạch đầu dòng (tối đa 8 dòng, nếu <= 4 ý sẽ tự động chuyển thành dải thẻ ngang cực đẹp)" },
                tableHeaders: { type: "ARRAY", items: { type: "STRING" }, description: "Tên các cột (nếu layout là table)" },
                tableRows: { type: "ARRAY", items: { type: "ARRAY", items: { type: "STRING" } }, description: "Các dòng dữ liệu (nếu layout là table)" },
                col1Title: { type: "STRING", description: "Tiêu đề cột 1 (nếu layout là two_content hoặc three_column)" },
                col1Bullets: { type: "ARRAY", items: { type: "STRING" }, description: "Gạch đầu dòng cột 1" },
                col2Title: { type: "STRING", description: "Tiêu đề cột 2 (nếu layout là two_content hoặc three_column)" },
                col2Bullets: { type: "ARRAY", items: { type: "STRING" }, description: "Gạch đầu dòng cột 2" },
                col3Title: { type: "STRING", description: "Tiêu đề cột 3 (nếu layout là three_column)" },
                col3Bullets: { type: "ARRAY", items: { type: "STRING" }, description: "Gạch đầu dòng cột 3" },
                steps: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      number: { type: "STRING", description: "Số thứ tự bước (ví dụ: '01', '02')" },
                      title: { type: "STRING", description: "Tên bước / giai đoạn" },
                      desc: { type: "STRING", description: "Mô tả chi tiết bước" },
                    },
                    required: ["title", "desc"],
                  },
                  description: "Danh sách 3-4 bước quy trình / lộ trình (khi layout là timeline)",
                },
                stats: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      value: { type: "STRING", description: "Con số / chỉ số nổi bật (ví dụ: '1.175 TỶ', '622 CĂN', '35%', 'Q4/2028')" },
                      label: { type: "STRING", description: "Tên chỉ số / hạng mục" },
                      desc: { type: "STRING", description: "Mô tả phụ ngắn gọn" },
                    },
                    required: ["value", "label"],
                  },
                  description: "Danh sách 2-4 chỉ số ấn tượng (khi layout là stats)",
                },
              },
              required: ["title"],
            },
            description: "Danh sách các slide thuyết trình (tùy chọn; nếu không truyền thì bot tự động phân tích content thành slides)",
          },
          sheets: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: "Tên sheet Excel" },
                subtitle: { type: "STRING", description: "Phụ đề hoặc phạm vi báo cáo" },
                headers: { type: "ARRAY", items: { type: "STRING" }, description: "Tên các cột" },
                rows: { type: "ARRAY", items: { type: "ARRAY", items: { type: "STRING" } }, description: "Ma trận dữ liệu" },
                note: { type: "STRING", description: "Ghi chú chân bảng" },
              },
              required: ["name", "headers", "rows"],
            },
            description: "Cấu hình nhiều sheet cho file Excel (tùy chọn)",
          },
          excelHeaders: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Danh sách tên cột cho file Excel/CSV đơn giản",
          },
          excelRows: {
            type: "ARRAY",
            items: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
            description: "Mảng 2 chiều chứa các dòng dữ liệu cho file Excel/CSV đơn giản",
          },
        },
        required: ["fileType", "fileName", "title"],
      },
    },
    {
      name: "create_voice",
      description: "Chuyển văn bản thành giọng nói AI (Text-to-Speech) hoặc tạo Podcast đối đáp 2 người (đối thoại Nam - Nữ) và gửi file âm thanh (.m4a Voice Bubble) trực tiếp vào Zalo.",
      parameters: {
        type: "OBJECT",
        properties: {
          text: {
            type: "STRING",
            description: "Nội dung cốt lõi cần đọc thành tiếng (CHỈ gồm Tiêu đề, Tác giả/Nguồn nếu có, và nội dung tác phẩm/bài thơ/bản tin/kịch bản thoại). TUYỆT ĐỐI KHÔNG đưa lời chào hỏi của bot (@mention, 'Dạ Sếp...', 'Em xin gửi...'), lời dẫn chuyện ('Dưới đây là...'), thông báo kỹ thuật ('Hệ thống đang xử lý...'), hay câu hỏi kết thúc ('Sếp có muốn...', 'Chúc bạn...') vào tham số này!",
          },
          voice: {
            type: "STRING",
            description: "Tên giọng đọc: 'vi-VN-Neural2-A' (Nữ Neural2 tự nhiên, chuẩn truyền hình), 'vi-VN-Wavenet-B' (Nam trầm ấm, phát thanh viên), hoặc 'nữ' / 'nam'. Tự động hỗ trợ Google Cloud TTS cao cấp.",
          },
          speakers: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                speaker: { type: "STRING", description: "Tên nhân vật khớp trong text (ví dụ: 'MC Nam', 'Chuyên gia')" },
                voice: { type: "STRING", description: "Giọng đọc tương ứng ('vi-VN-Wavenet-B' hoặc 'vi-VN-Neural2-A', hoặc 'nam' / 'nữ')" },
              },
              required: ["speaker", "voice"],
            },
            description: "Cấu hình phân vai giọng đọc cho hội thoại Podcast 2 người (Nam/Nữ)",
          },
          caption: {
            type: "STRING",
            description: "Lời nhắn chữ ngắn gọn gửi kèm voice message.",
          },
          voice_style: {
            type: "STRING",
            description: "Phong cách, cảm xúc, hoặc chất giọng vùng miền (ví dụ: 'ngâm thơ Huế', 'giọng nữ người Huế truyền cảm', 'kể chuyện trầm ấm', 'nam miền Nam', 'hào hùng'). Tự động được ưu tiên xử lý qua Google AI Studio.",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "finance_market_lookup",
      description: "Tra cứu bảng giá trực tiếp của các đồng tiền số (Bitcoin, Ethereum, Solana, Altcoin...) từ sàn live (Binance/OKX/Bybit/CoinGecko), Chỉ số Sợ hãi & Tham lam (Crypto Fear & Greed Index) và tỷ giá ngoại tệ thật theo thời gian thực. BẮT BUỘC DÙNG khi người dùng hỏi về giá crypto, thị trường tiền số, bitcoin, altcoin, tỷ giá.",
      parameters: {
        type: "OBJECT",
        properties: {
          symbol: {
            type: "STRING",
            description: "Mã đồng tiền cần tra cứu (ví dụ: 'BTC', 'ETH', 'BNB', 'SOL', 'BTC,ETH,BNB', hoặc 'market' để lấy toàn cảnh thị trường)",
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "weather_forecast",
      description: "Tra cứu dự báo thời tiết, nhiệt độ, độ ẩm, khả năng mưa, gió, chỉ số UV và chất lượng không khí (AQI/PM2.5) cho hôm nay, ngày mai hoặc các ngày tiếp theo tại bất kỳ tỉnh thành/khu vực nào ở Việt Nam hoặc quốc tế.",
      parameters: {
        type: "OBJECT",
        properties: {
          location: {
            type: "STRING",
            description: "Tên thành phố hoặc tỉnh thành (ví dụ: 'Hồ Chí Minh', 'Hà Nội', 'Đà Lạt', 'Đà Nẵng', 'Hải Phòng'...)",
          },
          date: {
            type: "STRING",
            description: "Thời điểm cần tra cứu: 'today' (hôm nay), 'tomorrow' (ngày mai), 'ngày mai', hoặc ngày cụ thể định dạng DD/MM/YYYY hoặc YYYY-MM-DD",
          },
        },
        required: ["location"],
      },
    },
    {
      name: "python_interpreter",
      description: "Thực thi mã nguồn Python trực tiếp trên máy chủ để tính toán, phân tích số liệu, hoặc VẼ BIỂU ĐỒ SỐ LIỆU & THIẾT KẾ INFOGRAPHIC/POSTER/CARD ĐỒ HỌA CHUYÊN NGHIỆP (bằng PIL/Pillow hoặc matplotlib). BẮT BUỘC DÙNG khi người dùng yêu cầu vẽ biểu đồ, đồ thị, tạo infographic, poster lịch thi đấu, bảng xếp hạng, timeline, roadmap, thẻ danh ngôn hoặc khi người dùng yêu cầu làm lại/sửa lại ảnh/biểu đồ trước đó.",
      parameters: {
        type: "OBJECT",
        properties: {
          code: {
            type: "STRING",
            description: "Đoạn mã Python hoàn chỉnh để thực thi.\n1. NẾU LÀ INFOGRAPHIC, POSTER LỊCH THI ĐẤU, BẢNG XẾP HẠNG, ROADMAP, CARD THÔNG BÁO: BẮT BUỘC dùng PIL (Image, ImageDraw, ImageFont) thiết kế Card Layout chuyên nghiệp khổ dọc (W=720, H=1100-1400):\n  - Nền tối cao cấp: Thể thao dùng đỏ rượu/burgundy (#42030D); Công nghệ/Doanh nghiệp dùng Navy (#0B132B) hoặc Slate (#0F172A); Tài chính dùng Midnight đen ngọc.\n  - Tiêu đề chính vàng kim (#FFD700/#FBBF24, 28-32px bold) căn giữa; phụ đề trắng.\n  - Đặt từng mục vào thẻ bo góc (draw.rounded_rectangle, radius=12-16) có viền mảnh, kèm badge pill trạng thái ở góc phải ([CHÍNH THỨC], [GIAO HỮU], [LỘ TRÌNH]...).\n  - Mỗi dòng sự kiện có ô con bo góc, hiển thị ngày giờ vàng rực, tiêu đề trắng đậm, địa điểm căn phải.\n  - Chân trang có slogan và nguồn rõ ràng. Dùng get_font(size, bold) chuẩn tiếng Việt.\n2. NẾU LÀ BIỂU ĐỒ SỐ LIỆU ĐỊNH LƯỢNG (doanh thu, %, thống kê): Dùng matplotlib (plt.style.use('dark_background'), plt.savefig('chart.png', dpi=150, bbox_inches='tight')). TUYỆT ĐỐI KHÔNG dùng biểu đồ cột cho lịch thi đấu!",
          },
        },
        required: ["code"],
      },
    },
    {
      name: "generate_image",
      description:
        "Tạo hình ảnh AI mới hoặc chỉnh sửa/tạo biến thể hình ảnh bằng mô hình AI vẽ ảnh cao cấp (Codex / Cloudflare). BẮT BUỘC DÙNG khi người dùng yêu cầu vẽ ảnh, tạo ảnh, sửa ảnh, tạo poster, vẽ theo prompt của ai đó trong nhóm/cuộc trò chuyện, hoặc dựa trên nội dung/ý tưởng/ảnh được chia sẻ.",
      parameters: {
        type: "OBJECT",
        properties: {
          prompt: {
            type: "STRING",
            description:
              "Mô tả trực quan chi tiết và hoàn chỉnh của hình ảnh cần vẽ (bằng tiếng Việt hoặc tiếng Anh tối ưu). NẾU người dùng yêu cầu vẽ theo prompt của một thành viên trong nhóm (ví dụ 'dựa vào prompt của bác xyz ở trên', 'theo prompt này'), HÃY TRÍCH XUẤT ĐẦY ĐỦ NỘI DUNG Ý TƯỞNG ĐÓ từ lịch sử trò chuyện và tổng hợp thành prompt hoàn chỉnh, TUYỆT ĐỐI KHÔNG để prompt là 'dựa vào prompt của bác...' cộc lốc!",
          },
          aspectRatio: {
            type: "STRING",
            enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
            description: "Tỉ lệ khung hình (mặc định 1:1, hoặc 16:9 cho ảnh ngang/wallpaper, 9:16 cho ảnh đứng/story/tiktok)",
          },
          imageUrl: {
            type: "STRING",
            description: "URL hoặc đường dẫn ảnh gốc nếu người dùng yêu cầu chỉnh sửa/biến thể trên một ảnh đã có trong nhóm hoặc ảnh đính kèm",
          },
          isEdit: {
            type: "BOOLEAN",
            description: "true nếu là chỉnh sửa/thay đổi/biến thể trên ảnh đã có, false nếu vẽ mới hoàn toàn",
          },
          model: {
            type: "STRING",
            enum: ["gemini", "codex", "muse", "auto"],
            description: "Chỉ định model vẽ ảnh: Nếu người dùng đích danh yêu cầu 'muse', 'codex' hoặc 'gemini', BẮT BUỘC chọn đúng model đó. Nếu không chỉ định model, chọn 'gemini' nếu vẽ tranh màu nước, vẽ tay, nghệ thuật; chọn 'codex' nếu ảnh chụp thật 8K, render 3D; chọn 'muse' nếu yêu cầu dùng Muse; hoặc chọn 'auto'.",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "generate_video",
      description:
        "Tạo video nghệ thuật AI ngắn (5 giây hoặc 10 giây, tỉ lệ 16:9 hoặc 9:16) bằng mô hình Muse Video AI (Image-to-Video hoặc Text-to-Video). Dùng khi người dùng yêu cầu: tạo video Muse, sinh video nghệ thuật ngắn, biến ảnh thành video cử động, làm clip động 5s-10s theo mô tả bối cảnh. (LƯU Ý: Không dùng tool này nếu người dùng yêu cầu làm video TikTok/Shorts/So sánh có giọng đọc thuyết minh và phụ đề karaoke chuyển động vì đã có Remotion Engine xử lý tự động).",
      parameters: {
        type: "OBJECT",
        properties: {
          prompt: {
            type: "STRING",
            description:
              "Mô tả chi tiết chuyển động phân cảnh, hành động nhân vật/vật thể, góc máy, ánh sáng và bối cảnh của video cần tạo (bằng tiếng Việt hoặc tiếng Anh).",
          },
          duration: {
            type: "INTEGER",
            enum: [5, 10],
            description: "Thời lượng video (giây): 5 hoặc 10 (mặc định 5s)",
          },
          aspectRatio: {
            type: "STRING",
            enum: ["16:9", "9:16"],
            description: "Tỉ lệ khung hình video: 16:9 (ngang) hoặc 9:16 (dọc điện thoại / tiktok / story). Mặc định '16:9'.",
          },
          imageUrl: {
            type: "STRING",
            description: "URL hoặc đường dẫn ảnh tham chiếu nếu muốn tạo video từ ảnh có sẵn (Image-to-Video).",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "generate_music",
      description: "Sáng tác ca khúc, phối khí âm nhạc và tạo bài hát AI hoàn chỉnh (gồm giọng ca sĩ hát tiếng Việt/tiếng Anh hoặc nhạc beat không lời) bằng mô hình Suno AI. BẮT BUỘC DÙNG khi người dùng yêu cầu: sáng tác bài hát, làm bài nhạc, tạo bài hát chúc mừng sinh nhật/sự kiện, viết nhạc rap/ballad/pop/bolero, tạo beat lofi/edm/acoustic, hoặc phối nhạc theo chủ đề.",
      parameters: {
        type: "OBJECT",
        properties: {
          prompt: {
            type: "STRING",
            description: "Mô tả chủ đề, ý tưởng hoặc bối cảnh của bài hát cần sáng tác (ví dụ: 'Bài hát chúc mừng sinh nhật anh Tuấn phong cách rap sôi động hài hước', 'Bài hát ballad về mùa thu Hà Nội')",
          },
          lyrics: {
            type: "STRING",
            description: "Lời bài hát chi tiết theo từng đoạn [Verse 1], [Chorus], [Verse 2], [Outro]. Nếu người dùng không đưa sẵn lời, AI HÃY TỰ VIẾT LỜI BÀI HÁT đầy đủ, vần điệu và giàu cảm xúc vào tham số này!",
          },
          style: {
            type: "STRING",
            description: "Thể loại hoặc phong cách âm nhạc (ví dụ: 'vietnamese rap, upbeat, hip hop', 'vietnamese ballad, acoustic, emotional', 'bolero, trữ tình', 'lofi, chill, piano', 'edm, festival, energetic')",
          },
          title: {
            type: "STRING",
            description: "Tiêu đề bài hát (ví dụ: 'Sinh Nhật Vui Vẻ', 'Mưa Thu Hà Nội')",
          },
          instrumental: {
            type: "BOOLEAN",
            description: "True nếu người dùng chỉ muốn nhạc nền / beat không lời; False nếu muốn có ca sĩ hát",
          },
        },
        required: ["prompt"],
      },
    },
  ],
};

function convertGeminiSchemaToOpenAISchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(convertGeminiSchemaToOpenAISchema);

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "type" && typeof v === "string") {
      out.type = v.toLowerCase();
    } else if (k === "properties" && v && typeof v === "object") {
      out.properties = {};
      for (const [propK, propV] of Object.entries(v as Record<string, any>)) {
        out.properties[propK] = convertGeminiSchemaToOpenAISchema(propV);
      }
    } else if (k === "items" && v && typeof v === "object") {
      out.items = convertGeminiSchemaToOpenAISchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function getOpenAIAgentTools(): any[] {
  return AGENT_TOOLS_DECLARATION.functionDeclarations.map((decl) => ({
    type: "function",
    function: {
      name: decl.name,
      description: decl.description,
      parameters: convertGeminiSchemaToOpenAISchema(decl.parameters),
    },
  }));
}

export async function executeAgentTool(name: string, args: Record<string, any>, context?: any): Promise<any> {
  switch (name) {
    case "set_reminder": {
      const time = String(args?.time || "").trim();
      const content = String(args?.content || "").trim();
      const target = args?.target === "all" ? "cho cả nhóm" : "";
      const fullArgs = `${target} ${time} ${content}`.trim();
      const threadId = context?.threadId || "";
      const isDirect = Boolean(context?.isDirect ?? true);
      const sender = context?.sender || "user";
      const displayName = context?.displayName || "Bạn";
      const res = handleSetReminder(threadId, isDirect, sender, displayName, fullArgs);
      return { success: true, message: res };
    }
    case "manage_birthday": {
      const action = String(args?.action || "list").trim();
      if (action === "set") {
        const name = String(args?.name || "").trim();
        const dob = String(args?.dob || "").trim();
        const note = String(args?.note || "").trim();
        const full = `${name} ${dob} ${note ? "- " + note : ""}`.trim();
        const res = handleSetBirthday(full, [], context?.threadId || "", context?.sender || "");
        return { success: true, message: res };
      } else {
        const res = handleListUpcomingBirthdays(30);
        return { success: true, message: res };
      }
    }
    case "weather_forecast": {
      const loc = String(args?.location || "Hồ Chí Minh").trim();
      const targetDate = args?.date ? String(args.date).trim() : undefined;
      const data = await fetchWeatherData(loc, targetDate);
      if (!data) return { message: `Hiện chưa lấy được dữ liệu thời tiết cho khu vực ${loc}.` };
      return data;
    }
    case "finance_market_lookup": {
      const sym = String(args?.symbol || "market").trim();
      if (
        sym.toLowerCase() === "market" ||
        sym.toLowerCase() === "crypto" ||
        sym.includes(",") ||
        sym.includes(" ") ||
        !sym
      ) {
        const summary = await getFinancialMarketSummary(sym || "crypto");
        return { summary };
      }
      const ticker = await getCryptoTicker(sym);
      const fng = await getFearAndGreedIndex();
      if (ticker) {
        return { ticker, fearAndGreed: fng };
      }
      const summary = await getFinancialMarketSummary(sym);
      return { summary, fearAndGreed: fng };
    }
    case "web_search": {
      const q = String(args?.query || "").trim();
      if (!q) return { results: [] };
      const items = await webSearch(q, 5);
      return { results: items };
    }
    case "fetch_url": {
      const url = String(args?.url || "").trim();
      if (!url) return { error: "Thiếu URL cần đọc" };
      return await fetchUrl(url, 2500);
    }
    case "facebook_post_lookup": {
      const url = String(args?.url || "").trim();
      if (!url) return { error: "Thiếu URL Facebook cần xử lý" };
      const exportExcel = Boolean(args?.exportCommentsToExcel);
      const maxComments = typeof args?.maxComments === "number"
        ? Math.min(Math.max(args.maxComments, 5), 1000)
        : (exportExcel ? 100 : 25);

      const enriched = await crawlFacebookEnrichedPost(url, { maxComments });
      if (!enriched) {
        return { error: "Không thể lấy dữ liệu từ link Facebook này (có thể là bài viết trong nhóm kín, bài viết riêng tư hoặc link không hợp lệ)." };
      }

      if (exportExcel && enriched.allComments.length > 0) {
        const excelResult = await exportFacebookCommentsToExcel(enriched.allComments, {
          postTitle: enriched.post.text ? enriched.post.text.slice(0, 50) : "binh_luan_fb",
          postUrl: url,
          postAuthor: enriched.post.authorName,
        });

        if (!excelResult?.success) {
          return { error: excelResult?.error || "Không thể xuất bình luận ra file Excel." };
        }

        return {
          ...excelResult,
          fileType: "xlsx",
          summary: `Đã trích xuất thành công ${excelResult.totalComments} bình luận từ bài viết của ${enriched.post.authorName || "tác giả"} ra file Excel.`,
          post: enriched.post,
        };
      }

      return {
        post: enriched.post,
        authorComments: enriched.authorComments,
        linkComments: enriched.linkComments,
        topComments: enriched.topComments,
        formattedContent: formatFacebookEnrichedPost(enriched),
      };
    }
    case "youtube_transcript_lookup": {
      const url = String(args?.url || "").trim();
      if (!url) return { error: "Thiếu URL YouTube cần trích xuất phụ đề" };
      const ytResult = await fetchYouTubeContent(url, 15000);
      if (!ytResult) {
        return { error: "Không thể trích xuất thông tin từ URL YouTube này (URL không hợp lệ hoặc video không khả dụng)." };
      }
      return ytResult;
    }
    case "download_media_video": {
      const url = String(args?.url || "").trim();
      if (!url) return { error: "Thiếu đường dẫn URL video cần tải" };
      const formatStr = String(args?.format || "").toLowerCase();
      const format = formatStr.includes("audio") || formatStr.includes("mp3") ? "audio" : "video";
      return await downloadMediaVideo(url, { format });
    }
    case "wiki_lookup": {
      const q = String(args?.query || "").trim();
      if (!q) return { error: "Thiếu từ khóa tra cứu" };
      const res = await wikiLookup(q);
      return res || { message: "Không tìm thấy trên Wikipedia" };
    }
    case "hn_search": {
      const q = String(args?.query || "").trim();
      if (!q) return { results: [] };
      const items = await hnSearch(q, 4);
      return { results: items };
    }
    case "arxiv_search": {
      const q = String(args?.query || "").trim();
      if (!q) return { results: [] };
      const items = await arxivSearch(q, 3);
      return { results: items };
    }
    case "github_search": {
      const q = String(args?.query || "").trim();
      if (!q) return { results: [] };
      const items = await githubSearch(q, 3);
      return { results: items };
    }
    case "generate_file": {
      const fileType = String(args?.fileType || "md").toLowerCase().trim();
      const fileName = String(args?.fileName || "tai_lieu").trim();
      const rawTitle = String(args?.title || "").trim();
      let title = rawTitle;
      if (!title || title.toLowerCase() === "tài liệu") {
        title = fileName.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        if (title.toLowerCase() === "tai lieu") title = "Báo Cáo Trình Chiếu";
      }
      const content = String(args?.content || "").trim();
      const theme = (args?.theme || "navy") as ThemeName;

      if (fileType === "pptx") {
        let slides = Array.isArray(args?.slides) ? (args.slides as any) : [];
        if (slides.length === 0 && content) {
          slides = parseMarkdownToSlides(content, title);
        }
        const enableNarration = Boolean(args?.enableNarration || args?.withAudio || args?.narration);
        const voiceHint = args?.voiceHint ? String(args.voiceHint).trim() : undefined;
        const result = await generatePowerPointFile(fileName, title, slides, theme, {
          enableNarration,
          voiceHint,
        });
        return result;
      } else if (fileType === "nd30" || fileType === "van_ban") {
        if (args?.nd30Data && typeof args.nd30Data === "object") {
          const result = await renderDecree30Document({
            fileName,
            data: args.nd30Data,
          });
          return result;
        } else {
          const blocks = parseMarkdownToWordBlocks(content, title);
          const result = await generateWordDoc(fileName, title, blocks);
          return result;
        }
      } else if (fileType === "xlsx") {
        if (Array.isArray(args?.sheets) && args.sheets.length > 0) {
          const result = await generateExcelFile(fileName, args.sheets as any, theme);
          return result;
        } else {
          let headers = Array.isArray(args?.excelHeaders) ? args.excelHeaders.map(String) : [];
          let rows = Array.isArray(args?.excelRows) ? (args.excelRows as any) : [];
          if (rows.length === 0 && content) {
            const tableData = extractAllMarkdownTables(content, title);
            if (tableData) {
              headers = tableData.headers;
              rows = tableData.rows;
            }
          }
          if (headers.length === 0) headers = ["STT", "Nội dung", "Ghi chú"];
          const result = await generateExcelFile(fileName, title || "Sheet1", headers, rows, theme);
          return result;
        }
      } else if (fileType === "docx") {
        const blocks = parseMarkdownToWordBlocks(content, title);
        const result = await generateWordDoc(fileName, title, blocks);
        return result;
      } else if (fileType === "csv") {
        let headers = Array.isArray(args?.excelHeaders) ? args.excelHeaders.map(String) : [];
        let rows = Array.isArray(args?.excelRows) ? (args.excelRows as any) : [];
        if (rows.length === 0 && content) {
          const tableData = extractAllMarkdownTables(content, title);
          if (tableData) {
            headers = tableData.headers;
            rows = tableData.rows;
          }
        }
        if (headers.length === 0) headers = ["STT", "Nội dung", "Ghi chú"];
        const result = await generateCsvFile(fileName, headers, rows);
        return result;
      } else if (fileType === "html") {
        const result = await generateHtmlFile(fileName, title, content);
        return result;
      } else if (fileType === "presentation_video") {
        let slides = Array.isArray(args?.slides) ? (args.slides as any) : [];
        if (slides.length === 0 && content) {
          slides = parseMarkdownToSlides(content, title);
        }
        const result = await renderPresentationVideoFromSlides(
          fileName,
          title,
          slides,
          theme,
          args?.voiceHint,
          args?.voiceStyle,
        );
        return result;
      } else if (fileType === "md" || fileType === "markdown") {
        const result = await generateMarkdownFile(fileName, title, content);
        return result;
      } else {
        const ext = fileType === "code" ? (args?.fileExt || "txt") : fileType;
        const result = await generateTextFile(fileName, content, ext);
        return result;
      }
    }
    case "create_voice": {
      const text = String(args?.text || "").trim();
      const voice = args?.voice ? String(args.voice) : undefined;
      const caption = args?.caption ? String(args.caption) : undefined;
      const voice_style = args?.voice_style ? String(args.voice_style) : (args?.style ? String(args.style) : undefined);
      const speakers = Array.isArray(args?.speakers) ? (args.speakers as any) : undefined;

      const isDialogue = (speakers && speakers.length > 0) || isDialogueText(text);

      if (isDialogue) {
        const result = await synthesizeDialogue({ text: normalizeDialogueTurns(text), speakers, caption, stylePrompt: voice_style });
        return result;
      } else {
        const result = await synthesizeSpeech({ text, voice, caption, stylePrompt: voice_style });
        return result;
      }
    }
    case "generate_music": {
      const prompt = String(args?.prompt || "").trim();
      if (!prompt) return { error: "Thiếu mô tả bài hát cần tạo" };
      const lyrics = args?.lyrics ? String(args.lyrics).trim() : undefined;
      const style = args?.style ? String(args.style).trim() : undefined;
      const title = args?.title ? String(args.title).trim() : undefined;
      const instrumental = Boolean(args?.instrumental);

      const result = await generateMusic({ prompt, lyrics, style, title, instrumental });
      return result;
    }
    case "python_interpreter": {
      const code = String(args?.code || "").trim();
      if (!code) return { error: "Không có mã code Python nào để chạy" };
      const res = await runPythonCode(code);
      return res;
    }
    case "generate_image": {
      const prompt = String(args?.prompt || "").trim();
      if (!prompt) return { error: "Thiếu mô tả prompt hình ảnh cần tạo" };
      const aspectRatio = (args?.aspectRatio || "1:1") as any;
      const isEdit = Boolean(args?.isEdit);
      const imageUrl = args?.imageUrl ? String(args.imageUrl).trim() : undefined;

      let inputImageDataUrl: string | null = null;
      if (imageUrl) {
        if (fs.existsSync(imageUrl)) {
          inputImageDataUrl = prepareImageDataUrl(imageUrl);
        } else {
          const fileRes = await downloadFileContent(imageUrl);
          if (fileRes?.mediaPart?.data) {
            inputImageDataUrl = `data:${fileRes.mediaPart.mimeType || "image/png"};base64,${fileRes.mediaPart.data}`;
          }
        }
      }

      const isCodex = config.imageProvider === "codex";
      const requestedModel = args?.model ? String(args.model).trim() : undefined;
      if (isCodex) {
        if (!isCodexImageConfigured() && !isMuseImageConfigured()) {
          return { error: "Tính năng tạo/sửa ảnh AI (Codex / Gemini / Muse) chưa được cấu hình NINE_ROUTER_API_KEY hoặc MUSE_API_KEY trong file .env." };
        }
        const imgRes = await generateCodexImage(prompt, {
          aspectRatio,
          image: inputImageDataUrl,
          isEdit,
          model: requestedModel,
        });
        if (imgRes.success && imgRes.filePath) {
          const ratioTag = aspectRatio !== "1:1" ? ` (${aspectRatio})` : "";
          const shortNote = prompt.length <= 40 ? ` ("${prompt}"${ratioTag})` : "";
          const modelTag = imgRes.tierUsed ? `\n🤖 Model: ${imgRes.tierUsed}` : "";
          const fallbackNote = imgRes.fallbackNotice ? `\n\n${imgRes.fallbackNotice}` : "";
          const caption = (isEdit
            ? `🎨 Ảnh sau khi chỉnh sửa đây ạ!${shortNote} ✨${modelTag}`
            : `🎨 Ảnh theo yêu cầu đây ạ!${shortNote} ✨${modelTag}`) + fallbackNote;
          return {
            success: true,
            filePath: imgRes.filePath,
            fileName: path.basename(imgRes.filePath),
            fileSize: fs.existsSync(imgRes.filePath) ? fs.statSync(imgRes.filePath).size : 0,
            caption,
            prompt,
            aspectRatio,
            tierUsed: imgRes.tierUsed,
          };
        }
        return { error: imgRes.error || "Lỗi tạo ảnh với Codex" };
      } else {
        if (!isCloudflareConfigured()) {
          return { error: "Tính năng vẽ ảnh AI (Cloudflare) chưa được cấu hình." };
        }
        const imgRes = await generateCloudflareImage(prompt, { aspectRatio });
        if (imgRes.success && imgRes.filePath) {
          const ratioTag = aspectRatio !== "1:1" ? ` (${aspectRatio})` : "";
          const shortNote = prompt.length <= 40 ? ` ("${prompt}"${ratioTag})` : "";
          const caption = `🎨 Ảnh theo yêu cầu đây ạ!${shortNote} ✨`;
          return {
            success: true,
            filePath: imgRes.filePath,
            fileName: path.basename(imgRes.filePath),
            fileSize: fs.existsSync(imgRes.filePath) ? fs.statSync(imgRes.filePath).size : 0,
            caption,
            prompt,
            aspectRatio,
          };
        }
        return { error: imgRes.error || "Lỗi tạo ảnh với Cloudflare" };
      }
    }
    case "generate_video": {
      const prompt = String(args?.prompt || "").trim();
      if (!prompt) return { error: "Thiếu mô tả prompt video cần tạo" };
      const duration = args?.duration === 10 ? 10 : 5;
      const aspectRatio = (args?.aspectRatio || "16:9") as any;
      const imageUrl = args?.imageUrl ? String(args.imageUrl).trim() : undefined;

      if (!isMuseVideoConfigured()) {
        return { error: "Tính năng tạo video AI (Muse) chưa được cấu hình MUSE_API_KEY trong file .env." };
      }

      console.log(`[gemini-agent] 🎬 Bắt đầu tạo video AI (${duration}s, ${aspectRatio}): "${prompt.slice(0, 60)}"...`);
      const vidRes = await generateAiVideo(prompt, {
        duration,
        aspectRatio,
        imageUrl,
        timeoutMs: 360_000,
      });

      if (vidRes.success && vidRes.filePath) {
        const shortNote = prompt.length <= 40 ? ` ("${prompt}" - ${duration}s, ${aspectRatio})` : ` (${duration}s, ${aspectRatio})`;
        const caption = `🎬 Video AI theo yêu cầu đây ạ!${shortNote} ✨\n🤖 Model: ${vidRes.tierUsed || "Muse Video"}`;
        return {
          success: true,
          filePath: vidRes.filePath,
          fileName: path.basename(vidRes.filePath),
          fileSize: vidRes.fileSize || (fs.existsSync(vidRes.filePath) ? fs.statSync(vidRes.filePath).size : 0),
          duration,
          caption,
          isVideo: true,
          prompt,
          tierUsed: vidRes.tierUsed,
        };
      }
      incidentTracker.recordIncident({
        threadId: args?.threadId || "global",
        action: "video_generation",
        targetProvider: "Muse Video",
        status: "failed",
        errorReason: vidRes.error || "Lỗi tạo video với Muse",
        userPrompt: prompt,
      });
      return { error: vidRes.error || "Lỗi tạo video với Muse" };
    }
    default:
      return { error: `Công cụ ${name} không tồn tại` };
  }
}

/**
 * Trích xuất câu hỏi/yêu cầu trực tiếp của người dùng từ prompt tổng thể (bỏ qua chat_history)
 */
export function extractUserDirectQuery(userPrompt: string): string {
  if (!userPrompt) return "";
  let text = userPrompt.replace(/<chat_history>[\s\S]*?<\/chat_history>/gi, "");
  text = text.replace(/LỊCH SỬ TRÒ CHUYỆN TRƯỚC ĐÓ:[\s\S]*?(?=\n\n(?:YÊU CẦU|===|\[ẢNH|DANH SÁCH)|$)/gi, "");

  const reqMatch = text.match(/YÊU CẦU\s*(?:\/|\s)\s*(?:CHỈ ĐẠO TỪ SẾP|CÂU HỎI TỪ THÀNH VIÊN|MỚI TỪ)[^:]*:\s*([\s\S]+?)(?=\n\s*HÃY TRẢ LỜI|$)/i);
  if (reqMatch?.[1]) {
    return reqMatch[1].trim();
  }
  return text.trim();
}

/**
 * Chuẩn hóa tham số format cho công cụ download_media_video dựa trên yêu cầu trực tiếp
 */
export function resolveMediaDownloadFormat(currentFormat: unknown, userPrompt: string): "video" | "audio" {
  const directQuery = extractUserDirectQuery(userPrompt).toLowerCase();

  // Nhận diện người dùng nói rõ muốn tải video/clip/mp4
  const wantsExplicitVideo = /(?:tải|tai|lấy|lay|xin|download|xem)\s+(?:video|clip|mp4|phim)|(?:bản|file)\s+video/i.test(directQuery);

  // Nhận diện người dùng nói rõ muốn tách nhạc/lấy âm thanh/tải mp3
  const wantsExplicitAudio = /(?:tách\s*nhạc|tach\s*nhac|lấy\s*nhạc|lay\s*nhac|tải\s*mp3|tai\s*mp3|\bmp3\b|\baudio\b|âm\s*thanh|am\s*thanh|tách\s*tiếng|tach\s*tieng|nhạc\s*nền|nhac\s*nen|tách\s*audio|tach\s*audio)/i.test(directQuery);

  if (wantsExplicitVideo) {
    return "video";
  }
  if (wantsExplicitAudio) {
    return "audio";
  }

  const norm = String(currentFormat || "").toLowerCase();
  if (norm === "audio") return "audio";
  return "video";
}

async function call9RouterAgentLoop(
  effectiveSystem: string,
  user: string,
  options?: AgentLoopOptions,
): Promise<string | null> {
  const router = hybridAgentSettings?.nineRouter;
  if (!router?.enabled || !router.apiKey) return null;

  const baseUrl = (router.baseUrl || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
  let targetModel = options?.model || router.chatModel || "ag/gemini-3.8-flash-low";
  // Nếu model truyền vào không có prefix ag/ hoặc cx/ (ví dụ 'gemini-3.7-flash', 'gemini-3.8-flash'):
  // Chuẩn hóa sang model 9Router tương ứng có prefix hợp lệ
  if (!targetModel.startsWith("ag/") && !targetModel.startsWith("cx/")) {
    if (targetModel.includes("3.1") && targetModel.includes("pro")) {
      targetModel = "ag/gemini-3.8-flash-low";
    } else if (targetModel.includes("3.7")) {
      targetModel = "ag/gemini-3.7-flash-high";
    } else if (targetModel.includes("claude") || targetModel.includes("sonnet")) {
      targetModel = "ag/claude-sonnet-4-6";
    } else {
      targetModel = (router.chatModel && (router.chatModel.startsWith("ag/") || router.chatModel.startsWith("cx/")))
        ? router.chatModel
        : "ag/gemini-3.8-flash-low";
    }
  }
  const configuredTimeout = options?.timeoutMs || (options as any)?.timeoutMs || router.timeoutMs || 45_000;
  // Dynamic scaling: Nếu context lớn (> 15k ký tự), tự động tăng timeout lên tối thiểu 150_000ms (2.5 phút)
  // để mô hình có đủ thời gian đọc hiểu tài liệu lớn và sinh đầy đủ bảng biểu/file đính kèm mà không bị timeout abort
  const promptLen = (effectiveSystem?.length || 0) + (user?.length || 0);
  const timeoutMs = promptLen > 20_000
    ? Math.max(configuredTimeout, 150_000)
    : promptLen > 8_000
      ? Math.max(configuredTimeout, 90_000)
      : configuredTimeout;
  const maxTurns = options?.maxTurns || 3;
  const temperature = options?.temperature ?? 0.2;

  // Nếu có mediaPart là application/pdf, 9Router (OpenAI-compatible) sẽ lỗi HTTP 400 vì image_url không hỗ trợ PDF
  const hasPdfMedia = options?.mediaParts?.some(
    (m) => m.mimeType === "application/pdf" || m.mimeType?.includes("pdf")
  );
  if (hasPdfMedia) {
    console.log("[gemini-agent] 📄 Phát hiện file PDF trong mediaParts, bỏ qua 9Router để dùng Google Gemini native API...");
    return null;
  }

  const allMedia = [...(options?.images || []), ...(options?.mediaParts || [])];
  const userContent: Array<Record<string, unknown>> = [];

  if (allMedia.length > 0) {
    userContent.push({ type: "text", text: user });
    for (const media of allMedia) {
      const mime = media.mimeType || "image/jpeg";
      const dataUrl = `data:${mime};base64,${media.data}`;
      userContent.push({
        type: "image_url",
        image_url: { url: dataUrl },
      });
    }
  }

  const messages: Array<{ role: string; content?: any; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [];
  const systemWithCaveman = effectiveSystem
    ? `${effectiveSystem}\n\n${CAVEMAN_INTERNAL_DIRECTIVE}`
    : CAVEMAN_INTERNAL_DIRECTIVE;
  messages.push({ role: "system", content: systemWithCaveman });
  messages.push({
    role: "user",
    content: allMedia.length > 0 ? userContent : user,
  });

  const tools = getOpenAIAgentTools();

  for (let turn = 0; turn < maxTurns; turn++) {
    const requestBody: Record<string, unknown> = {
      model: targetModel,
      messages,
      tools,
      stream: false,
      temperature,
      ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
    };

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${router.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
    } catch (netErr) {
      console.warn(`[9router-agent] Turn ${turn + 1} network error:`, netErr);
      return null;
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(`[9router-agent] Turn ${turn + 1} HTTP ${resp.status}: ${errText.slice(0, 150)}`);
      return null;
    }

    const data: any = await resp.json().catch(() => null);
    const choice = data?.choices?.[0];
    const message = choice?.message;
    if (!message) return null;

    const toolCalls = message.tool_calls;
    if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
      return String(message.content || "").trim();
    }

    messages.push({
      role: "assistant",
      content: message.content || null,
      tool_calls: toolCalls,
    });

    console.log(
      `[9router-agent] 🔄 Vòng ${turn + 1}/${maxTurns}: Model gọi ${toolCalls.length} tool(s): ` +
        toolCalls.map((tc: any) => `${tc.function?.name}(${tc.function?.arguments || ""})`).join(", "),
    );

    for (const tc of toolCalls) {
      const fnName = tc.function?.name;
      let fnArgs: any = {};
      try {
        fnArgs = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        fnArgs = {};
      }

      if (fnName === "generate_image") {
        if (!fnArgs.imageUrl && options?.targetImageUrl) {
          fnArgs.imageUrl = options.targetImageUrl;
        }
        if (options?.targetImageUrl && fnArgs.isEdit === undefined) {
          fnArgs.isEdit = true;
        }
      }

      if (fnName === "download_media_video") {
        if (!fnArgs) fnArgs = {};
        fnArgs.format = resolveMediaDownloadFormat(fnArgs.format, user);
      }

      options?.onToolCall?.(fnName, fnArgs);
      const result = await executeAgentTool(fnName, fnArgs, options?.context);

      if (
        (fnName === "generate_file" ||
          fnName === "create_voice" ||
          fnName === "generate_image" ||
          fnName === "generate_video" ||
          fnName === "generate_music" ||
          (fnName === "download_media_video" && result?.filePath) ||
          (fnName === "facebook_post_lookup" && result?.filePath)) &&
        result?.success &&
        options?.onFileGenerated
      ) {
        try {
          await options.onFileGenerated({
            ...result,
            isMusic: fnName === "generate_music",
            isVideo: fnName === "generate_video" || Boolean(result?.isVideo),
          });
        } catch (fileErr) {
          console.warn(`[9router-agent] onFileGenerated for ${fnName} error:`, fileErr);
        }
      }

      if (fnName === "python_interpreter" && result?.success && options?.onFileGenerated) {
        const allFiles = [...(result.generatedImages || []), ...(result.generatedFiles || [])];
        for (const itemPath of allFiles) {
          try {
            await options.onFileGenerated({
              success: true,
              filePath: itemPath,
              fileName: path.basename(itemPath),
              fileSize: fs.existsSync(itemPath) ? fs.statSync(itemPath).size : 0,
            });
          } catch (fileErr) {
            console.warn("[9router-agent] onFileGenerated python runner error:", fileErr);
          }
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: fnName,
        content: JSON.stringify(result || {}),
      });
    }
  }

  try {
    const finalResp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${router.apiKey}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages,
        stream: false,
        temperature,
      }),
    });

    if (finalResp.ok) {
      const finalData: any = await finalResp.json().catch(() => null);
      const finalContent = finalData?.choices?.[0]?.message?.content;
      if (finalContent) return String(finalContent).trim();
    }
  } catch {}

  return null;
}

/**
 * Agent Loop gọi Gemini với khả năng tự chọn tool (web_search, fetch_url, wiki_lookup, hn_search, arxiv_search, github_search).
 * Ưu tiên 9Router (ag/gemini-3.7-flash-medium); tự động fallback sang Google AI Studio keys nếu cần.
 */
export async function callGeminiAgentLoop(
  system: string,
  user: string,
  options?: AgentLoopOptions,
): Promise<string> {
  const effectiveSystem = system?.includes("SYSTEM TEMPORAL ANCHOR")
    ? system
    : (system ? `${getSystemTemporalPrompt()}\n\n${system}` : getSystemTemporalPrompt());

  // 1. ƯU TIÊN 1: Chạy qua 9Router Agent Loop (ag/gemini-3.7-flash-medium) nếu đã cấu hình
  try {
    const routerResult = await call9RouterAgentLoop(effectiveSystem, user, options);
    if (routerResult) {
      return routerResult;
    }
  } catch (routerErr) {
    console.warn("[gemini-agent] 9Router agent loop gặp sự cố, chuyển sang Google AI Studio fallback:", routerErr);
  }

  const rawKey = (process.env.GEMINI_API_KEY || config.geminiApiKey || "").trim();
  const apiKeys = rawKey.split(",").map((k) => k.trim()).filter(Boolean);

  if (apiKeys.length === 0) {
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  const allMedia = [...(options?.images || []), ...(options?.mediaParts || [])];
  const hasMedia = allMedia.length > 0;

  let rawPrimary = options?.model?.trim() || config.geminiModel || "gemini-3.6-flash";
  let primaryModel = (rawPrimary.startsWith("ag/") || rawPrimary.startsWith("cx/") || rawPrimary.includes("3.7") || rawPrimary.includes("3.8") || rawPrimary.includes("latest") || rawPrimary.includes("2.5") || rawPrimary.includes("3.1-flash-lite"))
    ? "gemini-3.6-flash"
    : rawPrimary;
  const maxTurns = options?.maxTurns || 2;
  const temperature = options?.temperature ?? 0.2;
  const maxTokens = options?.maxTokens;

  // Xây dựng userParts ban đầu
  const initialUserParts: Record<string, unknown>[] = [];
  for (const img of allMedia) {
    initialUserParts.push({
      inline_data: {
        mime_type: img.mimeType || "image/jpeg",
        data: img.data,
      },
    });
  }
  initialUserParts.push({ text: user });

  const contents: Array<{ role: string; parts: any[] }> = [
    {
      role: "user",
      parts: initialUserParts,
    },
  ];

  let apiKeyIdx = botKeyOffset % apiKeys.length;

  try {
    let currentModel = primaryModel;
    for (let turn = 0; turn < maxTurns; turn++) {
      let resp: Response | null = null;
      let lastErrText = "";

      // Thử gọi model với cơ chế retry nhanh (đổi key hoặc fallback model nếu gặp 503/429/timeout)
      const maxRetries = Math.min(Math.max(apiKeys.length, 3), 6);
      for (let retry = 0; retry < maxRetries; retry++) {
        const apiKey = apiKeys[apiKeyIdx];
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

        const requestBody: Record<string, unknown> = {
          system_instruction: {
            parts: [{ text: effectiveSystem ? `${effectiveSystem}\n\n${CAVEMAN_INTERNAL_DIRECTIVE}` : CAVEMAN_INTERNAL_DIRECTIVE }],
          },
          contents,
          tools: [AGENT_TOOLS_DECLARATION],
          generationConfig: {
            temperature,
            ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
            ...((currentModel.includes("3.7") || currentModel.includes("3.8")) && !hasMedia
              ? { thinkingConfig: { thinkingBudget: 256 } }
              : {}),
          },
        };

        try {
          const loopTimeout = hasMedia ? 45_000 : 15_000;
          resp = await fetch(endpoint, {
            method: "POST",
            signal: AbortSignal.timeout(loopTimeout),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          });

          if (resp.ok) {
            break;
          }

          lastErrText = await resp.text().catch(() => "");
          console.warn(`[gemini-agent] Turn ${turn + 1} (${currentModel}, Key #${apiKeyIdx + 1}) gặp HTTP ${resp.status}: ${lastErrText.slice(0, 150)}`);

          if (apiKeys.length > 1) {
            apiKeyIdx = (apiKeyIdx + 1) % apiKeys.length;
          }

          if (resp.status === 503 || resp.status === 429) {
            if (currentModel === "gemini-3.6-flash") {
              console.log(`[gemini-agent] ⚡ Chuyển sang model dự phòng gemini-3.1-flash-lite-preview do ${currentModel} quá tải ${resp.status}...`);
              currentModel = "gemini-3.1-flash-lite-preview";
            } else if (currentModel !== "gemini-3.6-flash") {
              console.log(`[gemini-agent] ⚡ Chuyển sang model dự phòng gemini-3.6-flash do ${currentModel} quá tải ${resp.status}...`);
              currentModel = "gemini-3.6-flash";
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
        } catch (fetchErr) {
          console.warn(`[gemini-agent] Turn ${turn + 1} (${currentModel}) fetch error:`, fetchErr);
          if (apiKeys.length > 1) {
            apiKeyIdx = (apiKeyIdx + 1) % apiKeys.length;
          }
          if (currentModel === "gemini-3.6-flash") {
            currentModel = "gemini-3.1-flash-lite-preview";
          } else {
            currentModel = "gemini-3.6-flash";
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (!resp || !resp.ok) {
        throw new Error(`Gemini Agent HTTP ${resp?.status || "ERR"}: ${lastErrText.slice(0, 200)}`);
      }

      const data = (await resp.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<any>;
          };
        }>;
      };

      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      if (parts.length === 0) {
        throw new Error("Candidate content rỗng từ Gemini API");
      }

      // Kiểm tra xem model có gọi functionCall nào không
      const functionCalls = parts
        .filter((p) => p.functionCall)
        .map((p) => p.functionCall);

      if (functionCalls.length === 0) {
        // Model không gọi tool nữa, trả lời hoàn tất!
        const textAnswer = parts
          .map((p) => p.text || "")
          .join("")
          .trim();
        botKeyOffset = (apiKeyIdx + 1) % apiKeys.length;
        return textAnswer;
      }

      // BẮT BUỘC: Thêm model turn vào contents, giữ nguyên toàn bộ parts (bao gồm thoughtSignature)
      contents.push({
        role: "model",
        parts,
      });

      console.log(
        `[gemini-agent] 🔄 Vòng ${turn + 1}/${maxTurns}: Model gọi ${functionCalls.length} tool(s): ` +
          functionCalls.map((fc: any) => `${fc.name}(${JSON.stringify(fc.args || {})})`).join(", "),
      );

      // Chạy các tool song song
      const toolResponses = await Promise.all(
        functionCalls.map(async (fc: any) => {
          if (fc.name === "generate_image") {
            if (!fc.args) fc.args = {};
            if (!fc.args.imageUrl && options?.targetImageUrl) {
              fc.args.imageUrl = options.targetImageUrl;
            }
            if (options?.targetImageUrl && fc.args.isEdit === undefined) {
              fc.args.isEdit = true;
            }
          }

          if (fc.name === "download_media_video") {
            if (!fc.args) fc.args = {};
            fc.args.format = resolveMediaDownloadFormat(fc.args.format, user);
          }
          options?.onToolCall?.(fc.name, fc.args || {});
          const result = await executeAgentTool(fc.name, fc.args || {}, options?.context);
          if ((fc.name === "generate_file" || fc.name === "create_voice" || fc.name === "generate_image" || fc.name === "generate_video" || fc.name === "generate_music" || (fc.name === "download_media_video" && result?.filePath) || (fc.name === "facebook_post_lookup" && result?.filePath)) && result?.success && options?.onFileGenerated) {
            try {
              await options.onFileGenerated({
                ...result,
                isMusic: fc.name === "generate_music",
                isVideo: fc.name === "generate_video" || Boolean(result?.isVideo),
              });
            } catch (fileErr) {
              console.warn(`[gemini-agent] onFileGenerated for ${fc.name} error:`, fileErr);
            }
          }
          if (fc.name === "python_interpreter" && result?.success && options?.onFileGenerated) {
            const allFiles = [...(result.generatedImages || []), ...(result.generatedFiles || [])];
            for (const itemPath of allFiles) {
              try {
                await options.onFileGenerated({
                  success: true,
                  filePath: itemPath,
                  fileName: path.basename(itemPath),
                  fileSize: fs.existsSync(itemPath) ? fs.statSync(itemPath).size : 0,
                });
              } catch (fileErr) {
                console.warn("[gemini-agent] onFileGenerated python runner error:", fileErr);
              }
            }
          }
          return {
            functionResponse: {
              name: fc.name,
              response: { result },
            },
          };
        }),
      );

      // Thêm kết quả trả về của tool vào contents cho vòng lặp tiếp theo
      contents.push({
        role: "user",
        parts: toolResponses,
      });
    }

    // Nếu đã hết maxTurns mà model vẫn gọi tool, gọi 1 lượt chốt không tool để tổng hợp văn bản
    const finalKey = apiKeys[apiKeyIdx];
    const finalEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel || primaryModel}:generateContent?key=${finalKey}`;
    const finalBody = {
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: {
        temperature,
        ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        ...(primaryModel.includes("3.7") || primaryModel.includes("2.5")
          ? { thinkingConfig: { thinkingBudget: 1024 } }
          : {}),
      },
    };
    const finalResp = await fetch(finalEndpoint, {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalBody),
    });
    if (finalResp.ok) {
      const finalData = (await finalResp.json()) as any;
      const candidate = finalData.candidates?.[0];
      const finalText = candidate?.content?.parts?.map((p: any) => p.text || "").join("").trim();
      if (finalText) {
        botKeyOffset = (apiKeyIdx + 1) % apiKeys.length;
        return finalText;
      }
    }
  } catch (agentErr) {
    console.warn("[gemini-agent] Lỗi agent loop, tự động fallback về callGemini:", agentErr);
  }

  // Graceful Fallback: Tìm kiếm DuckDuckGo trực tiếp và gọi callGemini chuẩn
  try {
    const queryForSearch = user.replace(/<[^>]+>/g, " ").slice(0, 100).trim();
    const fallbackResults = await webSearch(queryForSearch, 4);
    let enrichedUser = user;
    if (fallbackResults.length > 0) {
      enrichedUser += `\n\n=== DỮ LIỆU TÌM KIẾM BỔ SUNG ===\n` +
        fallbackResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nNguồn: ${r.url}`).join("\n\n");
    }
    return await callGemini(system, enrichedUser, {
      model: options?.model,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      images: options?.images,
      mediaParts: options?.mediaParts,
    });
  } catch (fallbackErr) {
    throw fallbackErr;
  }
}


import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import {
  webSearch,
  fetchUrl,
  wikiLookup,
  hnSearch,
  arxivSearch,
  githubSearch,
} from "./tools/vertical-tools.js";
import {
  generateWordDoc,
  generateExcelFile,
  generateTextFile,
  generatePowerPointFile,
  generateCsvFile,
  generateHtmlFile,
  parseMarkdownToSlides,
  type GeneratedFileResult,
  type ThemeName,
} from "./tools/file-generator.js";
import {
  synthesizeSpeech,
  synthesizeDialogue,
  isDialogueText,
  normalizeDialogueTurns,
} from "./tools/voice-generator.js";
import { runPythonCode } from "./tools/python-runner.js";
import {
  getCryptoTicker,
  getFearAndGreedIndex,
  getFinancialMarketSummary,
} from "./tools/finance-tools.js";
import { fetchWeatherData } from "./weather.js";
import { getSystemTemporalPrompt } from "./temporal.js";
import { callCloudflareLlm, isCloudflareConfigured } from "./cloudflare-ai.js";
import {
  canUseGrounding,
  incrementGroundingUsage,
  markGroundingExhausted,
} from "./grounding-quota.js";
import { callVertexGemini, isVertexConfigured } from "./vertex-gemini.js";

/**
 * Lớp gọi Google Gemini API dùng chung (Tóm tắt hội thoại Zalo, bóc tách dữ liệu).
 * Hỗ trợ các dòng model Gemini (Gemini 2.5 Flash, Gemini 3.7 Flash, Gemini 3.1 Pro, v.v.).
 */
let botKeyOffset = 0;

export interface GeminiImagePart {
  data: string; // Base64 string
  mimeType: string; // e.g. 'image/jpeg', 'image/png', 'application/pdf', 'audio/mp3'
}

export type GeminiMediaPart = GeminiImagePart;

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

  const cleanHeader = (headerContentType.split(";")[0] || "").trim().toLowerCase();
  if (cleanHeader && cleanHeader !== "application/octet-stream" && cleanHeader !== "binary/octet-stream") {
    return cleanHeader;
  }

  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "pdf") return "application/pdf";
  if (ext === "mp3") return "audio/mp3";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a") return "audio/mp4";

  return cleanHeader || "application/octet-stream";
}

export async function downloadImageBase64(url: string): Promise<GeminiImagePart | null> {
  try {
    if (fs.existsSync(url)) {
      const buffer = fs.readFileSync(url);
      if (!buffer || buffer.length === 0) return null;
      const mime = detectMimeType(buffer, url, "");
      return {
        data: buffer.toString("base64"),
        mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
      };
    }

    const maxRetries = 3;
    let buffer: Buffer = Buffer.alloc(0);
    let contentType = "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
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

    const mime = detectMimeType(buffer, url, contentType);
    return {
      data: buffer.toString("base64"),
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
  error?: "FILE_TOO_LARGE" | "DOWNLOAD_TIMEOUT" | "DOWNLOAD_FAILED" | "UNSUPPORTED_IMAGE_FORMAT";
  fileSizeBytes?: number;
  unsupportedMime?: string;
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

    if (fs.existsSync(url)) {
      const stats = fs.statSync(url);
      if (stats.size > 50 * 1024 * 1024) {
        return { error: "FILE_TOO_LARGE", fileSizeBytes: stats.size };
      }
      buffer = fs.readFileSync(url);
    } else {
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const res = await fetch(url, {
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

          if (res.body) {
            const chunks: Uint8Array[] = [];
            let totalBytes = 0;
            const reader = res.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                totalBytes += value.length;
                if (totalBytes > 50 * 1024 * 1024) {
                  await reader.cancel();
                  console.warn(`[gemini] File stream vượt quá 50MB (${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
                  return {
                    error: "FILE_TOO_LARGE",
                    fileSizeBytes: totalBytes,
                  };
                }
                chunks.push(value);
              }
            }
            buffer = Buffer.concat(chunks);
          } else {
            const arrayBuffer = await res.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
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

    const detectedMime = detectMimeType(buffer, fileName || url, contentType);
    const ext = (fileName.split(".").pop() || url.split(".").pop() || "").toLowerCase();

    // 1. File PDF: Ưu tiên bóc tách toàn bộ Text bằng unpdf siêu tốc, nhẹ RAM & xử lý file nặng không giới hạn MB
    if (detectedMime === "application/pdf" || ext === "pdf") {
      try {
        const { extractText } = await import("unpdf");
        const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const pdfResult = await extractText(uint8, { mergePages: true });
        const extracted = (pdfResult?.text || "").trim();
        if (extracted.length >= 50) {
          console.log(`[gemini] 📄 Đã trích xuất ${extracted.length.toLocaleString("vi-VN")} ký tự văn bản từ PDF "${fileName || "tài liệu"}" (${pdfResult.totalPages} trang)`);
          return { textContent: extracted };
        }
      } catch (pdfErr) {
        console.warn(`[gemini] Không thể trích xuất text từ PDF bằng unpdf, thử multimodal:`, pdfErr);
      }

      // Nếu là PDF scan dạng ảnh thuần túy:
      // Chỉ gửi Multimodal cho Gemini nếu file <= 15MB (để không vượt quá giới hạn 20MB payload API)
      if (buffer.length <= 15 * 1024 * 1024) {
        return {
          mediaPart: {
            data: buffer.toString("base64"),
            mimeType: "application/pdf",
          },
        };
      } else {
        console.warn(`[gemini] File PDF scan không có text layer và quá nặng (${(buffer.length / 1024 / 1024).toFixed(1)}MB > 15MB)`);
        return {
          textContent: `[File PDF scan dạng ảnh "${fileName || "tài liệu"}" nặng ${(buffer.length / 1024 / 1024).toFixed(1)}MB, không chứa lớp văn bản và vượt quá giới hạn OCR 15MB của AI API. Vui lòng chuyển thành file PDF văn bản hoặc gửi ảnh từng trang để bot đọc.]`,
        };
      }
    }

    // 2. File Hình ảnh (Gemini đọc Multimodal native)
    if (detectedMime.startsWith("image/")) {
      const geminiSupportedImageMimes = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
      ]);

      if (geminiSupportedImageMimes.has(detectedMime)) {
        return {
          mediaPart: {
            data: buffer.toString("base64"),
            mimeType: detectedMime,
          },
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
        };
      } catch (convErr) {
        console.warn(`[gemini] Định dạng ảnh ${detectedMime} không hỗ trợ và không thể convert sang JPEG:`, convErr);
        return {
          error: "UNSUPPORTED_IMAGE_FORMAT",
          unsupportedMime: detectedMime,
          textContent: `[Ảnh đính kèm có định dạng "${detectedMime}" hiện chưa được AI hỗ trợ giải mã. Vui lòng chụp lại màn hình hoặc lưu ảnh dạng JPG/PNG để bot phân tích nhé!]`,
        };
      }
    }

    // 2. File Âm thanh / Voice
    if (detectedMime.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg", "aac"].includes(ext)) {
      return {
        mediaPart: {
          data: buffer.toString("base64"),
          mimeType: detectedMime.startsWith("audio/") ? detectedMime : "audio/mp3",
        },
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
    if (buffer.length < 5 * 1024 * 1024) {
      const text = buffer.toString("utf-8");
      if (!/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1000))) {
        return { textContent: text };
      }
    }

    // Nếu vẫn là ảnh (ví dụ định dạng chưa phổ biến) thì trả về mediaPart
    if (detectedMime && !detectedMime.includes("octet-stream")) {
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

export function isJunkOrBettingDomain(domainOrTitle: string): boolean {
  if (!domainOrTitle) return true;
  const lower = domainOrTitle.toLowerCase().trim();
  const junkPatterns = [
    /(?:keo\d+|keonhacai|tylekeo|soikeo|nhacai|cacuoc|cadobongda|nhacaiuytin)/i,
    /(?:xoilac|tiengruoi|mitom|vebo|thapcam|banhkhuc|cakhia|rakhoi|xoivo|suongtv|khangtv|shutli)/i,
    /(?:bet88|bong88|w88|fb88|fun88|bk8|kubet|thabet|shbet|new88|789bet|jun88|hi88|okvip|f8bet|12bet|dafabis|m88|188bet|k8cc|mu88)/i,
    /(?:keo90phut|xoilacvl|xoilacz|cakhiatv|vebotv)/i,
    /(?:mebongda|ketquanhanh|bongdawap|bongdalu|7m\.cn|nowgoal|flashscore|tysobongda)/i,
  ];
  return junkPatterns.some((re) => re.test(lower));
}

/** Bóc tách tên nhà xuất bản / tòa soạn báo chí từ uri và title để trích dẫn ngắn gọn (không in link URL) */
export function extractPublisherName(title?: string, uri?: string): string {
  if ((title && isJunkOrBettingDomain(title)) || (uri && isJunkOrBettingDomain(uri))) {
    return "";
  }
  const domainMap: Record<string, string> = {
    "vnexpress.net": "VnExpress",
    "cafef.vn": "CafeF",
    "cafebiz.vn": "CafeBiz",
    "vietstock.vn": "Vietstock",
    "thanhnien.vn": "Thanh Niên",
    "tuoitre.vn": "Tuổi Trẻ",
    "vietnamnet.vn": "VietNamNet",
    "dantri.com.vn": "Dân Trí",
    "vtv.vn": "VTV",
    "vov.vn": "VOV",
    "vneconomy.vn": "VnEconomy",
    "laodong.vn": "Lao Động",
    "tienphong.vn": "Tiền Phong",
    "plo.vn": "Pháp Luật TP.HCM",
    "baochinhphu.vn": "Báo Chính Phủ",
    "nhandan.vn": "Báo Nhân Dân",
    "tinnhanhchungkhoan.vn": "Đầu Tư Chứng Khoán",
    "baodautu.vn": "Báo Đầu Tư",
    "znews.vn": "Znews",
    "zingnews.vn": "Znews",
    "genk.vn": "GenK",
    "tinhte.vn": "Tinh tế",
    "bongda.com.vn": "Bóng Đá",
    "bongdaplus.vn": "Bóng Đá Plus",
    "bongda24h.vn": "Bóng Đá 24h",
    "goal.com": "Goal.com",
    "fotmob.com": "FotMob",
    "onefootball.com": "OneFootball",
    "baomoi.com": "Báo Mới",
    "24h.com.vn": "24h",
    "foxsports.com": "Fox Sports",
    "laliga.com": "LaLiga",
    "bloomberg.com": "Bloomberg",
    "reuters.com": "Reuters",
    "cnbc.com": "CNBC",
    "wsj.com": "Wall Street Journal",
    "ft.com": "Financial Times",
    "forbes.com": "Forbes",
    "investing.com": "Investing.com",
    "marketwatch.com": "MarketWatch",
    "finance.yahoo.com": "Yahoo Finance",
    "wikipedia.org": "Wikipedia",
  };

  const rawTitle = (title || "").trim().toLowerCase();

  // 1. Kiểm tra nếu title chính là tên miền (Google Search Grounding thường trả title = "bongda.com.vn", "goal.com", v.v.)
  for (const [d, name] of Object.entries(domainMap)) {
    if (rawTitle === d || rawTitle.includes(d)) {
      return name;
    }
  }

  // 2. Nếu URI không phải là link redirect nội bộ của Vertex AI thì kiểm tra domain từ URI
  if (uri && !uri.includes("vertexaisearch.cloud.google.com")) {
    try {
      const hostname = new URL(uri).hostname.toLowerCase().replace(/^www\./, "");
      if (isJunkOrBettingDomain(hostname)) return "";
      for (const [d, name] of Object.entries(domainMap)) {
        if (hostname === d || hostname.endsWith("." + d)) {
          return name;
        }
      }
    } catch {}
  }

  // 3. Nếu title có cấu trúc "Tiêu đề bài viết - Tên Báo"
  if (title) {
    const parts = title.split(/\s*[-–—|]\s*/);
    if (parts.length > 1) {
      const lastPart = parts[parts.length - 1]?.trim() || "";
      if (lastPart.length > 1 && lastPart.length < 30 && !isJunkOrBettingDomain(lastPart)) {
        return lastPart.replace(/^báo\s+/i, "");
      }
    }
    // Nếu title là một domain bất kỳ (e.g. somesite.com)
    if (/^[a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?$/i.test(title.trim())) {
      const host = title.trim().replace(/^www\./i, "");
      if (isJunkOrBettingDomain(host)) return "";
      const base = host.split(".")[0];
      return base ? base.charAt(0).toUpperCase() + base.slice(1) : host;
    }
    if (isJunkOrBettingDomain(title)) return "";
    return title.length > 25 ? title.slice(0, 25) + "..." : title;
  }

  return "";
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

  if (apiKeys.length === 0) {
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  let primaryModel = options?.model?.trim() || config.geminiModel || "gemini-3-flash-preview";
  if (isSearchEnabled) {
    primaryModel = "gemini-3-flash-preview";
  } else if (!primaryModel || primaryModel.includes("3.1-flash-lite")) {
    primaryModel = "gemini-3-flash-preview";
  }

  // Danh sách model cascading dự phòng khi model chính nghẽn mạng / 503 / 429 / Timeout:
  const candidateFallbacks = [
    "gemini-3-flash-preview",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.1-flash-lite-preview",
    "gemini-flash-lite-latest",
  ].filter((m) => m !== primaryModel);

  const temperature = options?.temperature ?? 0.3;
  const maxTokens = options?.maxTokens;

  let lastError: unknown;
  const numKeys = apiKeys.length;

  const userParts: Record<string, unknown>[] = [];
  const allMedia = [...(options?.images || []), ...(options?.mediaParts || [])];
  if (allMedia.length > 0) {
    for (const img of allMedia) {
      userParts.push({
        inline_data: {
          mime_type: img.mimeType || "image/jpeg",
          data: img.data,
        },
      });
    }
  }
  userParts.push({ text: user });

  const effectiveSystemBase = system?.includes("SYSTEM TEMPORAL ANCHOR")
    ? system
    : (system ? `${getSystemTemporalPrompt()}\n\n${system}` : getSystemTemporalPrompt());

  const searchSystemGuard = isSearchEnabled
    ? `\n\n=== CHỈ THỊ AN TOÀN NGUỒN TIN TÌM KIẾM (SEARCH GROUNDING HYGIENE) ===\n` +
      `- CHỈ ĐƯỢC trích xuất dữ liệu từ các cơ quan báo chí chính thống, cổng thông tin chính thức của giải đấu/tổ chức, hoặc các nguồn uy tín (Bongdaplus, 24h, VnExpress, Tuổi Trẻ, LaLiga, UEFA, FIFA, Báo Đầu Tư, Dân Trí, v.v.).\n` +
      `- TUYỆT ĐỐI BỎ QUA và KHÔNG sử dụng thông tin hay trích dẫn từ các website cá độ bóng đá, web xem bóng đá lậu (như Xoilac, Mitom, Thapcam, VeBo...), web spam SEO clickbait. Nếu dữ liệu chỉ xuất hiện từ các trang này, hãy xem như chưa có thông tin chính thức.\n`
    : "";

  const effectiveSystem = effectiveSystemBase + searchSystemGuard;

  // 🌐 NẾU CẦN SEARCH GROUNDING & VERTEX AI ĐÃ CẤU HÌNH:
  // Chỉ dùng Vertex AI khi cần Google Search Grounding để hưởng 1.500 lượt search miễn phí/ngày và trừ vào $300 credit.
  // Khi chat thường hoặc tóm tắt (không search), bot tiếp tục dùng các key cũ hoàn toàn miễn phí.
  if (isSearchEnabled && isVertexConfigured()) {
    try {
      const vertexRes = await callVertexGemini(user, {
        model: "gemini-2.5-flash",
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

    // 1. Thử model chính (primaryModel, mặc định gemini-flash-lite-latest siêu tốc, 20s khi có Search Grounding)
    try {
      const primaryTimeout = isSearchEnabled ? 20_000 : 8_000;
      const primaryRes = await executeModel(primaryModel, primaryTimeout);
      if (primaryRes) {
        botKeyOffset = (keyIdx + 1) % numKeys;
        return primaryRes;
      }
    } catch (err) {
      lastError = err;
      console.warn(`[gemini] Lỗi gọi model chính ${primaryModel} (Key #${keyIdx + 1}): ${String(err)}`);
    }

    // 2. Tự động cascading fallback nếu primaryModel nghẽn hoặc lỗi
    for (const fbModel of candidateFallbacks) {
      try {
        console.log(`[gemini] ⚡ Model chính gặp lỗi/nghẽn, tự động chuyển sang model dự phòng: ${fbModel}...`);
        delete requestBody.tools; // Gỡ bỏ tool search vì các model lite không hỗ trợ google_search
        const fbRes = await executeModel(fbModel, 6_000);
        if (fbRes) {
          console.log(`[gemini] ✅ Đã phản hồi thành công qua fallback model ${fbModel}!`);
          botKeyOffset = (keyIdx + 1) % numKeys;
          return fbRes;
        }
      } catch (fbErr) {
        console.warn(`[gemini] Fallback ${fbModel} cũng gặp lỗi: ${String(fbErr)}`);
      }
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
  if (isCloudflareConfigured()) {
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

export interface AgentLoopOptions {
  model?: string;
  maxTurns?: number; // default 3
  temperature?: number;
  maxTokens?: number;
  images?: GeminiImagePart[];
  mediaParts?: GeminiMediaPart[];
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onFileGenerated?: (file: GeneratedFileResult) => Promise<void>;
}

const AGENT_TOOLS_DECLARATION = {
  functionDeclarations: [
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
      description: "Tạo và xuất file tài liệu thực tế (PowerPoint .pptx, Word .docx, Excel .xlsx, CSV .csv, HTML .html, Markdown .md, Text .txt, Code .py/.js/.sh) khi người dùng RA LỆNH VÀ CÓ NỘI DUNG CỤ THỂ để soạn thảo bài thuyết trình, văn bản hành chính, báo cáo, SOP, hợp đồng, bảng tính, báo giá. LƯU Ý: Không gọi khi người dùng chỉ hỏi thăm tính năng chung.",
      parameters: {
        type: "OBJECT",
        properties: {
          fileType: {
            type: "STRING",
            enum: ["pptx", "docx", "xlsx", "csv", "html", "md", "txt", "code"],
            description: "Định dạng file: 'pptx' (PowerPoint slide), 'docx' (Word), 'xlsx' (Excel), 'csv' (CSV BOM tiếng Việt), 'html' (HTML web report), 'md' (Markdown/SOP), 'txt' (văn bản thuần), 'code' (mã nguồn)",
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
            description: "Nội dung cần đọc. Nếu là Podcast/đối thoại thì viết theo cấu trúc: 'Tên: Lời thoại' cho mỗi lượt nói.",
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
  ],
};

export async function executeAgentTool(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
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
      const title = String(args?.title || "Tài liệu").trim();
      const content = String(args?.content || "").trim();
      const theme = (args?.theme || "navy") as ThemeName;

      if (fileType === "pptx") {
        let slides = Array.isArray(args?.slides) ? (args.slides as any) : [];
        if (slides.length === 0 && content) {
          slides = parseMarkdownToSlides(content, title);
        }
        const result = await generatePowerPointFile(fileName, title, slides, theme);
        return result;
      } else if (fileType === "xlsx") {
        if (Array.isArray(args?.sheets) && args.sheets.length > 0) {
          const result = await generateExcelFile(fileName, args.sheets as any, theme);
          return result;
        } else {
          const headers = Array.isArray(args?.excelHeaders) ? args.excelHeaders.map(String) : ["STT", "Nội dung", "Ghi chú"];
          const rows = Array.isArray(args?.excelRows) ? (args.excelRows as any) : [];
          const result = await generateExcelFile(fileName, title || "Sheet1", headers, rows, theme);
          return result;
        }
      } else if (fileType === "docx") {
        const headingPattern = /^(?:#{1,4}\s*|[A-Z0-9IVX]+[\.:\)]\s*|(?:KỊCH BẢN|PHẦN|CHƯƠNG|MỤC|BÀI|ĐIỀU|KHOẢN|GIAI ĐOẠN|THÁNG)\s+[0-9IVX]+[:\.\s])/iu;
        const rawSections = content.split(/\n(?=#{1,4}\s|[A-Z0-9IVX]+[\.:\)]\s|(?:KỊCH BẢN|PHẦN|CHƯƠNG|MỤC|BÀI|ĐIỀU|KHOẢN|GIAI ĐOẠN|THÁNG)\s+[0-9IVX]+[:\.\s])/giu);
        const sections = rawSections.map((sec) => {
          const lines = sec.trim().split("\n");
          let heading = "";
          let paras = lines;
          if (lines[0] && headingPattern.test(lines[0])) {
            heading = lines[0].replace(/^#+\s*/, "").trim();
            paras = lines.slice(1);
          }
          return { heading, paragraphs: paras.filter(Boolean) };
        });
        const result = await generateWordDoc(fileName, title, sections);
        return result;
      } else if (fileType === "csv") {
        const headers = Array.isArray(args?.excelHeaders) ? args.excelHeaders.map(String) : ["STT", "Nội dung", "Ghi chú"];
        const rows = Array.isArray(args?.excelRows) ? (args.excelRows as any) : [];
        const result = await generateCsvFile(fileName, headers, rows);
        return result;
      } else if (fileType === "html") {
        const result = await generateHtmlFile(fileName, title, content);
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
    case "python_interpreter": {
      const code = String(args?.code || "").trim();
      if (!code) return { error: "Không có mã code Python nào để chạy" };
      const res = await runPythonCode(code);
      return res;
    }
    default:
      return { error: `Công cụ ${name} không tồn tại` };
  }
}

/**
 * Agent Loop gọi Gemini với khả năng tự chọn tool (web_search, fetch_url, wiki_lookup, hn_search, arxiv_search, github_search).
 * Tối đa 3 vòng lặp. Tự động bảo lưu thoughtSignature và cascading fallback an toàn.
 */
export async function callGeminiAgentLoop(
  system: string,
  user: string,
  options?: AgentLoopOptions,
): Promise<string> {
  const rawKey = (process.env.GEMINI_API_KEY || config.geminiApiKey || "").trim();
  const apiKeys = rawKey.split(",").map((k) => k.trim()).filter(Boolean);

  if (apiKeys.length === 0) {
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  let primaryModel = options?.model?.trim() || config.geminiModel || "gemini-3-flash-preview";
  if (!primaryModel || primaryModel.includes("3.1-flash-lite")) {
    primaryModel = "gemini-3-flash-preview";
  }
  const maxTurns = options?.maxTurns || 2;
  const temperature = options?.temperature ?? 0.2;
  const maxTokens = options?.maxTokens;

  // Xây dựng userParts ban đầu
  const initialUserParts: Record<string, unknown>[] = [];
  const allMedia = [...(options?.images || []), ...(options?.mediaParts || [])];
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

  const effectiveSystem = system?.includes("SYSTEM TEMPORAL ANCHOR")
    ? system
    : (system ? `${getSystemTemporalPrompt()}\n\n${system}` : getSystemTemporalPrompt());

  try {
    let currentModel = primaryModel;
    for (let turn = 0; turn < maxTurns; turn++) {
      let resp: Response | null = null;
      let lastErrText = "";

      // Thử gọi model với cơ chế retry nhanh (đổi key hoặc fallback model nếu gặp 503/429)
      for (let retry = 0; retry < 2; retry++) {
        const apiKey = apiKeys[apiKeyIdx];
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

        const requestBody: Record<string, unknown> = {
          system_instruction: effectiveSystem ? { parts: [{ text: effectiveSystem }] } : undefined,
          contents,
          tools: [AGENT_TOOLS_DECLARATION],
          generationConfig: {
            temperature,
            ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
            ...(currentModel.includes("3.7") || currentModel.includes("2.5")
              ? { thinkingConfig: { thinkingBudget: 256 } }
              : {}),
          },
        };

        try {
          resp = await fetch(endpoint, {
            method: "POST",
            signal: AbortSignal.timeout(10_000),
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

          if (resp.status === 503) {
            if (currentModel !== "gemini-flash-latest") {
              console.log(`[gemini-agent] ⚡ Chuyển sang model dự phòng gemini-flash-latest do ${currentModel} quá tải 503...`);
              currentModel = "gemini-flash-latest";
            }
            await new Promise((r) => setTimeout(r, 1000));
          } else if (resp.status === 429) {
            await new Promise((r) => setTimeout(r, 1500));
          }
        } catch (fetchErr) {
          console.warn(`[gemini-agent] Turn ${turn + 1} fetch error:`, fetchErr);
          if (apiKeys.length > 1) {
            apiKeyIdx = (apiKeyIdx + 1) % apiKeys.length;
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
          options?.onToolCall?.(fc.name, fc.args || {});
          const result = await executeAgentTool(fc.name, fc.args || {});
          if ((fc.name === "generate_file" || fc.name === "create_voice") && result?.success && options?.onFileGenerated) {
            try {
              await options.onFileGenerated(result);
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
    const finalEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${primaryModel}:generateContent?key=${finalKey}`;
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


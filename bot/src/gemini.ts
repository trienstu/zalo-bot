import fs from "node:fs";
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
  type GeneratedFileResult,
} from "./tools/file-generator.js";
import {
  getCryptoTicker,
  getFearAndGreedIndex,
  getFinancialMarketSummary,
} from "./tools/finance-tools.js";
import { getSystemTemporalPrompt } from "./temporal.js";

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
      const mime = detectMimeType(buffer, url, "");
      return {
        data: buffer.toString("base64"),
        mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
      };
    }

    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get("content-type") || "";
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
  error?: "FILE_TOO_LARGE" | "DOWNLOAD_TIMEOUT" | "DOWNLOAD_FAILED";
  fileSizeBytes?: number;
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
    let buffer: Buffer;
    let contentType = "";

    if (fs.existsSync(url)) {
      const stats = fs.statSync(url);
      if (stats.size > 50 * 1024 * 1024) {
        return { error: "FILE_TOO_LARGE", fileSizeBytes: stats.size };
      }
      buffer = fs.readFileSync(url);
    } else {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60_000), // 60s timeout cho file tài liệu nặng (20MB-50MB)
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
      });
      if (!res.ok) return { error: "DOWNLOAD_FAILED" };

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
      return {
        mediaPart: {
          data: buffer.toString("base64"),
          mimeType: detectedMime,
        },
      };
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
  const apiKeys = rawKey.split(",").map((k) => k.trim()).filter(Boolean);

  if (apiKeys.length === 0) {
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  let primaryModel = options?.model?.trim() || process.env.GEMINI_MODEL?.trim() || config.geminiModel || "gemini-3.7-flash";
  // Nếu env cũ chứa bản 3.5-flash cũ (đã bị đóng) hoặc rỗng, mặc định gemini-3.7-flash (giữ lại gemini-3.5-flash-lite)
  if (!primaryModel || (primaryModel.includes("3.5") && !primaryModel.includes("lite"))) {
    primaryModel = "gemini-3.7-flash";
  }

  // Danh sách model cascading dự phòng khi model chính nghẽn mạng / 503 / 429 / Timeout:
  // 1. gemini-flash-lite-latest: Siêu tốc <1s, độ ổn định cực cao
  // 2. gemini-3.8-flash: Bản mới nhất
  // 3. gemini-3.7-flash: Bản tiêu chuẩn chất lượng cao
  // 4. gemini-3.5-flash-lite: Bản lite 3.5 siêu tốc (~670ms)
  // 5. gemini-3.1-flash-lite-preview: Bản lite 3.1
  const candidateFallbacks = [
    "gemini-flash-lite-latest",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite-preview",
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

  const effectiveSystem = system?.includes("SYSTEM TEMPORAL ANCHOR")
    ? system
    : (system ? `${getSystemTemporalPrompt()}\n\n${system}` : getSystemTemporalPrompt());

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
      ...(options?.enableSearch ? { tools: [{ google_search: {} }] } : {}),
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
      if (!resp.ok && options?.enableSearch && resp.status === 429) {
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
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const candidate = data.candidates?.[0];
      let content = candidate?.content?.parts?.map((p: { text?: string }) => p.text || "").join("").trim();
      if (!content) {
        lastError = new Error(`Response Gemini API (${targetModel}) rỗng`);
        return null;
      }

      // Trích xuất grounding metadata nếu có (chuẩn Vertex AI Search / Grounding như bot Kevin)
      const groundingMetadata = (candidate as any)?.groundingMetadata;
      if (groundingMetadata?.groundingChunks && Array.isArray(groundingMetadata.groundingChunks)) {
        const sources: string[] = [];
        groundingMetadata.groundingChunks.forEach((chunk: any, idx: number) => {
          if (chunk.web?.uri) {
            const domain = chunk.web.title || (function() {
              try {
                return new URL(chunk.web.uri).hostname.replace(/^www\./, "");
              } catch {
                return "Nguồn";
              }
            })();
            sources.push(`${idx + 1}. ${domain}: ${chunk.web.uri}`);
          }
        });
        if (sources.length > 0 && !content.includes("Nguồn tham khảo")) {
          content += `\n\nNguồn tham khảo:\n${sources.join("\n")}`;
        }
      }

      return content;
    };

    // 1. Thử model chính (primaryModel, mặc định gemini-3.7-flash)
    try {
      const primaryRes = await executeModel(primaryModel, 15_000);
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
        const fbRes = await executeModel(fbModel, 10_000);
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
      description: "Tạo và xuất file tài liệu thực tế (Word .docx, Excel .xlsx, Markdown .md, Text .txt, Code .py/.js/.sh) khi người dùng yêu cầu soạn thảo văn bản, báo cáo, SOP, hợp đồng, bảng tính, báo giá, hoặc tổng hợp thành file gửi vào Zalo.",
      parameters: {
        type: "OBJECT",
        properties: {
          fileType: {
            type: "STRING",
            description: "Định dạng file cần xuất: 'docx' (Word), 'xlsx' (Excel), 'md' (Markdown/SOP), 'txt' (văn bản thuần), 'code' (mã nguồn)",
          },
          fileName: {
            type: "STRING",
            description: "Tên file viết liền không dấu, ví dụ: 'sop_xay_dung_bot_zalo', 'bao_gia_thiet_bi'",
          },
          title: {
            type: "STRING",
            description: "Tiêu đề chính của tài liệu hoặc văn bản",
          },
          content: {
            type: "STRING",
            description: "Toàn bộ nội dung văn bản chi tiết đầy đủ (dành cho file docx, md, txt, code)",
          },
          excelHeaders: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Danh sách tên cột cho file Excel (chỉ dùng khi fileType là xlsx)",
          },
          excelRows: {
            type: "ARRAY",
            items: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
            description: "Mảng 2 chiều chứa các dòng dữ liệu cho file Excel (chỉ dùng khi fileType là xlsx)",
          },
        },
        required: ["fileType", "fileName", "title"],
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
  ],
};

async function executeAgentTool(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
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

      if (fileType === "xlsx") {
        const headers = Array.isArray(args?.excelHeaders) ? args.excelHeaders.map(String) : ["STT", "Nội dung", "Ghi chú"];
        const rows = Array.isArray(args?.excelRows) ? args.excelRows : [];
        const result = await generateExcelFile(fileName, title || "Sheet1", headers, rows);
        return result;
      } else if (fileType === "docx") {
        const rawSections = content.split(/\n(?=#{1,3}\s|[A-Z0-9IVX]+\.\s)/g);
        const sections = rawSections.map((sec) => {
          const lines = sec.trim().split("\n");
          let heading = "";
          let paras = lines;
          if (lines[0] && (lines[0].startsWith("#") || /^[A-Z0-9IVX]+\.\s/.test(lines[0]))) {
            heading = lines[0].replace(/^#+\s*/, "").trim();
            paras = lines.slice(1);
          }
          return { heading, paragraphs: paras.filter(Boolean) };
        });
        const result = await generateWordDoc(fileName, title, sections);
        return result;
      } else {
        const ext = fileType === "code" ? (args?.fileExt || "txt") : fileType;
        const result = await generateTextFile(fileName, content, ext);
        return result;
      }
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

  const primaryModel = options?.model?.trim() || process.env.GEMINI_MODEL?.trim() || config.geminiModel || "gemini-3.7-flash";
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
            signal: AbortSignal.timeout(30_000),
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
          if (fc.name === "generate_file" && result?.success && options?.onFileGenerated) {
            try {
              await options.onFileGenerated(result);
            } catch (fileErr) {
              console.warn("[gemini-agent] onFileGenerated callback error:", fileErr);
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


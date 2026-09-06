import { updatePermanentKnowledgeContent, type PermanentKnowledgeItem } from "./db/index.js";

export interface ParsedGoogleUrl {
  type: "google_sheet" | "google_doc";
  id: string;
  gid?: string;
  exportUrl: string;
  originalUrl: string;
}

/**
 * Nhận diện và bóc tách thông tin từ đường dẫn Google Sheets hoặc Google Docs.
 */
export function parseGoogleUrl(rawUrl: string): ParsedGoogleUrl | null {
  const url = (rawUrl || "").trim();
  if (!url) return null;

  // 1. Google Sheets
  const sheetMatch = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (sheetMatch && sheetMatch[1]) {
    const id = sheetMatch[1];
    let gid = "0";
    const gidMatch = url.match(/[?&#]gid=([0-9]+)/i);
    if (gidMatch && gidMatch[1]) {
      gid = gidMatch[1];
    }
    const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    return {
      type: "google_sheet",
      id,
      gid,
      exportUrl,
      originalUrl: url,
    };
  }

  // 2. Google Docs
  const docMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/i);
  if (docMatch && docMatch[1]) {
    const id = docMatch[1];
    const exportUrl = `https://docs.google.com/document/d/${id}/export?format=txt`;
    return {
      type: "google_doc",
      id,
      exportUrl,
      originalUrl: url,
    };
  }

  return null;
}

/**
 * Trình phân tích cú pháp CSV chuẩn (hỗ trợ dấu nháy kép, dấu phẩy trong ô và xuống dòng).
 */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const nextChar = csv[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentCell += '"';
        i++; // Bỏ qua dấu nháy thứ hai
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Chuyển đổi dữ liệu CSV từ Google Sheet thành dạng bảng / danh sách cấu trúc tối ưu cho AI Gemini đọc hiểu.
 */
export function csvToStructuredText(csv: string, maxRows = 300): string {
  const rows = parseCsv(csv);
  if (rows.length === 0 || !rows[0]) return "";

  // Dòng đầu tiên thường là tiêu đề cột
  const firstRow = rows[0];
  const headers = firstRow.map((h, idx) => (h ? h : `Cột ${idx + 1}`));
  const dataRows = rows.slice(1, maxRows + 1);

  const lines: string[] = [];
  lines.push(`=== DỮ LIỆU BẢNG TÍNH GOOGLE SHEETS (${dataRows.length} dòng dữ liệu) ===`);
  lines.push(`TIÊU ĐỀ CỘT: ${headers.join(" | ")}\n`);

  for (let idx = 0; idx < dataRows.length; idx++) {
    const row = dataRows[idx];
    if (!row) continue;
    const entries: string[] = [];
    for (let c = 0; c < headers.length; c++) {
      const val = row[c] ?? "";
      if (val) {
        entries.push(`${headers[c]}: ${val}`);
      }
    }
    if (entries.length > 0) {
      lines.push(`- Dòng ${idx + 1}: ${entries.join(" | ")}`);
    }
  }

  if (rows.length - 1 > maxRows) {
    lines.push(`\n... (Còn ${rows.length - 1 - maxRows} dòng dữ liệu khác)`);
  }

  return lines.join("\n");
}

export interface FetchGoogleResult {
  ok: boolean;
  type: "google_sheet" | "google_doc";
  text?: string;
  error?: "PERMISSION_DENIED" | "NETWORK_ERROR" | "EMPTY_CONTENT" | "INVALID_URL";
  rawSnippet?: string;
}

/**
 * Tải nội dung từ Google Sheet (CSV export) hoặc Google Doc (TXT export).
 */
export async function fetchGoogleContent(rawUrl: string): Promise<FetchGoogleResult> {
  const parsed = parseGoogleUrl(rawUrl);
  if (!parsed) {
    return { ok: false, type: "google_sheet", error: "INVALID_URL" };
  }

  try {
    const res = await fetch(parsed.exportUrl, {
      signal: AbortSignal.timeout(15_000), // 15 giây timeout
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { ok: false, type: parsed.type, error: "PERMISSION_DENIED" };
      }
      return { ok: false, type: parsed.type, error: "NETWORK_ERROR" };
    }

    const textContent = await res.text();

    // Kiểm tra nếu Google chuyển hướng về trang Đăng nhập Google (do Sheet/Doc chưa mở quyền Người xem)
    if (
      textContent.includes("accounts.google.com") ||
      textContent.includes("<html") ||
      textContent.includes("<!DOCTYPE html") ||
      textContent.includes("ServiceLogin")
    ) {
      return { ok: false, type: parsed.type, error: "PERMISSION_DENIED" };
    }

    if (parsed.type === "google_sheet") {
      const structured = csvToStructuredText(textContent);
      if (!structured || structured.length < 10) {
        return { ok: false, type: parsed.type, error: "EMPTY_CONTENT" };
      }
      return {
        ok: true,
        type: parsed.type,
        text: structured,
        rawSnippet: textContent.slice(0, 500),
      };
    } else {
      // Google Doc
      const cleanedText = textContent.replace(/\r\n/g, "\n").trim();
      if (!cleanedText || cleanedText.length < 10) {
        return { ok: false, type: parsed.type, error: "EMPTY_CONTENT" };
      }
      return {
        ok: true,
        type: parsed.type,
        text: `=== NỘI DUNG TÀI LIỆU GOOGLE DOCS ===\n${cleanedText}`,
        rawSnippet: cleanedText.slice(0, 500),
      };
    }
  } catch (err) {
    console.warn(`[google-sync] Lỗi tải nội dung từ ${parsed.exportUrl}:`, err);
    return { ok: false, type: parsed.type, error: "NETWORK_ERROR" };
  }
}

/**
 * Tự động làm mới dữ liệu động từ Google Sheet / Google Doc nếu đã quá thời gian TTL (60 giây).
 * Trả về true nếu dữ liệu được cập nhật mới.
 */
export async function refreshDynamicKnowledgeIfExpired(
  item: PermanentKnowledgeItem,
  force = false,
  ttlMs = 60_000,
): Promise<boolean> {
  if (!item || !item.id) return false;
  if (item.sourceType !== "google_sheet" && item.sourceType !== "google_doc") {
    return false;
  }
  if (!item.sourceUrl) return false;

  const now = Date.now();
  const lastSync = item.lastSyncedAt || 0;

  if (!force && now - lastSync < ttlMs) {
    // Vẫn còn trong thời gian cache hợp lệ
    return false;
  }

  console.log(`[google-sync] 🔄 Đang làm mới dữ liệu thời gian thực cho "${item.topic}" từ ${item.sourceType}...`);
  const res = await fetchGoogleContent(item.sourceUrl);
  if (res.ok && res.text && res.text.length >= 20) {
    const hasChanged = res.text !== item.contentText;
    item.contentText = res.text;
    item.lastSyncedAt = now;
    item.updatedAt = now;

    // Lưu vào SQLite
    updatePermanentKnowledgeContent(item.id, res.text, now);
    if (hasChanged) {
      console.log(`[google-sync] ⚡ Đã cập nhật dữ liệu mới từ Google cho "${item.topic}" (${res.text.length} ký tự)`);
    } else {
      console.log(`[google-sync] ✅ Dữ liệu "${item.topic}" trên Google không thay đổi, đã làm mới dấu thời gian.`);
    }
    return true;
  } else {
    console.warn(`[google-sync] ⚠️ Không thể tải cập nhật cho "${item.topic}" (${res.error}), giữ bản cache hiện tại.`);
    return false;
  }
}

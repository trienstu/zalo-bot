import fs from "node:fs";
import path from "node:path";

export interface LogLine {
  id: number;
  timestamp?: string;
  rawTimestamp?: string;
  level: "ERROR" | "WARN" | "INFO" | "SUCCESS" | "CHAT";
  stream: "out" | "error";
  message: string;
  raw: string;
}

/**
 * Chuyển timestamp UTC của PM2 (VD: 2026-09-04T02:39:56) sang giờ Việt Nam (+7)
 */
export function formatToVnTime(rawTimeStr?: string): string {
  if (!rawTimeStr) return "";
  try {
    let clean = rawTimeStr.trim();
    // Nếu chưa có timezone offset (+07, +00, Z), mặc định PM2 lưu UTC trên VPS Linux
    if (!clean.includes("+") && !clean.endsWith("Z") && !clean.includes("-0")) {
      clean = clean.replace(" ", "T") + "Z";
    }
    const d = new Date(clean);
    if (isNaN(d.getTime())) return rawTimeStr;

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);

    const map: Record<string, string> = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }

    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
  } catch {
    return rawTimeStr;
  }
}

export interface LogStreamInfo {
  id: string;
  label: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  updatedAt: number;
  exists: boolean;
}

/**
 * Lấy thư mục PM2 logs trên hệ thống (ưu tiên HOME/ .pm2/logs)
 */
export function getPm2LogsDir(): string {
  const home = process.env.HOME || "/home/congtrien125";
  return path.resolve(home, ".pm2", "logs");
}

/**
 * Nhận diện Bot ID hiện tại từ cổng web hoặc cấu hình
 */
export function detectCurrentBotId(portOrHost?: string): "bot-1" | "bot-2" {
  const port = String(process.env.PORT || process.env.WEB_PORT || "");
  const checkStr = `${port} ${portOrHost || ""} ${process.env.BOT_ID || ""} ${process.env.WEB_DB_PATH || ""}`;
  if (checkStr.includes("3002") || checkStr.includes("3001") || checkStr.includes("bot-2")) {
    return "bot-2";
  }
  return "bot-1";
}

/**
 * Liệt kê danh sách các luồng log khả dụng cho bot hiện tại
 */
export function listAvailableLogStreams(botId: "bot-1" | "bot-2"): LogStreamInfo[] {
  const pm2Dir = getPm2LogsDir();
  const botNum = botId === "bot-2" ? "2" : "1";
  const botName = botId === "bot-2" ? "Mộc Miên" : "Sen Chúa";

  const standardStreams = [
    {
      id: "bot-all",
      label: `Tất cả Log Bot (${botName} - Kết hợp)`,
      fileName: `zalo-bot-${botNum}`,
      isVirtual: true,
    },
    {
      id: "bot-error",
      label: `Chỉ Log Lỗi Bot (zalo-bot-${botNum}-error.log)`,
      fileName: `zalo-bot-${botNum}-error.log`,
      isVirtual: false,
    },
    {
      id: "bot-out",
      label: `Log Hoạt Động Bot (zalo-bot-${botNum}-out.log)`,
      fileName: `zalo-bot-${botNum}-out.log`,
      isVirtual: false,
    },
    {
      id: "web-out",
      label: `Log Web Dashboard (zalo-web-${botNum}-out.log)`,
      fileName: `zalo-web-${botNum}-out.log`,
      isVirtual: false,
    },
    {
      id: "web-error",
      label: `Log Lỗi Web Dashboard (zalo-web-${botNum}-error.log)`,
      fileName: `zalo-web-${botNum}-error.log`,
      isVirtual: false,
    },
  ];

  const results: LogStreamInfo[] = [];

  for (const s of standardStreams) {
    const fullPath = path.join(pm2Dir, s.fileName);
    let sizeBytes = 0;
    let updatedAt = 0;
    let exists = false;

    if (!s.isVirtual) {
      if (fs.existsSync(fullPath)) {
        try {
          const st = fs.statSync(fullPath);
          sizeBytes = st.size;
          updatedAt = st.mtimeMs;
          exists = true;
        } catch {
          // Ignore
        }
      }
    } else {
      // Stream ảo "bot-all"
      const outP = path.join(pm2Dir, `zalo-bot-${botNum}-out.log`);
      const errP = path.join(pm2Dir, `zalo-bot-${botNum}-error.log`);
      exists = fs.existsSync(outP) || fs.existsSync(errP);
      if (exists) {
        if (fs.existsSync(outP)) sizeBytes += fs.statSync(outP).size;
        if (fs.existsSync(errP)) sizeBytes += fs.statSync(errP).size;
        updatedAt = Date.now();
      }
    }

    results.push({
      id: s.id,
      label: s.label,
      fileName: s.fileName,
      filePath: fullPath,
      sizeBytes,
      updatedAt,
      exists,
    });
  }

  // Quét thêm các file .log khác nếu có trong thư mục PM2
  if (fs.existsSync(pm2Dir)) {
    try {
      const files = fs.readdirSync(pm2Dir);
      for (const f of files) {
        if (f.endsWith(".log") && !results.some((r) => r.fileName === f)) {
          const fPath = path.join(pm2Dir, f);
          const st = fs.statSync(fPath);
          results.push({
            id: f,
            label: f,
            fileName: f,
            filePath: fPath,
            sizeBytes: st.size,
            updatedAt: st.mtimeMs,
            exists: true,
          });
        }
      }
    } catch {
      // Ignore readdir error
    }
  }

  return results;
}

/**
 * Đọc N dòng cuối cùng từ một file một cách an toàn bằng Tail Buffer (không tải cả file lớn vào RAM)
 */
export function readLastLinesFromFile(filePath: string, maxLines = 150): string[] {
  if (!fs.existsSync(filePath)) return [];

  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return [];

    // Đọc tối đa 256KB cuối file
    const CHUNK_SIZE = Math.min(stat.size, 256 * 1024);
    const buffer = Buffer.alloc(CHUNK_SIZE);
    const fd = fs.openSync(filePath, "r");

    try {
      fs.readSync(fd, buffer, 0, CHUNK_SIZE, stat.size - CHUNK_SIZE);
    } finally {
      fs.closeSync(fd);
    }

    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);

    // Bỏ dòng đầu tiên nếu file lớn hơn buffer đọc vì có thể bị cắt giữa chừng
    if (stat.size > CHUNK_SIZE && lines.length > 1) {
      lines.shift();
    }

    // Loại bỏ các dòng trống ở cuối
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }

    return lines.slice(-maxLines);
  } catch (err) {
    console.error(`Lỗi đọc file log ${filePath}:`, err);
    return [];
  }
}

/**
 * Phân tích cú pháp một dòng log thành đối tượng có cấu trúc
 */
export function parseLogLine(raw: string, defaultStream: "out" | "error" = "out", id = 0): LogLine {
  const line = raw.trim();
  let rawTimestamp: string | undefined;
  let cleanText = line;

  // Pattern thời gian của PM2: "2026-09-04 02:15:30 +07:00: message" hoặc "2026-09-04T02:15:30: message"
  const pm2TimeMatch = line.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:?\d{2}|Z)?):?\s*(.*)$/);
  if (pm2TimeMatch) {
    rawTimestamp = pm2TimeMatch[1];
    cleanText = (pm2TimeMatch[2] || "").replace(/^[:\-\s]+/, "").trim();
  } else {
    cleanText = cleanText.replace(/^[:\-\s]+/, "").trim();
  }

  const formattedTime = formatToVnTime(rawTimestamp);

  // Nhận diện tin nhắn chat: luôn là CHAT / INFO, không bao giờ đánh dấu là WARN/ERROR chỉ vì người dùng gõ từ "retry" hay "error"
  const isChat = cleanText.includes("Tin nhắn từ") || cleanText.includes("[listener] 📩") || cleanText.includes("Tin nhắn thu hồi");
  let level: "ERROR" | "WARN" | "INFO" | "SUCCESS" | "CHAT" = "INFO";

  if (isChat) {
    level = "CHAT";
  } else if (defaultStream === "error") {
    level = "ERROR";
  } else {
    const lower = cleanText.toLowerCase();
    if (
      lower.startsWith("error:") ||
      lower.includes(" uncaughtexception") ||
      lower.includes("unhandledrejection") ||
      lower.includes(" [error] ") ||
      lower.includes("typeerror:") ||
      lower.includes("syntaxerror:") ||
      lower.includes("referenceerror:") ||
      lower.includes("failed:")
    ) {
      level = "ERROR";
    } else if (
      lower.includes(" [warn] ") ||
      lower.startsWith("warn:") ||
      lower.includes("rate limit") ||
      lower.includes("throttl")
    ) {
      level = "WARN";
    } else if (
      lower.includes("connected") ||
      lower.includes("login successful") ||
      lower.includes("sẵn sàng") ||
      lower.includes("hoàn tất") ||
      lower.includes("đã gửi")
    ) {
      level = "SUCCESS";
    } else {
      level = "INFO";
    }
  }

  return {
    id,
    timestamp: formattedTime,
    rawTimestamp,
    level,
    stream: defaultStream,
    message: cleanText,
    raw,
  };
}

/**
 * Đọc log theo streamId chỉ định và hỗ trợ lọc theo nhóm
 */
export function fetchLogs(
  botId: "bot-1" | "bot-2",
  streamId = "bot-all",
  maxLines = 150,
  keyword = "",
  groupId = ""
): {
  lines: LogLine[];
  sourceName: string;
  sourceFound: boolean;
  totalSize: number;
} {
  const pm2Dir = getPm2LogsDir();
  const botNum = botId === "bot-2" ? "2" : "1";

  let rawLinesWithStream: { raw: string; stream: "out" | "error" }[] = [];
  let sourceFound = false;
  let totalSize = 0;
  let sourceName = "";

  if (streamId === "bot-all") {
    sourceName = `zalo-bot-${botNum} (All: Out + Error)`;
    const outPath = path.join(pm2Dir, `zalo-bot-${botNum}-out.log`);
    const errPath = path.join(pm2Dir, `zalo-bot-${botNum}-error.log`);

    const outLines = readLastLinesFromFile(outPath, maxLines).map((raw) => ({ raw, stream: "out" as const }));
    const errLines = readLastLinesFromFile(errPath, maxLines).map((raw) => ({ raw, stream: "error" as const }));

    if (fs.existsSync(outPath)) {
      sourceFound = true;
      totalSize += fs.statSync(outPath).size;
    }
    if (fs.existsSync(errPath)) {
      sourceFound = true;
      totalSize += fs.statSync(errPath).size;
    }

    // Kết hợp và gộp các dòng
    rawLinesWithStream = [...outLines, ...errLines];

    // Cố gắng sắp xếp theo timestamp nếu có
    rawLinesWithStream.sort((a, b) => {
      const timeA = a.raw.slice(0, 25);
      const timeB = b.raw.slice(0, 25);
      return timeA.localeCompare(timeB);
    });

    if (rawLinesWithStream.length > maxLines) {
      rawLinesWithStream = rawLinesWithStream.slice(-maxLines);
    }
  } else {
    // Stream đơn lẻ
    let targetFileName = streamId;
    let streamType: "out" | "error" = "out";

    if (streamId === "bot-out") {
      targetFileName = `zalo-bot-${botNum}-out.log`;
      streamType = "out";
    } else if (streamId === "bot-error") {
      targetFileName = `zalo-bot-${botNum}-error.log`;
      streamType = "error";
    } else if (streamId === "web-out") {
      targetFileName = `zalo-web-${botNum}-out.log`;
      streamType = "out";
    } else if (streamId === "web-error") {
      targetFileName = `zalo-web-${botNum}-error.log`;
      streamType = "error";
    } else if (streamId.includes("error")) {
      streamType = "error";
    }

    sourceName = targetFileName;
    const targetPath = path.join(pm2Dir, targetFileName);

    if (fs.existsSync(targetPath)) {
      sourceFound = true;
      totalSize = fs.statSync(targetPath).size;
      const lines = readLastLinesFromFile(targetPath, maxLines);
      rawLinesWithStream = lines.map((raw) => ({ raw, stream: streamType }));
    }
  }

  // Lọc theo nhóm nếu có (threadId)
  if (groupId.trim()) {
    const g = groupId.trim();
    rawLinesWithStream = rawLinesWithStream.filter((item) => item.raw.includes(g));
  }

  // Lọc theo từ khóa nếu có
  if (keyword.trim()) {
    const k = keyword.trim().toLowerCase();
    rawLinesWithStream = rawLinesWithStream.filter((item) => item.raw.toLowerCase().includes(k));
  }

  const parsedLines: LogLine[] = rawLinesWithStream.map((item, idx) =>
    parseLogLine(item.raw, item.stream, idx + 1)
  );

  return {
    lines: parsedLines,
    sourceName,
    sourceFound,
    totalSize,
  };
}

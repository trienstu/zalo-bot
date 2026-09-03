import path from "node:path";
import fs from "node:fs";

/**
 * Đọc trạng thái đăng nhập Zalo do bot ghi ra (qr.png + login-status.json).
 * Server-only — KHÔNG import better-sqlite3/db ở đây (tránh kéo node module nặng
 * vào route chỉ phục vụ ảnh + JSON nhỏ).
 *
 * Thư mục data: env WEB_QR_DIR, default ../bot/data (web và bot cùng repo,
 * tương tự cách db.ts resolve ../bot/data/bot.db).
 */

const QR_DIR =
  process.env.WEB_QR_DIR?.trim() ||
  path.resolve(process.cwd(), "..", "bot", "data");

import { getBotInfo } from "./bot-registry";

export function getBotDataDir(botId = "bot-1"): string {
  const home = process.env.HOME || "/home/congtrien125";
  const port = String(process.env.PORT || process.env.WEB_PORT || "");
  const isBot2 = port === "3002" || port === "3001" || process.env.BOT_ID === "bot-2" || botId === "bot-2";

  if (isBot2) {
    const candidates = [
      path.resolve(home, "zalo-bot-2", "bot", "session"),
      path.resolve(home, "zalo-bot-2", "session"),
      path.resolve(home, "zalo-bot-2", "bot", "data"),
      path.resolve(process.cwd(), "..", "bot", "session"),
      path.resolve(process.cwd(), "..", "bot", "data"),
      path.resolve(home, "zalo-bot", "data", "bots", "bot-2", "session"),
      path.resolve(home, "zalo-bot", "data", "bots", "bot-2"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, "login-status.json")) || fs.existsSync(path.join(c, "session.json"))) {
        return c;
      }
    }
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }

  const info = getBotInfo(botId);
  if (info && info.sessionDir && fs.existsSync(info.sessionDir)) {
    return info.sessionDir;
  }
  if (info && info.dbPath) {
    return path.dirname(info.dbPath);
  }
  return QR_DIR;
}

export type LoginState =
  | "ready"
  | "waiting_scan"
  | "scanned"
  | "logged_in"
  | "expired"
  | "declined"
  | "unknown";

export interface LoginStatus {
  state: LoginState;
  updatedAt: number | null;
  displayName: string | null;
}

const KNOWN_STATES: LoginState[] = [
  "ready",
  "waiting_scan",
  "scanned",
  "logged_in",
  "expired",
  "declined",
];

/**
 * Đọc login-status.json theo từng botId. File không tồn tại / hỏng → state "unknown".
 */
export function readLoginStatus(botId = "bot-1"): LoginStatus {
  const dir = getBotDataDir(botId);
  const statusPath = path.join(dir, "login-status.json");

  let raw: string;
  try {
    raw = fs.readFileSync(statusPath, "utf8");
  } catch {
    return { state: "unknown", updatedAt: null, displayName: null };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { state: "unknown", updatedAt: null, displayName: null };
  }

  const obj = (data ?? {}) as {
    state?: unknown;
    updatedAt?: unknown;
    displayName?: unknown;
  };

  const state =
    typeof obj.state === "string" && (KNOWN_STATES as string[]).includes(obj.state)
      ? (obj.state as LoginState)
      : "unknown";
  const updatedAt = typeof obj.updatedAt === "number" ? obj.updatedAt : null;
  const displayName = typeof obj.displayName === "string" ? obj.displayName : null;

  return { state, updatedAt, displayName };
}

/** Đường dẫn file ảnh QR (cho route image đọc trực tiếp). */
export function qrImagePath(botId = "bot-1"): string {
  const dir = getBotDataDir(botId);
  return path.join(dir, "qr.png");
}

/** Ảnh QR có tồn tại không. */
export function qrImageExists(botId = "bot-1"): boolean {
  return fs.existsSync(qrImagePath(botId));
}

/** Đường dẫn marker để dashboard yêu cầu bot tự xoá session và login lại. */
export function reloginRequestPath(botId = "bot-1"): string {
  const dir = getBotDataDir(botId);
  return path.join(dir, "relogin-request.json");
}

/** Đường dẫn marker để dashboard yêu cầu bot sync member ngay. */
export function memberSyncRequestPath(botId = "bot-1"): string {
  const dir = getBotDataDir(botId);
  return path.join(dir, "member-sync-request.json");
}

/** Đường dẫn marker để dashboard yêu cầu bot kiểm tra quyền group. */
export function permissionCheckRequestPath(botId = "bot-1"): string {
  const dir = getBotDataDir(botId);
  return path.join(dir, "permission-check-request.json");
}

/** Đường dẫn marker để dashboard yêu cầu bot kick 1 người ngay (không qua duyệt Telegram). */
export function kickNowRequestPath(botId = "bot-1"): string {
  const dir = getBotDataDir(botId);
  return path.join(dir, "kick-now-request.json");
}

/** Đường dẫn marker để dashboard yêu cầu bot quét danh sách tất cả nhóm Zalo. */
export function groupScanRequestPath(botId = "bot-1"): string {
  const dir = getBotDataDir(botId);
  return path.join(dir, "group-scan-request.json");
}


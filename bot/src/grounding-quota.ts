import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface GroundingQuotaStatus {
  date: string; // YYYY-MM-DD theo múi giờ Việt Nam
  used: number;
  limit: number;
  remaining: number;
  isAvailable: boolean;
  isExhausted: boolean;
  isEnabled: boolean;
}

const DAILY_LIMIT = 1500;
const SAFE_THRESHOLD = 1480; // Ngưỡng an toàn chủ động ngắt để bảo vệ 100% không phát sinh chi phí

export function isSearchGroundingEnabled(value = process.env.SEARCH_GROUNDING_ENABLED): boolean {
  return /^(?:1|true|yes|on)$/i.test(String(value || "").trim());
}

function getTodayString(): string {
  // Múi giờ Việt Nam (UTC+7)
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const vnTime = new Date(utc + 7 * 3600000);
  return vnTime.toISOString().slice(0, 10);
}

function getQuotaFilePath(): string {
  const dir = path.dirname(config.dbPath);
  return path.join(dir, "grounding-quota.json");
}

let inMemoryState: {
  date: string;
  used: number;
  isExhausted: boolean;
} | null = null;

function loadQuotaState(): { date: string; used: number; isExhausted: boolean } {
  const today = getTodayString();
  if (inMemoryState && inMemoryState.date === today) {
    return inMemoryState;
  }

  const filePath = getQuotaFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.date === today) {
        inMemoryState = {
          date: today,
          used: Number(parsed.used) || 0,
          isExhausted: Boolean(parsed.isExhausted),
        };
        return inMemoryState;
      }
    }
  } catch (e) {
    console.warn("[grounding-quota] Không đọc được file quota:", e);
  }

  // Khởi tạo ngày mới (tự động reset mỗi ngày lúc 00:00)
  inMemoryState = {
    date: today,
    used: 0,
    isExhausted: false,
  };
  saveQuotaState();
  return inMemoryState;
}

function saveQuotaState(): void {
  if (!inMemoryState) return;
  const filePath = getQuotaFilePath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(inMemoryState, null, 2), "utf8");
  } catch (e) {
    console.warn("[grounding-quota] Không lưu được file quota:", e);
  }
}

/**
 * Kiểm tra xem có thể gọi Google Search Grounding hay không
 */
export function canUseGrounding(): boolean {
  if (!isSearchGroundingEnabled()) return false;
  const state = loadQuotaState();
  if (state.isExhausted) return false;
  if (state.used >= SAFE_THRESHOLD) {
    state.isExhausted = true;
    saveQuotaState();
    return false;
  }
  return true;
}

/**
 * Ghi nhận 1 lượt gọi Google Search Grounding thành công
 */
export function incrementGroundingUsage(count: number = 1): void {
  const state = loadQuotaState();
  state.used += count;
  if (state.used >= SAFE_THRESHOLD) {
    state.isExhausted = true;
  }
  saveQuotaState();
}

/**
 * Đánh dấu hết hạn mức hôm nay (khi Google API trả về HTTP 429 hoặc chạm ngưỡng chi tiêu)
 */
export function markGroundingExhausted(reason?: string): void {
  const state = loadQuotaState();
  state.isExhausted = true;
  saveQuotaState();
  console.warn(`[grounding-quota] ⚠️ Đã đánh dấu Google Search Grounding hết hạn mức hôm nay: ${reason || "Lỗi 429 hoặc chạm ngưỡng"}`);
}

/**
 * Reset quota hôm nay về 0 (cho admin test hoặc khi sang ngày mới)
 */
export function resetGroundingQuota(): void {
  const today = getTodayString();
  inMemoryState = {
    date: today,
    used: 0,
    isExhausted: false,
  };
  saveQuotaState();
}

/**
 * Lấy thông tin thống kê trạng thái hạn mức Grounding
 */
export function getGroundingQuotaStatus(): GroundingQuotaStatus {
  const state = loadQuotaState();
  const remaining = Math.max(0, DAILY_LIMIT - state.used);
  const isEnabled = isSearchGroundingEnabled();
  return {
    date: state.date,
    used: state.used,
    limit: DAILY_LIMIT,
    remaining,
    isAvailable: canUseGrounding(),
    isExhausted: state.isExhausted,
    isEnabled,
  };
}

/**
 * Tạo báo cáo đẹp mắt để gửi vào Zalo khi người dùng gõ /quota hoặc !quota
 */
export function formatGroundingQuotaReport(): string {
  const status = getGroundingQuotaStatus();
  const percent = ((status.used / status.limit) * 100).toFixed(1);
  const statusEmoji = !status.isEnabled
    ? "⏸️ Đã tắt theo cấu hình (Đang dùng API công khai + RSS)"
    : status.isAvailable
    ? "✅ Đang hoạt động ổn định (Tier 1 - Ưu tiên trực tiếp)"
    : "⚠️ Đã tạm dừng / Hết hạn mức (Đang dùng RSS Tier 2)";

  return (
    `📊 BÁO CÁO HẠN MỨC GOOGLE SEARCH GROUNDING HÔM NAY (${status.date}):\n\n` +
    `• Đã sử dụng: ${status.used} / ${status.limit} lượt (${percent}%)\n` +
    `• Lượt miễn phí còn lại: ${status.remaining} lượt\n` +
    `• Trạng thái: ${statusEmoji}\n` +
    `• Cơ chế bảo vệ: Tự động chuyển sang luồng RSS báo chí nội bộ khi chạm ${SAFE_THRESHOLD} lượt hoặc gặp 429, đảm bảo 100% không phát sinh chi phí ngoài ý muốn.`
  );
}

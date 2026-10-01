import os from "node:os";
import child_process from "node:child_process";
import { getDb, getBotState } from "./db/index.js";
import { notifyAdmins } from "./admin-assistant.js";

export interface SystemMetrics {
  timestamp: number;
  ram: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
    botRssMb: number;
    botHeapMb: number;
  };
  cpu: {
    usagePercent: number;
    cores: number;
    loadAvg: number[];
  };
  disk: {
    totalGb: number;
    usedGb: number;
    freeGb: number;
    usedPercent: number;
  };
  uptime: {
    seconds: number;
    formatted: string;
  };
  zalo: {
    socketState: string;
    lastSocketError: string | null;
    todayMessages: number;
    managedGroups: number;
    interactiveGroups: number;
    totalFriends: number;
  };
}

/**
 * Đo tỷ lệ sử dụng CPU bằng cách so sánh 2 lần lấy mẫu delta trong 300ms
 */
async function getCpuUsagePercent(): Promise<number> {
  const cpus1 = os.cpus();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const cpus2 = os.cpus();

  let idleDiff = 0;
  let totalDiff = 0;

  for (let i = 0; i < cpus1.length; i++) {
    const c1 = cpus1[i]?.times;
    const c2 = cpus2[i]?.times;
    if (!c1 || !c2) continue;

    const idle = c2.idle - c1.idle;
    const total =
      c2.user -
      c1.user +
      (c2.nice - c1.nice) +
      (c2.sys - c1.sys) +
      (c2.irq - c1.irq) +
      idle;

    idleDiff += idle;
    totalDiff += total;
  }

  if (totalDiff <= 0) return 0;
  return Math.round(((totalDiff - idleDiff) / totalDiff) * 1000) / 10;
}

/**
 * Đo dung lượng ổ đĩa SSD NVMe qua lệnh df -k /
 */
function getDiskMetrics(): {
  totalGb: number;
  usedGb: number;
  freeGb: number;
  usedPercent: number;
} {
  try {
    const output = child_process.execSync("df -k /", {
      encoding: "utf8",
      timeout: 4000,
    });
    const lines = output.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    if (lastLine) {
      const parts = lastLine.split(/\s+/);
      const totalKb = parseInt(parts[1] || "0", 10);
      const usedKb = parseInt(parts[2] || "0", 10);
      const availKb = parseInt(parts[3] || "0", 10);

      if (totalKb > 0) {
        const totalGb = Math.round((totalKb / (1024 * 1024)) * 10) / 10;
        const usedGb = Math.round((usedKb / (1024 * 1024)) * 10) / 10;
        const freeGb = Math.round((availKb / (1024 * 1024)) * 10) / 10;
        const usedPercent = Math.round((usedKb / totalKb) * 1000) / 10;
        return { totalGb, usedGb, freeGb, usedPercent };
      }
    }
  } catch (e) {
    console.warn("[system-monitor] Lỗi khi đo dung lượng ổ đĩa (df -k /):", e);
  }
  return { totalGb: 0, usedGb: 0, freeGb: 0, usedPercent: 0 };
}

/**
 * Định dạng thời gian uptime tiến trình
 */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} ngày`);
  if (h > 0 || d > 0) parts.push(`${h} giờ`);
  parts.push(`${m} phút`);
  return parts.join(" ") || "dưới 1 phút";
}

/**
 * Lấy số liệu hoạt động của Bot từ DB và bot_health
 */
function getZaloStats(): {
  socketState: string;
  lastSocketError: string | null;
  todayMessages: number;
  managedGroups: number;
  interactiveGroups: number;
  totalFriends: number;
} {
  let socketState = "connected";
  let lastSocketError: string | null = null;
  try {
    const rawHealth = getBotState("bot_health");
    if (rawHealth) {
      const parsed = JSON.parse(rawHealth);
      if (parsed.socketState) socketState = parsed.socketState;
      if (parsed.lastSocketError) lastSocketError = parsed.lastSocketError;
    }
  } catch {}

  let todayMessages = 0;
  let managedGroups = 0;
  let interactiveGroups = 0;
  let totalFriends = 0;

  try {
    const db = getDb();
    const now = new Date();
    const bkkDateStr = now.toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
    });
    const startOfDayMs = new Date(`${bkkDateStr}T00:00:00+07:00`).getTime();

    const msgRow = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM group_messages WHERE created_at >= ?",
      )
      .get(startOfDayMs) as any;
    if (msgRow?.cnt) todayMessages = Number(msgRow.cnt);

    const groupRows = db
      .prepare("SELECT mode FROM bot_groups WHERE mode != 'disabled'")
      .all() as any[];
    managedGroups = groupRows.length;
    interactiveGroups = groupRows.filter(
      (r) => r.mode === "interactive",
    ).length;

    const friendRow = db
      .prepare("SELECT COUNT(*) as cnt FROM bot_friends")
      .get() as any;
    if (friendRow?.cnt) totalFriends = Number(friendRow.cnt);
  } catch (e) {
    console.warn("[system-monitor] Lỗi truy vấn thống kê Zalo từ DB:", e);
  }

  return {
    socketState,
    lastSocketError,
    todayMessages,
    managedGroups,
    interactiveGroups,
    totalFriends,
  };
}

/**
 * Thu thập toàn diện chỉ số sức khỏe phần cứng máy chủ và tài khoản Bot
 */
export async function getSystemMetrics(): Promise<SystemMetrics> {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usedPercent = Math.round((usedBytes / totalBytes) * 1000) / 10;

  const memUsage = process.memoryUsage();
  const botRssMb = Math.round((memUsage.rss / (1024 * 1024)) * 10) / 10;
  const botHeapMb = Math.round((memUsage.heapUsed / (1024 * 1024)) * 10) / 10;

  const [cpuUsagePercent, diskMetrics] = await Promise.all([
    getCpuUsagePercent(),
    Promise.resolve(getDiskMetrics()),
  ]);

  const loadAvg = os.loadavg().map((v) => Math.round(v * 100) / 100);
  const uptimeSec = Math.floor(process.uptime());

  const zaloStats = getZaloStats();

  return {
    timestamp: Date.now(),
    ram: {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent,
      botRssMb,
      botHeapMb,
    },
    cpu: {
      usagePercent: cpuUsagePercent,
      cores: os.cpus().length,
      loadAvg,
    },
    disk: diskMetrics,
    uptime: {
      seconds: uptimeSec,
      formatted: formatUptime(uptimeSec),
    },
    zalo: zaloStats,
  };
}

/**
 * Định dạng bản tin báo cáo sức khỏe máy chủ trực quan, chuyên nghiệp gửi Zalo
 */
export function formatSystemReport(
  m: SystemMetrics,
  headerTitle = "BÁO CÁO SỨC KHỎE MÁY CHỦ & TÀI KHOẢN BOT",
): string {
  const now = new Date(m.timestamp);
  const timeStr = now.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
  const dateStr = now.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });

  const totalRamGb =
    Math.round((m.ram.totalBytes / (1024 * 1024 * 1024)) * 10) / 10;
  const usedRamGb =
    Math.round((m.ram.usedBytes / (1024 * 1024 * 1024)) * 10) / 10;

  const socketIcon =
    m.zalo.socketState === "connected"
      ? "🟢"
      : m.zalo.socketState === "disconnected"
        ? "🟡"
        : "🔴";

  const socketDesc =
    m.zalo.socketState === "connected"
      ? "Kết nối ổn định (connected)"
      : m.zalo.socketState === "disconnected"
        ? `Tạm ngắt kết nối (${m.zalo.lastSocketError || "đang thử lại..."})`
        : `Mất kết nối (${m.zalo.lastSocketError || "socket closed"})`;

  // Đánh giá tổng quan
  let statusSummary = "✅ Tất cả các chỉ số vận hành đang trong ngưỡng an toàn!";
  const warnings: string[] = [];
  if (m.ram.usedPercent >= 90) warnings.push(`RAM máy chủ cao (${m.ram.usedPercent}%)`);
  if (m.disk.usedPercent >= 90) warnings.push(`Ổ SSD sắp đầy (${m.disk.usedPercent}%)`);
  if (m.cpu.usagePercent >= 85) warnings.push(`Tải CPU cao (${m.cpu.usagePercent}%)`);
  if (m.zalo.socketState !== "connected") warnings.push("Socket Zalo không ổn định");

  if (warnings.length > 0) {
    statusSummary = `⚠️ Chú ý: ${warnings.join(", ")}!`;
  }

  return (
    `🖥️ [${headerTitle}]\n` +
    `⏰ Thời gian: ${timeStr} - ${dateStr}\n` +
    `🤖 Tiến trình: Bot 2 (PID: ${process.pid})\n\n` +
    `⚙️ TÀI NGUYÊN MÁY CHỦ:\n` +
    `• CPU: ${m.cpu.usagePercent}% (${m.cpu.cores} Cores, Load: ${m.cpu.loadAvg.join(", ")})\n` +
    `• RAM Máy chủ: ${usedRamGb} / ${totalRamGb} GB (${m.ram.usedPercent}%)\n` +
    `• RAM Bot (PM2): ${m.ram.botRssMb} MB (Heap: ${m.ram.botHeapMb} MB)\n` +
    `• Ổ cứng SSD: ${m.disk.usedGb} / ${m.disk.totalGb} GB (${m.disk.usedPercent}% - Trống: ${m.disk.freeGb} GB)\n` +
    `• Uptime tiến trình: ${m.uptime.formatted}\n\n` +
    `📡 TRẠNG THÁI VẬN HÀNH ZALO:\n` +
    `• Socket: ${socketIcon} ${socketDesc}\n` +
    `• Nhóm quản lý: ${m.zalo.managedGroups} nhóm (${m.zalo.interactiveGroups} tương tác)\n` +
    `• Bạn bè Zalo: ${m.zalo.totalFriends} bạn bè\n` +
    `• Tin nhắn hôm nay: ${m.zalo.todayMessages.toLocaleString("vi-VN")} tin\n\n` +
    `${statusSummary}`
  );
}

// Theo dõi cooldown cảnh báo khẩn cấp để tránh spam tin nhắn liên tục
let lastEmergencyAlertAt = 0;
const EMERGENCY_COOLDOWN_MS = 30 * 60 * 1000; // 30 phút nhắc lại nếu vẫn vượt ngưỡng

/**
 * Kiểm tra các ngưỡng nguy hiểm (RAM > 90%, Disk > 90%, Socket đứt) và cảnh báo khẩn cấp
 */
export async function checkEmergencyThresholds(api: any): Promise<void> {
  try {
    const metrics = await getSystemMetrics();
    const warnings: string[] = [];

    if (metrics.ram.usedPercent >= 90) {
      warnings.push(`• RAM máy chủ vượt mức: ${metrics.ram.usedPercent}% (Đang dùng ${Math.round(metrics.ram.usedBytes / (1024 * 1024 * 1024) * 10) / 10} / ${Math.round(metrics.ram.totalBytes / (1024 * 1024 * 1024) * 10) / 10} GB)`);
    }

    if (metrics.disk.usedPercent >= 90 && metrics.disk.totalGb > 0) {
      warnings.push(`• Dung lượng SSD NVMe sắp cạn: ${metrics.disk.usedPercent}% (Chỉ còn trống ${metrics.disk.freeGb} GB)`);
    }

    if (metrics.zalo.socketState !== "connected") {
      warnings.push(`• Socket Zalo đang gián đoạn: [${metrics.zalo.socketState}] - ${metrics.zalo.lastSocketError || "Chưa rõ nguyên nhân"}`);
    }

    if (warnings.length === 0) return;

    const now = Date.now();
    if (now - lastEmergencyAlertAt < EMERGENCY_COOLDOWN_MS) {
      return;
    }
    lastEmergencyAlertAt = now;

    const timeStr = new Date(now).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bangkok",
    });

    const alertMsg =
      `🚨 [CẢNH BÁO KHẨN CẤP: TÀI NGUYÊN MÁY CHỦ VƯỢT NGƯỠNG AN TOÀN]\n\n` +
      `⏰ Thời gian: ${timeStr}\n` +
      `⚠️ Cảnh báo phát hiện:\n${warnings.join("\n")}\n\n` +
      `👉 Đề xuất: Sếp kiểm tra tiến trình hoặc dọn dẹp dung lượng máy chủ ngay để tránh bot bị OOM kill hoặc gián đoạn dịch vụ nhé! 🛠️`;

    console.warn(`[system-monitor] 🚨 Đang gửi cảnh báo khẩn cấp tới Quản trị viên:\n${alertMsg}`);
    await notifyAdmins(api, alertMsg);
  } catch (e) {
    console.warn("[system-monitor] checkEmergencyThresholds error:", e);
  }
}

// Lưu các mốc báo cáo định kỳ đã gửi để không gửi lặp (ví dụ: '2026-10-02_08:00')
const sentHealthSlots = new Set<string>();

/**
 * Vòng lặp kiểm tra báo cáo định kỳ lúc 08:00 và 20:00 (Asia/Bangkok)
 */
async function checkScheduledReportsLoop(api: any): Promise<void> {
  try {
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
    });
    const currentHM = now.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Bangkok",
    });

    // Hai khung giờ cố định trong ngày
    if (currentHM === "08:00" || currentHM === "20:00") {
      const slotKey = `${todayStr}_${currentHM}`;
      if (!sentHealthSlots.has(slotKey)) {
        sentHealthSlots.add(slotKey);
        console.log(`[system-monitor] 📊 Đang lập báo cáo sức khỏe máy chủ định kỳ khung giờ ${currentHM}...`);
        const metrics = await getSystemMetrics();
        const report = formatSystemReport(
          metrics,
          `BÁO CÁO SỨC KHỎE MÁY CHỦ ĐỊNH KỲ ${currentHM}`,
        );
        await notifyAdmins(api, report);
        console.log(`[system-monitor] ✅ Đã gửi báo cáo sức khỏe máy chủ ${slotKey} tới các Admin.`);
      }
    }
  } catch (e) {
    console.warn("[system-monitor] checkScheduledReportsLoop error:", e);
  }
}

/**
 * Khởi tạo toàn bộ hệ thống tự giám sát máy chủ và tài khoản Bot
 */
export function initSystemMonitoring(api: any): void {
  console.log("[system-monitor] 🚀 Khởi chạy module Giám sát Máy chủ & Nick Heartbeat (Báo cáo 08:00/20:00 & Cảnh báo khẩn 5p)...");

  // 1. Kiểm tra ngưỡng nguy hiểm mỗi 5 phút (300,000 ms)
  setInterval(() => {
    void checkEmergencyThresholds(api);
  }, 5 * 60 * 1000);

  // Chạy thử 1 lần sau khi khởi động 15 giây
  setTimeout(() => {
    void checkEmergencyThresholds(api);
  }, 15_000);

  // 2. Kiểm tra giờ báo cáo định kỳ mỗi 30 giây
  setInterval(() => {
    void checkScheduledReportsLoop(api);
  }, 30_000);
}

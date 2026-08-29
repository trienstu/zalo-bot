/**
 * Natural Language Time Parser & Reminder Helper Module
 */

import {
  createScheduledReminder,
  getUserScheduledReminders,
  cancelScheduledReminder,
} from "./db/index.js";

/**
 * Phân tích chuỗi thời gian tự nhiên tiếng Việt thành Unix timestamp (epoch milliseconds)
 */
export function parseNaturalTimeVietnam(text: string): { remindAt: number; content: string; targetType: "sender" | "all" } | null {
  const raw = text.trim();
  if (!raw) return null;

  const now = new Date();
  let remindAt: number | null = null;
  let cleanContent = raw;
  let targetType: "sender" | "all" = "sender";

  const lower = raw.toLowerCase();

  // Kiểm tra target (nhắc cả nhóm hay chỉ nhắc người gửi)
  if (
    lower.includes("nhắc cả nhóm") ||
    lower.includes("nhac ca nhom") ||
    lower.includes("nhắc mọi người") ||
    lower.includes("nhac moi nguoi") ||
    lower.includes("nhắc anh em") ||
    lower.includes("nhac anh em")
  ) {
    targetType = "all";
  }

  // 1. Mẫu: "HH:mm mai", "HHh sáng mai", "HHh tối mai", "HH:mm ngày mai", "8h tối mai", "mai 8h"
  const tomorrowMatch = raw.match(/(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(\d{1,2})(?:[:h](\d{1,2}))?\s*(?:h|giờ)?\s*(sáng|trưa|chiều|tối|đêm)?\s*(?:ngày\s*)?mai\s*[:,-]?\s*(.*)/i);
  if (tomorrowMatch && tomorrowMatch[1]) {
    let h = parseInt(tomorrowMatch[1], 10);
    const m = tomorrowMatch[2] ? parseInt(tomorrowMatch[2], 10) : 0;
    const period = tomorrowMatch[3]?.toLowerCase();

    if (period === "tối" || period === "chiều") {
      if (h < 12) h += 12;
    } else if (period === "sáng" && h === 12) {
      h = 0;
    }

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setHours(h, m, 0, 0);
    remindAt = targetDate.getTime();
    cleanContent = tomorrowMatch[4]?.trim() || "Có việc cần làm";
  }

  // 2. Mẫu: "HH:mm DD/MM" (ví dụ: "15:00 30/08 họp ban quản trị")
  if (!remindAt) {
    const specificDateMatch = raw.match(/(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(\d{1,2})[:h](\d{2})\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*[:,-]?\s*(.*)/i);
    if (specificDateMatch && specificDateMatch[1] && specificDateMatch[2] && specificDateMatch[3] && specificDateMatch[4]) {
      const h = parseInt(specificDateMatch[1], 10);
      const m = parseInt(specificDateMatch[2], 10);
      const day = parseInt(specificDateMatch[3], 10);
      const month = parseInt(specificDateMatch[4], 10) - 1;
      const year = specificDateMatch[5] ? parseInt(specificDateMatch[5], 10) : now.getFullYear();

      const targetDate = new Date(year, month, day, h, m, 0, 0);
      if (targetDate.getTime() > Date.now()) {
        remindAt = targetDate.getTime();
        cleanContent = specificDateMatch[6]?.trim() || "Có việc cần làm";
      }
    }
  }

  // 3. Mẫu: "HH:mm hôm nay", "HH:mm" (ví dụ: "17:30 đón con", "21:00 nộp bài")
  if (!remindAt) {
    const todayMatch = raw.match(/(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(?:lúc\s*)?(\d{1,2})[:h](\d{2})\s*(?:hôm nay)?\s*[:,-]?\s*(.*)/i);
    if (todayMatch && todayMatch[1] && todayMatch[2]) {
      const h = parseInt(todayMatch[1], 10);
      const m = parseInt(todayMatch[2], 10);

      const targetDate = new Date();
      targetDate.setHours(h, m, 0, 0);

      // Nếu giờ đó trong ngày hôm nay đã qua rồi, tự động chuyển sang ngày mai
      if (targetDate.getTime() <= Date.now()) {
        targetDate.setDate(targetDate.getDate() + 1);
      }

      remindAt = targetDate.getTime();
      cleanContent = todayMatch[3]?.trim() || "Có việc cần làm";
    }
  }

  // 4. Mẫu: "N phút nữa", "N p nữa", "N phút", "Np" (ví dụ: "15p uống nước", "20 phút nữa vào họp")
  if (!remindAt) {
    const minMatch = raw.match(/(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(\d+)\s*(?:phút|phut|p)\s*(?:nữa|sau)?\s*[:,-]?\s*(.*)/i);
    if (minMatch && minMatch[1]) {
      const mins = parseInt(minMatch[1], 10);
      if (mins > 0 && mins <= 1440 * 30) {
        remindAt = Date.now() + mins * 60 * 1000;
        cleanContent = minMatch[2]?.trim() || "Có việc cần làm";
      }
    }
  }

  // 5. Mẫu: "N tiếng nữa", "N giờ nữa", "N h nữa", "Nh" (ví dụ: "2 tiếng nữa gọi điện", "1 giờ sau họp")
  if (!remindAt) {
    const hourMatch = raw.match(/(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(\d+)\s*(?:tiếng|tieng|giờ|gio|h)\s*(?:nữa|sau)\s*[:,-]?\s*(.*)/i);
    if (hourMatch && hourMatch[1]) {
      const hours = parseInt(hourMatch[1], 10);
      if (hours > 0 && hours <= 720) {
        remindAt = Date.now() + hours * 3600 * 1000;
        cleanContent = hourMatch[2]?.trim() || "Có việc cần làm";
      }
    }
  }

  if (!remindAt) return null;

  // Xóa bớt các từ thừa ở đầu nội dung
  cleanContent = cleanContent
    .replace(/^(nhắc|nhac|báo|bao|làm|lam|rằng|rang|là|la|rồi|nhe|nhé|nha|nhá|ạ|a)\s+/gi, "")
    .replace(/^[:,-]\s*/, "")
    .trim();

  if (!cleanContent) {
    cleanContent = "Có việc quan trọng cần xử lý!";
  }

  return {
    remindAt,
    content: cleanContent,
    targetType,
  };
}

/**
 * Format thời gian đẹp mắt hiển thị cho người dùng
 */
export function formatReminderTime(ts: number): string {
  const d = new Date(ts);
  const timeStr = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
  const dateStr = d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bangkok" });

  const now = new Date();
  const diffMs = ts - Date.now();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins <= 0) return `${timeStr} ngay bây giờ`;
  if (diffMins < 60) return `sau ${diffMins} phút nữa (lúc ${timeStr})`;

  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
  const isTomorrow = d.getDate() === now.getDate() + 1 && d.getMonth() === now.getMonth();

  if (isToday) return `lúc ${timeStr} hôm nay`;
  if (isTomorrow) return `lúc ${timeStr} ngày mai (${dateStr})`;

  return `lúc ${timeStr} ngày ${dateStr}`;
}

/**
 * Xử lý lệnh đặt lịch / báo thức từ tin nhắn
 */
export function handleSetReminder(
  threadId: string,
  isDirect: boolean,
  creatorId: string,
  creatorName: string,
  inputArgs: string,
): string {
  const parsed = parseNaturalTimeVietnam(inputArgs);
  if (!parsed) {
    return [
      `⚠️ Em chưa nhận diện được thời gian hẹn của bác!`,
      `💡 Bác có thể đặt lịch bằng các mẫu dễ hiểu sau:`,
      `• /nhacnho 15p Uống nước`,
      `• /hengio 20 phút nữa Đi họp Zoom`,
      `• /hengio 17:30 Đi đón con`,
      `• /hengio 8h tối mai Kèo bóng đá`,
      `• /hengio 07:30 30/08 Nộp báo cáo quý`,
    ].join("\n");
  }

  const id = createScheduledReminder({
    threadId,
    isDirect,
    creatorId,
    creatorName,
    targetType: parsed.targetType,
    remindAt: parsed.remindAt,
    content: parsed.content,
  });

  if (!id) {
    return `⚠️ Có lỗi khi lưu lịch hẹn vào cơ sở dữ liệu. Bác thử lại sau nhé!`;
  }

  const timeDesc = formatReminderTime(parsed.remindAt);
  const targetDesc = parsed.targetType === "all" ? "cho cả nhóm" : isDirect ? "cho bác" : `cho bác @${creatorName}`;

  return [
    `⏰ ĐÃ LƯU LỊCH HẸN THÀNH CÔNG! [Mã: #${id}] 🔔`,
    `📌 Nội dung: "${parsed.content}"`,
    `⏳ Thời gian: Nhắc ${targetDesc} ${timeDesc}.`,
    `💡 Gõ /dsnhac để xem tất cả lịch hẹn hoặc /huynhac ${id} để hủy.`,
  ].join("\n");
}

/**
 * Liệt kê danh sách các lịch hẹn đang chờ
 */
export function handleListReminders(creatorId: string): string {
  const list = getUserScheduledReminders(creatorId, 10);
  if (list.length === 0) {
    return `⏰ Bác hiện không có lịch hẹn hoặc báo thức nào đang chờ.\n💡 Để tạo lịch hẹn mới, bác gõ ví dụ: /nhacnho 20p Vào họp Zoom nhé!`;
  }

  const lines = [
    `📋 DANH SÁCH LỊCH HẸN ĐANG CHỜ CỦA BÁC:`,
    `━━━━━━━━━━━━━━━━━━`,
    ...list.map((r, idx) => {
      const timeDesc = formatReminderTime(r.remindAt);
      const targetBadge = r.targetType === "all" ? "[Cả nhóm]" : "[Cá nhân]";
      return `${idx + 1}. [Mã #${r.id}] ${targetBadge} "${r.content}"\n   ⏳ Nhắc lúc: ${timeDesc}`;
    }),
    `━━━━━━━━━━━━━━━━━━`,
    `💡 Để hủy lịch hẹn nào, bác gõ: /huynhac [Mã số] (Ví dụ: /huynhac ${list[0]?.id || 1})`,
  ];

  return lines.join("\n");
}

/**
 * Hủy một lịch hẹn
 */
export function handleCancelReminder(creatorId: string, idStr: string): string {
  const id = parseInt(idStr.replace("#", "").trim(), 10);
  if (isNaN(id) || id <= 0) {
    return `⚠️ Vui lòng nhập đúng mã lịch hẹn cần hủy (Ví dụ: /huynhac 1). Bác gõ /dsnhac để xem mã số nhé!`;
  }

  const ok = cancelScheduledReminder(id, creatorId);
  if (ok) {
    return `✅ Đã hủy thành công lịch hẹn mã #${id}!`;
  } else {
    return `⚠️ Không tìm thấy lịch hẹn mã #${id} của bác hoặc lịch hẹn này đã được thực hiện trước đó.`;
  }
}

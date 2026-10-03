/**
 * Natural Language Time Parser & Reminder Helper Module
 */

import {
  createScheduledReminder,
  getUserScheduledReminders,
  cancelScheduledReminder,
} from "./db/index.js";

/**
 * Lấy ngày giờ hiện tại ở Việt Nam (GMT+7)
 */
function getVietnamNow() {
  const now = new Date();
  const vnFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = vnFormatter.formatToParts(now);
  const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  return {
    year: getPart("year"),
    month: getPart("month") - 1, // 0-indexed
    day: getPart("day"),
    hour: getPart("hour"),
    minute: getPart("minute"),
  };
}

/**
 * Tạo timestamp chuẩn xác theo giờ Việt Nam (GMT+7) độc lập với múi giờ VPS
 */
function makeVietnamTimestamp(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month, day, hour - 7, minute, 0, 0);
}

/**
 * Phân tích chuỗi thời gian tự nhiên tiếng Việt thành Unix timestamp (epoch milliseconds)
 */
export function parseNaturalTimeVietnam(text: string): { remindAt: number; content: string; targetType: "sender" | "all" } | null {
  const raw = text.trim();
  if (!raw) return null;

  const vn = getVietnamNow();
  let remindAt: number | null = null;
  let cleanContent = raw;
  let targetType: "sender" | "all" = "sender";

  const lower = raw.toLowerCase();

  // 0. BẢO VỆ NGỮ CẢNH: Loại trừ tuyệt đối các câu nhờ vả / xin thời gian / hỏi đáp tư vấn / tính toán (False Positives)
  // Ví dụ: "Google tăng từ 1.479 lên 1.989 là tăng bao nhiêu % nhỉ?", "cho anh 5 phút tư vấn...", "xin 5 phút...", "dành 10 phút..."
  const isQuestionOrMath =
    /(?:bao nhiêu|mấy\s*%|%\s*(?:nhỉ|nhi|ạ|a|được|duoc)|tăng|giảm|tính|tại sao|tai sao|là gì|la gi|thế nào|the nao|như thế nào|nhu the nao|ai là|ai la|\?)/i.test(
      raw,
    );

  const isConversationalRequest =
    /(?:cho|xin|dành|danh|mất|mat|tốn|ton|đợi|doi|chờ|cho)\s+(?:anh|em|tôi|tao|mình|minh|bác|bac|chú|chu)?\s*\d+\s*(?:phút|phut|p|tiếng|tieng|h|giờ|gio)/i.test(
      raw,
    ) ||
    /(?:tư vấn|tu van|hỏi|hoi|giải thích|giai thich|phân tích|phan tich|hướng dẫn|huong dan|tóm tắt|tom tat|xem hộ|xem ho|review)/i.test(
      raw,
    ) ||
    isQuestionOrMath;

  const hasExplicitReminderWord =
    /(?:nhắc|nhac|báo thức|bao thuc|hẹn giờ|hen gio|đặt lịch|dat lich|nhớ nhắc|nho nhac|remind|alarm)/i.test(
      raw,
    );

  if (isConversationalRequest && !hasExplicitReminderWord) {
    return null;
  }

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

  // 1a. Mẫu: "HH:mm mai", "HHh sáng mai", "HHh tối mai", "HH:mm ngày mai", "8h tối mai", "mai 8h"
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

    remindAt = makeVietnamTimestamp(vn.year, vn.month, vn.day + 1, h, m);
    cleanContent = tomorrowMatch[4]?.trim() || "Có việc cần làm";
  }

  // 1b. Mẫu: "mai lúc 8h", "ngày mai 9h sáng", "ngày mai lúc 14:30" (mai/ngày mai đứng trước giờ)
  if (!remindAt) {
    const tmrPrefixMatch = raw.match(/(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(?:vào\s+)?(?:ngày\s*)?mai(?:\s+(?:lúc|vào))?\s*(\d{1,2})(?:[:h](\d{1,2}))?\s*(?:h|giờ)?\s*(sáng|trưa|chiều|tối|đêm)?\s*[:,-]?\s*(.*)/i);
    if (tmrPrefixMatch && tmrPrefixMatch[1]) {
      let h = parseInt(tmrPrefixMatch[1], 10);
      const m = tmrPrefixMatch[2] ? parseInt(tmrPrefixMatch[2], 10) : 0;
      const period = tmrPrefixMatch[3]?.toLowerCase();

      if (period === "tối" || period === "chiều") {
        if (h < 12) h += 12;
      } else if (period === "sáng" && h === 12) {
        h = 0;
      }

      remindAt = makeVietnamTimestamp(vn.year, vn.month, vn.day + 1, h, m);
      cleanContent = tmrPrefixMatch[4]?.trim() || "Có việc cần làm";
    }
  }

  // 2. Mẫu: "N phút nữa", "N p nữa", "N phút", "Np" (ví dụ: "15p uống nước", "20 phút nữa vào họp")
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

  // 3. Mẫu: "N tiếng nữa", "N giờ nữa", "N h nữa" (ví dụ: "2 tiếng nữa gọi điện", "1 giờ sau họp")
  if (!remindAt) {
    const hourMatch = raw.match(/(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(\d+)\s*(?:tiếng|tieng|giờ|gio)\s*(?:nữa|sau)\s*[:,-]?\s*(.*)/i);
    if (hourMatch && hourMatch[1]) {
      const hours = parseInt(hourMatch[1], 10);
      if (hours > 0 && hours <= 720) {
        remindAt = Date.now() + hours * 3600 * 1000;
        cleanContent = hourMatch[2]?.trim() || "Có việc cần làm";
      }
    }
  }

  // 4a. Mẫu ngày đứng trước giờ: "ngày 15/10 lúc 9h sáng họp", "15/10 9h", "ngày 15/10/2026 lúc 14:00"
  if (!remindAt) {
    const dateFirstMatch = raw.match(
      /(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(?:vào\s+)?(?:ngày\s+)?\b(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{4}))?\b\s+(?:(?:lúc|vào)\s+)?(\d{1,2})(?:[:h](\d{2}))?\s*(h|giờ)?\s*(sáng|trưa|chiều|tối|đêm)?\s*[:,-]?\s*(.*)/i,
    );
    if (
      dateFirstMatch &&
      dateFirstMatch[1] &&
      dateFirstMatch[2] &&
      dateFirstMatch[4] &&
      (dateFirstMatch[5] || dateFirstMatch[6] || dateFirstMatch[7] || /(?:lúc|vào)\s+\d{1,2}/i.test(raw))
    ) {
      const day = parseInt(dateFirstMatch[1], 10);
      const month = parseInt(dateFirstMatch[2], 10) - 1;
      let year = dateFirstMatch[3] ? parseInt(dateFirstMatch[3], 10) : vn.year;
      let h = parseInt(dateFirstMatch[4], 10);
      const m = dateFirstMatch[5] ? parseInt(dateFirstMatch[5], 10) : 0;
      const period = dateFirstMatch[7]?.toLowerCase();

      if (period === "tối" || period === "chiều") {
        if (h < 12) h += 12;
      } else if (period === "sáng" && h === 12) {
        h = 0;
      }

      let targetTs = makeVietnamTimestamp(year, month, day, h, m);
      if (!dateFirstMatch[3] && targetTs < Date.now()) {
        year += 1;
        targetTs = makeVietnamTimestamp(year, month, day, h, m);
      }
      if (targetTs > Date.now()) {
        remindAt = targetTs;
        cleanContent = dateFirstMatch[8]?.trim() || "Có việc cần làm";
      }
    }
  }

  // 4b. Mẫu giờ đứng trước ngày: "15:00 30/08", "lúc 9h sáng ngày 15/10", "9h ngày 15/10"
  if (!remindAt) {
    const timeFirstMatch = raw.match(
      /(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(?:vào\s+|lúc\s+)?(\d{1,2})(?:[:h](\d{2}))?\s*(h|giờ)?\s*(sáng|trưa|chiều|tối|đêm)?\s*(?:vào\s+)?(?:ngày\s+)?\b(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{4}))?\b\s*[:,-]?\s*(.*)/i,
    );
    if (
      timeFirstMatch &&
      timeFirstMatch[1] &&
      timeFirstMatch[5] &&
      timeFirstMatch[6] &&
      (timeFirstMatch[2] || timeFirstMatch[3] || timeFirstMatch[4] || /(?:lúc|vào)\s+\d{1,2}/i.test(raw))
    ) {
      let h = parseInt(timeFirstMatch[1], 10);
      const m = timeFirstMatch[2] ? parseInt(timeFirstMatch[2], 10) : 0;
      const period = timeFirstMatch[4]?.toLowerCase();
      const day = parseInt(timeFirstMatch[5], 10);
      const month = parseInt(timeFirstMatch[6], 10) - 1;
      let year = timeFirstMatch[7] ? parseInt(timeFirstMatch[7], 10) : vn.year;

      if (period === "tối" || period === "chiều") {
        if (h < 12) h += 12;
      } else if (period === "sáng" && h === 12) {
        h = 0;
      }

      let targetTs = makeVietnamTimestamp(year, month, day, h, m);
      if (!timeFirstMatch[7] && targetTs < Date.now()) {
        year += 1;
        targetTs = makeVietnamTimestamp(year, month, day, h, m);
      }
      if (targetTs > Date.now()) {
        remindAt = targetTs;
        cleanContent = timeFirstMatch[8]?.trim() || "Có việc cần làm";
      }
    }
  }

  // 4c. Mẫu chỉ có ngày, không nói giờ (mặc định 08:30 sáng): "nhắc anh ngày 15/10 sinh nhật đối tác A"
  if (!remindAt) {
    const dateOnlyMatch = raw.match(
      /(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(?:vào\s+)?(?:ngày\s+)?\b(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{4}))?\b\s*[:,-]?\s*(.*)/i,
    );
    if (dateOnlyMatch && dateOnlyMatch[1] && dateOnlyMatch[2]) {
      const day = parseInt(dateOnlyMatch[1], 10);
      const month = parseInt(dateOnlyMatch[2], 10) - 1;
      let year = dateOnlyMatch[3] ? parseInt(dateOnlyMatch[3], 10) : vn.year;

      let targetTs = makeVietnamTimestamp(year, month, day, 8, 30);
      if (!dateOnlyMatch[3] && targetTs < Date.now()) {
        year += 1;
        targetTs = makeVietnamTimestamp(year, month, day, 8, 30);
      }
      if (targetTs > Date.now()) {
        remindAt = targetTs;
        cleanContent = dateOnlyMatch[4]?.trim() || "Có việc cần làm";
      }
    }
  }

  // 5. Mẫu: "HH:mm hôm nay", "HHh hôm nay", "HHh", "HH:mm" (ví dụ: "16h45 đi lấy nước", "17h đi họp", "17:30 đón con", "lúc 20h...")
  // BẮT BUỘC phải có chỉ báo thời gian rõ ràng (dấu :, chữ h/giờ, từ "lúc", hoặc từ "nhắc"/"hôm nay"). Tuyệt đối không bắt số vu vơ (như 20 TB, 50 GB)
  if (!remindAt) {
    const hasTimeIndicator =
      /[:h]\d{2}/.test(raw) ||
      /\b\d{1,2}\s*(?:h|giờ)\b/i.test(raw) ||
      /\blúc\s+\d{1,2}/i.test(raw) ||
      hasExplicitReminderWord;

    if (hasTimeIndicator) {
      const todayMatch = raw.match(/(?:nhắc\s+(?:tôi|tao|mình|em|anh|cả nhóm|mọi người)\s+)?(?:lúc\s*)?(\d{1,2})(?:[:h](\d{2}))?\s*(h|giờ)?\s*(sáng|trưa|chiều|tối|đêm)?\s*(?:hôm nay)?\s*[:,-]?\s*(.*)/i);
      if (todayMatch && todayMatch[1] && (todayMatch[2] || todayMatch[3] || hasExplicitReminderWord || /\blúc\s+\d{1,2}/i.test(raw))) {
        let h = parseInt(todayMatch[1], 10);
        const m = todayMatch[2] ? parseInt(todayMatch[2], 10) : 0;
        const period = todayMatch[4]?.toLowerCase();

        if (period === "tối" || period === "chiều") {
          if (h < 12) h += 12;
        } else if (period === "sáng" && h === 12) {
          h = 0;
        }

        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          let targetTs = makeVietnamTimestamp(vn.year, vn.month, vn.day, h, m);

          // Nếu giờ đó trong ngày hôm nay ở VN đã qua rồi (quá 2 phút), tự động chuyển sang ngày mai
          if (targetTs <= Date.now() - 2 * 60 * 1000) {
            targetTs = makeVietnamTimestamp(vn.year, vn.month, vn.day + 1, h, m);
          }

          remindAt = targetTs;
          cleanContent = todayMatch[5]?.trim() || "Có việc cần làm";
        }
      }
    }
  }

  if (!remindAt) return null;

  // Xóa bớt các từ thừa ở đầu và cuối nội dung
  cleanContent = cleanContent
    .replace(/^(?:nhắc|nhac)?\s*(?:tôi|tao|mình|em|anh|cả nhóm|mọi người|anh em|cho em|cho anh|hộ anh|giúp anh)?\s*/gi, "")
    .replace(/^(?:báo|bao|làm|lam|rằng|rang|là|la|rồi|phải|đi|về việc|ve viec)\s+/gi, "")
    .replace(/^[:,-]\s*/, "")
    .replace(/\s*(?:nhe|nhé|nha|nhá|ạ|a|nghen|nhen|nhé sếp|nhe sep)$/gi, "")
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

  const vnNowStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const vnTargetStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

  if (vnTargetStr === vnNowStr) return `lúc ${timeStr} hôm nay`;

  const tomorrow = new Date(now.getTime() + 86400000);
  const vnTomorrowStr = tomorrow.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  if (vnTargetStr === vnTomorrowStr) return `lúc ${timeStr} ngày mai (${dateStr})`;

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

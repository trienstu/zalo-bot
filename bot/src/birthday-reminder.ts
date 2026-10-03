/**
 * Module Quản lý Sinh nhật Thành viên & Tự động Thông báo Sếp mỗi sáng
 */

import {
  upsertMemberBirthday,
  getTodayMemberBirthdays,
  getAllMemberBirthdays,
  deleteMemberBirthday,
  getBotState,
  setBotState,
  getDb,
} from "./db/index.js";
import { notifyAdmins } from "./admin-assistant.js";

/**
 * Lấy ngày giờ hiện tại ở Việt Nam (GMT+7)
 */
function getVietnamDate() {
  const now = new Date();
  const vnFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = vnFormatter.formatToParts(now);
  const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  return {
    year: getPart("year"),
    month: getPart("month"), // 1-12
    day: getPart("day"),
    hour: getPart("hour"),
    minute: getPart("minute"),
    dateStr: `${getPart("year")}-${String(getPart("month")).padStart(2, "0")}-${String(getPart("day")).padStart(2, "0")}`,
  };
}

/**
 * Phân tích cú pháp nạp ngày sinh nhật từ văn bản
 */
export function parseBirthdayInput(
  rawText: string,
  mentions: Array<{ uid?: string; id?: string; name?: string }> = [],
  groupId = "",
): {
  targetUserId: string;
  targetName: string;
  day: number;
  month: number;
  year?: number | null;
  sdob: string;
  note: string;
} | null {
  const text = rawText.trim();
  if (!text) return null;

  // 1. Tìm ngày tháng năm trong câu (DD/MM hoặc DD/MM/YYYY, dấu /, -, .)
  const dateMatch = text.match(/\b(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{4}))?\b/);
  if (!dateMatch) return null;

  const day = parseInt(dateMatch[1] || "0", 10);
  const month = parseInt(dateMatch[2] || "0", 10);
  const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : null;

  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (year && (year < 1900 || year > 2100)) return null;

  const sdob = year
    ? `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`
    : `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;

  // 2. Xác định danh tính thành viên
  let targetUserId = "";
  let targetName = "";

  // 2a. Nếu có mention
  if (mentions && mentions.length > 0) {
    const m = mentions[0];
    targetUserId = String(m?.uid || m?.id || "").trim();
    targetName = String(m?.name || "").trim();
  }

  // 2b. Nếu không có mention, cố gắng bóc tách tên từ câu lệnh
  let cleanRemaining = text
    .replace(/^\/(?:sinhnhat|!sinhnhat|birthday)\s+/i, "")
    .replace(/(?:lưu|luu|thêm|them|cài|cai|đặt|dat)?\s*(?:ngày\s*)?sinh\s*nhật\s*(?:của|cho|thành viên)?/gi, "")
    .replace(/\b\d{1,2}[\/\.-]\d{1,2}(?:[\/\.-]\d{4})?\b/, "")
    .trim();

  // Bóc tách ghi chú nếu có (sau dấu - hoặc | hoặc ngoặc đơn)
  let note = "";
  const noteMatch = cleanRemaining.match(/[-|–]\s*(.+)$/);
  if (noteMatch && noteMatch[1]) {
    note = noteMatch[1].trim();
    cleanRemaining = cleanRemaining.replace(/[-|–]\s*.+$/, "").trim();
  }

  if (!targetName && cleanRemaining) {
    targetName = cleanRemaining.replace(/^@/, "").trim();
  }

  // Nếu chưa có targetUserId, thử tìm trong members/group_members bằng tên
  if (!targetUserId && targetName) {
    try {
      const db = getDb();
      const row = db
        .prepare(
          `SELECT zalo_user_id, display_name FROM group_members 
           WHERE display_name LIKE ? AND (group_id = ? OR ? = '')
           LIMIT 1`,
        )
        .get(`%${targetName}%`, groupId, groupId) as any;

      if (row?.zalo_user_id) {
        targetUserId = row.zalo_user_id;
        if (!targetName) targetName = row.display_name;
      } else {
        const mRow = db
          .prepare(`SELECT zalo_user_id, display_name FROM members WHERE display_name LIKE ? LIMIT 1`)
          .get(`%${targetName}%`) as any;
        if (mRow?.zalo_user_id) {
          targetUserId = mRow.zalo_user_id;
          if (!targetName) targetName = mRow.display_name;
        }
      }
    } catch {}
  }

  // Nếu vẫn không có targetUserId, tạo ID danh định từ tên để lưu được
  if (!targetUserId && targetName) {
    targetUserId = `custom_${targetName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
  }

  if (!targetUserId && !targetName) return null;

  return {
    targetUserId,
    targetName: targetName || "Thành viên",
    day,
    month,
    year,
    sdob,
    note,
  };
}

/**
 * Xử lý lệnh thêm/cập nhật ngày sinh nhật
 */
export function handleSetBirthday(
  rawText: string,
  mentions: any[] = [],
  groupId = "",
  adminId = "",
): string {
  const parsed = parseBirthdayInput(rawText, mentions, groupId);
  if (!parsed) {
    return [
      `⚠️ Cú pháp nạp ngày sinh nhật chưa chính xác!`,
      `💡 Sếp có thể dùng các mẫu dễ hiểu sau:`,
      `• /sinhnhat @Tên_thành_viên 15/08`,
      `• /sinhnhat @Tên_thành_viên 15/08/1992 - Khách hàng VIP`,
      `• /sinhnhat Nguyễn Văn A 20/10/1990`,
      `• "Lưu sinh nhật của @Tên là ngày 15/08"`,
    ].join("\n");
  }

  const ok = upsertMemberBirthday({
    zaloUserId: parsed.targetUserId,
    groupId,
    displayName: parsed.targetName,
    day: parsed.day,
    month: parsed.month,
    year: parsed.year,
    sdob: parsed.sdob,
    note: parsed.note,
    createdBy: adminId,
  });

  if (!ok) {
    return `⚠️ Có lỗi khi lưu thông tin sinh nhật vào cơ sở dữ liệu. Sếp vui lòng thử lại sau!`;
  }

  let ageStr = "";
  if (parsed.year) {
    const vnYear = getVietnamDate().year;
    ageStr = ` (${vnYear - parsed.year} tuổi)`;
  }

  return [
    `🎂 ĐÃ LƯU NGÀY SINH NHẬT THÀNH CÔNG! 🎉`,
    `━━━━━━━━━━━━━━━━━━`,
    `👤 Thành viên: ${parsed.targetName}`,
    `🗓️ Ngày sinh: ${parsed.sdob}${ageStr}`,
    parsed.note ? `📝 Ghi chú: ${parsed.note}` : "",
    `━━━━━━━━━━━━━━━━━━`,
    `⏰ Bot sẽ tự động gửi tin nhắn 1:1 báo thức Sếp lúc 08:00 sáng đúng ngày sinh nhật! ✨`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Liệt kê danh sách sinh nhật sắp tới
 */
export function handleListUpcomingBirthdays(limitDays = 30): string {
  const all = getAllMemberBirthdays();
  if (all.length === 0) {
    return [
      `🎂 Hiện chưa có thông tin sinh nhật nào được lưu.`,
      `💡 Để thêm sinh nhật thành viên, Sếp gõ: /sinhnhat @Tên DD/MM nhé!`,
    ].join("\n");
  }

  const vn = getVietnamDate();
  const currentTs = Date.now();

  const withDays = all
    .map((b) => {
      let bYear = vn.year;
      let targetDate = new Date(Date.UTC(bYear, b.month - 1, b.day, 1, 0, 0));
      if (targetDate.getTime() < currentTs - 24 * 3600 * 1000) {
        bYear += 1;
        targetDate = new Date(Date.UTC(bYear, b.month - 1, b.day, 1, 0, 0));
      }
      const diffMs = targetDate.getTime() - currentTs;
      const daysLeft = Math.ceil(diffMs / (24 * 3600 * 1000));
      return { ...b, daysLeft };
    })
    .filter((b) => b.daysLeft >= 0 && b.daysLeft <= limitDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (withDays.length === 0) {
    return [
      `🎂 Trong ${limitDays} ngày tới không có thành viên nào sinh nhật.`,
      `📊 Tổng số thành viên đã lưu sinh nhật: ${all.length} người.`,
      `💡 Gõ /sinhnhat @Tên DD/MM để thêm sinh nhật mới.`,
    ].join("\n");
  }

  const lines = [
    `🎂 DANH SÁCH SINH NHẬT TRONG ${limitDays} NGÀY TỚI 🎈`,
    `━━━━━━━━━━━━━━━━━━`,
    ...withDays.map((b, idx) => {
      const dayLeftDesc =
        b.daysLeft === 0
          ? "🎉 HÔM NAY 🎉"
          : b.daysLeft === 1
          ? "👉 Ngày mai"
          : `⏳ Còn ${b.daysLeft} ngày`;
      const notePart = b.note ? ` - [${b.note}]` : "";
      return `${idx + 1}. ${b.displayName}: ${b.sdob} (${dayLeftDesc})${notePart}`;
    }),
    `━━━━━━━━━━━━━━━━━━`,
    `💡 Bot sẽ tự động báo cho Sếp lúc 08:00 sáng đúng ngày sinh nhật!`,
  ];

  return lines.join("\n");
}

/**
 * Xóa thông tin sinh nhật của thành viên
 */
export function handleDeleteBirthday(targetNameOrId: string): string {
  const clean = targetNameOrId.replace(/^\/(?:xoasinhnhat|!xoasinhnhat)\s+/i, "").trim();
  if (!clean) {
    return `⚠️ Vui lòng nhập tên hoặc @mention thành viên cần xóa sinh nhật (Ví dụ: /xoasinhnhat Nguyễn Văn A).`;
  }

  const all = getAllMemberBirthdays();
  const match = all.find(
    (b) =>
      b.zaloUserId === clean ||
      b.displayName.toLowerCase().includes(clean.toLowerCase()),
  );

  if (!match) {
    return `⚠️ Không tìm thấy thông tin sinh nhật của "${clean}" trong danh sách.`;
  }

  const ok = deleteMemberBirthday(match.zaloUserId, match.groupId);
  if (ok) {
    return `✅ Đã xóa thành công thông tin sinh nhật của ${match.displayName}!`;
  } else {
    return `⚠️ Có lỗi khi xóa thông tin sinh nhật. Sếp vui lòng thử lại!`;
  }
}

/**
 * Vòng lặp định kỳ kiểm tra và tự động gửi thông báo sinh nhật lúc 8:00 sáng
 */
export async function checkDailyBirthdayCronLoop(api: any): Promise<void> {
  try {
    const vn = getVietnamDate();
    // Khung giờ gửi thông báo: từ 8:00 sáng đến 22:00 tối
    if (vn.hour < 8) return;

    const stateKey = "last_birthday_notify_date";
    const lastNotified = getBotState(stateKey);
    if (lastNotified === vn.dateStr) {
      // Hôm nay đã kiểm tra và thông báo rồi
      return;
    }

    // 1. Quét từ bảng member_birthdays
    const todayBirthdays = getTodayMemberBirthdays(vn.month, vn.day);

    // 2. Quét bổ sung từ bảng zalomkt_contacts (nếu có)
    const extraContacts: Array<{ name: string; sdob: string; phone?: string }> = [];
    try {
      const db = getDb();
      const sdobDayMonth = `${String(vn.day).padStart(2, "0")}/${String(vn.month).padStart(2, "0")}`;
      const zalomktRows = db
        .prepare(
          `SELECT display_name, zalo_name, sdob, phone FROM zalomkt_contacts 
           WHERE sdob LIKE ?`,
        )
        .all(`${sdobDayMonth}%`) as any[];

      for (const z of zalomktRows) {
        const name = z.display_name || z.zalo_name || z.phone;
        // Bỏ qua nếu đã có trong todayBirthdays
        if (!todayBirthdays.some((b) => b.displayName === name)) {
          extraContacts.push({ name, sdob: z.sdob, phone: z.phone });
        }
      }
    } catch {}

    const totalCount = todayBirthdays.length + extraContacts.length;

    if (totalCount > 0) {
      console.log(`[birthday] 🎂 Hôm nay có ${totalCount} thành viên/khách hàng sinh nhật! Đang gửi thông báo cho Sếp...`);

      const items: string[] = [];
      let idx = 1;

      for (const b of todayBirthdays) {
        let ageStr = "";
        if (b.year) {
          ageStr = ` (${vn.year - b.year} tuổi)`;
        }
        const noteStr = b.note ? `\n   📝 Ghi chú: ${b.note}` : "";
        items.push(`${idx++}. 🎉 ${b.displayName} - Ngày sinh: ${b.sdob}${ageStr}${noteStr}`);
      }

      for (const c of extraContacts) {
        const phoneStr = c.phone ? ` (SĐT: ${c.phone})` : "";
        items.push(`${idx++}. 🎉 [Khách hàng] ${c.name}${phoneStr} - Ngày sinh: ${c.sdob}`);
      }

      const dateDisplay = `${String(vn.day).padStart(2, "0")}/${String(vn.month).padStart(2, "0")}/${vn.year}`;
      const msg = [
        `🎂 [THÔNG BÁO SINH NHẬT HÔM NAY] 🎈`,
        `Dạ Sếp ơi! Hôm nay (${dateDisplay}) là ngày sinh nhật của:`,
        `━━━━━━━━━━━━━━━━━━`,
        ...items,
        `━━━━━━━━━━━━━━━━━━`,
        `✨ Sếp nhớ gửi lời chúc mừng hoặc món quà nhỏ để tạo gắn kết nhé! 🎉`,
      ].join("\n");

      await notifyAdmins(api, msg);
    }

    // Đánh dấu hôm nay đã gửi thành công
    setBotState(stateKey, vn.dateStr, Date.now());
  } catch (e) {
    console.warn(`[birthday] checkDailyBirthdayCronLoop error:`, e);
  }
}

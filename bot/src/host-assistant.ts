import {
  isUserAdmin,
  saveAdminMentionAlert,
  markAdminMentionsAnswered,
  getPendingAdminMentionAlerts,
  markAdminMentionNotified,
  hasAdminRepliedInGroup,
  getBotState,
  setBotState,
  getDb,
} from "./db/index.js";
import { sendDirectText } from "./zalo/client.js";
import { notifyAdmins } from "./admin-assistant.js";
import { checkDailyInsightCronLoop } from "./group-insight.js";

// =========================================================================
// 1. THEO DÕI & NHẮC NHỞ ADMIN KHI BỊ TAG QUÁ 10-15 PHÚT CHƯA TRẢ LỜI
// =========================================================================

/**
 * Ghi nhận sự kiện Admin bị thành viên tag trong nhóm
 */
export function handleGroupMentions(
  _api: any,
  params: {
    threadId: string;
    sender: string;
    displayName: string;
    text: string;
    mentions: any[];
    groupName?: string;
    msgId?: string;
  },
): void {
  const { threadId, sender, displayName, text, mentions, groupName, msgId } = params;

  if (!mentions || !Array.isArray(mentions) || mentions.length === 0) return;
  if (!text || !threadId) return;

  // Nếu người gửi chính là Admin thì không cần theo dõi tự tag
  if (isUserAdmin(sender)) return;

  let gName = groupName || "";
  if (!gName) {
    try {
      const row = getDb()
        .prepare("SELECT name FROM bot_groups WHERE group_id = ?")
        .get(threadId) as any;
      if (row?.name) gName = row.name;
    } catch {}
  }
  if (!gName) gName = `Nhóm ${threadId.slice(-6)}`;

  const now = Date.now();
  const effectiveMsgId = msgId || String(now);

  for (const m of mentions) {
    const adminId = String(m?.uid || m?.id || "").trim();
    if (!adminId) continue;

    // Chỉ theo dõi nếu người được tag là Quản trị viên / Sếp
    if (isUserAdmin(adminId)) {
      saveAdminMentionAlert({
        groupId: threadId,
        groupName: gName,
        messageId: effectiveMsgId,
        senderId: sender,
        senderName: displayName || "Thành viên",
        text,
        adminId,
        createdAt: now,
      });
      console.log(
        `[host-assistant] 📌 Đã ghi nhận admin ${adminId} được tag bởi ${displayName} trong nhóm [${gName}]. Bắt đầu đếm giờ nhắc nhở...`,
      );
    }
  }
}

/**
 * Ghi nhận hoạt động của Admin trong nhóm để huỷ nhắc nhở nếu đã vào phản hồi
 */
export function handleAdminActivity(threadId: string, sender: string): void {
  if (!threadId || !sender) return;
  if (isUserAdmin(sender)) {
    markAdminMentionsAnswered(threadId, sender);
  }
}

/**
 * Vòng lặp định kỳ (mỗi 60s) quét các tin nhắn tag admin quá 10 phút chưa phản hồi
 */
async function checkPendingMentionAlertsLoop(api: any): Promise<void> {
  try {
    // Tìm các tag từ 10 phút đến 3 tiếng trước
    const MIN_WAIT_MS = 10 * 60 * 1000; // 10 phút
    const MAX_WAIT_MS = 3 * 60 * 60 * 1000; // 3 tiếng

    const pendingAlerts = getPendingAdminMentionAlerts(MIN_WAIT_MS, MAX_WAIT_MS);
    if (pendingAlerts.length === 0) return;

    for (const alert of pendingAlerts) {
      // Kiểm tra xem admin đã gửi bất kỳ tin nhắn nào trong nhóm sau thời điểm bị tag chưa
      const replied = hasAdminRepliedInGroup(alert.group_id, alert.admin_id, alert.created_at);
      if (replied) {
        markAdminMentionsAnswered(alert.group_id, alert.admin_id);
        continue;
      }

      // Nếu chưa phản hồi sau 10 phút -> gửi tin nhắn Zalo 1:1 nhắc nhở Sếp
      const diffMin = Math.round((Date.now() - alert.created_at) / 60000);
      const timeStr = new Date(alert.created_at).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Bangkok",
      });

      let textSnippet = alert.text;
      if (textSnippet.length > 200) {
        textSnippet = textSnippet.slice(0, 200) + "...";
      }

      const reminderMsg =
        `🔔 [NHẮC VIỆC: SẾP ĐƯỢC TAG TRONG NHÓM MÀ CHƯA TRẢ LỜI]\n\n` +
        `👥 Nhóm: ${alert.group_name || alert.group_id}\n` +
        `👤 Thành viên gọi: ${alert.sender_name} (ID: ${alert.sender_id})\n` +
        `⏰ Thời gian gửi: ${timeStr} (đã qua ${diffMin} phút)\n\n` +
        `💬 Nội dung tin nhắn:\n` +
        `"${textSnippet}"\n\n` +
        `👉 Em gửi tin nhắn riêng để sếp nắm bắt và vào phản hồi cho thành viên khi thuận tiện nhé! 💼`;

      try {
        console.log(`[host-assistant] ⏰ Đang gửi tin nhắn 1:1 nhắc admin ${alert.admin_id} về tag quá hạn trong nhóm [${alert.group_name}]...`);
        await sendDirectText(api, alert.admin_id, reminderMsg);
        markAdminMentionNotified(alert.id);
      } catch (err) {
        console.warn(`[host-assistant] Gửi nhắc nhở tag tới admin ${alert.admin_id} thất bại:`, err);
      }
    }
  } catch (e) {
    console.warn("[host-assistant] checkPendingMentionAlertsLoop error:", e);
  }
}

// =========================================================================
// 2. CHẤM ĐIỂM ĐỘ GẤP & CẢM XÚC KHÁCH HÀNG (URGENCY & SENTIMENT SCORING)
// =========================================================================

export interface UrgencyEvaluation {
  score: number;
  isUrgent: boolean;
  reasons: string[];
}

/**
 * Phân tích độ gấp, mức độ bức xúc và rủi ro của tin nhắn theo nguyên tắc tổng quát hóa đa lĩnh vực
 */
export function evaluateCustomerUrgency(text: string): UrgencyEvaluation {
  if (!text) return { score: 0, isUrgent: false, reasons: [] };

  let score = 0;
  const reasons: string[] = [];

  // Nhóm 1: Khiếu nại, tố cáo, tranh chấp, pháp lý, gian lận (+60 điểm - Nguy cơ cao cần can thiệp)
  if (
    /(?:lừa đảo|scam|gian lận|báo công an|tố cáo|khởi kiện|ra tòa|kiện cáo|ăn cướp|bùng tiền|quỵt tiền|trả lại tiền|bồi thường|chiếm đoạt)/i.test(
      text,
    )
  ) {
    score += 60;
    reasons.push("Khiếu nại/Tố cáo/Gian lận");
  }

  // Nhóm 2: Sự cố khẩn cấp, cháy tài khoản, kẹt tiền, sập hệ thống (+50 điểm)
  if (
    /(?:gấp lắm|alo gấp|khẩn cấp|cứu với|cứu em|cứu tôi|cháy tài khoản|cháy tk|tiền chưa vào|mất tiền|treo lệnh|không rút được|kẹt tiền|lỗi nghiêm trọng|sập web|sập server|chết bot|hỏng hệ thống)/i.test(
      text,
    )
  ) {
    score += 50;
    reasons.push("Sự cố khẩn cấp/Mất mát/Kẹt tiền");
  }

  // Nhóm 3: Thái độ bức xúc, phàn nàn thời gian chờ, thất vọng (+30 điểm)
  if (
    /(?:sao lâu thế|chờ mãi|sao chưa trả lời|bực mình|thất vọng|tệ quá|làm ăn kiểu gì|vô trách nhiệm|support đâu rồi|có ai trực không)/i.test(
      text,
    )
  ) {
    score += 30;
    reasons.push("Thái độ bức xúc/Chờ đợi lâu");
  }

  // Nhóm 4: Cảm xúc cú pháp (Nhiều dấu chấm than hoặc viết hoa toàn bộ) (+10 điểm)
  if (/!{3,}/.test(text)) {
    score += 10;
    reasons.push("Cảm xúc mạnh (!!!)");
  }

  // Viết hoa liên tục từ 3 từ trở lên (thể hiện la hét / stress)
  if (
    /(?:^|\s)[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]{3,}(?:\s+[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]{3,}){2,}/.test(
      text,
    )
  ) {
    score += 10;
    reasons.push("Nhấn mạnh viết hoa (CAPS)");
  }

  score = Math.min(100, score);
  const isUrgent = score >= 60;

  return { score, isUrgent, reasons };
}

// Chống spam cảnh báo khẩn: Lưu mốc thời gian cảnh báo gần nhất của mỗi sender (cooldown 10 phút)
const lastUrgentAlertPerSender = new Map<string, number>();
const URGENT_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Kiểm tra và gửi cảnh báo khẩn cấp cho Quản trị viên nếu khách hàng nhắn tin bức xúc hoặc cần hỗ trợ gấp
 */
export async function checkAndNotifyCustomerUrgency(
  api: any,
  params: {
    threadId: string;
    sender: string;
    displayName: string;
    text: string;
    isGroup: boolean;
    groupName?: string;
  },
): Promise<void> {
  const { threadId, sender, displayName, text, isGroup, groupName } = params;

  // Bỏ qua tin nhắn từ Admin hoặc Bot
  if (!text || isUserAdmin(sender)) return;

  const evalResult = evaluateCustomerUrgency(text);
  if (!evalResult.isUrgent) return;

  const now = Date.now();
  const lastAlertTime = lastUrgentAlertPerSender.get(sender) || 0;
  if (now - lastAlertTime < URGENT_COOLDOWN_MS) {
    return;
  }
  lastUrgentAlertPerSender.set(sender, now);

  const timeStr = new Date(now).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
  const dateStr = new Date(now).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });

  let textSnippet = text;
  if (textSnippet.length > 250) {
    textSnippet = textSnippet.slice(0, 250) + "...";
  }

  const locationDesc = isGroup
    ? `Nhóm [${groupName || threadId}]`
    : `Tin nhắn riêng 1:1`;

  const alertMsg =
    `🚨 [CẢNH BÁO KHẨN CẤP: KHÁCH HÀNG BỨC XÚC / CẦN HỖ TRỢ GẤP]\n\n` +
    `📊 Điểm khẩn cấp: ${evalResult.score}/100 ⚠️\n` +
    `🔍 Lý do nhận diện: ${evalResult.reasons.join(", ")}\n` +
    `👤 Khách hàng: ${displayName} (ID: ${sender})\n` +
    `📍 Kênh: ${locationDesc}\n` +
    `⏰ Thời gian: ${timeStr} - ${dateStr}\n\n` +
    `💬 Lời nhắn của khách:\n` +
    `"${textSnippet}"\n\n` +
    `👉 Đề xuất: Sếp nên ưu tiên xem xét và hỗ trợ khách ngay nhé! ⚡`;

  console.warn(`[host-assistant] 🚨 Bắn cảnh báo khẩn cấp từ khách hàng ${displayName} (${sender}) tới các Admin!`);
  await notifyAdmins(api, alertMsg);
}

// =========================================================================
// 3. THÔNG BÁO HOÀN TẤT & TRẢ LỜI BÙ SAU KHI KHỞI ĐỘNG LẠI BOT (RESTART CATCH-UP)
// =========================================================================

/**
 * Kiểm tra trạng thái khởi động lại và thông báo cho Admin nếu bot vừa reboot
 */
export async function checkRestartCatchUp(api: any): Promise<void> {
  const LAST_ACTIVE_KEY = "last_active_heartbeat_ts";
  const rawLastActive = getBotState(LAST_ACTIVE_KEY);
  const now = Date.now();

  if (rawLastActive) {
    const lastActiveTs = parseInt(rawLastActive, 10);
    const downtimeMs = now - lastActiveTs;

    // Nếu bot bị gián đoạn từ 20 giây đến 12 tiếng -> gửi thông báo phục hồi cho Sếp
    if (downtimeMs > 20_000 && downtimeMs < 12 * 60 * 60 * 1000) {
      const downtimeSec = Math.floor(downtimeMs / 1000);
      const minutes = Math.floor(downtimeSec / 60);
      const seconds = downtimeSec % 60;
      const downtimeFormatted =
        minutes > 0 ? `${minutes} phút ${seconds} giây` : `${seconds} giây`;

      const timeStr = new Date(now).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Bangkok",
      });
      const dateStr = new Date(now).toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Asia/Bangkok",
      });

      const notifyMsg =
        `🚀 [MÁY CHỦ & BOT ĐÃ KHỞI ĐỘNG LẠI THÀNH CÔNG]\n\n` +
        `⏰ Thời gian: ${timeStr} - ${dateStr}\n` +
        `🤖 Phiên bản: Bot 2 ("Sen Chúa") đã online ổn định.\n` +
        `⏱️ Thời gian gián đoạn: ${downtimeFormatted}\n` +
        `📡 Socket: 🟢 Đã kết nối lại bình thường!\n\n` +
        `✨ Tất cả các tác vụ giám sát sức khỏe, nhắc việc và phụ tá đã hoạt động trở lại! 💪`;

      console.log(`[host-assistant] 🚀 Đang gửi thông báo khởi động lại thành công tới các Admin...`);
      void notifyAdmins(api, notifyMsg).catch(() => {});
    }
  }

  // Cập nhật timestamp hoạt động ngay lập tức
  setBotState(LAST_ACTIVE_KEY, String(now), now);

  // Vòng lặp duy trì timestamp hoạt động mỗi 20 giây
  setInterval(() => {
    setBotState(LAST_ACTIVE_KEY, String(Date.now()), Date.now());
  }, 20_000);
}

/**
 * Khởi tạo toàn bộ module Smart Host Alerting
 */
export function initHostAssistant(api: any): void {
  console.log("[host-assistant] 🚀 Khởi chạy module Phụ tá Thông minh (Smart Host Alerting & Tag Reminder)...");

  // Vòng lặp kiểm tra nhắc nhở tag admin mỗi 60 giây
  setInterval(() => {
    void checkPendingMentionAlertsLoop(api);
  }, 60_000);

  // Kiểm tra phục hồi sau restart
  setTimeout(() => {
    void checkRestartCatchUp(api);
  }, 3_000);

  // Vòng lặp kiểm tra xuất báo cáo Insight nhóm lúc 01:00 sáng
  setInterval(() => {
    void checkDailyInsightCronLoop(api);
  }, 30_000);
}

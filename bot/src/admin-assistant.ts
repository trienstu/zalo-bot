import { getDb, isUserAdmin, addAdminUser, setGroupMode, isUserAllowedDirectChat } from "./db/index.js";
import { sendDirectText, sendGroupText } from "./zalo/client.js";
import { callGemini, downloadFileContent, type GeminiMediaPart } from "./gemini.js";
import type { MemberMessageEvent } from "./member-assistant.js";
import { getWeatherReport } from "./weather.js";
import { handleSetReminder, handleListReminders, handleCancelReminder, parseNaturalTimeVietnam } from "./reminder.js";
import { getDailyAiNewsBriefing } from "./ai-news.js";
import { searchRealtimeNews } from "./realtime-search.js";

// Lưu lịch sử trò chuyện nhiều lượt (Multi-turn Chat) giữa Admin và Bot (Lưu tối đa 12 lượt gần nhất)
const adminChatSessions = new Map<string, { role: "user" | "model"; text: string }[]>();
const MAX_HISTORY_TURNS = 12;

function getAdminHistory(userId: string) {
  if (!adminChatSessions.has(userId)) {
    adminChatSessions.set(userId, []);
  }
  return adminChatSessions.get(userId)!;
}

function appendAdminHistory(userId: string, role: "user" | "model", text: string) {
  const history = getAdminHistory(userId);
  history.push({ role, text });
  if (history.length > MAX_HISTORY_TURNS) {
    history.splice(0, history.length - MAX_HISTORY_TURNS);
  }
}

/**
 * Chuẩn hóa chuỗi tìm kiếm (xóa dấu tiếng Việt, viết thường).
 */
function normalizeQuery(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tìm kiếm nhóm Zalo theo ID hoặc theo tên gần đúng / tên tắt.
 */
function findGroup(query: string): { groupId: string; name: string; totalMembers: number; mode: string } | null {
  const db = getDb();
  const rawQ = query.trim();
  if (!rawQ) return null;

  // 1. Thử match chính xác group_id
  try {
    const byId = db
      .prepare("SELECT group_id as groupId, name, total_members as totalMembers, mode FROM bot_groups WHERE group_id = ?")
      .get(rawQ) as any;
    if (byId) return byId;
  } catch {}

  const allGroups = getAllGroupsList();
  if (allGroups.length === 0) return null;

  const cleanQ = normalizeQuery(rawQ);

  // 2. Thử match theo tên (chứa trọn vẹn hoặc khớp chuẩn)
  for (const g of allGroups) {
    const cleanGName = normalizeQuery(g.name);
    if (cleanGName === cleanQ || cleanGName.includes(cleanQ) || cleanQ.includes(cleanGName)) {
      return g;
    }
  }

  // 3. Khớp theo từ khóa đặc thù trong các nhóm Zalo thường gặp
  for (const g of allGroups) {
    const cleanGName = normalizeQuery(g.name);
    if (cleanQ.includes("vip") && cleanGName.includes("vip")) return g;
    if (cleanQ.includes("ai") && (cleanGName.includes("ai") || cleanGName.includes("cong nghe"))) return g;
    if ((cleanQ.includes("nhau") || cleanQ.includes("an nhau")) && cleanGName.includes("nhau")) return g;
    if (cleanQ.includes("hem") && cleanGName.includes("hem")) return g;
    if ((cleanQ.includes("dxs") || cleanQ.includes("imperia") || cleanQ.includes("sensa")) && cleanGName.includes("dxs")) return g;
    if (cleanQ.includes("nam hung") && cleanGName.includes("nam hung")) return g;
    if (cleanQ.includes("than mat") && cleanGName.includes("than mat")) return g;
  }

  return null;
}

/**
 * Lấy danh sách tất cả các nhóm đang quản lý.
 */
function getAllGroupsList(): { groupId: string; name: string; totalMembers: number; mode: string }[] {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT group_id as groupId, name, total_members as totalMembers, mode FROM bot_groups ORDER BY updated_at DESC").all() as any[];
    if (rows && rows.length > 0) return rows;

    // Fallback nếu bảng bot_groups chưa có dữ liệu
    const distinctGroups = db.prepare("SELECT DISTINCT thread_id FROM group_messages WHERE thread_id != '' AND thread_id NOT LIKE 'u%' LIMIT 15").all() as { thread_id: string }[];
    if (distinctGroups && distinctGroups.length > 0) {
      return distinctGroups.map((g) => ({
        groupId: g.thread_id,
        name: `Nhóm Zalo ${g.thread_id.slice(-6)}`,
        totalMembers: 0,
        mode: "interactive",
      }));
    }
    return [];
  } catch (e) {
    console.warn(`[admin-assistant] getAllGroupsList error: ${String(e)}`);
    return [];
  }
}

/**
 * Trích xuất nội dung bài viết cốt lõi được AI soạn thảo gần nhất (loại bỏ lời chào dạo đầu của bot).
 */
function cleanDraftedPost(text: string): string {
  let cleaned = text.trim();
  // Xóa lời dạo đầu kiểu "Dạ em Sen Chúa soạn xong..." hoặc "Nhiệm vụ hoàn thành xuất sắc..."
  cleaned = cleaned.replace(/^Dạ\s+(?:em\s+)?(?:Sen Chúa\s+)?(?:xin\s+phép\s+)?(?:gửi\s+)?(?:soạn\s+)?(?:bài|thông báo|lời chúc)[^\n]*\n+/i, "");
  cleaned = cleaned.replace(/^(?:Nhiệm vụ|Báo cáo Sếp)[^\n]*\n+/i, "");
  cleaned = cleaned.replace(/\n+---\s*\n+Nhiệm vụ hoàn thành[^\n]*$/i, "");
  cleaned = cleaned.replace(/\n+Sếp có cần em[^\n]*$/i, "");
  return cleaned.trim() || text.trim();
}

/**
 * Xử lý toàn bộ tương tác 1:1 giữa Admin và Bot qua Tin nhắn trực tiếp (Direct Message).
 */
export async function handleAdminDirectInteraction(api: any, event: MemberMessageEvent): Promise<void> {
  const rawText = (event.text || "").trim();
  const sender = event.sender;
  const displayName = event.displayName || "Admin";
  const hasFile = Boolean(event.fileAttachment);
  const hasImage = Boolean(event.mediaUrl || event.quote?.mediaUrl);

  if (!rawText && !hasFile && !hasImage) return;

  // TUYỆT ĐỐI BỎ QUA MỌI TIN NHẮN TỰ PHÁT HOẶC ECHO CỦA CHÍNH TÀI KHOẢN BOT (CHỐNG LẶP VÔ TẬN)
  if (event.isSelf) {
    // Chỉ xử lý nếu chính chủ gõ lệnh bắt đầu bằng / hoặc !
    if (!rawText.startsWith("/") && !rawText.startsWith("!")) {
      return;
    }
  }

  const lower = rawText.toLowerCase();

  // =========================================================================
  // 1. KIỂM TRA QUYỀN ADMIN & XÁC THỰC MẬT KHẨU
  // =========================================================================
  const isAdmin = event.isSelf || isUserAdmin(sender);

  // Lệnh xác thực quyền Admin: /admin <password> hoặc /auth <password>
  if (lower.startsWith("/admin") || lower.startsWith("/auth") || lower.startsWith("!admin") || lower.startsWith("!auth")) {
    const parts = rawText.split(/\s+/);
    const providedPass = parts[1] || "";

    if (providedPass === (process.env.ADMIN_PASSWORD || "Admin@!#321")) {
      addAdminUser(sender, displayName);
      const reply =
        `👑 XÁC THỰC THÀNH CÔNG! CHÀO MỪNG SẾP ${displayName.toUpperCase()}!\n\n` +
        `✅ Tài khoản Zalo của Sếp (${sender}) đã được cấp quyền SUPER ADMIN vĩnh viễn.\n` +
        `Từ bây giờ Sếp có thể nhắn tin riêng trực tiếp để ra lệnh điều khiển các nhóm hoặc hỏi đáp với em bất kỳ lúc nào.\n\n` +
        `👉 Gõ /help để xem danh sách các lệnh quản trị nhé Sếp!`;
      await sendDirectText(api, sender, reply);
      return;
    } else {
      await sendDirectText(
        api,
        sender,
        `❌ Mật khẩu Admin không chính xác!\nVui lòng thử lại với cú pháp: /admin <mật_khẩu>`,
      );
      return;
    }
  }

  // Kiểm tra quyền tương tác 1:1: Admin hoặc Bạn bè được cấp quyền qua Dashboard
  const isAllowedFriend = isUserAllowedDirectChat(sender);

  // Nếu người nhắn tin không phải là Admin và không thuộc danh sách được cấp quyền:
  // Hoàn toàn IM LẶNG - để tài khoản hoạt động như một Zalo cá nhân bình thường, chống spam.
  if (!isAdmin && !isAllowedFriend) {
    return;
  }

  // =========================================================================
  // 2. TRỢ LÝ ĐIỀU KHIỂN & RA LỆNH 1:1
  // =========================================================================

  // 2.1. Lệnh /help hoặc /menu
  if (lower === "/help" || lower === "help" || lower === "!help" || lower === "/menu" || lower === "menu") {
    if (isAdmin) {
      const helpMsg =
        `👑 BẢNG LỆNH QUẢN TRỊ & ĐIỀU KHIỂN BOT (1:1 VỚI ADMIN):\n\n` +
        `⏰ ĐẶT HẸN & NHẮC VIỆC CÁ NHÂN:\n` +
        `🔹 /nhacnho [thời gian] [nội dung] : Đặt hẹn nhắc việc (VD: /nhacnho 20p Uống nước, /hengio 17:30 Đi đón con)\n` +
        `🔹 /dsnhac : Xem danh sách các lịch hẹn đang chờ của bạn\n` +
        `🔹 /huynhac [mã_số] : Hủy lịch hẹn theo mã\n` +
        `🔹 Hoặc chat tự nhiên: "Nhắc tôi 30 phút nữa gọi cho anh Nam", "8h tối mai nhắc tôi xem bóng đá"\n\n` +
        `☀️ TRA CỨU THỜI TIẾT & BẢN TIN AI:\n` +
        `🔹 /thoitiet [địa điểm] : Xem thời tiết & bụi mịn PM2.5 (TP.HCM, Hà Nội, Đà Lạt...)\n` +
        `🔹 /bantin : Xem ngay điểm tin AI & Công nghệ nóng nhất 24h qua trên X/Twitter\n\n` +
        `📋 QUẢN LÝ NHÓM ZALO:\n` +
        `🔹 /groups : Xem danh sách & ID tất cả các nhóm Zalo Bot đang tham gia\n` +
        `🔹 /send [tên_nhóm/id] [nội dung] : Gửi tin nhắn/thông báo vào nhóm chỉ định\n` +
        `🔹 /broadcast [nội dung] : Bắn thông báo cùng lúc đến TẤT CẢ các nhóm\n` +
        `🔹 /mode [tên_nhóm] [interactive/silent] : Đổi chế độ nhóm (Tương tác / Tàu ngầm)\n\n` +
        `💬 TRỢ LÝ AI RIÊNG TƯ & GOOGLE SEARCH:\n` +
        `🔹 Tìm kiếm thông tin thời gian thực, trend AI, tin tức hôm nay bằng Google Search tích hợp sẵn.\n` +
        `🔹 Soạn bài rồi bảo: "Gửi bài này vào nhóm VIP" hoặc "Bắn vào nhóm AI"\n` +
        `🔹 Phân tích file tài liệu (PDF, Word, Excel, Code) hoặc ảnh bằng AI.`;
      await sendDirectText(api, sender, helpMsg);
    } else {
      const memberHelpMsg =
        `👋 CHÀO BẠN ${displayName.toUpperCase()}!\n\n` +
        `🤖 Em là Sen Chúa - Trợ lý AI đồng hành cùng bạn trên Zalo. Bạn có thể:\n\n` +
        `💬 HỎI ĐÁP & TRÒ CHUYỆN TỰ NHIÊN:\n` +
        `🔹 Trò chuyện, giải đáp thắc mắc, tư vấn công việc, học tập, dịch thuật.\n` +
        `🔹 Tra cứu tin tức thời gian thực, trend AI, sự kiện hôm nay với Google Search thời gian thực.\n` +
        `🔹 Gửi hình ảnh hoặc file tài liệu (PDF, Word, Excel, Code) để em phân tích nhanh.\n\n` +
        `☀️ THỜI TIẾT & BẢN TIN AI:\n` +
        `🔹 /thoitiet [địa điểm] : Xem thời tiết & chỉ số không khí AQI\n` +
        `🔹 /bantin : Xem ngay điểm tin AI & Công nghệ nóng nhất 24h qua\n\n` +
        `⏰ ĐẶT HẸN & NHẮC VIỆC CÁ NHÂN:\n` +
        `🔹 /nhacnho [thời gian] [nội dung] : Đặt hẹn nhắc việc\n` +
        `🔹 Hoặc nhắn tự nhiên: "30 phút nữa nhắc tôi uống nước", "8h tối nay nhắc tôi gọi điện..."`;
      await sendDirectText(api, sender, memberHelpMsg);
    }
    return;
  }

  // 2.2. Lệnh /bantin (Bản tin AI & Công nghệ 24h qua)
  if (lower === "/bantin" || lower === "!bantin" || lower === "bantin" || /bản tin (?:ai|sáng|công nghệ|hôm nay)/i.test(rawText)) {
    const briefing = await getDailyAiNewsBriefing("AI & Công nghệ trên X", "Sen Chúa");
    await sendDirectText(api, sender, briefing);
    return;
  }

  // 2.3. Lệnh /thoitiet [Địa điểm]
  if (lower.startsWith("/thoitiet") || lower.startsWith("!thoitiet")) {
    const cityInput = rawText.replace(/^\/(?:thoitiet|!thoitiet)\s*/i, "").trim() || "Hồ Chí Minh";
    const weatherMsg = await getWeatherReport(cityInput);
    await sendDirectText(api, sender, weatherMsg);
    return;
  }

  // 2.3. Lệnh /nhacnho, /hengio [thời gian] [nội dung]
  if (lower.startsWith("/nhacnho ") || lower.startsWith("!nhacnho ") || lower.startsWith("/hengio ") || lower.startsWith("!hengio ")) {
    const args = rawText.replace(/^\/(?:nhacnho|!nhacnho|hengio|!hengio)\s+/i, "").trim();
    const reply = handleSetReminder(sender, true, sender, displayName, args);
    await sendDirectText(api, sender, reply);
    return;
  }

  // 2.4. Lệnh /dsnhac, /lichnhac (Danh sách lịch hẹn)
  if (lower === "/dsnhac" || lower === "!dsnhac" || lower === "/lichnhac" || lower === "dsnhac") {
    const reply = handleListReminders(sender);
    await sendDirectText(api, sender, reply);
    return;
  }

  // 2.5. Lệnh /huynhac [ID] (Hủy lịch hẹn)
  if (lower.startsWith("/huynhac ") || lower.startsWith("!huynhac ")) {
    const idStr = rawText.replace(/^\/(?:huynhac|!huynhac)\s+/i, "").trim();
    const reply = handleCancelReminder(sender, idStr);
    await sendDirectText(api, sender, reply);
    return;
  }

  // 2.6. Tự động nhận diện câu nhắc lịch tự nhiên (ví dụ: "16h45 nhắc anh đi lấy nước nhé", "Nhắc tôi 20 phút nữa...", "15:30 chiều nay...")
  const isReminderIntent =
    lower.includes("nhắc") ||
    lower.includes("nhac") ||
    lower.includes("hẹn") ||
    lower.includes("hen") ||
    lower.includes("báo thức") ||
    lower.includes("bao thuc") ||
    /(?:phút|phut|tiếng|tieng|\b\d+\s*h\b|\b\d+h\d*\b|giờ|gio|mai|hôm nay)/i.test(rawText);

  if (isReminderIntent) {
    const parsed = parseNaturalTimeVietnam(rawText);
    if (parsed) {
      const reply = handleSetReminder(sender, true, sender, displayName, rawText);
      await sendDirectText(api, sender, reply);
      return;
    }
  }

  // 2.7. Tự động nhận diện câu hỏi thời tiết tự nhiên (ví dụ: "Thời tiết hôm nay thế nào", "Thời tiết Hà Nội có mưa không")
  if (/(?:thời tiết|thoi tiet|dự báo thời tiết|du bao thoi tiet)/i.test(rawText) && !hasFile && !hasImage) {
    const cityMatch = rawText.match(/(?:tại|ở|khu vực|tỉnh|thành phố)\s+([A-ZÀ-Ỹa-zà-ỹ\s]+)/i);
    const candidateCity = cityMatch?.[1]?.trim() || "Hồ Chí Minh";
    const weatherMsg = await getWeatherReport(candidateCity);
    await sendDirectText(api, sender, weatherMsg);
    return;
  }

  // =========================================================================
  // 3. CÁC LỆNH QUẢN TRỊ NHÓM (CHỈ DÀNH CHO ADMIN)
  // =========================================================================

  // 3.1. Lệnh /groups hoặc /dsnhom
  if (lower === "/groups" || lower === "/dsnhom" || lower === "groups" || lower === "!groups") {
    if (!isAdmin) {
      await sendDirectText(api, sender, "⚠️ Lệnh xem danh sách nhóm chỉ dành riêng cho Admin của Bot.");
      return;
    }
    const groups = getAllGroupsList();
    if (groups.length === 0) {
      await sendDirectText(api, sender, "📋 Hiện tại Bot chưa ghi nhận nhóm nào trong cơ sở dữ liệu.");
      return;
    }
    const lines = ["📋 DANH SÁCH CÁC NHÓM BOT ĐANG QUẢN LÝ:\n"];
    groups.forEach((g, idx) => {
      const modeIcon = g.mode === "interactive" ? "🟢 [Tương tác]" : "🟡 [Tàu ngầm]";
      lines.push(`${idx + 1}. ${g.name}\n   🆔 ID: ${g.groupId}\n   👥 Số TV: ${g.totalMembers} | Chế độ: ${modeIcon}\n`);
    });
    lines.push(`👉 Để gửi tin vào nhóm, gõ: /send [tên_nhóm/id] [nội dung]`);
    await sendDirectText(api, sender, lines.join("\n"));
    return;
  }

  // 3.2. Lệnh /send [tên_nhóm] [nội dung]
  if (lower.startsWith("/send ") || lower.startsWith("!send ")) {
    if (!isAdmin) {
      await sendDirectText(api, sender, "⚠️ Bạn không có quyền gửi tin nhắn điều khiển vào các nhóm.");
      return;
    }
    const match = rawText.match(/^\/(?:send|!send)\s+([^\s]+)\s+([\s\S]+)$/i);
    if (!match || !match[1] || !match[2]) {
      await sendDirectText(api, sender, "⚠️ Cú pháp chưa đúng! Vui lòng dùng: /send <tên_nhóm_hoặc_id> <nội_dung_tin_nhắn>");
      return;
    }
    const groupQuery = match[1];
    const messageToSend = match[2].trim();

    const target = findGroup(groupQuery);
    if (!target) {
      await sendDirectText(api, sender, `❌ Không tìm thấy nhóm nào khớp với từ khóa "${groupQuery}". Sếp gõ /groups để xem danh sách nhóm nhé!`);
      return;
    }

    try {
      await sendGroupText(api, target.groupId, messageToSend);
      await sendDirectText(api, sender, `✅ Đã gửi tin nhắn thành công vào nhóm [${target.name}]!\n\n📝 Nội dung đã gửi:\n"${messageToSend}"`);
    } catch (err) {
      await sendDirectText(api, sender, `❌ Lỗi khi gửi tin nhắn vào nhóm [${target.name}]: ${String(err)}`);
    }
    return;
  }

  // 3.3. Lệnh /broadcast [nội dung]
  if (lower.startsWith("/broadcast ") || lower.startsWith("!broadcast ")) {
    if (!isAdmin) {
      await sendDirectText(api, sender, "⚠️ Lệnh phát thông báo toàn hệ thống chỉ dành cho Admin.");
      return;
    }
    const messageToSend = rawText.replace(/^\/(?:broadcast|!broadcast)\s+/i, "").trim();
    if (!messageToSend) {
      await sendDirectText(api, sender, "⚠️ Vui lòng nhập nội dung cần broadcast! Cú pháp: /broadcast <nội_dung>");
      return;
    }
    const groups = getAllGroupsList();
    if (groups.length === 0) {
      await sendDirectText(api, sender, "❌ Không có nhóm nào để phát thông báo.");
      return;
    }

    let successCount = 0;
    for (const g of groups) {
      try {
        await sendGroupText(api, g.groupId, messageToSend);
        successCount++;
      } catch (e) {
        console.warn(`[admin-assistant] Broadcast lỗi ở nhóm ${g.name}: ${String(e)}`);
      }
    }
    await sendDirectText(api, sender, `✅ ĐÃ PHÁT THÔNG BÁO THÀNH CÔNG ĐẾN ${successCount}/${groups.length} NHÓM! 🎉`);
    return;
  }

  // 3.4. Lệnh /mode [tên_nhóm] [interactive/silent]
  if (lower.startsWith("/mode ") || lower.startsWith("!mode ")) {
    if (!isAdmin) {
      await sendDirectText(api, sender, "⚠️ Lệnh thay đổi chế độ nhóm chỉ dành cho Admin.");
      return;
    }
    const parts = rawText.split(/\s+/);
    if (parts.length < 3 || !parts[1] || !parts[2]) {
      await sendDirectText(api, sender, "⚠️ Cú pháp: /mode <tên_nhóm/id> <interactive|silent>");
      return;
    }
    const groupQuery = parts[1];
    const newMode = parts[2].toLowerCase() as "interactive" | "silent";
    if (newMode !== "interactive" && newMode !== "silent") {
      await sendDirectText(api, sender, "⚠️ Chế độ chỉ có thể là 'interactive' (Toàn quyền tương tác) hoặc 'silent' (Tàu ngầm ẩn).");
      return;
    }
    const target = findGroup(groupQuery);
    if (!target) {
      await sendDirectText(api, sender, `❌ Không tìm thấy nhóm khớp với "${groupQuery}". Gõ /groups để kiểm tra.`);
      return;
    }
    setGroupMode(target.groupId, newMode);
    await sendDirectText(api, sender, `✅ Đã chuyển chế độ nhóm [${target.name}] sang: ${newMode === "interactive" ? "🟢 INTERACTIVE (Tương tác)" : "🟡 SILENT (Tàu ngầm)"}`);
    return;
  }

  // 3.5. Nhận diện lệnh tự nhiên gửi bài vào nhóm (Chỉ Admin)
  if (isAdmin) {
    const isSendIntent =
      /gửi\s+(?:bài|tin|thông báo|lời chúc|nội dung)?(?:\s+này)?\s+(?:vào|vô|sang)\s+(?:nhóm|group)\s+([^,?.!]+)/i.test(rawText) ||
      /bắn\s+(?:bài|tin|thông báo)?\s+(?:vào|vô|sang)\s+(?:nhóm|group)\s+([^,?.!]+)/i.test(rawText) ||
      /chuyển\s+(?:bài|tin)?\s+(?:vào|vô|sang)\s+(?:nhóm|group)\s+([^,?.!]+)/i.test(rawText) ||
      /đã\s+gửi\s+(?:vào|vô)\s+(?:nhóm|group)\s+([^,?.!]+)\s+chưa/i.test(rawText);

    if (isSendIntent) {
      const match =
        rawText.match(/(?:vào|vô|sang)\s+(?:nhóm|group)\s+([^,?.!]+)/i) ||
        rawText.match(/(?:nhóm|group)\s+([^,?.!]+)/i);
      const targetQuery = (match && match[1]) ? match[1].trim() : "VIP";

      const target = findGroup(targetQuery);
      if (!target) {
        await sendDirectText(
          api,
          sender,
          `❌ Em không tìm thấy nhóm nào khớp với tên "${targetQuery}". Sếp gõ /groups để xem danh sách nhóm nhé!`,
        );
        return;
      }

      const history = getAdminHistory(sender);
      const lastBotMsg = [...history].reverse().find((h) => h.role === "model");
      if (!lastBotMsg) {
        await sendDirectText(api, sender, `⚠️ Em chưa thấy nội dung bài viết nào vừa soạn. Sếp hãy bảo em soạn trước nhé!`);
        return;
      }

      const postToSend = cleanDraftedPost(lastBotMsg.text);
      try {
        await sendGroupText(api, target.groupId, postToSend);
        await sendDirectText(
          api,
          sender,
          `🚀 ĐÃ GỬI BÀI VÀO NHÓM [${target.name.toUpperCase()}] THÀNH CÔNG RỒI SẾP ƠI! 🎉\n\n📝 Nội dung thực tế đã gửi:\n"${postToSend}"`,
        );
        return;
      } catch (err) {
        await sendDirectText(api, sender, `❌ Lỗi khi gửi vào nhóm [${target.name}]: ${String(err)}`);
        return;
      }
    }
  }

  // =========================================================================
  // 4. TRỢ LÝ AI CÁ NHÂN 1:1 ĐA PHƯƠNG TIỆN & HIỂU NGỮ CẢNH (MULTI-TURN CHAT)
  // =========================================================================
  console.log(`[admin-assistant] 💬 Nhận tin nhắn 1:1 từ ${isAdmin ? "Admin" : "User"} ${displayName}: "${rawText}" (File=${hasFile}, Image=${hasImage})`);

  // Tải file hoặc hình ảnh nếu có
  let mediaPart: GeminiMediaPart | null = null;
  let fileTextContent: string | null = null;
  const targetUrl = event.fileAttachment?.url || event.mediaUrl || event.quote?.mediaUrl;
  const fileName = event.fileAttachment?.name || "";

  if (targetUrl) {
    console.log(`[admin-assistant] 📥 Đang tải tài liệu 1:1 từ: ${targetUrl.slice(0, 80)}...`);
    const fileRes = await downloadFileContent(targetUrl, fileName);
    if (fileRes?.mediaPart) {
      mediaPart = fileRes.mediaPart;
    } else if (fileRes?.textContent) {
      fileTextContent = fileRes.textContent;
    }
  }

  // Lấy lịch sử trò chuyện nhiều lượt
  const history = getAdminHistory(sender);
  const historyText = history
    .map((h) => `${h.role === "user" ? `${displayName}` : "Sen Chúa (Trợ lý)"}: ${h.text}`)
    .join("\n\n");

  const groupsSummary = isAdmin
    ? getAllGroupsList()
        .map((g) => `- ${g.name} (ID: ${g.groupId}, Mode: ${g.mode})`)
        .join("\n")
    : "";

  const systemPrompt = isAdmin
    ? `Bạn là 'Sen Chúa' - Trợ lý AI cá nhân cao cấp, thông minh, tận tâm và hóm hỉnh phục vụ riêng cho Admin/Chủ bot (${displayName}).\n` +
      `NHIỆM VỤ CỦA BẠN TRONG TIN NHẮN 1:1:\n` +
      `1. Nhớ kỹ toàn bộ ngữ cảnh hội thoại trước đó với Admin để tư vấn, hỗ trợ, sửa đổi bài viết, giải đáp liền mạch.\n` +
      `2. Nếu Admin gửi FILE TÀI LIỆU (PDF, Word, Excel, Code, TXT) hoặc HÌNH ẢNH: Đọc kỹ, trích xuất dữ liệu, dịch thuật, phân tích sâu, tìm lỗi code hoặc tóm tắt theo ý Admin.\n` +
      `3. Nếu Admin nhờ soạn thông báo, bài viết cho nhóm: Hãy soạn thảo thật hấp dẫn, chuyên nghiệp, có icon đẹp mắt, định dạng rõ ràng.\n` +
      `4. Danh sách các nhóm Zalo bạn đang quản lý để tham khảo:\n${groupsSummary}\n` +
      `5. ĐẶC BIỆT - KHI ADMIN YÊU CẦU BẠN GỬI HOẶC BẮN TIN NHẮN/THÔNG BÁO VÀO MỘT NHÓM CỤ THỂ:\n` +
      `   Hãy xuất thẻ hành động ở cuối câu trả lời như sau:\n` +
      `   [ACTION:SEND_GROUP target="TÊN_NHÓM_HOẶC_ID"]\n` +
      `   <nội dung thực tế cần gửi vào nhóm>\n` +
      `   [/ACTION]\n` +
      `   Hệ thống máy chủ sẽ tự động bóc tách thẻ này và gửi tin nhắn thật vào nhóm Zalo cho Sếp ngay lập tức!\n` +
      `6. TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown (dùng icon, viết hoa hoặc dấu gạch đầu dòng để làm nổi bật).\n` +
      `7. Thái độ phục vụ: Lễ phép, thông minh, gọi Admin là 'Sếp' hoặc '${displayName}', xưng 'em' hoặc 'Sen Chúa'.`
    : `Bạn là 'Sen Chúa' - Trợ lý AI thông minh, thân thiện, duyên dáng và hóm hỉnh của Zalo đang trò chuyện 1:1 với bạn ${displayName}.\n` +
      `NHIỆM VỤ CỦA BẠN:\n` +
      `1. Trò chuyện tự nhiên, vui vẻ, giải đáp mọi câu hỏi, tư vấn học tập, công việc, tâm sự, dịch thuật, phân tích hình ảnh/tài liệu khi được gửi tới.\n` +
      `2. TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown (dùng icon, viết hoa hoặc dấu gạch đầu dòng để làm nổi bật).\n` +
      `3. Thái độ: Lễ phép, thân thiện, gần gũi, xưng 'em' hoặc 'mình', gọi người dùng là '${displayName}' hoặc 'bạn'.\n` +
      `4. Bạn là trợ lý trò chuyện cá nhân, không có quyền can thiệp vào các nhóm Zalo khác.`;

  let fileSection = "";
  if (fileTextContent) {
    fileSection = `\n=== NỘI DUNG TÀI LIỆU ĐÍNH KÈM (${fileName}): ===\n${fileTextContent.slice(0, 40000)}\n`;
  }

  let quoteSection = "";
  if (event.quote?.text) {
    quoteSection = `\n=== NỘI DUNG TRÍCH DẪN: ===\n"${event.quote.text}"\n`;
  }

  // 2.0. Nhận diện câu hỏi cần tra cứu thông tin thời gian thực (Google News / Sự kiện / Tin tức mới)
  const isRealTimeSearchQuery =
    /(?:tin tức|tin mới|mới nhất|hôm nay|24h qua|trên x\b|trên twitter\b|trend ai|tin ai|ai mới|vừa ra mắt|cập nhật mới|tin nóng|thời sự|bản tin|vừa công bố|ra mắt gì|sự kiện mới|giá vàng|chứng khoán|thị trường|lũ quét|bão số|thiên tai|thế nào rồi)/i.test(
      rawText
    );

  let liveNews = "";
  if (isRealTimeSearchQuery) {
    try {
      liveNews = await searchRealtimeNews(rawText);
    } catch (e) {
      console.warn("[admin-assistant] searchRealtimeNews lỗi:", e);
    }
  }

  const liveNewsSection = liveNews
    ? `\n=== CÁC BẢN TIN THỜI GIAN THỰC MỚI NHẤT VỪA TRA CỨU TỪ GOOGLE NEWS: ===\n${liveNews}\n`
    : "";

  const searchInstruction = isRealTimeSearchQuery
    ? `\n8. TỔNG HỢP TIN TỨC THỜI GIAN THỰC: Câu hỏi này liên quan đến tin tức hoặc sự kiện thực tế. BẮT BUỘC ĐỌC KỸ và TRÍCH XUẤT CHÍNH XÁC các con số thống kê mới nhất (số người chết, mất tích, thiệt hại, ngày tháng, tên nguồn báo chí) từ danh sách các bản tin Google News bên dưới. TUYỆT ĐỐI KHÔNG tự phỏng đoán hoặc đưa các số liệu cũ từ quá khứ nếu đã có số liệu trong danh sách bản tin.\n`
    : "";

  const userPrompt =
    (historyText ? `LỊCH SỬ TRÒ CHUYỆN TRƯỚC ĐÓ:\n${historyText}\n\n` : "") +
    `${quoteSection}${fileSection}${liveNewsSection}\n` +
    `YÊU CẦU MỚI TỪ ${isAdmin ? `ADMIN (${displayName})` : `BẠN (${displayName})`}: ${rawText || "Hãy phân tích tài liệu/hình ảnh này giúp tôi."}\n\n` +
    (isAdmin ? `HÃY TRẢ LỜI SẾP THẬT CHUẨN XÁC, THÔNG MINH VÀ HỮU ÍCH:` : `HÃY TRẢ LỜI THẬT THÂN THIỆN, CHUẨN XÁC VÀ HỮU ÍCH:`);

  try {
    const answer = await callGemini(systemPrompt + searchInstruction, userPrompt, {
      mediaParts: mediaPart ? [mediaPart] : undefined,
      enableSearch: false, // Dùng kết quả Google News RSS đã nhúng trực tiếp, tránh lỗi 429 quota search grounding của Gemini Free
    });

    // Kiểm tra và thực thi thẻ hành động [ACTION:SEND_GROUP target="..."]...[/ACTION] CHỈ DÀNH CHO ADMIN
    let finalAnswer = answer;
    if (isAdmin) {
      const actionMatch = answer.match(/\[ACTION:SEND_GROUP\s+target=["']([^"']+)["']\]([\s\S]*?)\[\/ACTION\]/i);
      if (actionMatch && actionMatch[1] && actionMatch[2]) {
        const targetGroupQuery = actionMatch[1].trim();
        const contentToSend = actionMatch[2].trim();
        finalAnswer = answer.replace(/\[ACTION:SEND_GROUP[\s\S]*?\[\/ACTION\]/gi, "").trim();

        const target = findGroup(targetGroupQuery);
        if (target && contentToSend) {
          try {
            await sendGroupText(api, target.groupId, contentToSend);
            finalAnswer += `\n\n🚀 [HỆ THỐNG]: Em đã tự động gửi nội dung trên vào nhóm [${target.name}] thành công 100%! 🎉`;
          } catch (e) {
            finalAnswer += `\n\n⚠️ [HỆ THỐNG]: Tự động gửi vào nhóm [${target.name}] bị lỗi: ${String(e)}`;
          }
        }
      }
    } else {
      finalAnswer = answer.replace(/\[ACTION:SEND_GROUP[\s\S]*?\[\/ACTION\]/gi, "").trim();
    }

    // Lưu vào lịch sử hội thoại nhiều lượt
    appendAdminHistory(sender, "user", rawText || `[Gửi file: ${fileName || "hình ảnh"}]`);
    appendAdminHistory(sender, "model", finalAnswer);

    await sendDirectText(api, sender, finalAnswer);
    console.log(`[admin-assistant] ✅ Đã phản hồi 1:1 cho ${isAdmin ? "Admin" : "User"} ${displayName}`);
  } catch (err) {
    console.error(`[admin-assistant] ❌ Lỗi xử lý AI 1:1:`, err);
    await sendDirectText(
      api,
      sender,
      isAdmin
        ? `🤖 Dạ câu hỏi của Sếp ${displayName} làm em Sen Chúa xém khét CPU 😄! Sếp cho em vài giây thở oxy rồi hỏi lại thử nhé!`
        : `🤖 Dạ câu hỏi của bạn ${displayName} làm em xém khét CPU 😄! Bạn chờ vài giây rồi nhắn lại giúp em nhé!`,
    );
  }
}

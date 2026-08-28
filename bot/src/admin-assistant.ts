import { getDb, isUserAdmin, addAdminUser, setGroupMode } from "./db/index.js";
import { sendDirectText, sendGroupText } from "./zalo/client.js";
import { callGemini, downloadFileContent, type GeminiMediaPart } from "./gemini.js";
import type { MemberMessageEvent } from "./member-assistant.js";

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
 * Tìm kiếm nhóm Zalo theo ID hoặc theo tên gần đúng.
 */
function findGroup(query: string): { groupId: string; name: string; totalMembers: number; mode: string } | null {
  const db = getDb();
  const q = query.trim().toLowerCase();

  // 1. Thử match chính xác group_id
  const byId = db.prepare("SELECT group_id as groupId, name, total_members as totalMembers, mode FROM bot_groups WHERE group_id = ?").get(query.trim()) as any;
  if (byId) return byId;

  // 2. Thử match theo tên gần đúng
  const allGroups = db.prepare("SELECT group_id as groupId, name, total_members as totalMembers, mode FROM bot_groups").all() as any[];
  if (allGroups.length === 0) return null;

  // Ưu tiên khớp chứa từ khóa
  const matched = allGroups.find((g) => g.name.toLowerCase().includes(q) || q.includes(g.name.toLowerCase()));
  if (matched) return matched;

  // Khớp theo từ khóa viết tắt (ví dụ: "ai", "nhau", "an nhau")
  if (q.includes("ai")) {
    const aiGroup = allGroups.find((g) => g.name.toLowerCase().includes("ai") || g.name.toLowerCase().includes("công nghệ"));
    if (aiGroup) return aiGroup;
  }
  if (q.includes("nhậu") || q.includes("nhau") || q.includes("ăn nhậu")) {
    const nhauGroup = allGroups.find((g) => g.name.toLowerCase().includes("nhậu") || g.name.toLowerCase().includes("nhau"));
    if (nhauGroup) return nhauGroup;
  }

  return null;
}

/**
 * Lấy danh sách tất cả các nhóm đang quản lý.
 */
function getAllGroupsList(): { groupId: string; name: string; totalMembers: number; mode: string }[] {
  try {
    const db = getDb();
    return db.prepare("SELECT group_id as groupId, name, total_members as totalMembers, mode FROM bot_groups ORDER BY updated_at DESC").all() as any[];
  } catch {
    return [];
  }
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

  // Bỏ qua tin nhắn do chính bot vừa gửi ra để tránh lặp
  if (event.isSelf && (rawText.startsWith("🤖") || rawText.startsWith("👑") || rawText.startsWith("📋") || rawText.startsWith("✅"))) {
    return;
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
        `Từ bây giờ Sếp có thể nhắn tin riêng trực tiếp để ra lệnh hoặc hỏi đáp với em bất kỳ lúc nào mà không cần nhập lại mật khẩu.\n\n` +
        `👉 Gõ /help để xem danh sách các lệnh điều khiển từ xa nhé Sếp!`;
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

  // Nếu chưa phải là Admin:
  if (!isAdmin) {
    await sendDirectText(
      api,
      sender,
      `🤖 Dạ chào bạn ${displayName}! Đây là kênh điều khiển riêng của Bot Sen Chúa.\n\n` +
      `🔒 Để xác thực quyền Quản trị viên (Admin) và sử dụng các tính năng điều khiển từ xa, bạn vui lòng gõ:\n` +
      `👉 /admin <mật_khẩu_admin>`,
    );
    return;
  }

  // =========================================================================
  // 2. DANH SÁCH LỆNH QUẢN TRỊ ĐIỀU KHIỂN TỪ XA
  // =========================================================================

  // 2.1. Lệnh /help hoặc /menu
  if (lower === "/help" || lower === "help" || lower === "!help" || lower === "/menu" || lower === "menu") {
    const helpMsg =
      `👑 BẢNG LỆNH QUẢN TRỊ & ĐIỀU KHIỂN BOT (1:1 VỚI ADMIN):\n\n` +
      `📋 QUẢN LÝ NHÓM:\n` +
      `🔹 /groups : Xem danh sách & ID tất cả các nhóm Zalo Bot đang tham gia\n` +
      `🔹 /send [tên_nhóm/id] [nội dung] : Gửi tin nhắn/thông báo vào nhóm chỉ định\n` +
      `🔹 /broadcast [nội dung] : Bắn thông báo cùng lúc đến TẤT CẢ các nhóm\n` +
      `🔹 /mode [tên_nhóm] [interactive/silent] : Đổi chế độ nhóm (Tương tác / Tàu ngầm)\n\n` +
      `📊 TRA CỨU & BÁO CÁO:\n` +
      `🔹 /summary [tên_nhóm] : Kích hoạt tóm tắt thảo luận nhóm và gửi báo cáo về cho bạn\n` +
      `🔹 /top [tên_nhóm] : Xem Top 5 thành viên năng nổ nhất của nhóm\n` +
      `🔹 /taungam [tên_nhóm] : Xem danh sách thành viên nằm vùng/chưa từng chat của nhóm\n\n` +
      `💬 TRỢ LÝ AI RIÊNG TƯ:\n` +
      `🔹 Bạn có thể nhắn tin trò chuyện tự nhiên, gửi ảnh, gửi file PDF/Code nhờ em đọc, phân tích, soạn thảo văn bản hoặc yêu cầu "Gửi bài này vào nhóm AI" bất kỳ lúc nào!`;
    await sendDirectText(api, sender, helpMsg);
    return;
  }

  // 2.2. Lệnh /groups hoặc /dsnhom
  if (lower === "/groups" || lower === "/dsnhom" || lower === "groups" || lower === "!groups") {
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

  // 2.3. Lệnh /send [tên_nhóm] [nội dung]
  if (lower.startsWith("/send ") || lower.startsWith("!send ")) {
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

  // 2.4. Lệnh /broadcast [nội dung]
  if (lower.startsWith("/broadcast ") || lower.startsWith("!broadcast ")) {
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

  // 2.5. Lệnh /mode [tên_nhóm] [interactive/silent]
  if (lower.startsWith("/mode ") || lower.startsWith("!mode ")) {
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

  // 2.6. Nhận diện lệnh tắt: "Gửi bài này vào nhóm [tên nhóm]"
  const isSendLastPost =
    lower.includes("gửi bài này vào nhóm") ||
    lower.includes("gui bai nay vao nhom") ||
    lower.includes("gửi bài vào nhóm") ||
    lower.includes("gui bai vao nhom") ||
    lower.includes("gửi tin này vào nhóm") ||
    lower.includes("bắn vào nhóm");

  if (isSendLastPost) {
    const history = getAdminHistory(sender);
    const lastBotMsg = [...history].reverse().find((h) => h.role === "model");
    if (!lastBotMsg) {
      await sendDirectText(api, sender, "⚠️ Em chưa thấy nội dung bài viết nào vừa soạn. Sếp hãy yêu cầu em soạn bài trước nhé!");
      return;
    }

    // Trích xuất tên nhóm từ câu nói của admin
    const cleanQuery = rawText.replace(/gửi (bài|tin|nội dung)( này)? vào nhóm/gi, "").replace(/bắn vào nhóm/gi, "").trim();
    const target = findGroup(cleanQuery) || findGroup("ai"); // mặc định nhóm AI nếu ko chỉ rõ

    if (!target) {
      await sendDirectText(api, sender, `❌ Không xác định được nhóm để gửi. Sếp có thể dùng: /send <tên_nhóm> <nội dung>`);
      return;
    }

    try {
      await sendGroupText(api, target.groupId, lastBotMsg.text);
      await sendDirectText(api, sender, `✅ Đã gửi bài viết vừa soạn vào nhóm [${target.name}] thành công rực rỡ rồi sếp ơi! 🚀`);
      return;
    } catch (err) {
      await sendDirectText(api, sender, `❌ Gửi vào nhóm [${target.name}] bị lỗi: ${String(err)}`);
      return;
    }
  }

  // =========================================================================
  // 3. TRỢ LÝ AI CÁ NHÂN 1:1 ĐA PHƯƠNG TIỆN & HIỂU NGỮ CẢNH (MULTI-TURN CHAT)
  // =========================================================================
  console.log(`[admin-assistant] 💬 Nhận tin nhắn 1:1 từ Admin ${displayName}: "${rawText}" (File=${hasFile}, Image=${hasImage})`);

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
    .map((h) => `${h.role === "user" ? `Admin (${displayName})` : "Sen Chúa (Trợ lý)"}: ${h.text}`)
    .join("\n\n");

  const groupsSummary = getAllGroupsList()
    .map((g) => `- ${g.name} (ID: ${g.groupId}, ${g.totalMembers} TV, Mode: ${g.mode})`)
    .join("\n");

  const systemPrompt =
    `Bạn là 'Sen Chúa' - Trợ lý AI cá nhân cao cấp, thông minh, tận tâm và hóm hỉnh phục vụ riêng cho Admin/Chủ bot (${displayName}).\n` +
    `NHIỆM VỤ CỦA BẠN TRONG TIN NHẮN 1:1:\n` +
    `1. Nhớ kỹ toàn bộ ngữ cảnh hội thoại trước đó với Admin để tư vấn, hỗ trợ, sửa đổi bài viết, giải đáp liền mạch.\n` +
    `2. Nếu Admin gửi FILE TÀI LIỆU (PDF, Word, Excel, Code, TXT) hoặc HÌNH ẢNH: Đọc kỹ, trích xuất dữ liệu, dịch thuật, phân tích sâu, tìm lỗi code hoặc tóm tắt theo ý Admin.\n` +
    `3. Nếu Admin nhờ soạn thông báo, bài viết cho nhóm: Hãy soạn thảo thật hấp dẫn, chuyên nghiệp, có icon đẹp mắt, định dạng rõ ràng.\n` +
    `4. Danh sách các nhóm Zalo bạn đang quản lý để tham khảo:\n${groupsSummary}\n` +
    `5. TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown (dùng icon, viết hoa hoặc dấu gạch đầu dòng để làm nổi bật).\n` +
    `6. Thái độ phục vụ: Lễ phép, thông minh, gọi Admin là 'Sếp' hoặc '${displayName}', xưng 'em' hoặc 'Sen Chúa'.`;

  let fileSection = "";
  if (fileTextContent) {
    fileSection = `\n=== NỘI DUNG TÀI LIỆU ĐÍNH KÈM (${fileName}): ===\n${fileTextContent.slice(0, 40000)}\n`;
  }

  let quoteSection = "";
  if (event.quote?.text) {
    quoteSection = `\n=== NỘI DUNG TRÍCH DẪN: ===\n"${event.quote.text}"\n`;
  }

  const userPrompt =
    (historyText ? `LỊCH SỬ TRÒ CHUYỆN TRƯỚC ĐÓ VỚI ADMIN:\n${historyText}\n\n` : "") +
    `${quoteSection}${fileSection}\n` +
    `YÊU CẦU MỚI TỪ ADMIN (${displayName}): ${rawText || "Hãy phân tích tài liệu/hình ảnh này giúp tôi."}\n\n` +
    `HÃY TRẢ LỜI SẾP THẬT CHUẨN XÁC, THÔNG MINH VÀ HỮU ÍCH:`;

  try {
    const answer = await callGemini(systemPrompt, userPrompt, {
      mediaParts: mediaPart ? [mediaPart] : undefined,
    });

    // Lưu vào lịch sử hội thoại nhiều lượt
    appendAdminHistory(sender, "user", rawText || `[Gửi file: ${fileName || "hình ảnh"}]`);
    appendAdminHistory(sender, "model", answer);

    await sendDirectText(api, sender, answer);
    console.log(`[admin-assistant] ✅ Đã phản hồi 1:1 cho Admin ${displayName}`);
  } catch (err) {
    console.error(`[admin-assistant] ❌ Lỗi xử lý AI 1:1:`, err);
    await sendDirectText(
      api,
      sender,
      `🤖 Dạ câu hỏi của Sếp ${displayName} làm em Sen Chúa xém khét CPU 😄! Sếp cho em vài giây thở oxy rồi hỏi lại thử nhé!`,
    );
  }
}

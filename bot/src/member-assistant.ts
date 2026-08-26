import { getDb } from "./db/index.js";
import { sendGroupText } from "./zalo/client.js";
import { callGemini } from "./gemini.js";

interface MemberMessageEvent {
  threadId: string;
  sender: string;
  displayName: string;
  text: string;
  isSelf?: boolean;
}

// User cooldown map to prevent spamming: userId -> lastResponseTimestamp
const userCooldowns = new Map<string, number>();
const COOLDOWN_MS = 500; // 0.5s cooldown to allow smooth conversation

function fmtAgoVi(ts: number | null): string {
  if (!ts) return "Chưa có";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ngày trước`;
}

/**
 * Tra cứu thứ hạng & điểm tương tác của một thành viên trong nhóm cụ thể.
 */
function handleRankCommand(sender: string, displayName: string, threadId: string): string {
  const db = getDb();

  // Lấy danh sách thành viên active và xếp hạng theo đúng thread_id nhóm
  const members = db
    .prepare(
      `SELECT m.zalo_user_id, m.display_name,
              COALESCE(SUM(CASE i.type
                WHEN 'message' THEN 10
                WHEN 'image' THEN 10
                WHEN 'video' THEN 10
                WHEN 'vote' THEN 3
                WHEN 'reaction' THEN 1
                ELSE 1 END), 0) AS total_points,
              COALESCE(SUM(CASE WHEN i.type = 'message' THEN 1 ELSE 0 END), 0) AS message_count,
              COALESCE(SUM(CASE WHEN i.type = 'reaction' THEN 1 ELSE 0 END), 0) AS reaction_count,
              COALESCE(SUM(CASE WHEN i.type = 'vote' THEN 1 ELSE 0 END), 0) AS vote_count,
              MAX(i.ts) AS last_interaction
       FROM members m
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id AND (i.thread_id = @threadId OR i.thread_id = '')
       WHERE m.is_active = 1
         AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
         AND LOWER(m.display_name) NOT LIKE '%sen chua%'
       GROUP BY m.zalo_user_id
       ORDER BY total_points DESC, last_interaction DESC`,
    )
    .all({ threadId }) as {
      zalo_user_id: string;
      display_name: string;
      total_points: number;
      message_count: number;
      reaction_count: number;
      vote_count: number;
      last_interaction: number | null;
    }[];

  const totalMembers = members.length;
  const index = members.findIndex((m) => m.zalo_user_id === sender);

  if (index === -1) {
    if (displayName.toLowerCase().includes("sen chúa") || displayName.toLowerCase().includes("sen chua")) {
      return `🤖 Sen Chúa là trợ lý phục vụ anh em trong nhóm, không tham gia đua top tranh cúp nhé!`;
    }
    return `📊 THÔNG TIN TƯƠNG TÁC\n\n👤 Thành viên: ${displayName || sender}\nℹ️ Bạn chưa có dữ liệu tương tác trong hệ thống. Hãy gửi tin nhắn hoặc thả reaction để tích điểm nhé!`;
  }

  const userStats = members[index];
  if (!userStats) return "Không tìm thấy thông tin thành viên.";
  const rank = index + 1;
  const rankBadge = rank === 1 ? "🥇 Quán quân" : rank === 2 ? "🥈 Á quân" : rank === 3 ? "🥉 Quý quân" : `#${rank}`;

  return (
    `📊 THÔNG TIN TƯƠNG TÁC\n\n` +
    `👤 Thành viên: ${displayName || userStats.display_name || "Bạn"}\n` +
    `🏆 Thứ hạng: ${rankBadge} (Top ${rank}/${totalMembers})\n` +
    `⭐ Tổng điểm: ${userStats.total_points} điểm\n` +
    `💬 Tin nhắn gửi: ${userStats.message_count} tin\n` +
    `❤️ Lượt thả reaction: ${userStats.reaction_count}\n` +
    `🗳️ Lượt bình chọn: ${userStats.vote_count}\n` +
    `🕒 Lần tương tác cuối: ${fmtAgoVi(userStats.last_interaction)}`
  );
}

/**
 * Xem Top 5 thành viên năng nổ nhất trong nhóm cụ thể.
 */
function handleTopCommand(threadId: string): string {
  const db = getDb();
  const topRows = db
    .prepare(
      `SELECT m.display_name,
              COALESCE(SUM(CASE i.type
                WHEN 'message' THEN 10
                WHEN 'image' THEN 10
                WHEN 'video' THEN 10
                WHEN 'vote' THEN 3
                WHEN 'reaction' THEN 1
                ELSE 1 END), 0) AS total_points,
              COALESCE(SUM(CASE WHEN i.type = 'message' THEN 1 ELSE 0 END), 0) AS message_count
       FROM members m
       JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
       WHERE (i.thread_id = @threadId OR i.thread_id = '')
         AND m.is_active = 1
         AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
         AND LOWER(m.display_name) NOT LIKE '%sen chua%'
       GROUP BY m.zalo_user_id, m.display_name
       ORDER BY total_points DESC
       LIMIT 5`,
    )
    .all({ threadId }) as { display_name: string; total_points: number; message_count: number }[];

  if (topRows.length === 0) {
    return "🏆 BẢNG XẾP HẠNG TOP 5\n\nChưa có dữ liệu tương tác trong nhóm.";
  }

  const medals = ["🥇", "🥈", "🥉", "⭐", "⭐"];
  const lines = topRows.map((r, i) => {
    const medal = medals[i] || "⭐";
    const name = r.display_name || "Thành viên ẩn danh";
    return `${medal} Top ${i + 1}: ${name} — ${r.total_points} điểm (${r.message_count} tin)`;
  });

  return (
    `🏆 TOP 5 THÀNH VIÊN SÔI NỔI NHẤT\n\n` +
    lines.join("\n") +
    `\n\n💡 Gõ /rank để xem thứ hạng của chính bạn!`
  );
}

/**
 * Tổng hợp toàn bộ link & tài liệu được chia sẻ trong nhóm.
 */
function handleLinksCommand(threadId: string, keywordFilter?: string): string {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT display_name, text, ts
       FROM group_messages
       WHERE (thread_id = ? OR thread_id = '')
         AND deleted_at IS NULL
         AND (text LIKE '%http://%' OR text LIKE '%https://%')
       ORDER BY ts DESC
       LIMIT 60`,
    )
    .all(threadId) as { display_name: string; text: string; ts: number }[];

  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const links: { url: string; sender: string; context: string; ts: number }[] = [];

  for (const r of rows) {
    const matches = r.text.match(urlRegex);
    if (matches) {
      for (const u of matches) {
        const cleanUrl = u.replace(/[.,;!?)]+$/, "");
        if (!links.some((l) => l.url === cleanUrl)) {
          const cleanContext = r.text.replace(urlRegex, "").replace(/\s+/g, " ").trim();
          links.push({
            url: cleanUrl,
            sender: r.display_name || "Thành viên",
            context: cleanContext.slice(0, 120) || "Chia sẻ đường link",
            ts: r.ts,
          });
        }
      }
    }
  }

  let filtered = links;
  if (keywordFilter) {
    const k = keywordFilter.toLowerCase();
    filtered = links.filter(
      (l) =>
        l.url.toLowerCase().includes(k) ||
        l.context.toLowerCase().includes(k) ||
        l.sender.toLowerCase().includes(k),
    );
  }

  if (filtered.length === 0) {
    if (keywordFilter) {
      return `🔗 TỔNG HỢP LINK CHIA SẺ\n\nKhông tìm thấy link nào khớp với từ khóa "${keywordFilter}" trong lịch sử chat gần đây của nhóm.`;
    }
    return `🔗 TỔNG HỢP LINK CHIA SẺ\n\nChưa có link hoặc tài liệu nào được chia sẻ trong lịch sử chat gần đây của nhóm.`;
  }

  const items = filtered.slice(0, 15).map((l, idx) => {
    const d = new Date(l.ts + 7 * 3600 * 1000);
    const timeStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    return `${idx + 1}. ${l.url}\n   👤 ${l.sender} (${timeStr})\n   📝 ${l.context}`;
  });

  return (
    `🔗 TỔNG HỢP LINK & TÀI LIỆU TRONG NHÓM (${filtered.length} link gần nhất)\n\n` +
    items.join("\n\n") +
    `\n\n💡 Mẹo: Gõ /link [từ khóa] để lọc link theo chủ đề!`
  );
}

/**
 * Thống kê thành viên nằm vùng / chưa từng gửi tin nhắn trong nhóm.
 */
function handleInactiveCommand(threadId: string): string {
  const db = getDb();
  const inactiveMembers = db
    .prepare(
      `SELECT m.display_name,
              COUNT(CASE WHEN i.type = 'message' THEN 1 END) AS msg_count
       FROM members m
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id AND (i.thread_id = @threadId OR i.thread_id = '')
       WHERE (m.group_id = @threadId OR m.group_id = '' OR m.group_id IS NULL)
         AND m.is_active = 1
         AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
         AND LOWER(m.display_name) NOT LIKE '%sen chua%'
       GROUP BY m.zalo_user_id, m.display_name
       HAVING msg_count = 0
       ORDER BY m.display_name ASC`,
    )
    .all({ threadId }) as { display_name: string; msg_count: number }[];

  const totalMembersInGroup = db
    .prepare(
      `SELECT COUNT(*) AS total FROM members WHERE (group_id = ? OR group_id = '' OR group_id IS NULL) AND is_active = 1 AND LOWER(display_name) NOT LIKE '%sen chúa%'`,
    )
    .get(threadId) as { total: number } | undefined;

  const total = totalMembersInGroup?.total ?? 0;
  const count = inactiveMembers.length;

  if (count === 0) {
    return `🚢 THỐNG KÊ THÀNH VIÊN TÀU NGẦM\n\nTuyệt vời! Toàn bộ ${total} thành viên trong nhóm đều đã từng gửi tin nhắn tương tác!`;
  }

  const sampleNames = inactiveMembers.slice(0, 15).map((m, idx) => `${idx + 1}. ${m.display_name}`);
  const more = count > 15 ? `\n... và ${count - 15} thành viên khác.` : "";

  return (
    `🚢 THỐNG KÊ THÀNH VIÊN TÀU NGẦM (CHƯA TỪNG CHAT)\n\n` +
    `📊 Hiện có ${count}/${total} thành viên chưa từng gửi tin nhắn nào trong nhóm.\n\n` +
    `📋 Danh sách một số thành viên nằm vùng tiêu biểu:\n` +
    sampleNames.join("\n") +
    more +
    `\n\n💡 Mẹo: Nhắc nhẹ anh em nổi lên giao lưu kẻo bị lọc nhé 😄!`
  );
}

/**
 * Trả lời trợ giúp / danh sách lệnh.
 */
function handleHelpCommand(): string {
  return (
    `🤖 TRỢ LÝ CỘNG ĐỒNG — SEN CHÚA\n\n` +
    `Các lệnh bạn có thể sử dụng:\n` +
    `🔹 /rank hoặc /diem: Tra cứu thứ hạng & điểm tương tác của bạn\n` +
    `🔹 /top: Xem Top 5 thành viên tích cực nhất nhóm\n` +
    `🔹 /taungam: Xem thống kê các thành viên nằm vùng / chưa từng gửi tin nhắn\n` +
    `🔹 /link [từ khóa]: Tổng hợp tất cả link/tài liệu/video đã chia sẻ trong nhóm\n` +
    `🔹 /hoi [câu hỏi] hoặc tag @Sen Chúa: Hỏi đáp kiến thức tra cứu từ lịch sử chat của nhóm\n` +
    `🔹 /help: Hiển thị hướng dẫn này`
  );
}

/**
 * RAG Hỏi - Đáp: Tra cứu lịch sử chat riêng của từng nhóm và trả lời bằng Gemini AI.
 */
async function handleHistoryQA(question: string, displayName: string, threadId: string): Promise<string> {
  const db = getDb();

  // Tách từ khóa tìm kiếm (lọc bỏ các từ vô nghĩa)
  const keywords = question
    .toLowerCase()
    .replace(/[?,.!/\\:;]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !["làm", "sao", "cho", "hỏi", "mình", "anh", "em", "bot", "sen", "chúa", "gì", "thế", "nào", "được", "không"].includes(w));

  // Truy vấn tin nhắn lịch sử liên quan (cô lập theo từng nhóm thread_id)
  let relevantMessages: { display_name: string; text: string; ts: number }[] = [];

  if (keywords.length > 0) {
    // Tìm các tin nhắn có chứa từ khóa
    const conditions = keywords.map(() => `LOWER(text) LIKE ?`).join(" OR ");
    const params = [threadId, ...keywords.map((k) => `%${k}%`)];
    relevantMessages = db
      .prepare(
        `SELECT display_name, text, ts
         FROM group_messages
         WHERE (thread_id = ? OR thread_id = '') AND deleted_at IS NULL AND is_self = 0 AND text != '' AND (${conditions})
         ORDER BY ts DESC
         LIMIT 60`,
      )
      .all(...params) as { display_name: string; text: string; ts: number }[];
  }

  // Nếu ít tin nhắn khớp từ khóa, lấy thêm các tin nhắn thảo luận gần đây nhất của nhóm
  if (relevantMessages.length < 20) {
    const recent = db
      .prepare(
        `SELECT display_name, text, ts
         FROM group_messages
         WHERE (thread_id = ? OR thread_id = '') AND deleted_at IS NULL AND is_self = 0 AND text != ''
         ORDER BY ts DESC
         LIMIT 60`,
      )
      .all(threadId) as { display_name: string; text: string; ts: number }[];

    const seen = new Set(relevantMessages.map((m) => m.text));
    for (const r of recent) {
      if (!seen.has(r.text)) {
        relevantMessages.push(r);
        seen.add(r.text);
      }
    }
  }

  // Lấy thêm các bản tóm tắt đã lưu trong daily_summaries của nhóm
  const pastSummaries = db
    .prepare(`SELECT day_label, summary_text FROM daily_summaries WHERE thread_id = ? OR thread_id = '' ORDER BY day_date DESC LIMIT 7`)
    .all(threadId) as { day_label: string; summary_text: string }[];

  // Lấy Top thành viên tích cực nhất từ bảng xếp hạng của nhóm
  const topMembers = db
    .prepare(
      `SELECT m.display_name,
              COUNT(CASE WHEN i.type = 'message' THEN 1 END) AS msg_count,
              COALESCE(SUM(CASE i.type WHEN 'message' THEN 10 WHEN 'vote' THEN 3 WHEN 'reaction' THEN 1 ELSE 1 END), 0) AS points
       FROM members m
       JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
       WHERE (i.thread_id = @threadId OR i.thread_id = '')
         AND m.is_active = 1
         AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
         AND LOWER(m.display_name) NOT LIKE '%sen chua%'
       GROUP BY m.zalo_user_id, m.display_name
       ORDER BY points DESC
       LIMIT 10`,
    )
    .all({ threadId }) as { display_name: string; msg_count: number; points: number }[];

  // Lấy thống kê thành viên tàu ngầm / chưa từng chat trong nhóm
  const inactiveMembers = db
    .prepare(
      `SELECT m.display_name,
              COUNT(CASE WHEN i.type = 'message' THEN 1 END) AS msg_count
       FROM members m
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id AND (i.thread_id = @threadId OR i.thread_id = '')
       WHERE (m.group_id = @threadId OR m.group_id = '' OR m.group_id IS NULL)
         AND m.is_active = 1
         AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
         AND LOWER(m.display_name) NOT LIKE '%sen chua%'
       GROUP BY m.zalo_user_id, m.display_name
       HAVING msg_count = 0`,
    )
    .all({ threadId }) as { display_name: string; msg_count: number }[];

  const totalMembersInGroup = db
    .prepare(
      `SELECT COUNT(*) AS total FROM members WHERE (group_id = ? OR group_id = '' OR group_id IS NULL) AND is_active = 1 AND LOWER(display_name) NOT LIKE '%sen chúa%'`,
    )
    .get(threadId) as { total: number } | undefined;

  // Dựng ngữ cảnh dữ liệu lịch sử
  const contextLines: string[] = [];

  if (topMembers.length > 0) {
    contextLines.push("=== BẢNG XẾP HẠNG & THÀNH VIÊN TÍCH CỰC NHẤT NHÓM ===");
    topMembers.forEach((m, idx) => {
      contextLines.push(`Top ${idx + 1}: ${m.display_name} - ${m.msg_count} tin nhắn, tổng ${m.points} điểm.`);
    });
  }

  if (inactiveMembers.length > 0) {
    const totalCount = totalMembersInGroup?.total ?? 0;
    contextLines.push("=== THỐNG KÊ THÀNH VIÊN CHƯA TỪNG NHẮN TIN / NẰM VÙNG / TÀU NGẦM ===");
    contextLines.push(
      `Tổng số thành viên trong nhóm: ${totalCount} người.\n` +
      `Số thành viên chưa từng gửi bất kỳ tin nhắn nào trong nhóm: ${inactiveMembers.length}/${totalCount} người.\n` +
      `Danh sách một số thành viên nằm vùng chưa từng chat: ${inactiveMembers.slice(0, 15).map((m) => m.display_name).join(", ")}...`
    );
  }

  if (pastSummaries.length > 0) {
    contextLines.push("=== TÓM TẮT CÁC NGÀY TRƯỚC ===");
    for (const s of pastSummaries) {
      contextLines.push(`[Ngày ${s.day_label}]:\n${s.summary_text}`);
    }
  }

  contextLines.push("=== TIN NHẮN THẢO LUẬN CỦA CÁC THÀNH VIÊN ===");
  for (const m of relevantMessages.slice(0, 80)) {
    const dateStr = new Date(m.ts + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
    contextLines.push(`${dateStr} | ${m.display_name || "Thành viên"}: ${m.text}`);
  }

  const contextData = contextLines.join("\n\n");

  const systemPrompt =
    "Bạn là 'Sen Chúa' - trợ lý AI cực kỳ hóm hỉnh, thông minh, vui tính và mặn mà của nhóm Zalo 'GROUP TRAO ĐỔI - AI, CÔNG NGHỆ'.\n" +
    "NHIỆM VỤ:\n" +
    "1. Với các câu hỏi đùa, troll, hỏi vui hoặc câu hỏi bất khả thi (như: 'cách tăng 1 triệu view trong 1 đêm', 'cách kiếm 10 tỷ', 'bạn có người yêu chưa', 'hỏi dễ quá trục trặc luôn', 'ăn cơm chưa'): Hãy đối đáp CỰC KỲ HÀI HƯỚC, duyên dáng, bắt trend theo phong cách Sen Chúa hóm hỉnh (ví dụ: khuyên tối nay đi ngủ sớm rồi mơ, hoặc bảo em là bot chỉ biết ăn điện hóng chuyện thôi 😄).\n" +
    "2. Với câu hỏi về bảng xếp hạng, thành viên tích cực: Trả lời dựa trên BẢNG XẾP HẠNG & THÀNH VIÊN TÍCH CỰC được cung cấp.\n" +
    "3. Với câu hỏi chuyên môn AI/công nghệ/mẹo MMO: Trả lời súc tích dựa trên lịch sử chat. Nếu lịch sử chưa có, hãy trả lời vui vẻ và gợi ý anh em cao thủ trong nhóm cùng thảo luận.\n" +
    "4. TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown.";

  const userPrompt =
    `DƯỚI ĐÂY LÀ DỮ LIỆU LỊCH SỬ CHAT CỦA NHÓM:\n` +
    `<chat_history>\n${contextData}\n</chat_history>\n\n` +
    `CÂU HỎI TỪ THÀNH VIÊN (${displayName}): ${question}\n\n` +
    `HÃY TRẢ LỜI CÂU HỎI TRÊN THẬT DUYÊN DÁNG VÀ HÓM HỈNH:`;

  try {
    const answer = await callGemini(systemPrompt, userPrompt);
    return answer;
  } catch (e) {
    console.warn("[member-assistant] Gemini QA error:", e);
    return `Dạ câu hỏi của bác ${displayName} "hack não" quá làm em Sen Chúa bị đứng hình một nhịp 😄! Bác chờ em nạp thêm bình ắc quy hoặc anh em cao thủ trong nhóm ai có bí kíp gì vào chỉ giáo cho bác ${displayName} với nhé!`;
  }
}

/**
 * Xử lý tin nhắn đến từ thành viên: kiểm tra lệnh hoặc câu hỏi.
 */
export async function handleMemberInteraction(api: any, event: MemberMessageEvent): Promise<void> {
  const rawText = (event.text || "").trim();
  if (!rawText) return;

  // Nếu là tin nhắn của chính tài khoản bot (chủ bot test từ app Zalo):
  if (event.isSelf) {
    // Bỏ qua tin nhắn do bot trả lời tự động để tránh lặp vô tận
    if (
      rawText.startsWith("🤖") ||
      rawText.startsWith("📊") ||
      rawText.startsWith("🏆") ||
      rawText.startsWith("📋")
    ) {
      return;
    }

    const lowerSelf = rawText.toLowerCase();
    const isCommand =
      rawText.startsWith("/") ||
      rawText.startsWith("!") ||
      rawText.startsWith("@") ||
      lowerSelf.includes("sen chúa") ||
      lowerSelf.includes("sen chua") ||
      lowerSelf.startsWith("sen") ||
      lowerSelf.startsWith("bot");
    if (!isCommand) return;
  }

  const sender = event.sender;
  const displayName = event.displayName || "Bạn";
  const threadId = event.threadId;

  // Kiểm tra cooldown (bỏ qua cooldown đối với chính tài khoản chủ bot để tiện test lệnh)
  const now = Date.now();
  const lastTime = userCooldowns.get(sender) || 0;
  if (!event.isSelf && now - lastTime < COOLDOWN_MS) {
    return; // Đang trong thời gian chờ, bỏ qua để chống spam
  }

  const lower = rawText.toLowerCase();

  // 1. Lệnh /help, /menu, /trogiup
  if (lower === "/help" || lower === "/menu" || lower === "/trogiup" || lower === "/lenh" || lower === "!help") {
    userCooldowns.set(sender, now);
    const reply = handleHelpCommand();
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /help cho ${displayName}`);
    return;
  }

  // 2. Lệnh /rank, /diem, /myrank
  if (lower === "/rank" || lower === "/diem" || lower === "/myrank" || lower === "!rank" || lower === "!diem") {
    userCooldowns.set(sender, now);
    const reply = handleRankCommand(sender, displayName, threadId);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /rank cho ${displayName}`);
    return;
  }

  // 3. Lệnh /top, /top5, /leaderboard
  if (lower === "/top" || lower === "/top5" || lower === "/bxh" || lower === "/leaderboard" || lower === "!top") {
    userCooldowns.set(sender, now);
    const reply = handleTopCommand(threadId);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /top cho ${displayName}`);
    return;
  }

  // 4. Lệnh /link, /links, /tonghoplink, /tailieu
  if (
    lower === "/link" ||
    lower === "/links" ||
    lower.startsWith("/link ") ||
    lower.startsWith("/links ") ||
    lower === "/tonghoplink" ||
    lower === "/tailieu" ||
    lower.startsWith("/tonghoplink ") ||
    lower.startsWith("/tailieu ")
  ) {
    userCooldowns.set(sender, now);
    const filter = rawText
      .replace(/^\/links?\s*/i, "")
      .replace(/^\/(tonghoplink|tailieu)\s*/i, "")
      .trim();
    const reply = handleLinksCommand(threadId, filter || undefined);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /link cho ${displayName}`);
    return;
  }

  // 5. Lệnh /taungam, /namvung, /inactive, /chuachat
  if (
    lower === "/taungam" ||
    lower === "/namvung" ||
    lower === "/inactive" ||
    lower === "/chuachat" ||
    lower === "/chuatungchat" ||
    lower === "!taungam"
  ) {
    userCooldowns.set(sender, now);
    const reply = handleInactiveCommand(threadId);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /taungam cho ${displayName}`);
    return;
  }

  // 4. Lệnh /hoi [câu hỏi] hoặc Tag bot / Nhắc tên Sen Chúa
  const isTagBot =
    lower.startsWith("/hoi") ||
    lower.startsWith("!hoi") ||
    lower.includes("@sen chúa") ||
    lower.includes("@sen chua") ||
    lower.includes("sen chúa") ||
    lower.includes("sen chua") ||
    lower.includes("@senchua") ||
    lower.includes("@bot") ||
    lower.startsWith("bot ơi") ||
    lower.startsWith("bot oi") ||
    lower.startsWith("sen ơi") ||
    lower.startsWith("sen oi") ||
    (event.isSelf && lower.startsWith("@"));

  if (isTagBot) {
    userCooldowns.set(sender, now);

    // Làm sạch câu hỏi
    let question = rawText
      .replace(/^\/hoi\s*/i, "")
      .replace(/^!hoi\s*/i, "")
      .replace(/@sen chúa/gi, "")
      .replace(/@sen chua/gi, "")
      .replace(/@senchua/gi, "")
      .replace(/sen chúa ơi,?\s*/gi, "")
      .replace(/sen chua oi,?\s*/gi, "")
      .replace(/sen chúa,?\s*/gi, "")
      .replace(/sen chua,?\s*/gi, "")
      .replace(/sen ơi,?\s*/gi, "")
      .replace(/sen oi,?\s*/gi, "")
      .replace(/@bot/gi, "")
      .replace(/^bot ơi\s*,?/i, "")
      .replace(/^bot oi\s*,?/i, "")
      .replace(/^@[^\s]+\s*/, "") // Loại bỏ tag mention đầu dòng nếu còn sót
      .trim();

    const qLower = question.toLowerCase();
    const isGreeting =
      !question ||
      qLower.length < 3 ||
      qLower.startsWith("chào") ||
      qLower.startsWith("chao") ||
      qLower.startsWith("hello") ||
      qLower.startsWith("hi ") ||
      qLower.startsWith("alo") ||
      ["alo", "hi", "hello", "chào", "chao", "ơi", "oi", "hey", "test", "alo bot", "bot ơi", "sen ơi", "chào bot", "chào em", "chào bạn"].includes(qLower);

    if (isGreeting) {
      await sendGroupText(
        api,
        threadId,
        `🤖 Dạ Sen Chúa chào ${displayName || "bác"} ạ! Em sẵn sàng hỗ trợ tra cứu thông tin thảo luận trong nhóm, điểm tương tác và giải đáp thắc mắc. Bạn cần hỏi gì cứ gõ: /hoi [câu hỏi] hoặc tag @Sen Chúa [câu hỏi] nhé!`,
      );
      console.log(`[member-assistant] ✅ Đã gửi lời chào cho ${displayName}`);
      return;
    }

    // Các câu đối đáp hài hước, trêu chọc tức thì
    if (["ngáo", "ngao", "ngu", "dở", "do", "ngốc", "ngoc", "lag", "chán", "chan"].some((w) => qLower === w || qLower.startsWith(w + " ") || qLower.endsWith(" " + w))) {
      await sendGroupText(
        api,
        threadId,
        `🤖 Dạ em Sen Chúa chỉ ăn điện với chạy bằng dữ liệu thôi nên thỉnh thoảng hơi lag xíu xiêu 😄! Bác ${displayName} thương tình thông cảm cho em nhé, em đang cố gắng thông minh hơn mỗi ngày đây ạ!`,
      );
      return;
    }

    if (qLower.includes("mute") || qLower.includes("ban") || qLower.includes("kick")) {
      await sendGroupText(
        api,
        threadId,
        `🤖 Dạ em Sen Chúa hiền lành dễ thương chỉ biết tra cứu thông tin với tính điểm thôi ạ 😄! Quyền năng "sinh sát" mute hay kick là của các bác Admin, em phận làm bot không dám manh động đâu nè!`,
      );
      return;
    }

    if (qLower.includes("1 triệu view") || qLower.includes("triệu view") || qLower.includes("1tr view") || qLower.includes("tăng view")) {
      await sendGroupText(
        api,
        threadId,
        `🤖 Sen Chúa trả lời @${displayName}:\n\nDạ bí kíp đạt 1 triệu view trong 1 đêm nhanh nhất là: Tối nay bác cứ đăng video lên rồi đi ngủ sớm... mơ một giấc thật đẹp là sáng mai có ngay 1 triệu view ạ 😄!\n\nHoặc bác có thể hỏi các cao thủ trong nhóm như bác Vũ Trọng, Tu, Huy để xin tút chạy ads và làm content viral chuẩn chỉnh nhé!`,
      );
      return;
    }

    // Tự động nhận diện câu hỏi xin link, tổng hợp link, tài liệu
    if (
      qLower.includes("tổng hợp link") ||
      qLower.includes("tong hop link") ||
      qLower.includes("danh sách link") ||
      qLower.includes("danh sach link") ||
      qLower.includes("các link") ||
      qLower.includes("cac link") ||
      qLower.includes("tìm link") ||
      qLower.includes("tim link") ||
      qLower.includes("link chia sẻ") ||
      qLower.includes("link chia se") ||
      qLower.includes("link bài viết") ||
      qLower.includes("link tài liệu") ||
      qLower.includes("link fb") ||
      qLower.includes("link tiktok") ||
      qLower.includes("link youtube")
    ) {
      let filterWord = "";
      if (qLower.includes("ai")) filterWord = "ai";
      else if (qLower.includes("tiktok") || qLower.includes("tik tok")) filterWord = "tiktok";
      else if (qLower.includes("facebook") || qLower.includes("fb")) filterWord = "facebook";
      else if (qLower.includes("canva")) filterWord = "canva";
      else if (qLower.includes("drive")) filterWord = "drive";

      const reply =
        `🤖 Sen Chúa tổng hợp link cho @${displayName}:\n\n` +
        handleLinksCommand(threadId, filterWord || undefined);
      await sendGroupText(api, threadId, reply);
      console.log(`[member-assistant] ✅ Đã gửi tổng hợp link tự động cho ${displayName}`);
      return;
    }

    // Tự động nhận diện câu hỏi về thành viên chưa từng chat, nằm vùng, tàu ngầm
    if (
      qLower.includes("chưa từng chat") ||
      qLower.includes("chua tung chat") ||
      qLower.includes("chưa chat") ||
      qLower.includes("chua chat") ||
      qLower.includes("chưa từng nhắn") ||
      qLower.includes("chua tung nhan") ||
      qLower.includes("chưa nhắn tin") ||
      qLower.includes("chua nhan tin") ||
      qLower.includes("nằm vùng") ||
      qLower.includes("nam vung") ||
      qLower.includes("tàu ngầm") ||
      qLower.includes("tau ngam") ||
      qLower.includes("ai chưa tương tác") ||
      qLower.includes("ai chua tuong tac") ||
      qLower.includes("ít tương tác nhất") ||
      qLower.includes("lười chat")
    ) {
      const reply =
        `🤖 Sen Chúa trả lời @${displayName}:\n\n` +
        handleInactiveCommand(threadId);
      await sendGroupText(api, threadId, reply);
      console.log(`[member-assistant] ✅ Đã gửi thống kê tàu ngầm tự động cho ${displayName}`);
      return;
    }

    console.log(`[member-assistant] 🔍 Đang xử lý câu hỏi từ ${displayName} (${sender}): "${question}"...`);

    try {
      // Tra cứu RAG từ lịch sử chat
      const answer = await handleHistoryQA(question, displayName, threadId);
      const reply = `🤖 Sen Chúa trả lời @${displayName}:\n\n${answer}`;
      await sendGroupText(api, threadId, reply);
      console.log(`[member-assistant] ✅ Đã gửi câu trả lời thành công vào nhóm`);
    } catch (err) {
      console.error(`[member-assistant] ❌ Lỗi xử lý câu hỏi:`, err);
      await sendGroupText(
        api,
        threadId,
        `🤖 Dạ câu hỏi của @${displayName} hóc búa quá làm em Sen Chúa xém khét CPU 😄! Bác cho em xin vài giây thở oxy rồi hỏi lại thử xem nè!`,
      );
    }
    return;
  }
}

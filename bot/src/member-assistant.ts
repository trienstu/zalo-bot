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
 * Tra cứu thứ hạng & điểm tương tác của một thành viên.
 */
function handleRankCommand(sender: string, displayName: string): string {
  const db = getDb();

  // Lấy danh sách thành viên active và xếp hạng
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
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
       WHERE m.is_active = 1
         AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
         AND LOWER(m.display_name) NOT LIKE '%sen chua%'
       GROUP BY m.zalo_user_id
       ORDER BY total_points DESC, last_interaction DESC`,
    )
    .all() as {
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
 * Xem Top 5 thành viên năng nổ nhất.
 */
function handleTopCommand(): string {
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
       WHERE m.is_active = 1
         AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
         AND LOWER(m.display_name) NOT LIKE '%sen chua%'
       GROUP BY m.zalo_user_id, m.display_name
       ORDER BY total_points DESC
       LIMIT 5`,
    )
    .all() as { display_name: string; total_points: number; message_count: number }[];

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
 * Trả lời trợ giúp / danh sách lệnh.
 */
function handleHelpCommand(): string {
  return (
    `🤖 TRỢ LÝ CỘNG ĐỒNG — SEN CHÚA\n\n` +
    `Các lệnh bạn có thể sử dụng:\n` +
    `🔹 /rank hoặc /diem: Tra cứu thứ hạng & điểm tương tác của bạn\n` +
    `🔹 /top: Xem Top 5 thành viên tích cực nhất nhóm\n` +
    `🔹 /hoi [câu hỏi] hoặc tag @Sen Chúa: Hỏi đáp kiến thức tra cứu từ lịch sử chat của nhóm\n` +
    `🔹 /help: Hiển thị hướng dẫn này`
  );
}

/**
 * RAG Hỏi - Đáp: Tra cứu lịch sử chat và trả lời bằng Gemini AI.
 */
async function handleHistoryQA(question: string, displayName: string): Promise<string> {
  const db = getDb();

  // Tách từ khóa tìm kiếm (lọc bỏ các từ vô nghĩa)
  const keywords = question
    .toLowerCase()
    .replace(/[?,.!/\\:;]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !["làm", "sao", "cho", "hỏi", "mình", "anh", "em", "bot", "sen", "chúa", "gì", "thế", "nào", "được", "không"].includes(w));

  // Truy vấn tin nhắn lịch sử liên quan
  let relevantMessages: { display_name: string; text: string; ts: number }[] = [];

  if (keywords.length > 0) {
    // Tìm các tin nhắn có chứa từ khóa
    const conditions = keywords.map(() => `LOWER(text) LIKE ?`).join(" OR ");
    const params = keywords.map((k) => `%${k}%`);
    relevantMessages = db
      .prepare(
        `SELECT display_name, text, ts
         FROM group_messages
         WHERE deleted_at IS NULL AND is_self = 0 AND text != '' AND (${conditions})
         ORDER BY ts DESC
         LIMIT 60`,
      )
      .all(...params) as { display_name: string; text: string; ts: number }[];
  }

  // Nếu ít tin nhắn khớp từ khóa, lấy thêm các tin nhắn thảo luận gần đây nhất
  if (relevantMessages.length < 20) {
    const recent = db
      .prepare(
        `SELECT display_name, text, ts
         FROM group_messages
         WHERE deleted_at IS NULL AND is_self = 0 AND text != ''
         ORDER BY ts DESC
         LIMIT 60`,
      )
      .all() as { display_name: string; text: string; ts: number }[];

    const seen = new Set(relevantMessages.map((m) => m.text));
    for (const r of recent) {
      if (!seen.has(r.text)) {
        relevantMessages.push(r);
        seen.add(r.text);
      }
    }
  }

  // Lấy thêm các bản tóm tắt đã lưu trong daily_summaries
  const pastSummaries = db
    .prepare(`SELECT day_label, summary_text FROM daily_summaries ORDER BY day_date DESC LIMIT 7`)
    .all() as { day_label: string; summary_text: string }[];

  if (relevantMessages.length === 0 && pastSummaries.length === 0) {
    return `Dạ thông tin về chủ đề này chưa từng được các thành viên trong nhóm thảo luận hoặc chia sẻ trước đây ạ.`;
  }

  // Lấy Top thành viên tích cực nhất từ bảng xếp hạng để AI biết ai nói nhiều nhất/nhiều điểm nhất
  const topMembers = db
    .prepare(
      `SELECT m.display_name,
              COUNT(CASE WHEN i.type = 'message' THEN 1 END) AS msg_count,
              COALESCE(SUM(CASE i.type WHEN 'message' THEN 10 WHEN 'vote' THEN 3 WHEN 'reaction' THEN 1 ELSE 1 END), 0) AS points
       FROM members m
       JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
       WHERE m.is_active = 1
         AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
         AND LOWER(m.display_name) NOT LIKE '%sen chua%'
       GROUP BY m.zalo_user_id, m.display_name
       ORDER BY points DESC
       LIMIT 10`,
    )
    .all() as { display_name: string; msg_count: number; points: number }[];

  // Dựng ngữ cảnh dữ liệu lịch sử
  const contextLines: string[] = [];

  if (topMembers.length > 0) {
    contextLines.push("=== BẢNG XẾP HẠNG & THÀNH VIÊN TÍCH CỰC NHẤT NHÓM ===");
    topMembers.forEach((m, idx) => {
      contextLines.push(`Top ${idx + 1}: ${m.display_name} - ${m.msg_count} tin nhắn, tổng ${m.points} điểm.`);
    });
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
    "Bạn là 'Sen Chúa' - trợ lý AI hóm hỉnh, vui vẻ và tận tình của nhóm Zalo 'GROUP TRAO ĐỔI - AI, CÔNG NGHỆ'.\n" +
    "NHIỆM VỤ:\n" +
    "1. Với các câu hỏi chào hỏi, hỏi thăm đời thường (như 'ăn cơm chưa', 'bạn là ai', 'mấy tuổi', 'khỏe không'): Hãy trả lời vui vẻ, dí dỏm theo phong cách trợ lý bot Sen Chúa (ví dụ: 'Em là Sen Chúa chỉ ăn điện chạy pin phục vụ anh em thôi ạ 😄', sẵn sàng hỗ trợ nhóm).\n" +
    "2. Với các câu hỏi kiến thức, kinh nghiệm, thông tin chuyên môn: CHỈ ĐƯỢC trả lời dựa trên nội dung lịch sử chat được cung cấp bên dưới. Nêu rõ tên thành viên nếu có. Nếu trong lịch sử chat KHÔNG CÓ thông tin, hãy trả lời lịch sự:\n" +
    "   'Dạ thông tin này chưa từng được các thành viên trong nhóm thảo luận hoặc chia sẻ trước đây ạ.'\n" +
    "3. Trả lời súc tích, tự nhiên, gạch đầu dòng rõ ràng.\n" +
    "4. TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown.";

  const userPrompt =
    `DƯỚI ĐÂY LÀ DỮ LIỆU LỊCH SỬ CHAT CỦA NHÓM:\n` +
    `<chat_history>\n${contextData}\n</chat_history>\n\n` +
    `CÂU HỎI TỪ THÀNH VIÊN (${displayName}): ${question}\n\n` +
    `HÃY TRẢ LỜI CÂU HỎI TRÊN:`;

  try {
    const answer = await callGemini(systemPrompt, userPrompt);
    return answer;
  } catch (e) {
    console.warn("[member-assistant] Gemini QA error:", e);
    return "Dạ hiện tại em đang gặp chút trục trặc khi tra cứu lịch sử chat, bạn vui lòng thử lại sau giây lát nhé!";
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
    const reply = handleRankCommand(sender, displayName);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /rank cho ${displayName}`);
    return;
  }

  // 3. Lệnh /top, /top5, /leaderboard
  if (lower === "/top" || lower === "/top5" || lower === "/bxh" || lower === "/leaderboard" || lower === "!top") {
    userCooldowns.set(sender, now);
    const reply = handleTopCommand();
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /top cho ${displayName}`);
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
      ["alo", "hi", "hello", "chào", "chao", "ơi", "oi", "hey", "test", "alo bot", "bot ơi", "sen ơi", "chào bot"].includes(qLower);

    if (isGreeting) {
      await sendGroupText(
        api,
        threadId,
        `🤖 Dạ Sen Chúa nghe đây! Em sẵn sàng hỗ trợ tra cứu thông tin thảo luận trong nhóm và giải đáp thắc mắc. Bạn cần hỏi gì cứ gõ theo cú pháp: /hoi [câu hỏi] hoặc tag @Sen Chúa [câu hỏi] nhé!`,
      );
      console.log(`[member-assistant] ✅ Đã gửi lời chào cho ${displayName}`);
      return;
    }

    console.log(`[member-assistant] 🔍 Đang xử lý câu hỏi từ ${displayName} (${sender}): "${question}"...`);

    try {
      // Tra cứu RAG từ lịch sử chat
      const answer = await handleHistoryQA(question, displayName);
      const reply = `🤖 Sen Chúa trả lời @${displayName}:\n\n${answer}`;
      await sendGroupText(api, threadId, reply);
      console.log(`[member-assistant] ✅ Đã gửi câu trả lời thành công vào nhóm`);
    } catch (err) {
      console.error(`[member-assistant] ❌ Lỗi xử lý câu hỏi:`, err);
      await sendGroupText(
        api,
        threadId,
        `🤖 Dạ em đang gặp trục trặc khi tra cứu dữ liệu, bạn vui lòng thử lại sau giây lát nhé!`,
      );
    }
    return;
  }
}

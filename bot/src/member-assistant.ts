import { getDb, saveGroupKnowledge, searchGroupKnowledge, getGroupSettings } from "./db/index.js";
import { sendGroupText } from "./zalo/client.js";
import {
  callGemini,
  downloadFileContent,
  type GeminiMediaPart,
} from "./gemini.js";

export interface MemberMessageEvent {
  threadId: string;
  sender: string;
  displayName: string;
  text: string;
  isSelf?: boolean;
  mediaUrl?: string | null;
  mediaType?: string | null;
  fileAttachment?: {
    name: string;
    url: string;
    size?: number;
    extension?: string;
  } | null;
  quote?: {
    text?: string;
    senderName?: string;
    senderId?: string;
    mediaUrl?: string;
    mediaType?: "image" | "video";
  } | null;
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
  let fromTable = "members";
  try {
    const hasGroupMembers = db.prepare(`SELECT 1 FROM group_members WHERE group_id = ? LIMIT 1`).get(threadId);
    if (hasGroupMembers) fromTable = "group_members";
  } catch {}

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
       FROM ${fromTable} m
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
  let fromTable = "members";
  try {
    const hasGroupMembers = db.prepare(`SELECT 1 FROM group_members WHERE group_id = ? LIMIT 1`).get(threadId);
    if (hasGroupMembers) fromTable = "group_members";
  } catch {}

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
       FROM ${fromTable} m
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
    return "🏆 BẢNG XẾP HẠNG TOP 5\n\nChưa có dữ liệu tương tác trong nhóm này. Hãy nhắn tin để lên bảng xếp hạng nhé!";
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

async function handleHistoryQA(
  question: string,
  displayName: string,
  threadId: string,
  options?: {
    imageUrl?: string;
    fileAttachment?: MemberMessageEvent["fileAttachment"];
    quote?: MemberMessageEvent["quote"];
  },
): Promise<string> {
  const db = getDb();

  // 1. Tải và giải mã file đính kèm / ảnh / audio
  let mediaPart: GeminiMediaPart | null = null;
  let fileTextContent: string | null = null;
  const targetUrl = options?.fileAttachment?.url || options?.imageUrl || options?.quote?.mediaUrl;
  const fileName = options?.fileAttachment?.name || "";

  if (targetUrl) {
    console.log(`[member-assistant] 📥 Đang nạp tài liệu/file từ: ${targetUrl.slice(0, 80)} (${fileName})...`);
    const fileRes = await downloadFileContent(targetUrl, fileName);
    if (fileRes?.mediaPart) {
      mediaPart = fileRes.mediaPart;
      console.log(`[member-assistant] ✅ Đã nạp file đa phương tiện thành công (${mediaPart.mimeType}, size: ${Math.round(mediaPart.data.length / 1024)} KB)`);
    } else if (fileRes?.textContent) {
      fileTextContent = fileRes.textContent;
      console.log(`[member-assistant] ✅ Đã đọc file văn bản thành công (${fileTextContent.length} ký tự)`);
    }
  }

  // 2. Tra cứu Kho tri thức & Bộ nhớ dài hạn (Long-term Knowledge Memory)
  let memorizedDocs: any[] = [];
  try {
    memorizedDocs = searchGroupKnowledge(threadId, question, 5);
  } catch {}

  // 3. Lấy danh sách tin nhắn gần nhất trong nhóm để tạo ngữ cảnh
  let relevantMessages: { display_name: string; text: string; ts: number; is_self: number }[] = [];
  try {
    relevantMessages = db
      .prepare(
        `SELECT display_name, text, ts, is_self
         FROM group_messages
         WHERE (thread_id = ? OR thread_id = '')
           AND text IS NOT NULL
           AND text != ''
           AND deleted_at IS NULL
           AND LOWER(text) NOT LIKE '%sen chúa%'
           AND LOWER(text) NOT LIKE '%sen chua%'
           AND text NOT LIKE '/%'
           AND text NOT LIKE '!%'
         ORDER BY ts DESC
         LIMIT 80`,
      )
      .all(threadId) as any[];
    relevantMessages.reverse();
  } catch {}

  // 4. Lấy tóm tắt 3 ngày gần nhất (nếu có)
  let pastSummaries: { day_label: string; summary_text: string }[] = [];
  try {
    pastSummaries = db
      .prepare(
        `SELECT day_label, summary_text
         FROM daily_summaries
         WHERE (thread_id = ? OR thread_id = '')
         ORDER BY day_date DESC
         LIMIT 3`,
      )
      .all(threadId) as any[];
  } catch {}

  // 5. Lấy top 5 thành viên năng nổ nhất
  let topMembers: { display_name: string; msg_count: number; points: number }[] = [];
  try {
    topMembers = db
      .prepare(
        `SELECT m.display_name,
                COUNT(i.id) AS msg_count,
                COALESCE(SUM(CASE i.type WHEN 'message' THEN 10 WHEN 'image' THEN 10 WHEN 'video' THEN 10 WHEN 'vote' THEN 3 WHEN 'reaction' THEN 1 ELSE 1 END), 0) AS points
         FROM members m
         JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
         WHERE (i.thread_id = @threadId OR i.thread_id = '')
           AND m.is_active = 1
           AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
           AND LOWER(m.display_name) NOT LIKE '%sen chua%'
         GROUP BY m.zalo_user_id, m.display_name
         ORDER BY points DESC
         LIMIT 5`,
      )
      .all({ threadId }) as any[];
  } catch {}

  // 6. Thống kê thành viên chưa từng nhắn tin
  let inactiveMembers: { display_name: string; msg_count: number }[] = [];
  try {
    inactiveMembers = db
      .prepare(
        `SELECT m.display_name,
                COUNT(i.id) AS msg_count
         FROM members m
         LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id AND (i.thread_id = @threadId OR i.thread_id = '') AND i.type = 'message'
         WHERE (m.group_id = @threadId OR m.group_id = '' OR m.group_id IS NULL)
           AND m.is_active = 1
           AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
           AND LOWER(m.display_name) NOT LIKE '%sen chua%'
         GROUP BY m.zalo_user_id, m.display_name
         HAVING msg_count = 0`,
      )
      .all({ threadId }) as any[];
  } catch {}

  let totalMembersInGroup: { total: number } | undefined;
  try {
    totalMembersInGroup = db
      .prepare(
        `SELECT COUNT(*) AS total FROM members WHERE (group_id = ? OR group_id = '' OR group_id IS NULL) AND is_active = 1 AND LOWER(display_name) NOT LIKE '%sen chúa%'`,
      )
      .get(threadId) as { total: number } | undefined;
  } catch {}

  // Dựng ngữ cảnh dữ liệu lịch sử
  const contextLines: string[] = [];

  if (memorizedDocs && memorizedDocs.length > 0) {
    contextLines.push("=== KHO TRI THỨC & BỘ NHỚ TÀI LIỆU ĐÃ LƯU TRONG NHÓM ===");
    for (const doc of memorizedDocs) {
      const rawTs = Number(doc.created_at || doc.createdAt) || Date.now();
      let dateStr = "";
      try {
        dateStr = new Date(rawTs + 7 * 3600 * 1000).toISOString().slice(0, 10);
      } catch {
        dateStr = "Gần đây";
      }
      const title = doc.title || doc.file_name || doc.fileName || "Tài liệu";
      const sender = doc.sender_name || doc.senderName || "Thành viên";
      const content = doc.summary || doc.content_text || doc.contentText || "";
      contextLines.push(`[Tài liệu: ${title} (ngày ${dateStr}) do ${sender} gửi]:\n${content.slice(0, 500)}`);
    }
  }

  if (topMembers && topMembers.length > 0) {
    contextLines.push("=== BẢNG XẾP HẠNG & THÀNH VIÊN TÍCH CỰC NHẤT NHÓM ===");
    topMembers.forEach((m, idx) => {
      contextLines.push(`Top ${idx + 1}: ${m.display_name} - ${m.msg_count} tin nhắn, tổng ${m.points} điểm.`);
    });
  }

  if (inactiveMembers && inactiveMembers.length > 0) {
    const totalCount = totalMembersInGroup?.total ?? 0;
    contextLines.push("=== THỐNG KÊ THÀNH VIÊN CHƯA TỪNG NHẮN TIN / NẰM VÙNG / TÀU NGẦM ===");
    contextLines.push(
      `Tổng số thành viên trong nhóm: ${totalCount} người.\n` +
      `Số thành viên chưa từng gửi bất kỳ tin nhắn nào trong nhóm: ${inactiveMembers.length}/${totalCount} người.\n` +
      `Danh sách một số thành viên nằm vùng chưa từng chat: ${inactiveMembers.slice(0, 15).map((m) => m.display_name).join(", ")}...`
    );
  }

  if (pastSummaries && pastSummaries.length > 0) {
    contextLines.push("=== TÓM TẮT CÁC NGÀY TRƯỚC ===");
    for (const s of pastSummaries) {
      contextLines.push(`[Ngày ${s.day_label}]:\n${s.summary_text}`);
    }
  }

  contextLines.push("=== TIN NHẮN THẢO LUẬN CỦA CÁC THÀNH VIÊN ===");
  if (relevantMessages && relevantMessages.length > 0) {
    for (const m of relevantMessages.slice(0, 80)) {
      const rawTs = Number(m.ts) || Date.now();
      let dateStr = "";
      try {
        dateStr = new Date(rawTs + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
      } catch {
        dateStr = "";
      }
      contextLines.push(`${dateStr} | ${m.display_name || "Thành viên"}: ${m.text}`);
    }
  }

  const contextData = contextLines.join("\n\n");

  let quotePromptSection = "";
  if (options?.quote?.text) {
    quotePromptSection = `\n=== NỘI DUNG ĐƯỢC TRÍCH DẪN (QUOTE TỪ ${options.quote.senderName || "THÀNH VIÊN"}): ===\n"${options.quote.text}"\n`;
  }

  let fileContentSection = "";
  if (fileTextContent) {
    fileContentSection = `\n=== NỘI DUNG TÀI LIỆU ĐÍNH KÈM (${fileName || "File"}): ===\n${fileTextContent.slice(0, 40000)}\n`;
  }

  const groupSettings = getGroupSettings(threadId);
  const botName = groupSettings.botName || "Sen Chúa";

  let personaIntro = "";
  switch (groupSettings.persona) {
    case "professional":
      personaIntro =
        `Bạn là '${botName}' - chuyên gia cố vấn AI cấp cao, súc tích, logic, chuẩn xác và chuyên nghiệp của cộng đồng Zalo.\n` +
        `Phong cách trả lời: Đi thẳng vào trọng tâm, phân tích chuyên môn sâu sắc (công nghệ, AI, code, marketing, tài chính, kinh doanh), logic mạch lạc, súc tích, ngôn từ lịch thiệp và chuẩn mực.`;
      break;
    case "friendly":
      personaIntro =
        `Bạn là '${botName}' - trợ lý AI tận tâm, ân cần, lễ phép, chu đáo và lịch sự của cộng đồng Zalo.\n` +
        `Phong cách trả lời: Nhẹ nhàng, nhiệt tình hỗ trợ, giải thích cặn kẽ và chu đáo cho mọi thành viên, xưng hô tôn trọng, tạo cảm giác gắn kết ấm áp.`;
      break;
    case "strict":
      personaIntro =
        `Bạn là '${botName}' - người điều hành & giám sát AI chuẩn mực, nghiêm túc của cộng đồng Zalo.\n` +
        `Phong cách trả lời: Nghiêm túc, chuẩn mực, đề cao kỷ luật và nội quy nhóm, cảnh báo thẳng thắn các hành vi sai phạm hoặc thông tin sai lệch, ngôn từ chính xác và dứt khoát.`;
      break;
    case "custom":
      personaIntro =
        `Bạn là '${botName}' - trợ lý AI của cộng đồng Zalo được tùy biến riêng theo chỉ đạo của Quản trị viên.`;
      break;
    case "humorous":
    default:
      personaIntro =
        `Bạn là '${botName}' - trợ lý AI cực kỳ hóm hỉnh, thông minh, vui tính, mặn mà và bắt trend của cộng đồng Zalo.\n` +
        `Phong cách trả lời: Hài hước, duyên dáng, dí dỏm, thả miếng bắt trend, tạo không khí sôi nổi và gắn kết anh em trong nhóm.`;
      break;
  }

  let customPromptSection = "";
  if (groupSettings.customPrompt?.trim()) {
    customPromptSection = `\n=== CHỈ THỊ & NỘI QUY RIÊNG CỦA ADMIN CHO NHÓM NÀY (BẮT BUỘC TUÂN THỦ 100%): ===\n${groupSettings.customPrompt.trim()}\n`;
  }

  const systemPrompt =
    `${personaIntro}\n${customPromptSection}\n` +
    `NHIỆM VỤ CHUNG:\n` +
    `1. Nếu có FILE TÀI LIỆU (PDF, Word, Excel, Code, TXT, Âm thanh, Hình ảnh) đính kèm: ĐỌC KỸ TOÀN BỘ NỘI DUNG, trích xuất dữ liệu, dịch thuật, phân tích chuyên sâu hoặc tóm tắt đầy đủ.\n` +
    `2. Nếu người dùng hỏi về kiến thức/tài liệu cũ đã từng gửi trong nhóm: Tra cứu từ 'KHO TRI THỨC & BỘ NHỚ TÀI LIỆU ĐÃ LƯU' để trả lời chính xác.\n` +
    `3. Nếu có NỘI DUNG ĐƯỢC TRÍCH DẪN (QUOTE): Hiểu rằng người dùng đang hỏi hoặc bình luận về chính nội dung được trích dẫn đó.\n` +
    `4. Luôn trả lời chuẩn theo phong cách cá tính được quy định ở trên.\n` +
    `5. TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown (hãy dùng dấu gạch đầu dòng, viết hoa hoặc icon để làm nổi bật).`;

  const userPrompt =
    `${quotePromptSection}\n${fileContentSection}\n` +
    `DƯỚI ĐÂY LÀ DỮ LIỆU LỊCH SỬ CHAT CỦA NHÓM ĐỂ THAM KHẢO:\n` +
    `<chat_history>\n${contextData}\n</chat_history>\n\n` +
    `YÊU CẦU / CÂU HỎI TỪ THÀNH VIÊN (${displayName}): ${question || "Hãy phân tích tài liệu/hình ảnh/nội dung trên giúp tôi."}\n\n` +
    `HÃY TRẢ LỜI THẬT DUYÊN DÁNG, CHUẨN XÁC VÀ HÓM HỈNH:`;

  try {
    const answer = await callGemini(systemPrompt, userPrompt, {
      mediaParts: mediaPart ? [mediaPart] : undefined,
    });

    // 🧠 TỰ ĐỘNG GHI NHỚ VÀO BỘ NHỚ DÀI HẠN NẾU ĐÂY LÀ TÀI LIỆU/FILE/ẢNH PHÂN TÍCH
    if (targetUrl && (fileName || mediaPart || fileTextContent)) {
      saveGroupKnowledge({
        threadId,
        title: fileName || question.slice(0, 50) || "Tài liệu",
        fileName: fileName || "file_attachment",
        fileType: mediaPart?.mimeType || "document",
        fileUrl: targetUrl,
        contentText: fileTextContent ? fileTextContent.slice(0, 5000) : question,
        summary: answer.slice(0, 2000),
        senderName: displayName,
        createdAt: Date.now(),
      });
    }

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
  const hasImage = Boolean(event.mediaUrl || event.quote?.mediaUrl);
  const hasFile = Boolean(event.fileAttachment);
  const hasQuote = Boolean(event.quote?.text || event.quote?.mediaUrl);

  if (!rawText && !hasImage && !hasFile) return;

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
      hasImage ||
      hasFile ||
      hasQuote ||
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
  if (
    lower === "/help" ||
    lower === "help" ||
    lower === "!help" ||
    lower === "/menu" ||
    lower === "menu" ||
    lower === "!menu" ||
    lower === "/trogiup" ||
    lower === "/lenh" ||
    lower === "lenh" ||
    lower === "!lenh"
  ) {
    userCooldowns.set(sender, now);
    const reply = handleHelpCommand();
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /help cho ${displayName}`);
    return;
  }

  // 2. Lệnh /rank, /diem, /myrank
  if (
    lower === "/rank" ||
    lower === "rank" ||
    lower === "!rank" ||
    lower === "/diem" ||
    lower === "diem" ||
    lower === "!diem" ||
    lower === "/myrank" ||
    lower === "myrank"
  ) {
    userCooldowns.set(sender, now);
    const reply = handleRankCommand(sender, displayName, threadId);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /rank cho ${displayName}`);
    return;
  }

  // 3. Lệnh /top, /top5, /leaderboard, /bxh
  if (
    lower === "/top" ||
    lower === "top" ||
    lower === "!top" ||
    lower === "/top5" ||
    lower === "top5" ||
    lower === "/bxh" ||
    lower === "bxh" ||
    lower === "!bxh" ||
    lower === "/leaderboard" ||
    lower === "leaderboard"
  ) {
    userCooldowns.set(sender, now);
    const reply = handleTopCommand(threadId);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /top cho ${displayName}`);
    return;
  }

  // 4. Lệnh /link, /links, /tonghoplink, /tailieu
  if (
    lower === "/link" ||
    lower === "!link" ||
    lower === "/links" ||
    lower.startsWith("/link ") ||
    lower.startsWith("!link ") ||
    lower.startsWith("/links ") ||
    lower === "/tonghoplink" ||
    lower === "/tailieu" ||
    lower.startsWith("/tonghoplink ") ||
    lower.startsWith("/tailieu ")
  ) {
    userCooldowns.set(sender, now);
    const filter = rawText
      .replace(/^\/links?\s*/i, "")
      .replace(/^!links?\s*/i, "")
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
    lower === "taungam" ||
    lower === "!taungam" ||
    lower === "/namvung" ||
    lower === "/inactive" ||
    lower === "inactive" ||
    lower === "/chuachat" ||
    lower === "/chuatungchat"
  ) {
    userCooldowns.set(sender, now);
    const reply = handleInactiveCommand(threadId);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /taungam cho ${displayName}`);
    return;
  }

  // 6. Lệnh /hoi [câu hỏi], Tag bot, Nhắc tên Sen Chúa, Chào hỏi, Lệnh đọc file/ảnh
  // QUY TẮC: BOT CHỈ TRẢ LỜI KHI THÀNH VIÊN THỰC SỰ GỌI TÊN HOẶC DÙNG LỆNH CỦA BOT.
  // Tránh việc thành viên chat bình thường/quote với nhau mà bot tự ý xen vào.
  const mentionsBot =
    lower.includes("@sen chúa") ||
    lower.includes("@sen chua") ||
    lower.includes("sen chúa") ||
    lower.includes("sen chua") ||
    lower.includes("@senchua") ||
    lower.includes("@bot") ||
    lower.startsWith("bot ơi") ||
    lower.startsWith("bot oi") ||
    lower.startsWith("chào bot") ||
    lower.startsWith("chao bot") ||
    lower.startsWith("alo bot") ||
    lower.startsWith("hi bot") ||
    lower.startsWith("hello bot") ||
    lower.startsWith("sen ơi") ||
    lower.startsWith("sen oi") ||
    lower.includes("bot ơi") ||
    lower.includes("bot oi") ||
    lower.includes("sen ơi") ||
    lower.includes("sen oi") ||
    lower.includes("nhờ bot") ||
    lower.includes("nhờ sen") ||
    lower.includes("hỏi bot") ||
    lower.includes("hỏi sen") ||
    lower.includes("cho bot") ||
    lower.includes("cho sen") ||
    lower.startsWith("bot ") ||
    lower.startsWith("sen ");

  const isCommand =
    lower.startsWith("/hoi") ||
    lower.startsWith("!hoi") ||
    lower.startsWith("/dich") ||
    lower.startsWith("!dich") ||
    lower.startsWith("/docanh") ||
    lower.startsWith("!docanh") ||
    lower.startsWith("/docfile") ||
    lower.startsWith("/file") ||
    lower.startsWith("/anh") ||
    (event.isSelf && lower.startsWith("@"));

  const isTagBot = isCommand || mentionsBot;

  if (isTagBot) {
    userCooldowns.set(sender, now);

    // Làm sạch câu hỏi
    let question = rawText
      .replace(/^\/hoi\s*/i, "")
      .replace(/^!hoi\s*/i, "")
      .replace(/^\/dich\s*/i, "")
      .replace(/^!dich\s*/i, "")
      .replace(/^\/docanh\s*/i, "")
      .replace(/^!docanh\s*/i, "")
      .replace(/^\/docfile\s*/i, "")
      .replace(/^\/file\s*/i, "")
      .replace(/^\/anh\s*/i, "")
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
      .replace(/^chào bot\s*,?/i, "")
      .replace(/^chao bot\s*,?/i, "")
      .replace(/^alo bot\s*,?/i, "")
      .replace(/^hi bot\s*,?/i, "")
      .replace(/^hello bot\s*,?/i, "")
      .replace(/^@[^\s]+\s*/, "")
      .trim();

    const qLower = question.toLowerCase().trim();
    const greetingWords = new Set([
      "alo", "hi", "hello", "chào", "chao", "ơi", "oi", "hey", "test",
      "alo bot", "bot ơi", "sen ơi", "chào bot", "chào em", "chào bạn",
      "sen chúa ơi", "sen chua oi", "chào sen", "chao sen", "hi bot", "hello bot"
    ]);

    const isGreeting =
      !hasImage &&
      !hasFile &&
      !hasQuote &&
      (!question || greetingWords.has(qLower));

    if (isGreeting) {
      await sendGroupText(
        api,
        threadId,
        `🤖 Dạ Sen Chúa chào ${displayName || "bác"} ạ! Em sẵn sàng hỗ trợ tra cứu thông tin thảo luận trong nhóm, điểm tương tác, đọc hình ảnh, tài liệu (PDF, Word, Excel, Code), dịch thuật và ghi nhớ kiến thức. Bạn cần hỏi gì cứ gõ: /hoi [câu hỏi], gửi file/ảnh kèm câu lệnh hoặc tag @Sen Chúa nhé!`,
      );
      console.log(`[member-assistant] ✅ Đã gửi lời chào cho ${displayName}`);
      return;
    }

    // Các câu đối đáp hài hước, trêu chọc tức thì
    if (!hasImage && !hasFile && !hasQuote && ["ngáo", "ngao", "ngu", "dở", "do", "ngốc", "ngoc", "lag", "chán", "chan"].some((w) => qLower === w || qLower.startsWith(w + " ") || qLower.endsWith(" " + w))) {
      await sendGroupText(
        api,
        threadId,
        `🤖 Dạ em Sen Chúa chỉ ăn điện với chạy bằng dữ liệu thôi nên thỉnh thoảng hơi lag xíu xiêu 😄! Bác ${displayName} thương tình thông cảm cho em nhé, em đang cố gắng thông minh hơn mỗi ngày đây ạ!`,
      );
      return;
    }

    if (!hasImage && !hasFile && !hasQuote && (qLower.includes("mute") || qLower.includes("ban") || qLower.includes("kick"))) {
      await sendGroupText(
        api,
        threadId,
        `🤖 Dạ em Sen Chúa hiền lành dễ thương chỉ biết tra cứu thông tin với tính điểm thôi ạ 😄! Quyền năng "sinh sát" mute hay kick là của các bác Admin, em phận làm bot không dám manh động đâu nè!`,
      );
      return;
    }

    if (!hasImage && !hasFile && !hasQuote && (qLower.includes("1 triệu view") || qLower.includes("triệu view") || qLower.includes("1tr view") || qLower.includes("tăng view"))) {
      await sendGroupText(
        api,
        threadId,
        `🤖 Sen Chúa trả lời @${displayName}:\n\nDạ bí kíp đạt 1 triệu view trong 1 đêm nhanh nhất là: Tối nay bác cứ đăng video lên rồi đi ngủ sớm... mơ một giấc thật đẹp là sáng mai có ngay 1 triệu view ạ 😄!\n\nHoặc bác có thể hỏi các cao thủ trong nhóm như bác Vũ Trọng, Tu, Huy để xin tút chạy ads và làm content viral chuẩn chỉnh nhé!`,
      );
      return;
    }

    // Tự động nhận diện câu hỏi xin link, tổng hợp link, tài liệu
    if (
      !hasImage &&
      !hasFile &&
      !hasQuote &&
      (qLower.includes("tổng hợp link") ||
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
        qLower.includes("link youtube"))
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
      !hasImage &&
      !hasFile &&
      !hasQuote &&
      (qLower.includes("chưa từng chat") ||
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
        qLower.includes("lười chat"))
    ) {
      const reply =
        `🤖 Sen Chúa trả lời @${displayName}:\n\n` +
        handleInactiveCommand(threadId);
      await sendGroupText(api, threadId, reply);
      console.log(`[member-assistant] ✅ Đã gửi thống kê tàu ngầm tự động cho ${displayName}`);
      return;
    }

    console.log(`[member-assistant] 🔍 Đang xử lý câu hỏi từ ${displayName} (${sender}): "${question}" (HasFile=${hasFile}, HasImage=${hasImage}, HasQuote=${hasQuote})...`);

    try {
      const targetImageUrl = event.mediaUrl || event.quote?.mediaUrl || undefined;
      const answer = await handleHistoryQA(question, displayName, threadId, {
        imageUrl: targetImageUrl,
        fileAttachment: event.fileAttachment,
        quote: event.quote,
      });
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



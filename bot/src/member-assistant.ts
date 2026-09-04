import {
  getDb,
  saveGroupKnowledge,
  searchGroupKnowledge,
  getGroupSettings,
  isMemberBlocked,
  blockMember,
  unblockMember,
  listBlockedMembers,
  isMemberHiddenFromLeaderboard,
  hideMemberFromLeaderboard,
  unhideMemberFromLeaderboard,
  listLeaderboardExclusions,
  isUserAdmin,
  getRecentGroupImage,
  getMediaByMessageId,
} from "./db/index.js";
import { sendGroupText } from "./zalo/client.js";
import {
  callGemini,
  downloadFileContent,
  type GeminiMediaPart,
} from "./gemini.js";
import { getWeatherReport } from "./weather.js";
import { getDailyAiNewsBriefing } from "./ai-news.js";
import { handleSetReminder, handleListReminders, handleCancelReminder, parseNaturalTimeVietnam } from "./reminder.js";

export interface MemberMessageEvent {
  threadId: string;
  sender: string;
  displayName: string;
  text: string;
  isSelf?: boolean;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mentions?: { uid: string; pos?: number; len?: number }[];
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
    msgId?: string;
    cliMsgId?: string;
    globalMsgId?: string;
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

  // Nếu thành viên đã được Admin ẩn khỏi bảng xếp hạng
  if (isMemberHiddenFromLeaderboard(sender, threadId)) {
    return (
      `📊 THÔNG TIN TƯƠNG TÁC\n\n` +
      `👤 Thành viên: ${displayName}\n` +
      `👑 Tài khoản của bạn đã được miễn tham gia bảng xếp hạng đua top (theo yêu cầu của Quản trị viên) để nhường sân chơi cho anh em trong nhóm nhé!`
    );
  }

  // Tự động phân nhánh: nếu đã có bảng group_members thì tính theo nhóm, chưa có thì fallback về members
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
         AND LOWER(m.display_name) NOT LIKE '%mộc miên%'
         AND LOWER(m.display_name) NOT LIKE '%moc mien%'
         AND m.zalo_user_id NOT IN (
           SELECT zalo_user_id FROM leaderboard_exclusions WHERE group_id = '' OR group_id = @threadId
         )
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
         AND LOWER(m.display_name) NOT LIKE '%mộc miên%'
         AND LOWER(m.display_name) NOT LIKE '%moc mien%'
         AND m.zalo_user_id NOT IN (
           SELECT zalo_user_id FROM leaderboard_exclusions WHERE group_id = '' OR group_id = @threadId
         )
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

export interface FoundResource {
  url: string;
  sender: string;
  context: string;
  ts: number;
}

/**
 * Tra cứu toàn diện danh sách đường link & tài nguyên trong lịch sử nhóm (cả tin nhắn lẫn kho tri thức).
 * Hỗ trợ lọc đa từ khóa thông minh (ví dụ: "github", "zalo", "bot").
 */
export function searchRelevantLinksAndResources(
  _threadId?: string,
  query: string = "",
  limit = 20,
): FoundResource[] {
  const db = getDb();
  const allLinks: FoundResource[] = [];
  const urlRegex = /(https?:\/\/[^\s]+)/gi;

  // 1. Quét lịch sử tin nhắn chứa link (tối đa 500 tin nhắn gần nhất có chứa link)
  try {
    const rows = db
      .prepare(
        `SELECT display_name, text, ts
         FROM group_messages
         WHERE deleted_at IS NULL
           AND (text LIKE '%http://%' OR text LIKE '%https://%')
         ORDER BY ts DESC
         LIMIT 1000`,
      )
      .all() as { display_name: string; text: string; ts: number }[];

    for (const r of rows) {
      const matches = r.text.match(urlRegex);
      if (!matches) continue;
      for (const u of matches) {
        const cleanUrl = u.replace(/[.,;!?)]+$/, "");
        if (allLinks.some((l) => l.url === cleanUrl)) continue;
        const cleanContext = r.text.replace(urlRegex, "").replace(/\s+/g, " ").trim();
        allLinks.push({
          url: cleanUrl,
          sender: r.display_name || "Thành viên",
          context: cleanContext.slice(0, 180) || "Chia sẻ đường link",
          ts: r.ts,
        });
      }
    }
  } catch (err) {
    console.warn("[searchRelevantLinks] Lỗi quét group_messages:", err);
  }

  // 2. Quét thêm từ Kho tri thức nhóm (group_knowledge) nếu có
  try {
    const knowledges = db
      .prepare(
        `SELECT title, summary, content_text, file_url, sender_name, created_at
         FROM group_knowledge
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all() as any[];

    for (const k of knowledges) {
      const rawText = `${k.title || ""} ${k.summary || ""} ${k.content_text || ""} ${k.file_url || ""}`;
      const matches = rawText.match(urlRegex);
      if (matches) {
        for (const u of matches) {
          const cleanUrl = u.replace(/[.,;!?)]+$/, "");
          if (allLinks.some((l) => l.url === cleanUrl)) continue;
          allLinks.push({
            url: cleanUrl,
            sender: k.sender_name || "Kho Tri Thức",
            context: (k.title || k.summary || "Tài liệu lưu trữ").slice(0, 180),
            ts: Number(k.created_at) || Date.now(),
          });
        }
      }
    }
  } catch (err) {
    console.warn("[searchRelevantLinks] Lỗi quét group_knowledge:", err);
  }

  // 3. Quét toàn bộ Kho Kiến Thức & Tóm tắt lịch sử (/hub - daily_summaries) của tất cả các ngày trước
  try {
    const summaries = db
      .prepare(
        `SELECT day_label, summary_text, created_at
         FROM daily_summaries
         ORDER BY day_date DESC`,
      )
      .all() as any[];

    for (const s of summaries) {
      const summaryText = s.summary_text || "";
      const matches = summaryText.match(urlRegex);
      if (!matches) continue;

      const lines = summaryText.split("\n");
      for (const line of lines) {
        const lineMatches = line.match(urlRegex);
        if (!lineMatches) continue;
        for (const u of lineMatches) {
          const cleanUrl = u.replace(/[.,;!?)]+$/, "");
          if (allLinks.some((l) => l.url === cleanUrl)) continue;

          const cleanLine = line
            .replace(urlRegex, "")
            .replace(/^[-*•\s\d.:]+/, "")
            .trim();

          let sender = `Kho Hub (ngày ${s.day_label || "trước"})`;
          const senderMatch = cleanLine.match(/(?:do|bởi|Người gửi:?)\s+([A-Za-z0-9_\sÀ-ỹ]+?)(?:\s+chia sẻ|\s*$|[.,;-])/i);
          if (senderMatch && senderMatch[1]) {
            sender = senderMatch[1].trim();
          }

          allLinks.push({
            url: cleanUrl,
            sender,
            context: cleanLine.slice(0, 180) || "Tài nguyên tổng hợp từ Kho Hub",
            ts: Number(s.created_at) || Date.now(),
          });
        }
      }
    }
  } catch (err) {
    console.warn("[searchRelevantLinks] Lỗi quét daily_summaries:", err);
  }

  // 3. Tách từ khóa tìm kiếm (loại trừ từ dừng tiếng Việt)
  const stopWords = new Set([
    "sen", "chúa", "chua", "mộc", "miên", "moc", "mien", "bot",
    "liệt", "kê", "liet", "ke", "toàn", "bộ", "toan", "bo", "danh", "sách", "sach",
    "link", "đường", "duong", "dẫn", "dan", "có", "co", "liên", "quan", "lien",
    "tới", "toi", "đến", "den", "từ", "tu", "trước", "truoc", "giờ", "gio",
    "trong", "tài", "nguyên", "tai", "nguyen", "nhóm", "nhom", "giúp", "giup",
    "mình", "minh", "với", "voi", "nhé", "nhe", "ạ", "ơi", "oi", "hỏi", "cho", "em"
  ]);

  const rawWords = query
    .toLowerCase()
    .replace(/[.,;!?/\\@#$%^&*()_+={}\[\]|~`"':<>]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  const keywords = Array.from(new Set(rawWords));
  if (/github|repo/i.test(query) && !keywords.includes("github")) keywords.push("github");
  if (/zalo/i.test(query) && !keywords.includes("zalo")) keywords.push("zalo");

  if (keywords.length === 0) {
    return allLinks.slice(0, limit);
  }

  // 4. Chấm điểm độ khớp: URL hoặc Ngữ cảnh chứa từ khóa
  const scored = allLinks.map((item) => {
    const textToMatch = `${item.url.toLowerCase()} ${item.context.toLowerCase()}`;
    let matchCount = 0;
    for (const kw of keywords) {
      if (textToMatch.includes(kw)) {
        matchCount++;
      }
    }
    return { item, matchCount };
  });

  const matched = scored
    .filter((s) => s.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount || b.item.ts - a.item.ts)
    .map((s) => s.item);

  return matched.slice(0, limit);
}

/**
 * Trích xuất danh sách link/tài liệu được chia sẻ gần nhất trong nhóm theo lệnh /link [từ khóa]
 */
function handleLinksCommand(threadId: string, keywordFilter?: string): string {
  const links = searchRelevantLinksAndResources(threadId, keywordFilter || "", 15);

  if (links.length === 0) {
    if (keywordFilter) {
      return `🔗 TỔNG HỢP LINK CHIA SẺ\n\nKhông tìm thấy link nào khớp với từ khóa "${keywordFilter}" trong lịch sử nhóm.`;
    }
    return `🔗 TỔNG HỢP LINK CHIA SẺ\n\nChưa có link hoặc tài liệu nào được chia sẻ trong lịch sử nhóm.`;
  }

  const items = links.map((l, idx) => {
    const d = new Date(l.ts + 7 * 3600 * 1000);
    const timeStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    return `${idx + 1}. ${l.url}\n   👤 ${l.sender} (${timeStr})\n   📝 ${l.context}`;
  });

  return (
    `🔗 TỔNG HỢP LINK & TÀI LIỆU TRONG NHÓM (${links.length} link tìm thấy)\n\n` +
    items.join("\n\n") +
    `\n\n💡 Mẹo: Bạn có thể gõ /link [từ khóa] hoặc hỏi tự nhiên "@Sen Chúa tìm link..."!`
  );
}

export interface DiscussionMessageSnippet {
  displayName: string;
  text: string;
  timeStr: string;
  isMain: boolean;
}

export interface DiscussionThreadSnippet {
  topic: string;
  mainAuthor: string;
  dateStr: string;
  messages: DiscussionMessageSnippet[];
}

/**
 * Tra cứu sâu các đoạn thảo luận & quy trình trong lịch sử chat của nhóm (group_messages).
 * Tự động phân tích từ khóa, nhận diện tên người chia sẻ (VD: bác Huy, anh Nam, Vũ Trọng...),
 * tìm các tin nhắn gốc và mở rộng cửa sổ ngữ cảnh (Context Window) 2 tin trước + 4 tin sau.
 */
export function searchRelevantDiscussions(
  threadId: string,
  question: string,
  limit = 3,
): DiscussionThreadSnippet[] {
  const db = getDb();
  const results: DiscussionThreadSnippet[] = [];

  const stopWords = new Set([
    "sen", "chúa", "chua", "mộc", "miên", "moc", "mien", "bot",
    "tìm", "lại", "tim", "lai", "cho", "mình", "minh", "em", "với", "voi",
    "nhé", "nhe", "nha", "ạ", "ơi", "oi", "hỏi", "hoi", "giúp", "giup",
    "có", "co", "ai", "nào", "nao", "gì", "gi", "ở", "o", "đâu", "dau",
    "như", "nhu", "thế", "the", "ra", "sao", "chia", "sẻ", "se", "nói", "noi",
    "bàn", "ban", "về", "ve", "trong", "nhóm", "nhom", "từ", "tu", "trước", "truoc",
    "bác", "bac", "anh", "chị", "chi", "sếp", "sep", "ông", "ong", "bạn", "ban"
  ]);

  // Nhận diện người chia sẻ được nhắc tới (VD: "bác Huy", "anh Nam", "Vũ Trọng", "Hoa Van")
  let authorHint = "";
  const authorMatch = question.match(/(?:bác|anh|chị|sếp|ông|bạn)\s+([A-Za-z0-9_\sÀ-ỹ]{2,20}?)(?:\s+chia|\s+nói|\s+hướng|\s+bảo|\s+dạy|\s*$|[.,;?!])/i);
  if (authorMatch && authorMatch[1]) {
    const candidate = authorMatch[1].trim();
    if (!stopWords.has(candidate.toLowerCase())) {
      authorHint = candidate;
    }
  }

  // Tách từ khóa chủ đề (VD: quy trình, video, thời trang, ai, prompt, tool...)
  const rawWords = question
    .toLowerCase()
    .replace(/[.,;!?/\\@#$%^&*()_+={}\[\]|~`"':<>]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  const keywords = Array.from(new Set(rawWords));
  if (keywords.length === 0 && !authorHint) {
    return [];
  }

  try {
    const params: any[] = [];
    let sql = `SELECT id, message_id, display_name, text, ts, thread_id
               FROM group_messages
               WHERE deleted_at IS NULL
                 AND text != ''
                 AND text NOT LIKE '/%'
                 AND text NOT LIKE '!%'
                 AND text NOT LIKE '🤖%'
                 AND LOWER(display_name) NOT LIKE '%sen chúa%'
                 AND LOWER(display_name) NOT LIKE '%sen chua%'`;

    if (threadId) {
      sql += ` AND (thread_id = ? OR thread_id = '')`;
      params.push(threadId);
    }

    if (authorHint) {
      sql += ` AND LOWER(display_name) LIKE ?`;
      params.push(`%${authorHint.toLowerCase()}%`);
    }

    sql += ` ORDER BY ts DESC LIMIT 100`;

    const candidateRows = db.prepare(sql).all(...params) as any[];

    const scoredCandidates = candidateRows.map((row) => {
      const lowerText = row.text.toLowerCase();
      let matchCount = 0;
      for (const kw of keywords) {
        if (lowerText.includes(kw)) matchCount++;
      }
      return { row, matchCount };
    });

    const bestMatches = scoredCandidates
      .filter((c) => c.matchCount > 0 || (authorHint && c.row.text.length > 30))
      .sort((a, b) => b.matchCount - a.matchCount || b.row.ts - a.row.ts)
      .slice(0, limit);

    for (const match of bestMatches) {
      const mainMsg = match.row;
      const mainTs = Number(mainMsg.ts);
      const targetThread = mainMsg.thread_id || threadId;

      const prevMsgs = db
        .prepare(
          `SELECT display_name, text, ts
           FROM group_messages
           WHERE (thread_id = ? OR thread_id = '')
             AND ts < ?
             AND deleted_at IS NULL
             AND text != ''
             AND text NOT LIKE '/%'
             AND text NOT LIKE '!%'
             AND text NOT LIKE '🤖%'
           ORDER BY ts DESC
           LIMIT 2`,
        )
        .all(targetThread, mainTs) as any[];
      prevMsgs.reverse();

      const nextMsgs = db
        .prepare(
          `SELECT display_name, text, ts
           FROM group_messages
           WHERE (thread_id = ? OR thread_id = '')
             AND ts > ?
             AND deleted_at IS NULL
             AND text != ''
             AND text NOT LIKE '/%'
             AND text NOT LIKE '!%'
             AND text NOT LIKE '🤖%'
           ORDER BY ts ASC
           LIMIT 4`,
        )
        .all(targetThread, mainTs) as any[];

      const combined: DiscussionMessageSnippet[] = [];

      for (const p of prevMsgs) {
        const d = new Date(Number(p.ts) + 7 * 3600 * 1000);
        combined.push({
          displayName: p.display_name || "Thành viên",
          text: p.text,
          timeStr: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
          isMain: false,
        });
      }

      const mainDate = new Date(mainTs + 7 * 3600 * 1000);
      combined.push({
        displayName: mainMsg.display_name || "Thành viên",
        text: mainMsg.text,
        timeStr: `${String(mainDate.getUTCHours()).padStart(2, "0")}:${String(mainDate.getUTCMinutes()).padStart(2, "0")}`,
        isMain: true,
      });

      for (const n of nextMsgs) {
        const d = new Date(Number(n.ts) + 7 * 3600 * 1000);
        combined.push({
          displayName: n.display_name || "Thành viên",
          text: n.text,
          timeStr: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
          isMain: false,
        });
      }

      const dateStr = `${String(mainDate.getUTCDate()).padStart(2, "0")}/${String(mainDate.getUTCMonth() + 1).padStart(2, "0")}/${mainDate.getUTCFullYear()}`;

      results.push({
        topic: keywords.join(" "),
        mainAuthor: mainMsg.display_name,
        dateStr,
        messages: combined,
      });
    }
  } catch (err) {
    console.warn("[searchRelevantDiscussions] Lỗi tra cứu tin nhắn thảo luận:", err);
  }

  return results;
}

/**
 * Tra cứu sâu các mục tóm tắt chuyên môn / kinh nghiệm trong toàn bộ lịch sử daily_summaries.
 */
export function searchRelevantDailySummaries(
  _threadId: string,
  question: string,
  limit = 4,
): { dayLabel: string; relevantBulletPoints: string[] }[] {
  const db = getDb();
  const results: { dayLabel: string; relevantBulletPoints: string[] }[] = [];

  const stopWords = new Set([
    "sen", "chúa", "chua", "bot", "tìm", "lại", "cho", "mình", "em", "với", "nhé",
    "như", "thế", "nào", "gì", "ai", "ở", "đâu"
  ]);

  const rawWords = question
    .toLowerCase()
    .replace(/[.,;!?/\\@#$%^&*()_+={}\[\]|~`"':<>]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  const keywords = Array.from(new Set(rawWords));
  if (keywords.length === 0) return [];

  try {
    const rows = db
      .prepare(
        `SELECT day_label, summary_text
         FROM daily_summaries
         ORDER BY day_date DESC`,
      )
      .all() as any[];

    for (const r of rows) {
      const text = r.summary_text || "";
      const lines = text.split("\n");
      const matchedLines: string[] = [];

      for (const line of lines) {
        const cleanLine = line.trim();
        if (!cleanLine || cleanLine.startsWith("(") || cleanLine.startsWith("#") || cleanLine.startsWith("=")) continue;
        const lowerLine = cleanLine.toLowerCase();

        let hasKw = false;
        for (const kw of keywords) {
          if (lowerLine.includes(kw)) {
            hasKw = true;
            break;
          }
        }
        if (hasKw) {
          matchedLines.push(cleanLine.replace(/^[-*•\s\d.:]+/, "").trim());
        }
      }

      if (matchedLines.length > 0) {
        results.push({
          dayLabel: r.day_label || "Gần đây",
          relevantBulletPoints: matchedLines.slice(0, 5),
        });
        if (results.length >= limit) break;
      }
    }
  } catch (err) {
    console.warn("[searchRelevantDailySummaries] Lỗi quét daily_summaries:", err);
  }

  return results;
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
    `⏰ ĐẶT HẸN & BÁO THỨC:\n` +
    `🔹 /nhacnho [thời gian] [nội dung]: Đặt lịch hẹn nhắc việc (VD: /nhacnho 20p Đi họp, /hengio 17:30 Đón con, /hengio 8h tối mai Kèo bóng đá)\n` +
    `🔹 /dsnhac: Xem danh sách các lịch hẹn đang chờ của bạn\n` +
    `🔹 /huynhac [mã_số]: Hủy lịch hẹn theo mã\n` +
    `🔹 Hoặc tag bot: "@Sen Chúa 8h tối mai nhắc cả nhóm có kèo bóng đá nhé"\n\n` +
    `☀️ THỜI TIẾT & BỤI MỊN (AQI):\n` +
    `🔹 /thoitiet: Xem thời tiết & bụi mịn PM2.5 hôm nay\n` +
    `🔹 /thoitiet [địa điểm]: Xem thời tiết TP.HCM, Hà Nội, Đà Lạt, Đà Nẵng...\n\n` +
    `📰 BẢN TIN AI & CÔNG NGHỆ (REAL-TIME):\n` +
    `🔹 /tintuc hoặc /bantin: Điểm tin tức AI và công nghệ mới nhất 24h qua trên Google & X\n` +
    `🔹 /tintuc [chủ đề]: Điểm tin tức theo chủ đề (VD: /tintuc Claude 3.7, /tintuc Grok 3, /tintuc OpenAI)\n\n` +
    `📊 TƯƠNG TÁC & TRI THỨC:\n` +
    `🔹 /rank hoặc /diem: Tra cứu thứ hạng & điểm tương tác của bạn\n` +
    `🔹 /top: Xem Top 5 thành viên tích cực nhất nhóm\n` +
    `🔹 /taungam: Xem thống kê các thành viên nằm vùng / chưa từng gửi tin nhắn\n` +
    `🔹 /link [từ khóa]: Tổng hợp tất cả link/tài liệu/video đã chia sẻ trong nhóm\n` +
    `🔹 /hoi [câu hỏi] hoặc tag @Sen Chúa: Hỏi đáp kiến thức tra cứu từ lịch sử chat của nhóm\n` +
    `🔹 /help: Hiển thị hướng dẫn này\n\n` +
    `🚫 QUẢN TRỊ VIÊN — ĐIỀU HÀNH NHÓM:\n` +
    `🔹 /chanbot: Quote tin nhắn người cần chặn rồi gõ /chanbot (hoặc /chanbot [Tên/ID])\n` +
    `🔹 /bochanbot: Quote tin nhắn người cần bỏ chặn rồi gõ /bochanbot\n` +
    `🔹 /dschan: Xem danh sách thành viên đang bị chặn bot trả lời\n` +
    `🔹 /anrank: Quote tin nhắn người cần ẩn rồi gõ /anrank (hoặc /anrank [Tên/ID]) để không cho hiển thị trên BXH đua top\n` +
    `🔹 /hienrank: Quote tin nhắn người cần hiện lại BXH rồi gõ /hienrank\n` +
    `🔹 /dsanrank: Xem danh sách thành viên đang được ẩn khỏi BXH`
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

  // 🚀 FAST-PATH MULTIMODAL: Nếu đang phân tích ảnh hoặc tài liệu đính kèm,
  // CẮT BỎ TOÀN BỘ truy vấn DB nặng (Top members, Inactive members, 60 tin nhắn chat, tóm tắt cũ)
  // để Gemini phản hồi tức thì trong 2-3 giây và không bị ảo giác bởi tài liệu cũ!
  if (mediaPart || fileTextContent) {
    const groupSettings = getGroupSettings(threadId);
    const botName = groupSettings.botName || "Sen Chúa";

    let personaIntro = "";
    switch (groupSettings.persona) {
      case "professional":
        personaIntro = `Bạn là '${botName}' - chuyên gia cố vấn AI cấp cao của cộng đồng Zalo. Trả lời đi thẳng vào trọng tâm, phân tích chuyên môn sâu sắc, logic, súc tích và chuẩn xác.`;
        break;
      case "friendly":
        personaIntro = `Bạn là '${botName}' - trợ lý AI tận tâm, chu đáo và lịch sự của cộng đồng Zalo.`;
        break;
      case "strict":
        personaIntro = `Bạn là '${botName}' - người điều hành & giám sát AI chuẩn mực, nghiêm túc của cộng đồng Zalo.`;
        break;
      case "custom":
        personaIntro = `Bạn là '${botName}' - trợ lý AI của cộng đồng Zalo.`;
        break;
      case "humorous":
      default:
        personaIntro = `Bạn là '${botName}' - trợ lý AI cực kỳ hóm hỉnh, thông minh, mặn mà và bắt trend của cộng đồng Zalo. Trả lời duyên dáng, dí dỏm, tạo không khí sôi nổi.`;
        break;
    }

    let customPromptSection = "";
    if (groupSettings.customPrompt?.trim()) {
      customPromptSection = `\n=== CHỈ THỊ RIÊNG CỦA ADMIN: ===\n${groupSettings.customPrompt.trim()}\n`;
    }

    let quoteTextSection = "";
    if (options?.quote?.text) {
      quoteTextSection = `\n=== NỘI DUNG ĐƯỢC TRÍCH DẪN (QUOTE): ===\n"${options.quote.text}"\n`;
    }

    let fileContentSnippet = "";
    if (fileTextContent) {
      fileContentSnippet = `\n=== NỘI DUNG TÀI LIỆU (${fileName || "File"}): ===\n${fileTextContent.slice(0, 40000)}\n`;
    }

    const fastSystemPrompt =
      `${personaIntro}\n${customPromptSection}\n` +
      `NHIỆM VỤ QUAN TRỌNG NHẤT:\n` +
      `1. Thành viên đang gửi trực tiếp một HÌNH ẢNH / TÀI LIỆU để nhờ bạn phân tích.\n` +
      `2. BẠN BẮT BUỘC PHẢI QUAN SÁT KỸ VÀ PHÂN TÍCH TRỰC TIẾP HÌNH ẢNH / TÀI LIỆU ĐÍNH KÈM NÀY (đọc từng chi tiết, giao diện, bảng biểu, số liệu, tính năng trong ảnh).\n` +
      `3. TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown (dùng viết hoa, gạch đầu dòng hoặc icon).\n` +
      `4. Trả lời chuẩn theo phong cách của bạn (hóm hỉnh, chuyên nghiệp, thông minh).`;

    const fastUserPrompt =
      `${quoteTextSection}${fileContentSnippet}\n` +
      `YÊU CẦU / CÂU HỎI TỪ THÀNH VIÊN (${displayName}): ${question || "Hãy phân tích chi tiết hình ảnh/tài liệu này giúp tôi."}\n\n` +
      `HÃY TRẢ LỜI NGAY:`;

    const isFastRealTimeSearch =
      /(?:tin tức|tin mới|mới nhất|hôm nay|24h qua|trên x\b|trên twitter\b|trend ai|tin ai|ai mới|vừa ra mắt|cập nhật mới|tin nóng|thời sự|bản tin|vừa công bố|ra mắt gì)/i.test(
        question
      );

    try {
      const answer = await callGemini(fastSystemPrompt, fastUserPrompt, {
        mediaParts: mediaPart ? [mediaPart] : undefined,
        enableSearch: isFastRealTimeSearch,
      });

      // Ghi nhớ vào tri thức nếu cần
      if (targetUrl) {
        saveGroupKnowledge({
          threadId,
          title: fileName || question.slice(0, 50) || "Tài liệu",
          fileName: fileName || "image_analysis",
          fileType: mediaPart?.mimeType || "image/jpeg",
          fileUrl: targetUrl,
          contentText: fileTextContent ? fileTextContent.slice(0, 5000) : question,
          summary: answer.slice(0, 2000),
          senderName: displayName,
          createdAt: Date.now(),
        });
      }
      return answer;
    } catch (e) {
      console.warn("[member-assistant] Fast-path Gemini QA error:", e);
      return `Dạ em Sen Chúa có nhận được ảnh/file của bác ${displayName} rồi nè, nhưng vừa phân tích nửa chừng thì bị nghẽn mạng một nhịp 😄! Bác gõ lại câu hỏi hoặc gửi lại để em soi kỹ lại lần nữa nhé!`;
    }
  }

  // 2. Tra cứu Kho tri thức & Bộ nhớ dài hạn (Long-term Knowledge Memory)
  let memorizedDocs: any[] = [];
  try {
    memorizedDocs = searchGroupKnowledge(threadId, question, 5);
  } catch {}

  // 2.1. Phân loại ý định câu hỏi: hỏi quy trình/kinh nghiệm/thảo luận hay chỉ xin link tải
  const isDiscussionOrProcessQuery =
    /quy trình|quy trinh|cách làm|cach lam|hướng dẫn|huong dan|kinh nghiệm|kinh nghiem|thảo luận|thao luan|bàn về|chia sẻ|chia se|bước|buoc|làm sao|lam sao|tổng hợp|nói gì|bảo gì/i.test(
      question,
    );

  const isOnlyLinkQuery =
    /(?:cho xin|gửi|xin|danh sách)\s*(?:link|đường dẫn|repo|mã nguồn|source)/i.test(question) &&
    !isDiscussionOrProcessQuery;

  const isResourceQuery =
    isOnlyLinkQuery ||
    /link|repo|github|tài liệu|tai lieu|dự án|du an|mã nguồn|source/i.test(question);

  // 2.2. Tra cứu sâu các đoạn thảo luận & hội thoại theo ngữ cảnh (Context Window 2 tin trước + 4 tin sau)
  let discussionThreads: DiscussionThreadSnippet[] = [];
  try {
    discussionThreads = searchRelevantDiscussions(threadId, question, 3);
  } catch (e) {
    console.warn("[handleHistoryQA] Lỗi searchRelevantDiscussions:", e);
  }

  // 2.3. Tra cứu sâu các đúc kết chuyên môn từ toàn bộ lịch sử daily_summaries (Hub)
  let relevantSummaries: { dayLabel: string; relevantBulletPoints: string[] }[] = [];
  try {
    relevantSummaries = searchRelevantDailySummaries(threadId, question, 4);
  } catch (e) {
    console.warn("[handleHistoryQA] Lỗi searchRelevantDailySummaries:", e);
  }

  // 2.4. Tra cứu kho link / repo / tài nguyên
  let relevantLinks: FoundResource[] = [];
  if (isResourceQuery || isDiscussionOrProcessQuery) {
    try {
      relevantLinks = searchRelevantLinksAndResources(threadId, question, 15);
    } catch (e) {
      console.warn("[handleHistoryQA] Lỗi searchRelevantLinksAndResources:", e);
    }
  }

  // 3. Lấy danh sách tin nhắn gần nhất trong nhóm để tạo ngữ cảnh hiện tại
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
         LIMIT 60`,
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
            AND LOWER(m.display_name) NOT LIKE '%mộc miên%'
            AND LOWER(m.display_name) NOT LIKE '%moc mien%'
            AND m.zalo_user_id NOT IN (
              SELECT zalo_user_id FROM leaderboard_exclusions WHERE group_id = '' OR group_id = @threadId
            )
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

  // A. Đoạn thảo luận hội thoại thực tế (Context Window)
  if (discussionThreads && discussionThreads.length > 0) {
    contextLines.push("=== CÁC ĐOẠN HỘI THOẠI & THẢO LUẬN THỰC TẾ TRONG LỊCH SỬ CHAT CỦA NHÓM ===");
    discussionThreads.forEach((thread, tIdx) => {
      contextLines.push(
        `[Cuộc thảo luận #${tIdx + 1} - Ngày ${thread.dateStr} - Người chia sẻ chính: ${thread.mainAuthor}]:\n` +
        thread.messages
          .map((m) => `  ${m.timeStr} | ${m.displayName}${m.isMain ? " (Chia sẻ cốt lõi)" : ""}: ${m.text}`)
          .join("\n")
      );
    });
  }

  // B. Đúc kết kinh nghiệm & quy trình từ daily_summaries (Hub)
  if (relevantSummaries && relevantSummaries.length > 0) {
    contextLines.push("=== ĐÚC KẾT KINH NGHIỆM & QUY TRÌNH TỪ KHO TRI THỨC NHÓM (HUB) ===");
    for (const s of relevantSummaries) {
      contextLines.push(`[Ngày ${s.dayLabel}]:\n` + s.relevantBulletPoints.map((bp) => `• ${bp}`).join("\n"));
    }
  }

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

  if (relevantLinks && relevantLinks.length > 0) {
    contextLines.push("=== KHO TÀI LIỆU & LINK LIÊN QUAN TRONG LỊCH SỬ NHÓM KHỚP VỚI CÂU HỎI ===");
    relevantLinks.forEach((l, idx) => {
      const d = new Date(l.ts + 7 * 3600 * 1000);
      const timeStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
      contextLines.push(`${idx + 1}. URL: ${l.url}\n   Người chia sẻ: ${l.sender} (${timeStr})\n   Ngữ cảnh/lời bình đi kèm: ${l.context}`);
    });
    if (isOnlyLinkQuery) {
      contextLines.push(
        "CHỈ DẪN QUAN TRỌNG: Thành viên đang yêu cầu tìm kiếm/liệt kê đường link. Bạn HÃY SỬ DỤNG TRỰC TIẾP danh sách link ở trên để tổng hợp, trình bày đẹp mắt từng link (kèm ai là người chia sẻ, ngày nào, tóm tắt nội dung/lời bình). Giữ nguyên link URL đầy đủ, tuyệt đối không bịa link ảo!"
      );
    } else {
      contextLines.push(
        "CHỈ DẪN QUAN TRỌNG: Nếu thành viên hỏi về QUY TRÌNH, CÁCH LÀM, KINH NGHIỆM hoặc NỘI DUNG THẢO LUẬN: Hãy ưu tiên TRÍCH XUẤT VÀ GIẢI THÍCH CHI TIẾT CÁC BƯỚC THỰC HIỆN từ các đoạn thảo luận/đúc kết ở trên. Sau đó đính kèm các đường link ở trên ở cuối câu trả lời làm tài liệu tham khảo/tải về bổ trợ."
      );
    }
  } else if (isResourceQuery && !isDiscussionOrProcessQuery) {
    contextLines.push(
      "=== KẾT QUẢ TÌM KIẾM LINK TRONG LỊCH SỬ NHÓM ===\nHiện tại hệ thống đã quét toàn bộ lịch sử tin nhắn và kho tri thức nhưng chưa tìm thấy link nào khớp với từ khóa của thành viên. Hãy thông báo lịch sự rằng nhóm chưa từng chia sẻ link phù hợp."
    );
  }

  if (pastSummaries && pastSummaries.length > 0) {
    contextLines.push("=== TÓM TẮT CÁC NGÀY GẦN ĐÂY ===");
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

  // 2.0. Nhận diện câu hỏi cần tra cứu thông tin thời gian thực (Google Search / X / Tin tức cập nhật)
  const isRealTimeSearchQuery =
    /(?:tin tức|tin mới|mới nhất|hôm nay|24h qua|trên x\b|trên twitter\b|trend ai|tin ai|ai mới|vừa ra mắt|cập nhật mới|tin nóng|thời sự|bản tin|vừa công bố|ra mắt gì|sự kiện mới)/i.test(
      question
    );

  let searchInstruction = "";
  if (isRealTimeSearchQuery) {
    searchInstruction =
      `\n8. TÌM KIẾM THỜI GIAN THỰC (GOOGLE SEARCH & X): Câu hỏi này liên quan đến tin tức, sự kiện hoặc thông tin thời gian thực. Bạn ĐÃ ĐƯỢC TÍCH HỢP công cụ Google Search kết nối Internet thời gian thực. Hãy ưu tiên tra cứu và tổng hợp các tin tức, bài đăng trên X/Twitter, trang công nghệ và thông cáo báo chí 24-48 giờ qua để trả lời chính xác, sắc bén và có nguồn tham khảo rõ ràng.\n`;
  }

  const systemPrompt =
    `${personaIntro}\n${customPromptSection}\n` +
    `NHIỆM VỤ CHUNG:\n` +
    `1. Nếu có FILE TÀI LIỆU (PDF, Word, Excel, Code, TXT, Âm thanh, Hình ảnh) đính kèm: ĐỌC KỸ TOÀN BỘ NỘI DUNG, trích xuất dữ liệu, dịch thuật, phân tích chuyên sâu hoặc tóm tắt đầy đủ.\n` +
    `2. Nếu người dùng hỏi về kiến thức/tài liệu cũ đã từng gửi trong nhóm: Tra cứu từ 'KHO TRI THỨC & BỘ NHỚ TÀI LIỆU ĐÃ LƯU' để trả lời chính xác.\n` +
    `3. Nếu câu hỏi yêu cầu tìm kiếm link/repo/tài nguyên: Dựa vào 'KHO TÀI LIỆU & LINK LIÊN QUAN' được cung cấp để liệt kê đầy đủ link và lời bình thực tế, tuyệt đối không tự bịa link.\n` +
    `4. Nếu có NỘI DUNG ĐƯỢC TRÍCH DẪN (QUOTE): Hiểu rằng người dùng đang hỏi hoặc bình luận về chính nội dung được trích dẫn đó.\n` +
    `5. Luôn trả lời chuẩn theo phong cách cá tính được quy định ở trên.\n` +
    `6. TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown (hãy dùng dấu gạch đầu dòng, viết hoa hoặc icon để làm nổi bật).\n` +
    `7. ĐẶC BIỆT KHI THÀNH VIÊN HỎI VỀ QUY TRÌNH, HƯỚNG DẪN, CÁCH LÀM HOẶC KINH NGHIỆM ĐÃ CHIA SẺ TRONG NHÓM: Bạn BẮT BUỘC phải TRÍCH DẪN VÀ DIỄN GIẢI CHI TIẾT TỪNG BƯỚC (Bước 1, Bước 2, Bước 3...), các công cụ (tool) và lưu ý thực chiến mà các thành viên (như bác Huy, anh Nam, Vũ Trọng...) đã từng chia sẻ trong lịch sử chat. TUYỆT ĐỐI KHÔNG ĐƯỢC chỉ đưa mỗi link tải tài liệu; phải giải thích cặn kẽ nội dung quy trình để người hỏi áp dụng được ngay, link tài liệu chỉ là phần đính kèm ở cuối để tham khảo thêm.` +
    searchInstruction;

  const userPrompt =
    `${quotePromptSection}\n${fileContentSection}\n` +
    `DƯỚI ĐÂY LÀ DỮ LIỆU LỊCH SỬ CHAT CỦA NHÓM ĐỂ THAM KHẢO:\n` +
    `<chat_history>\n${contextData}\n</chat_history>\n\n` +
    `YÊU CẦU / CÂU HỎI TỪ THÀNH VIÊN (${displayName}): ${question || "Hãy phân tích tài liệu/hình ảnh/nội dung trên giúp tôi."}\n\n` +
    (isRealTimeSearchQuery
      ? `LƯU Ý: Đây là câu hỏi về tin tức/thời gian thực. Hãy sử dụng công cụ tìm kiếm Google để cập nhật tin mới nhất trên Internet và X/Twitter.\n\n`
      : "") +
    `HÃY TRẢ LỜI THẬT DUYÊN DÁNG, CHUẨN XÁC VÀ HÓM HỈNH:`;

  try {
    const answer = await callGemini(systemPrompt, userPrompt, {
      mediaParts: mediaPart ? [mediaPart] : undefined,
      enableSearch: isRealTimeSearchQuery,
    });

    // 🧠 TỰ ĐỘNG GHI NHỚ VÀO BỘ NHỚ DÀI HẠN NẾU ĐÂY LÀ TÀI LIỆU/FILE PHÂN TÍCH
    if (targetUrl && fileName) {
      saveGroupKnowledge({
        threadId,
        title: fileName || question.slice(0, 50) || "Tài liệu",
        fileName: fileName || "file_attachment",
        fileType: "document",
        fileUrl: targetUrl,
        contentText: question,
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

function isGroupAdminOrSuperAdmin(threadId: string, userId: string): boolean {
  if (isUserAdmin(userId)) return true;
  try {
    const member = getDb()
      .prepare(`SELECT role FROM group_members WHERE group_id = ? AND zalo_user_id = ?`)
      .get(threadId, userId) as { role: string } | undefined;
    if (member && (member.role === "admin" || member.role === "owner" || member.role === "creator")) return true;
    const globalMember = getDb()
      .prepare(`SELECT role FROM members WHERE zalo_user_id = ?`)
      .get(userId) as { role: string } | undefined;
    if (globalMember && (globalMember.role === "admin" || globalMember.role === "owner")) return true;
  } catch {}
  return false;
}

function findMemberInGroup(threadId: string, query: string): { zalo_user_id: string; display_name: string } | null {
  const db = getDb();
  const q = query.trim().toLowerCase();
  try {
    const byId = db
      .prepare(`SELECT zalo_user_id, display_name FROM group_members WHERE group_id = ? AND zalo_user_id = ?`)
      .get(threadId, query.trim()) as any;
    if (byId) return byId;

    const byName = db
      .prepare(`SELECT zalo_user_id, display_name FROM group_members WHERE group_id = ? AND LOWER(display_name) LIKE ? LIMIT 1`)
      .get(threadId, `%${q}%`) as any;
    if (byName) return byName;

    const byGeneral = db
      .prepare(`SELECT zalo_user_id, display_name FROM members WHERE LOWER(display_name) LIKE ? LIMIT 1`)
      .get(`%${q}%`) as any;
    if (byGeneral) return byGeneral;
  } catch {}
  return null;
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

  // 1. TUYỆT ĐỐI BỎ QUA các tin nhắn do chính Bot sinh ra (Chống Bot-to-Bot Loop & Self-Reply):
  // Tất cả tin nhắn do bot gửi ra đều có icon 🤖 hoặc các tiền tố/mẫu định dạng bên dưới.
  if (
    rawText.startsWith("🤖") ||
    rawText.startsWith("⏰") ||
    rawText.startsWith("🌸") ||
    rawText.startsWith("🌅") ||
    rawText.startsWith("↪") ||
    rawText.startsWith("📊") ||
    rawText.startsWith("🏆") ||
    rawText.startsWith("📋") ||
    rawText.startsWith("🙈") ||
    rawText.startsWith("⛔") ||
    rawText.startsWith("ℹ️") ||
    rawText.startsWith("✅") ||
    rawText.startsWith("⚠️") ||
    rawText.includes("Sen Chúa trả lời") ||
    rawText.includes("Mộc Miên trả lời") ||
    rawText.includes("trả lời @") ||
    rawText.includes("[BÁO THỨC") ||
    rawText.includes("LỊCH HẸN THÀNH CÔNG") ||
    rawText.includes("[Mã #")
  ) {
    return;
  }

  // 2. Nếu là tin nhắn từ chính tài khoản bot (isSelf):
  // Chỉ bỏ qua nếu là tin nhắn chat vu vơ không có ý định gọi bot.
  // Nếu chủ bot gõ lệnh (/, !) HOẶC gọi đích danh bot ("sen chúa", "mộc miên", "bot", tag, quote, file, ảnh):
  // Cho phép bot xử lý và phản hồi bình thường!
  if (event.isSelf) {
    const lowerSelf = rawText.toLowerCase();
    const isExplicitIntent =
      rawText.startsWith("/") ||
      rawText.startsWith("!") ||
      rawText.startsWith("@") ||
      hasImage ||
      hasFile ||
      hasQuote ||
      lowerSelf.includes("sen chúa") ||
      lowerSelf.includes("sen chua") ||
      lowerSelf.includes("mộc miên") ||
      lowerSelf.includes("moc mien") ||
      lowerSelf.startsWith("sen") ||
      lowerSelf.startsWith("bot");
    if (!isExplicitIntent) return;
  }

  const sender = event.sender;
  const displayName = event.displayName || "Bạn";
  const threadId = event.threadId;

  // ⛔ KIỂM TRA THÀNH VIÊN BỊ CHẶN BOT TRẢ LỜI:
  // Nếu thành viên này nằm trong danh sách đen bị chặn -> Bot TUYỆT ĐỐI IM LẶNG 100%, không tương tác (kể cả tag bot hay lệnh /hoi).
  if (isMemberBlocked(sender, threadId)) {
    console.log(`[member-assistant] ⛔ Thành viên ${displayName} (${sender}) đang bị chặn bot trả lời trong nhóm [${threadId}]. Bỏ qua.`);
    return;
  }

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

  // 6. Lệnh /thoitiet [Địa điểm]
  if (lower.startsWith("/thoitiet") || lower.startsWith("!thoitiet")) {
    userCooldowns.set(sender, now);
    const groupSettings = getGroupSettings(threadId);
    const cityInput = rawText.replace(/^\/(?:thoitiet|!thoitiet)\s*/i, "").trim() || groupSettings.weatherCity || "Hồ Chí Minh";
    const weatherMsg = await getWeatherReport(cityInput);
    await sendGroupText(api, threadId, weatherMsg);
    console.log(`[member-assistant] ✅ Đã phản hồi /thoitiet (${cityInput}) cho ${displayName}`);
    return;
  }

  // 6.1. Lệnh /tintuc, /bantin (Điểm tin tức AI và công nghệ mới nhất trên Google & X)
  if (
    lower === "/tintuc" ||
    lower === "!tintuc" ||
    lower === "/bantin" ||
    lower === "!bantin" ||
    lower.startsWith("/tintuc ") ||
    lower.startsWith("!tintuc ") ||
    lower.startsWith("/bantin ") ||
    lower.startsWith("!bantin ")
  ) {
    userCooldowns.set(sender, now);
    const groupSettings = getGroupSettings(threadId);
    const botName = groupSettings.botName || "Sen Chúa";
    const customTopic = rawText.replace(/^\/(?:tintuc|!tintuc|bantin|!bantin)\s*/i, "").trim();
    const topic = customTopic || groupSettings.newsTopic || "Trí tuệ nhân tạo (AI), công nghệ mới, mô hình AI mới trên X/Twitter";

    await sendGroupText(api, threadId, `🔍 Đang tra cứu và tổng hợp bản tin về "${topic}" trên Google & X... Bác chờ em xíu nhé!`);

    try {
      const newsBriefing = await getDailyAiNewsBriefing(topic, botName);
      await sendGroupText(api, threadId, newsBriefing);
      console.log(`[member-assistant] ✅ Đã phản hồi /tintuc (${topic}) cho ${displayName}`);
    } catch (err: any) {
      console.error(`[member-assistant] ❌ Lỗi tra cứu bản tin:`, err);
      await sendGroupText(api, threadId, `⚠️ Không thể lấy bản tin lúc này. Vui lòng thử lại sau ít phút.`);
    }
    return;
  }

  // 7. Lệnh /nhacnho, /hengio [thời gian] [nội dung]
  if (lower.startsWith("/nhacnho ") || lower.startsWith("!nhacnho ") || lower.startsWith("/hengio ") || lower.startsWith("!hengio ")) {
    userCooldowns.set(sender, now);
    const args = rawText.replace(/^\/(?:nhacnho|!nhacnho|hengio|!hengio)\s+/i, "").trim();
    const reply = handleSetReminder(threadId, false, sender, displayName, args);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã lưu lịch hẹn cho ${displayName}`);
    return;
  }

  // 8. Lệnh /dsnhac, /lichnhac
  if (lower === "/dsnhac" || lower === "!dsnhac" || lower === "/lichnhac" || lower === "dsnhac") {
    userCooldowns.set(sender, now);
    const reply = handleListReminders(sender);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã gửi dsnhac cho ${displayName}`);
    return;
  }

  // 9. Lệnh /huynhac [ID]
  if (lower.startsWith("/huynhac ") || lower.startsWith("!huynhac ")) {
    userCooldowns.set(sender, now);
    const idStr = rawText.replace(/^\/(?:huynhac|!huynhac)\s+/i, "").trim();
    const reply = handleCancelReminder(sender, idStr);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã hủy lịch hẹn cho ${displayName}`);
    return;
  }

  // 9.1. Lệnh Quản trị viên: /chanbot [quote hoặc tên/ID]
  // 9.1. Lệnh Quản trị viên: /chanbot [quote hoặc tên/ID]
  const strippedCmd = rawText.replace(/^@[^\s]+\s*/, "").trim();
  const strippedLower = strippedCmd.toLowerCase();
  const isChanBot =
    lower.startsWith("/chanbot") ||
    lower.startsWith("!chanbot") ||
    strippedLower.startsWith("/chanbot") ||
    strippedLower.startsWith("!chanbot") ||
    lower.includes("/chanbot");

  if (isChanBot) {
    userCooldowns.set(sender, now);
    const isGroupAdmin = isGroupAdminOrSuperAdmin(threadId, sender);
    if (!isGroupAdmin) {
      await sendGroupText(api, threadId, `⛔ Bạn không có quyền sử dụng lệnh này (Chỉ Quản trị viên / Trưởng nhóm mới có quyền chặn bot trả lời).`);
      return;
    }

    let targetUserId = event.quote?.senderId?.trim() || "";
    let targetName = event.quote?.senderName?.trim() || "";

    // Nếu không có quote senderId, kiểm tra nếu có tag mention trong payload
    if (!targetUserId && event.mentions && event.mentions.length > 0) {
      const firstMention = event.mentions[0];
      if (firstMention?.uid) {
        targetUserId = String(firstMention.uid);
      }
    }

    // Tham số sau /chanbot
    let param = rawText.replace(/^\/(?:chanbot|!chanbot)\s*/i, "").trim();
    if (!param && strippedCmd) {
      param = strippedCmd.replace(/^\/(?:chanbot|!chanbot)\s*/i, "").trim();
    }
    // Nếu trong rawText có @Tên (ví dụ "@Kevin /chanbot" hoặc "/chanbot @Kevin")
    const tagMatch = rawText.match(/@([^\s/!]+)/);
    if (!param && tagMatch && tagMatch[1]) {
      param = tagMatch[1].trim();
    }

    if (!targetUserId && param) {
      const cleanParam = param.replace(/^@/, "").trim();
      const found = findMemberInGroup(threadId, cleanParam);
      if (found) {
        targetUserId = found.zalo_user_id;
        targetName = found.display_name;
      } else if (/^\d+$/.test(cleanParam)) {
        targetUserId = cleanParam;
        targetName = cleanParam;
      }
    }

    if (!targetUserId) {
      await sendGroupText(
        api,
        threadId,
        `⚠️ HƯỚNG DẪN CHẶN BOT TRẢ LỜI:\n\n` +
        `🔹 Cách 1: Reply (Quote) tin nhắn của thành viên muốn chặn rồi gõ: /chanbot\n` +
        `🔹 Cách 2: Gõ /chanbot @Tên_thành_viên hoặc /chanbot [User_ID]`
      );
      return;
    }

    blockMember({
      zaloUserId: targetUserId,
      groupId: threadId,
      displayName: targetName || targetUserId,
      blockedBy: displayName,
      reason: "Admin chặn qua lệnh /chanbot",
    });

    await sendGroupText(
      api,
      threadId,
      `⛔ ĐÃ CHẶN TƯƠNG TÁC THÀNH CÔNG!\n\n` +
      `👤 Thành viên: ${targetName || targetUserId}\n` +
      `📌 Từ bây giờ, bot sẽ hoàn toàn im lặng và KHÔNG trả lời bất kỳ tin nhắn, câu hỏi, tag tên hay lệnh nào từ thành viên này.`
    );
    return;
  }

  // 9.2. Lệnh Quản trị viên: /bochanbot [quote hoặc tên/ID]
  const isBoChanBot =
    lower.startsWith("/bochanbot") ||
    lower.startsWith("!bochanbot") ||
    lower.startsWith("/gohanbot") ||
    lower.startsWith("/mochanbot") ||
    strippedLower.startsWith("/bochanbot") ||
    strippedLower.startsWith("!bochanbot") ||
    strippedLower.startsWith("/gohanbot") ||
    strippedLower.startsWith("/mochanbot") ||
    lower.includes("/bochanbot") ||
    lower.includes("/gohanbot") ||
    lower.includes("/mochanbot");

  if (isBoChanBot) {
    userCooldowns.set(sender, now);
    const isGroupAdmin = isGroupAdminOrSuperAdmin(threadId, sender);
    if (!isGroupAdmin) {
      await sendGroupText(api, threadId, `⛔ Bạn không có quyền sử dụng lệnh này.`);
      return;
    }

    let targetUserId = event.quote?.senderId?.trim() || "";
    let targetName = event.quote?.senderName?.trim() || "";

    if (!targetUserId && event.mentions && event.mentions.length > 0) {
      const firstMention = event.mentions[0];
      if (firstMention?.uid) {
        targetUserId = String(firstMention.uid);
      }
    }

    let param = rawText.replace(/^\/(?:bochanbot|!bochanbot|gohanbot|mochanbot)\s*/i, "").trim();
    if (!param && strippedCmd) {
      param = strippedCmd.replace(/^\/(?:bochanbot|!bochanbot|gohanbot|mochanbot)\s*/i, "").trim();
    }
    const tagMatch = rawText.match(/@([^\s/!]+)/);
    if (!param && tagMatch && tagMatch[1]) {
      param = tagMatch[1].trim();
    }

    if (!targetUserId && param) {
      const cleanParam = param.replace(/^@/, "").trim();
      const found = findMemberInGroup(threadId, cleanParam);
      if (found) {
        targetUserId = found.zalo_user_id;
        targetName = found.display_name;
      } else if (/^\d+$/.test(cleanParam)) {
        targetUserId = cleanParam;
        targetName = cleanParam;
      }
    }

    if (!targetUserId) {
      await sendGroupText(
        api,
        threadId,
        `⚠️ HƯỚNG DẪN BỎ CHẶN:\n\n` +
        `🔹 Cách 1: Reply (Quote) tin nhắn của người cần bỏ chặn rồi gõ: /bochanbot\n` +
        `🔹 Cách 2: Gõ /bochanbot @Tên_thành_viên hoặc /bochanbot [User_ID]`
      );
      return;
    }

    const ok = unblockMember(targetUserId, threadId);
    if (ok) {
      await sendGroupText(
        api,
        threadId,
        `✅ ĐÃ BỎ CHẶN THÀNH CÔNG!\n\n👤 Thành viên: ${targetName || targetUserId} giờ đây đã có thể trò chuyện và hỏi bot bình thường.`
      );
    } else {
      await sendGroupText(api, threadId, `ℹ️ Thành viên này hiện không nằm trong danh sách chặn.`);
    }
    return;
  }

  // 9.3. Lệnh Quản trị viên: /dschan (Xem danh sách đang bị chặn)
  if (lower === "/dschan" || lower === "!dschan" || lower === "/dschanbot" || lower === "!dschanbot") {
    userCooldowns.set(sender, now);
    const list = listBlockedMembers(threadId);
    if (list.length === 0) {
      await sendGroupText(api, threadId, `📋 DANH SÁCH CHẶN BOT TRẢ LỜI\n\nHiện không có thành viên nào bị chặn tương tác trong nhóm này.`);
      return;
    }
    const lines = list.map((m, idx) => {
      const d = new Date(m.createdAt + 7 * 3600 * 1000);
      const dateStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      return `${idx + 1}. 👤 ${m.displayName || m.zaloUserId} (ID: ${m.zaloUserId})\n   🕒 Chặn lúc: ${dateStr} bởi ${m.blockedBy}`;
    });
    await sendGroupText(
      api,
      threadId,
      `📋 DANH SÁCH THÀNH VIÊN BỊ CHẶN TRẢ LỜI (${list.length} người):\n\n${lines.join("\n\n")}\n\n💡 Mẹo: Gõ /bochanbot [ID hoặc quote] để mở lại quyền tương tác.`
    );
    return;
  }

  // 9.4. Lệnh Quản trị viên: /anrank, /goxephang [quote hoặc tên/ID]
  const isAnRank =
    lower.startsWith("/anrank") ||
    lower.startsWith("!anrank") ||
    lower.startsWith("/goxephang") ||
    lower.startsWith("!goxephang") ||
    strippedLower.startsWith("/anrank") ||
    strippedLower.startsWith("!anrank") ||
    strippedLower.startsWith("/goxephang") ||
    strippedLower.startsWith("!goxephang") ||
    lower.includes("/anrank") ||
    lower.includes("/goxephang");

  if (isAnRank) {
    userCooldowns.set(sender, now);
    const isGroupAdmin = isGroupAdminOrSuperAdmin(threadId, sender);
    if (!isGroupAdmin) {
      await sendGroupText(api, threadId, `⛔ Bạn không có quyền sử dụng lệnh này (Chỉ Quản trị viên / Trưởng nhóm mới có quyền ẩn thành viên khỏi BXH).`);
      return;
    }

    let targetUserId = event.quote?.senderId?.trim() || "";
    let targetName = event.quote?.senderName?.trim() || "";

    if (!targetUserId && event.mentions && event.mentions.length > 0) {
      const firstMention = event.mentions[0];
      if (firstMention?.uid) {
        targetUserId = String(firstMention.uid);
      }
    }

    let param = rawText.replace(/^\/(?:anrank|!anrank|goxephang|!goxephang)\s*/i, "").trim();
    if (!param && strippedCmd) {
      param = strippedCmd.replace(/^\/(?:anrank|!anrank|goxephang|!goxephang)\s*/i, "").trim();
    }
    const tagMatch = rawText.match(/@([^\s/!]+)/);
    if (!param && tagMatch && tagMatch[1]) {
      param = tagMatch[1].trim();
    }

    if (!targetUserId && param) {
      const cleanParam = param.replace(/^@/, "").trim();
      const found = findMemberInGroup(threadId, cleanParam);
      if (found) {
        targetUserId = found.zalo_user_id;
        targetName = found.display_name;
      } else if (/^\d+$/.test(cleanParam)) {
        targetUserId = cleanParam;
        targetName = cleanParam;
      }
    }

    if (!targetUserId) {
      await sendGroupText(
        api,
        threadId,
        `⚠️ HƯỚNG DẪN ẨN THÀNH VIÊN KHỎI BẢNG XẾP HẠNG:\n\n` +
        `🔹 Cách 1: Reply (Quote) tin nhắn của người cần ẩn rồi gõ: /anrank\n` +
        `🔹 Cách 2: Gõ /anrank @Tên_thành_viên hoặc /anrank [User_ID]`
      );
      return;
    }

    hideMemberFromLeaderboard({
      zaloUserId: targetUserId,
      groupId: threadId,
      displayName: targetName || targetUserId,
      hiddenBy: displayName,
      reason: "Admin ẩn khỏi bảng xếp hạng",
    });

    await sendGroupText(
      api,
      threadId,
      `🙈 ĐÃ ẨN KHỎI BẢNG XẾP HẠNG THÀNH CÔNG!\n\n` +
      `👤 Thành viên: ${targetName || targetUserId}\n` +
      `📌 Thành viên này sẽ không còn xuất hiện trong /top, bảng xếp hạng Web và các bản vinh danh tóm tắt ngày để nhường sân chơi cho các anh em khác.`
    );
    return;
  }

  // 9.5. Lệnh Quản trị viên: /hienrank, /moxephang [quote hoặc tên/ID]
  const isHienRank =
    lower.startsWith("/hienrank") ||
    lower.startsWith("!hienrank") ||
    lower.startsWith("/moxephang") ||
    lower.startsWith("!moxephang") ||
    strippedLower.startsWith("/hienrank") ||
    strippedLower.startsWith("!hienrank") ||
    strippedLower.startsWith("/moxephang") ||
    strippedLower.startsWith("!moxephang") ||
    lower.includes("/hienrank") ||
    lower.includes("/moxephang");

  if (isHienRank) {
    userCooldowns.set(sender, now);
    const isGroupAdmin = isGroupAdminOrSuperAdmin(threadId, sender);
    if (!isGroupAdmin) {
      await sendGroupText(api, threadId, `⛔ Bạn không có quyền sử dụng lệnh này.`);
      return;
    }

    let targetUserId = event.quote?.senderId?.trim() || "";
    let targetName = event.quote?.senderName?.trim() || "";

    if (!targetUserId && event.mentions && event.mentions.length > 0) {
      const firstMention = event.mentions[0];
      if (firstMention?.uid) {
        targetUserId = String(firstMention.uid);
      }
    }

    let param = rawText.replace(/^\/(?:hienrank|!hienrank|moxephang|!moxephang)\s*/i, "").trim();
    if (!param && strippedCmd) {
      param = strippedCmd.replace(/^\/(?:hienrank|!hienrank|moxephang|!moxephang)\s*/i, "").trim();
    }
    const tagMatch = rawText.match(/@([^\s/!]+)/);
    if (!param && tagMatch && tagMatch[1]) {
      param = tagMatch[1].trim();
    }

    if (!targetUserId && param) {
      const cleanParam = param.replace(/^@/, "").trim();
      const found = findMemberInGroup(threadId, cleanParam);
      if (found) {
        targetUserId = found.zalo_user_id;
        targetName = found.display_name;
      } else if (/^\d+$/.test(cleanParam)) {
        targetUserId = cleanParam;
        targetName = cleanParam;
      }
    }

    if (!targetUserId) {
      await sendGroupText(
        api,
        threadId,
        `⚠️ HƯỚNG DẪN HIỆN LẠI BẢNG XẾP HẠNG:\n\n` +
        `🔹 Cách 1: Reply (Quote) tin nhắn của người cần hiện lại rồi gõ: /hienrank\n` +
        `🔹 Cách 2: Gõ /hienrank @Tên_thành_viên hoặc /hienrank [User_ID]`
      );
      return;
    }

    const ok = unhideMemberFromLeaderboard(targetUserId, threadId);
    if (ok) {
      await sendGroupText(
        api,
        threadId,
        `✅ ĐÃ HIỆN LẠI BẢNG XẾP HẠNG THÀNH CÔNG!\n\n👤 Thành viên: ${targetName || targetUserId} giờ đây sẽ được tính điểm và xếp hạng bình thường trên BXH.`
      );
    } else {
      await sendGroupText(api, threadId, `ℹ️ Thành viên này hiện không nằm trong danh sách ẩn.`);
    }
    return;
  }

  // 9.6. Lệnh Quản trị viên: /dsanrank (Xem danh sách đang bị ẩn)
  if (lower === "/dsanrank" || lower === "!dsanrank" || lower === "/dsan" || lower === "!dsan") {
    userCooldowns.set(sender, now);
    const list = listLeaderboardExclusions(threadId);
    if (list.length === 0) {
      await sendGroupText(api, threadId, `📋 DANH SÁCH ẨN KHỎI BẢNG XẾP HẠNG\n\nHiện không có thành viên nào bị ẩn khỏi BXH trong nhóm này.`);
      return;
    }
    const lines = list.map((m, idx) => {
      const d = new Date(m.createdAt + 7 * 3600 * 1000);
      const dateStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      return `${idx + 1}. 👤 ${m.displayName || m.zaloUserId} (ID: ${m.zaloUserId})\n   🕒 Ẩn lúc: ${dateStr} bởi ${m.hiddenBy}`;
    });
    await sendGroupText(
      api,
      threadId,
      `📋 DANH SÁCH THÀNH VIÊN BỊ ẨN KHỎI BXH (${list.length} người):\n\n${lines.join("\n\n")}\n\n💡 Mẹo: Gõ /hienrank [ID hoặc quote] để đưa họ trở lại bảng xếp hạng.`
    );
    return;
  }

  // 10. Lệnh /hoi [câu hỏi], Tag bot, Nhắc tên Sen Chúa, Chào hỏi, Lệnh đọc file/ảnh
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

    // Tự động nhận diện câu nhắc lịch tự nhiên (ví dụ: "@Sen Chúa 16h45 nhắc cả nhóm...", "@Sen Chúa nhắc tôi 20 phút nữa...")
    const hasExplicitReminderWord =
      qLower.includes("nhắc") ||
      qLower.includes("nhac") ||
      qLower.includes("hẹn") ||
      qLower.includes("hen") ||
      qLower.includes("báo thức") ||
      qLower.includes("bao thuc") ||
      qLower.includes("đặt lịch") ||
      qLower.includes("dat lich") ||
      qLower.includes("remind") ||
      qLower.includes("alarm");

    // Loại trừ các câu nhờ vả / xin thời gian / hỏi đáp tư vấn (ví dụ: "cho anh 5 phút tư vấn...")
    const isConsultationOrQuestion =
      /(?:cho|xin|dành|danh|mất|mat|tốn|ton|đợi|doi|chờ|cho)\s+(?:anh|em|tôi|tao|mình|minh|bác|bac|chú|chu)?\s*\d+\s*(?:phút|phut|p|tiếng|tieng|h|giờ|gio)/i.test(
        question,
      ) ||
      /(?:tư vấn|tu van|hỏi|hoi|giải thích|giai thich|phân tích|phan tich|hướng dẫn|huong dan|tóm tắt|tom tat|xem hộ|xem ho)/i.test(
        question,
      );

    const isReminderIntent =
      !isConsultationOrQuestion &&
      (hasExplicitReminderWord ||
        /(?:^\d+\s*(?:phút|phut|p|tiếng|tieng|giờ|gio)\s*(?:nữa|sau)|(?:mai|hôm nay)\s*\d{1,2}[:h]\d{2}|\b\d{1,2}[:h]\d{2}\s*(?:mai|hôm nay))/i.test(
          question,
        ));

    if (isReminderIntent) {
      const parsed = parseNaturalTimeVietnam(question);
      if (parsed) {
        const reply = handleSetReminder(threadId, false, sender, displayName, question);
        await sendGroupText(api, threadId, reply);
        console.log(`[member-assistant] ✅ Đã lưu nhắc lịch tự nhiên cho ${displayName}`);
        return;
      }
    }

    // Tự động nhận diện câu hỏi thời tiết tự nhiên (ví dụ: "@Sen Chúa thời tiết TP.HCM hôm nay thế nào")
    if (/(?:thời tiết|thoi tiet|dự báo thời tiết|du bao thoi tiet)/i.test(question) && !hasFile && !hasImage) {
      const groupSettings = getGroupSettings(threadId);
      const cityMatch = question.match(/(?:tại|ở|khu vực|tỉnh|thành phố)\s+([A-ZÀ-Ỹa-zà-ỹ\s]+)/i);
      const candidateCity = cityMatch?.[1]?.trim() || groupSettings.weatherCity || "Hồ Chí Minh";
      const weatherMsg = await getWeatherReport(candidateCity);
      await sendGroupText(api, threadId, weatherMsg);
      console.log(`[member-assistant] ✅ Đã phản hồi thời tiết tự nhiên (${candidateCity}) cho ${displayName}`);
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
      let targetImageUrl = event.mediaUrl || event.quote?.mediaUrl || undefined;

      // 1. Nếu có quote mà chưa có targetImageUrl: thử tra cứu theo msgId / cliMsgId của quote
      if (!targetImageUrl && event.quote) {
        const quoteId = event.quote.msgId || event.quote.cliMsgId || event.quote.globalMsgId;
        if (quoteId) {
          const media = getMediaByMessageId(threadId, quoteId);
          if (media) {
            targetImageUrl = media.local_path || media.media_url || undefined;
            console.log(`[member-assistant] 📸 Đã tìm thấy ảnh từ tin nhắn được trích dẫn (${quoteId})`);
          }
        }
      }

      // 2. Nếu vẫn chưa có targetImageUrl và câu hỏi có ý định xem/phân tích ảnh
      const isImageAnalysisIntent =
        event.quote?.mediaType === "image" ||
        /(?:phân tích|xem|đọc|giải thích|soi|kiểm tra|review)\s+(?:cái\s+|bức\s+|tấm\s+|tệp\s+|file\s+)?(?:ảnh|hình|tool|giao diện|screenshot)/i.test(question) ||
        /(?:ảnh này|hình này|bức ảnh|tấm ảnh|tool này|giao diện này)/i.test(question);

      if (!targetImageUrl && isImageAnalysisIntent) {
        const recentImg = getRecentGroupImage(threadId, 10 * 60 * 1000);
        if (recentImg) {
          targetImageUrl = recentImg.local_path || recentImg.media_url || undefined;
          console.log(`[member-assistant] 📸 Đã tự động bắt ảnh gần nhất trong nhóm (${recentImg.message_id}) để phân tích`);
        }
      }

      const answer = await handleHistoryQA(question, displayName, threadId, {
        imageUrl: targetImageUrl,
        fileAttachment: event.fileAttachment,
        quote: event.quote,
      });
      const groupSettings = getGroupSettings(threadId);
      const botName = groupSettings.botName || "Sen Chúa";
      const reply = `🤖 ${botName} trả lời @${displayName}:\n\n${answer}`;
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



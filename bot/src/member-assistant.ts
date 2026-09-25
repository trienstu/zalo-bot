import {
  getDb,
  saveGroupKnowledge,
  searchGroupKnowledge,
  searchPermanentKnowledge,
  type PermanentKnowledgeItem,
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
  getUserMemories,
  stitchMultiChunkQuote,
} from "./db/index.js";
import { sendGroupText, sendGroupFile, sendGroupVoice, sendReaction, sendTyping, Reactions, sleep, cleanZaloText } from "./zalo/client.js";
import { formatAndChunkZaloMarkdown, pickSmartReaction } from "./zalo-formatter.js";
import {
  callGemini,
  callGeminiAgentLoop,
  downloadFileContent,
  executeAgentTool,
  type GeminiMediaPart,
} from "./gemini.js";
import { getWeatherReport } from "./weather.js";
import { getDailyAiNewsBriefing } from "./ai-news.js";
import { handleSetReminder, handleListReminders, handleCancelReminder } from "./reminder.js";
import { searchRealtimeNews } from "./realtime-search.js";
import { refreshDynamicKnowledgeIfExpired, fetchGoogleContent, parseGoogleUrl } from "./google-sync.js";
import { getSystemTemporalPrompt } from "./temporal.js";
import { planSearchQueries, type QueryPlanResult } from "./query-planner.js";
import fs from "node:fs";
import { config, defaultBotName } from "./config.js";
import { finalizeGroundedAnswer } from "./search-evidence.js";
import { answerWithHybridRouting } from "./hybrid-agent.js";
import { normalizeExecutionSignals, selectResponseMode } from "./hybrid-routing.js";
import { generateCloudflareImage, isCloudflareConfigured } from "./cloudflare-ai.js";
import { generateCodexImage, isCodexImageConfigured, prepareImageDataUrl } from "./codex-image.js";
import { collectCandidateUrls } from "./message-extract.js";
import { isRealEstateProjectProfileQuery } from "./real-estate-profile.js";
import { canUseGrounding, formatGroundingQuotaReport, resetGroundingQuota } from "./grounding-quota.js";
import { githubSearch } from "./tools/vertical-tools.js";
import { checkIsFileOrVoiceGeneration, checkIsVoiceRequest } from "./tools/file-generator.js";
import { interceptAndExecuteSimulatedTool, extractSpeechFallbackText } from "./tools/simulated-tool-interceptor.js";
import { cleanOutdatedVoicePromisesFromAnswer, cleanCoreSpeechText } from "./tools/voice-generator.js";
import {
  isMemoryControlCommand,
  handleMemoryControlCommand,
  extractAndSaveUserMemories,
  formatUserMemoriesForPrompt,
} from "./user-memory.js";
import {
  processGithubReposInMessage,
  extractGithubRepoUrls,
} from "./github-enricher.js";

export { checkIsFileOrVoiceGeneration };

export interface MemberMessageEvent {
  threadId: string;
  sender: string;
  displayName: string;
  text: string;
  isSelf?: boolean;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mentions?: { uid: string; pos?: number; len?: number }[];
  msgId?: string;
  cliMsgId?: string;
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
    fileAttachment?: {
      name: string;
      url: string;
      size?: number;
      extension?: string;
    } | null;
  } | null;
  rawMessage?: any;
}

// User cooldown map to prevent spamming: userId -> lastResponseTimestamp
const userCooldowns = new Map<string, number>();
const COOLDOWN_MS = 500; // 0.5s cooldown to allow smooth conversation

import { isStrictVerificationQuestion } from "./search-evidence.js";
export { isStrictVerificationQuestion };

/**
 * Xây dựng object Quote tương thích chuẩn Zalo zca-js để hiển thị khung trích dẫn tin nhắn gốc.
 */
function buildQuoteObject(event: MemberMessageEvent): any | undefined {
  const raw = event.rawMessage || {};
  const msgId = String(event.msgId || raw.msgId || "").trim();
  const cliMsgId = String(event.cliMsgId || raw.cliMsgId || "").trim();
  const uidFrom = String(event.sender || raw.uidFrom || "").trim();

  if (!msgId && !cliMsgId) return undefined;

  let contentText = (event.text || "").trim();
  if (!contentText && typeof raw.content === "string") {
    contentText = raw.content.trim();
  } else if (!contentText && raw.content && typeof raw.content === "object" && typeof raw.content.msg === "string") {
    contentText = raw.content.msg.trim();
  }
  if (!contentText && event.fileAttachment?.name) {
    contentText = `[Tệp: ${event.fileAttachment.name}]`;
  }
  if (!contentText && event.mediaUrl) {
    contentText = event.mediaType === "video" ? "[Video]" : "[Hình ảnh]";
  }

  return {
    msgId: msgId || cliMsgId,
    cliMsgId: cliMsgId || msgId,
    uidFrom: uidFrom,
    msgType: "chat.message",
    content: contentText || "...",
    propertyExt: raw.propertyExt || {},
    ts: raw.ts || Date.now(),
    ttl: raw.ttl || 0,
  };
}

/**
 * Gửi tin nhắn trả lời trong nhóm:
 * - Tự động bóc tách và chuyển đổi Markdown sang Rich Text (in đậm, màu sắc, bullet) native cho Zalo.
 * - Tự động chia đoạn thông minh nếu văn bản dài (>2000 ký tự hoặc >40 styles).
 * - Gắn @Mention thật cho tin nhắn đầu tiên, kèm Quote và Jitter Delay mô phỏng người thật gõ phím.
 */
async function sendGroupReplyWithMention(
  api: any,
  threadId: string,
  _botName: string,
  displayName: string,
  sender: string,
  content: string,
  options?: { jitter?: boolean; quote?: any },
): Promise<void> {
  const sanitizedContent = content
    .replace(/^(?:🤖\s*)?(?:[^\n]*?)(?:trả lời|tra loi)\s*@[^\n:]*:\s*/gi, "")
    .trim();

  // Bóc tách & chuyển đổi Markdown sang định dạng Rich Text Zalo native
  const chunks = formatAndChunkZaloMarkdown(sanitizedContent);
  if (chunks.length === 0) {
    chunks.push({ msg: sanitizedContent, styles: [] });
  }

  const mentionTag = `@${displayName}`;
  const shouldMention = Boolean(sender && displayName);

  let mentions: { uid: string; pos: number; len: number }[] | undefined = undefined;
  const firstChunk = chunks[0]!;

  if (shouldMention) {
    if (!firstChunk.msg.startsWith(mentionTag)) {
      const prefix = `${mentionTag} `;
      const offset = prefix.length;
      firstChunk.msg = `${prefix}${firstChunk.msg}`;
      firstChunk.styles = firstChunk.styles.map((s) => ({
        ...s,
        start: s.start + offset,
      }));
    }
    mentions = [
      {
        uid: String(sender).trim(),
        pos: 0,
        len: mentionTag.length,
      },
    ];
  }

  // Bỏ hoàn toàn Jitter delay để gửi tin phản hồi tức thì, không làm mất thời gian người dùng
  // Gửi phần đầu tiên kèm @mention, quote và styles (với cơ chế tự phục hồi đa tầng chống kẹt tin nhắn)
  try {
    await sendGroupText(api, threadId, firstChunk.msg, {
      mentions,
      quote: options?.quote,
      styles: firstChunk.styles,
    });
  } catch (err) {
    console.warn("[sendGroupReplyWithMention] Gửi kèm quote/styles lỗi, thử gửi kèm mentions:", err);
    try {
      await sendGroupText(api, threadId, firstChunk.msg, { mentions });
    } catch (err2) {
      console.warn("[sendGroupReplyWithMention] Gửi kèm mentions cũng lỗi, fallback gửi text thuần:", err2);
      await sendGroupText(api, threadId, cleanZaloText(firstChunk.msg));
    }
  }

  // Gửi các phần tiếp theo nếu nội dung phân tích dài (mỗi phần mang styles độc lập)
  for (let i = 1; i < chunks.length; i++) {
    const nextChunk = chunks[i]!;
    await sleep(200);
    try {
      await sendGroupText(api, threadId, nextChunk.msg, {
        styles: nextChunk.styles,
      });
    } catch {
      await sendGroupText(api, threadId, cleanZaloText(nextChunk.msg)).catch(() => { });
    }
  }
}

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
  let groupFilter = "m.group_id = @threadId";
  try {
    const hasGroupMembers = db.prepare(`SELECT 1 FROM group_members WHERE group_id = ? AND is_active = 1 LIMIT 1`).get(threadId);
    if (hasGroupMembers) {
      fromTable = "group_members";
      groupFilter = "m.group_id = @threadId";
    }
  } catch { }

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
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id AND i.thread_id = @threadId
       WHERE ${groupFilter}
         AND m.is_active = 1
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
  let groupFilter = "m.group_id = @threadId";
  try {
    const hasGroupMembers = db.prepare(`SELECT 1 FROM group_members WHERE group_id = ? AND is_active = 1 LIMIT 1`).get(threadId);
    if (hasGroupMembers) {
      fromTable = "group_members";
      groupFilter = "m.group_id = @threadId";
    }
  } catch { }

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
       JOIN interactions i ON i.zalo_user_id = m.zalo_user_id AND i.thread_id = @threadId
       WHERE ${groupFilter}
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
  threadId?: string,
  query: string = "",
  limit = 20,
): FoundResource[] {
  if (!threadId) return [];
  const db = getDb();
  const allLinks: FoundResource[] = [];
  const urlRegex = /(https?:\/\/[^\s]+)/gi;

  // 1. Quét lịch sử tin nhắn chứa link của riêng nhóm này
  try {
    const rows = db
      .prepare(
        `SELECT id, display_name, text, ts
         FROM group_messages
         WHERE deleted_at IS NULL
           AND thread_id = ?
           AND (text LIKE '%http://%' OR text LIKE '%https://%')
         ORDER BY ts DESC
         LIMIT 500`,
      )
      .all(threadId) as { id: number; display_name: string; text: string; ts: number }[];

    for (const r of rows) {
      const matches = r.text.match(urlRegex);
      if (!matches) continue;
      for (const u of matches) {
        const cleanUrl = u.replace(/[.,;!?)]+$/, "");
        if (allLinks.some((l) => l.url === cleanUrl)) continue;
        let cleanContext = r.text.replace(urlRegex, "").replace(/\s+/g, " ").trim();

        // Nếu context của tin nhắn chứa link quá ngắn (< 15 ký tự), lấy thêm 1 tin nhắn văn bản liền trước đó để làm giàu ngữ cảnh
        if (cleanContext.length < 15) {
          try {
            const prevMsg = db
              .prepare(
                `SELECT text FROM group_messages
                 WHERE thread_id = ? AND ts <= ? AND id < ? AND deleted_at IS NULL AND text != '' AND text NOT LIKE 'http%' AND text NOT LIKE '/%'
                 ORDER BY ts DESC, id DESC LIMIT 1`,
              )
              .get(threadId, r.ts, r.id) as { text: string } | undefined;
            if (prevMsg && prevMsg.text) {
              const prevClean = prevMsg.text.replace(urlRegex, "").replace(/\s+/g, " ").trim();
              if (prevClean) {
                cleanContext = cleanContext ? `${prevClean} | ${cleanContext}` : prevClean;
              }
            }
          } catch { }
        }

        allLinks.push({
          url: cleanUrl,
          sender: r.display_name || "Thành viên",
          context: cleanContext.slice(0, 200) || "Chia sẻ đường link",
          ts: r.ts,
        });
      }
    }
  } catch (err) {
    console.warn("[searchRelevantLinks] Lỗi quét group_messages:", err);
  }

  // 2. Quét thêm từ Kho tri thức nhóm (group_knowledge) của riêng nhóm này
  try {
    const knowledges = db
      .prepare(
        `SELECT title, summary, content_text, file_url, sender_name, created_at
         FROM group_knowledge
         WHERE thread_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all(threadId) as any[];

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

  // 3. Quét toàn bộ Kho Kiến Thức & Tóm tắt lịch sử (/hub - daily_summaries) của riêng nhóm này
  try {
    const summaries = db
      .prepare(
        `SELECT day_label, summary_text, created_at
         FROM daily_summaries
         WHERE thread_id = ?
         ORDER BY day_date DESC`,
      )
      .all(threadId) as any[];

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

  // 3. Tách từ khóa tìm kiếm & trích xuất tên người chia sẻ (Author Hint)
  const stopWords = new Set([
    "sen", "chúa", "chua", "mộc", "miên", "moc", "mien", "bot",
    "liệt", "kê", "liet", "ke", "toàn", "bộ", "toan", "bo", "danh", "sách", "sach",
    "link", "đường", "duong", "dẫn", "dan", "có", "co", "liên", "quan", "lien",
    "tới", "toi", "đến", "den", "từ", "tu", "trước", "truoc", "giờ", "gio",
    "trong", "tài", "nguyên", "tai", "nguyen", "nhóm", "nhom", "giúp", "giup",
    "mình", "minh", "với", "voi", "nhé", "nhe", "ạ", "ơi", "oi", "hỏi", "cho", "em",
    "tìm", "tim", "lấy", "lay", "xin", "gửi", "gui", "xem", "của", "cua", "mà", "ma",
    "đã", "da", "về", "ve", "ở", "o", "bác", "bac", "anh", "chị", "chi",
    "chưa", "vậy", "vay", "thế", "the", "nào", "nao", "được", "duoc", "rồi", "roi", "nhỉ", "nhi", "chăng", "chang", "hả", "ha"
  ]);

  const authorHint = extractAuthorHint(query);
  const isTodayQuery = /(?:hôm nay|hom nay|today)/i.test(query);

  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const vnNow = new Date(utc + 7 * 3600000);
  vnNow.setHours(0, 0, 0, 0);
  const startOfTodayMs = vnNow.getTime() - 7 * 3600000;

  // Lọc sơ bộ: Nếu có tác giả cụ thể hoặc mốc hôm nay
  let candidateLinks = allLinks;
  if (authorHint) {
    const authorFiltered = allLinks.filter((item) =>
      item.sender.toLowerCase().includes(authorHint.toLowerCase())
    );
    if (authorFiltered.length > 0) {
      candidateLinks = authorFiltered;
    }
  }

  if (isTodayQuery) {
    const todayFiltered = candidateLinks.filter((item) => item.ts >= startOfTodayMs);
    if (todayFiltered.length > 0) {
      candidateLinks = todayFiltered;
    }
  }

  const wantsAll = /(?:toàn bộ|toan bo|tất cả|tat ca|toàn thể|danh sách|check\s+toàn\s+bộ)/i.test(query);
  const effectiveLimit = wantsAll ? Math.max(limit, 50) : limit;

  const rawWords = query
    .toLowerCase()
    .replace(/[.,;!?/\\@#$%^&*()_+={}\[\]|~`"':<>]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  const keywords = Array.from(new Set(rawWords));
  if (/github|repo/i.test(query) && !keywords.includes("github")) keywords.push("github");
  if (/zalo/i.test(query) && !keywords.includes("zalo")) keywords.push("zalo");

  if (keywords.length === 0 && !authorHint) {
    return candidateLinks.slice(0, effectiveLimit);
  }

  // 4. Chấm điểm độ khớp: Người gửi + URL + Ngữ cảnh chứa từ khóa
  const scored = candidateLinks.map((item) => {
    const lowerSender = item.sender.toLowerCase();
    const lowerUrl = item.url.toLowerCase();
    const lowerContext = item.context.toLowerCase();

    let matchCount = 0;

    // Ưu tiên cực cao (+10 điểm) nếu khớp đúng tác giả/người chia sẻ được nhắc tới (VD: bác Huy, anh Nam, Tuấn...)
    if (authorHint && lowerSender.includes(authorHint.toLowerCase())) {
      matchCount += 10;
    }

    // Ưu tiên cộng điểm (+5 điểm) nếu link gửi trong ngày hôm nay
    if (isTodayQuery && item.ts >= startOfTodayMs) {
      matchCount += 5;
    }

    for (const kw of keywords) {
      if (lowerUrl.includes(kw)) {
        matchCount += 3;
      } else if (lowerContext.includes(kw)) {
        matchCount += 2;
      } else if (lowerSender.includes(kw)) {
        matchCount += 2;
      }
    }
    return { item, matchCount };
  });

  const matched = scored
    .filter((s) => s.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount || b.item.ts - a.item.ts)
    .map((s) => s.item);

  if (matched.length === 0 && candidateLinks.length > 0) {
    return candidateLinks.slice(0, effectiveLimit);
  }

  return matched.slice(0, effectiveLimit);
}

/**
 * Trích xuất danh sách link/tài liệu được chia sẻ gần nhất trong nhóm theo lệnh /link [từ khóa]
 */
function handleLinksCommand(threadId: string, keywordFilter?: string, botName = defaultBotName): string {
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
    `\n\n💡 Mẹo: Bạn có thể gõ /link [từ khóa] hoặc hỏi tự nhiên "@${botName} tìm link..."!`
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
 * Trích xuất tên thành viên được nhắc tới trong câu hỏi (VD: "bác Huy đã share", "anh Nam gửi", "link của Tuấn", "do chị Lan post"...)
 */
export function extractAuthorHint(text: string, customStopWords?: Set<string>): string {
  if (!text) return "";
  const defaultStopWords = new Set([
    "sen", "chúa", "chua", "mộc", "miên", "moc", "mien", "bot",
    "ai", "nào", "nao", "gì", "gi", "đâu", "dau", "mình", "minh",
    "bác", "bac", "anh", "chị", "chi", "sếp", "sep", "ông", "ong", "bạn", "ban", "em", "thầy", "thay", "cô", "co",
    "link", "repo", "web", "tool", "source", "code", "nhóm", "nhom",
    "trước", "truoc", "tới", "toi", "giờ", "gio", "gần", "gan", "đây", "day", "toàn", "bộ"
  ]);
  const stopWords = customStopWords || defaultStopWords;

  // Loại bỏ các đại từ của người yêu cầu trước: 'giúp anh', 'giúp em', 'cho anh', 'cho em', 'cho mình', 'hộ anh', 'hộ em'
  const cleaned = text.replace(/(?:lấy\s+|tìm\s+|hỏi\s+|kiếm\s+|xem\s+)?(?:giúp|hộ|cho)\s+(?:anh|em|mình|tôi|tao|ad|admin)\s+/gi, " ");

  // Mẫu 1: Tag trực tiếp @[Tên riêng] (VD: @Trungkd, @Nam Nguyen)
  const regexDirectTag = /@([A-Za-zÀ-ỹ0-9_]+(?:\s+[A-Za-zÀ-ỹ0-9_]+)?)/i;

  // Mẫu 2: Có danh xưng (bác|anh|chị|sếp|em|bạn) [@?Tên riêng] (1-2 từ)
  const regexHonorific = /(?:của|do|từ|bởi)?\s*(?:bác|anh|chị|sếp|ông|bạn|thầy|cô|em)\s+@?([A-Za-zÀ-ỹ0-9_]+(?:\s+[A-Za-zÀ-ỹ0-9_]+)?)/i;

  // Mẫu 3: (của|do|bởi) [@?Tên riêng]
  const regexPrep = /(?:của|do|bởi)\s+@?([A-Za-zÀ-ỹ0-9_]+(?:\s+[A-Za-zÀ-ỹ0-9_]+)?)/i;

  const m = cleaned.match(regexDirectTag) || cleaned.match(regexHonorific) || cleaned.match(regexPrep);
  if (m && m[1]) {
    let raw = m[1].trim();
    // Loại bỏ từ nối thời gian, hành động hoặc từ chia sẻ đi kèm
    raw = raw.replace(/\s+(?:chia\s+sẻ|chia|sẻ|từ|tu|trước|truoc|về|ve|lúc|luc|hôm|hom|ngày|ngay|share|gửi|gui|nhắn|nhan|post|đăng|dang|up|viết|viet|đã|da|có|co|vừa|vua|mới|moi)$/i, "").trim();
    if (raw.length >= 2 && !stopWords.has(raw.toLowerCase())) {
      return raw;
    }
  }
  return "";
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

  // Nhận diện người chia sẻ được nhắc tới (VD: "bác Huy đã share", "anh Nam gửi", "link của Vũ Trọng"...)
  const authorHint = extractAuthorHint(question, stopWords);

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
                 AND is_self = 0
                 AND text NOT LIKE '/%'
                 AND text NOT LIKE '!%'
                 AND text NOT LIKE '🤖%'
                 AND LOWER(display_name) NOT LIKE '%sen chúa%'
                 AND LOWER(display_name) NOT LIKE '%sen chua%'
                 AND LOWER(display_name) NOT LIKE '%mộc miên%'
                 AND LOWER(display_name) NOT LIKE '%moc mien%'
                 AND LOWER(display_name) NOT LIKE '%kevin%'`;

    if (threadId) {
      sql += ` AND thread_id = ?`;
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
           WHERE thread_id = ?
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
           WHERE thread_id = ?
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
  threadId: string,
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

  if (!threadId) return [];

  try {
    const rows = db
      .prepare(
        `SELECT day_label, summary_text
         FROM daily_summaries
         WHERE thread_id = ?
         ORDER BY day_date DESC`,
      )
      .all(threadId) as any[];

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
  let fromTable = "members";
  let groupFilter = "m.group_id = @threadId";
  let totalFilter = "group_id = ?";
  try {
    const hasGroupMembers = db.prepare(`SELECT 1 FROM group_members WHERE group_id = ? AND is_active = 1 LIMIT 1`).get(threadId);
    if (hasGroupMembers) {
      fromTable = "group_members";
      groupFilter = "m.group_id = @threadId";
      totalFilter = "group_id = ?";
    }
  } catch { }

  const inactiveMembers = db
    .prepare(
      `SELECT m.display_name,
              COUNT(CASE WHEN i.type = 'message' THEN 1 END) AS msg_count
       FROM ${fromTable} m
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id AND i.thread_id = @threadId
       WHERE ${groupFilter}
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
      `SELECT COUNT(*) AS total FROM ${fromTable} WHERE ${totalFilter} AND is_active = 1 AND LOWER(display_name) NOT LIKE '%sen chúa%'`,
    )
    .get(threadId) as { total: number } | undefined;

  const total = totalMembersInGroup?.total ?? 0;
  const count = inactiveMembers.length;

  if (total === 0) {
    return `🚢 THỐNG KÊ THÀNH VIÊN TÀU NGẦM\n\nChưa có danh sách thành viên được đồng bộ trong nhóm này. Khi có thành viên tương tác hoặc sau khi đồng bộ nhóm, bot sẽ thống kê chính xác nhé!`;
  }

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
function handleHelpCommand(botName = defaultBotName): string {
  const upperBotName = botName.toUpperCase();
  return (
    `🤖 TRỢ LÝ CỘNG ĐỒNG — ${upperBotName}\n\n` +
    `Các lệnh bạn có thể sử dụng:\n` +
    `⏰ ĐẶT HẸN & BÁO THỨC:\n` +
    `🔹 /nhacnho [thời gian] [nội dung]: Đặt lịch hẹn nhắc việc (VD: /nhacnho 20p Đi họp, /hengio 17:30 Đón con, /hengio 8h tối mai Kèo bóng đá)\n` +
    `🔹 /dsnhac: Xem danh sách các lịch hẹn đang chờ của bạn\n` +
    `🔹 /huynhac [mã_số]: Hủy lịch hẹn theo mã\n` +
    `🔹 Hoặc tag bot: "@${botName} 8h tối mai nhắc cả nhóm có kèo bóng đá nhé"\n\n` +
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
    `🔹 /hoi [câu hỏi] hoặc tag @${botName}: Hỏi đáp kiến thức tra cứu từ lịch sử chat của nhóm\n` +
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

function isMediaOrDocUrl(url?: string | null): boolean {
  if (!url) return false;
  const clean = (url.split("?")[0] || "").toLowerCase();
  const mediaExts = [
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv",
    ".mp3", ".wav", ".m4a", ".mp4",
    ".txt", ".json", ".zip"
  ];
  if (mediaExts.some((ext) => clean.endsWith(ext))) return true;
  if (url.includes("zdn.vn") || url.includes("chat-photo") || url.includes("res-zalo") || url.includes("zaloapp")) return true;
  return false;
}

/**
 * Nhận diện ý định yêu cầu tóm tắt / xem thông tin nhóm khác trong nhóm.
 * Theo quy tắc nghiệp vụ: Tuyệt đối không chia sẻ hoặc tóm tắt thông tin nhóm khác trong nhóm Zalo (dù là Admin hay thành viên).
 * Việc tóm tắt các nhóm khác CHỈ được thực hiện qua tương tác 1:1 trực tiếp giữa Admin và Bot.
 */
function isExplicitCrossGroupRequest(question: string, currentGroupName?: string): boolean {
  const clean = question.trim().toLowerCase();
  if (!clean) return false;

  // 1. Nếu hỏi rõ ràng về các nhóm khác chung chung:
  // VD: "nhóm khác", "các nhóm khác", "toàn bộ nhóm", "mọi nhóm", "các gr khác"
  const isGenericCrossGroup =
    /(?:nhóm|group|gr)\s+(?:khác|kia|bên\s+ngoài)\b/i.test(clean) ||
    /(?:toàn\s+bộ|tất\s+cả|các|mọi)\s+(?:nhóm|group|gr)\b/i.test(clean);

  const hasInquiryAction =
    /(?:tóm\s*tắt|báo\s*cáo|tình\s*hình|cập\s*nhật|nội\s*dung|diễn\s*biến|xem\s*tin|có\s+gì|nhắn\s+gì|bàn\s+gì|thảo\s+luận\s+gì)/i.test(clean);

  if (isGenericCrossGroup && hasInquiryAction) {
    return true;
  }

  // 2. Kiểm tra nếu có nhắc đến từ khóa nhóm cụ thể:
  // Regex 1: "tóm tắt / báo cáo / tình hình ... [trong/ở/bên/tại/của] [nhóm/group/gr] <tên_nhóm>"
  // Hỗ trợ từ ngữ linh hoạt ở giữa (VD: "tóm tắt thảo luận trong nhóm group thảo luận ai công nghệ")
  const match1 = clean.match(/(?:tóm\s*tắt|báo\s*cáo|tình\s*hình|cập\s*nhật|nội\s*dung|diễn\s*biến|xem\s*tin).*?\b(?:trong\s+|ở\s+|bên\s+|tại\s+|của\s+)?(?:nhóm|group|gr)\s+([^,?.!\n]+)/i);
  // Regex 2: "[bên/ở/tại] [nhóm/group/gr] <tên_nhóm> [có gì/dạo này/thế nào...]"
  const match2 = clean.match(/(?:bên\s+|ở\s+|tại\s+)(?:nhóm|group|gr)\s+([^,?.!\n]+?)\s+(?:có\s+gì|dạo\s+này|thế\s+nào|nhắn\s+gì|bàn\s+gì|thảo\s+luận\s+gì|nói\s+gì)/i);

  const rawCandidate = match1 ? match1[1] : match2 ? match2[1] : null;

  if (rawCandidate) {
    let candidate = rawCandidate.trim();
    // Bỏ các từ đệm: "group", "nhóm", "gr" ở đầu candidate nếu có (ví dụ "group thảo luận ai..." -> "thảo luận ai...")
    candidate = candidate.replace(/^(?:nhóm|group|gr)\s+/i, "").trim();

    // Loại trừ các từ chỉ nhóm hiện tại
    if (/^(?:mình|này|ta|của\s*mình|ở\s*đây|nội\s*bộ|hiện\s*tại)$/i.test(candidate)) {
      return false;
    }

    // Loại trừ các từ chỉ mốc thời gian hoặc phạm vi thảo luận thông thường trong nhóm
    const isTimeOrTopicOnly = /^(?:hôm\s*nay|hôm\s*qua|tuần\s*(?:này|trước|qua)|tháng\s*(?:này|trước)|vừa\s*rồi|gần\s*đây|sáng\s*(?:nay|qua)|chiều\s*(?:nay|qua)|tối\s*(?:nay|qua)|\d+\s*ngày\s*qua|\d+\s*giờ\s*qua|mới\s*nhất|về\s+|liên\s*quan)/i.test(candidate);
    if (isTimeOrTopicOnly) {
      return false;
    }

    // Nếu có currentGroupName: so sánh xem candidate có trùng với currentGroupName không
    if (currentGroupName) {
      const curClean = currentGroupName.trim().toLowerCase();
      // Nếu tên nhóm hiện tại chứa candidate hoặc candidate chứa tên nhóm hiện tại
      // (ví dụ candidate = "ae test bot" và currentGroupName = "AE Test Bot")
      if (curClean === candidate || curClean.includes(candidate) || candidate.includes(curClean)) {
        return false; // Chính là nhóm hiện tại!
      }
    }

    // Nếu candidate có độ dài hợp lý (ít nhất 2 ký tự) và không phải là nhóm hiện tại -> Đây là hỏi nhóm khác!
    if (candidate.length >= 2) {
      return true;
    }
  }

  return false;
}

async function handleHistoryQA(
  question: string,
  displayName: string,
  threadId: string,
  options?: {
    api?: any;
    imageUrl?: string;
    fileAttachment?: MemberMessageEvent["fileAttachment"];
    quote?: MemberMessageEvent["quote"];
    strictDocMode?: boolean;
    directDocTitle?: string;
    directDocContent?: string;
    sender?: string;
    isSuperAdmin?: boolean;
    mentions?: MemberMessageEvent["mentions"];
    rawText?: string;
  },
): Promise<string> {
  const db = getDb();
  const isSuperAdmin = options?.isSuperAdmin ?? (options?.sender ? isUserAdmin(options.sender) : false);
  const groupSettings = getGroupSettings(threadId);
  const currentGroupName = (groupSettings.name && groupSettings.name.trim()) || "nhóm này";

  // 0. Chặn tra cứu chéo nhóm (Cross-Group Privacy Guard):
  // Tuyệt đối không cho phép lấy thông tin nhóm A đưa vào nhóm B trong group chat (kể cả khi Admin yêu cầu).
  // Chỉ khi chat 1:1 trực tiếp với bot thì Admin mới có thể tra cứu tình hình các nhóm.
  if (isExplicitCrossGroupRequest(question, currentGroupName)) {
    if (isSuperAdmin) {
      return `Dạ Sếp, để đảm bảo tính riêng tư và bảo mật giữa các cộng đồng, em không tóm tắt hay chia sẻ dữ liệu nhóm khác tại nhóm này ạ.\n\n👉 Sếp vui lòng nhắn tin riêng 1:1 trực tiếp với em, em sẽ báo cáo chi tiết đầy đủ tình hình các nhóm cho Sếp ngay nhé! 🙏`;
    }
    return `Dạ ${displayName ? `bác ${displayName}` : "bác"}, vì lý do bảo mật và bảo vệ quyền riêng tư giữa các cộng đồng, em chỉ hỗ trợ tra cứu và giải đáp thông tin trong nội bộ nhóm mình thôi ạ.\n\nEm không thể chia sẻ dữ liệu hoặc thảo luận từ nhóm khác được, mong bác thông cảm giúp em nhé! 🙏`;
  }

  // 1. Tải và giải mã file đính kèm / ảnh / audio (CHỈ tải nếu thực sự là media/file, tuyệt đối không tải web link URL)
  let mediaPart: GeminiMediaPart | null = null;
  let fileTextContent: string | null = null;
  const rawTargetUrl = options?.fileAttachment?.url || options?.imageUrl || (options?.quote?.mediaType === "image" || options?.quote?.mediaType === "video" || isMediaOrDocUrl(options?.quote?.mediaUrl) ? options?.quote?.mediaUrl : undefined);
  const targetUrl = (rawTargetUrl && (isMediaOrDocUrl(rawTargetUrl) || options?.fileAttachment?.url)) ? rawTargetUrl : undefined;
  const fileName = options?.fileAttachment?.name || "";

  if (targetUrl) {
    console.log(`[member-assistant] 📥 Đang nạp tài liệu/file từ: ${targetUrl.slice(0, 80)} (${fileName})...`);
    const fileRes = await downloadFileContent(targetUrl, fileName);
    if (fileRes?.error === "UNSUPPORTED_IMAGE_FORMAT") {
      const mime = fileRes.unsupportedMime || "này";
      return isSuperAdmin
        ? `Dạ Sếp ơi, hình ảnh đính kèm có định dạng "${mime}" hiện AI chưa hỗ trợ giải mã trực tiếp ạ. Kính nhờ Sếp chụp lại màn hình hoặc lưu ảnh dạng JPG/PNG gửi lại giúp em nhé! 🙏`
        : `Dạ ${displayName ? `bác ${displayName}` : "bác"} ơi, hình ảnh đính kèm có định dạng "${mime}" hiện AI chưa hỗ trợ đọc trực tiếp ạ. Bác vui lòng chụp lại màn hình hoặc lưu ảnh dạng JPG/PNG gửi lại giúp em nhé! 🙏`;
    }
    if (fileRes?.mediaPart && fileRes.mediaPart.data && fileRes.mediaPart.data.length > 50) {
      mediaPart = fileRes.mediaPart;
      console.log(`[member-assistant] ✅ Đã nạp file đa phương tiện thành công (${mediaPart.mimeType}, size: ${Math.round(mediaPart.data.length / 1024)} KB)`);
    } else if (fileRes?.textContent) {
      fileTextContent = fileRes.textContent;
      console.log(`[member-assistant] ✅ Đã đọc file văn bản thành công (${fileTextContent.length} ký tự)`);
    }
  }

  // Nếu người dùng gửi kèm ảnh/file rõ ràng nhưng hệ thống không nạp được do mạng/CDN rỗng
  if (targetUrl && !mediaPart && !fileTextContent) {
    console.warn(`[member-assistant] Không nạp được media từ targetUrl: ${targetUrl.slice(0, 80)}`);
    const isImageAnalysisReq =
      /(?:ocr|chữ trong ảnh|văn bản trong ảnh|đọc ảnh|xem ảnh|ảnh này|hình này|soi ảnh|giải bài|đáp án)/i.test(question) ||
      Boolean(options?.imageUrl);
    if (isImageAnalysisReq) {
      return isSuperAdmin
        ? `Dạ Sếp ơi, em đã nhận được yêu cầu nhưng máy chủ Zalo CDN chưa kịp đồng bộ ảnh sang cho em đọc ạ. Kính nhờ Sếp reply (quote) lại ảnh hoặc gửi lại giúp em nhé! 🙏`
        : `Dạ ${displayName ? `bác ${displayName}` : "bác"} ơi, máy chủ Zalo chưa kịp đồng bộ ảnh sang cho em đọc ạ. Bác vui lòng reply (quote) lại ảnh hoặc gửi lại giúp em nhé! 🙏`;
    }
  }

  // 🚀 FAST-PATH MULTIMODAL: Nếu đang phân tích ảnh hoặc tài liệu đính kèm,
  // CẮT BỎ TOÀN BỘ truy vấn DB nặng (Top members, Inactive members, 60 tin nhắn chat, tóm tắt cũ)
  // để Gemini phản hồi tức thì trong 2-3 giây và không bị ảo giác bởi tài liệu cũ!
  if (mediaPart || fileTextContent) {
    const groupSettings = getGroupSettings(threadId);
    const botName = groupSettings.botName || defaultBotName;

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
      customPromptSection = `\n=== CHỈ THỊ RIÊNG CỦA ADMIN (BẮT BUỘC TUÂN THỦ 100%): ===\n${groupSettings.customPrompt.trim()}\n`;
    }

    let fileContentSnippet = "";
    if (fileTextContent) {
      fileContentSnippet = `\n=== TOÀN BỘ NỘI DUNG TÀI LIỆU (${fileName || "File đính kèm"}): ===\n${fileTextContent.slice(0, 40000)}\n`;
    }

    let quoteTextSection = "";
    if (options?.quote?.text) {
      quoteTextSection = `\n=== NỘI DUNG ĐƯỢC TRÍCH DẪN (QUOTE TỪ ${options.quote.senderName || "THÀNH VIÊN"}): ===\n"${options.quote.text}"\n`;
    }

    const fastSystemPrompt =
      `${getSystemTemporalPrompt()}\n\n` +
      `${personaIntro}\n${customPromptSection}\n` +
      `NHIỆM VỤ:\n` +
      `1. Bạn vừa nhận được một hình ảnh hoặc tài liệu văn bản đính kèm từ ${isSuperAdmin ? `Sếp (${displayName}) - Super Admin / Quản trị viên tối cao của bạn` : "thành viên"}.\n` +
      `2. ĐỌC KỸ TOÀN BỘ NỘI DUNG trong hình ảnh / tài liệu đính kèm.\n` +
      `3. Trả lời trực tiếp, đầy đủ, rõ ràng và chuẩn xác theo đúng ${isSuperAdmin ? "chỉ đạo của Sếp" : "câu hỏi/yêu cầu của thành viên"}.\n` +
      (isSuperAdmin
        ? `4. QUY TẮC XƯNG HÔ VỚI SẾP: BẮT BUỘC xưng 'em', gọi người hỏi là 'Sếp' (hoặc 'Sếp ${displayName}'). Giọng điệu tôn trọng, chu đáo, hỗ trợ đắc lực và chuẩn xác cho Sếp.\n`
        : `4. QUY TẮC XƯNG HÔ: Xưng 'em' hoặc '${botName}', gọi người hỏi là 'anh/chị/bác ${displayName}'. TUYỆT ĐỐI KHÔNG gọi người hỏi là 'Sếp' (danh xưng 'Sếp' chỉ dành riêng cho Quản trị viên tối cao của bot).\n`) +
      `5. NGUYÊN TẮC TRUNG THỰC - TUYỆT ĐỐI KHÔNG BỊA ĐẶT: Nếu trong hình ảnh/tài liệu không có thông tin chi tiết về điều ${isSuperAdmin ? "Sếp" : "thành viên"} hỏi, BẮT BUỘC phải ${isSuperAdmin ? "báo cáo" : "nói"} rõ là trong ảnh/tài liệu không có chi tiết này. TUYỆT ĐỐI KHÔNG tự suy đoán, bịa đặt sự kiện, sản phẩm, con số hay câu chuyện không có thật.\n` +
      `6. Trả lời chuẩn theo phong cách của bạn (${isSuperAdmin ? "chu đáo, chuyên nghiệp, thông minh" : "hóm hỉnh, chuyên nghiệp, thông minh"}).\n` +
      `7. QUY TẮC ĐỊNH DẠNG TIN NHẮN ZALO:\n` +
      `   - TUYỆT ĐỐI KHÔNG dùng dấu ** hoặc * để in đậm vì Zalo không hỗ trợ markdown (sẽ hiện nguyên văn hai dấu sao rất xấu). Hãy viết hoa chữ cái đầu hoặc viết hoa tiêu đề để làm nổi bật (ví dụ: '1. NHÂN VẬT CHÍNH:', '2. KHÁCH HÀNG:').\n` +
      `   - TIẾT CHẾ ICON / EMOJI TỐI ĐA: Giữ phong cách thanh lịch, gọn gàng. TUYỆT ĐỐI KHÔNG spam icon ở từng dòng hay từng gạch đầu dòng.\n` +
      `8. KỸ NĂNG VẼ BIỂU ĐỒ, HÌNH ẢNH, SƠ ĐỒ & ĐỒ HỌA BẰNG PYTHON (python_interpreter):\n` +
      `   - Khi người dùng yêu cầu vẽ biểu đồ số liệu định lượng, đồ thị, sơ đồ quy trình/thuật toán, tạo infographic poster lịch thi đấu/bảng xếp hạng/timeline/roadmap:\n` +
      `     BẮT BUỘC sử dụng công cụ 'python_interpreter'. TUYỆT ĐỐI CẤM gõ code Python bằng chữ vào tin nhắn chat Zalo!\n` +
      `   - Phân biệt rõ hai phong cách thiết kế đồ họa:\n` +
      `     + VỚI LỊCH THI ĐẤU, BẢNG XẾP HẠNG, ROADMAP, DANH SÁCH SỰ KIỆN: BẮT BUỘC dùng Pillow (PIL) thiết kế INFOGRAPHIC POSTER DẠNG CARD LAYOUT khổ dọc (W=720, H=1100-1400), nền tối sang trọng (thể thao dùng đỏ rượu/burgundy #42030D, công nghệ/doanh nghiệp dùng Navy #0B132B), các thẻ bo góc (draw.rounded_rectangle), huy hiệu trạng thái ([CHÍNH THỨC], [GIAO HỮU]), tiêu đề vàng kim #FFD700 rực rỡ, hàng dữ liệu sắc nét. TUYỆT ĐỐI KHÔNG vẽ biểu đồ cột cho lịch thi đấu!\n` +
      `     + VỚI BIỂU ĐỒ SỐ LIỆU ĐỊNH LƯỢNG (doanh thu, phần trăm, biến động giá, thống kê): Dùng matplotlib.pyplot với dark theme (plt.style.use('dark_background')), nhãn trục rõ ràng, lưu PNG DPI=150.\n` +
      `   - Hệ thống tự động cung cấp font tiếng Việt chuẩn Unicode qua hàm get_font(size, bold=True/False) và tự động bắt file ảnh PNG gửi trực tiếp lên Zalo cho ${isSuperAdmin ? "Sếp" : "người dùng"}.\n` +
      `   - TUYỆT ĐỐI KHÔNG dùng python_interpreter để tạo ảnh nghệ thuật/minh họa (phong cảnh, chân dung, đồ vật, bánh trái, anime...). TUYỆT ĐỐI CẤM tự ý hứa hẹn hoặc nói rằng 'em đang tạo ảnh / hệ thống đang gửi ảnh vào nhóm' khi phiên hỏi đáp này không có công cụ sinh ảnh nghệ thuật!\n` +
      `   - TUYỆT ĐỐI CẤM từ chối hoặc bảo người dùng nhờ designer vẽ lại!\n` +
      `9. KỸ NĂNG XUẤT FILE TÀI LIỆU, SLIDE VÀ VOICE (generate_file & create_voice):\n` +
      `   - Khi người dùng yêu cầu tạo bài thuyết trình / slide PowerPoint (.pptx), tài liệu Word (.docx), Excel (.xlsx), hoặc tạo giọng đọc / voice / podcast (.m4a), HOẶC giục 'soạn luôn đi', 'làm luôn đi':\n` +
      `     * BẮT BUỘC PHẢI GỌI CÔNG CỤ 'generate_file' (fileType='pptx' cho slide, 'docx' cho word, 'xlsx' cho excel) HOẶC 'create_voice' để xuất file thực tế gửi lên Zalo!\n` +
      `     * TUYỆT ĐỐI CẤM CHỈ GÕ DÀN Ý BẰNG CHỮ RỒI HỎI NGƯỢC LẠI NGƯỜI DÙNG có muốn soạn không. Hãy hành động và xuất file ngay lập tức!\n` +
      `     * [QUY TẮC BẢO LƯU NGUYÊN VẸN TRI THỨC KHI ĐÓNG GÓI / XUẤT FILE ĐA LĨNH VỰC]:\n` +
      `       + Khi người dùng yêu cầu 'đóng gói', 'xuất file', 'lưu vào file', 'chuyển thành file' (Word/docx, Excel/xlsx, PowerPoint/pptx, PDF, CSV, TXT...) từ nội dung tin nhắn được trích dẫn (quote) hoặc nội dung đã bàn luận trước đó:\n` +
      `       + BẮT BUỘC PHẢI BẢO LƯU NGUYÊN VẸN 100% TOÀN BỘ NỘI DUNG CHI TIẾT GỐC VÀO THAM SỐ 'content' CỦA TOOL 'generate_file' (bao gồm đầy đủ căn cứ/điều khoản pháp luật, bảng biểu/số liệu tài chính - BĐS, toàn bộ lời thoại/phân cảnh kịch bản media, mã nguồn/kiến trúc kỹ thuật, quy chế doanh nghiệp...). TUYỆT ĐỐI CẤM tự ý tóm tắt thành dàn ý gạch đầu dòng sơ sài làm mất mát dữ liệu và tri thức chuyên sâu của người dùng!\n` +
      `     * [QUY TẮC NỘI DUNG VOICE / TTS CHO MỌI LĨNH VỰC (Thơ ca, Tin tức, Pháp luật, Tài chính, Kịch bản, Kể chuyện)]: Khi gọi 'create_voice', tham số 'text' CHỈ ĐƯỢC CHỨA NỘI DUNG CỐT LÕI CẦN ĐỌC THÀNH TIẾNG (Tên tác phẩm/bản tin/điều luật, Tác giả/Nguồn nếu có, và toàn bộ nội dung chi tiết bài thơ / tin tức / đối thoại / câu chuyện). TUYỆT ĐỐI CẤM đưa lời chào xưng hô (@mention, 'Dạ Sếp...', 'Em xin gửi...'), lời dẫn phiếm đàm ('Dưới đây là...'), thông báo tiến độ ('Hệ thống đang xử lý qua worker...'), câu hỏi kết thúc ('Sếp có muốn...', 'Chúc bạn nghe vui...'), ĐẶC BIỆT TUYỆT ĐỐI CẤM đưa các đoạn phân tích, bình luận, cảm nhận, ý nghĩa, bối cảnh sáng tác hay giải thích bên dưới vào tham số 'text' của giọng đọc (người dùng chỉ muốn nghe chính tác phẩm, không nghe phân tích ngoài lề)!\n` +
      `     * [KỊCH BẢN ĐỐI THOẠI / PODCAST 2 NGƯỜI]: Khi người dùng yêu cầu kịch bản 2 người nói chuyện, cuộc đối thoại, hoặc podcast 2 người: BẮT BUỘC tự động soạn kịch bản đối đáp sinh động, phân vai rõ ràng theo từng lượt nói (ví dụ: 'Nam: ...\nNữ: ...' hoặc 'MC Nam: ...\nKhách mời: ...', có thể thêm cảm xúc trong ngoặc như 'Nam (hào hứng): ...') và BẮT BUỘC GỌI 'create_voice' truyền toàn bộ kịch bản vào tham số 'text' để hệ thống tự động tổng hợp thành file Podcast .m4a 2 giọng gửi lên Zalo!\n` +
      `     * TUYỆT ĐỐI CẤM in cú pháp giả lập dạng '[create_voice text="..."]' hoặc '[generate_file(...)]' ra tin nhắn văn bản! BẮT BUỘC PHẢI THỰC SỰ GỌI FUNCTION CALLING CỦA TOOL!\n` +
      `     * [QUY ĐỊNH CÂU TRẢ LỜI BẰNG CHỮ KÈM THEO]:\n` +
      `       + Với Slide PowerPoint (.pptx), File Word (.docx), Excel (.xlsx): Câu trả lời bằng chữ chỉ cần ngắn gọn 1-3 dòng tóm tắt và thông báo file đã gửi, không xả hàng chục trang vào chat Zalo.\n` +
      `       + Với Yêu cầu Voice / Đọc bài thơ / Ngâm thơ / Đọc tin tức / Kịch bản / Kể chuyện: BẮT BUỘC PHẢI IN TOÀN BỘ NỘI DUNG BÀI THƠ / BÀI VIẾT / KỊCH BẢN ĐẦY ĐỦ RA TIN NHẮN CHAT (ghi rõ Tên bài thơ/tác phẩm, Tác giả nếu có, và toàn văn từng dòng từng khổ). TUYỆT ĐỐI KHÔNG được chỉ gửi mỗi câu thông báo 1 dòng nhận việc mà quên in nội dung!\n` +
      `     * [TUYỆT ĐỐI CẤM BỊA ĐẶT / ẢO GIÁC VỀ GIỚI HẠN KỸ THUẬT]:\n` +
      `       + TUYỆT ĐỐI CẤM bịa đặt các câu như 'hạn mức 2 tác vụ/giờ', 'đạt ngưỡng hệ thống', 'chỉ chủ nhân mới có quyền', 'lát nữa em mới thu âm', 'uống trà đợi em'. Khi người dùng yêu cầu, PHẢI THỰC HIỆN NGAY LẬP TỨC!\n` +
      `     * Tuyệt đối cấm bịa đặt tin nhắn đã xuất file khi chưa gọi tool!`;

    const fastUserPrompt =
      `${quoteTextSection}${fileContentSnippet}\n` +
      `YÊU CẦU / ${isSuperAdmin ? "CHỈ ĐẠO TỪ SẾP" : "CÂU HỎI TỪ THÀNH VIÊN"} (${displayName}): ${question || (fileTextContent ? "Hãy phân tích chi tiết nội dung tài liệu này giúp tôi." : "Hãy phân tích chi tiết hình ảnh này giúp tôi.")}\n\n` +
      `HÃY TRẢ LỜI NGAY:`;

    const needsAgentLoop = checkIsFileOrVoiceGeneration(question, options?.quote?.text);

    try {
      let answer = "";
      let voiceGenerated = false;
      if (needsAgentLoop) {
        answer = await callGeminiAgentLoop(fastSystemPrompt, fastUserPrompt, {
          model: "gemini-3.1-flash-lite-preview",
          maxTurns: 3,
          mediaParts: mediaPart ? [mediaPart] : undefined,
          onFileGenerated: async (file) => {
            try {
              if (options?.api) {
                const isSlide = /\.(pptx|ppt)$/i.test(file.filePath);
                const isImg = /\.(png|jpg|jpeg|webp)$/i.test(file.filePath);
                const isVoice = /\.(m4a|mp3|wav|aac)$/i.test(file.filePath);
                if (isVoice) voiceGenerated = true;
                const caption = file.caption || (
                  isSlide
                    ? `📊 ${botName} đã soạn xong bài thuyết trình PowerPoint [${file.fileName}] cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`
                    : isImg
                      ? `📊 Biểu đồ / Hình ảnh đã hoàn tất cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`
                      : isVoice
                        ? `🎙️ ${botName} gửi voice cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`
                        : `📄 ${botName} đã tạo xong file [${file.fileName}] cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`
                );
                if (isVoice) {
                  await sendGroupVoice(
                    options.api,
                    threadId,
                    file.filePath,
                    caption,
                  );
                } else {
                  await sendGroupFile(
                    options.api,
                    threadId,
                    file.filePath,
                    caption,
                  );
                }
              }
            } catch (fileErr) {
              console.warn("[member-assistant] Fast-path QA sendGroupFile error:", fileErr);
            }
          },
        });
      } else {
        answer = await callGemini(fastSystemPrompt, fastUserPrompt, {
          mediaParts: mediaPart ? [mediaPart] : undefined,
          enableSearch: false,
        });
      }

      answer = await interceptAndExecuteSimulatedTool(answer, async (file) => {
        if (options?.api) {
          const isVoice = /\.(m4a|mp3|wav|aac)$/i.test(file.filePath);
          if (isVoice) {
            voiceGenerated = true;
            await sendGroupVoice(
              options.api,
              threadId,
              file.filePath,
              file.caption || `🎙️ ${botName} gửi voice cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`,
            );
          } else {
            await sendGroupFile(
              options.api,
              threadId,
              file.filePath,
              file.caption || `📄 ${botName} gửi file [${file.fileName}] cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`,
            );
          }
        }
      });

      // 🛡️ PHÒNG THỦ CHIỀU SÂU: Nếu người dùng yêu cầu Voice/Đọc thơ mà chưa có file voice nào được gửi
      if (checkIsVoiceRequest(question, options?.quote?.text) && !voiceGenerated && options?.api) {
        try {
          let speechText = extractSpeechFallbackText(answer);
          if (!speechText || speechText.length < 15) {
            console.log(`[member-assistant] 🔍 [Fast QA] Answer thiếu nội dung cốt lõi để đọc voice, đang gọi nhanh AI trích xuất nội dung từ yêu cầu: "${question}"...`);
            const directContent = await callGemini(
              `Bạn là trợ lý trích xuất văn bản đọc giọng. Hãy cung cấp ĐẦY ĐỦ, CHÍNH XÁC toàn bộ nội dung bài thơ, bài viết, kịch bản hoặc lời thoại được yêu cầu trong câu hỏi của người dùng.
QUY TẮC BẮT BUỘC:
1. Chỉ in: Tên tác phẩm/bài thơ, Tác giả (nếu có), và TOÀN BỘ NỘI DUNG TỪNG DÒNG của bài thơ / văn bản / kịch bản.
2. TUYỆT ĐỐI KHÔNG có lời chào (@mention, Dạ Sếp, Xin chào), KHÔNG có lời giải thích, KHÔNG có câu kết, KHÔNG bịa đặt giới hạn kỹ thuật.`,
              `Yêu cầu: "${question}". Trích dẫn nếu có: "${options?.quote?.text || ""}".`,
              { model: "gemini-flash-latest" },
            ).catch(() => "");
            if (directContent && directContent.length >= 15) {
              const cleanedDirect = cleanCoreSpeechText(directContent);
              speechText = (cleanedDirect && cleanedDirect.length >= 15) ? cleanedDirect : directContent.trim();
              if (speechText && !answer.toLowerCase().includes(speechText.slice(0, 30).toLowerCase())) {
                answer = `${answer}\n\n${speechText}`.trim();
              }
            }
          }

          if (speechText && speechText.length >= 15) {
            console.log(`[member-assistant] 🛡️ [Fast QA] Kích hoạt voice fallback tự động (${speechText.length} ký tự)...`);
            const vRes = await executeAgentTool("create_voice", {
              text: speechText,
              caption: `🎙️ ${botName} gửi bản đọc diễn cảm cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`,
            });
            if (vRes?.success && vRes?.filePath) {
              voiceGenerated = true;
              answer = cleanOutdatedVoicePromisesFromAnswer(answer);
              await sendGroupVoice(
                options.api,
                threadId,
                vRes.filePath,
                vRes.caption || `🎙️ ${botName} gửi bản đọc diễn cảm cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`,
              );
            }
          }
        } catch (fbVoiceErr) {
          console.warn("[member-assistant] Fast-path QA lỗi sinh voice fallback:", fbVoiceErr);
        }
      }

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
      return `Dạ em ${botName} có nhận được ảnh/file của bác ${displayName} rồi nè, nhưng vừa phân tích nửa chừng thì bị nghẽn mạng một nhịp 😄! Bác gõ lại câu hỏi hoặc gửi lại để em soi kỹ lại lần nữa nhé!`;
    }
  }

  // 🚀 FAST-PATH QUOTE QA: Nếu thành viên Quote một tin nhắn và nhờ giải thích/tóm tắt/trả lời,
  // CẮT BỎ TOÀN BỘ truy vấn DB nặng (Top members, Inactive members, tin nhắn cũ, tóm tắt cũ)
  // để Gemini phản hồi tức thì trong 2-3 giây!
  if (options?.quote?.text && !options?.fileAttachment) {
    const groupSettings = getGroupSettings(threadId);
    const botName = groupSettings.botName || defaultBotName;

    // Tự động khâu nối các mảnh tin nhắn bị Zalo chia nhỏ nếu tin nhắn được quote là tin dài
    options.quote.text = stitchMultiChunkQuote(threadId, options.quote.text);

    // 0. Lấy 20 tin nhắn gần nhất trong nhóm để tái hiện trọn vẹn ngữ cảnh hội thoại đa lượt (kể cả các câu trả lời trước đó của bot)
    let recentChatContext = "";
    try {
      const recentMsgs = db
        .prepare(
          `SELECT display_name, text, ts, is_self
           FROM group_messages
           WHERE thread_id = ?
             AND text IS NOT NULL
             AND text != ''
             AND deleted_at IS NULL
             AND text NOT LIKE '/%'
             AND text NOT LIKE '!%'
           ORDER BY ts DESC
           LIMIT 20`,
        )
        .all(threadId) as { display_name: string; text: string; ts: number; is_self: number }[];

      if (recentMsgs && recentMsgs.length > 0) {
        recentMsgs.reverse();
        const formatted = recentMsgs.map((m) => {
          const rawTs = Number(m.ts) || Date.now();
          let timeStr = "";
          try {
            timeStr = new Date(rawTs + 7 * 3600 * 1000).toISOString().slice(11, 16);
          } catch {
            timeStr = "";
          }
          const isBot = m.is_self === 1 || /(?:sen chúa|sen chua|mộc miên|kevin|bot)/i.test(m.display_name || "");
          const senderLabel = isBot ? `${botName} (Trợ lý AI)` : (m.display_name || "Thành viên");
          return `[${timeStr}] ${senderLabel}: ${m.text}`;
        });
        recentChatContext = `\n=== LỊCH SỬ THẢO LUẬN GẦN ĐÂY TRONG NHÓM (NGỮ CẢNH HỘI THOẠI ĐA LƯỢT / CÁC LƯỢT QUOTE TRƯỚC ĐÓ): ===\n${formatted.join("\n")}\n`;
      }
    } catch (e) {
      console.warn("[member-assistant] Quote QA fetch recent messages error:", e);
    }

    // 1. Tra cứu tri thức dự án / văn bản chính thức (kết hợp câu hỏi + nội dung quote để bắt đúng dự án/chủ đề)
    let quotePermanentKnowledge: PermanentKnowledgeItem[] = [];
    try {
      quotePermanentKnowledge = searchPermanentKnowledge(question, threadId, 2, options.quote.text);
      for (const pk of quotePermanentKnowledge) {
        if (pk.sourceType === "google_sheet" || pk.sourceType === "google_doc") {
          await refreshDynamicKnowledgeIfExpired(pk);
        }
      }
    } catch (e) {
      console.warn("[member-assistant] Quote QA searchPermanentKnowledge error:", e);
    }

    let quoteDocSection = "";
    let docTopicName = "";
    if (options?.directDocContent) {
      docTopicName = options.directDocTitle || "Tài liệu Google Doc/Sheet";
      quoteDocSection = `\n=== TÀI LIỆU CHÍNH THỨC (${docTopicName.toUpperCase()}): ===\n${options.directDocContent.slice(0, 35000)}\n\n`;
    } else if (quotePermanentKnowledge.length > 0) {
      docTopicName = quotePermanentKnowledge[0]?.topic || "Dự án";
      quoteDocSection = "\n=== TÀI LIỆU & CHÍNH SÁCH CHÍNH THỨC CỦA DỰ ÁN (BẮT BUỘC TRÍCH DẪN TỪ ĐÂY): ===\n";
      for (const pk of quotePermanentKnowledge) {
        quoteDocSection += `[Chủ đề: ${pk.topic.toUpperCase()} - Nguồn: ${pk.title}]:\n${(pk.contentText || "").slice(0, 30000)}\n\n`;
      }
    } else if (options?.strictDocMode) {
      return `⚠️ Em không tìm thấy tài liệu nào khớp với yêu cầu của bạn trong kho dữ liệu!\n\n👉 Để tra cứu chuẩn xác 100% không bịa đặt, bạn vui lòng:\n1. Gửi kèm link Google Doc/Sheet: /doc [link] [câu hỏi]\n2. Hoặc nhờ Admin nạp tài liệu vào kho bằng lệnh: /doc [tên_dự_án] [link] nhé!`;
    }

    // 1b. Nếu câu hỏi có ý định xin link / repo / tài nguyên: Tra cứu kho link lịch sử nhóm
    const isQuoteResourceQuery =
      /(?:link|đường dẫn|repo|github|mã nguồn|source|tài liệu)/i.test(question) ||
      /(?:cho xin|gửi|xin|danh sách|check|lấy|tìm|xem).*(?:link|đường dẫn|repo)/i.test(question);
    let quoteRelevantLinks: FoundResource[] = [];
    if (isQuoteResourceQuery) {
      try {
        quoteRelevantLinks = searchRelevantLinksAndResources(threadId, `${question} ${options.quote.text}`, 20);
      } catch (e) {
        console.warn("[member-assistant] Quote QA searchRelevantLinksAndResources error:", e);
      }
    }

    let quoteLinksSection = "";
    if (quoteRelevantLinks.length > 0) {
      quoteLinksSection =
        "\n=== KHO LINK & TÀI NGUYÊN ĐÃ TỪNG ĐƯỢC CHIA SẺ TRONG LỊCH SỬ NHÓM: ===\n" +
        quoteRelevantLinks
          .map((l, idx) => {
            const d = new Date(l.ts + 7 * 3600 * 1000);
            const timeStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
            return `${idx + 1}. URL: ${l.url}\n   Người chia sẻ: ${l.sender} (${timeStr})\n   Ngữ cảnh/tin nhắn đi kèm: ${l.context}`;
          })
          .join("\n\n") +
        "\n\nCHỈ DẪN BẮT BUỘC: Thành viên hỏi xin link/tài nguyên. Trong lịch sử nhóm ĐÃ TỪNG CÓ thành viên chia sẻ các đường link ở trên! " +
        "Bạn BẮT BUỘC phải trích xuất và cung cấp đầy đủ các đường link, ghi rõ người chia sẻ và ngày gửi từ danh sách trên để trả lời cho thành viên!\n";
    }

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

    const quoteSystemPrompt =
      `${getSystemTemporalPrompt()}\n\n` +
      `BẠN ĐANG TƯƠNG TÁC TRỰC TIẾP TRONG NHÓM: "${currentGroupName}" (ID: ${threadId}).\n` +
      `${personaIntro}\n${customPromptSection}\n` +
      `NHIỆM VỤ:\n` +
      `1. Thành viên đang trích dẫn (quote) một tin nhắn hoặc nội dung thảo luận trước đó và đặt câu hỏi tiếp theo.\n` +
      `2. ÁP DỤNG 5 NGUYÊN TẮC VÀNG HOẠT ĐỘNG TOÀN NĂNG:\n` +
      `   - [NGUYÊN TẮC 1 - DUAL GROUNDING ĐA LĨNH VỰC]:\n` +
      `     + Với dữ liệu đóng nội bộ (file đính kèm, link Google Doc/Sheet, hợp đồng, chính sách, tài liệu): 100% số liệu phải lấy từ văn bản, zero-hallucination. Không tự bịa số liệu hay phương án. Thiếu thì báo thẳng.\n` +
      `     + Với thực thể/thị trường mở (xe cộ, đồ công nghệ, điện thoại, tài chính, dự án, pháp luật, người nổi tiếng): Phân cụm thực thể chuẩn xác, không đánh đồng hay nhầm lẫn chéo giữa các thương hiệu/hãng. Tận dụng dữ liệu báo chí/tìm kiếm để giải đáp toàn diện, không từ chối trả lời.\n` +
      `   - [NGUYÊN TẮC 2 - ZALO RICH TEXT & MARKDOWN]: Thoải mái dùng Markdown (**in đậm** cho từ khóa/số liệu, [do]đỏ[/do], [xanh]xanh[/xanh], [cam]cam[/cam], gạch đầu dòng '-' hoặc '•') vì hệ thống tự động render màu sắc và kiểu chữ native trên Zalo. Tiết chế icon (tối đa 1-2 icon ở tiêu đề, cấm spam icon ở từng đầu gạch dòng). Bảng biểu dùng Khối thẻ (Card Layout).\n` +
      `   - [NGUYÊN TẮC 3 - TRẢ LỜI TRỰC TIẾP, DẪN NGUỒN CHUẨN XÁC & GỢI MỞ]: Đi thẳng vào đáp án/kết quả trọng tâm mà người dùng hỏi ngay từ dòng đầu tiên. TUYỆT ĐỐI CẤM mở bài bằng các câu cảm thán rườm rà, đùa cợt hoặc xưng hô làm loãng nội dung ở mọi chủ đề. Với câu hỏi sử dụng dữ liệu thời gian thực (tin tức, sự kiện, văn bản pháp luật, đơn vị hành chính, giá cả, khoa học), BẮT BUỘC kết thúc bằng 1 dòng nguồn uy tín trong dấu ngoặc đơn in nghiêng: *(Nguồn: [Tên cơ quan ban hành / Tổ chức / Nguồn tin uy tín], [thời điểm nếu có]).* Sau khi trả lời xong, có thể để lại 1 câu hỏi gợi mở ngắn gọn hoặc lời chúc tinh tế.\n` +
      (isSuperAdmin
        ? `   - [NGUYÊN TẮC 4 - XƯNG HÔ ĐẶC QUYỀN VỚI SẾP (SUPER ADMIN)]:\n` +
          `     + Người hỏi (${displayName}) chính là SUPER ADMIN / CHỦ NHÂN CỦA BẠN.\n` +
          `     + BẮT BUỘC xưng 'em', gọi người hỏi là 'Sếp' (hoặc 'Sếp ${displayName}').\n` +
          `     + Giọng điệu tôn trọng, chu đáo, hỗ trợ đắc lực và chuẩn xác cho Sếp (Dạ Sếp, Em báo cáo Sếp...). CẤM xưng 'tôi', CẤM gọi Sếp là 'bác' hay 'bạn'.\n`
        : `   - [NGUYÊN TẮC 4 - PHONG CÁCH ${botName.toUpperCase()}]:\n` +
          `     + Xưng 'em' hoặc '${botName}', gọi người hỏi là 'anh/chị/bác ${displayName}'.\n` +
          `     + TUYỆT ĐỐI KHÔNG gọi người hỏi là 'Sếp' (danh xưng 'Sếp' chỉ dành riêng cho Quản trị viên tối cao của bot, không áp dụng cho thành viên thông thường).\n` +
          `     + Duyên dáng, mặn mà, hóm hỉnh, tôn trọng nhưng cực kỳ uy tín về tri thức. Không xưng 'tôi', không gọi 'bạn'.\n`) +
      `   - [NGUYÊN TẮC 5 - CÔ LẬP DỮ LIỆU & ĐỘ ƯU TIÊN THỜI GIAN THỰC]: Dữ liệu thời gian thực tra cứu được (Live News, Web Search, Bách khoa toàn thư) CÓ ĐỘ ƯU TIÊN CAO NHẤT, ĐÈ LÊN MỌI LẬP LUẬN CŨ TRONG LỊCH SỬ CHAT VÀ DỮ LIỆU LỖI THỜI TRONG TRÍ NHỚ. Tuyệt đối không lặp lại số liệu cũ nếu có thông tin mới hơn!\n` +
      `   - [CẬP NHẬT DỮ KIỆN THỜI GIAN THỰC & PHÁP LUẬT / HÀNH CHÍNH MỚI NHẤT]: BẮT BUỘC ưu tiên dữ liệu mới nhất từ phần 'DỮ LIỆU THỜI GIAN THỰC & BÁCH KHOA MỚI NHẤT'. Khi câu hỏi liên quan đến dữ kiện thực tế có tính biến động (chính sách, luật pháp, đơn vị hành chính, giá cả, số liệu): TUYỆT ĐỐI KHÔNG bám vào số liệu cũ trong trí nhớ đã lỗi thời hay câu trả lời cũ trong lịch sử chat nếu dữ liệu tra cứu cung cấp văn bản, nghị quyết hoặc số liệu mới hơn. Phải giải thích rõ ràng và cập nhật số liệu mới nhất cho người hỏi!\n` +
      `   - [QUY TẮC BẮT BUỘC KHI TẠO SLIDE THUYẾT TRÌNH, XUẤT FILE TÀI LIỆU HOẶC TẠO VOICE]:\n` +
      `     + Khi người dùng yêu cầu tạo bài thuyết trình / slide PowerPoint (.pptx), xuất file Word (.docx), Excel (.xlsx), hoặc tạo giọng đọc / voice (.m4a), HOẶC giục 'soạn luôn đi', 'làm luôn đi':\n` +
      `       * BẮT BUỘC PHẢI GỌI CÔNG CỤ 'generate_file' (fileType='pptx' cho slide, 'docx' cho word, 'xlsx' cho excel) HOẶC 'create_voice' để xuất file thực tế gửi lên Zalo!\n` +
      `       * Với slide PowerPoint (.pptx): Phải chia nội dung thành các slide rõ ràng bằng các tiêu đề markdown '# Tiêu đề slide' và nội dung gạch đầu dòng chi tiết cho từng slide.\n` +
      `       * TUYỆT ĐỐI CẤM CHỈ GÕ DÀN Ý BẰNG CHỮ RỒI HỎI NGƯỢC LẠI NGƯỜI DÙNG có muốn soạn không. Hãy hành động và xuất file ngay lập tức!\n` +
      `       * [QUY TẮC BẢO LƯU NGUYÊN VẸN TRI THỨC KHI ĐÓNG GÓI / XUẤT FILE ĐA LĨNH VỰC]:\n` +
      `         - Khi người dùng yêu cầu 'đóng gói', 'xuất file', 'lưu vào file', 'chuyển thành file' (Word/docx, Excel/xlsx, PowerPoint/pptx, PDF, CSV, TXT...) từ nội dung tin nhắn được trích dẫn (quote) hoặc nội dung đã bàn luận trước đó:\n` +
      `         - BẮT BUỘC PHẢI BẢO LƯU NGUYÊN VẸN 100% TOÀN BỘ NỘI DUNG CHI TIẾT GỐC VÀO THAM SỐ 'content' CỦA TOOL 'generate_file' (bao gồm đầy đủ căn cứ/điều khoản pháp luật, bảng biểu/số liệu tài chính - BĐS, toàn bộ lời thoại/phân cảnh kịch bản media, mã nguồn/kiến trúc kỹ thuật, quy chế doanh nghiệp...). TUYỆT ĐỐI CẤM tự ý tóm tắt thành dàn ý gạch đầu dòng sơ sài làm mất mát dữ liệu và tri thức chuyên sâu của người dùng!\n` +
      `       * [QUY TẮC NỘI DUNG VOICE / TTS CHO MỌI LĨNH VỰC (Thơ ca, Tin tức, Pháp luật, Tài chính, Kịch bản, Kể chuyện)]: Khi gọi 'create_voice', tham số 'text' CHỈ ĐƯỢC CHỨA NỘI DUNG CỐT LÕI CẦN ĐỌC THÀNH TIẾNG (Tên tác phẩm/bản tin/điều luật, Tác giả/Nguồn nếu có, và toàn bộ nội dung chi tiết bài thơ / tin tức / đối thoại / câu chuyện). TUYỆT ĐỐI CẤM đưa lời chào xưng hô (@mention, 'Dạ Sếp...', 'Em xin gửi...'), lời dẫn phiếm đàm ('Dưới đây là...'), thông báo tiến độ ('Hệ thống đang xử lý qua worker...'), câu hỏi kết thúc ('Sếp có muốn...', 'Chúc bạn nghe vui...'), ĐẶC BIỆT TUYỆT ĐỐI CẤM đưa các đoạn phân tích, bình luận, cảm nhận, ý nghĩa, bối cảnh sáng tác hay giải thích bên dưới vào tham số 'text' của giọng đọc (người dùng chỉ muốn nghe chính tác phẩm, không nghe phân tích ngoài lề)!\n` +
       `       * [KỊCH BẢN ĐỐI THOẠI / PODCAST 2 NGƯỜI]: Khi người dùng yêu cầu kịch bản 2 người nói chuyện, cuộc đối thoại, hoặc podcast 2 người: BẮT BUỘC tự động soạn kịch bản đối đáp sinh động, phân vai rõ ràng theo từng lượt nói (ví dụ: 'Nam: ...\nNữ: ...' hoặc 'MC Nam: ...\nKhách mời: ...', có thể thêm cảm xúc trong ngoặc như 'Nam (hào hứng): ...') và BẮT BUỘC GỌI 'create_voice' truyền toàn bộ kịch bản vào tham số 'text' để hệ thống tự động tổng hợp thành file Podcast .m4a 2 giọng gửi lên Zalo!\n` +
      `       * TUYỆT ĐỐI CẤM in cú pháp giả lập dạng '[create_voice text="..."]' hoặc '[generate_file(...)]' ra tin nhắn văn bản! BẮT BUỘC PHẢI THỰC SỰ GỌI FUNCTION CALLING CỦA TOOL!\n` +
      `     * [QUY ĐỊNH CÂU TRẢ LỜI BẰNG CHỮ KÈM THEO]:\n` +
      `       + Với Slide PowerPoint (.pptx), File Word (.docx), Excel (.xlsx): Câu trả lời bằng chữ chỉ cần ngắn gọn 1-3 dòng tóm tắt và thông báo file đã gửi, không xả hàng chục trang vào chat Zalo.\n` +
      `       + Với Yêu cầu Voice / Đọc bài thơ / Ngâm thơ / Đọc tin tức / Kịch bản / Kể chuyện: BẮT BUỘC PHẢI IN TOÀN BỘ NỘI DUNG BÀI THƠ / BÀI VIẾT / KỊCH BẢN ĐẦY ĐỦ RA TIN NHẮN CHAT (ghi rõ Tên bài thơ/tác phẩm, Tác giả nếu có, và toàn văn từng dòng từng khổ). TUYỆT ĐỐI KHÔNG được chỉ gửi mỗi câu thông báo 1 dòng nhận việc mà quên in nội dung!\n` +
      `     * [TUYỆT ĐỐI CẤM BỊA ĐẶT / ẢO GIÁC VỀ GIỚI HẠN KỸ THUẬT]:\n` +
      `       + TUYỆT ĐỐI CẤM bịa đặt các câu như 'hạn mức 2 tác vụ/giờ', 'đạt ngưỡng hệ thống', 'chỉ chủ nhân mới có quyền', 'lát nữa em mới thu âm', 'uống trà đợi em'. Khi người dùng yêu cầu, PHẢI THỰC HIỆN NGAY LẬP TỨC!\n` +
      `       * TUYỆT ĐỐI CẤM TỰ Ý BỊA ĐẶT TIN NHẮN GIẢ MẠO rằng "em đã xuất xong file", "đã gửi file" khi CHƯA THỰC SỰ GỌI TOOL!\n` +
      `   - [KỸ NĂNG VẼ BIỂU ĐỒ, HÌNH ẢNH, SƠ ĐỒ, POSTER & ĐỒ HỌA BẰNG PYTHON (python_interpreter)]:\n` +
      `     + Khi người dùng yêu cầu vẽ biểu đồ, sơ đồ quy trình, mindmap hoặc thiết kế đồ họa / poster / bảng lịch thi đấu / bảng xếp hạng, HOẶC khi người dùng chê ảnh xấu/lỗi font và yêu cầu làm lại cẩn thận:\n` +
      `       BẮT BUỘC sử dụng công cụ 'python_interpreter'. TUYỆT ĐỐI CẤM gõ code Python bằng chữ vào tin nhắn chat Zalo!\n` +
      `     + VỚI LỊCH THI ĐẤU, BẢNG XẾP HẠNG, SƠ ĐỒ, ROADMAP: BẮT BUỘC dùng PIL thiết kế INFOGRAPHIC POSTER CARD LAYOUT khổ dọc (W=720, H=1100-1400), nền tối sang trọng (thể thao dùng burgundy #42030D, doanh nghiệp dùng navy #0B132B), thẻ bo góc rounded_rectangle, badge trạng thái ([CHÍNH THỨC], [GIAO HỮU], [LỘ TRÌNH]), tiêu đề vàng kim #FFD700 nổi bật, hàng dữ liệu phân tầng rõ ràng, dùng get_font(size, bold) chuẩn tiếng Việt 100% không lỗi ô vuông. TUYỆT ĐỐI KHÔNG vẽ biểu đồ cột [1, 1, 1] cho lịch thi đấu!\n` +
      `     + VỚI SỐ LIỆU ĐỊNH LƯỢNG (% tăng trưởng, doanh thu, giá cả): Dùng matplotlib với plt.style.use('dark_background') và plt.savefig('chart.png', dpi=150, bbox_inches='tight').\n` +
      `     + Hệ thống sẽ tự động bắt file ảnh PNG được tạo ra và gửi trực tiếp lên nhóm Zalo!\n` +
      `     + TUYỆT ĐỐI CẤM từ chối hoặc bảo người dùng nhờ designer vẽ lại! Hãy chủ động viết code Python tự vẽ và xuất file ảnh ngay lập tức!\n` +
      `   - [KHI CÂU HỎI LÀ TỔNG QUAN DỰ ÁN BẤT ĐỘNG SẢN / CÔNG TRÌNH / HỒ SƠ THƯƠNG MẠI]:\n` +
      `     + BẮT BUỘC cấu trúc câu trả lời chuyên nghiệp, sắc nét, đầy đủ theo các phân mục rõ ràng:\n` +
      `       • 🏢 TỔNG QUAN DỰ ÁN (Tên thương mại, Chủ đầu tư/đơn vị phát triển, Đơn vị thiết kế/thi công, Tổng vốn đầu tư, Mốc khởi công & dự kiến bàn giao).\n` +
      `       • 📍 1. Vị trí đắc địa & Kết nối giao thông (Địa chỉ chi tiết, lợi thế ven sông/hồ, cự ly kết nối tới bệnh viện, TTTM, hạ tầng trọng điểm).\n` +
      `       • 📐 2. Quy mô & Cơ cấu sản phẩm (Diện tích khu đất, số lượng tháp/tầng, chi tiết từng loại hình: Căn hộ ở 1-3PN, Căn hộ Officetel, Shophouse khối đế, diện tích từng loại).\n` +
      `       • 🌿 3. Tiện ích & Phong cách sống (Phát triển theo phong cách gì, hồ bơi, gym, yoga, sauna, mảng xanh, tiện ích đặc quyền).\n` +
      `       • 💰 4. Giá bán & Chính sách tham khảo (Giá rumor/dự kiến đợt 1 từng loại hình, chính sách bán hàng hoặc vay vốn nếu có).\n` +
      `     + In đậm các số liệu quan trọng, trình bày gạch đầu dòng rõ ràng, mạch lạc, tối ưu hiển thị trên giao diện chat Zalo.\n` +
      `   - [CHỐNG BẺ LÁI SANG BẤT ĐỘNG SẢN]: Khi người dùng hỏi về địa lý, xã hội, khoa học, chính trị, thể thao, công nghệ, lịch sử: PHẢI TRẢ LỜI ĐÚNG TRỌNG TÂM, CẤM tự ý suy diễn người hỏi đi du lịch hay lôi chuyện bất động sản/mua bán đất vào câu trả lời nếu người dùng không hỏi về BĐS!`;

    let quoteLiveNews = "";
    let quoteEvidenceRequired = false;
    let quotePlan: QueryPlanResult | null = null;
    const isFileOrVoiceReq = checkIsFileOrVoiceGeneration(question, options.quote.text);
    try {
      const plan = await planSearchQueries({
        question,
        quoteText: options.quote.text,
        recentContext: recentChatContext,
        displayName,
      });
      quotePlan = plan;

      if (!isFileOrVoiceReq && plan.needsSearch && plan.queries.length > 0) {
        quoteEvidenceRequired = plan.intent === "fact_check" && isStrictVerificationQuestion(question);
        const searchQueries = plan.queries.slice(0, 2);
        const searchPromises = Promise.all(
          searchQueries.map((q) => searchRealtimeNews(q, {
            intent: plan.intent,
            requireEvidence: quoteEvidenceRequired,
          }).catch(() => ""))
        );
        let searchTimer: NodeJS.Timeout | undefined;
        const searchTimeout = new Promise<string[]>((resolve) => {
          searchTimer = setTimeout(() => {
            console.warn(`[member-assistant] ⏱️ Quote QA timeout quét tìm kiếm (6s), tiếp tục với dữ liệu sẵn có`);
            resolve([]);
          }, 6000);
        });
        const searchResults = await Promise.race([searchPromises, searchTimeout]);
        if (searchTimer) clearTimeout(searchTimer);
        quoteLiveNews = searchResults.filter(Boolean).join("\n\n---\n\n");
      }
    } catch (e) {
      console.warn("[member-assistant] Quote QA planSearchQueries error:", e);
    }

    // Tra cứu bổ trợ GitHub nếu hỏi về link / repo / mã nguồn / thư viện / mô hình AI mà trong nhóm CHƯA có
    let quoteGithubRepoResults: { title: string; snippet: string; url: string }[] = [];
    const isResourceOrRepo = /(?:link|đường dẫn|repo|github|source|mã nguồn|thư viện|library|model|mô hình)/i.test(question) ||
      /(?:zerotts|vieneu|vits|xtts|whisper|llama|deepseek|claude|gpt|kokoro|f5-tts)/i.test(`${question} ${options.quote.text}`);
    if (isResourceOrRepo && quoteRelevantLinks.length === 0) {
      try {
        const cleanEntity = `${question} ${options.quote.text}`
          .replace(/@[^\s,!?]+/g, " ")
          .replace(/(?:mình|nhóm|có|chưa|vậy|cho|xin|link|của|đường dẫn|repo|mã nguồn|source|sen chúa|mộc miên|kevin|bot|ơi|nhé|nha|ạ|với|giúp|móa|nghe|con|hay|hơn|hẳn)/gi, " ")
          .replace(/[?!,.:;"'()\[\]{}–—\-]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const entityMatch = cleanEntity.match(/\b([A-Za-z0-9_.-]{2,30})\b/);
        const searchKeyword = entityMatch ? entityMatch[1] : cleanEntity.slice(0, 30);
        if (searchKeyword && searchKeyword.length >= 2) {
          quoteGithubRepoResults = await githubSearch(searchKeyword, 3);
          if (quoteGithubRepoResults.length > 0) {
            const githubSection =
              `=== KHO LƯU TRỮ MÃ NGUỒN CHÍNH THỨC TRÊN GITHUB (TRA CỨU THỜI GIAN THỰC): ===\n` +
              quoteGithubRepoResults
                .map((repo, idx) => `${idx + 1}. [${repo.title}](${repo.url})\n   Mô tả: ${repo.snippet}\n   URL: ${repo.url}`)
                .join("\n\n") +
              `\n\nCHỈ DẪN BẮT BUỘC: Thành viên hỏi link/mã nguồn của dự án này. BẮT BUỘC cung cấp link GitHub chính thức ở trên (${quoteGithubRepoResults[0]?.url || ""}) kèm các đường link trang chủ/demo khác (nếu có) cho thành viên ngay trong câu trả lời!`;
            quoteLiveNews = quoteLiveNews ? `${githubSection}\n\n---\n\n${quoteLiveNews}` : githubSection;
          }
        }
      } catch (e) {
        console.warn("[member-assistant] Quote QA githubSearch error:", e);
      }
    }

    const quoteLiveNewsSection = quoteLiveNews
      ? `\n=== DỮ LIỆU THỜI GIAN THỰC & BÁCH KHOA MỚI NHẤT: ===\n${quoteLiveNews}\n`
      : "";

    const quoteUserPrompt =
      `BẠN ĐANG TƯƠNG TÁC TẠI NHÓM "${currentGroupName}".\n` +
      `${recentChatContext}\n` +
      `=== NỘI DUNG ĐƯỢC TRÍCH DẪN (TỪ ${options.quote.senderName || "THÀNH VIÊN"}): ===\n` +
      `"${options.quote.text}"\n` +
      `${quoteDocSection}${quoteLinksSection}${quoteLiveNewsSection}\n` +
      `YÊU CẦU / ${isSuperAdmin ? "CHỈ ĐẠO TỪ SẾP" : "CÂU HỎI TỪ THÀNH VIÊN"} (${displayName}): ${question || "Hãy giải thích ngắn gọn nội dung này giúp tôi."}\n\n` +
      `HÃY TRẢ LỜI NGAY DỰA TRÊN DỮ LIỆU MỚI NHẤT ĐƯỢC CUNG CẤP:`;

    let answer = "";
    let voiceGenerated = false;
    const isGreetingQuote =
      /^(?:chào|hi|hello|alo|ê|cảm ơn|thanks|ok)\b/i.test(question.trim()) && question.trim().length < 25;
    try {
      const needsAgentLoop = checkIsFileOrVoiceGeneration(question, options.quote.text) || /(?:đọc link|tải trang|cào web|check link)\s+https?:/i.test(question);
      if (needsAgentLoop && !isGreetingQuote) {
        answer = await callGeminiAgentLoop(quoteSystemPrompt, quoteUserPrompt, {
          model: "gemini-3.1-flash-lite-preview",
          maxTurns: 3,
          mediaParts: mediaPart ? [mediaPart] : undefined,
          onFileGenerated: async (file) => {
            try {
              if (options?.api) {
                const isSlide = /\.(pptx|ppt)$/i.test(file.filePath);
                const isImg = /\.(png|jpg|jpeg|webp)$/i.test(file.filePath);
                const isVoice = /\.(m4a|mp3|wav|aac)$/i.test(file.filePath);
                if (isVoice) voiceGenerated = true;
                const caption = file.caption || (
                  isSlide
                    ? `📊 ${botName} đã soạn xong bài thuyết trình PowerPoint [${file.fileName}] cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`
                    : isImg
                      ? `📊 Biểu đồ / Hình ảnh đã hoàn tất cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`
                      : isVoice
                        ? `🎙️ ${botName} gửi voice cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`
                        : `📄 ${botName} đã tạo xong file [${file.fileName}] cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`
                );
                if (isVoice) {
                  await sendGroupVoice(
                    options.api,
                    threadId,
                    file.filePath,
                    caption,
                  );
                } else {
                  await sendGroupFile(
                    options.api,
                    threadId,
                    file.filePath,
                    caption,
                  );
                }
              }
            } catch (fileErr) {
              console.warn("[member-assistant] Quote QA sendGroupFile error:", fileErr);
            }
          },
        });
      } else {
        const quoteNeedsSearch = Boolean(quotePlan?.needsSearch || quoteLiveNews);
        const quoteSignals = normalizeExecutionSignals(
          quotePlan ? { ...quotePlan } : null,
          {
            question,
            quoteText: options.quote.text,
            needsSearch: quoteNeedsSearch,
            intent: quotePlan?.intent || (quoteNeedsSearch ? "fact_check" : "knowledge"),
          },
        );
        const responseMode = selectResponseMode({
          signals: quoteSignals,
          needsSearch: quoteNeedsSearch,
          explicitToolRequest: false,
          hasMedia: Boolean(mediaPart),
        });
        answer = await answerWithHybridRouting(config.hybridAgent, {
          mode: responseMode,
          systemPrompt: quoteSystemPrompt,
          userPrompt: quoteUserPrompt,
          sessionKey: `${config.botId}:group:${threadId}:user:${options.sender || displayName}`,
          isOwner: isSuperAdmin,
          explicitToolRequest: false,
          hasMedia: Boolean(mediaPart),
          fallback: async () => await callGemini(quoteSystemPrompt, quoteUserPrompt, {
            model: "gemini-3.1-flash-lite-preview",
            mediaParts: mediaPart ? [mediaPart] : undefined,
            enableSearch: false,
          }),
        });
      }
      answer = await interceptAndExecuteSimulatedTool(answer, async (file) => {
        if (options?.api) {
          const isVoice = /\.(m4a|mp3|wav|aac)$/i.test(file.filePath);
          if (isVoice) {
            voiceGenerated = true;
            await sendGroupVoice(
              options.api,
              threadId,
              file.filePath,
              file.caption || `🎙️ ${botName} gửi voice cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`,
            );
          } else {
            await sendGroupFile(
              options.api,
              threadId,
              file.filePath,
              file.caption || `📄 ${botName} gửi file [${file.fileName}] cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`,
            );
          }
        }
      });

      // 🛡️ PHÒNG THỦ CHIỀU SÂU: Nếu người dùng yêu cầu Voice/Đọc thơ mà chưa có file voice nào được gửi
      if (checkIsVoiceRequest(question, options?.quote?.text) && !voiceGenerated && options?.api) {
        try {
          let speechText = extractSpeechFallbackText(answer);
          if (!speechText || speechText.length < 15) {
            console.log(`[member-assistant] 🔍 [Quote QA] Answer thiếu nội dung cốt lõi để đọc voice, đang gọi nhanh AI trích xuất nội dung từ yêu cầu: "${question}"...`);
            const directContent = await callGemini(
              `Bạn là trợ lý trích xuất văn bản đọc giọng. Hãy cung cấp ĐẦY ĐỦ, CHÍNH XÁC toàn bộ nội dung bài thơ, bài viết, kịch bản hoặc lời thoại được yêu cầu trong câu hỏi của người dùng.
QUY TẮC BẮT BUỘC:
1. Chỉ in: Tên tác phẩm/bài thơ, Tác giả (nếu có), và TOÀN BỘ NỘI DUNG TỪNG DÒNG của bài thơ / văn bản / kịch bản.
2. TUYỆT ĐỐI KHÔNG có lời chào (@mention, Dạ Sếp, Xin chào), KHÔNG có lời giải thích, KHÔNG có câu kết, KHÔNG bịa đặt giới hạn kỹ thuật.`,
              `Yêu cầu: "${question}". Trích dẫn nếu có: "${options?.quote?.text || ""}".`,
              { model: "gemini-flash-latest" },
            ).catch(() => "");
            if (directContent && directContent.length >= 15) {
              const cleanedDirect = cleanCoreSpeechText(directContent);
              speechText = (cleanedDirect && cleanedDirect.length >= 15) ? cleanedDirect : directContent.trim();
              if (speechText && !answer.toLowerCase().includes(speechText.slice(0, 30).toLowerCase())) {
                answer = `${answer}\n\n${speechText}`.trim();
              }
            }
          }

          if (speechText && speechText.length >= 15) {
            console.log(`[member-assistant] 🛡️ [Quote QA] Kích hoạt voice fallback tự động (${speechText.length} ký tự)...`);
            const vRes = await executeAgentTool("create_voice", {
              text: speechText,
              caption: `🎙️ ${botName} gửi bản đọc diễn cảm cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`,
            });
            if (vRes?.success && vRes?.filePath) {
              voiceGenerated = true;
              answer = cleanOutdatedVoicePromisesFromAnswer(answer);
              await sendGroupVoice(
                options.api,
                threadId,
                vRes.filePath,
                vRes.caption || `🎙️ ${botName} gửi bản đọc diễn cảm cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`,
              );
            }
          }
        } catch (fbVoiceErr) {
          console.warn("[member-assistant] Quote QA lỗi sinh voice fallback:", fbVoiceErr);
        }
      }
      return finalizeGroundedAnswer(answer, quoteLiveNews, quoteEvidenceRequired, {
        intent: quotePlan?.intent,
        question,
      });
    } catch (e) {
      console.warn("[member-assistant] Fast-path Quote QA error:", e);
    }
  }

  // 2. Tra cứu Kho tri thức & Bộ nhớ dài hạn (Long-term Knowledge Memory)
  let memorizedDocs: any[] = [];
  try {
    memorizedDocs = searchGroupKnowledge(threadId, question, 5);
  } catch { }

  // 2.1. Phân loại ý định câu hỏi: hỏi quy trình/kinh nghiệm/thảo luận hay chỉ xin link tải
  const isDiscussionOrProcessQuery =
    /quy trình|quy trinh|cách làm|cach lam|hướng dẫn|huong dan|kinh nghiệm|kinh nghiem|thảo luận|thao luan|bàn về|chia sẻ|chia se|bước|buoc|làm sao|lam sao|tổng hợp|nói gì|bảo gì/i.test(
      question,
    );

  const isOnlyLinkQuery =
    /(?:cho xin|gửi|xin|danh sách|check|lấy|tìm|tổng hợp|xem|liệt kê|toàn bộ|tất cả)\s*(?:các\s*)?(?:link|đường dẫn|repo|mã nguồn|source)/i.test(question) &&
    !isDiscussionOrProcessQuery;

  const isResourceQuery =
    isOnlyLinkQuery ||
    /link|repo|github|tài liệu|tai lieu|mã nguồn|source/i.test(question);

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
      relevantLinks = searchRelevantLinksAndResources(threadId, question, isOnlyLinkQuery ? 50 : 20);
    } catch (e) {
      console.warn("[handleHistoryQA] Lỗi searchRelevantLinksAndResources:", e);
    }
  }

  // 2.4b. Nếu hỏi link / repo / mã nguồn mà trong nhóm chưa từng chia sẻ:
  // Tự động kích hoạt GitHub API tra cứu mã nguồn mở bổ trợ (đối với câu hỏi công nghệ/thư viện/mô hình/tool)
  let githubRepoResults: { title: string; snippet: string; url: string; date?: string }[] = [];
  if (isResourceQuery && relevantLinks.length === 0) {
    const isTechOrRepo =
      /(?:repo|github|source|mã nguồn|thư viện|library|model|mô hình|tts|ai|bot|tool|framework|code|script|package)/i.test(question) ||
      /(?:zerotts|vieneu|vits|xtts|whisper|llama|deepseek|claude|gpt|kokoro|f5-tts)/i.test(question);
    if (isTechOrRepo) {
      try {
        const cleanEntity = question
          .replace(/@[^\s,!?]+/g, " ")
          .replace(/(?:mình|nhóm|có|chưa|vậy|cho|xin|link|của|đường dẫn|repo|mã nguồn|source|sen chúa|mộc miên|kevin|bot|ơi|nhé|nha|ạ|với|giúp)/gi, " ")
          .replace(/[?!,.:;"'()\[\]{}–—\-]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (cleanEntity.length >= 2) {
          githubRepoResults = await githubSearch(cleanEntity, 3);
          console.log(`[handleHistoryQA] 🐙 githubRepoResults found: ${githubRepoResults.length} for "${cleanEntity}"`);
        }
      } catch (e) {
        console.warn("[handleHistoryQA] Lỗi githubSearch bổ trợ:", e);
      }
    }
  }

  // 3. Lấy danh sách tin nhắn gần nhất trong nhóm (chỉ lấy 15 tin gần nhất để giữ context gọn gàng, trả lời siêu tốc)
  let relevantMessages: { display_name: string; text: string; ts: number; is_self: number }[] = [];
  try {
    relevantMessages = db
      .prepare(
        `SELECT display_name, text, ts, is_self
         FROM group_messages
         WHERE thread_id = ?
           AND text IS NOT NULL
           AND text != ''
           AND deleted_at IS NULL
           AND text NOT LIKE '/%'
           AND text NOT LIKE '!%'
         ORDER BY ts DESC
         LIMIT 20`,
      )
      .all(threadId) as any[];
    relevantMessages.reverse();
  } catch { }

  // 4. Lấy tóm tắt 3 ngày gần nhất (CHỈ lấy khi câu hỏi thực sự hỏi về diễn biến các ngày qua)
  let pastSummaries: { day_label: string; summary_text: string }[] = [];
  const isRankQuery = /(?:bảng xếp hạng|bxh|top|ai chăm nhất|ai nhắn nhiều|điểm tương tác|tương tác nhất)/i.test(question);
  const isInactiveQuery = /(?:tàu ngầm|tau ngam|nằm vùng|nam vung|ai chưa nhắn|ai lặn|chưa từng chat|chưa từng nhắn)/i.test(question);

  // 5. Lấy top 5 thành viên năng nổ nhất (chỉ lấy khi câu hỏi hỏi về bảng xếp hạng)
  let topMembers: { display_name: string; msg_count: number; points: number }[] = [];
  if (isRankQuery) {
    try {
      let fromTable = "members";
      let groupFilter = "m.group_id = @threadId";
      const hasGroupMembers = db.prepare(`SELECT 1 FROM group_members WHERE group_id = ? AND is_active = 1 LIMIT 1`).get(threadId);
      if (hasGroupMembers) {
        fromTable = "group_members";
        groupFilter = "m.group_id = @threadId";
      }
      topMembers = db
        .prepare(
          `SELECT m.display_name,
                  COUNT(i.id) AS msg_count,
                  COALESCE(SUM(CASE i.type WHEN 'message' THEN 10 WHEN 'image' THEN 10 WHEN 'video' THEN 10 WHEN 'vote' THEN 3 WHEN 'reaction' THEN 1 ELSE 1 END), 0) AS points
           FROM ${fromTable} m
           JOIN interactions i ON i.zalo_user_id = m.zalo_user_id AND i.thread_id = @threadId
           WHERE ${groupFilter}
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
    } catch { }
  }

  // 6. Thống kê thành viên chưa từng nhắn tin (chỉ lấy khi câu hỏi hỏi về tàu ngầm / nằm vùng)
  let inactiveMembers: { display_name: string; msg_count: number }[] = [];
  let totalMembersInGroup: { total: number } | undefined;
  if (isInactiveQuery) {
    try {
      let fromTable = "members";
      let groupFilter = "m.group_id = @threadId";
      let totalFilter = "group_id = ?";
      const hasGroupMembers = db.prepare(`SELECT 1 FROM group_members WHERE group_id = ? AND is_active = 1 LIMIT 1`).get(threadId);
      if (hasGroupMembers) {
        fromTable = "group_members";
        groupFilter = "m.group_id = @threadId";
        totalFilter = "group_id = ?";
      }
      inactiveMembers = db
        .prepare(
          `SELECT m.display_name,
                  COUNT(CASE WHEN i.type = 'message' THEN 1 END) AS msg_count
           FROM ${fromTable} m
           LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id AND i.thread_id = @threadId
           WHERE ${groupFilter}
             AND m.is_active = 1
             AND LOWER(m.display_name) NOT LIKE '%sen chúa%'
             AND LOWER(m.display_name) NOT LIKE '%sen chua%'
           GROUP BY m.zalo_user_id, m.display_name
           HAVING msg_count = 0`,
        )
        .all({ threadId }) as any[];

      totalMembersInGroup = db
        .prepare(
          `SELECT COUNT(*) AS total FROM ${fromTable} WHERE ${totalFilter} AND is_active = 1 AND LOWER(display_name) NOT LIKE '%sen chúa%'`,
        )
        .get(threadId) as { total: number } | undefined;
    } catch { }
  }

  // 6.5. Tra cứu dữ liệu thành viên & ban quản trị nhóm (Member & Group Administration Intelligence)
  const memberDetailsLines: string[] = [];
  let isTargetMemberFound = false;

  const isMemberOrGroupQuery =
    /(?:vào nhóm|tham gia nhóm|gia nhập nhóm|vào từ khi nào|tham gia từ khi nào|gia nhập từ khi nào|ở trong nhóm bao lâu|ở nhóm bao lâu)/i.test(question) ||
    /(?:thành viên.*(?:nhóm|vào|tham gia|khi nào|bao giờ|mới|cũ|ai)|ai.*(?:vào nhóm|tham gia|mới vào))/i.test(question) ||
    /(?:ai là|danh sách)?\s*(?:trưởng nhóm|phó nhóm|admin nhóm|quản trị viên|chủ phòng|chủ nhóm)/i.test(question) ||
    /(?:nhóm|group).*(?:có bao nhiêu|mấy người|bao nhiêu thành viên|sĩ số|tổng số)/i.test(question);

  try {
    let fromTable = "members";
    let groupFilter = "group_id = ?";
    const hasGroupMembers = db.prepare(`SELECT 1 FROM group_members WHERE group_id = ? AND is_active = 1 LIMIT 1`).get(threadId);
    if (hasGroupMembers) {
      fromTable = "group_members";
    }

    const ownBotId = typeof options?.api?.getOwnId === "function" ? String(options.api.getOwnId()).trim() : "";
    const matchedMembers: any[] = [];
    const seenUids = new Set<string>();

    // A. Tìm theo mention UID trong tin nhắn
    if (options?.mentions && options.mentions.length > 0) {
      for (const m of options.mentions) {
        const uid = String((m as any)?.uid || (m as any)?.id || "").trim();
        if (uid && uid !== ownBotId && !seenUids.has(uid)) {
          seenUids.add(uid);
          const row = db.prepare(`SELECT * FROM ${fromTable} WHERE ${groupFilter} AND zalo_user_id = ?`).get(threadId, uid) as any;
          if (row) {
            const dName = String(row.display_name || "").toLowerCase();
            const isBotAccount =
              dName.includes("sen chúa") ||
              dName.includes("sen chua") ||
              dName.includes("mộc miên") ||
              dName.includes("moc mien") ||
              dName.includes("kevin") ||
              row.role === "bot";
            if (!isBotAccount) {
              matchedMembers.push(row);
            }
          }
        }
      }
    }

    // B. Tìm theo tên thành viên xuất hiện trong câu hỏi (hoặc rawText)
    const textToSearch = `${question} ${options?.rawText || ""}`.toLowerCase();
    try {
      const allGMembers = db.prepare(`SELECT zalo_user_id, display_name, role, joined_at, first_seen_at, is_active, left_at FROM ${fromTable} WHERE ${groupFilter}`).all(threadId) as any[];
      for (const gm of allGMembers) {
        const dName = (gm.display_name || "").trim().toLowerCase();
        if (dName.length >= 3 && !seenUids.has(gm.zalo_user_id) && textToSearch.includes(dName) && !dName.includes("sen chúa") && !dName.includes("mộc miên")) {
          seenUids.add(gm.zalo_user_id);
          matchedMembers.push(gm);
        }
      }
    } catch {}

    function formatVnDateTime(ts: number | null | undefined): string {
      if (!ts || !Number.isFinite(ts)) return "Chưa có dữ liệu chính xác";
      try {
        const d = new Date(ts + 7 * 3600 * 1000);
        const day = String(d.getUTCDate()).padStart(2, "0");
        const month = String(d.getUTCMonth() + 1).padStart(2, "0");
        const year = d.getUTCFullYear();
        const hours = String(d.getUTCHours()).padStart(2, "0");
        const minutes = String(d.getUTCMinutes()).padStart(2, "0");
        return `${hours}:${minutes} ngày ${day}/${month}/${year}`;
      } catch {
        return "Không xác định";
      }
    }

    if (matchedMembers.length > 0) {
      isTargetMemberFound = true;
      memberDetailsLines.push("=== THÔNG TIN THÀNH VIÊN TRONG NHÓM (TRÍCH XUẤT CHÍNH XÁC TỪ CƠ SỞ DỮ LIỆU NỘI BỘ NHÓM) ===");
      for (const gm of matchedMembers) {
        let msgCount = 0;
        let lastMsgTimeStr = "";
        try {
          const stats = db.prepare("SELECT COUNT(*) as count, MAX(ts) as lastMsg FROM group_messages WHERE thread_id = ? AND zalo_user_id = ?").get(threadId, gm.zalo_user_id) as any;
          msgCount = stats?.count || 0;
          if (stats?.lastMsg) {
            lastMsgTimeStr = formatVnDateTime(stats.lastMsg);
          }
        } catch {}

        const roleLabel = gm.role === "owner" ? "Trưởng nhóm (Chủ phòng)" : gm.role === "admin" ? "Quản trị viên (Phó nhóm)" : "Thành viên";
        const statusLabel = gm.is_active === 1 ? "Đang là thành viên của nhóm" : `Đã rời nhóm (lúc ${formatVnDateTime(gm.left_at)})`;
        const joinedStr = gm.joined_at ? formatVnDateTime(gm.joined_at) : (gm.first_seen_at ? `Khoảng ${formatVnDateTime(gm.first_seen_at)} (theo mốc ghi nhận của hệ thống)` : "Chưa có dữ liệu chính xác");
        const firstSeenStr = gm.first_seen_at ? formatVnDateTime(gm.first_seen_at) : "Chưa rõ";

        memberDetailsLines.push(
          `- Thành viên: ${gm.display_name} (ID: ${gm.zalo_user_id})\n` +
          `  + Vai trò: ${roleLabel}\n` +
          `  + Trạng thái: ${statusLabel}\n` +
          `  + Thời điểm gia nhập nhóm (Zalo ghi nhận): ${joinedStr}\n` +
          `  + Thời điểm hệ thống bot ghi nhận lần đầu: ${firstSeenStr}\n` +
          `  + Hoạt động trò chuyện: Đã gửi ${msgCount} tin nhắn trong nhóm ${msgCount === 0 ? "(chưa từng nhắn tin / thuộc diện thành viên tàu ngầm, nằm vùng)" : `(tin nhắn gần nhất: ${lastMsgTimeStr})`}`
        );
      }
      memberDetailsLines.push(
        "CHỈ DẪN BẮT BUỘC: Câu hỏi của thành viên đang hỏi về người có trong danh sách trên. BẮT BUỘC sử dụng các thông tin, thời điểm gia nhập và thống kê chính xác ở trên để trả lời. TUYỆT ĐỐI KHÔNG tự bịa đặt, TUYỆT ĐỐI KHÔNG dẫn nguồn báo chí/web ngoài lề!"
      );
    } else if (isMemberOrGroupQuery) {
      // Nếu hỏi về thành viên mới nhất
      if (/(?:mới vào|mới tham gia|mới gia nhập|gần đây)/i.test(question)) {
        try {
          const newest = db.prepare(`SELECT display_name, joined_at, first_seen_at FROM ${fromTable} WHERE ${groupFilter} AND is_active = 1 ORDER BY COALESCE(joined_at, first_seen_at) DESC LIMIT 5`).all(threadId) as any[];
          if (newest.length > 0) {
            memberDetailsLines.push("=== DANH SÁCH THÀNH VIÊN MỚI GIA NHẬP GẦN ĐÂY ===");
            newest.forEach((m, idx) => {
              memberDetailsLines.push(`${idx + 1}. ${m.display_name} - Gia nhập lúc: ${formatVnDateTime(m.joined_at || m.first_seen_at)}`);
            });
          }
        } catch {}
      }

      // Nếu hỏi về ban quản trị / admin / trưởng nhóm
      if (/(?:trưởng nhóm|phó nhóm|admin|quản trị viên|chủ phòng|chủ nhóm|ban quản trị)/i.test(question)) {
        try {
          const admins = db.prepare(`SELECT display_name, role FROM ${fromTable} WHERE ${groupFilter} AND role IN ('owner', 'admin') AND is_active = 1`).all(threadId) as any[];
          if (admins.length > 0) {
            memberDetailsLines.push("=== DANH SÁCH BAN QUẢN TRỊ NHÓM ===");
            const owners = admins.filter(a => a.role === 'owner').map(a => a.display_name);
            const subAdmins = admins.filter(a => a.role === 'admin').map(a => a.display_name);
            if (owners.length > 0) memberDetailsLines.push(`- Trưởng nhóm / Chủ phòng: ${owners.join(', ')}`);
            if (subAdmins.length > 0) memberDetailsLines.push(`- Phó nhóm / Quản trị viên: ${subAdmins.join(', ')}`);
          }
        } catch {}
      }

      // Nếu hỏi về quy mô / tổng số thành viên
      if (/(?:bao nhiêu|mấy người|sĩ số|tổng số)/i.test(question)) {
        try {
          const totalActive = db.prepare(`SELECT COUNT(*) as count FROM ${fromTable} WHERE ${groupFilter} AND is_active = 1`).get(threadId) as any;
          memberDetailsLines.push(`=== QUY MÔ THÀNH VIÊN NHÓM ===\n- Tổng số thành viên hiện tại: ${totalActive?.count || "Không rõ"} người.`);
        } catch {}
      }
    }
  } catch (err) {
    console.warn("[handleHistoryQA] Lỗi tra cứu thông tin thành viên:", err);
  }

  // Dựng ngữ cảnh dữ liệu lịch sử
  const contextLines: string[] = [];

  if (memberDetailsLines.length > 0) {
    contextLines.push(memberDetailsLines.join("\n"));
  }

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

  // C2. Tài liệu & chính sách chính thức từ Kho tri thức vĩnh viễn (do Admin nạp) hoặc nạp trực tiếp qua Google link
  let permanentKnowledgeItems: PermanentKnowledgeItem[] = [];
  try {
    permanentKnowledgeItems = searchPermanentKnowledge(question, threadId, 2, options?.quote?.text || "");
    // Nếu có tài liệu động (Google Sheet / Google Doc), tự động làm mới thời gian thực nếu cache quá 60s
    for (const pk of permanentKnowledgeItems) {
      if (pk.sourceType === "google_sheet" || pk.sourceType === "google_doc") {
        await refreshDynamicKnowledgeIfExpired(pk);
      }
    }
  } catch (e) {
    console.warn("[handleHistoryQA] Lỗi searchPermanentKnowledge:", e);
  }

  let docTopicHeader = "";
  if (options?.directDocContent) {
    docTopicHeader = options.directDocTitle || "Tài liệu Google Doc/Sheet";
    contextLines.push(
      `=== TÀI LIỆU CHÍNH THỨC TRÍCH XUẤT TRỰC TIẾP TỪ LINK GOOGLE (${docTopicHeader.toUpperCase()}): ===\n${options.directDocContent.slice(0, 35000)}\n\n` +
      `CHỈ DẪN BẮT BUỘC: Đây là tài liệu gốc được cung cấp trực tiếp. BẮT BUỘC TRÍCH XUẤT 100% TỪ TÀI LIỆU NÀY, TUYỆT ĐỐI CẤM TỰ BỊA ĐẶT!`
    );
  } else if (permanentKnowledgeItems && permanentKnowledgeItems.length > 0) {
    docTopicHeader = permanentKnowledgeItems[0]?.topic || "KHO TRI THỨC VĨNH VIỄN";
    contextLines.push("=== TÀI LIỆU & CHÍNH SÁCH CHÍNH THỨC TỪ KHO TRI THỨC VĨNH VIỄN (DO ADMIN NẠP) ===");
    for (const pk of permanentKnowledgeItems) {
      const typeLabel =
        pk.sourceType === "google_sheet"
          ? " (Bảng tính Google Sheet trực tiếp)"
          : pk.sourceType === "google_doc"
            ? " (Văn bản Google Doc trực tiếp)"
            : "";
      contextLines.push(
        `[Chủ đề / Dự án: ${pk.topic.toUpperCase()}${typeLabel} - Nguồn: ${pk.title}]:\n` +
        (pk.summary ? `Tóm tắt cốt lõi:\n${pk.summary}\n` : "") +
        (pk.contentText ? `Nội dung chi tiết tài liệu thời gian thực:\n${pk.contentText.slice(0, 30000)}\n` : ""),
      );
    }
    contextLines.push(
      "CHỈ DẪN QUAN TRỌNG VỀ TÀI LIỆU KHO TRI THỨC: Câu hỏi của thành viên liên quan đến tài liệu/chính sách chính thức do Admin nạp ở trên. Bạn BẮT BUỘC phải trích dẫn chính xác 100% số liệu, chính sách chiết khấu, giá cả, các đợt thanh toán từ tài liệu này để giải đáp cho thành viên! TUYỆT ĐỐI CẤM TỰ BỊA ĐẶT!",
    );
  } else if (options?.strictDocMode) {
    return `⚠️ Em không tìm thấy tài liệu nào khớp với yêu cầu của bạn trong kho tri thức!\n\n👉 Để tra cứu chuẩn xác 100% không bịa đặt, bạn vui lòng:\n1. Gửi kèm link Google Doc/Sheet: /doc [link] [câu hỏi]\n2. Hoặc nhờ Admin nạp tài liệu vào kho bằng lệnh: /doc [tên_dự_án] [link] nhé!`;
  }

  // C3. Hồ sơ & Bộ nhớ dài hạn của thành viên đang hỏi (User Long-term Memory)
  let userMemorySection = "";
  if (options?.sender) {
    try {
      const userMemories = getUserMemories(options.sender, 6);
      if (userMemories.length > 0) {
        userMemorySection = formatUserMemoriesForPrompt(userMemories, displayName);
      }
    } catch (e) {
      console.warn("[handleHistoryQA] Lỗi getUserMemories:", e);
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
        "CHỈ DẪN QUAN TRỌNG: Thành viên đang yêu cầu TÌM KIẾM / LIỆT KÊ ĐẦY ĐỦ ĐƯỜNG LINK. " +
        "Bạn BẮT BUỘC PHẢI LIỆT KÊ 100% ĐẦY ĐỦ TẤT CẢ các link có trong danh sách ở trên theo dạng danh sách gạch đầu dòng (URL đầy đủ, Người chia sẻ, Ngày gửi, Ngữ cảnh/Nội dung tóm tắt). " +
        "TUYỆT ĐỐI KHÔNG tự ý bỏ sót bất kỳ link nào! TUYỆT ĐỐI KHÔNG tự ý chọn 1 link để ngồi phân tích dài dòng nếu người dùng chỉ hỏi danh sách link!"
      );
    } else {
      contextLines.push(
        "CHỈ DẪN QUAN TRỌNG: Nếu thành viên hỏi về QUY TRÌNH, CÁCH LÀM, KINH NGHIỆM hoặc NỘI DUNG THẢO LUẬN: Hãy ưu tiên TRÍCH XUẤT VÀ GIẢI THÍCH CHI TIẾT CÁC BƯỚC THỰC HIỆN từ các đoạn thảo luận/đúc kết ở trên. Sau đó đính kèm các đường link ở trên ở cuối câu trả lời làm tài liệu tham khảo/tải về bổ trợ."
      );
    }
  } else if (isResourceQuery && !isDiscussionOrProcessQuery) {
    if (githubRepoResults.length > 0) {
      contextLines.push(
        "=== KẾT QUẢ TÌM KIẾM MÃ NGUỒN CHÍNH THỨC TỪ GITHUB API (BỔ TRỢ TỰ ĐỘNG) ===\n" +
        githubRepoResults
          .map((repo, idx) => `${idx + 1}. [${repo.title}](${repo.url})\n   Mô tả: ${repo.snippet}\n   URL: ${repo.url}`)
          .join("\n\n") +
        "\n\nCHỈ DẪN QUAN TRỌNG: Trong lịch sử chat nhóm trước đó chưa có ai gửi link này (hoặc mới chỉ có file âm thanh/thảo luận liên quan nếu có trong ngữ cảnh trên). " +
        "Bạn BẮT BUỘC CUNG CẤP TRỰC TIẾP link repository GitHub ở trên cho thành viên! Nêu rõ đây là kho mã nguồn chính thức của dự án. TUYỆT ĐỐI CẤM bảo người dùng tự đi tìm kiếm trên mạng hay tự gõ từ khóa trên GitHub!"
      );
    } else {
      contextLines.push(
        "=== KẾT QUẢ TÌM KIẾM LINK TRONG LỊCH SỬ NHÓM ===\n" +
        "- Trong lịch sử tin nhắn và kho tri thức của nhóm, hiện CHƯA có thành viên nào chia sẻ đường link này (hoặc mới chỉ có file/thảo luận liên quan nếu có trong ngữ cảnh trên).\n" +
        "- NGUYÊN TẮC HỖ TRỢ CHỦ ĐỘNG: Báo rõ cho thành viên biết trong nhóm chưa có ai gửi link, ĐỒNG THỜI sử dụng dữ liệu tra cứu ngoài (Web Search / Google Grounding / Bách khoa) để CUNG CẤP TRỰC TIẾP ĐƯỜNG LINK CHÍNH THỨC (Website, Repository, Portal hoặc Tài liệu) cho thành viên ngay trong câu trả lời!\n" +
        "- TUYỆT ĐỐI CẤM trả lời suông rằng chưa có rồi bảo người dùng tự đi tìm kiếm trên mạng hay tự gõ từ khóa trên Google/GitHub!"
      );
    }
  }

  if (pastSummaries && pastSummaries.length > 0) {
    contextLines.push("=== TÓM TẮT CÁC NGÀY GẦN ĐÂY ===");
    for (const s of pastSummaries) {
      contextLines.push(`[Ngày ${s.day_label}]:\n${s.summary_text}`);
    }
  }

  const botName = groupSettings.botName || defaultBotName;

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
      const isBot = m.is_self === 1 || /(?:sen chúa|sen chua|mộc miên|kevin|bot)/i.test(m.display_name || "");
      const senderLabel = isBot ? `${botName} (Trợ lý AI)` : (m.display_name || "Thành viên");
      contextLines.push(`${dateStr} | ${senderLabel}: ${m.text}`);
    }
  }

  const contextData = contextLines.join("\n\n");

  let quotePromptSection = "";
  if (options?.quote?.text) {
    options.quote.text = stitchMultiChunkQuote(threadId, options.quote.text);
    quotePromptSection = `\n=== NỘI DUNG ĐƯỢC TRÍCH DẪN (QUOTE TỪ ${options.quote.senderName || "THÀNH VIÊN"}): ===\n"${options.quote.text}"\n`;
  }

  let fileContentSection = "";
  if (fileTextContent) {
    fileContentSection = `\n=== NỘI DUNG TÀI LIỆU ĐÍNH KÈM (${fileName || "File"}): ===\n${fileTextContent.slice(0, 40000)}\n`;
  }

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

  const isSearchDisabled =
    process.env.DISABLE_SEARCH === "true" ||
    Boolean((groupSettings as any)?.disableSearch) ||
    Boolean((groupSettings as any)?.enableSearch === 0) ||
    /tắt search|không tìm kiếm|không tra cứu/i.test(groupSettings.customPrompt || "");

  const isExplicitInternalResourceQuery =
    isOnlyLinkQuery ||
    (/(?:link|repo|github|tài liệu|tai lieu|mã nguồn|source)/i.test(question) &&
     /(?:trong nhóm|nhóm mình|nhóm này|ae|anh em|đã gửi|đã share|từ trước|ai gửi|ai share|cho xin|gửi link|tìm link)/i.test(question));

  const isInternalGroupLookup =
    (isExplicitInternalResourceQuery && relevantLinks.length > 0) ||
    (isTargetMemberFound && isMemberOrGroupQuery) ||
    isMemberOrGroupQuery ||
    (/(?:tin nhắn|nội dung|thảo luận|file|tệp).*(?:trong nhóm|nhóm mình|nhóm này|ae|anh em|bác|anh|chị|thành viên|đã gửi|đã share|từ trước)/i.test(question) && !isExplicitInternalResourceQuery) ||
    /(?:ai|thành viên nào|người nào).*(?:nhắn|gửi|share|nói)/i.test(question);

  // 2.0. Đọc hiểu ngữ nghĩa & Lập kế hoạch tra cứu bằng Gemini Flash-Lite (Semantic Query Planner)
  let liveNews = "";
  let evidenceRequired = false;
  let planNeedsSearch = false;
  let queryPlan: QueryPlanResult | null = null;

  if (!isInternalGroupLookup) {
    try {
      const recentCtx =
        relevantMessages.length > 0
          ? relevantMessages
            .slice(-8)
            .map((m) => {
              const isBot = m.is_self === 1 || /(?:sen chúa|sen chua|mộc miên|kevin|bot)/i.test(m.display_name || "");
              const senderLabel = isBot ? `${botName} (Trợ lý AI)` : (m.display_name || "Thành viên");
              return `${senderLabel}: ${m.text}`;
            })
            .join("\n")
          : undefined;

      const plan = await planSearchQueries({
        question,
        quoteText: options?.quote?.text,
        recentContext: recentCtx,
        displayName,
      });
      queryPlan = plan;

      const isFileOrVoiceReq = checkIsFileOrVoiceGeneration(question, options?.quote?.text);
      planNeedsSearch = Boolean(plan.needsSearch) && !isFileOrVoiceReq;

      if (planNeedsSearch && plan.queries.length > 0) {
        evidenceRequired = plan.intent === "fact_check" && isStrictVerificationQuestion(question);
        const searchQueries = plan.queries.slice(0, 2);
        console.log(`[member-assistant] 🧠 Semantic Planner: intent=${plan.intent}, queries=${JSON.stringify(searchQueries)}`);

        // Quét RSS/tin tức thời gian thực tối đa 2 truy vấn với timeout an toàn 6 giây chống nghẽn
        const tStartSearch = Date.now();
        const searchPromises = Promise.all(
          searchQueries.map((q) => searchRealtimeNews(q, {
            intent: plan.intent,
            requireEvidence: evidenceRequired,
          }).catch(() => ""))
        );
        let searchTimer: NodeJS.Timeout | undefined;
        const searchTimeout = new Promise<string[]>((resolve) => {
          searchTimer = setTimeout(() => {
            console.warn(`[member-assistant] ⏱️ Timeout quét tìm kiếm (8s), tiếp tục với dữ liệu sẵn có`);
            resolve([]);
          }, 8000);
        });
        const searchResults = await Promise.race([searchPromises, searchTimeout]);
        if (searchTimer) clearTimeout(searchTimer);
        liveNews = searchResults.filter(Boolean).join("\n\n---\n\n");
        console.log(`[member-assistant] ⏱️ Quét dữ liệu hoàn tất trong ${Date.now() - tStartSearch}ms (dài: ${liveNews.length} ký tự)`);
      }
    } catch (e) {
      console.warn("[member-assistant] planSearchQueries lỗi:", e);
    }
  } else {
    console.log(`[member-assistant] 🔒 Tra cứu dữ liệu nội bộ nhóm (link/nội dung), không kích hoạt tìm kiếm ngoài web.`);
  }

  if (githubRepoResults.length > 0) {
    const githubSection =
      `=== KHO LƯU TRỮ MÃ NGUỒN CHÍNH THỨC TRÊN GITHUB (TRA CỨU THỜI GIAN THỰC): ===\n` +
      githubRepoResults
        .map((repo, idx) => `${idx + 1}. [${repo.title}](${repo.url})\n   Mô tả: ${repo.snippet}\n   URL: ${repo.url}`)
        .join("\n\n") +
      `\n\nCHỈ DẪN BẮT BUỘC: Thành viên hỏi xin link/mã nguồn của dự án này. BẮT BUỘC cung cấp link GitHub chính thức ở trên (${githubRepoResults[0]?.url || ""}) cho thành viên ngay trong câu trả lời!`;
    liveNews = liveNews ? `${githubSection}\n\n---\n\n${liveNews}` : githubSection;
  }

  const liveNewsSection = liveNews
    ? `\n=== DỮ LIỆU THỜI GIAN THỰC & BÁCH KHOA MỚI NHẤT: ===\n${liveNews}\n`
    : "";

  const searchInstruction =
    `\n=== TỔNG HỢP DỮ LIỆU THỜI GIAN THỰC & CÔNG CỤ TÌM KIẾM (REAL-TIME DATA) ===\n` +
    `- Câu hỏi liên quan đến tin tức, sự kiện, thời điểm ra mắt, giá cả, tỷ giá, thể thao, thời sự mới nhất:\n` +
    `- BẮT BUỘC sử dụng dữ liệu thực tế từ các công cụ (finance_market_lookup, web_search, fetch_url, wiki_lookup...) hoặc bảng dữ liệu thời gian thực được cung cấp.\n` +
    `- NGUỒN DỮ LIỆU THỜI GIAN THỰC CÓ ĐỘ ƯU TIÊN CAO NHẤT, đè lên mọi lập luận cũ trong lịch sử chat.\n` +
    `- TUYỆT ĐỐI KHÔNG BỊA ĐẶT HOẶC ĐOÁN MÒ SỐ LIỆU TÀI CHÍNH / GIÁ CẢ / TIN TỨC!\n`;

  const directAnswerInstruction =
    `\n=== QUY TẮC CƠ CẤU TRẢ LỜI ĐA LĨNH VỰC: TRỰC TIẾP, DẪN NGUỒN CHUẨN XÁC & GỢI MỞ (UNIVERSAL DIRECT & GROUNDED CITATION) ===\n` +
    `1. TRẢ LỜI TRỰC TIẾP VÀO TRỌNG TÂM (CẤM MỞ BÀI VĂN VẺ/DÀI DÒNG/ĐÙA CỢT Ở MỌI CHỦ ĐỀ):\n` +
    `   - BẮT BUỘC ĐI THẲNG VÀO ĐÁP ÁN, SỐ LIỆU HOẶC THÔNG TIN CỐT LÕI ngay từ dòng đầu tiên.\n` +
    `   - TUYỆT ĐỐI CẤM mở bài bằng các câu chào hỏi rườm rà, cảm thán đùa cợt hay xưng hô văn vẻ làm loãng tin (CẤM các câu kiểu chào báo cáo, tự xưng hóng tin, soi tin, phân trần hoặc giới thiệu vòng vo).\n` +
    `   - Dùng gạch đầu dòng rõ ràng, **in đậm** ngày giờ, số liệu, tên đơn vị, văn bản hoặc từ khóa then chốt.\n` +
    `2. QUY CHUẨN TRÌNH BÀY CHO CÁC DẠNG DỮ LIỆU ĐẶC THÙ:\n` +
    `   - Lịch trình / Sự kiện / Thể thao có mốc thời gian (lịch thi đấu, giải đấu, hội nghị, sự kiện, chuyến bay...):\n` +
    `     + BẮT BUỘC liệt kê danh sách chi tiết: Ngày thi đấu/diễn ra, Giờ cụ thể (theo giờ VN), Cặp đấu đối đầu (Đội A vs Đội B), Vòng đấu / Bảng đấu, Kênh trực tiếp.\n` +
    `     + TUYỆT ĐỐI KHÔNG chỉ nói chung chung 1-2 câu rồi dừng lại mà phải cung cấp lịch thi đấu cụ thể, đầy đủ nhất từ dữ liệu tra cứu.\n` +
    `     + Khi câu hỏi về đội tuyển/thể thao có nhiều cấp độ (ví dụ: ĐTQG, U23, Tuyển Nữ...): BẮT BUỘC liệt kê chi tiết từng cấp độ có trận đấu sắp tới (thời gian, đối thủ, giải đấu). TUYỆT ĐỐI CẤM trả lời sơ sài 1 dòng rồi hỏi ngược lại người dùng có muốn xem thêm không!\n` +
    `   - Chỉ số / Giá cả / Thị trường (vàng, ngoại tệ, chứng khoán, crypto, nhiên liệu...): Nêu thẳng con số giá niêm yết hiện tại kèm đơn vị tính rõ ràng.\n` +
    `   - Văn bản pháp quy / Hành chính / Thủ tục: Nêu rõ tên văn bản (Luật, Nghị quyết, Nghị định, Thông tư), số hiệu, thời điểm có hiệu lực và nội dung điều khoản áp dụng.\n` +
    `   - Thông tin liên quan có giá trị gia tăng (nếu có): Chỉ ghi chú ngắn gọn, khiêm tốn ở phần phụ: "*(Ngoài ra, nếu anh/chị quan tâm đến [...], thì [...])*".\n` +
    `   - Khi yêu cầu tạo/xuất file (Word .docx, Excel .xlsx...): BẮT BUỘC gọi tool 'generate_file'. Tuyệt đối cấm viết tin nhắn giả mạo khi chưa gọi tool!\n` +
    `   - KỸ NĂNG VẼ BIỂU ĐỒ, HÌNH ẢNH, SƠ ĐỒ & ĐỒ HỌA BẰNG PYTHON (python_interpreter):\n` +
    `     + Khi người dùng yêu cầu vẽ biểu đồ, đồ thị, sơ đồ, poster lịch thi đấu, bảng xếp hạng hoặc yêu cầu làm lại/sửa lại ảnh/biểu đồ: BẮT BUỘC sử dụng công cụ 'python_interpreter'. TUYỆT ĐỐI CẤM in code Python ra chat!\n` +
    `     + Với lịch thi đấu/bảng sự kiện/roadmap: Dùng PIL vẽ Infographic Poster Card Layout nền tối (burgundy/navy), thẻ bo góc, badge nổi bật ([CHÍNH THỨC], [GIAO HỮU]), tiêu đề vàng kim #FFD700. Với số liệu: Dùng matplotlib dark theme.\n` +
    `     + TUYỆT ĐỐI KHÔNG dùng python_interpreter để sinh ảnh nghệ thuật/minh họa (phong cảnh, chân dung, anime, đồ vật...). TUYỆT ĐỐI CẤM bịa đặt bằng chữ là "đang tạo ảnh / đã gửi ảnh vào nhóm" khi phiên hỏi đáp này không có công cụ sinh ảnh nghệ thuật.\n` +
    `3. DẪN NGUỒN THEO BẰNG CHỨNG ĐƯỢC CUNG CẤP (GROUNDING CITATION CHO MỌI LĨNH VỰC):\n` +
    `   - Khi câu trả lời sử dụng dữ liệu thời gian thực (tin tức, thể thao, văn bản pháp luật, đơn vị hành chính, giá cả thị trường, nghiên cứu khoa học):\n` +
    `     + Chỉ sử dụng các bản ghi [E#], URL và ngày công bố xuất hiện trong phần bằng chứng. Không tự thêm tên cơ quan, ngày hoặc URL.\n` +
    `     + Mỗi mệnh đề phải được MỘT bản ghi [E#] chứa đồng thời đúng thực thể, thuộc tính/chức vụ và giá trị/tên người. Cấm ghép tên ở nguồn này với chức vụ, con số, ngày, liều dùng hoặc sự kiện ở nguồn khác.\n` +
    `     + Với câu hỏi "hiện nay/hiện tại là ai", chỉ trả lời danh tính được nguồn chính thức mới nhất xác nhận; không lấy người tiền nhiệm/người chỉ được nhắc tới và không tự thêm hoạt động nếu không được hỏi.\n` +
    `     + Nếu EVIDENCE_STATUS là INSUFFICIENT, phải nói rõ chưa đủ bằng chứng và không được đoán đáp án.\n` +
    `     + Giữ nguyên ngày của từng nguồn; thời điểm hệ thống hiện tại không phải ngày công bố của nguồn.\n` +
    `     + KHI SỬ DỤNG NGUỒN TIN QUỐC TẾ (bằng tiếng Anh như TechCrunch, The Verge, MIT Tech Review, BBC, Reuters, CISA, WHO...): BẮT BUỘC TỰ ĐỘNG DỊCH VÀ BIÊN TẬP TOÀN BỘ SANG TIẾNG VIỆT CHUẨN XÁC, MẠCH LẠC, DỄ HIỂU; giữ nguyên tên riêng, thông số kỹ thuật và trích dẫn rõ tên nguồn (ví dụ: Nguồn: TechCrunch, The Verge...).\n` +
    `4. KẾT BÀI GỢI MỞ HOẶC LỜI CHÚC LỊCH THIỆP:\n` +
    `   - Có thể để lại 1 câu hỏi gợi mở ngắn gọn hoặc câu chúc tự nhiên, tinh tế (nếu phù hợp).\n`;

  const systemPrompt =
    `${getSystemTemporalPrompt()}\n\n` +
    `BẠN ĐANG TƯƠNG TÁC TRỰC TIẾP TRONG NHÓM: "${currentGroupName}" (ID: ${threadId}).\n` +
    `${personaIntro}\n${customPromptSection}\n` +
    `=== 5 NGUYÊN TẮC VÀNG HOẠT ĐỘNG TOÀN NĂNG (UNIVERSAL GOLDEN RULES) ===\n\n` +
    `1. NGUYÊN TẮC 1: DUAL GROUNDING ĐA LĨNH VỰC (STRICT FACT VS OPEN KNOWLEDGE)\n` +
    `   - [A. DỮ LIỆU ĐÓNG NỘI BỘ (File đính kèm, Link Google Doc/Sheet, Hợp đồng, Chính sách, SOP, Bảng biểu)]:\n` +
    `     + BẮT BUỘC 100% số liệu, điều khoản, tỷ lệ %, mốc thời gian PHẢI trích xuất chính xác từ văn bản được cung cấp.\n` +
    `     + TUYỆT ĐỐI KHÔNG BỊA ĐẶT hay suy diễn ra ngoài văn bản. Nếu tài liệu không có: Trả lời thẳng thắn "Trong tài liệu hiện tại không đề cập nội dung này. ${botName} không tự đoán mò."\n` +
    `     + Liệt kê đầy đủ các phương án trong tài liệu, không tự ý bỏ sót.\n` +
    `   - [B. DỮ LIỆU MỞ THỊ TRƯỜNG (Xe cộ, Công nghệ, Điện thoại, Chủ đầu tư/Doanh nghiệp, Tài chính, Pháp luật, Đời sống)]:\n` +
    `     + PHÂN CỤM THỰC THỂ CHUẨN XÁC: Phân định rõ ràng ranh giới thương hiệu, dòng sản phẩm, phiên bản/thế hệ (quy đúng các biến thể hoặc dự án con về đúng tập đoàn chủ quản; tuyệt đối không gán nhầm sang thương hiệu khác).\n` +
    `     + Tận dụng dữ liệu thời gian thực (Google Search, công cụ tra cứu, bách khoa toàn thư) để phân tích đầy đủ, khách quan, giàu chiều sâu, KHÔNG từ chối trả lời.\n\n` +
    `2. NGUYÊN TẮC 2: ĐỊNH DẠNG TINH HOA ZALO RICH TEXT (ZALO MARKDOWN ENGINE)\n` +
    `   - Hệ thống đã tích hợp bộ chuyển đổi Rich Text native cho Zalo. THOẢI MÁI dùng cú pháp Markdown tiêu chuẩn:\n` +
    `     + Dùng **in đậm** cho từ khóa chính, số liệu then chốt, tên thực thể.\n` +
    `     + Dùng thẻ màu khi cần: [do]chữ đỏ cảnh báo[/do], [xanh]chữ xanh tích cực[/xanh], [cam]chữ cam nổi bật[/cam].\n` +
    `     + Dùng gạch đầu dòng '- ' cho cấp 1, '• ' cho cấp 2. Số thứ tự '1. ', '2. ' được tự động làm nổi bật.\n` +
    `   - BẢNG BIỂU & SO SÁNH: Zalo không hỗ trợ bảng kẻ viền (table). BẮT BUỘC trình bày dạng KHỐI THẺ (Card Layout) từng đối tượng hoặc danh sách so sánh rút gọn (dưới 40 ký tự/dòng). Gợi ý người dùng "yêu cầu xuất file excel" nếu cần bảng số liệu đầy đủ.\n` +
    `   - TIẾT CHẾ ICON / EMOJI: Tối đa 1-2 icon ở tiêu đề chính. CẤM spam icon vào từng đầu gạch dòng (tránh '- 🔍', '- ⭐' lặp lại).\n\n` +
    `3. NGUYÊN TẮC 3: TRẢ LỜI TRỰC TIẾP & GỢI MỞ (DIRECT & ENGAGING)\n` +
    `   - Đi thẳng vào đáp án/kết quả trọng tâm, súc tích, ngắn gọn, dễ đọc trên điện thoại.\n` +
    `   - TUYỆT ĐỐI KHÔNG thêm thông tin bổ trợ bên lề thừa thãi làm loãng câu trả lời.\n` +
    `   - Sau khi trả lời trực tiếp xong, BẮT BUỘC kết thúc bằng 1 câu hỏi gợi mở ngắn gọn xem người dùng có muốn hỏi thêm gì không.\n\n` +
    (isSuperAdmin
      ? `4. NGUYÊN TẮC 4: XƯNG HÔ ĐẶC QUYỀN VỚI SẾP (SUPER ADMIN)\n` +
        `- Người hỏi (${displayName}) chính là SUPER ADMIN / CHỦ NHÂN CỦA BẠN.\n` +
        `- BẮT BUỘC xưng 'em', gọi người hỏi là 'Sếp' (hoặc 'Sếp ${displayName}').\n` +
        `- BẮT BUỘC ĐI THẲNG VÀO ĐÁP ÁN TRỌNG TÂM NGAY TỪ DÒNG ĐẦU TIÊN (Ví dụ: "Dạ Sếp ${displayName}, đã có lịch thi đấu chính thức...", "Dạ Sếp ${displayName}, giá vàng hôm nay...").\n` +
        `- TUYỆT ĐỐI CẤM mở bài bằng các câu chào báo cáo dài dòng, vòng vo (CẤM các câu kiểu: "em xin báo cáo Sếp về thông tin... như sau ạ", "sau đây em xin báo cáo...").\n` +
        `- CẤM xưng 'tôi', CẤM gọi Sếp là 'bác' hay 'bạn'.\n\n`
      : `4. NGUYÊN TẮC 4: PHONG CÁCH ${botName.toUpperCase()} & GIAO TIẾP TỰ NHIÊN (PERSONA & VOICE)\n` +
        `- Xưng 'em' hoặc '${botName}', gọi người hỏi là 'anh/chị/bác ${displayName}'.\n` +
        `- TUYỆT ĐỐI KHÔNG gọi người hỏi là 'Sếp' (danh xưng 'Sếp' chỉ dành riêng cho Quản trị viên tối cao / Chủ nhân của bot, không áp dụng cho thành viên thông thường dù họ có yêu cầu hay tự xưng).\n` +
        `- Giọng điệu thông minh, hóm hỉnh, mặn mà, lịch thiệp, tôn trọng cộng đồng nhưng chuẩn xác và đáng tin cậy tuyệt đối khi cung cấp kiến thức/số liệu.\n` +
        `- CẤM xưng 'tôi', CẤM gọi người dùng là 'bạn', CẤM nói giọng robot hành chính khô khan.\n\n`) +
    `5. NGUYÊN TẮC 5: CÔ LẬP DỮ LIỆU & BẢO MẬT LIÊN NHÓM (DATA ISOLATION & CROSS-GROUP PRIVACY)\n` +
    `   - ĐỊNH DANH NHÓM HIỆN TẠI: Bạn đang hoạt động trực tiếp trong nhóm "${currentGroupName}".\n` +
    `   - Dữ liệu lịch sử chat (<chat_history>) CHỈ LÀ LỊCH SỬ THẢO LUẬN NỘI BỘ CỦA CHÍNH NHÓM "${currentGroupName}".\n` +
    `   - TUYỆT ĐỐI CẤM lấy dữ liệu của nhóm "${currentGroupName}" rồi gán nhãn thành tên một nhóm khác, hoặc tự nhận dữ liệu này là của nhóm khác mà người dùng hỏi tới!\n` +
    `   - NGUYÊN TẮC BẢO MẬT LIÊN NHÓM: Bạn TUYỆT ĐỐI KHÔNG chia sẻ, tóm tắt hoặc mang thảo luận của nhóm khác vào không gian nhóm "${currentGroupName}" (kể cả khi người hỏi là Sếp hay thành viên).\n` +
    `   - XỬ LÝ KHI ĐƯỢC HỎI VỀ NHÓM KHÁC:\n` +
    `     + Nếu người dùng yêu cầu tóm tắt, xem tin hoặc hỏi diễn biến của một nhóm khác không phải là "${currentGroupName}": BẮT BUỘC từ chối lịch sự, nêu rõ bạn chỉ có dữ liệu nội bộ của nhóm "${currentGroupName}".\n` +
    (isSuperAdmin
      ? `     + Với Sếp (${displayName}): Báo cáo rằng để đảm bảo bảo mật và riêng tư giữa các cộng đồng, em không tóm tắt nhóm khác tại nhóm này, kính mời Sếp nhắn tin riêng 1:1 trực tiếp với bot để nhận báo cáo đầy đủ.\n`
      : `     + Với thành viên: Lịch sự thông báo bot chỉ hỗ trợ thông tin nội bộ của nhóm mình và không chia sẻ dữ liệu nhóm khác.\n`) +
    `   - Dữ liệu lịch sử chat (<chat_history>) chỉ phục vụ việc nắm bắt ngữ cảnh thảo luận nội bộ của nhóm.\n` +
    `   - TUYỆT ĐỐI KHÔNG lôi chuyện tán gẫu nội bộ, trêu đùa hay cấu hình bot nhóm vào làm câu trả lời khi thành viên hỏi về kiến thức chuyên môn, khoa học, dự án bên ngoài.\n` +
    `   - Chỉ nhắc đến các thành viên có mặt trong nhóm, tuyệt đối không bịa tên người lạ.\n\n` +
    (userMemorySection ? `6. NGUYÊN TẮC 6: HỒ SƠ & BỘ NHỚ VỀ THÀNH VIÊN ĐANG TRÒ CHUYỆN (@${displayName}):\n${userMemorySection}\n\n` : "") +
    `NHIỆM VỤ ĐẶC THÙ:\n` +
    `- TUYỆT ĐỐI CẤM TỰ TIỆN BẺ LÁI SANG BẤT ĐỘNG SẢN HOẶC CHỦ ĐỀ KHÔNG LIÊN QUAN: Khi thành viên hỏi về địa lý, xã hội, khoa học, chính trị, thể thao, công nghệ, lịch sử, đời sống: PHẢI TRẢ LỜI ĐÚNG TRỌNG TÂM, CẤM tự ý suy diễn người hỏi đi du lịch/phượt hay lôi chuyện dự án bất động sản/mua bán nhà đất vào câu trả lời nếu người dùng không hề hỏi về BĐS!\n` +
    `- KHI CÂU HỎI LÀ TRA CỨU SỰ KIỆN / SỐ LIỆU / DỮ KIỆN THỰC TẾ: Đi thẳng vào câu trả lời và số liệu rõ ràng, không mở bài bằng các câu chào hỏi hay cảm thán sáo rỗng dài dòng làm loãng thông tin, KHÔNG chèn thông tin bổ trợ bên lề.\n` +
    `- CẬP NHẬT DỮ KIỆN THỜI GIAN THỰC & PHÁP LUẬT / HÀNH CHÍNH MỚI NHẤT: BẮT BUỘC ưu tiên dữ liệu mới nhất từ phần 'DỮ LIỆU THỜI GIAN THỰC & BÁCH KHOA MỚI NHẤT'. Khi câu hỏi liên quan đến dữ kiện thực tế có tính biến động (chính sách, luật pháp, đơn vị hành chính, giá cả, số liệu): TUYỆT ĐỐI KHÔNG bám vào số liệu cũ trong trí nhớ đã lỗi thời nếu dữ liệu tra cứu cung cấp văn bản, nghị quyết hoặc số liệu mới hơn. Phải giải thích rõ ràng và cập nhật số liệu mới nhất cho người hỏi!\n` +
    `- KHI HỎI VỀ QUY TRÌNH, HƯỚNG DẪN HOẶC KINH NGHIỆM ĐÃ CHIA SẺ TRONG NHÓM: Trích dẫn và diễn giải chi tiết từng bước (Bước 1, Bước 2, Bước 3...), các công cụ (tool) và lưu ý thực chiến từ lịch sử chat. Không chỉ đưa mỗi link tài liệu.\n` +
    `- QUY TẮC BẮT BUỘC KHI TẠO SLIDE THUYẾT TRÌNH, XUẤT FILE TÀI LIỆU HOẶC TẠO VOICE:\n` +
    `  + Khi người dùng yêu cầu tạo bài thuyết trình / slide PowerPoint (.pptx), xuất file Word (.docx), Excel (.xlsx), hoặc tạo giọng đọc / voice (.m4a), HOẶC giục 'soạn luôn đi', 'làm luôn đi':\n` +
    `    * BẮT BUỘC PHẢI GỌI CÔNG CỤ 'generate_file' (fileType='pptx' cho slide, 'docx' cho word, 'xlsx' cho excel) HOẶC 'create_voice' để xuất file thực tế gửi lên Zalo!\n` +
    `    * Với slide PowerPoint (.pptx): Phải chia nội dung thành các slide rõ ràng bằng các tiêu đề markdown '# Tiêu đề slide' và nội dung gạch đầu dòng chi tiết cho từng slide.\n` +
    `    * TUYỆT ĐỐI CẤM CHỈ GÕ DÀN Ý BẰNG CHỮ RỒI HỎI NGƯỢC LẠI NGƯỜI DÙNG có muốn soạn không. Hãy hành động và xuất file ngay lập tức!\n` +
    `    * [QUY TẮC BẢO LƯU NGUYÊN VẸN TRI THỨC KHI ĐÓNG GÓI / XUẤT FILE ĐA LĨNH VỰC]: Khi người dùng yêu cầu 'đóng gói', 'xuất file', 'lưu vào file', 'chuyển thành file' (Word/docx, Excel/xlsx, PowerPoint/pptx, PDF, CSV, TXT...) từ nội dung tin nhắn được trích dẫn (quote) hoặc nội dung đã bàn luận trước đó: BẮT BUỘC PHẢI BẢO LƯU NGUYÊN VẸN 100% TOÀN BỘ NỘI DUNG CHI TIẾT GỐC VÀO THAM SỐ 'content' CỦA TOOL 'generate_file' (đầy đủ căn cứ/điều khoản pháp luật, bảng biểu/số liệu tài chính - BĐS, toàn bộ lời thoại/phân cảnh kịch bản media, mã nguồn/kiến trúc kỹ thuật...). TUYỆT ĐỐI CẤM tự ý tóm tắt thành dàn ý gạch đầu dòng sơ sài làm mất mát dữ liệu và tri thức chuyên sâu của người dùng!\n` +
    `    * [QUY TẮC NỘI DUNG VOICE / TTS CHO MỌI LĨNH VỰC (Thơ ca, Tin tức, Pháp luật, Tài chính, Kịch bản, Kể chuyện)]: Khi gọi 'create_voice', tham số 'text' CHỈ ĐƯỢC CHỨA NỘI DUNG CỐT LÕI CẦN ĐỌC THÀNH TIẾNG (Tên tác phẩm/bản tin/điều luật, Tác giả/Nguồn nếu có, và toàn bộ nội dung chi tiết bài thơ / tin tức / đối thoại / câu chuyện). TUYỆT ĐỐI CẤM đưa lời chào xưng hô (@mention, 'Dạ Sếp...', 'Em xin gửi...'), lời dẫn phiếm đàm ('Dưới đây là...'), thông báo tiến độ ('Hệ thống đang xử lý qua worker...'), câu hỏi kết thúc ('Sếp có muốn...', 'Chúc bạn nghe vui...'), ĐẶC BIỆT TUYỆT ĐỐI CẤM đưa các đoạn phân tích, bình luận, cảm nhận, ý nghĩa, bối cảnh sáng tác hay giải thích bên dưới vào tham số 'text' của giọng đọc (người dùng chỉ muốn nghe chính tác phẩm, không nghe phân tích ngoài lề)!\n` +
    `    * [KỊCH BẢN ĐỐI THOẠI / PODCAST 2 NGƯỜI]: Khi người dùng yêu cầu kịch bản 2 người nói chuyện, cuộc đối thoại, hoặc podcast 2 người: BẮT BUỘC tự động soạn kịch bản đối đáp sinh động, phân vai rõ ràng theo từng lượt nói (ví dụ: 'Nam: ...\nNữ: ...' hoặc 'MC Nam: ...\nKhách mời: ...', có thể thêm cảm xúc trong ngoặc như 'Nam (hào hứng): ...') và BẮT BUỘC GỌI 'create_voice' truyền toàn bộ kịch bản vào tham số 'text' để hệ thống tự động tổng hợp thành file Podcast .m4a 2 giọng gửi lên Zalo!\n` +
    `    * TUYỆT ĐỐI CẤM in cú pháp giả lập dạng '[create_voice text="..."]' hoặc '[generate_file(...)]' ra tin nhắn văn bản! BẮT BUỘC PHẢI THỰC SỰ GỌI FUNCTION CALLING CỦA TOOL!\n` +
    `    * CHỈ từ chối tạo file khi người dùng chỉ hỏi thăm năng lực (ví dụ: 'em biết tạo slide không?'). Khi đó chỉ giải thích năng lực và mời người dùng yêu cầu cụ thể.\n` +
    `    * [QUY ĐỊNH CÂU TRẢ LỜI BẰNG CHỮ KÈM THEO]:\n` +
    `      + Với Slide PowerPoint (.pptx), File Word (.docx), Excel (.xlsx): Câu trả lời bằng chữ chỉ cần ngắn gọn 1-3 dòng tóm tắt và thông báo file đã gửi, không xả hàng chục trang vào chat Zalo.\n` +
    `      + Với Yêu cầu Voice / Đọc bài thơ / Ngâm thơ / Đọc tin tức / Kịch bản / Kể chuyện: BẮT BUỘC PHẢI IN TOÀN BỘ NỘI DUNG BÀI THƠ / BÀI VIẾT / KỊCH BẢN ĐẦY ĐỦ RA TIN NHẮN CHAT (ghi rõ Tên bài thơ/tác phẩm, Tác giả nếu có, và toàn văn từng dòng từng khổ). TUYỆT ĐỐI KHÔNG được chỉ gửi mỗi câu thông báo 1 dòng nhận việc mà quên in nội dung!\n` +
    `    * [TUYỆT ĐỐI CẤM BỊA ĐẶT / ẢO GIÁC VỀ GIỚI HẠN KỸ THUẬT]:\n` +
    `      + TUYỆT ĐỐI CẤM bịa đặt các câu như 'hạn mức 2 tác vụ/giờ', 'đạt ngưỡng hệ thống', 'chỉ chủ nhân mới có quyền', 'lát nữa em mới thu âm', 'uống trà đợi em'. Khi người dùng yêu cầu, PHẢI THỰC HIỆN NGAY LẬP TỨC!\n` +
    `- KỸ NĂNG VẼ BIỂU ĐỒ, HÌNH ẢNH, SƠ ĐỒ & ĐỒ HỌA BẰNG PYTHON (python_interpreter):\n` +
    `  + Khi người dùng yêu cầu vẽ biểu đồ, đồ thị, sơ đồ, poster lịch thi đấu, bảng xếp hạng hoặc yêu cầu làm lại/sửa lại ảnh/biểu đồ: BẮT BUỘC sử dụng công cụ 'python_interpreter'. TUYỆT ĐỐI CẤM in code Python ra chat!\n` +
    `  + Với lịch thi đấu/bảng sự kiện/roadmap: Dùng PIL vẽ Infographic Poster Card Layout nền tối (burgundy/navy), thẻ bo góc, badge nổi bật ([CHÍNH THỨC], [GIAO HỮU]), tiêu đề vàng kim #FFD700. Với số liệu: Dùng matplotlib dark theme.\n` +
    `- KHI CÂU HỎI LÀ TỔNG QUAN DỰ ÁN BẤT ĐỘNG SẢN / CÔNG TRÌNH / HỒ SƠ THƯƠNG MẠI:\n` +
    `  + BẮT BUỘC cấu trúc câu trả lời chuyên nghiệp, sắc nét, đầy đủ theo các phân mục rõ ràng:\n` +
    `    • 🏢 TỔNG QUAN DỰ ÁN (Tên thương mại, Chủ đầu tư/đơn vị phát triển, Đơn vị thiết kế/thi công, Tổng vốn đầu tư, Mốc khởi công & dự kiến bàn giao).\n` +
    `    • 📍 1. Vị trí đắc địa & Kết nối giao thông (Địa chỉ chi tiết, lợi thế ven sông/hồ, cự ly kết nối tới bệnh viện, TTTM, hạ tầng trọng điểm).\n` +
    `    • 📐 2. Quy mô & Cơ cấu sản phẩm (Diện tích khu đất, số lượng tháp/tầng, chi tiết từng loại hình: Căn hộ ở 1-3PN, Căn hộ Officetel, Shophouse khối đế, diện tích từng loại).\n` +
    `    • 🌿 3. Tiện ích & Phong cách sống (Phát triển theo phong cách gì, hồ bơi, gym, yoga, sauna, mảng xanh, tiện ích đặc quyền).\n` +
    `    • 💰 4. Giá bán & Chính sách tham khảo (Giá rumor/dự kiến đợt 1 từng loại hình, chính sách bán hàng hoặc vay vốn nếu có).\n` +
    `  + In đậm các số liệu quan trọng, trình bày gạch đầu dòng rõ ràng, mạch lạc, tối ưu hiển thị trên giao diện chat Zalo.\n` +
    `- TỐI ƯU TỐC ĐỘ PHẢN HỒI: Nếu trong dữ liệu thời gian thực hoặc context đã có đủ thông tin để trả lời, PHẢI TẬP TRUNG TRẢ LỜI NGAY, không gọi thêm công cụ tìm kiếm lặp lại để tránh làm chậm phản hồi.\n` +
    searchInstruction +
    directAnswerInstruction;

  const userPrompt =
    `${fileContentSection}${liveNewsSection}\n` +
    `DƯỚI ĐÂY LÀ DỮ LIỆU LỊCH SỬ CHAT NỘI BỘ CỦA CHÍNH NHÓM "${currentGroupName}" (ID: ${threadId}) ĐỂ THAM KHẢO:\n` +
    `<chat_history>\n${contextData}\n</chat_history>\n\n` +
    `${quotePromptSection ? `${quotePromptSection}\n` : ""}` +
    `YÊU CẦU / ${isSuperAdmin ? "CHỈ ĐẠO TỪ SẾP" : "CÂU HỎI TỪ THÀNH VIÊN"} (${displayName}): ${question || (mediaPart ? "Hãy phân tích chi tiết hình ảnh này giúp tôi." : fileTextContent ? "Hãy đọc và phân tích tài liệu này giúp tôi." : "Dạ em chào Sếp/bác ạ! Em có thể hỗ trợ gì?")}\n\n` +
    `HÃY TRẢ LỜI THẬT ${isSuperAdmin ? "CHU ĐÁO, CHUẨN XÁC VÀ TÔN TRỌNG SẾP" : "DUYÊN DÁNG, CHUẨN XÁC VÀ HÓM HỈNH"}:`;

  try {
    const isFileOrVoiceReq = checkIsFileOrVoiceGeneration(question, options?.quote?.text);
    const needsAgentLoop = isFileOrVoiceReq || (!isSearchDisabled && /(?:đọc link|tải trang|cào web|check link)\s+https?:/i.test(question));

    let answer = "";
    let voiceGenerated = false;
    if (needsAgentLoop) {
      // 🚀 Chỉ khi người dùng thực sự yêu cầu gọi tool xuất file, voice hoặc đọc link cụ thể mới chạy Agent Loop
      answer = await callGeminiAgentLoop(systemPrompt, userPrompt, {
        model: "gemini-3.1-flash-lite-preview",
        maxTurns: 3,
        mediaParts: mediaPart ? [mediaPart] : undefined,
        onFileGenerated: async (file) => {
          try {
            if (options?.api) {
              const isSlide = /\.(pptx|ppt)$/i.test(file.filePath);
              const isImg = /\.(png|jpg|jpeg|webp)$/i.test(file.filePath);
              const isVoice = /\.(m4a|mp3|wav|aac)$/i.test(file.filePath);
              if (isVoice) voiceGenerated = true;
              const caption = file.caption || (
                isSlide
                  ? `📊 ${botName} đã soạn xong bài thuyết trình PowerPoint [${file.fileName}] cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`
                  : isImg
                    ? `📊 Biểu đồ / Hình ảnh đã hoàn tất cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`
                    : isVoice
                      ? `🎙️ ${botName} gửi voice cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`
                      : `📄 ${botName} đã tạo xong file [${file.fileName}] cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`
              );
              if (isVoice) {
                await sendGroupVoice(options.api, threadId, file.filePath, caption);
              } else {
                await sendGroupFile(options.api, threadId, file.filePath, caption);
              }
            }
          } catch (fileErr) {
            console.warn("[member-assistant] sendGroupFile error:", fileErr);
          }
        },
      });
    } else {
      // ⚡ FAST-PATH DIRECT RESPONSE:
      // Tự động kích hoạt Google Search Grounding với model gemini-2.5-flash khi câu hỏi cần dữ liệu thời gian thực
      const needsSearch = !isSearchDisabled && !isInternalGroupLookup && (
        planNeedsSearch ||
        (isResourceQuery && relevantLinks.length === 0) ||
        isRealEstateProjectProfileQuery(question) ||
        /(?:thời tiết|giá vàng|tỷ giá|chứng khoán|tin tức|mới nhất|khi nào|bao giờ|ai là|lịch thi đấu|tỉ số|kết quả|vừa ra mắt)/i.test(question)
      );

      let effectiveUserPrompt = userPrompt;
      // Nếu cần tìm kiếm nhưng Tier 1 (Grounding) không khả dụng và chưa có liveNews từ trước, quét nhanh RSS fallback:
      if (needsSearch && !canUseGrounding() && !liveNews) {
        console.log(`[member-assistant] 📰 Tier 2 Fallback: Kích hoạt quét RSS nhanh...`);
        const searchRes = await searchRealtimeNews(question, { intent: "fact_check", requireEvidence: false }).catch(() => "");
        if (searchRes) {
          liveNews = searchRes;
          effectiveUserPrompt = `\n=== DỮ LIỆU THỜI GIAN THỰC & BÁCH KHOA MỚI NHẤT (QUÉT NHANH): ===\n${liveNews}\n\n` + userPrompt;
        }
      }

      const chosenModel = (needsSearch && canUseGrounding()) ? "gemini-3-flash-preview" : "gemini-3.1-flash-lite-preview";
      const routingSignals = normalizeExecutionSignals(
        queryPlan ? { ...queryPlan } : null,
        {
          question,
          quoteText: options?.quote?.text,
          needsSearch,
          intent: queryPlan?.intent || (needsSearch ? "fact_check" : "knowledge"),
        },
      );
      const responseMode = selectResponseMode({
        signals: routingSignals,
        needsSearch,
        explicitToolRequest: isFileOrVoiceReq,
        hasMedia: Boolean(mediaPart),
      });
      console.log(`[member-assistant] 🤖 Đang gọi AI sinh câu trả lời (route: ${responseMode}, fallbackModel: ${chosenModel}, search: ${needsSearch})...`);
      const tAiStart = Date.now();
      answer = await answerWithHybridRouting(config.hybridAgent, {
        mode: responseMode,
        systemPrompt,
        userPrompt: effectiveUserPrompt,
        sessionKey: `${config.botId}:group:${threadId}:user:${options?.sender || displayName}`,
        isOwner: isSuperAdmin,
        explicitToolRequest: isFileOrVoiceReq,
        hasMedia: Boolean(mediaPart),
        fallback: async () => await callGemini(systemPrompt, effectiveUserPrompt, {
          model: chosenModel,
          mediaParts: mediaPart ? [mediaPart] : undefined,
          enableSearch: needsSearch,
        }),
      });
      console.log(`[member-assistant] ⚡ AI hoàn tất trong ${Date.now() - tAiStart}ms (kết quả: ${answer.length} ký tự)`);
    }

    answer = await interceptAndExecuteSimulatedTool(answer, async (file) => {
      if (options?.api) {
        const isVoice = /\.(m4a|mp3|wav|aac)$/i.test(file.filePath);
        if (isVoice) {
          voiceGenerated = true;
          await sendGroupVoice(
            options.api,
            threadId,
            file.filePath,
            file.caption || `🎙️ ${botName} gửi voice cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`,
          );
        } else {
          await sendGroupFile(
            options.api,
            threadId,
            file.filePath,
            file.caption || `📄 ${botName} gửi file [${file.fileName}] cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`}!`,
          );
        }
      }
    });

    // 🛡️ PHÒNG THỦ CHIỀU SÂU: Nếu người dùng yêu cầu Voice/Đọc thơ/Podcast mà chưa có file voice nào được gửi
    if (checkIsVoiceRequest(question, options?.quote?.text) && !voiceGenerated && options?.api) {
      try {
        let speechText = extractSpeechFallbackText(answer);
        if (!speechText || speechText.length < 15) {
          console.log(`[member-assistant] 🔍 [Main QA] Answer thiếu nội dung cốt lõi để đọc voice, đang gọi nhanh AI trích xuất nội dung từ yêu cầu: "${question}"...`);
          const directContent = await callGemini(
            `Bạn là trợ lý trích xuất văn bản đọc giọng. Hãy cung cấp ĐẦY ĐỦ, CHÍNH XÁC toàn bộ nội dung bài thơ, bài viết, kịch bản hoặc lời thoại được yêu cầu trong câu hỏi của người dùng.
QUY TẮC BẮT BUỘC:
1. Chỉ in: Tên tác phẩm/bài thơ, Tác giả (nếu có), và TOÀN BỘ NỘI DUNG TỪNG DÒNG của bài thơ / văn bản / kịch bản.
2. TUYỆT ĐỐI KHÔNG có lời chào (@mention, Dạ Sếp, Xin chào), KHÔNG có lời giải thích, KHÔNG có câu kết, KHÔNG bịa đặt giới hạn kỹ thuật.`,
            `Yêu cầu: "${question}". Trích dẫn nếu có: "${options?.quote?.text || ""}".`,
            { model: "gemini-flash-latest" },
          ).catch(() => "");
          if (directContent && directContent.length >= 15) {
            const cleanedDirect = cleanCoreSpeechText(directContent);
            speechText = (cleanedDirect && cleanedDirect.length >= 15) ? cleanedDirect : directContent.trim();
            if (speechText && !answer.toLowerCase().includes(speechText.slice(0, 30).toLowerCase())) {
              answer = `${answer}\n\n${speechText}`.trim();
            }
          }
        }

        if (speechText && speechText.length >= 15) {
          console.log(`[member-assistant] 🛡️ [Main QA] Kích hoạt voice fallback tự động (${speechText.length} ký tự)...`);
          const vRes = await executeAgentTool("create_voice", {
            text: speechText,
            caption: `🎙️ ${botName} gửi bản đọc diễn cảm cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`,
          });
          if (vRes?.success && vRes?.filePath) {
            voiceGenerated = true;
            answer = cleanOutdatedVoicePromisesFromAnswer(answer);
            await sendGroupVoice(
              options.api,
              threadId,
              vRes.filePath,
              vRes.caption || `🎙️ ${botName} gửi bản đọc diễn cảm cho ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} nghe nhé!`,
            );
          }
        }
      } catch (fbVoiceErr) {
        console.warn("[member-assistant] Main QA lỗi sinh voice fallback:", fbVoiceErr);
      }
    }

    answer = finalizeGroundedAnswer(answer, liveNews, evidenceRequired, {
      intent: queryPlan?.intent,
      question,
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
    return `Dạ câu hỏi của bác ${displayName} "hack não" quá làm em ${botName} bị đứng hình một nhịp 😄! Bác chờ em nạp thêm bình ắc quy hoặc anh em cao thủ trong nhóm ai có bí kíp gì vào chỉ giáo cho bác ${displayName} với nhé!`;
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
  } catch { }
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
      .prepare(`SELECT zalo_user_id, display_name FROM members WHERE group_id = ? AND LOWER(display_name) LIKE ? LIMIT 1`)
      .get(threadId, `%${q}%`) as any;
    if (byGeneral) return byGeneral;
  } catch { }
  return null;
}

/**
 * Trích xuất prompt tạo ảnh từ lệnh hoặc ngôn ngữ tự nhiên
 * Hỗ trợ:
 * - /taoanh [mô tả], !taoanh [mô tả], /veanh, /draw, /image
 * - "tạo cho tôi bức ảnh hoàng hôn trên biển"
 * - "vẽ giúp anh một chiếc xe vinfast điện"
 * - "hãy vẽ một bức tranh sơn dầu..."
 * - "bot vẽ cho em tấm hình cô gái anime..."
 */
export function extractImagePromptFromText(rawText: string, botName = ""): string | null {
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const botPart = botName ? `|${escapeRegex(botName.toLowerCase())}` : "";
  let clean = rawText
    .replace(new RegExp(`(?:@\\s*)?(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot${botPart})(?=[^\\p{L}\\p{N}]|$)`, "giu"), " ")
    .replace(/@[^\s,!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // BỎ QUA nếu là yêu cầu vẽ biểu đồ, đồ thị, sơ đồ, bảng dữ liệu, bảng thi đấu, lịch thi đấu, bảng xếp hạng (để chuyển sang Python Sandbox hoặc trả lời Markdown/Text)
  if (
    /(?:biểu\s*đồ|đồ\s*thị|chart|plot|sơ\s*đồ|lưu\s*đồ|flowchart|mindmap|infographic)/i.test(clean) ||
    /(?:từ\s+file|từ\s+tệp|từ\s+bảng|từ\s+dữ\s+liệu|từ\s+danh\s+sách|theo\s+file|theo\s+bảng|theo\s+lịch|theo\s+danh\s+sách)/i.test(clean) ||
    /(?:bảng\s+(?:thi\s*đấu|đấu|lịch|xếp\s*hạng|điểm|so\s*sánh|tính|dữ\s*liệu|thống\s*kê)|lịch\s+(?:thi\s*đấu|trình|làm\s*việc|hẹn))/i.test(clean)
  ) {
    return null;
  }

  function cleanExtractedPrompt(p: string): string {
    return p
      .replace(/^(?:cho\s+)?(?:tôi|tao|mình|em|anh|chị|bác|nhóm)\s+/i, "")
      .replace(/^(?:về|với|cảnh|chủ đề|hình ảnh|bức ảnh|tấm ảnh)\s*[:\s]*/i, "")
      .replace(/^(?:một|vài|những)\s+/i, "")
      .replace(/^(?:con|cái|chiếc|bức|tấm|hình|ảnh)\s+/i, "")
      .replace(new RegExp(`(?:@\\s*)?(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot${botPart})(?=[^\\p{L}\\p{N}]|$)`, "giu"), " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 1. Cú pháp lệnh tạo ảnh: /taoanh, !taoanh, /veanh, /draw, /image, /sinhdan
  const cmdMatch = clean.match(/(?:^|\s)[/!](?:taoanh|veanh|sinhdan|draw|imagine|image)\s*(?:[:\s-]\s*)?(.+)$/i);
  if (cmdMatch && cmdMatch[1]?.trim()) {
    return cleanExtractedPrompt(cmdMatch[1]);
  }

  // 1.1 Cú pháp lệnh sửa ảnh: /suaanh, !suaanh, /chinhanh, !chinhanh, /chinhsuaanh, !chinhsuaanh, /editanh, !editanh, /editimage, /modifyimage
  const editCmdMatch = clean.match(/(?:^|\s)[/!](?:suaanh|chinhanh|chinhsuaanh|editanh|editimage|modifyimage)\s*(?:[:\s-]\s*)?(.*)$/i);
  if (editCmdMatch) {
    const p = editCmdMatch[1]?.trim();
    return p ? cleanExtractedPrompt(p) : "nâng cấp chất lượng và tối ưu hóa chi tiết hình ảnh";
  }

  // 2. Ngôn ngữ tự nhiên sửa / chỉnh ảnh:
  // "sửa ảnh này thành tóc ngắn", "chỉnh sửa giúp anh tấm ảnh này", "edit ảnh này theo phong cách anime", "thay nền ảnh này..."
  const naturalEditPattern = /(?:^|.*?\b)(?:hãy\s+|nhờ\s+|cho\s+)?(?:sửa|chỉnh\s*sửa|chỉnh|edit|biến\s*đổi|chuyển\s*đổi|làm\s*lại)\s+(?:giúp\s+)?(?:cho\s+)?(?:tôi|mình|em|anh|chị|bác|nhóm)?\s*(?:giúp\s+)?(?:một\s+)?(?:bức\s+|tấm\s+|cái\s+|chiếc\s+)?(?:ảnh|hình|tranh)\s*(?:này|đó)?\s*(?:thành|sang|thêm|thay|bỏ|đổi|cho)?\s*[:\s]*(.+)$/i;
  const editMatch = clean.match(naturalEditPattern);
  if (editMatch && editMatch[1]?.trim()) {
    return cleanExtractedPrompt(editMatch[1]);
  }

  // 2.1 Ngôn ngữ tự nhiên thao tác chỉnh sửa chi tiết ảnh (in-painting / xóa người, thay phục trang, đổi nền...):
  // VD: "xoá người mặc áo đen bên phải, thay người mặc đầm nâu...", "xoá phông nền giúp em...", "thay người bên phải thành đầm tím"
  const isQuestion = /(?:như\s*thế\s*nào|làm\s*sao|thủ\s*tục\s*(?:gì|như\s*thế\s*nào)|quy\s*định\s*(?:gì|như\s*thế\s*nào)|có\s*được\s*không|được\s*k\b|phải\s*làm\s*gì|là\s*gì|tại\s*sao|\?\s*$)/i.test(clean);
  if (!isQuestion) {
    const directPhotoEditActionPattern = /(?:^|.*?\b)(?:hãy\s+|nhờ\s+|cho\s+)?((?:xoá|xóa|bỏ|thay|đổi|chỉnh|sửa|làm\s*nét|làm\s*rõ|phục\s*chế)\s+(?:giúp\s+)?(?:cho\s+)?(?:tôi|mình|em|anh|chị|bác|nhóm)?\s*(?:người|nhân\s*vật|áo|quần|váy|đầm|tóc|kính|mũ|mặt|khuôn\s*mặt|nền|phông|background|chữ|ngày|tháng|chi\s*tiết)\b.+)$/i;
    const directActionMatch = clean.match(directPhotoEditActionPattern);
    if (directActionMatch && directActionMatch[1]?.trim()) {
      return cleanExtractedPrompt(directActionMatch[1]);
    }
  }

  // 2.2 Ngôn ngữ tự nhiên có từ khóa ảnh/hình/tranh/họa:
  const naturalPhotoPattern = /(?:^|.*?\b)(?:hãy\s+|nhờ\s+|cho\s+)?(?:tạo|vẽ|sinh|làm)\s+(?:giúp\s+)?(?:cho\s+)?(?:tôi|mình|em|anh|chị|bác|nhóm)?\s*(?:giúp\s+)?(?:một\s+)?(?:bức\s+|tấm\s+|cái\s+|chiếc\s+)?(?:ảnh|hình|tranh|họa)\s*(?:về|với|cảnh|chủ đề|một)?\s*[:\s]*(.+)$/i;
  const photoMatch = clean.match(naturalPhotoPattern);
  if (photoMatch && photoMatch[1]?.trim()) {
    return cleanExtractedPrompt(photoMatch[1]);
  }

  // 3. "vẽ giúp anh một...", "vẽ cho em con...", "hãy vẽ..."
  const directDrawPattern = /(?:^|.*?\b)(?:hãy\s+|nhờ\s+|cho\s+)?(?:vẽ)\s+(?:giúp\s+)?(?:cho\s+)?(?:tôi|mình|em|anh|chị|bác|nhóm)?\s*(?:giúp\s+)?(?:một\s+|con\s+|cái\s+|chiếc\s+|bức\s+|tấm\s+)?(.+)$/i;
  const drawMatch = clean.match(directDrawPattern);
  if (drawMatch && drawMatch[1]?.trim()) {
    return cleanExtractedPrompt(drawMatch[1]);
  }

  return null;
}

export type AspectRatioType = "16:9" | "9:16" | "4:3" | "3:4" | "1:1";

export interface ParsedImageRequest {
  prompt: string;
  aspectRatio: AspectRatioType;
  referenceImageUrl?: string;
  isEdit?: boolean;
}

/**
 * Phân tích yêu cầu tạo hoặc sửa ảnh: tách prompt sạch và tỉ lệ khung hình (16:9, 9:16, 4:3, 3:4, 1:1)
 * Hỗ trợ bóc tách ngữ cảnh từ tin nhắn được trích dẫn (Quote) khi người dùng dùng đại từ chỉ định ("này đi e", "theo phương án này")
 * hoặc yêu cầu sửa ảnh ("đổi nền thành bãi biển", "thêm kính mắt", "sửa thành tóc vàng").
 */
export function parseImagePromptAndRatio(
  rawText: string,
  botName = "",
  quote?: MemberMessageEvent["quote"] | null,
): ParsedImageRequest | null {
  const extracted = extractImagePromptFromText(rawText, botName);

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const botPart = botName ? `|${escapeRegex(botName.toLowerCase())}` : "";
  const cleanForDetect = rawText
    .replace(new RegExp(`(?:@\\s*)?(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot${botPart})(?=[^\\p{L}\\p{N}]|$)`, "giu"), " ")
    .replace(/@[^\s,!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Nhận diện lệnh hoặc câu nói sửa ảnh
  const isExplicitEditCmd = /^[/!](?:suaanh|chinhanh|chinhsuaanh|editanh|editimage|modifyimage)\b/i.test(rawText.trim());
  const isNaturalEdit =
    /(?:^|.*?\b)(?:hãy\s+|nhờ\s+|cho\s+)?(?:sửa|chỉnh\s*sửa|chỉnh|edit|biến\s*đổi|chuyển\s*đổi|làm\s*lại)\s+(?:giúp\s+)?(?:cho\s+)?(?:tôi|mình|em|anh|chị|bác|nhóm)?\s*(?:giúp\s+)?(?:một\s+)?(?:bức\s+|tấm\s+|cái\s+|chiếc\s+)?(?:ảnh|hình|tranh)\b/i.test(cleanForDetect) ||
    (!/(?:như\s*thế\s*nào|làm\s*sao|thủ\s*tục\s*(?:gì|như\s*thế\s*nào)|quy\s*định\s*(?:gì|như\s*thế\s*nào)|có\s*được\s*không|được\s*k\b|phải\s*làm\s*gì|là\s*gì|tại\s*sao|\?\s*$)/i.test(cleanForDetect) &&
      /(?:^|.*?\b)(?:hãy\s+|nhờ\s+|cho\s+)?(?:xoá|xóa|bỏ|thay|đổi|chỉnh|sửa|làm\s*nét|làm\s*rõ|phục\s*chế)\s+(?:giúp\s+)?(?:cho\s+)?(?:tôi|mình|em|anh|chị|bác|nhóm)?\s*(?:người|nhân\s*vật|áo|quần|váy|đầm|tóc|kính|mũ|mặt|khuôn\s*mặt|nền|phông|background|chữ|ngày|tháng|chi\s*tiết)\b/i.test(cleanForDetect));

  // Nhận diện trường hợp quote ảnh kèm chỉ dẫn thay đổi (VD: "đổi màu tóc thành vàng", "thêm kính mắt", "thay nền sang ban đêm")
  const hasImageInQuote = Boolean(quote?.mediaUrl && (quote.mediaType === "image" || /\.(?:jpg|jpeg|png|webp|gif)/i.test(quote.mediaUrl)));
  let quoteImageEditPrompt = "";
  if (!extracted && hasImageInQuote) {
    const actionMatch = cleanForDetect.match(/^(?:hãy\s+|nhờ\s+|cho\s+)?(?:sửa|chỉnh\s*sửa|chỉnh|edit|thay\s*đổi|đổi|thêm|bớt|xóa|làm\s*nét|làm\s*rõ|biến\s*thành|chuyển\s*(?:sang|thành)|thay)\s+(.+)$/i);
    if (actionMatch && actionMatch[1]?.trim()) {
      quoteImageEditPrompt = actionMatch[1].trim();
    }
  }

  const promptCandidate = quoteImageEditPrompt || extracted;
  if (!promptCandidate) return null;

  let cleaned = promptCandidate;
  let ratio: AspectRatioType = "1:1";

  // Nhận diện 16:9 (ngang)
  if (/(?:tỉ\s*lệ|tỷ\s*lệ|size|khung|khổ)?\s*(?:ảnh\s*)?(?:16\s*[:/]\s*9|ngang|khổ\s*ngang|nằm\s*ngang|landscape|widescreen)\b/i.test(cleaned)) {
    ratio = "16:9";
    cleaned = cleaned.replace(/(?:tỉ\s*lệ|tỷ\s*lệ|size|khung|khổ)?\s*(?:ảnh\s*)?(?:16\s*[:/]\s*9|ngang|khổ\s*ngang|nằm\s*ngang|landscape|widescreen)/gi, " ");
  }
  // Nhận diện 9:16 (dọc)
  else if (/(?:tỉ\s*lệ|tỷ\s*lệ|size|khung|khổ)?\s*(?:ảnh\s*)?(?:9\s*[:/]\s*16|dọc|khổ\s*dọc|đứng|chiều\s*dọc|portrait|story|tiktok)\b/i.test(cleaned)) {
    ratio = "9:16";
    cleaned = cleaned.replace(/(?:tỉ\s*lệ|tỷ\s*lệ|size|khung|khổ)?\s*(?:ảnh\s*)?(?:9\s*[:/]\s*16|dọc|khổ\s*dọc|đứng|chiều\s*dọc|portrait|story|tiktok)/gi, " ");
  }
  // Nhận diện 4:3
  else if (/(?:tỉ\s*lệ|tỷ\s*lệ|size|khung|khổ)?\s*(?:ảnh\s*)?(?:4\s*[:/]\s*3)\b/i.test(cleaned)) {
    ratio = "4:3";
    cleaned = cleaned.replace(/(?:tỉ\s*lệ|tỷ\s*lệ|size|khung|khổ)?\s*(?:ảnh\s*)?(?:4\s*[:/]\s*3)/gi, " ");
  }
  // Nhận diện 3:4
  else if (/(?:tỉ\s*lệ|tỷ\s*lệ|size|khung|khổ)?\s*(?:ảnh\s*)?(?:3\s*[:/]\s*4)\b/i.test(cleaned)) {
    ratio = "3:4";
    cleaned = cleaned.replace(/(?:tỉ\s*lệ|tỷ\s*lệ|size|khung|khổ)?\s*(?:ảnh\s*)?(?:3\s*[:/]\s*4)/gi, " ");
  }
  // Nhận diện 1:1 (vuông)
  else if (/(?:tỉ\s*lệ|tỷ\s*lệ|size|khung|khổ)?\s*(?:ảnh\s*)?(?:1\s*[:/]\s*1|vuông|khổ\s*vuông|square)\b/i.test(cleaned)) {
    ratio = "1:1";
    cleaned = cleaned.replace(/(?:tỉ\s*lệ|tỷ\s*lệ|size|khung|khổ)?\s*(?:ảnh\s*)?(?:1\s*[:/]\s*1|vuông|khổ\s*vuông|square)/gi, " ");
  }

  cleaned = cleaned
    .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+(?:đi\s+e|đi\s+em|đi\s+bot|đi\s+nhé|đi\s+nha|đi\s+nào|đi|nhé|nha|với|giúp|giùm|nào|coi|xem|nè|e|em|bot)[.!?\s]*$/i, "")
    .trim();

  // Nhận diện các đại từ chỉ định hoặc câu lệnh phụ thuộc vào ngữ cảnh trích dẫn
  const isReferentialOnly =
    /^(?:này|nay|cái này|ảnh này|hình này|bức này|như này|như vầy|theo cái này|theo phương án này|phương án này|nội dung này|đoạn này|bài này|bài viết này|ý tưởng này)(?:\s+(?:đi\s+e|đi\s+em|đi|nhé|nha|với|ạ|e|em|bot|nè))?$/i.test(cleaned) ||
    /^(?:theo|dựa theo|dựa vào)\s+(?:phương án|ý tưởng|nội dung|mô tả|bài viết|cái|ảnh|hình)?\s*này(?:\s+(?:đi\s+e|đi\s+em|đi|nhé|nha|với|ạ|e|em|bot|nè))?$/i.test(cleaned);

  let referenceImageUrl: string | undefined = undefined;
  if (quote?.mediaUrl && (quote.mediaType === "image" || /\.(?:jpg|jpeg|png|webp|gif)/i.test(quote.mediaUrl))) {
    referenceImageUrl = quote.mediaUrl;
  }

  let finalPrompt = cleaned || promptCandidate;

  if (quote?.text && quote.text.trim()) {
    const qText = quote.text.trim();
    if (isReferentialOnly) {
      // Người dùng chỉ nói "tạo ảnh này đi e", "theo phương án này nè" -> lấy 100% nội dung quote làm prompt
      finalPrompt = qText.slice(0, 500);
    } else if (/\b(?:này|cái này|phương án này|dự án này|bài này|nội dung này)\b/i.test(cleaned)) {
      // Người dùng bổ sung thêm yêu cầu (ví dụ: "vẽ phong cách anime cho nội dung này")
      finalPrompt = `${cleaned} (Chi tiết từ nội dung trích dẫn: ${qText.slice(0, 350)})`;
    }
  } else if (isReferentialOnly) {
    if (referenceImageUrl) {
      finalPrompt = "Tạo biến thể hình ảnh chất lượng cao sắc nét dựa trên hình ảnh gốc";
    } else {
      // Người dùng nói "tạo ảnh này đi e" nhưng không có quote text lẫn ảnh -> không đủ dữ kiện làm prompt
      return null;
    }
  }

  const isEdit = isExplicitEditCmd || isNaturalEdit || Boolean(quoteImageEditPrompt);

  return {
    prompt: finalPrompt,
    aspectRatio: ratio,
    referenceImageUrl,
    isEdit,
  };
}

/**
 * Xử lý tin nhắn đến từ thành viên: kiểm tra lệnh hoặc câu hỏi.
 */
export async function handleMemberInteraction(api: any, event: MemberMessageEvent): Promise<void> {
  const ownId = typeof api?.getOwnId === "function" ? String(api.getOwnId()) : "";

  // 1. TUYỆT ĐỐI BỎ QUA tin nhắn của chính tài khoản Bot (chống Self-Reply & Loop)
  if (event.isSelf || Boolean(ownId && event.sender === ownId)) {
    return;
  }

  const rawText = (event.text || "").trim();
  const hasImage = Boolean(event.mediaUrl || event.quote?.mediaUrl);
  const hasFile = Boolean(event.fileAttachment);
  const hasQuote = Boolean(event.quote?.text || event.quote?.mediaUrl);

  if (!rawText && !hasImage && !hasFile) return;

  // 2. TUYỆT ĐỐI BỎ QUA các tin nhắn do chính Bot sinh ra:
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
    /^(?:🤖\s*)?(?:Sen Chúa|Mộc Miên)\s+trả lời\s+@/i.test(rawText) ||
    rawText.includes("[BÁO THỨC") ||
    rawText.includes("LỊCH HẸN THÀNH CÔNG") ||
    rawText.includes("[Mã #")
  ) {
    return;
  }

  const sender = event.sender;
  const displayName = (event.displayName || "Bạn").trim();
  const threadId = event.threadId;

  // 3. TUYỆT ĐỐI BỎ QUA tin nhắn từ tài khoản có tên trùng tên Bot hoặc Bot khác (Sen Chúa, Mộc Miên, Bot):
  const groupSettings = getGroupSettings(threadId);
  const botName = (groupSettings.botName || defaultBotName).trim();
  const lowerName = displayName.toLowerCase();

  if (
    lowerName === botName.toLowerCase() ||
    lowerName === "sen chúa" ||
    lowerName === "sen chua" ||
    lowerName === "mộc miên" ||
    lowerName === "moc mien" ||
    lowerName.startsWith("bot ") ||
    lowerName === "bot"
  ) {
    console.log(`[member-assistant] ⛔ Bỏ qua tin nhắn từ tài khoản trùng tên Bot (${displayName})`);
    return;
  }

  // 4. KIỂM TRA THÀNH VIÊN BỊ CHẶN BOT TRẢ LỜI:
  // Nếu thành viên này nằm trong danh sách đen bị chặn -> Bot TUYỆT ĐỐI IM LẶNG 100%, không tương tác (kể cả tag bot hay lệnh /hoi).
  if (isMemberBlocked(sender, threadId)) {
    console.log(`[member-assistant] ⛔ Thành viên ${displayName} (${sender}) đang bị chặn bot trả lời trong nhóm [${threadId}]. Bỏ qua.`);
    return;
  }

  // Kiểm tra cooldown
  const now = Date.now();
  const lastTime = userCooldowns.get(sender) || 0;
  if (now - lastTime < COOLDOWN_MS) {
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
    void sendReaction(api, threadId, event.msgId, event.cliMsgId, Reactions.OK);
    void sendTyping(api, threadId);
    const reply = handleHelpCommand(botName);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /help cho ${displayName}`);
    return;
  }

  // 1b. Lệnh quản lý trí nhớ cá nhân: !xemtrinho, !xoatrinho, hoặc gọi tên bot kèm "nhớ gì về tôi"
  const isExplicitMemoryCmd = /^[!/](?:xemtrinho|trinho|xem_nho|my_memories|memory|xoatrinho|quenhet|xoa_nho|clear_memories|forget_me)\b/i.test(rawText.trim());
  const memoryAction = isMemoryControlCommand(rawText);
  if (memoryAction) {
    const lowerBot = botName.toLowerCase().trim();
    const unaccBot = lowerBot.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    const isBotAddressed =
      isExplicitMemoryCmd ||
      Boolean(ownId && Array.isArray(event.mentions) && event.mentions.some((m: any) => String(m?.uid || m?.id) === ownId)) ||
      lower.includes(lowerBot) ||
      lower.includes(unaccBot);

    if (isBotAddressed) {
      userCooldowns.set(sender, now);
      void sendReaction(api, threadId, event.msgId, event.cliMsgId, Reactions.OK);
      void sendTyping(api, threadId);
      const reply = handleMemoryControlCommand(memoryAction, sender, displayName);
      await sendGroupText(api, threadId, reply);
      console.log(`[member-assistant] 🧠 Đã phản hồi lệnh trí nhớ (${memoryAction}) cho ${displayName}`);
      return;
    }
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
    void sendReaction(api, threadId, event.msgId, event.cliMsgId, Reactions.OK);
    void sendTyping(api, threadId);
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
    void sendReaction(api, threadId, event.msgId, event.cliMsgId, Reactions.OK);
    void sendTyping(api, threadId);
    const reply = handleTopCommand(threadId);
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /top cho ${displayName}`);
    return;
  }

  // 3.5. Lệnh /quota, !quota, /grounding, !grounding: Kiểm tra hạn mức Google Search Grounding hôm nay
  if (
    lower === "/quota" ||
    lower === "!quota" ||
    lower === "quota" ||
    lower === "/grounding" ||
    lower === "!grounding" ||
    lower === "grounding" ||
    lower === "/hanmuc" ||
    lower === "!hanmuc"
  ) {
    userCooldowns.set(sender, now);
    const reply = formatGroundingQuotaReport();
    await sendGroupText(api, threadId, reply);
    console.log(`[member-assistant] ✅ Đã phản hồi /quota cho ${displayName}`);
    return;
  }

  // 3.6. Lệnh /resetquota, !resetquota: Reset bộ đếm hạn mức hôm nay
  if (lower === "/resetquota" || lower === "!resetquota" || lower === "/resetgrounding" || lower === "!resetgrounding") {
    userCooldowns.set(sender, now);
    resetGroundingQuota();
    await sendGroupText(api, threadId, "✅ Đã reset bộ đếm hạn mức và kích hoạt lại Google Search Grounding hôm nay!");
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
    const reply = handleLinksCommand(threadId, filter || undefined, botName);
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
    const botName = groupSettings.botName || defaultBotName;
    const customTopic = rawText.replace(/^\/(?:tintuc|!tintuc|bantin|!bantin)\s*/i, "").trim();
    const topic = customTopic || groupSettings.newsTopic || "Trí tuệ nhân tạo (AI), công nghệ mới, mô hình AI mới trên X/Twitter";
    const isSuperAdmin = isUserAdmin(sender);
    await sendGroupText(api, threadId, `🔍 Đang tra cứu và tổng hợp bản tin về "${topic}" trên Google & X... ${isSuperAdmin ? "Sếp" : "Bác"} chờ em xíu nhé!`);

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

  // 6.2. Vệ Tinh 3: Lệnh /taoanh, /suaanh hoặc Yêu cầu vẽ/sửa ảnh bằng ngôn ngữ tự nhiên ("tạo cho tôi bức ảnh...", "sửa ảnh này thành...")
  const imageReq = parseImagePromptAndRatio(rawText, botName, event.quote);
  if (imageReq && (imageReq.prompt.length >= 2 || imageReq.isEdit)) {
    const isExplicitCommand = /^[/!](?:taoanh|veanh|sinhdan|draw|imagine|image|suaanh|chinhanh|chinhsuaanh|editanh|editimage|modifyimage)\b/i.test(rawText.trim());

    if (!isExplicitCommand) {
      // Trong nhóm: Nếu không phải lệnh /taoanh rõ ràng thì BẮT BUỘC người dùng phải gọi tên Bot hoặc tag Bot
      const lowerRaw = rawText.toLowerCase();
      const lowerBot = botName.toLowerCase().trim();
      const unaccentedBot = lowerBot.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");

      // Kiểm tra xem bot có được tag trực tiếp qua UID không
      const isTaggedByUid = Boolean(
        ownId &&
        Array.isArray(event.mentions) &&
        event.mentions.some((m: any) => String(m?.uid || m?.id) === ownId)
      );

      // Kiểm tra xem người dùng có đang tag người khác qua UID không (tag người khác thì bot tuyệt đối không xen vào)
      const isTaggedOtherUid = Boolean(
        ownId &&
        Array.isArray(event.mentions) &&
        event.mentions.length > 0 &&
        !isTaggedByUid
      );

      // Kiểm tra gọi đích danh bot này (bằng tên bot đã cấu hình hoặc không dấu)
      const botParts = lowerBot.split(/\s+/).filter((p) => p.length >= 3);
      const mentionsThisBotName =
        lowerRaw.includes(`@${lowerBot}`) ||
        lowerRaw.includes(`@${unaccentedBot}`) ||
        lowerRaw.includes(lowerBot) ||
        lowerRaw.includes(unaccentedBot) ||
        lowerRaw.startsWith(lowerBot + " ") ||
        lowerRaw.startsWith(unaccentedBot + " ") ||
        lowerRaw.includes(`${lowerBot} ơi`) ||
        lowerRaw.includes(`${unaccentedBot} oi`) ||
        lowerRaw.includes(`nhờ ${lowerBot}`) ||
        lowerRaw.includes(`nhờ ${unaccentedBot}`) ||
        botParts.some((part) => {
          const unacc = part.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
          return (
            lowerRaw.includes(`${part} ơi`) ||
            lowerRaw.includes(`${unacc} oi`) ||
            lowerRaw.includes(`nhờ ${part}`) ||
            lowerRaw.includes(`nhờ ${unacc}`) ||
            lowerRaw.startsWith(`${part} `) ||
            lowerRaw.startsWith(`${unacc} `)
          );
        });

      // Nếu thành viên tag người khác (UID khác hoặc @Tên khác bot)
      const hasOtherMention =
        isTaggedOtherUid ||
        (/@[^\s,!?]+/g.test(rawText) &&
          !lowerRaw.includes(`@${lowerBot}`) &&
          !lowerRaw.includes(`@${unaccentedBot}`));

      // Bot chỉ được gọi nếu:
      // 1. Tag trực tiếp bằng UID của bot này (isTaggedByUid)
      // 2. Hoặc người dùng gọi đích danh tên bot này trong văn bản (mentionsThisBotName) VÀ không tag đích danh người khác (!hasOtherMention)
      // TUYỆT ĐỐI KHÔNG nhận từ chung chung "bot ơi", "@bot" nữa theo chỉ đạo của người dùng.
      const isBotCalled = isTaggedByUid || (mentionsThisBotName && !hasOtherMention);

      if (!isBotCalled) {
        // Trong nhóm: yêu cầu tạo ảnh nhưng không gọi đích danh bot này -> bỏ qua hoàn toàn, KHÔNG để rơi xuống QA
        return;
      }

      // Đủ điều kiện tạo ảnh bằng ngôn ngữ tự nhiên
      await executeGroupImageGen();
      return;
    } else {
      // Có lệnh rõ ràng (/taoanh, !veanh...)
      await executeGroupImageGen();
      return;
    }
  }

  async function executeGroupImageGen(): Promise<void> {
    const { prompt: imagePrompt, aspectRatio, isEdit } = imageReq!;
    userCooldowns.set(sender, now);
    void sendReaction(api, threadId, event.msgId, event.cliMsgId, Reactions.HEART);
    void sendTyping(api, threadId);

    const isCodex = config.imageProvider === "codex";

    if (isCodex) {
      if (!isCodexImageConfigured()) {
        await sendGroupText(
          api,
          threadId,
          `⚠️ @${displayName} Tính năng tạo/sửa ảnh AI (Codex) chưa được kích hoạt trên máy chủ (cần cấu hình NINE_ROUTER_API_KEY trong file .env). Vui lòng liên hệ Quản trị viên nhé!`,
        );
        return;
      }
    } else {
      if (!isCloudflareConfigured()) {
        await sendGroupText(
          api,
          threadId,
          `⚠️ @${displayName} Tính năng vẽ ảnh AI (Cloudflare) chưa được cấu hình trên máy chủ. Vui lòng liên hệ Quản trị viên để kích hoạt nhé!`,
        );
        return;
      }
    }

    // Tìm ảnh tham chiếu nếu có (từ quote, event media, file đính kèm, raw payload, database, hoặc ảnh gần nhất trong nhóm)
    let targetImagePathOrUrl: string | undefined =
      imageReq?.referenceImageUrl ||
      event.mediaUrl ||
      event.quote?.mediaUrl ||
      (event.fileAttachment?.url && /\.(?:jpg|jpeg|png|webp|gif|bmp)$/i.test(event.fileAttachment.name || event.fileAttachment.url)
        ? event.fileAttachment.url
        : undefined) ||
      undefined;

    if (!targetImagePathOrUrl && event.rawMessage) {
      const candidateUrls = collectCandidateUrls([event.rawMessage]);
      const imageCandidate = candidateUrls.find((u) => /\.(?:jpe?g|png|webp|gif|bmp)(?:\?|$)/i.test(u) || /photo|image|zdn\.vn/i.test(u));
      if (imageCandidate) {
        targetImagePathOrUrl = imageCandidate;
      }
    }

    if (!targetImagePathOrUrl && event.quote) {
      const quoteId = event.quote.msgId || event.quote.cliMsgId || event.quote.globalMsgId;
      if (quoteId) {
        const media = getMediaByMessageId(threadId, quoteId);
        if (media) {
          targetImagePathOrUrl = media.local_path || media.media_url || undefined;
        }
      }
    }

    if (!targetImagePathOrUrl && isEdit) {
      const recentImg = getRecentGroupImage(threadId, 10 * 60 * 1000);
      if (recentImg) {
        targetImagePathOrUrl = recentImg.local_path || recentImg.media_url || undefined;
      }
    }

    let inputImageDataUrl: string | null = null;
    if (targetImagePathOrUrl) {
      if (fs.existsSync(targetImagePathOrUrl)) {
        inputImageDataUrl = prepareImageDataUrl(targetImagePathOrUrl);
      } else {
        const fileRes = await downloadFileContent(targetImagePathOrUrl);
        if (fileRes?.mediaPart?.data) {
          inputImageDataUrl = `data:${fileRes.mediaPart.mimeType || "image/png"};base64,${fileRes.mediaPart.data}`;
        }
      }
    }

    // Nếu người dùng yêu cầu sửa ảnh mà hoàn toàn không tìm thấy ảnh nào
    if (isEdit && !inputImageDataUrl) {
      await sendGroupText(
        api,
        threadId,
        `⚠️ @${displayName} Bác vui lòng trích dẫn (quote) một bức ảnh trong nhóm hoặc gửi kèm ảnh để em sửa nhé! ✨`,
      );
      return;
    }

    const isSuperAdmin = isUserAdmin(sender);
    const ratioTag = aspectRatio !== "1:1" ? ` (${aspectRatio})` : "";
    const promptPreview = imagePrompt.length > 50 ? `${imagePrompt.slice(0, 47)}...` : imagePrompt;
    const actionVerb = isEdit ? "chỉnh sửa ảnh" : "vẽ ảnh";

    await sendGroupText(
      api,
      threadId,
      `🎨 ${isSuperAdmin ? `Em đang ${actionVerb} cho Sếp` : `${botName} đang ${actionVerb}`}: "${promptPreview}"${ratioTag}... ${isSuperAdmin ? "Sếp" : "Bác"} chờ em xíu nhé! ✨`,
    );

    try {
      const imgRes = isCodex
        ? await generateCodexImage(imagePrompt, { aspectRatio, image: inputImageDataUrl, isEdit })
        : await generateCloudflareImage(imagePrompt, { aspectRatio });

      if (imgRes.success && imgRes.filePath) {
        const shortNote = imagePrompt.length <= 35 ? ` ("${imagePrompt}"${ratioTag})` : "";
        const resultLabel = isEdit ? "Ảnh sau khi chỉnh sửa của" : "Ảnh của";
        const modelTag = imgRes.tierUsed ? `\n🤖 Model: ${imgRes.tierUsed}` : "";
        await sendGroupFile(
          api,
          threadId,
          imgRes.filePath,
          `🎨 ${resultLabel} ${isSuperAdmin ? "Sếp" : `bác @${displayName}`} đây ạ!${shortNote} ✨${modelTag}`,
        );
        console.log(`[member-assistant] ✅ Đã gửi ảnh thành công cho ${displayName} ("${imagePrompt}", ratio: ${aspectRatio}, isEdit: ${Boolean(isEdit)}, model: ${imgRes.tierUsed || "N/A"})`);
      } else {
        await sendGroupText(
          api,
          threadId,
          `⚠️ Rất tiếc ${isSuperAdmin ? "Sếp ơi" : `@${displayName}`}, quá trình ${actionVerb} gặp sự cố: ${imgRes.error || "Lỗi máy chủ"}. ${isSuperAdmin ? "Sếp" : "Bác"} thử lại sau ít phút nhé!`,
        );
      }
    } catch (imgErr: any) {
      console.error(`[member-assistant] ❌ Lỗi sinh/sửa/gửi ảnh:`, imgErr);
      await sendGroupText(
        api,
        threadId,
        `⚠️ Rất tiếc @${displayName}, đã có lỗi xảy ra khi ${actionVerb}: ${imgErr?.message || String(imgErr)}`,
      );
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

  // 10. Lệnh /hoi [câu hỏi], Tag bot, Nhắc tên Bot, Chào hỏi, Lệnh đọc file/ảnh
  // QUY TẮC: BOT CHỈ TRẢ LỜI KHI THÀNH VIÊN THỰC SỰ GỌI TÊN HOẶC DÙNG LỆNH CỦA BOT.
  // Tránh việc thành viên chat bình thường/quote với nhau mà bot tự ý xen vào.
  const lowerBotName = botName.toLowerCase().trim();
  const unaccentedBotName = lowerBotName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");

  // Các từ khóa gọi trực tiếp theo tên bot linh động được cấu hình
  const botParts = lowerBotName.split(/\s+/).filter((p) => p.length >= 3);
  const mentionsShortName = botParts.some((part) => {
    const unacc = part
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
    return (
      lower.startsWith(`${part} ơi`) ||
      lower.startsWith(`${unacc} oi`) ||
      lower.includes(`${part} ơi`) ||
      lower.includes(`${unacc} oi`) ||
      lower.includes(`nhờ ${part}`) ||
      lower.includes(`nhờ ${unacc}`) ||
      lower.includes(`hỏi ${part}`) ||
      lower.includes(`hỏi ${unacc}`) ||
      lower.includes(`cho ${part}`) ||
      lower.includes(`cho ${unacc}`) ||
      lower.startsWith(`${part} `) ||
      lower.startsWith(`${unacc} `)
    );
  });

  const explicitlyMentionsBotFullName =
    lower.includes(`@${lowerBotName}`) ||
    lower.includes(`@${unaccentedBotName}`) ||
    lower.includes(lowerBotName) ||
    lower.includes(unaccentedBotName) ||
    lower.startsWith(lowerBotName + " ") ||
    lower.startsWith(unaccentedBotName + " ");

  const mentionsThisBot =
    explicitlyMentionsBotFullName ||
    lower.includes(`${lowerBotName} ơi`) ||
    lower.includes(`${unaccentedBotName} oi`) ||
    lower.includes(`nhờ ${lowerBotName}`) ||
    lower.includes(`nhờ ${unaccentedBotName}`) ||
    lower.includes(`hỏi ${lowerBotName}`) ||
    lower.includes(`hỏi ${unaccentedBotName}`) ||
    lower.includes(`cho ${lowerBotName}`) ||
    lower.includes(`cho ${unaccentedBotName}`) ||
    mentionsShortName;

  const isTaggedByUid = Boolean(
    ownId &&
    Array.isArray(event.mentions) &&
    event.mentions.some((m: any) => String(m?.uid || m?.id) === ownId)
  );

  // Kiểm tra xem người dùng có đang tag người khác qua UID không (tag người khác thì bot tuyệt đối không xen vào)
  const isTaggedOtherUid = Boolean(
    ownId &&
    Array.isArray(event.mentions) &&
    event.mentions.length > 0 &&
    !isTaggedByUid
  );

  // Bot kích hoạt khi:
  // 1. Được tag trực tiếp bằng UID của bot (isTaggedByUid)
  // 2. Được gọi ĐÍCH DANH tên đầy đủ trong nội dung tin nhắn (explicitlyMentionsBotFullName), kể cả khi có tag UID người khác (VD: "@Mộc Miên sen chúa đọc...")
  // 3. Hoặc gọi tên ngắn/thông thường khi KHÔNG tag UID người khác (!isTaggedOtherUid)
  const mentionsBot = isTaggedByUid || explicitlyMentionsBotFullName || (mentionsThisBot && !isTaggedOtherUid);

  const isDocCommand =
    lower.startsWith("/doc") ||
    lower.startsWith("!doc") ||
    lower.startsWith("/docs") ||
    lower.startsWith("!docs") ||
    lower.startsWith("/tailieu") ||
    lower.startsWith("!tailieu") ||
    lower.startsWith("/strict") ||
    lower.startsWith("!strict") ||
    lower.startsWith("/doc-strict");

  const hasGoogleDocUrl = /https?:\/\/docs\.google\.com\/(?:spreadsheets|document)\/d\/[a-zA-Z0-9-_]+/i.test(rawText);

  const isCommand =
    isDocCommand ||
    lower.startsWith("/hoi") ||
    lower.startsWith("!hoi") ||
    lower.startsWith("/dich") ||
    lower.startsWith("!dich") ||
    lower.startsWith("/docanh") ||
    lower.startsWith("!docanh") ||
    lower.startsWith("/docfile") ||
    lower.startsWith("/file") ||
    lower.startsWith("/anh");

  const isTagBot =
    isCommand ||
    mentionsBot ||
    (hasGoogleDocUrl &&
      (lower.includes(lowerBotName) ||
        lower.includes(unaccentedBotName) ||
        lower.includes("check doc") ||
        lower.includes("đọc doc")));

  if (isTagBot) {
    userCooldowns.set(sender, now);

    // Tính năng 4 & 5: Thả reaction thông minh theo ngữ cảnh & Gửi trạng thái đang soạn tin tức thì
    const smartReaction = pickSmartReaction(rawText);
    void sendReaction(api, threadId, event.msgId, event.cliMsgId, smartReaction);
    void sendTyping(api, threadId);

    let isStrictDocQuery =
      isDocCommand ||
      hasGoogleDocUrl ||
      /\b(?:theo doc|theo tài liệu|tra trong doc|tra trong tài liệu|tra cứu doc|trong doc có|trong tài liệu có|check doc|đối chiếu doc)\b/i.test(rawText);

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const botNamePattern = new RegExp(`@?${escapeRegex(botName)}\\b`, "gi");
    const unaccBotNamePattern = new RegExp(`@?${escapeRegex(unaccentedBotName)}\\b`, "gi");

    // Làm sạch câu hỏi nhưng GIỮ NGUYÊN tên thành viên được tag (chỉ bỏ @ ở trước tên thành viên khác)
    let question = rawText
      .replace(/^\/(?:doc-strict|doc|docs|tailieu|strict|hoi|dich|docanh|docfile|file|anh)\s*/i, "")
      .replace(/^!(?:doc-strict|doc|docs|tailieu|strict|hoi|dich|docanh|docfile|file|anh)\s*/i, "")
      .replace(botNamePattern, "")
      .replace(unaccBotNamePattern, "")
      .replace(/@bot\b/gi, "")
      .replace(new RegExp(`^(?:bot|${escapeRegex(lowerBotName)}|${escapeRegex(unaccentedBotName)})\\s*(?:ơi|oi)?,?\\s*`, "i"), "")
      .replace(new RegExp(`^(?:chào|chao|alo|hi|hello)\\s+(?:bot|${escapeRegex(lowerBotName)}|${escapeRegex(unaccentedBotName)}|em)?,?\\s*`, "i"), "")
      .replace(/@([^\s,!?]+)/g, "$1")
      .replace(/^(?:ơi|oi)[,\s]*/i, "")
      .trim();

    // Loại bỏ tiền tố /doc hoặc doc: còn sót sau khi gọi bot (ví dụ: "bot /doc phương án...")
    question = question.replace(/^\/?(?:doc-strict|doc|docs|tailieu|strict)[:\s]*/i, "").trim();

    // Hướng dẫn cú pháp nếu người dùng chỉ gõ /doc mà không có câu hỏi
    if (isDocCommand && !question && !hasGoogleDocUrl && !hasImage && !hasFile && !hasQuote) {
      await sendGroupText(
        api,
        threadId,
        `🤖 ${botName} hướng dẫn tra cứu tài liệu cho @${displayName}:\n\n` +
        `👉 CÚ PHÁP TRA CỨU TÀI LIỆU CHUẨN XÁC 100% (STRICT DOC):\n` +
        `1. Tra cứu theo dự án đã có trong kho:\n` +
        `   /doc [tên_dự_án] [câu hỏi]\n` +
        `   VD: /doc Palm River: kiểm tra lại toàn bộ phương thức thanh toán\n\n` +
        `2. Tra cứu trực tiếp theo link Google Doc / Google Sheet:\n` +
        `   /doc [link] [câu hỏi]\n` +
        `   VD: /doc https://docs.google.com/document/d/... phương án đặc biệt thế nào?\n\n` +
        `💡 Khi dùng lệnh /doc, ${botName} BẮT BUỘC trích xuất 100% từ tài liệu, tuyệt đối không bao giờ tự bịa đặt hay suy diễn ngoài văn bản!`,
      );
      return;
    }

    // Tự động tải nội dung trực tiếp nếu có link Google Doc / Google Sheet
    let directDocTitle = "";
    let directDocContent = "";

    const combinedDocText = `${rawText} ${event.quote?.text || ""}`;
    const googleMatch = combinedDocText.match(/https?:\/\/docs\.google\.com\/(?:spreadsheets|document)\/d\/[a-zA-Z0-9-_]+[^\s]*/i);

    if (googleMatch) {
      isStrictDocQuery = true;
      const googleUrl = googleMatch[0].trim();
      const parsed = parseGoogleUrl(googleUrl);
      if (parsed) {
        console.log(`[member-assistant] 📑 Đang tải trực tiếp dữ liệu Google ${parsed.type === "google_sheet" ? "Sheet" : "Doc"} từ: ${googleUrl}...`);
        const fetchRes = await fetchGoogleContent(googleUrl);
        if (fetchRes.ok && fetchRes.text) {
          directDocTitle = parsed.type === "google_sheet" ? "Bảng tính Google Sheet" : "Tài liệu Google Doc";
          directDocContent = fetchRes.text;
          console.log(`[member-assistant] ✅ Đã tải trực tiếp thành công ${fetchRes.text.length} ký tự từ Google Doc/Sheet`);
        } else if (fetchRes.error === "PERMISSION_DENIED") {
          const isSuperAdmin = isUserAdmin(sender);
          const permDeniedMsg = isSuperAdmin
            ? `⚠️ Dạ Sếp ơi, em không thể đọc link Google Doc/Sheet này do chưa được mở quyền xem công khai (Viewer) ạ!\n👉 Sếp hãy mở file trên Google, bấm nút "Chia sẻ" (Share) -> chọn "Bất kỳ ai có đường liên kết" thành "Người xem" (Viewer) rồi gửi lại cho em nhé!`
            : `⚠️ Em không thể đọc link Google Doc/Sheet này do chưa được mở quyền xem công khai (Viewer)!\n👉 Bác hãy mở file trên Google, bấm nút "Chia sẻ" (Share) -> chọn "Bất kỳ ai có đường liên kết" thành "Người xem" (Viewer) rồi gửi lại câu hỏi cho em nhé!`;
          await sendGroupReplyWithMention(
            api,
            threadId,
            botName,
            displayName,
            sender,
            permDeniedMsg,
            { quote: buildQuoteObject(event) },
          );
          return;
        }
      }
    }

    const qLower = question.toLowerCase().trim();
    const greetingWords = new Set([
      "alo", "hi", "hello", "chào", "chao", "ơi", "oi", "hey", "test",
      `${lowerBotName} ơi`, `${unaccentedBotName} oi`, `chào ${lowerBotName}`, `chào ${unaccentedBotName}`,
      `chào ${botName}`, `hi ${lowerBotName}`, `hello ${lowerBotName}`,
    ]);

    const isGreeting =
      !hasImage &&
      !hasFile &&
      !hasQuote &&
      (!question || greetingWords.has(qLower));

    if (isGreeting) {
      const isSuperAdmin = isUserAdmin(sender);
      const greetingMsg = isSuperAdmin
        ? `Dạ em chào Sếp ạ! Em luôn sẵn sàng nhận lệnh từ Sếp. Sếp cần em hỗ trợ gì cứ chỉ đạo em nhé! ☘️`
        : `Dạ em ${botName} nghe đây ạ! Bác cần em hỗ trợ tra cứu hay giải đáp gì cứ nhắn em nhé! ✨`;
      await sendGroupReplyWithMention(
        api,
        threadId,
        botName,
        displayName,
        sender,
        greetingMsg,
        { quote: buildQuoteObject(event) },
      );
      console.log(`[member-assistant] ✅ Đã gửi lời chào cho ${displayName} (isSuperAdmin=${isSuperAdmin})`);
      return;
    }

    console.log(`[member-assistant] 🔍 Đang xử lý câu hỏi từ ${displayName} (${sender}): "${question}" (HasFile=${hasFile}, HasImage=${hasImage}, HasQuote=${hasQuote})...`);

    try {
      let targetImageUrl = event.mediaUrl || event.quote?.mediaUrl || undefined;

      // 1. Ưu tiên tra cứu file ảnh cục bộ nếu listener đã lưu kịp
      if (event.msgId || event.cliMsgId) {
        const directMedia = getMediaByMessageId(threadId, event.msgId || event.cliMsgId || "");
        if (directMedia?.local_path && fs.existsSync(directMedia.local_path)) {
          targetImageUrl = directMedia.local_path;
          console.log(`[member-assistant] 📸 Đã tìm thấy file ảnh cục bộ trên ổ cứng (${directMedia.local_path})`);
        }
      }

      // 2. Nếu có quote: Ưu tiên tra cứu ảnh gốc từ DB theo msgId / cliMsgId của quote
      // (đặc biệt khi URL quote là ảnh jxl hoặc thumbnail rút gọn)
      if (event.quote) {
        const quoteId = event.quote.msgId || event.quote.cliMsgId || event.quote.globalMsgId;
        if (quoteId) {
          const media = getMediaByMessageId(threadId, quoteId);
          if (media?.local_path && fs.existsSync(media.local_path)) {
            targetImageUrl = media.local_path;
            console.log(`[member-assistant] 📸 Đã tìm thấy file ảnh gốc cục bộ từ quote (${quoteId})`);
          } else if (media?.media_url) {
            targetImageUrl = media.media_url;
            console.log(`[member-assistant] 📸 Đã tìm thấy URL ảnh gốc từ tin nhắn được trích dẫn (${quoteId})`);
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

      const isSuperAdmin = isUserAdmin(sender);
      const answer = await handleHistoryQA(question, displayName, threadId, {
        api,
        imageUrl: targetImageUrl,
        fileAttachment: event.fileAttachment,
        quote: event.quote,
        strictDocMode: isStrictDocQuery,
        directDocTitle,
        directDocContent,
        sender,
        isSuperAdmin,
        mentions: event.mentions,
        rawText,
      });
      const groupSettings = getGroupSettings(threadId);
      const botName = (groupSettings.botName || defaultBotName).trim();

      // Chốt chặn an toàn cuối cùng: Không bao giờ gửi phản hồi cho chính tài khoản Bot
      const ownId = typeof api?.getOwnId === "function" ? String(api.getOwnId()).trim() : "";
      const lowerDisplay = displayName.toLowerCase().trim();
      if (
        (ownId && sender === ownId) ||
        (lowerDisplay && lowerDisplay === botName.toLowerCase())
      ) {
        console.warn(`[member-assistant] ⛔ Chặn gửi phản hồi vì người nhận (${displayName} / ${sender}) là chính Bot (${botName})`);
        return;
      }

      // Gửi câu trả lời tức thì kèm @Mention thật và Quote tin nhắn gốc
      console.log(`[member-assistant] 📤 Đang gửi phản hồi vào nhóm [${threadId}]...`);
      await sendGroupReplyWithMention(api, threadId, botName, displayName, sender, answer, {
        jitter: false,
        quote: buildQuoteObject(event),
      });
      console.log(`[member-assistant] ✅ Đã gửi câu trả lời thành công vào nhóm`);

      // 🧠 Trích xuất và cập nhật bộ nhớ dài hạn người dùng ở background (zero latency)
      setImmediate(() => {
        extractAndSaveUserMemories({
          userId: sender,
          threadId,
          userName: displayName,
          text: question || rawText,
        }).catch(() => {});

        // Tự động lưu repo nếu câu hỏi có chứa link GitHub
        if (rawText.includes("github.com")) {
          processGithubReposInMessage({
            threadId,
            text: rawText,
            senderUid: sender,
            senderName: displayName,
          }).catch(() => {});
        }
      });
    } catch (err) {
      console.error(`[member-assistant] ❌ Lỗi xử lý câu hỏi:`, err);
      const lowerDisplay = displayName.toLowerCase();
      if (
        !lowerDisplay.includes(lowerBotName) &&
        !lowerDisplay.includes(unaccentedBotName) &&
        lowerDisplay !== "bot"
      ) {
        await sendGroupReplyWithMention(
          api,
          threadId,
          botName,
          displayName,
          sender,
          `Dạ câu hỏi của bác hóc búa quá làm em ${botName} xém khét CPU 😄! Bác cho em xin vài giây thở oxy rồi hỏi lại thử xem nè!`,
          { jitter: false, quote: buildQuoteObject(event) },
        );
      }
    }
    return;
  }

  // 6. Phát hiện và phân loại liên kết GitHub Repository chia sẻ tự do trong nhóm (không cần tag bot)
  const repoCandidates = extractGithubRepoUrls(rawText);
  if (repoCandidates.length > 0) {
    try {
      void sendReaction(api, threadId, event.msgId, event.cliMsgId, Reactions.HEART);
      const { cards } = await processGithubReposInMessage({
        threadId,
        text: rawText,
        senderUid: sender,
        senderName: displayName,
      });

      if (cards.length > 0) {
        for (const card of cards) {
          await sendGroupReplyWithMention(api, threadId, botName, displayName, sender, card, {
            jitter: false,
            quote: buildQuoteObject(event),
          });
        }
        console.log(`[member-assistant] 📦 Đã gửi ${cards.length} thẻ tóm tắt GitHub repo (kèm quote) cho ${displayName} trong nhóm [${threadId}]`);
      }
    } catch (err) {
      console.warn(`[member-assistant] ⚠️ Lỗi khi bóc tách & gửi thẻ GitHub repo:`, err);
    }
    return;
  }
}

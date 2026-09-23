import {
  getDb,
  isUserAdmin,
  addAdminUser,
  setGroupMode,
  isUserAllowedDirectChat,
  savePermanentKnowledge,
  searchPermanentKnowledge,
  listPermanentKnowledge,
  deletePermanentKnowledge,
  saveRecentDirectDocument,
  getRecentDirectDocument,
  getBotState,
  setBotState,
  getAutoFriendSettings,
  upsertBotFriend,
  setFriendAllowDirect,
  getBotFriend,
  getUserMemories,
} from "./db/index.js";
import { sendDirectText, sendDirectFile, sendDirectVoice, sendGroupText } from "./zalo/client.js";
import { callGemini, callGeminiAgentLoop, downloadFileContent, type GeminiMediaPart } from "./gemini.js";
import { getSystemTemporalPrompt } from "./temporal.js";
import { defaultBotName } from "./config.js";
import fs from "node:fs";
import { type MemberMessageEvent, parseImagePromptAndRatio } from "./member-assistant.js";
import { generateCodexImage, isCodexImageConfigured, prepareImageDataUrl } from "./codex-image.js";
import { generateCloudflareImage, isCloudflareConfigured } from "./cloudflare-ai.js";
import { collectCandidateUrls } from "./message-extract.js";
import { getWeatherReport } from "./weather.js";
import { handleSetReminder, handleListReminders, handleCancelReminder } from "./reminder.js";
import { getDailyAiNewsBriefing } from "./ai-news.js";
import { searchRealtimeNews } from "./realtime-search.js";
import { planSearchQueries } from "./query-planner.js";
import { finalizeGroundedAnswer, isStrictVerificationQuestion } from "./search-evidence.js";
import { isRealEstateProjectProfileQuery } from "./real-estate-profile.js";
import { canUseGrounding, formatGroundingQuotaReport, resetGroundingQuota } from "./grounding-quota.js";
import {
  parseGoogleUrl,
  fetchGoogleContent,
  refreshDynamicKnowledgeIfExpired,
} from "./google-sync.js";
import { config } from "./config.js";
import type { QueryPlanResult } from "./query-planner.js";
import { answerWithHybridRouting } from "./hybrid-agent.js";
import { normalizeExecutionSignals, selectResponseMode } from "./hybrid-routing.js";
import { checkIsFileOrVoiceGeneration } from "./tools/file-generator.js";
import { interceptAndExecuteSimulatedTool } from "./tools/simulated-tool-interceptor.js";
import {
  isMemoryControlCommand,
  handleMemoryControlCommand,
  extractAndSaveUserMemories,
  formatUserMemoriesForPrompt,
} from "./user-memory.js";

export interface ConversationPronouns {
  botPronoun: string;
  userTitle: string;
  instruction: string;
}

function matchesPronoun(text: string, words: string[]): boolean {
  const norm = String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
  const pattern = new RegExp(`\\b(?:${words.join("|")})\\b`, "i");
  return pattern.test(norm);
}

export function deriveConversationPronouns(params: {
  isAdmin: boolean;
  displayName: string;
  rawText: string;
  quoteText?: string;
  memories?: { memory_key?: string; memory_value?: string }[];
}): ConversationPronouns {
  const { isAdmin, displayName, rawText, quoteText = "", memories = [] } = params;

  if (isAdmin) {
    return {
      botPronoun: "em",
      userTitle: "Sếp",
      instruction: `Xưng 'em' (hoặc '${defaultBotName}'), gọi Admin là 'Sếp' (hoặc '${displayName}') một cách lịch thiệp, tôn trọng và chu đáo.`,
    };
  }

  // Quét thông tin từ trí nhớ dài hạn (user_memories) và hội thoại hiện tại
  const memTexts = memories.map((m) => `${m.memory_key || ""} ${m.memory_value || ""}`).join(" ");
  const currentTexts = `${rawText} ${quoteText}`;

  // 1. Nhận diện vai vế lớn hơn (Chú, Bác, Cô, Dì, Thím, Cậu)
  let foundElder: string | null = null;
  if (matchesPronoun(memTexts, ["chu"]) || matchesPronoun(currentTexts, ["chu"])) {
    foundElder = "Chú";
  } else if (matchesPronoun(memTexts, ["bac"]) || matchesPronoun(currentTexts, ["bac"])) {
    foundElder = "Bác";
  } else if (matchesPronoun(memTexts, ["co"]) || matchesPronoun(currentTexts, ["co"])) {
    foundElder = "Cô";
  } else if (matchesPronoun(memTexts, ["di", "thim"]) || matchesPronoun(currentTexts, ["di", "thim"])) {
    foundElder = "Dì";
  }

  if (foundElder) {
    return {
      botPronoun: "cháu",
      userTitle: foundElder,
      instruction: `QUY TẮC XƯNG HÔ ĐỐI XỨNG & KÍNH TRỌNG: Người dùng là bề trên (${foundElder}). BẮT BUỘC xưng 'cháu', gọi người dùng là '${foundElder}'. TUYỆT ĐỐI CẤM xưng cọc cạch như 'em' với '${foundElder}'! Lễ phép, tự nhiên, chuẩn mực thuần phong mỹ tục Việt Nam.`,
    };
  }

  // 2. Nhận diện anh/chị
  let foundSibling: string | null = null;
  if (matchesPronoun(memTexts, ["chi"]) || matchesPronoun(currentTexts, ["chi"])) {
    foundSibling = "Chị";
  } else if (matchesPronoun(memTexts, ["anh"]) || matchesPronoun(currentTexts, ["anh"])) {
    foundSibling = "Anh";
  }

  if (foundSibling) {
    return {
      botPronoun: "em",
      userTitle: foundSibling,
      instruction: `QUY TẮC XƯNG HÔ: Xưng 'em', gọi người dùng là '${foundSibling}'. Thân thiện, chu đáo, tôn trọng.`,
    };
  }

  // 3. Mặc định
  const defaultTitle = displayName ? displayName : "bạn";
  return {
    botPronoun: "em",
    userTitle: defaultTitle,
    instruction: `Xưng 'em' hoặc 'mình', gọi người dùng là '${defaultTitle}' hoặc 'bạn'. Giữ văn phong thanh lịch, gần gũi và nhiệt tình.`,
  };
}

// Lưu lịch sử trò chuyện nhiều lượt (Multi-turn Chat) giữa Admin và Bot (Lưu tối đa 12 lượt gần nhất)
const adminChatSessions = new Map<string, { role: "user" | "model"; text: string }[]>();
const MAX_HISTORY_TURNS = 12;

// Lưu tài liệu/ảnh gần nhất vừa được phân tích trong đoạn chat 1:1 của mỗi người dùng (để kế thừa khi ra lệnh học)
const lastAnalyzedDocuments = new Map<string, { name: string; text: string; timestamp: number }>();

function getAdminHistory(userId: string) {
  if (!adminChatSessions.has(userId)) {
    adminChatSessions.set(userId, []);
  }
  return adminChatSessions.get(userId)!;
}

function clearAdminHistory(userId: string) {
  adminChatSessions.delete(userId);
}

function sanitizeModelHistoryText(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();
  // Loại bỏ các câu mở đầu xin lỗi, phân trần, thoái thác thường gặp của AI
  cleaned = cleaned.replace(/^(?:Chào\s+(?:Sếp|anh|chị|bạn)[^,.\n]*[,.\n]\s*)?(?:em\s+xin\s+lỗi\s+(?:Sếp|anh|chị|bạn)[^.\n]*[.\n]\s*)+/i, "");
  cleaned = cleaned.replace(/^(?:dạ\s+)?(?:em\s+rất\s+xin\s+lỗi|em\s+xin\s+lỗi|xin\s+lỗi\s+sếp)[^.\n]*[.\n]\s*/i, "");
  cleaned = cleaned.replace(/^(?:thông\s+tin\s+trước\s+đó\s+chưa\s+tập\s+trung|em\s+đã\s+hiểu\s+sai)[^.\n]*[.\n]\s*/i, "");
  return cleaned.trim();
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
export function normalizeQuery(str: string): string {
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
export function findGroup(query: string): { groupId: string; name: string; totalMembers: number; mode: string } | null {
  const db = getDb();
  const rawQ = query.trim();
  if (!rawQ) return null;

  // 1. Thử match chính xác group_id
  try {
    const byId = db
      .prepare("SELECT group_id as groupId, name, total_members as totalMembers, mode FROM bot_groups WHERE group_id = ?")
      .get(rawQ) as any;
    if (byId) return byId;
  } catch { }

  const allGroups = getAllGroupsList();
  if (allGroups.length === 0) return null;

  const cleanQ = normalizeQuery(rawQ);

  // 2. Thử match theo tên (chứa trọn vẹn hoặc khớp chuẩn)
  for (const g of allGroups) {
    const cleanGName = normalizeQuery(g.name);
    if (!cleanGName) continue;
    const wholeWordRegex = new RegExp(`(?:^|\\s)${cleanGName}(?:$|\\s)`);
    if (cleanGName === cleanQ || cleanGName.includes(cleanQ) || wholeWordRegex.test(cleanQ)) {
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
export function getAllGroupsList(): { groupId: string; name: string; totalMembers: number; mode: string }[] {
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
 * Lấy lịch sử hoạt động và tin nhắn thực tế gần đây nhất của các nhóm từ cơ sở dữ liệu.
 * Dùng để trả lời chính xác các câu hỏi của Admin về tình hình các nhóm, chống bịa đặt (Anti-Hallucination).
 */
export function getRecentGroupActivities(targetGroupQuery?: string): string {
  try {
    const db = getDb();
    let groups = getAllGroupsList();

    if (groups.length === 0) {
      return "Hiện tại Bot chưa ghi nhận nhóm nào trong cơ sở dữ liệu.";
    }

    // Nếu Admin chỉ định đích danh 1 nhóm (VD: "nhóm DXS", "nhóm VIP")
    if (targetGroupQuery) {
      const matched = findGroup(targetGroupQuery);
      if (matched) {
        groups = [matched];
      }
    }

    const sections: string[] = [];

    for (const g of groups) {
      let groupHeader = `=== NHÓM: ${g.name} (ID: ${g.groupId}, Chế độ: ${g.mode}) ===\n`;

      // 1. Kiểm tra bản tóm tắt gần nhất (Hub / daily_summaries)
      let summaryText = "";
      try {
        const summary = db
          .prepare(
            `SELECT day_label, summary_text 
             FROM daily_summaries 
             WHERE thread_id = ? 
             ORDER BY day_date DESC 
             LIMIT 1`
          )
          .get(g.groupId) as { day_label: string; summary_text: string } | undefined;

        if (summary && summary.summary_text) {
          const cleanSum = summary.summary_text.slice(0, 350).replace(/\s+/g, " ").trim();
          summaryText = `[Bản tóm tắt gần nhất ngày ${summary.day_label || "trước"}]:\n${cleanSum}...\n\n`;
        }
      } catch (err) {
        console.warn(`[admin-assistant] Lỗi đọc daily_summaries nhóm ${g.name}:`, err);
      }

      // 2. Lấy tối đa 15 tin nhắn thảo luận thực tế gần nhất trong group_messages
      let messagesText = "";
      try {
        const msgs = db
          .prepare(
            `SELECT display_name, text, ts 
             FROM group_messages 
             WHERE thread_id = ? AND deleted_at IS NULL AND length(trim(text)) > 0
             ORDER BY ts DESC 
             LIMIT 15`
          )
          .all(g.groupId) as { display_name: string; text: string; ts: number }[];

        if (msgs && msgs.length > 0) {
          messagesText = `[Tin nhắn thực tế gần đây nhất (${msgs.length} tin mới nhất)]:\n`;
          // Xếp lại theo thứ tự thời gian tăng dần để AI đọc hiểu đúng mạch câu chuyện
          for (const m of [...msgs].reverse()) {
            const timeStr = new Date(m.ts).toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh",
              hour: "2-digit",
              minute: "2-digit",
              day: "2-digit",
              month: "2-digit",
            });
            messagesText += `- [${timeStr}] ${m.display_name || "Thành viên"}: ${m.text.trim()}\n`;
          }
        } else {
          messagesText = `(Nhóm này hiện chưa có tin nhắn thảo luận nào gần đây trong cơ sở dữ liệu)\n`;
        }
      } catch (err) {
        console.warn(`[admin-assistant] Lỗi đọc group_messages nhóm ${g.name}:`, err);
        messagesText = `(Không thể đọc tin nhắn: ${String(err)})\n`;
      }

      sections.push(groupHeader + summaryText + messagesText);
    }

    return sections.join("\n----------------------------------------\n\n");
  } catch (e) {
    console.error(`[admin-assistant] getRecentGroupActivities error:`, e);
    return "Lỗi khi truy xuất dữ liệu hoạt động nhóm từ cơ sở dữ liệu.";
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

  // Lệnh làm sạch bộ nhớ ngữ cảnh 1:1: /clear hoặc /reset
  if (lower === "/clear" || lower === "/reset" || lower === "!clear" || lower === "!reset") {
    clearAdminHistory(sender);
    const reply = isAdmin
      ? `🧹 Dạ em ${defaultBotName} đã làm sạch toàn bộ ngữ cảnh hội thoại 1:1 rồi Sếp ơi! Sếp có thể bắt đầu chủ đề mới tinh tươm nhé! ☘️`
      : `🧹 Em đã làm sạch lịch sử trò chuyện rồi bạn nhé! Chúng mình bắt đầu cuộc trò chuyện mới nào. ☘️`;
    await sendDirectText(api, sender, reply);
    return;
  }

  // Lệnh quản lý trí nhớ cá nhân: !xemtrinho, !xoatrinho, bot nhớ gì về tôi, v.v.
  const memoryAction = isMemoryControlCommand(rawText);
  if (memoryAction) {
    const reply = handleMemoryControlCommand(memoryAction, sender, displayName);
    await sendDirectText(api, sender, reply);
    return;
  }

  // =========================================================================
  // 1.1. PHÂN QUYỀN TƯƠNG TÁC 1:1 (ADMIN & BẠN BÈ ĐƯỢC PHÉP)
  // =========================================================================
  if (!isAdmin) {
    const autoSettings = getAutoFriendSettings();

    // [QUY TẮC 1]: KHI CHẾ ĐỘ TỰ ĐỘNG KẾT BẠN ĐANG TẮT
    // Chỉ có bạn bè nào được Admin BẬT chế độ 1:1 trên Dashboard mới có thể tương tác với bot.
    // Còn lại bot IM LẶNG HOÀN TOÀN trong mọi trường hợp dù có kết bạn hay chưa (kể cả người lạ).
    if (!autoSettings.autoAccept) {
      const isAllowedFriend = isUserAllowedDirectChat(sender);
      if (!isAllowedFriend) {
        // Giữ im lặng tuyệt đối — không phản hồi, không gửi tin nhắn hướng dẫn kết bạn
        return;
      }
    } else {
      // [QUY TẮC 2]: KHI CHẾ ĐỘ TỰ ĐỘNG KẾT BẠN ĐANG BẬT
      let friendRecord = getBotFriend(sender);
      let isZaloFriend = Boolean(friendRecord);
      let hasPendingRequest = false;

      // Nếu chưa có trong DB bot_friends, kiểm tra thời gian thực với Zalo API
      if (!friendRecord && typeof (api as any).getFriendRequestStatus === "function") {
        try {
          const reqStatus = await (api as any).getFriendRequestStatus(sender);
          if (reqStatus && Number(reqStatus.is_friend) === 1) {
            isZaloFriend = true;
            upsertBotFriend({
              userId: sender,
              displayName,
              avatar: "",
              now: Date.now(),
            });
            friendRecord = getBotFriend(sender);
          } else if (reqStatus && Number(reqStatus.is_requested) === 1) {
            hasPendingRequest = true;
          }
        } catch (e) {
          console.warn(`[admin-assistant] getFriendRequestStatus(${sender}) error: ${String(e)}`);
        }
      }

      // Nếu có lời mời kết bạn đang chờ: tự động chấp nhận ngay lập tức
      if (hasPendingRequest && typeof (api as any).acceptFriendRequest === "function") {
        try {
          await (api as any).acceptFriendRequest(sender);
          console.log(`[admin-assistant] ✅ Đã tự động chấp nhận kết bạn với ${displayName} (${sender}) khi nhắn tin 1:1!`);

          upsertBotFriend({
            userId: sender,
            displayName,
            avatar: "",
            now: Date.now(),
          });
          setFriendAllowDirect(sender, true, false);
          friendRecord = getBotFriend(sender);
          isZaloFriend = true;

          // Gửi tin nhắn chào mừng tùy chỉnh
          if (autoSettings.welcomeMessage && autoSettings.welcomeMessage.trim()) {
            await sendDirectText(api, sender, autoSettings.welcomeMessage.trim());
          }
        } catch (err) {
          console.warn(`[admin-assistant] acceptFriendRequest(${sender}) error: ${String(err)}`);
        }
      }

      // Xác định quyền tương tác 1:1
      let isAllowed = false;

      if (friendRecord) {
        if (friendRecord.allowDirect) {
          isAllowed = true;
        } else if (!friendRecord.manuallyDisabled) {
          // Là bạn bè Zalo và chưa bị Admin chủ động tắt thủ công trên Dashboard:
          // Vì chế độ tự động kết bạn đang BẬT -> Tự động kích hoạt quyền 1:1!
          setFriendAllowDirect(sender, true, false);
          isAllowed = true;
          console.log(`[admin-assistant] ✅ Tự động kích hoạt quyền 1:1 cho bạn bè Zalo: ${displayName} (${sender})`);
        }
      } else if (isZaloFriend) {
        setFriendAllowDirect(sender, true, false);
        isAllowed = true;
      }

      // Nếu không có quyền:
      if (!isAllowed) {
        if (isZaloFriend || friendRecord) {
          // Bạn bè Zalo đã bị Admin chủ động gạt TẮT: Bot IM LẶNG, tuyệt đối không gửi tin đòi kết bạn
          console.log(`[admin-assistant] 🔇 Bạn bè Zalo ${displayName} (${sender}) đã bị Admin tắt quyền 1:1. Bot giữ im lặng.`);
          return;
        }

        // Là NGƯỜI LẠ THỰC SỰ (chưa kết bạn Zalo với bot):
        // Vì autoAccept đang BẬT, gửi tin nhắn hướng dẫn nhấn nút "Kết bạn" (giới hạn 1 lần / 24h)
        const strangerKey = `stranger_prompt_${sender}`;
        const lastPromptStr = getBotState(strangerKey);
        const lastPrompt = lastPromptStr ? parseInt(lastPromptStr, 10) : 0;
        const now = Date.now();
        if (now - lastPrompt > 24 * 60 * 60 * 1000) {
          setBotState(strangerKey, String(now), now);
          const promptMsg =
            `Xin chào ${displayName}! 👋\n\n` +
            `Để có thể trò chuyện và sử dụng các tính năng trợ lý AI của mình, bạn vui lòng nhấn nút **"Kết bạn"** với tài khoản Zalo này nhé!\n\n` +
            `Sau khi kết bạn, mình sẽ sẵn sàng hỗ trợ bạn ngay lập tức. Cảm ơn bạn! ✨`;
          try {
            await sendDirectText(api, sender, promptMsg);
          } catch (e) {
            console.warn(`[admin-assistant] Gửi lời nhắc kết bạn cho ${sender} thất bại: ${String(e)}`);
          }
        }
        return;
      }
    }
  }

  // =========================================================================
  // 2. TRỢ LÝ ĐIỀU KHIỂN & RA LỆNH 1:1
  // =========================================================================

  // 2.0. TẠO HOẶC SỬA ẢNH BẰNG AI (Codex GPT-Image hoặc Cloudflare):
  const imageReq = parseImagePromptAndRatio(rawText, defaultBotName, event.quote);
  if (imageReq && (imageReq.prompt.length >= 2 || imageReq.isEdit)) {
    const { prompt: imagePrompt, aspectRatio, isEdit } = imageReq;
    const isCodex = config.imageProvider === "codex";
    const ratioTag = aspectRatio !== "1:1" ? ` (${aspectRatio})` : "";

    if (isCodex) {
      if (!isCodexImageConfigured()) {
        await sendDirectText(
          api,
          sender,
          `⚠️ ${isAdmin ? "Sếp ơi, tính" : "Tính"} năng tạo/sửa ảnh AI (Codex) chưa được kích hoạt trên máy chủ (cần cấu hình NINE_ROUTER_API_KEY trong file .env). Vui lòng kiểm tra lại cấu hình nhé!`,
        );
        return;
      }
    } else {
      if (!isCloudflareConfigured()) {
        await sendDirectText(
          api,
          sender,
          `⚠️ ${isAdmin ? "Sếp ơi, tính" : "Tính"} năng vẽ ảnh AI (Cloudflare) chưa được cấu hình trên máy chủ. Vui lòng liên hệ Quản trị viên để kích hoạt nhé!`,
        );
        return;
      }
    }

    // Tìm ảnh tham chiếu nếu có (từ quote, event media, file attachment, raw payload)
    let rawTargetUrl =
      imageReq?.referenceImageUrl ||
      event.mediaUrl ||
      event.quote?.mediaUrl ||
      (event.fileAttachment?.url && /\.(?:jpg|jpeg|png|webp|gif|bmp)$/i.test(event.fileAttachment.name || event.fileAttachment.url)
        ? event.fileAttachment.url
        : undefined);

    if (!rawTargetUrl && (event as any)?.rawMessage) {
      const candidateUrls = collectCandidateUrls([(event as any).rawMessage]);
      const imageCandidate = candidateUrls.find((u) => /\.(?:jpe?g|png|webp|gif|bmp)(?:\?|$)/i.test(u) || /photo|image|zdn\.vn/i.test(u));
      if (imageCandidate) {
        rawTargetUrl = imageCandidate;
      }
    }

    let inputImageDataUrl: string | null = null;
    if (rawTargetUrl) {
      if (fs.existsSync(rawTargetUrl)) {
        inputImageDataUrl = prepareImageDataUrl(rawTargetUrl);
      } else {
        const fileRes = await downloadFileContent(rawTargetUrl);
        if (fileRes?.mediaPart?.data) {
          inputImageDataUrl = `data:${fileRes.mediaPart.mimeType || "image/png"};base64,${fileRes.mediaPart.data}`;
        }
      }
    }

    // Nếu yêu cầu sửa ảnh nhưng không có ảnh nào
    if (isEdit && !inputImageDataUrl) {
      await sendDirectText(
        api,
        sender,
        `⚠️ ${isAdmin ? "Sếp ơi, Sếp" : "Bạn"} vui lòng trích dẫn (quote) một bức ảnh hoặc gửi kèm ảnh để em chỉnh sửa nhé! ✨`,
      );
      return;
    }

    const actionVerb = isEdit ? "chỉnh sửa ảnh" : "vẽ ảnh";
    const promptPreview = imagePrompt.length > 50 ? `${imagePrompt.slice(0, 47)}...` : imagePrompt;
    await sendDirectText(
      api,
      sender,
      `🎨 ${isAdmin ? `Em đang ${actionVerb} cho Sếp` : `Em đang ${actionVerb}`}: "${promptPreview}"${ratioTag}... ${isAdmin ? "Sếp" : "Bạn"} chờ em xíu nhé! ✨`,
    );

    try {
      const imgRes = isCodex
        ? await generateCodexImage(imagePrompt, { aspectRatio, image: inputImageDataUrl, isEdit })
        : await generateCloudflareImage(imagePrompt, { aspectRatio });

      if (imgRes.success && imgRes.filePath) {
        const shortNote = imagePrompt.length <= 35 ? ` ("${imagePrompt}"${ratioTag})` : "";
        const resultLabel = isEdit ? "Ảnh sau khi chỉnh sửa của" : "Ảnh của";
        const modelTag = imgRes.tierUsed ? `\n🤖 Model: ${imgRes.tierUsed}` : "";
        await sendDirectFile(
          api,
          sender,
          imgRes.filePath,
          `🎨 ${resultLabel} ${isAdmin ? "Sếp" : displayName} đây ạ!${shortNote} ✨${modelTag}`,
        );
        console.log(`[admin-assistant] ✅ Đã gửi ảnh thành công cho ${displayName} ("${imagePrompt}", ratio: ${aspectRatio}, isEdit: ${Boolean(isEdit)}, model: ${imgRes.tierUsed || "N/A"})`);
      } else {
        await sendDirectText(
          api,
          sender,
          `⚠️ Rất tiếc ${isAdmin ? "Sếp ơi" : displayName}, quá trình ${actionVerb} gặp sự cố: ${imgRes.error || "Lỗi máy chủ"}. ${isAdmin ? "Sếp" : "Bạn"} thử lại sau ít phút nhé!`,
        );
      }
    } catch (imgErr: any) {
      console.error(`[admin-assistant] ❌ Lỗi sinh/sửa/gửi ảnh 1:1:`, imgErr);
      await sendDirectText(
        api,
        sender,
        `⚠️ Rất tiếc ${isAdmin ? "Sếp ơi" : displayName}, đã có lỗi xảy ra khi ${actionVerb}: ${imgErr?.message || String(imgErr)}`,
      );
    }
    return;
  }

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
        `🔹 /bantin : Xem ngay điểm tin AI & Công nghệ nóng nhất 24h qua trên X/Twitter\n` +
        `🔹 /quota : Xem hạn mức & số lượt Google Search Grounding đã dùng hôm nay\n\n` +
        `📋 QUẢN LÝ NHÓM ZALO:\n` +
        `🔹 /groups : Xem danh sách & ID tất cả các nhóm Zalo Bot đang tham gia\n` +
        `🔹 /send [tên_nhóm/id] [nội dung] : Gửi tin nhắn/thông báo vào nhóm chỉ định\n` +
        `🔹 /broadcast [nội dung] : Bắn thông báo cùng lúc đến TẤT CẢ các nhóm\n` +
        `🔹 /mode [tên_nhóm] [interactive/silent] : Đổi chế độ nhóm (Tương tác / Tàu ngầm)\n\n` +
        `📚 KHO TRI THỨC VĨNH VIỄN & TRA CỨU DOC (CHỐNG BỊA ĐẶT 100%):\n` +
        `🔹 /sheet [tên] [link_google_sheet] : Nạp bảng tính Google Sheet động thời gian thực\n` +
        `🔹 /doc [tên] [link_google_doc] : Nạp văn bản Google Doc động thời gian thực\n` +
        `🔹 Gửi file kèm lệnh: /hoc [tên_dự_án] (VD: /hoc Palm River, /hoc The Privé)\n` +
        `🔹 /dongbo [tên_dự_án] : Làm mới dữ liệu Google Sheet/Doc ngay lập tức\n` +
        `🔹 /kienthuc : Xem danh sách các tài liệu bot đã học và ghi nhớ vĩnh viễn\n` +
        `🔹 /xoakienthuc [mã_id/tên] : Xóa tài liệu cũ khỏi kho tri thức\n` +
        `🔹 CÚ PHÁP TRA CỨU STRICT TRONG NHÓM: /doc [tên_dự_án hoặc link] [câu hỏi]\n\n` +
        `💬 TRỢ LÝ AI RIÊNG TƯ & GOOGLE SEARCH:\n` +
        `🔹 Tìm kiếm thông tin thời gian thực, trend AI, tin tức hôm nay bằng Google Search tích hợp sẵn.\n` +
        `🔹 Soạn bài rồi bảo: "Gửi bài này vào nhóm VIP" hoặc "Bắn vào nhóm AI"\n` +
        `🔹 Phân tích file tài liệu (PDF, Word, Excel, Code) hoặc ảnh bằng AI.`;
      await sendDirectText(api, sender, helpMsg);
    } else {
      const memberHelpMsg =
        `👋 CHÀO BẠN ${displayName.toUpperCase()}!\n\n` +
        `🤖 Em là ${defaultBotName} - Trợ lý AI đồng hành cùng bạn trên Zalo. Bạn có thể:\n\n` +
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
    const briefing = await getDailyAiNewsBriefing("AI & Công nghệ trên X", defaultBotName);
    await sendDirectText(api, sender, briefing);
    return;
  }

  // 2.25. Lệnh /quota, !quota, /checkquota, !checkquota: Báo cáo hạn mức Google Search Grounding
  if (
    lower === "/quota" ||
    lower === "!quota" ||
    lower === "quota" ||
    lower === "/checkquota" ||
    lower === "!checkquota" ||
    lower === "/grounding" ||
    lower === "!grounding" ||
    lower === "grounding" ||
    lower === "/hanmuc" ||
    lower === "!hanmuc"
  ) {
    const report = formatGroundingQuotaReport();
    await sendDirectText(api, sender, report);
    return;
  }

  // 2.26. Lệnh /resetquota, !resetquota: Reset bộ đếm hạn mức Grounding hôm nay
  if (lower === "/resetquota" || lower === "!resetquota" || lower === "/resetgrounding" || lower === "!resetgrounding") {
    resetGroundingQuota();
    await sendDirectText(api, sender, "✅ Đã reset bộ đếm hạn mức và kích hoạt lại Google Search Grounding hôm nay!");
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

  // 2.8. Lệnh xem danh sách Kho Tri Thức Vĩnh Viễn: /kienthuc hoặc /dskienthuc
  if (lower === "/kienthuc" || lower === "/dskienthuc" || lower === "!kienthuc" || lower === "!dskienthuc" || lower === "kienthuc") {
    if (!isAdmin) {
      await sendDirectText(api, sender, "⚠️ Quản lý kho tri thức vĩnh viễn chỉ dành cho Admin của Bot.");
      return;
    }
    const items = listPermanentKnowledge(50);
    if (items.length === 0) {
      await sendDirectText(
        api,
        sender,
        "📚 KHO TRI THỨC VĨNH VIỄN HIỆN ĐANG TRỐNG.\n\n" +
        "👉 Để nạp tài liệu cho Bot học, Sếp chỉ cần:\n" +
        "1. Đính kèm file (PDF, Word, Excel, Ảnh) rồi gõ: /hoc [tên_dự_án]\n" +
        "2. Hoặc dán trực tiếp đoạn văn bản: /hoc [tên_dự_án]\n[nội dung tài liệu...]",
      );
      return;
    }
    const lines = ["📚 DANH SÁCH TÀI LIỆU TRONG KHO TRI THỨC VĨNH VIỄN:\n"];
    items.forEach((it, idx) => {
      const dateStr = it.updatedAt ? new Date(it.updatedAt).toLocaleDateString("vi-VN") : "";
      const summarySnippet = it.summary
        ? it.summary.replace(/\n+/g, " ").slice(0, 120) + "..."
        : "(Đã lưu toàn văn)";
      const typeBadge =
        it.sourceType === "google_sheet"
          ? "📊 [Google Sheet Động]"
          : it.sourceType === "google_doc"
            ? "📄 [Google Doc Động]"
            : "📁 [Tài liệu]";
      const sourceLine = it.sourceUrl ? `   🔗 Link: ${it.sourceUrl}\n` : `   📄 Nguồn: ${it.title}\n`;
      const syncLine = it.lastSyncedAt
        ? `   ⚡ Đồng bộ gần nhất: ${new Date(it.lastSyncedAt).toLocaleTimeString("vi-VN")} ${new Date(it.lastSyncedAt).toLocaleDateString("vi-VN")}\n`
        : "";
      lines.push(`${idx + 1}. [ID: ${it.id}] ${typeBadge} ${it.topic.toUpperCase()}\n${sourceLine}${syncLine}   📅 Ngày nạp: ${dateStr}\n   📝 Cốt lõi: ${summarySnippet}\n`);
    });
    lines.push(`👉 Đồng bộ lại Google Sheet/Doc: /dongbo [tên_dự_án]`);
    lines.push(`👉 Tra cứu tài liệu chính xác 100% trong nhóm: /doc [tên_dự_án hoặc link] [câu hỏi]`);
    lines.push(`👉 Để xóa tài liệu cũ/hết hạn: /xoakienthuc [mã_id_hoặc_tên]`);
    await sendDirectText(api, sender, lines.join("\n"));
    return;
  }

  // 2.9. Lệnh xóa tài liệu khỏi Kho Tri Thức: /xoakienthuc [mã_id|tên]
  if (lower.startsWith("/xoakienthuc ") || lower.startsWith("!xoakienthuc ")) {
    if (!isAdmin) {
      await sendDirectText(api, sender, "⚠️ Lệnh xóa tri thức chỉ dành cho Admin.");
      return;
    }
    const target = rawText.replace(/^\/(?:xoakienthuc|!xoakienthuc)\s+/i, "").trim();
    if (!target) {
      await sendDirectText(api, sender, "⚠️ Cú pháp: /xoakienthuc <mã_id_hoặc_tên_chủ_đề>");
      return;
    }
    const ok = deletePermanentKnowledge(target);
    if (ok) {
      await sendDirectText(api, sender, `✅ Đã xóa tài liệu "${target}" khỏi kho tri thức vĩnh viễn thành công!`);
    } else {
      await sendDirectText(api, sender, `❌ Không tìm thấy tài liệu nào khớp với "${target}". Gõ /kienthuc để kiểm tra danh sách nhé Sếp!`);
    }
    return;
  }

  // 2.9.1. Lệnh ĐỒNG BỘ GOOGLE SHEET / DOC: /dongbo [tên_dự_án] hoặc /sync
  if (lower.startsWith("/dongbo") || lower.startsWith("!dongbo") || lower.startsWith("/sync") || lower.startsWith("!sync")) {
    if (!isAdmin) {
      await sendDirectText(api, sender, "⚠️ Lệnh đồng bộ chỉ dành cho Admin.");
      return;
    }
    const target = rawText.replace(/^\/(?:dongbo|!dongbo|sync|!sync)\s*/i, "").trim();
    const items = listPermanentKnowledge(50);
    const dynamicItems = items.filter(
      (it) =>
        (it.sourceType === "google_sheet" || it.sourceType === "google_doc") &&
        (!target || it.topic.toLowerCase().includes(target.toLowerCase())),
    );

    if (dynamicItems.length === 0) {
      await sendDirectText(
        api,
        sender,
        target
          ? `❌ Không tìm thấy tài liệu Google Sheet/Doc nào khớp với "${target}". Gõ /kienthuc để kiểm tra danh sách nhé Sếp!`
          : `ℹ️ Hiện chưa có tài liệu nào liên kết Google Sheet hoặc Doc.\n👉 Sếp có thể dùng lệnh:\n/sheet [tên_dự_án] [link_google_sheet]\nđể kết nối nhé!`,
      );
      return;
    }

    await sendDirectText(api, sender, `⏳ Đang đồng bộ dữ liệu thời gian thực từ Google cho ${dynamicItems.length} tài liệu...`);
    const results: string[] = [];
    for (const it of dynamicItems) {
      const updated = await refreshDynamicKnowledgeIfExpired(it, true);
      results.push(`- ${it.topic}: ${updated ? "⚡ Đã cập nhật dữ liệu mới nhất!" : "✅ Dữ liệu đang mới nhất!"}`);
    }
    await sendDirectText(api, sender, `🎉 KẾT QUẢ ĐỒNG BỘ GOOGLE DYNAMIC:\n${results.join("\n")}`);
    return;
  }

  // 2.10. Lệnh NẠP TRI THỨC VĨNH VIỄN: /hoc [tên_dự_án], /sheet [tên] [link], /doc [tên] [link]
  const isSheetCommand =
    lower.startsWith("/sheet ") ||
    lower.startsWith("!sheet ") ||
    lower.startsWith("/sheets ");

  const isDocCommand =
    lower.startsWith("/doc ") ||
    lower.startsWith("!doc ") ||
    lower.startsWith("/docs ");

  const isLearnCommand =
    lower.startsWith("/hoc ") ||
    lower.startsWith("!hoc ") ||
    lower === "/hoc" ||
    lower === "!hoc" ||
    lower.startsWith("/learn ") ||
    lower.startsWith("!learn ");

  if (isAdmin && (isSheetCommand || isDocCommand || isLearnCommand)) {
    const combinedText = `${rawText} ${event.quote?.text || ""}`;
    const googleMatch = combinedText.match(/https?:\/\/docs\.google\.com\/(?:spreadsheets|document)\/d\/[a-zA-Z0-9-_]+[^\s]*/i);

    // NẾU CÓ ĐƯỜNG DẪN GOOGLE SHEET HOẶC GOOGLE DOC
    if (googleMatch) {
      const googleUrl = googleMatch[0].trim();
      const parsedGoogle = parseGoogleUrl(googleUrl);
      if (!parsedGoogle) {
        await sendDirectText(api, sender, `⚠️ Đường dẫn Google Sheet / Doc không đúng định dạng! Vui lòng kiểm tra lại link nhé Sếp.`);
        return;
      }

      let topicName = rawText
        .replace(/^\/(?:sheet|sheets|doc|docs|hoc|!hoc|learn|!learn)\s*/i, "")
        .replace(googleUrl, "")
        .replace(/https?:\/\/[^\s]+/g, "")
        .trim();

      topicName = topicName
        .replace(/^(?:này|nay|đây|đó|cái\s+này|dự\s+án\s+này|tài\s+liệu\s+này)\b\s*/i, "")
        .replace(/\s+(?:này|nay|nhe|nhé|nha|đi|giúp|với|cho|em|bot|ạ)\b.*$/i, "")
        .replace(/^(?:cho\s+anh|cho\s+em|giúp\s+anh|giúp\s+em|hộ\s+anh)\b\s*/i, "")
        .replace(/^[–—\-:]\s*/, "")
        .trim();

      if (!topicName || ["file", "tài liệu", "dự án", "sheet", "doc", "docs"].includes(topicName.toLowerCase())) {
        if (event.quote?.text) {
          const projectMatch = event.quote.text.match(/(?:dự\s*án|dự\s*án\s*bất\s*động\s*sản)\s+([A-Za-z0-9À-ỹ\s_-]+?)(?:[.,;\n]|\s+như|\s+ở|\s+tại|\s+để)/i);
          if (projectMatch && projectMatch[1]) {
            topicName = projectMatch[1].trim();
          }
        }
      }
      if (!topicName) {
        topicName = parsedGoogle.type === "google_sheet" ? "Bảng hàng Google Sheet" : "Tài liệu Google Doc";
      }

      await sendDirectText(
        api,
        sender,
        `⏳ Dạ em ${defaultBotName} đang kết nối và tải dữ liệu từ Google ${parsedGoogle.type === "google_sheet" ? "Sheet" : "Doc"} cho "${topicName}", Sếp đợi em vài giây nhé...`,
      );

      const fetchRes = await fetchGoogleContent(googleUrl);
      if (!fetchRes.ok || !fetchRes.text) {
        if (fetchRes.error === "PERMISSION_DENIED") {
          await sendDirectText(
            api,
            sender,
            `⚠️ Em không thể truy cập Google ${parsedGoogle.type === "google_sheet" ? "Sheet" : "Doc"} này!\n\n` +
            `👉 Nguyên nhân: File chưa được mở quyền xem công khai (Viewer).\n` +
            `👉 Cách mở nhanh trong 5 giây:\n` +
            `1. Mở file Google Sheet/Doc trên trình duyệt/điện thoại.\n` +
            `2. Bấm nút "Chia sẻ" (Share) ở góc trên bên phải.\n` +
            `3. Tại mục "Quyền truy cập chung", chọn: "Bất kỳ ai có đường liên kết" -> "Người xem" (Viewer).\n` +
            `4. Sau đó gửi lại lệnh cho em nhé Sếp! ☘️`,
          );
        } else if (fetchRes.error === "EMPTY_CONTENT") {
          await sendDirectText(api, sender, `⚠️ File Google ${parsedGoogle.type === "google_sheet" ? "Sheet" : "Doc"} này hiện đang trống hoặc không có nội dung chữ để nạp!`);
        } else {
          await sendDirectText(api, sender, `⚠️ Lỗi kết nối mạng khi tải dữ liệu từ Google. Sếp vui lòng thử lại sau giây lát nhé!`);
        }
        return;
      }

      // Tóm tắt và lưu vào Kho tri thức vĩnh viễn
      let summaryText = "";
      let keywordsText = "";
      try {
        const summaryPrompt =
          `Bạn là trợ lý dữ liệu thông minh. Dưới đây là dữ liệu ${parsedGoogle.type === "google_sheet" ? "bảng tính" : "tài liệu"} về chủ đề "${topicName}".\n` +
          `Nhiệm vụ của bạn:\n` +
          `1. Tóm tắt 3 đến 5 điểm then chốt quan trọng nhất (chính sách, chiết khấu, giá, quỹ căn, thời hạn, điều kiện cốt lõi) theo dạng gạch đầu dòng.\n` +
          `2. Liệt kê 5 đến 8 từ khóa tra cứu quan trọng (bao gồm tên viết tắt, từ đồng nghĩa, thuật ngữ liên quan) cách nhau bởi dấu phẩy.\n` +
          `3. TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown. Tiết chế icon, chỉ dùng 1-2 icon điểm xuyết, không spam icon.\n` +
          `Định dạng trả về chính xác:\n` +
          `TÓM TẮT:\n- ý 1\n- ý 2\nTỪ KHÓA: từ 1, từ 2, từ 3`;

        const aiRes = await callGemini(summaryPrompt, fetchRes.text.slice(0, 15000), { enableSearch: false });
        const parts = aiRes.split(/TỪ KHÓA:/i);
        summaryText = (parts[0] || "").replace(/TÓM TẮT:/i, "").trim();
        keywordsText = (parts[1] || "").trim();
      } catch (err) {
        console.warn(`[admin-assistant] Lỗi Gemini tóm tắt Google Sheet/Doc:`, err);
        summaryText = fetchRes.text.slice(0, 500);
      }

      savePermanentKnowledge({
        topic: topicName,
        title: parsedGoogle.type === "google_sheet" ? `Google Sheet: ${topicName}` : `Google Doc: ${topicName}`,
        contentText: fetchRes.text,
        summary: summaryText,
        keywords: keywordsText,
        scope: "all",
        sourceUrl: googleUrl,
        sourceType: parsedGoogle.type,
        lastSyncedAt: Date.now(),
        createdBy: displayName,
      });

      await sendDirectText(
        api,
        sender,
        `🎓 ĐÃ KẾT NỐI VÀ NẠP THÀNH CÔNG VÀO KHO TRI THỨC VĨNH VIỄN! 🎉\n\n` +
        `📁 Dự án / Chủ đề: "${topicName}"\n` +
        `${parsedGoogle.type === "google_sheet" ? "📊 Nguồn: Google Sheet (Bảng tính động)" : "📄 Nguồn: Google Doc (Văn bản động)"}\n` +
        `🔗 Link: ${googleUrl}\n` +
        `⚡ Cơ chế: Tự động đồng bộ thời gian thực (Real-time Dynamic Sync). Mỗi khi Sếp sửa bảng giá / giỏ căn trên Sheet, bot sẽ tự cập nhật khi trả lời!\n\n` +
        `📝 Tóm tắt cốt lõi:\n${summaryText}\n\n` +
        `🔑 Từ khóa tra cứu: ${keywordsText}`,
      );
      return;
    }

    const targetUrl =
      event.fileAttachment?.url ||
      event.quote?.fileAttachment?.url ||
      event.mediaUrl ||
      event.quote?.mediaUrl;
    let fileName =
      event.fileAttachment?.name ||
      event.quote?.fileAttachment?.name ||
      "";

    let topicName = "";
    if (isLearnCommand) {
      topicName = rawText.replace(/^\/(?:hoc|!hoc|learn|!learn)\s*/i, "").trim();
      if (topicName.includes("\n")) {
        topicName = (topicName.split("\n")[0] ?? "").trim();
      }
    } else {
      const match =
        rawText.match(/(?:dự án|tài liệu|chính sách|quy trình|về)\s+([^,?.!\n]+)/i) ||
        rawText.match(/(?:học|nạp|lưu)\s+([^,?.!\n]+)/i);
      if (match && match[1]) {
        topicName = match[1].trim();
      }
    }

    // Xóa bỏ các từ chỉ định / từ đệm hội thoại ở đầu hoặc cuối chuỗi
    topicName = topicName
      .replace(/^(?:này|nay|đây|đó|cái\s+này|dự\s+án\s+này|tài\s+liệu\s+này)\b\s*/i, "")
      .replace(/\s+(?:này|nay|nhe|nhé|nha|đi|giúp|với|cho|em|bot|ạ)\b.*$/i, "")
      .replace(/^(?:cho\s+anh|cho\s+em|giúp\s+anh|giúp\s+em|hộ\s+anh)\b\s*/i, "")
      .replace(/^[–—\-:]\s*/, "")
      .trim();

    const genericTopics = new Set([
      "",
      "file",
      "tài liệu",
      "dữ liệu",
      "thông tin",
      "kiến thức",
      "dự án",
      "chính sách",
      "bảng giá",
      "quy trình",
      "này",
      "nay",
      "đây",
      "đó",
      "nè",
      "cái này",
      "dự án này",
      "tài liệu này",
      "tài liệu mới",
    ]);

    // Nếu tên đề tài chung chung, ưu tiên trích xuất từ nội dung tin nhắn trích dẫn (quote)
    if (genericTopics.has(topicName.toLowerCase()) || !topicName) {
      if (event.quote?.text) {
        const projectMatch = event.quote.text.match(/(?:dự\s*án|dự\s*án\s*bất\s*động\s*sản)\s+([A-Za-z0-9À-ỹ\s_-]+?)(?:[.,;\n]|\s+như|\s+ở|\s+tại|\s+để)/i);
        if (projectMatch && projectMatch[1]) {
          topicName = projectMatch[1].trim();
        } else {
          const fileMatch = event.quote.text.match(/(?:file(?:\s+tài\s+liệu)?|tài\s+liệu)\s+([^\s\n]+?\.(?:pdf|docx?|xlsx?|pptx?))/i);
          if (fileMatch && fileMatch[1]) {
            fileName = fileMatch[1].trim();
          }
        }
      }
    }

    if (genericTopics.has(topicName.toLowerCase()) || !topicName) {
      if (fileName) {
        topicName = fileName
          .replace(/\.[^/.]+$/, "")
          .replace(/^\[File\]\s*/i, "")
          .replace(/\(\d+\)/g, "")
          .replace(/(?:training|tai\s*lieu|slide|du\s*an)[_-]?/gi, "")
          .replace(/[_-]+/g, " ")
          .trim();
      }
    }

    let fullExtractedText = "";
    let mediaPart: GeminiMediaPart | null = null;
    let downloadError: string | undefined = undefined;
    let fileSizeBytes: number | undefined = undefined;

    if (targetUrl) {
      console.log(`[admin-assistant] 📥 Đang tải file nạp tri thức: ${targetUrl.slice(0, 80)} (${fileName})`);
      const fileRes = await downloadFileContent(targetUrl, fileName);
      if (fileRes?.textContent) {
        fullExtractedText = fileRes.textContent;
        lastAnalyzedDocuments.set(sender, {
          name: fileName || topicName,
          text: fullExtractedText,
          timestamp: Date.now(),
        });
        saveRecentDirectDocument(sender, fileName || topicName, fullExtractedText);
      } else if (fileRes?.mediaPart) {
        mediaPart = fileRes.mediaPart;
        try {
          const ocrPrompt =
            `Bạn là chuyên gia trích xuất dữ liệu tài liệu. Hãy đọc kỹ toàn bộ nội dung trong hình ảnh/file PDF này, trích xuất đầy đủ chi tiết mọi thông tin văn bản, số liệu, bảng giá, chính sách chiết khấu, mốc thời gian, điều khoản, ưu đãi.\n` +
            `Trình bày chi tiết, mạch lạc, tuyệt đối không tóm tắt sơ sài để lưu trữ làm cơ sở dữ liệu vĩnh viễn.`;
          fullExtractedText = await callGemini(ocrPrompt, "Trích xuất toàn bộ chi tiết nội dung văn bản trong tài liệu này:", {
            mediaParts: [mediaPart],
            enableSearch: false,
          });
          if (fullExtractedText) {
            lastAnalyzedDocuments.set(sender, {
              name: fileName || topicName,
              text: fullExtractedText,
              timestamp: Date.now(),
            });
            saveRecentDirectDocument(sender, fileName || topicName, fullExtractedText);
          }
        } catch (err) {
          console.warn(`[admin-assistant] Lỗi Gemini OCR:`, err);
        }
      } else if (fileRes?.error) {
        downloadError = fileRes.error;
        fileSizeBytes = fileRes.fileSizeBytes;
      }
    }

    // 💡 TỰ ĐỘNG KẾ THỪA: Nếu tải qua quote thất bại hoặc link Zalo hết hạn, nhưng Sếp vừa gửi tài liệu ở tin nhắn trước
    if (!fullExtractedText) {
      // 1. Kiểm tra RAM cache
      const lastDoc = lastAnalyzedDocuments.get(sender);
      if (lastDoc && Date.now() - lastDoc.timestamp < 30 * 60 * 1000 && lastDoc.text.length >= 50) {
        console.log(`[admin-assistant] 💡 Kế thừa tài liệu từ RAM cache vừa phân tích: "${lastDoc.name}" (${lastDoc.text.length} ký tự)`);
        fullExtractedText = lastDoc.text;
        if (!fileName || fileName === "Tài liệu") {
          fileName = lastDoc.name;
        }
      } else {
        // 2. Kiểm tra SQLite DB (bền vững ngay cả khi PM2 restart hoặc quote chéo)
        const recentDbDoc = getRecentDirectDocument(sender);
        if (recentDbDoc && Date.now() - recentDbDoc.updatedAt < 2 * 3600 * 1000 && recentDbDoc.text.length >= 50) {
          console.log(`[admin-assistant] 💡 Kế thừa tài liệu từ SQLite DB vừa phân tích: "${recentDbDoc.fileName}" (${recentDbDoc.text.length} ký tự)`);
          fullExtractedText = recentDbDoc.text;
          if (!fileName || fileName === "Tài liệu") {
            fileName = recentDbDoc.fileName;
          }
        }
      }
    }

    if (!fullExtractedText) {
      // Chỉ chấp nhận văn bản dán trực tiếp nếu người dùng dán cả đoạn văn bản nhiều dòng (ít nhất 2 dòng và >= 100 ký tự)
      const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const bodyLines = lines.slice(1).join("\n").trim();
        if (bodyLines.length >= 100) {
          fullExtractedText = bodyLines;
        }
      }
    }

    if (!fullExtractedText) {
      if (downloadError === "FILE_TOO_LARGE") {
        const mb = fileSizeBytes ? (fileSizeBytes / 1024 / 1024).toFixed(1) : "hơn 50";
        await sendDirectText(
          api,
          sender,
          `⚠️ Dạ Sếp ơi, file "${fileName || topicName}" có dung lượng quá lớn (${mb} MB)!\n\n` +
          `👉 Do file vượt quá 50MB (gần 1GB) nên máy chủ không thể tải và nạp trực tiếp được.\n` +
          `👉 Sếp giúp em:\n` +
          `1. Xuất file PDF ở mức Standard / Nén dung lượng (khuyên dùng dưới 30MB - 50MB).\n` +
          `2. Hoặc gửi file Word / Bảng giá Excel / dán đoạn văn bản nội dung dự án bên dưới lệnh: /hoc ${topicName || "Tên dự án"} để em ghi nhớ vĩnh viễn nhé! ☘️`,
        );
      } else if (targetUrl) {
        await sendDirectText(
          api,
          sender,
          `⚠️ Em không thể tải hoặc đọc được nội dung từ file "${fileName || topicName}"!\n\n` +
          `👉 Nguyên nhân: Link tải file trên Zalo có thể đã hết hạn, tải bị timeout hoặc file PDF scan dạng ảnh không có lớp chữ.\n` +
          `👉 Sếp vui lòng gửi file dạng Word/Excel hoặc dán đoạn văn bản trực tiếp để em hỗ trợ nạp nhé!`,
        );
      } else {
        const displayTopic = (!genericTopics.has(topicName.toLowerCase()) && topicName) ? topicName : "Tên dự án";
        await sendDirectText(
          api,
          sender,
          `⚠️ Em chưa nhận được nội dung tài liệu để nạp!\n\n👉 Sếp vui lòng:\n1. Gửi File (PDF, Word, Excel, Ảnh) hoặc Reply vào File rồi gõ: /hoc ${displayTopic}\n2. Hoặc dán trực tiếp đoạn văn bản bên dưới câu lệnh:\n/hoc ${displayTopic}\n[Nội dung tài liệu / chính sách / giá bán...]`,
        );
      }
      return;
    }

    // Chuẩn hóa tên đề tài sau khi đã có dữ liệu thực tế
    if (genericTopics.has(topicName.toLowerCase()) || !topicName) {
      if (fileName) {
        topicName = fileName
          .replace(/\.[^/.]+$/, "")
          .replace(/^\[File\]\s*/i, "")
          .replace(/\(\d+\)/g, "")
          .replace(/(?:training|tai\s*lieu|slide|du\s*an)[_-]?/gi, "")
          .replace(/[_-]+/g, " ")
          .trim();
      }
      if (!topicName) {
        topicName = "Tài liệu mới";
      }
    }

    // Gửi thông báo bắt đầu xử lý (chỉ gửi khi ĐÃ CÓ NỘI DUNG VĂN BẢN HỢP LỆ)
    await sendDirectText(
      api,
      sender,
      `⏳ Dạ em ${defaultBotName} đang đọc và nạp tài liệu "${topicName}" vào kho tri thức vĩnh viễn, Sếp đợi em vài giây nhé...`,
    );

    let summaryText = "";
    let keywordsText = "";
    try {
      const summaryPrompt =
        `Bạn là trợ lý dữ liệu thông minh. Dưới đây là tài liệu về chủ đề "${topicName}".\n` +
        `Nhiệm vụ của bạn:\n` +
        `1. Tóm tắt 3 đến 5 điểm then chốt quan trọng nhất (chính sách, chiết khấu, giá, thời hạn, điều kiện cốt lõi) theo dạng gạch đầu dòng.\n` +
        `2. Liệt kê 5 đến 8 từ khóa tra cứu quan trọng (bao gồm tên viết tắt, từ đồng nghĩa, thuật ngữ liên quan) cách nhau bởi dấu phẩy.\n` +
        `3. TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown. Tiết chế icon, chỉ dùng 1-2 icon điểm xuyết, không spam icon.\n` +
        `Định dạng trả về chính xác:\n` +
        `TÓM TẮT:\n- ý 1\n- ý 2\nTỪ KHÓA: từ 1, từ 2, từ 3`;

      const aiRes = await callGemini(summaryPrompt, fullExtractedText.slice(0, 15000), { enableSearch: false });
      const parts = aiRes.split(/TỪ KHÓA:/i);
      summaryText = (parts[0] || "").replace(/TÓM TẮT:/i, "").trim();
      keywordsText = (parts[1] || "").trim();
    } catch (err) {
      console.warn(`[admin-assistant] Lỗi Gemini tóm tắt tri thức:`, err);
      summaryText = fullExtractedText.slice(0, 500);
    }

    const savedId = savePermanentKnowledge({
      topic: topicName,
      title: fileName || topicName,
      contentText: fullExtractedText.slice(0, 50000),
      summary: summaryText,
      keywords: keywordsText,
      scope: "all",
      createdBy: displayName,
    });

    const confirmMsg =
      `🎓 ĐÃ NẠP THÀNH CÔNG VÀO KHO TRI THỨC VĨNH VIỄN! 🎉\n\n` +
      `📁 Chủ đề / Dự án: ${topicName.toUpperCase()} (Mã ID: ${savedId})\n` +
      `📄 Nguồn tài liệu: ${fileName || "Văn bản gửi trực tiếp"}\n` +
      `📊 Dung lượng chữ: ${fullExtractedText.length.toLocaleString("vi-VN")} ký tự (File gốc đã được giải phóng khỏi VPS)\n\n` +
      `📝 CÁC ĐIỂM CỐT LÕI ĐÃ GHI NHỚ:\n${summaryText}\n\n` +
      `👉 Từ bây giờ, khi Sếp (chat 1:1) hoặc các thành viên (trong các nhóm Zalo) hỏi về "${topicName}", em sẽ tự động tra cứu kho này để trả lời chuẩn xác 100% không bao giờ bị quên ạ!`;

    await sendDirectText(api, sender, confirmMsg);
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
  const targetUrl =
    event.fileAttachment?.url ||
    event.quote?.fileAttachment?.url ||
    event.mediaUrl ||
    event.quote?.mediaUrl;
  const fileName =
    event.fileAttachment?.name ||
    event.quote?.fileAttachment?.name ||
    "";

  if (targetUrl) {
    console.log(`[admin-assistant] 📥 Đang tải tài liệu 1:1 từ: ${targetUrl.slice(0, 80)} (${fileName})...`);
    const fileRes = await downloadFileContent(targetUrl, fileName);
    if (fileRes?.mediaPart) {
      mediaPart = fileRes.mediaPart;
    } else if (fileRes?.textContent) {
      fileTextContent = fileRes.textContent;
      lastAnalyzedDocuments.set(sender, {
        name: fileName || "Tài liệu",
        text: fileTextContent,
        timestamp: Date.now(),
      });
      saveRecentDirectDocument(sender, fileName || "Tài liệu", fileTextContent);
    } else {
      // Báo rõ cho Admin thay vì để Gemini tự đoán mò từ tên file
      if (fileRes?.error === "FILE_TOO_LARGE") {
        const mb = fileRes.fileSizeBytes ? (fileRes.fileSizeBytes / 1024 / 1024).toFixed(1) : "hơn 50";
        await sendDirectText(
          api,
          sender,
          `⚠️ Dạ Sếp ơi, file "${fileName || "tài liệu"}" có dung lượng quá lớn (${mb} MB)!\n\n` +
          `👉 Do file vượt quá 50MB (gần 1GB) nên máy chủ không thể tải và giải mã trực tiếp trong vài giây được.\n` +
          `👉 Sếp giúp em:\n` +
          `1. Xuất lại file PDF ở mức Standard / Nén dung lượng (khuyên dùng dưới 30MB - 50MB).\n` +
          `2. Hoặc gửi file Word (.docx) / Bảng giá Excel (.xlsx) / dán trực tiếp văn bản nội dung dự án vào đây, em sẽ nạp và ghi nhớ ngay lập tức cho Sếp ạ! ☘️`,
        );
        return;
      }
      if (fileRes?.error === "DOWNLOAD_TIMEOUT") {
        await sendDirectText(
          api,
          sender,
          `⚠️ Dạ Sếp ơi, đường truyền tải file "${fileName || "tài liệu"}" từ Zalo bị gián đoạn hoặc timeout (do file quá nặng)!\n\n` +
          `👉 Sếp vui lòng gửi file nhẹ hơn (dưới 30MB) hoặc gửi file Word / text trực tiếp để em hỗ trợ Sếp nhé!`,
        );
        return;
      }
      await sendDirectText(
        api,
        sender,
        `⚠️ Dạ Sếp ơi, em không thể tải hoặc đọc được nội dung từ file "${fileName || "tài liệu"}"!\n\n` +
        `👉 Nguyên nhân: Link tải file từ Zalo bị gián đoạn, quá hạn hoặc file PDF scan dạng ảnh không có lớp chữ.\n` +
        `👉 Sếp vui lòng gửi file dạng văn bản (Word, Excel, PDF chuẩn) hoặc nén file nhẹ hơn để em hỗ trợ Sếp nhé!`,
      );
      return;
    }
  }

  // Lấy lịch sử trò chuyện nhiều lượt (đã được làm sạch các câu xin lỗi/phân trần)
  const history = getAdminHistory(sender);
  const historyText = history
    .map((h) => {
      const content = h.role === "model" ? sanitizeModelHistoryText(h.text) : h.text;
      return `${h.role === "user" ? `${displayName}` : `${defaultBotName} (Trợ lý)`}: ${content}`;
    })
    .filter((line) => line.trim().length > 0)
    .join("\n\n");

  const groupsSummary = isAdmin
    ? getAllGroupsList()
      .map((g) => `- ${g.name} (ID: ${g.groupId}, Mode: ${g.mode})`)
      .join("\n")
    : "";

  let userMemories: any[] = [];
  let userMemorySection = "";
  try {
    userMemories = getUserMemories(sender, 8);
    if (userMemories.length > 0) {
      userMemorySection = `\n\n` + formatUserMemoriesForPrompt(userMemories, displayName);
    }
  } catch (e) {
    console.warn("[admin-assistant] Lỗi getUserMemories:", e);
  }

  const pronouns = deriveConversationPronouns({
    isAdmin,
    displayName,
    rawText,
    quoteText: event.quote?.text,
    memories: userMemories,
  });

  const temporalPrompt = getSystemTemporalPrompt();
  const systemPrompt = `${temporalPrompt}\n\n` + (isAdmin
    ? `Bạn là '${defaultBotName}' - Trợ lý AI cá nhân cao cấp, thông minh, tận tâm và hóm hỉnh phục vụ riêng cho Admin/Chủ bot (${displayName}).\n` +
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
    `6. ĐỊNH DẠNG TINH HOA ZALO RICH TEXT (ZALO MARKDOWN ENGINE):\n` +
    `   - Hệ thống đã tích hợp bộ chuyển đổi Rich Text native cho Zalo. THOẢI MÁI dùng cú pháp Markdown tiêu chuẩn:\n` +
    `     + Dùng **in đậm** cho từ khóa chính, số liệu then chốt, tên trận đấu/đội bóng, thời gian, tên thực thể.\n` +
    `     + Dùng gạch đầu dòng '- ' cho cấp 1, '• ' cho cấp 2. Số thứ tự '1. ', '2. ' được tự động làm nổi bật.\n` +
    `   - BẢNG BIỂU & SO SÁNH: Zalo không hỗ trợ bảng kẻ viền (table). BẮT BUỘC trình bày dạng KHỐI THẺ (Card Layout) từng đối tượng hoặc danh sách so sánh rút gọn (dưới 40 ký tự/dòng).\n` +
    `   - TIẾT CHẾ ICON / EMOJI: Tối đa 1-2 icon ở tiêu đề chính (như 🔥, 📅, ⚡, 📌). CẤM spam icon vào từng đầu gạch dòng.\n` +
    `7. QUY TẮC CƠ CẤU TRẢ LỜI ĐA LĨNH VỰC: TRỰC TIẾP, DẪN NGUỒN CHUẨN XÁC & GỢI MỞ:\n` +
    `   - BẮT BUỘC ĐI THẲNG VÀO ĐÁP ÁN, SỐ LIỆU HOẶC THÔNG TIN CỐT LÕI ngay từ dòng đầu tiên.\n` +
    `   - TUYỆT ĐỐI CẤM mở bài bằng các câu chào hỏi rườm rà, cảm thán đùa cợt, phân trần giải thích lý do, hứa hẹn tương lai, tự kiểm điểm hoặc các câu chào báo cáo dài dòng làm loãng tin (CẤM các câu kiểu "em xin lỗi Sếp vì...", "thông tin trước đó chưa tập trung...", "em đang theo dõi sát sao...").\n` +
    `   - Dù ở lượt trước Sếp có nhắc nhở hay phàn nàn, lượt này PHẢI CUNG CẤP NGAY ĐÁP ÁN CHÍNH XÁC VÀ GỌN GÀNG, tuyệt đối không nhắc lại chuyện cũ hay phân trần.\n` +
    `   - ${pronouns.instruction}\n` +
    `8. ĐỘ DÀI & TỐC ĐỘ: Trả lời gãy gọn, đúng trọng tâm, súc tích (khoảng 300-800 ký tự). Tránh viết dài dòng lan man trừ khi được yêu cầu phân tích sâu.\n` +
    `9. NGUYÊN TẮC TRUNG THỰC & CHỐNG BỊA ĐẶT (ANTI-HALLUCINATION):\n` +
    `   - Nếu trong tài liệu, hình ảnh, trích dẫn hoặc dữ liệu không có thông tin chi tiết về điều Sếp hỏi, hãy thành thật trả lời là không có thông tin đó. Tuyệt đối cấm tự suy diễn hoặc bịa ra sự kiện, sản phẩm không có căn cứ.\n` +
    `   - KHI ADMIN YÊU CẦU KIỂM TRA / RÀ SOÁT / TÓM TẮT TÌNH HÌNH CÁC NHÓM: BẮT BUỘC chỉ được tổng hợp từ danh sách tin nhắn và tóm tắt thực tế được cung cấp trong mục [DỮ LIỆU HOẠT ĐỘNG THỰC TẾ TỪ CÁC NHÓM]. Nêu rõ tên nhóm và những ý chính CÓ THẬT. Nếu nhóm nào không có tin nhắn thảo luận mới, hãy báo trung thực là nhóm đó chưa có hoạt động mới. TUYỆT ĐỐI CẤM TỰ BỊA ĐẶT chính sách, tài liệu hay sự kiện của nhóm!\n` +
    `   - KHI CÂU HỎI LÀ TỔNG QUAN DỰ ÁN BẤT ĐỘNG SẢN / CÔNG TRÌNH / HỒ SƠ THƯƠNG MẠI:\n` +
    `     + BẮT BUỘC cấu trúc câu trả lời chuyên nghiệp, sắc nét, đầy đủ theo các phân mục rõ ràng:\n` +
    `       • 🏢 TỔNG QUAN DỰ ÁN (Tên thương mại, Chủ đầu tư/đơn vị phát triển, Đơn vị thiết kế/thi công, Tổng vốn đầu tư, Mốc khởi công & dự kiến bàn giao).\n` +
    `       • 📍 1. Vị trí đắc địa & Kết nối giao thông (Địa chỉ chi tiết, lợi thế ven sông/hồ, cự ly kết nối tới bệnh viện, TTTM, hạ tầng trọng điểm).\n` +
    `       • 📐 2. Quy mô & Cơ cấu sản phẩm (Diện tích khu đất, số lượng tháp/tầng, chi tiết từng loại hình: Căn hộ ở 1-3PN, Căn hộ Officetel, Shophouse khối đế, diện tích từng loại).\n` +
    `       • 🌿 3. Tiện ích & Phong cách sống (Phát triển theo phong cách gì, hồ bơi, gym, yoga, sauna, mảng xanh, tiện ích đặc quyền).\n` +
    `       • 💰 4. Giá bán & Chính sách tham khảo (Giá rumor/dự kiến đợt 1 từng loại hình, chính sách bán hàng hoặc vay vốn nếu có).\n` +
    `     + In đậm các số liệu quan trọng, trình bày gạch đầu dòng rõ ràng, mạch lạc, tối ưu hiển thị trên giao diện chat Zalo.\n` +
    `   - [CHỐNG BẺ LÁI SANG BẤT ĐỘNG SẢN]: Khi người dùng hỏi về địa lý, xã hội, khoa học, chính trị, thể thao, công nghệ, lịch sử: PHẢI TRẢ LỜI ĐÚNG TRỌNG TÂM, CẤM tự ý suy diễn người hỏi đi du lịch hay lôi chuyện bất động sản/mua bán đất vào câu trả lời nếu người dùng không hỏi về BĐS!`
    : `Bạn là '${defaultBotName}' - Trợ lý AI thông minh, thân thiện, duyên dáng và hóm hỉnh của Zalo đang trò chuyện 1:1 với ${pronouns.userTitle} (${displayName}).\n` +
    `NHIỆM VỤ CỦA BẠN:\n` +
    `1. Trò chuyện tự nhiên, vui vẻ, giải đáp mọi câu hỏi, tư vấn học tập, công việc, tâm sự, dịch thuật, phân tích hình ảnh/tài liệu khi được gửi tới.\n` +
    `2. QUY TẮC ĐỊNH DẠNG TIN NHẮN ZALO:\n` +
    `   - Hệ thống đã tích hợp bộ chuyển đổi Rich Text native cho Zalo. THOẢI MÁI dùng cú pháp Markdown: **in đậm** từ khóa chính, số liệu; dùng gạch đầu dòng '- ' hoặc '• '.\n` +
    `   - TIẾT CHẾ ICON / EMOJI TỐI ĐA: Giữ văn phong thanh lịch, không chèn icon vào từng gạch đầu dòng, chỉ dùng 1-2 icon ở tiêu đề nếu cần.\n` +
    `3. THÁI ĐỘ & QUY TẮC XƯNG HÔ:\n` +
    `   - ${pronouns.instruction}\n` +
    `   - Lễ phép, chu đáo, tôn trọng. Bắt buộc đi thẳng vào đáp án, cấm mở bài xin lỗi hoặc vòng vo.\n` +
    `4. Bạn là trợ lý trò chuyện cá nhân, không có quyền can thiệp vào các nhóm Zalo khác.\n` +
    `5. ĐỘ DÀI & TỐC ĐỘ: Trả lời gãy gọn, súc tích (khoảng 300-600 ký tự), dễ đọc trên điện thoại Zalo. Tránh viết dông dài trừ khi người dùng yêu cầu giải thích chi tiết hoặc phân tích sâu.\n` +
    `6. NGUYÊN TẮC TRUNG THỰC: Nếu không có dữ liệu chi tiết, hãy nói rõ là không có thông tin, tuyệt đối không tự bịa đặt câu chuyện hay chi tiết không có thật.\n` +
    `7. KHI CÂU HỎI LÀ TỔNG QUAN DỰ ÁN BẤT ĐỘNG SẢN / CÔNG TRÌNH:\n` +
    `   - BẮT BUỘC cấu trúc câu trả lời chuyên nghiệp theo 4 phân mục: 🏢 TỔNG QUAN DỰ ÁN, 📍 1. Vị trí đắc địa, 📐 2. Quy mô & Cơ cấu sản phẩm, 🌿 3. Tiện ích, 💰 4. Giá bán & Chính sách tham khảo.\n` +
    `8. [CHỐNG BẺ LÁI SANG BẤT ĐỘNG SẢN]: Khi người dùng hỏi về chủ đề khác, tuyệt đối không tự ý lôi chuyện nhà đất/bất động sản vào.`);

  let fileSection = "";
  if (fileTextContent) {
    fileSection = `\n=== NỘI DUNG TÀI LIỆU ĐÍNH KÈM (${fileName}): ===\n${fileTextContent.slice(0, 40000)}\n`;
  }

  let quoteSection = "";
  if (event.quote?.text) {
    const qText = event.quote.text;
    const userHistory = getAdminHistory(sender);
    const matchedHistory = userHistory.find((h) => h.text.includes(qText) || qText.includes(h.text.slice(0, 80)));
    if (matchedHistory && matchedHistory.text.length > qText.length) {
      event.quote.text = matchedHistory.text;
    }
    quoteSection = `\n=== NỘI DUNG TRÍCH DẪN: ===\n"${event.quote.text}"\n`;
  }

  // 2.0. Đọc hiểu ngữ nghĩa & Lập kế hoạch tra cứu bằng Gemini Flash-Lite (Semantic Query Planner)
  let liveNews = "";
  let evidenceRequired = false;
  let planNeedsSearch = false;
  let queryPlan: QueryPlanResult | null = null;
  try {
    const plan = await planSearchQueries({
      question: rawText,
      quoteText: event.quote?.text,
      recentContext: historyText,
      displayName,
    });
    queryPlan = plan;

    const isFileOrVoiceReq = checkIsFileOrVoiceGeneration(rawText, event.quote?.text);
    if (!isFileOrVoiceReq && plan.needsSearch && plan.queries.length > 0) {
      planNeedsSearch = true;
      evidenceRequired = (plan.intent === "fact_check" || plan.intent === "realtime_news") && isStrictVerificationQuestion(rawText);
      const searchQueries = plan.queries.slice(0, 2);
      console.log(`[admin-assistant] 🧠 Semantic Planner: intent=${plan.intent}, queries=${JSON.stringify(searchQueries)}`);
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
          console.warn(`[admin-assistant] ⏱️ Timeout quét tìm kiếm (8s), tiếp tục với dữ liệu sẵn có`);
          resolve([]);
        }, 8000);
      });
      const searchResults = await Promise.race([searchPromises, searchTimeout]);
      if (searchTimer) clearTimeout(searchTimer);
      liveNews = searchResults.filter(Boolean).join("\n\n---\n\n");
      console.log(`[admin-assistant] ⏱️ Quét dữ liệu hoàn tất trong ${Date.now() - tStartSearch}ms (dài: ${liveNews.length} ký tự)`);
    }
  } catch (e) {
    console.warn("[admin-assistant] planSearchQueries lỗi:", e);
  }

  const liveNewsSection = liveNews
    ? `\n=== DỮ LIỆU THỜI GIAN THỰC & BÁCH KHOA MỚI NHẤT: ===\n${liveNews}\n`
    : "";

  const searchInstruction = liveNews
    ? `\n8. TỔNG HỢP THÔNG TIN THỜI GIAN THỰC & SỰ KIỆN / PHÁP LUẬT MỚI:\n` +
    `- Câu hỏi này liên quan đến tin tức, sự kiện, thời điểm ra mắt, đơn vị hành chính hoặc số liệu thực tế.\n` +
    `- BẮT BUỘC ĐỌC KỸ và TRÍCH XUẤT CHÍNH XÁC các thông tin, con số mới nhất từ danh sách bản tin / Wikipedia / nguồn dữ liệu bên dưới.\n` +
    `- NGUỒN DỮ LIỆU THỜI GIAN THỰC CÓ ĐỘ ƯU TIÊN CAO NHẤT, ĐÈ LÊN MỌI LẬP LUẬN CŨ VÀ DỮ LIỆU LỖI THỜI TRONG TRÍ NHỚ.\n`
    : "";

  // 2.1. Nhận diện câu hỏi kiểm tra / rà soát / tóm tắt tình hình các nhóm Zalo (Chỉ dành cho Admin)
  const isGroupQuery =
    isAdmin &&
    (/(?:check|kiểm tra|xem|tổng hợp|tóm tắt|báo cáo|tình hình|cập nhật|soát|ra soát|rà soát|nhắn gì|nói gì)\b.*?\b(?:nhóm|group|toàn bộ|tất cả)/i.test(rawText) ||
      /(?:nhóm|group|các nhóm|toàn bộ nhóm)\b.*?\b(?:có gì|thế nào|sao rồi|nhắn gì|nói gì|biến gì|tin gì|hot gì|thông tin|hoạt động|quan trọng)/i.test(rawText) ||
      /(?:toàn bộ|tất cả)\s+(?:các\s+)?(?:nhóm|group)/i.test(rawText) ||
      /(?:trong|ở)\s+(?:các|các\s+nhóm|toàn bộ)\s+nhóm/i.test(rawText) ||
      /(?:nhắc|tag|gọi|kêu|hỏi)\b.*?\b(?:anh|sếp|trien)/i.test(rawText));

  let groupActivitiesSection = "";
  if (isGroupQuery) {
    let targetGroup: string | undefined = undefined;
    const isAllGroups = /(?:toàn bộ|tất cả|mọi nhóm|các nhóm)/i.test(rawText);
    if (!isAllGroups) {
      const matchGroup = rawText.match(/(?:nhóm|group)\s+([^,?.!]+)/i);
      if (matchGroup && matchGroup[1]) {
        targetGroup = matchGroup[1].trim();
      }
    }
    const activities = getRecentGroupActivities(targetGroup);
    groupActivitiesSection = `\n=== DỮ LIỆU HOẠT ĐỘNG THỰC TẾ TỪ CÁC NHÓM (TRÍCH XUẤT TỪ DATABASE): ===\n${activities}\n`;
  }

  const groupInstruction = isGroupQuery
    ? `\n9. BÁO CÁO HOẠT ĐỘNG CÁC NHÓM: BẮT BUỘC ĐỌC KỸ dữ liệu trích xuất từ database của các nhóm bên dưới. Chỉ tóm tắt những tin nhắn CÓ THẬT. Nếu nhóm nào không có tin nhắn mới, hãy báo trung thực là nhóm đó hiện chưa có tin nhắn thảo luận mới. TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT!\n`
    : "";

  // 2.2. Tra cứu từ Kho tri thức vĩnh viễn (nếu có tài liệu liên quan đến câu hỏi của Admin)
  const matchedKnowledge = searchPermanentKnowledge(rawText, "all", 2, event.quote?.text || "");
  for (const it of matchedKnowledge) {
    if (it.sourceType === "google_sheet" || it.sourceType === "google_doc") {
      await refreshDynamicKnowledgeIfExpired(it);
    }
  }
  let permanentKnowledgeSection = "";
  if (matchedKnowledge.length > 0) {
    permanentKnowledgeSection =
      `\n=== TÀI LIỆU CHÍNH THỨC TỪ KHO TRI THỨC VĨNH VIỄN (DO ADMIN NẠP): ===\n` +
      matchedKnowledge
        .map(
          (k) => {
            const typeLabel =
              k.sourceType === "google_sheet"
                ? " (Bảng tính Google Sheet trực tiếp)"
                : k.sourceType === "google_doc"
                  ? " (Văn bản Google Doc trực tiếp)"
                  : "";
            return `[CHỦ ĐỀ: ${k.topic.toUpperCase()}${typeLabel}]\n${k.summary ? `Tóm tắt cốt lõi:\n${k.summary}\n` : ""}${k.contentText ? `Chi tiết tài liệu thời gian thực:\n${k.contentText.slice(0, 30000)}\n` : ""
              }`;
          },
        )
        .join("\n--------------------\n") +
      "\n";
  }

  const knowledgeInstruction = matchedKnowledge.length > 0
    ? `\n10. NGUYÊN TẮC CHỐNG BỊA ĐẶT TUYỆT ĐỐI (ZERO HALLUCINATION): Câu hỏi của Sếp liên quan đến tài liệu/chính sách trong [KHO TRI THỨC VĨNH VIỄN]. BẮT BUỘC trích dẫn chính xác 100% số liệu, tỷ lệ %, đợt thanh toán, chính sách từ tài liệu này. TUYỆT ĐỐI CẤM tự ý bịa đặt thêm các chính sách cam kết thuê lại, quà tặng vàng/nội thất, hay tiến độ trả góp nếu tài liệu không đề cập. Nếu tài liệu thiếu hoặc không có thông tin, hãy báo thẳng thắn là tài liệu không đề cập!\n`
    : "";

  const encyclopediaInstruction =
    `\n11. CHUẨN ĐỊNH DẠNG BÁCH KHOA TOÀN THƯ & CHUYÊN GIA PHÂN TÍCH:\n` +
    `    - KHI HỎI VỀ THỊ TRƯỜNG / BẤT ĐỘNG SẢN / DỰ ÁN / KINH TẾ / TIN TỨC SỰ KIỆN NÓNG (Hôm nay có gì hot, tin nóng, tình hình):\n` +
    `      + BẮT BUỘC TRÌNH BÀY ĐỦ 2 PHẦN CHO MỖI ĐIỂM TIN: [TIÊU ĐỀ RÕ RÀNG] KÈM [TÓM TẮT DIỄN BIẾN CĂN BẢN 2-3 CÂU].\n` +
    `      + Định dạng chuẩn cho từng điểm tin:\n` +
    `        - Tên sự kiện / Dự án / Chủ đầu tư: [Tóm tắt căn bản 2-3 câu giải thích rõ: Cụ thể sự việc gì đang diễn ra? Doanh nghiệp/chủ đầu tư nào liên quan? Ở địa phương nào? Mức giá/diện tích/số căn cụ thể là bao nhiêu? Thay đổi hay tác động cụ thể ra sao?]\n` +
    `      + TUYỆT ĐỐI CẤM CHỈ LIỆT KÊ TIÊU ĐỀ MẬP MỜ KHÔNG CÓ NỘI DUNG (CẤM các câu viết lửng lơ như "có những thay đổi quan trọng lúc 9h", "dành 40% cho một hạng mục đặc biệt", "đại gia Singapore bán 10.000 căn" mà không nói rõ thay đổi gì, hạng mục gì, đại gia nào). Người đọc phải hiểu ngay bản chất sự việc một cách mạch lạc mà không cần phải đi tra lại báo!\n` +
    `    - KHI HỎI TỔNG QUAN DỰ ÁN BẤT ĐỘNG SẢN / CÔNG TRÌNH / SẢN PHẨM THƯƠNG MẠI:\n` +
    `      + BẮT BUỘC cấu trúc câu trả lời chuyên nghiệp, sắc nét, đầy đủ theo các phân mục rõ ràng:\n` +
    `        • 🏢 TỔNG QUAN DỰ ÁN (Tên thương mại, Chủ đầu tư/đơn vị phát triển, Đơn vị thiết kế/thi công, Tổng vốn đầu tư, Mốc khởi công & dự kiến bàn giao).\n` +
    `        • 📍 1. Vị trí đắc địa & Kết nối giao thông (Địa chỉ chi tiết, lợi thế ven sông/hồ, cự ly kết nối tới bệnh viện, TTTM, hạ tầng trọng điểm).\n` +
    `        • 📐 2. Quy mô & Cơ cấu sản phẩm (Diện tích khu đất, số lượng tháp/tầng, chi tiết từng loại hình: Căn hộ ở 1-3PN, Căn hộ Officetel, Shophouse khối đế, diện tích từng loại).\n` +
    `        • 🌿 3. Tiện ích & Phong cách sống (Phát triển theo phong cách gì, hồ bơi, gym, yoga, sauna, mảng xanh, tiện ích đặc quyền).\n` +
    `        • 💰 4. Giá bán & Chính sách tham khảo (Giá rumor/dự kiến đợt 1 từng loại hình, chính sách bán hàng hoặc vay vốn nếu có).\n` +
    `      + In đậm các số liệu quan trọng, trình bày gạch đầu dòng rõ ràng, mạch lạc, tối ưu hiển thị trên giao diện chat Zalo.\n` +
    `    - KHI HỎI VỀ CHÍNH TRỊ / THẾ GIỚI / PHÁT NGÔN LÃNH ĐẠO (Trump, Putin, Biden, Bầu cử, Chiến sự, Thuế quan):\n` +
    `      + BẮT BUỘC TRÍCH XUẤT CÁC PHÁT NGÔN / DIỄN BIẾN MỚI NHẤT từ dữ liệu thời gian thực được cung cấp (trong 24h - 7 ngày qua).\n` +
    `      + TRÍCH DẪN NGUYÊN VĂN: BẮT BUỘC đặt các phát ngôn, tuyên bố then chốt trong ngoặc kép "..." (ví dụ: "Sản phẩm của họ không đủ tốt!", "chuyện nhỏ").\n` +
    `      + NÊU RÕ NỀN TẢNG & BỐI CẢNH CỤ THỂ: Nêu rõ phát biểu được đưa ra ở đâu (bài đăng trên mạng xã hội Truth Social, trả lời họp báo tại Nhà Trắng, mạng xã hội X, phỏng vấn báo chí, sắc lệnh ban hành).\n` +
    `      + NÊU RÕ THỜI ĐIỂM CỤ THỂ: Ghi rõ ngày tháng diễn ra (ví dụ: ngày 07/09/2026, ngày 04/09/2026).\n` +
    `      + NGUỒN KIỂM CHỨNG: Chỉ dùng URL và ngày có trong các bản ghi [E#] được cung cấp; không tự thêm tên nguồn hoặc mốc ngày.\n` +
    `      + CHỦ ĐỘNG GỢI Ý CÂU HỎI MỞ: Luôn kết thúc bằng một câu hỏi tương tác tinh tế, gợi mở đào sâu các mảng liên quan (ví dụ: "Anh/Sếp đang theo dõi cụ thể phát ngôn của ông ấy về mảng kinh tế thương mại hay chiến sự Trung Đông để em tìm sâu hơn ạ?").\n` +
    `      + ĐỊNH DẠNG: Thoải mái dùng **in đậm** cho từ khóa then chốt; không spam icon ở từng dòng; dùng gạch đầu dòng '-' hoặc '•' rõ ràng, mạch lạc.\n` +
    `    - KHI HỎI VỀ SẢN PHẨM / CÔNG NGHỆ / TIẾN ĐỘ RA MẮT:\n` +
    `      + Trình bày rõ: [Tiến độ & Thời điểm phát hành dự kiến] (nêu mốc thời gian thực tế, các bản thử nghiệm/chính thức).\n` +
    `      + Nếu câu hỏi có so sánh đối thủ: Trình bày [So sánh đa chiều] tinh gọn, thanh lịch. Với từng đối thủ nêu rõ 3 ý bằng gạch đầu dòng thông thường (TUYỆT ĐỐI KHÔNG dùng icon ở từng dòng): - Điểm mạnh nhất: ... | - So sánh tương quan: ... | - Điểm trừ / Lưu ý: ...\n` +
    `      + Kết bài luôn có mục [Tóm lại & Lời khuyên thực chiến] để người dùng biết nên chọn hoặc chờ đợi điều gì.\n` +
    `    - KHI HỎI VỀ TÀI CHÍNH / GIÁ CẢ THỊ TRƯỜNG (Vàng, Xăng, Ngoại tệ, Lãi suất, Bitcoin/Crypto):\n` +
    `      + BẮT BUỘC trích xuất chính xác các con số niêm yết mới nhất từ dữ liệu được cung cấp hoặc tìm kiếm (ghi rõ mốc ngày giờ, đơn vị triệu đồng/lượng hoặc USD/ounce hoặc USD/BTC).\n` +
    `      + Nêu rõ nguồn số liệu niêm yết (SJC, DOJI, Kitco, Binance, CoinGecko, Petrolimex, Vietcombank...).\n` +
    `      + Nếu câu hỏi hỏi nhiều tài sản cùng lúc (ví dụ cả Vàng và Bitcoin/Crypto): BẮT BUỘC cung cấp cụ thể số liệu của TẤT CẢ các tài sản được hỏi, tuyệt đối không được bỏ sót con số của bất kỳ loại tài sản nào.\n` +
    `    - KHI HỎI VỀ PHÁP LÝ / THỦ TỤC HÀNH CHÍNH (Đất đai, Xe cộ, Thuế, VNeID, Giao thông):\n` +
    `    - KHI HỎI VỀ THỂ THAO / LỊCH THI ĐẤU / SỰ KIỆN CÓ MỐC THỜI GIAN:\n` +
    `      + BẮT BUỘC phân chia khối thẻ rõ ràng, trực quan:\n` +
    `        🔥 Các trận cầu đinh không thể bỏ lỡ (hoặc Trận cầu tâm điểm)\n` +
    `        📅 Lịch chi tiết các cặp đấu còn lại (hoặc Lịch chi tiết phân nhóm theo từng ngày kèm giờ VN, cặp đối đầu Đội A vs Đội B, vòng đấu, kênh trực tiếp).\n` +
    `      + Khi hỏi về đội tuyển/thể thao nhiều cấp độ (ĐTQG, U23, Tuyển Nữ...): BẮT BUỘC liệt kê đầy đủ từng cấp độ với các trận đấu sắp tới. TUYỆT ĐỐI CẤM trả lời sơ sài 1 dòng rồi hỏi ngược lại người dùng!\n` +
    `      + TUYỆT ĐỐI KHÔNG chỉ nói chung chung 1-2 câu rồi dừng lại mà phải cung cấp lịch thi đấu cụ thể, chi tiết nhất từ dữ liệu tra cứu.\n` +
    `    - KHI HỎI VỀ ĐỊNH NGHĨA / LỊCH SỬ / KHOA HỌC / ĐỜI SỐNG:\n` +
    `      + Giải thích bản chất một cách dễ hiểu, sinh động, chuẩn xác như bách khoa toàn thư.\n` +
    `    - CẬP NHẬT DỮ KIỆN THỜI GIAN THỰC & PHÁP LUẬT / HÀNH CHÍNH MỚI NHẤT:\n` +
    `      + BẮT BUỘC ưu tiên dữ liệu mới nhất từ phần 'DỮ LIỆU THỜI GIAN THỰC & BÁCH KHOA MỚI NHẤT'. Khi câu hỏi liên quan đến dữ kiện thực tế có tính biến động (chính sách, luật pháp, đơn vị hành chính, giá cả, số liệu): TUYỆT ĐỐI KHÔNG bám vào số liệu cũ trong trí nhớ đã lỗi thời nếu dữ liệu tra cứu cung cấp văn bản, nghị quyết hoặc số liệu mới hơn. Phải giải thích rõ ràng và cập nhật số liệu mới nhất cho Sếp/người hỏi!\n`;

  const claimGroundingInstruction =
    `\n13. NGUYÊN TẮC NEO DỮ KIỆN & LỌC SỰ THẬT CÓ NGÀY THÁNG (CLAIM GROUNDING WITH DATES):\n` +
    `    - KHI TRẢ LỜI VỀ TIN TỨC, CÔNG NGHỆ, MÔ HÌNH AI, SỰ KIỆN, PHÁT HÀNH, GIÁ CẢ:\n` +
    `      + Chỉ khẳng định dữ kiện có trong bản ghi [E#] đã được hệ thống chấp nhận; giữ nguyên ngày và URL của bản ghi.\n` +
    `      + Mỗi mệnh đề phải được MỘT bản ghi [E#] chứa đồng thời đúng thực thể, thuộc tính/chức vụ và giá trị/tên người. Cấm ghép tên ở nguồn này với chức vụ, con số, ngày hoặc sự kiện ở nguồn khác.\n` +
    `      + Với câu hỏi "hiện nay/hiện tại là ai", chỉ trả lời danh tính được nguồn chính thức mới nhất xác nhận; không lấy người tiền nhiệm/người chỉ được nhắc tới và không tự thêm danh sách hoạt động nếu không được hỏi.\n` +
    `      + Nếu EVIDENCE_STATUS là INSUFFICIENT hoặc thông tin chỉ là đồn đoán: nói rõ chưa đủ xác nhận, tuyệt đối không đoán hoặc tự bịa mốc thời gian.\n` +
    `      + Tuyệt đối không tạo tên nguồn, ngày hoặc URL không có trong dữ liệu bằng chứng.\n` +
    `\n14. KỸ NĂNG XUẤT TÀI LIỆU, SLIDE VÀ VOICE THẬT (.PPTX, .DOCX, .XLSX, .M4A, .MD, .TXT):\n` +
    `    - QUY TẮC BẮT BUỘC: Khi người dùng yêu cầu tạo bài thuyết trình / slide PowerPoint (.pptx), xuất file Word (.docx), Excel (.xlsx), hoặc tạo giọng đọc / voice / podcast (.m4a), HOẶC giục 'soạn luôn đi', 'làm luôn đi':\n` +
    `      * BẮT BUỘC PHẢI GỌI CÔNG CỤ 'generate_file' (fileType='pptx' cho slide, 'docx' cho word, 'xlsx' cho excel) HOẶC 'create_voice' để xuất file thực tế gửi lên Zalo!\n` +
    `      * Với slide PowerPoint (.pptx): Phải chia nội dung thành các slide rõ ràng bằng các tiêu đề markdown '# Tiêu đề slide' và nội dung gạch đầu dòng chi tiết cho từng slide.\n` +
    `      * TUYỆT ĐỐI CẤM CHỈ GÕ DÀN Ý BẰNG CHỮ RỒI HỎI NGƯỢC LẠI NGƯỜI DÙNG có muốn soạn không. Hãy hành động và xuất file ngay lập tức!\n` +
    `      * [QUY TẮC BẢO LƯU NGUYÊN VẸN TRI THỨC KHI ĐÓNG GÓI / XUẤT FILE ĐA LĨNH VỰC]: Khi người dùng yêu cầu 'đóng gói', 'xuất file', 'lưu vào file', 'chuyển thành file' (Word/docx, Excel/xlsx, PowerPoint/pptx, PDF, CSV, TXT...) từ nội dung tin nhắn được trích dẫn (quote) hoặc nội dung đã bàn luận trước đó: BẮT BUỘC PHẢI BẢO LƯU NGUYÊN VẸN 100% TOÀN BỘ NỘI DUNG CHI TIẾT GỐC VÀO THAM SỐ 'content' CỦA TOOL 'generate_file' (bao gồm đầy đủ căn cứ/điều khoản pháp luật, bảng biểu/số liệu tài chính - BĐS, toàn bộ lời thoại/phân cảnh kịch bản media, mã nguồn/kiến trúc kỹ thuật, quy chế doanh nghiệp...). TUYỆT ĐỐI CẤM tự ý tóm tắt thành dàn ý gạch đầu dòng sơ sài làm mất mát dữ liệu và tri thức chuyên sâu của người dùng!\n` +
    `      * CHỈ từ chối tạo file khi người dùng chỉ hỏi thăm năng lực (ví dụ: 'em biết tạo slide không?'). Khi đó chỉ giải thích năng lực và mời người dùng yêu cầu cụ thể.\n` +
    `      * Sau khi gọi công cụ thành công, câu trả lời bằng chữ của bạn chỉ cần NGẮN GỌN 1-3 DÒNG tóm tắt chính và thông báo file đã gửi. TUYỆT ĐỐI KHÔNG lặp lại toàn bộ nội dung dài dòng trong tin nhắn chat Zalo!\n` +
    `      * Tuyệt đối cấm bịa đặt tin nhắn đã gửi file khi chưa gọi tool!\n` +
    `\n15. TỐI ƯU TỐC ĐỘ PHẢN HỒI (AGENT SPEED OPTIMIZATION):\n` +
    `    - Nếu trong phần [DỮ LIỆU THỜI GIAN THỰC & BÁCH KHOA MỚI NHẤT] hoặc context bên dưới đã có đầy đủ thông tin/tin tức/số liệu để trả lời câu hỏi, bạn PHẢI TẬP TRUNG TRẢ LỜI NGAY TRONG VÒNG ĐẦU TIÊN, TUYỆT ĐỐI KHÔNG GỌI THÊM CÔNG CỤ TÌM KIẾM (web_search) LẶP LẠI để tránh làm chậm thời gian phản hồi của người dùng!\n` +
    `    - Chỉ gọi công cụ (finance_market_lookup, web_search, generate_file, fetch_url, python_interpreter) KHI dữ liệu cung cấp chưa có hoặc người dùng yêu cầu rõ việc tra cứu/tạo file/vẽ biểu đồ số liệu.\n` +
    `\n16. KỸ NĂNG VẼ BIỂU ĐỒ SỐ LIỆU, INFOGRAPHIC & SƠ ĐỒ BẰNG PYTHON (python_interpreter):\n` +
    `    - Sử dụng công cụ 'python_interpreter' khi người dùng yêu cầu vẽ biểu đồ số liệu, infographic, poster lịch thi đấu, bảng xếp hạng, timeline, sơ đồ thuật toán, quy trình, mindmap hoặc yêu cầu làm lại/sửa lại ảnh/biểu đồ trước đó. TUYỆT ĐỐI CẤM in code Python ra chat!\n` +
    `    - VỚI LỊCH THI ĐẤU, BẢNG XẾP HẠNG, ROADMAP: Bắt buộc dùng PIL thiết kế INFOGRAPHIC POSTER dạng CARD LAYOUT nền tối sang trọng (burgundy/navy), thẻ bo góc (rounded_rectangle), huy hiệu trạng thái, tiêu đề vàng kim #FFD700, font Unicode get_font(size, bold) chuẩn tiếng Việt.\n` +
    `    - VỚI BIỂU ĐỒ SỐ LIỆU ĐỊNH LƯỢNG: Viết mã Python vẽ bằng matplotlib.pyplot với dark theme (plt.style.use('dark_background')), định dạng trực quan, tự lưu file .png.\n` +
    `    - Hệ thống sẽ tự động bắt file ảnh biểu đồ được tạo ra và gửi trực tiếp vào Zalo cho Sếp/người dùng.\n`;

  const userPrompt =
    (historyText ? `LỊCH SỬ TRÒ CHUYỆN TRƯỚC ĐÓ:\n${historyText}\n\n` : "") +
    `${quoteSection}${fileSection}${liveNewsSection}${groupActivitiesSection}${permanentKnowledgeSection}\n` +
    `YÊU CẦU MỚI TỪ ${isAdmin ? `ADMIN (${displayName})` : `${pronouns.userTitle.toUpperCase()} (${displayName})`}: ${rawText || "Hãy phân tích tài liệu/hình ảnh này giúp tôi."}\n\n` +
    (isAdmin ? `HÃY TRẢ LỜI SẾP THẬT CHUẨN XÁC, THÔNG MINH VÀ HỮU ÍCH:` : `HÃY TRẢ LỜI ${pronouns.userTitle.toUpperCase()} THẬT THÂN THIỆN, CHUẨN XÁC VÀ HỮU ÍCH:`);

  try {
    const isSearchDisabled = process.env.DISABLE_SEARCH === "true";

    const needsSearch = !isSearchDisabled && (
      planNeedsSearch ||
      isRealEstateProjectProfileQuery(rawText) ||
      /(?:thời tiết|giá vàng|tỷ giá|chứng khoán|tin tức|mới nhất|khi nào|bao giờ|ai là|lịch thi đấu|tỉ số|kết quả|vừa ra mắt)/i.test(rawText)
    );

    let effectiveUserPrompt = userPrompt;
    // Nếu cần tìm kiếm nhưng Tier 1 (Grounding) không khả dụng và chưa có liveNews từ trước, quét nhanh RSS fallback:
    if (needsSearch && !canUseGrounding() && !liveNews) {
      console.log(`[admin-assistant] 📰 Tier 2 Fallback: Kích hoạt quét RSS nhanh...`);
      const searchRes = await searchRealtimeNews(rawText, { intent: "fact_check", requireEvidence: false }).catch(() => "");
      if (searchRes) {
        liveNews = searchRes;
        effectiveUserPrompt = `\n=== DỮ LIỆU THỜI GIAN THỰC & BÁCH KHOA MỚI NHẤT (QUÉT NHANH): ===\n${liveNews}\n\n` + userPrompt;
      }
    }

    const defaultFastModel = !isAdmin
      ? (process.env.USER_DIRECT_GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite-preview")
      : (process.env.ADMIN_DIRECT_GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite-preview");

    const targetModel = (needsSearch && canUseGrounding()) ? "gemini-3-flash-preview" : defaultFastModel;

    const fullSystemPrompt =
      systemPrompt +
      userMemorySection +
      searchInstruction +
      groupInstruction +
      knowledgeInstruction +
      encyclopediaInstruction +
      claimGroundingInstruction;

    // 🧠 FAST-PATH HOẶC AGENTIC BRAIN:
    const needsAgentLoop = checkIsFileOrVoiceGeneration(rawText, event.quote?.text) || /(?:đọc link|tải trang|cào web|check link)\s+https?:/i.test(rawText);

    let answer = "";
    if (needsAgentLoop && !isSearchDisabled) {
      // 🚀 AGENT LOOP (Chỉ dùng khi cần tạo/xuất file, vẽ ảnh/biểu đồ, voice hoặc tải link)
      answer = await callGeminiAgentLoop(fullSystemPrompt, effectiveUserPrompt, {
        model: targetModel,
        mediaParts: mediaPart ? [mediaPart] : undefined,
        onFileGenerated: async (file) => {
          try {
            const isSlide = /\.(pptx|ppt)$/i.test(file.filePath);
            const isImg = /\.(png|jpg|jpeg|webp)$/i.test(file.filePath);
            const isVoice = /\.(m4a|mp3|wav|aac)$/i.test(file.filePath);
            const userGreeting = isAdmin ? "Sếp" : pronouns.userTitle;
            const caption = file.caption || (
              isSlide
                ? `📊 ${defaultBotName} đã soạn xong bài thuyết trình PowerPoint [${file.fileName}] cho ${userGreeting}!`
                : isImg
                  ? `🎨 ${defaultBotName} đã tạo ảnh [${file.fileName}] thành công cho ${userGreeting}!`
                  : isVoice
                    ? `🎙️ ${defaultBotName} gửi voice cho ${userGreeting} nghe đây ạ!`
                    : `📄 ${defaultBotName} đã tạo file [${file.fileName}] thành công cho ${userGreeting}!`
            );
            if (isVoice) {
              await sendDirectVoice(api, sender, file.filePath, caption);
            } else {
              await sendDirectFile(api, sender, file.filePath, caption);
            }
          } catch (fileErr) {
            console.warn("[admin-assistant] sendDirectFile error:", fileErr);
          }
        },
      });
    } else {
      // ⚡ FAST-PATH: Trả lời siêu tốc trong 1 lượt duy nhất (~1 giây)
      const routingSignals = normalizeExecutionSignals(
        queryPlan ? { ...queryPlan } : null,
        {
          question: rawText,
          quoteText: event.quote?.text,
          needsSearch,
          intent: queryPlan?.intent || (needsSearch ? "fact_check" : "knowledge"),
        },
      );
      const responseMode = selectResponseMode({
        signals: routingSignals,
        needsSearch,
        explicitToolRequest: false,
        hasMedia: Boolean(mediaPart || fileTextContent || hasFile || hasImage),
      });
      console.log(`[admin-assistant] 🤖 Route sinh câu trả lời: ${responseMode} (fallbackModel: ${targetModel})`);
      answer = await answerWithHybridRouting(config.hybridAgent, {
        mode: responseMode,
        systemPrompt: fullSystemPrompt,
        userPrompt: effectiveUserPrompt,
        sessionKey: `${config.botId}:direct:${sender}`,
        isOwner: isAdmin,
        explicitToolRequest: false,
        hasMedia: Boolean(mediaPart || fileTextContent || hasFile || hasImage),
        fallback: async () => await callGemini(fullSystemPrompt, effectiveUserPrompt, {
          model: targetModel,
          maxTokens: !isAdmin ? 600 : undefined,
          mediaParts: mediaPart ? [mediaPart] : undefined,
          enableSearch: needsSearch,
        }),
      });
    }

    answer = await interceptAndExecuteSimulatedTool(answer, async (file) => {
      try {
        const userGreeting = isAdmin ? "Sếp" : pronouns.userTitle;
        const isVoice = /\.(m4a|mp3|wav|aac)$/i.test(file.filePath);
        if (isVoice) {
          await sendDirectVoice(api, sender, file.filePath, file.caption || `🎙️ ${defaultBotName} gửi voice cho ${userGreeting} nghe nhé!`);
        } else {
          await sendDirectFile(api, sender, file.filePath, file.caption || `📄 ${defaultBotName} gửi file [${file.fileName}] cho ${userGreeting}!`);
        }
      } catch (fileErr) {
        console.warn("[admin-assistant] Interceptor sendDirectFile error:", fileErr);
      }
    });

    answer = finalizeGroundedAnswer(answer, liveNews, evidenceRequired, {
      intent: queryPlan?.intent,
      question: rawText,
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

    // 🧠 Trích xuất và cập nhật bộ nhớ dài hạn người dùng ở background (zero latency)
    setImmediate(() => {
      extractAndSaveUserMemories({
        userId: sender,
        threadId: sender,
        userName: displayName,
        text: rawText,
      }).catch(() => {});
    });
  } catch (err) {
    console.error(`[admin-assistant] ❌ Lỗi xử lý AI 1:1:`, err);
    await sendDirectText(
      api,
      sender,
      isAdmin
        ? `🤖 Dạ câu hỏi của Sếp ${displayName} làm em ${defaultBotName} xém khét CPU 😄! Sếp cho em vài giây thở oxy rồi hỏi lại thử nhé!`
        : `🤖 Dạ câu hỏi của bạn ${displayName} làm em xém khét CPU 😄! Bạn chờ vài giây rồi nhắn lại giúp em nhé!`,
    );
  }
}

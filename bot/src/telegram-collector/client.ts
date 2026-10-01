import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { config } from "../config.js";
import { getBotState, setBotState, getDb } from "../db/index.js";
import {
  upsertTrackedChat,
  saveRawTelegramMessage,
  saveRawTelegramMessagesBatch,
  saveKnowledgeItem,
} from "./db.js";
import { classifyAndExtractKnowledge } from "./classifier.js";
import type { TelegramRawMessage } from "./types.js";

const STATE_KEY_SESSION = "telegram_userbot_session";
const STATE_KEY_STATUS = "telegram_userbot_status";

let clientInstance: TelegramClient | null = null;
let isConnecting = false;
let userbotMe: { id: string; name: string; username: string } | null = null;

export function getStoredSessionString(): string {
  const fromEnv = config.telegramSessionString;
  if (fromEnv) return fromEnv;
  const fromDb = getBotState(STATE_KEY_SESSION);
  return fromDb || "";
}

export function saveStoredSessionString(session: string): void {
  setBotState(STATE_KEY_SESSION, session, Date.now());
}

export function getUserbotConfig(): { appId: number; appHash: string; session: string } {
  return {
    appId: config.telegramAppId || Number(process.env.TELEGRAM_APP_ID || 0),
    appHash: config.telegramAppHash || process.env.TELEGRAM_APP_HASH || "",
    session: getStoredSessionString(),
  };
}

/**
 * Trạng thái hiện tại của Userbot
 */
export function getUserbotStatus(): {
  isConfigured: boolean;
  isOnline: boolean;
  me: { id: string; name: string; username: string } | null;
  error?: string;
} {
  const cfg = getUserbotConfig();
  const isConfigured = Boolean(cfg.appId && cfg.appHash && cfg.session);
  const isOnline = Boolean(clientInstance?.connected);

  return {
    isConfigured,
    isOnline,
    me: userbotMe,
  };
}

/**
 * Khởi động Userbot lắng nghe tin nhắn Telegram ngầm
 */
export async function startUserbot(): Promise<{ success: boolean; message: string }> {
  if (clientInstance?.connected) {
    return { success: true, message: "Userbot đã đang hoạt động." };
  }
  if (isConnecting) {
    return { success: false, message: "Userbot đang trong quá trình kết nối..." };
  }

  const { appId, appHash, session } = getUserbotConfig();
  if (!appId || !appHash || !session) {
    return {
      success: false,
      message: "Chưa cấu hình đầy đủ TELEGRAM_APP_ID, TELEGRAM_APP_HASH hoặc TELEGRAM_SESSION_STRING.",
    };
  }

  try {
    isConnecting = true;
    console.log("[telegram-userbot] 🚀 Đang khởi động Telegram Userbot Client...");

    const stringSession = new StringSession(session);
    clientInstance = new TelegramClient(stringSession, appId, appHash, {
      connectionRetries: 5,
      autoReconnect: true,
    });

    await clientInstance.connect();

    const me = (await clientInstance.getMe()) as any;
    if (me) {
      userbotMe = {
        id: String(me.id),
        name: [me.firstName, me.lastName].filter(Boolean).join(" ") || "Telegram User",
        username: me.username || "",
      };
      setBotState(STATE_KEY_STATUS, "online", Date.now());
      console.log(`[telegram-userbot] ✅ Đã đăng nhập thành công tài khoản: ${userbotMe.name} (@${userbotMe.username || me.id})`);
    }

    // 1. Tự động đồng bộ các group/channel đang tham gia
    await syncJoinedChats();

    // 2. Lắng nghe tin nhắn mới theo thời gian thực
    clientInstance.addEventHandler(async (event: any) => {
      try {
        const message = event.message;
        if (!message || !message.text) return;

        const peerId = message.peerId;
        const chatId = String(peerId?.channelId ? `-100${peerId.channelId}` : peerId?.chatId ? `-${peerId.chatId}` : peerId?.userId || "");
        if (!chatId) return;

        const rawMsg: TelegramRawMessage = {
          chat_id: chatId,
          message_id: Number(message.id),
          sender_id: message.senderId ? String(message.senderId) : null,
          sender_name: message.sender ? [message.sender.firstName, message.sender.lastName].filter(Boolean).join(" ") : null,
          sender_username: message.sender?.username || null,
          message_text: String(message.text || ""),
          media_type: (message.media as any)?.photo ? "photo" : (message.media as any)?.document ? "document" : "none",
          media_caption: "",
          reply_to_msg_id: message.replyToMsgId ? Number(message.replyToMsgId) : null,
          date: Number(message.date || Math.floor(Date.now() / 1000)),
          created_at: Date.now(),
        };

        saveRawTelegramMessage(rawMsg);
      } catch (eventErr) {
        console.error("[telegram-userbot] Lỗi xử lý tin nhắn sự kiện:", eventErr);
      }
    }, new NewMessage({}));

    // 3. Khởi chạy luồng kiểm tra yêu cầu quét từ Web Dashboard
    setInterval(() => void consumePendingTelegramCrawlRequests(), 3000);

    isConnecting = false;
    return { success: true, message: `Userbot đã kết nối thành công: ${userbotMe?.name}` };
  } catch (err: any) {
    isConnecting = false;
    userbotMe = null;
    setBotState(STATE_KEY_STATUS, "error", Date.now());
    console.error("[telegram-userbot] ❌ Lỗi kết nối Userbot:", err);
    return { success: false, message: `Lỗi kết nối: ${err?.message || String(err)}` };
  }
}

/**
 * Ngắt kết nối Userbot
 */
export async function stopUserbot(): Promise<{ success: boolean; message: string }> {
  try {
    if (clientInstance) {
      await clientInstance.disconnect();
      clientInstance = null;
    }
    userbotMe = null;
    setBotState(STATE_KEY_STATUS, "stopped", Date.now());
    console.log("[telegram-userbot] ⏹️ Đã dừng Userbot.");
    return { success: true, message: "Đã ngắt kết nối Userbot thành công." };
  } catch (err: any) {
    return { success: false, message: `Lỗi dừng Userbot: ${err?.message || String(err)}` };
  }
}

/**
 * Quét toàn bộ danh sách group, supergroup và channel mà tài khoản đã tham gia
 */
export async function syncJoinedChats(): Promise<number> {
  if (!clientInstance?.connected) return 0;

  try {
    const dialogs = await clientInstance.getDialogs({ limit: 100 });
    let count = 0;

    for (const d of dialogs) {
      // Chỉ lưu group, supergroup, channel
      if (!d.isGroup && !d.isChannel) continue;

      const entity = d.entity as any;
      if (!entity) continue;

      const id = String(d.id);
      const title = d.title || entity.title || "Nhóm Telegram";
      const username = entity.username || null;
      const chatType = d.isChannel && !entity.megagroup ? "channel" : "supergroup";

      upsertTrackedChat({
        chat_id: id,
        title,
        username,
        chat_type: chatType,
        is_tracked: 1,
      });
      count++;
    }

    console.log(`[telegram-userbot] 📋 Đã đồng bộ ${count} nhóm/kênh Telegram vào danh sách theo dõi.`);
    return count;
  } catch (err) {
    console.error("[telegram-userbot] Lỗi đồng bộ danh sách nhóm:", err);
    return 0;
  }
}

/**
 * Kéo lịch sử tin nhắn gần đây của 1 nhóm và tự động phân loại kiến thức
 */
export async function fetchAndClassifyChatHistory(
  chatId: string,
  targetLimit = 100,
  onProgress?: (progress: { fetched: number; knowledgeCreated: number; statusText: string }) => void,
): Promise<{ fetched: number; knowledgeCreated: number }> {
  if (!clientInstance?.connected) {
    throw new Error("Telegram Userbot chưa online, không thể tải tin nhắn");
  }

  try {
    let totalFetched = 0;
    let totalKnowledgeCreated = 0;
    let offsetId = 0;
    const isScanAll = targetLimit <= 0 || targetLimit >= 100000;
    const effectiveMax = isScanAll ? Infinity : targetLimit;
    const BATCH_SIZE = 100;
    let hasMore = true;

    while (hasMore && totalFetched < effectiveMax) {
      const currentLimit = Math.min(BATCH_SIZE, effectiveMax - totalFetched);
      const queryOptions: any = { limit: currentLimit };
      if (offsetId > 0) {
        queryOptions.offsetId = offsetId;
      }

      const rawMessages = await clientInstance.getMessages(chatId, queryOptions);
      if (!rawMessages || rawMessages.length === 0) {
        hasMore = false;
        break;
      }

      const batch: TelegramRawMessage[] = [];
      const now = Date.now();
      let minMsgIdInBatch = Infinity;

      for (const m of rawMessages) {
        if (!m) continue;
        const msgId = Number(m.id);
        if (msgId < minMsgIdInBatch) {
          minMsgIdInBatch = msgId;
        }

        const file = (m as any).file;
        const doc = (m.media as any)?.document;
        const fileName = file?.name || null;
        const fileSize = Number(file?.size || doc?.size || 0);

        // Nếu không có cả text lẫn file thì bỏ qua
        const msgText = String(m.text || "").trim();
        if (!msgText && !fileName) continue;

        const sender = (m.sender as any) || {};
        const senderName =
          [sender.firstName, sender.lastName].filter(Boolean).join(" ") ||
          sender.title ||
          null;

        batch.push({
          chat_id: chatId,
          message_id: msgId,
          sender_id: m.senderId ? String(m.senderId) : null,
          sender_name: senderName,
          sender_username: sender.username || null,
          message_text: msgText || `[Tài liệu đính kèm: ${fileName}]`,
          media_type: (m.media as any)?.photo
            ? "photo"
            : (m.media as any)?.document
            ? "document"
            : "none",
          media_caption: msgText,
          file_name: fileName,
          file_size: fileSize || null,
          reply_to_msg_id: m.replyToMsgId ? Number(m.replyToMsgId) : null,
          date: Number(m.date || Math.floor(now / 1000)),
          created_at: now,
        });
      }

      if (batch.length > 0) {
        const fetched = saveRawTelegramMessagesBatch(batch);
        totalFetched += fetched;

        // Phân loại và trích xuất tri thức bằng AI theo từng đợt
        const created = await classifyAndExtractKnowledge(chatId, batch);
        totalKnowledgeCreated += created;
      }

      // Cập nhật offsetId cho đợt tiếp theo
      if (minMsgIdInBatch !== Infinity && minMsgIdInBatch > 0) {
        if (offsetId === minMsgIdInBatch) {
          hasMore = false;
          break;
        }
        offsetId = minMsgIdInBatch;
      } else {
        hasMore = false;
        break;
      }

      if (onProgress) {
        onProgress({
          fetched: totalFetched,
          knowledgeCreated: totalKnowledgeCreated,
          statusText: `Đang quét... Đã lưu ${totalFetched} tin, tạo ${totalKnowledgeCreated} bài học`,
        });
      }

      // Nếu số tin trả về ít hơn yêu cầu => đã tới mốc đầu tiên của nhóm
      if (rawMessages.length < currentLimit) {
        hasMore = false;
        break;
      }

      // Nghỉ nhẹ 400ms giữa các trang để chống Rate Limit của Telegram
      await new Promise((r) => setTimeout(r, 400));
    }

    return { fetched: totalFetched, knowledgeCreated: totalKnowledgeCreated };
  } catch (err: any) {
    console.error(`[telegram-userbot] Lỗi kéo tin nhắn nhóm ${chatId}:`, err);
    throw err;
  }
}

/**
 * Quét toàn bộ file tài liệu (PDF, Word, Excel, Slide, Zip...) trong nhóm
 */
export async function scanGroupFiles(
  chatId: string,
  limit = 50,
): Promise<{ filesFound: number; knowledgeCreated: number }> {
  if (!clientInstance?.connected) {
    throw new Error("Telegram Userbot chưa online, không thể quét file");
  }

  try {
    const rawMessages = await clientInstance.getMessages(chatId, {
      filter: new Api.InputMessagesFilterDocument(),
      limit,
    });

    let filesFound = 0;
    let knowledgeCreated = 0;
    const now = Date.now();

    for (const m of rawMessages) {
      if (!m || !m.media) continue;
      const file = (m as any).file;
      const doc = (m.media as any)?.document;
      const fileName = file?.name || "Tài liệu không tên";
      const fileSize = Number(file?.size || doc?.size || 0);
      const fileSizeMb = (fileSize / (1024 * 1024)).toFixed(2);
      const sender = (m.sender as any) || {};
      const senderName = [sender.firstName, sender.lastName].filter(Boolean).join(" ") || sender.title || "Thành viên";
      const caption = String(m.text || "").trim();

      // Lưu tin thô
      saveRawTelegramMessage({
        chat_id: chatId,
        message_id: Number(m.id),
        sender_id: m.senderId ? String(m.senderId) : null,
        sender_name: senderName,
        sender_username: sender.username || null,
        message_text: caption || `[Tài liệu: ${fileName}]`,
        media_type: "document",
        media_caption: caption,
        file_name: fileName,
        file_size: fileSize,
        reply_to_msg_id: m.replyToMsgId ? Number(m.replyToMsgId) : null,
        date: Number(m.date || Math.floor(now / 1000)),
        created_at: now,
      });
      filesFound++;

      // Lưu thành đơn vị tri thức chuyên mục shared_files
      saveKnowledgeItem({
        chat_id: chatId,
        category: "shared_files",
        title: `Tài liệu: ${fileName} (${fileSizeMb} MB)`,
        summary: `Tài liệu chia sẻ bởi ${senderName} vào ngày ${new Date(Number(m.date || 0) * 1000).toLocaleDateString("vi-VN")}.${caption ? " Chú thích kèm theo: " + caption : ""}`,
        key_takeaways: [
          `Tên tài liệu: ${fileName}`,
          `Kích thước: ${fileSizeMb} MB`,
          `Người chia sẻ: ${senderName}`,
          caption ? `Mô tả: ${caption}` : "Tài liệu đính kèm nhóm",
        ],
        original_quotes: caption,
        useful_links: [],
        raw_message_ids: [Number(m.id)],
        date_range: new Date(Number(m.date || 0) * 1000).toISOString().slice(0, 10),
        created_at: now,
        updated_at: now,
      });
      knowledgeCreated++;
    }

    return { filesFound, knowledgeCreated };
  } catch (err: any) {
    console.error(`[telegram-userbot] Lỗi quét file nhóm ${chatId}:`, err);
    throw err;
  }
}

/**
 * Xử lý các yêu cầu quét tin nhắn cũ / quét file từ Web Dashboard gửi sang
 */
export async function consumePendingTelegramCrawlRequests(): Promise<void> {
  if (!clientInstance?.connected) return;

  const db = getDb();
  const pending = db
    .prepare(`
      SELECT * FROM telegram_crawl_requests 
      WHERE status = 'pending' 
      ORDER BY created_at ASC 
      LIMIT 1
    `)
    .get() as any;

  if (!pending) return;

  const reqId = pending.id;
  db.prepare(`UPDATE telegram_crawl_requests SET status = 'processing' WHERE id = ?`).run(reqId);

  try {
    const rawLimit = pending.item_limit;
    // Nếu action là scan_all_history thì targetLimit = 0 (quét toàn bộ lịch sử)
    const limit = pending.action === "scan_all_history" ? 0 : rawLimit ?? 100;
    let result: any = null;

    if (pending.action === "scan_files") {
      result = await scanGroupFiles(pending.chat_id, limit || 50);
    } else {
      result = await fetchAndClassifyChatHistory(pending.chat_id, limit, (prog) => {
        try {
          db.prepare(`UPDATE telegram_crawl_requests SET result_json = ? WHERE id = ?`).run(
            JSON.stringify(prog),
            reqId,
          );
        } catch {}
      });
    }

    db.prepare(`
      UPDATE telegram_crawl_requests 
      SET status = 'completed', result_json = ?, completed_at = ? 
      WHERE id = ?
    `).run(JSON.stringify(result), Date.now(), reqId);

    console.log(`[telegram-userbot] ✅ Hoàn thành yêu cầu ${pending.action} cho chat ${pending.chat_id}:`, result);
  } catch (err: any) {
    console.error(`[telegram-userbot] ❌ Lỗi xử lý yêu cầu ${pending.action}:`, err);
    db.prepare(`
      UPDATE telegram_crawl_requests 
      SET status = 'error', error_message = ?, completed_at = ? 
      WHERE id = ?
    `).run(String(err?.message || err), Date.now(), reqId);
  }
}

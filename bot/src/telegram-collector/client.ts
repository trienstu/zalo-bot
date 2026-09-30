import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { config } from "../config.js";
import { getBotState, setBotState } from "../db/index.js";
import {
  upsertTrackedChat,
  saveRawTelegramMessage,
  saveRawTelegramMessagesBatch,
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
  limit = 100,
): Promise<{ fetched: number; knowledgeCreated: number }> {
  if (!clientInstance?.connected) {
    throw new Error("Telegram Userbot chưa online, không thể tải tin nhắn");
  }

  try {
    // 1. Kéo tin nhắn từ Telegram
    const rawMessages = await clientInstance.getMessages(chatId, { limit });
    const batch: TelegramRawMessage[] = [];

    for (const m of rawMessages) {
      if (!m || !m.text) continue;
      const sender = (m.sender as any) || {};
      const senderName = [sender.firstName, sender.lastName].filter(Boolean).join(" ") || sender.title || null;

      batch.push({
        chat_id: chatId,
        message_id: Number(m.id),
        sender_id: m.senderId ? String(m.senderId) : null,
        sender_name: senderName,
        sender_username: sender.username || null,
        message_text: String(m.text || "").trim(),
        media_type: (m.media as any)?.photo ? "photo" : (m.media as any)?.document ? "document" : "none",
        media_caption: "",
        reply_to_msg_id: m.replyToMsgId ? Number(m.replyToMsgId) : null,
        date: Number(m.date || Math.floor(Date.now() / 1000)),
        created_at: Date.now(),
      });
    }

    // 2. Lưu vào DB
    const fetched = saveRawTelegramMessagesBatch(batch);

    // 3. Phân loại và trích xuất tri thức bằng AI
    const knowledgeCreated = await classifyAndExtractKnowledge(chatId, batch);

    return { fetched, knowledgeCreated };
  } catch (err: any) {
    console.error(`[telegram-userbot] Lỗi kéo tin nhắn nhóm ${chatId}:`, err);
    throw err;
  }
}

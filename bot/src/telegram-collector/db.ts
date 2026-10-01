import { getDb } from "../db/index.js";
import type {
  TrackedChat,
  TelegramRawMessage,
  TelegramKnowledgeItem,
  TelegramExportJob,
  KnowledgeCategory,
} from "./types.js";

/**
 * Thêm mới hoặc cập nhật thông tin nhóm/kênh Telegram được theo dõi
 */
export function upsertTrackedChat(chat: {
  chat_id: string;
  title: string;
  username?: string | null;
  chat_type?: "group" | "supergroup" | "channel";
  is_tracked?: number;
}): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO telegram_tracked_chats (
      chat_id, title, username, chat_type, is_tracked,
      last_message_id, total_messages, joined_at, updated_at
    ) VALUES (
      @chat_id, @title, @username, @chat_type, @is_tracked,
      0, 0, @now, @now
    )
    ON CONFLICT(chat_id) DO UPDATE SET
      title = excluded.title,
      username = COALESCE(excluded.username, telegram_tracked_chats.username),
      chat_type = COALESCE(excluded.chat_type, telegram_tracked_chats.chat_type),
      updated_at = @now
  `).run({
    chat_id: chat.chat_id,
    title: chat.title,
    username: chat.username || null,
    chat_type: chat.chat_type || "supergroup",
    is_tracked: chat.is_tracked !== undefined ? chat.is_tracked : 1,
    now,
  });
}

/**
 * Lấy danh sách các nhóm Telegram đang theo dõi kèm số lượng tin & tri thức
 */
export function listTrackedChats(): Array<
  TrackedChat & { message_count: number; knowledge_count: number }
> {
  const db = getDb();
  return db
    .prepare(`
      SELECT 
        c.*,
        COUNT(DISTINCT m.id) as message_count,
        COUNT(DISTINCT k.id) as knowledge_count
      FROM telegram_tracked_chats c
      LEFT JOIN telegram_messages m ON m.chat_id = c.chat_id
      LEFT JOIN telegram_knowledge_items k ON k.chat_id = c.chat_id
      GROUP BY c.chat_id
      ORDER BY c.is_tracked DESC, c.updated_at DESC
    `)
    .all() as any;
}

/**
 * Bật/tắt trạng thái theo dõi của một group
 */
export function setChatTrackingStatus(chatId: string, isTracked: boolean): void {
  const db = getDb();
  db.prepare(`
    UPDATE telegram_tracked_chats 
    SET is_tracked = ?, updated_at = ? 
    WHERE chat_id = ?
  `).run(isTracked ? 1 : 0, Date.now(), chatId);
}

/**
 * Lưu tin nhắn Telegram thô vào DB (idempotent, bỏ qua nếu đã có)
 */
export function saveRawTelegramMessage(msg: TelegramRawMessage): boolean {
  const db = getDb();
  const res = db
    .prepare(`
      INSERT OR IGNORE INTO telegram_messages (
        chat_id, message_id, sender_id, sender_name, sender_username,
        message_text, media_type, media_caption, reply_to_msg_id,
        date, created_at
      ) VALUES (
        @chat_id, @message_id, @sender_id, @sender_name, @sender_username,
        @message_text, @media_type, @media_caption, @reply_to_msg_id,
        @date, @created_at
      )
    `)
    .run({
      chat_id: msg.chat_id,
      message_id: msg.message_id,
      sender_id: msg.sender_id || null,
      sender_name: msg.sender_name || null,
      sender_username: msg.sender_username || null,
      message_text: msg.message_text.trim(),
      media_type: msg.media_type || "none",
      media_caption: msg.media_caption || "",
      reply_to_msg_id: msg.reply_to_msg_id || null,
      date: msg.date,
      created_at: msg.created_at || Date.now(),
    });

  if (res.changes > 0) {
    db.prepare(`
      UPDATE telegram_tracked_chats
      SET total_messages = total_messages + 1,
          last_message_id = MAX(last_message_id, ?),
          updated_at = ?
      WHERE chat_id = ?
    `).run(msg.message_id, Date.now(), msg.chat_id);
    return true;
  }
  return false;
}

/**
 * Lưu batch tin nhắn thô (hỗ trợ sync lịch sử nhóm nhanh chóng)
 */
export function saveRawTelegramMessagesBatch(msgs: TelegramRawMessage[]): number {
  if (!msgs.length) return 0;
  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO telegram_messages (
      chat_id, message_id, sender_id, sender_name, sender_username,
      message_text, media_type, media_caption, reply_to_msg_id,
      date, created_at
    ) VALUES (
      @chat_id, @message_id, @sender_id, @sender_name, @sender_username,
      @message_text, @media_type, @media_caption, @reply_to_msg_id,
      @date, @created_at
    )
  `);

  const runTx = db.transaction((items: TelegramRawMessage[]) => {
    let saved = 0;
    for (const m of items) {
      const res = insertStmt.run({
        chat_id: m.chat_id,
        message_id: m.message_id,
        sender_id: m.sender_id || null,
        sender_name: m.sender_name || null,
        sender_username: m.sender_username || null,
        message_text: m.message_text.trim(),
        media_type: m.media_type || "none",
        media_caption: m.media_caption || "",
        reply_to_msg_id: m.reply_to_msg_id || null,
        date: m.date,
        created_at: m.created_at || Date.now(),
      });
      if (res.changes > 0) saved++;
    }
    return saved;
  });

  return runTx(msgs);
}

/**
 * Lấy các tin nhắn chưa được phân loại tri thức trong khoảng thời gian gần đây
 */
export function getMessagesForClassification(
  chatId: string,
  limit = 60,
): TelegramRawMessage[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT * FROM telegram_messages
      WHERE chat_id = ?
        AND LENGTH(TRIM(message_text)) >= 25
      ORDER BY date ASC
      LIMIT ?
    `)
    .all(chatId, limit) as any;
}

/**
 * Đảm bảo schema có cột original_content
 */
export function ensureTelegramKnowledgeSchema(): void {
  const db = getDb();
  try {
    db.exec(`ALTER TABLE telegram_knowledge_items ADD COLUMN original_content TEXT DEFAULT ''`);
  } catch {}
}

/**
 * Tự động đồng bộ nội dung gốc từ telegram_messages cho các bài viết chưa có original_content
 */
export function backfillOriginalContentForItems(): number {
  ensureTelegramKnowledgeSchema();
  const db = getDb();
  const items = db
    .prepare(`
      SELECT id, chat_id, raw_message_ids 
      FROM telegram_knowledge_items 
      WHERE (original_content IS NULL OR TRIM(original_content) = '')
        AND raw_message_ids IS NOT NULL AND raw_message_ids != '[]'
    `)
    .all() as any[];

  let updated = 0;
  for (const it of items) {
    const msgIds = safeParseJson(it.raw_message_ids, []);
    if (!Array.isArray(msgIds) || msgIds.length === 0) continue;

    const placeholders = msgIds.map(() => "?").join(",");
    const msgs = db
      .prepare(`
        SELECT sender_name, message_text, date 
        FROM telegram_messages 
        WHERE chat_id = ? AND message_id IN (${placeholders})
        ORDER BY date ASC
      `)
      .all(it.chat_id, ...msgIds) as any[];

    if (msgs.length > 0) {
      const fullText = msgs
        .map((m) => {
          const sender = m.sender_name || "Thành viên";
          const time = new Date(m.date * 1000).toLocaleString("vi-VN");
          return `[${time}] ${sender}:\n${m.message_text.trim()}`;
        })
        .join("\n\n---\n\n");

      db.prepare(`UPDATE telegram_knowledge_items SET original_content = ? WHERE id = ?`).run(fullText, it.id);
      updated++;
    }
  }
  return updated;
}

/**
 * Lưu kết quả tri thức AI đã tinh lọc
 */
export function saveKnowledgeItem(item: Omit<TelegramKnowledgeItem, "id">): number {
  ensureTelegramKnowledgeSchema();
  const db = getDb();
  const now = Date.now();
  const res = db
    .prepare(`
      INSERT INTO telegram_knowledge_items (
        chat_id, category, title, summary, key_takeaways,
        original_quotes, original_content, useful_links, raw_message_ids,
        date_range, created_at, updated_at
      ) VALUES (
        @chat_id, @category, @title, @summary, @key_takeaways,
        @original_quotes, @original_content, @useful_links, @raw_message_ids,
        @date_range, @created_at, @updated_at
      )
    `)
    .run({
      chat_id: item.chat_id,
      category: item.category,
      title: item.title,
      summary: item.summary,
      key_takeaways: JSON.stringify(item.key_takeaways || []),
      original_quotes: item.original_quotes || "",
      original_content: item.original_content || "",
      useful_links: JSON.stringify(item.useful_links || []),
      raw_message_ids: JSON.stringify(item.raw_message_ids || []),
      date_range: item.date_range || "",
      created_at: item.created_at || now,
      updated_at: item.updated_at || now,
    });
  return Number(res.lastInsertRowid);
}

/**
 * Lấy chi tiết 1 bài học tri thức theo ID
 */
export function getKnowledgeItemById(id: number): TelegramKnowledgeItem | null {
  ensureTelegramKnowledgeSchema();
  const db = getDb();
  const r = db
    .prepare(`
      SELECT 
        k.*,
        c.title as chat_title
      FROM telegram_knowledge_items k
      LEFT JOIN telegram_tracked_chats c ON c.chat_id = k.chat_id
      WHERE k.id = ?
    `)
    .get(id) as any;

  if (!r) return null;
  return {
    id: r.id,
    chat_id: r.chat_id,
    category: r.category as KnowledgeCategory,
    title: r.title,
    summary: r.summary,
    key_takeaways: safeParseJson(r.key_takeaways, []),
    original_quotes: r.original_quotes || "",
    original_content: r.original_content || "",
    useful_links: safeParseJson(r.useful_links, []),
    raw_message_ids: safeParseJson(r.raw_message_ids, []),
    date_range: r.date_range,
    created_at: r.created_at,
    updated_at: r.updated_at,
    chat_title: r.chat_title || "Nhóm Telegram",
  };
}

/**
 * Tra cứu danh sách tri thức có lọc theo nhóm, chủ đề, ngày tháng và tìm kiếm
 */
export function listKnowledgeItems(filter?: {
  chatId?: string;
  category?: string;
  days?: number;
  search?: string;
  limit?: number;
  offset?: number;
}): { items: TelegramKnowledgeItem[]; total: number } {
  ensureTelegramKnowledgeSchema();
  const db = getDb();
  const conditions: string[] = [];
  const params: any = {};

  if (filter?.chatId && filter.chatId !== "all") {
    conditions.push("k.chat_id = @chatId");
    params.chatId = filter.chatId;
  }
  if (filter?.category && filter.category !== "all") {
    conditions.push("k.category = @category");
    params.category = filter.category;
  }
  if (filter?.days && filter.days > 0) {
    const cutoff = Date.now() - filter.days * 86_400_000;
    conditions.push("k.created_at >= @cutoff");
    params.cutoff = cutoff;
  }
  if (filter?.search && filter.search.trim()) {
    conditions.push("(k.title LIKE @search OR k.summary LIKE @search OR k.key_takeaways LIKE @search OR k.original_content LIKE @search)");
    params.search = `%${filter.search.trim()}%`;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filter?.limit || 50, 200);
  const offset = filter?.offset || 0;

  params.limit = limit;
  params.offset = offset;

  const totalRow = db
    .prepare(`SELECT COUNT(*) as total FROM telegram_knowledge_items k ${whereClause}`)
    .get(params) as any;
  const total = totalRow?.total || 0;

  const rows = db
    .prepare(`
      SELECT 
        k.*,
        c.title as chat_title
      FROM telegram_knowledge_items k
      LEFT JOIN telegram_tracked_chats c ON c.chat_id = k.chat_id
      ${whereClause}
      ORDER BY k.created_at DESC
      LIMIT @limit OFFSET @offset
    `)
    .all(params) as any[];

  const items: TelegramKnowledgeItem[] = rows.map((r) => ({
    id: r.id,
    chat_id: r.chat_id,
    category: r.category as KnowledgeCategory,
    title: r.title,
    summary: r.summary,
    key_takeaways: safeParseJson(r.key_takeaways, []),
    original_quotes: r.original_quotes || "",
    original_content: r.original_content || "",
    useful_links: safeParseJson(r.useful_links, []),
    raw_message_ids: safeParseJson(r.raw_message_ids, []),
    date_range: r.date_range,
    created_at: r.created_at,
    updated_at: r.updated_at,
    chat_title: r.chat_title || "Nhóm Telegram",
  }));

  return { items, total };
}

/**
 * Lưu lịch sử xuất file Word
 */
export function recordTelegramExport(job: Omit<TelegramExportJob, "id">): number {
  const db = getDb();
  const res = db
    .prepare(`
      INSERT INTO telegram_exports (
        title, file_name, file_path, file_size, item_count,
        filter_category, filter_days, created_at
      ) VALUES (
        @title, @file_name, @file_path, @file_size, @item_count,
        @filter_category, @filter_days, @created_at
      )
    `)
    .run({
      title: job.title,
      file_name: job.file_name,
      file_path: job.file_path,
      file_size: job.file_size || 0,
      item_count: job.item_count || 0,
      filter_category: job.filter_category || "all",
      filter_days: job.filter_days || 7,
      created_at: job.created_at || Date.now(),
    });
  return Number(res.lastInsertRowid);
}

/**
 * Lấy lịch sử các đợt xuất file Word gần đây
 */
export function listTelegramExports(limit = 20): TelegramExportJob[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM telegram_exports ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as any;
}

function safeParseJson(val: any, fallback: any): any {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

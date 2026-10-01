import { getDb } from "./db";

export interface TelegramChatStats {
  totalChats: number;
  activeTrackedChats: number;
  totalMessages: number;
  totalKnowledgeItems: number;
  totalExports: number;
  userbotStatus: "online" | "idle" | "error" | "stopped";
}

export function getTelegramStats(): TelegramChatStats {
  const db = getDb();

  const chatsRow = db
    .prepare(`
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN is_tracked = 1 THEN 1 ELSE 0 END), 0) as active
      FROM telegram_tracked_chats
    `)
    .get() as any;

  const msgsRow = db.prepare(`SELECT COUNT(*) as total FROM telegram_messages`).get() as any;
  const kRow = db.prepare(`SELECT COUNT(*) as total FROM telegram_knowledge_items`).get() as any;
  const exRow = db.prepare(`SELECT COUNT(*) as total FROM telegram_exports`).get() as any;
  const statusRow = db.prepare(`SELECT value FROM bot_state WHERE key = 'telegram_userbot_status'`).get() as any;

  return {
    totalChats: chatsRow?.total || 0,
    activeTrackedChats: chatsRow?.active || 0,
    totalMessages: msgsRow?.total || 0,
    totalKnowledgeItems: kRow?.total || 0,
    totalExports: exRow?.total || 0,
    userbotStatus: statusRow?.value || "idle",
  };
}

export function listTrackedChatsWeb() {
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
    .all();
}

export function setChatTrackingStatusWeb(chatId: string, isTracked: boolean) {
  const db = getDb();
  db.prepare(`
    UPDATE telegram_tracked_chats 
    SET is_tracked = ?, updated_at = ? 
    WHERE chat_id = ?
  `).run(isTracked ? 1 : 0, Date.now(), chatId);
}

export function createCrawlRequestWeb(params: {
  chatId: string;
  action: "scan_history" | "scan_files";
  limit?: number;
}): number {
  const db = getDb();
  const res = db
    .prepare(`
      INSERT INTO telegram_crawl_requests (chat_id, action, item_limit, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `)
    .run(params.chatId, params.action, params.limit || 50, Date.now());
  return Number(res.lastInsertRowid);
}

export function getCrawlRequestStatusWeb(requestId: number) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM telegram_crawl_requests WHERE id = ?`)
    .get(requestId) as any;
}

export function ensureTelegramKnowledgeSchemaWeb(): void {
  const db = getDb();
  try {
    db.exec(`ALTER TABLE telegram_knowledge_items ADD COLUMN original_content TEXT DEFAULT ''`);
  } catch {}
}

export function backfillOriginalContentWeb(): number {
  ensureTelegramKnowledgeSchemaWeb();
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

export function getTrackedChatByIdWeb(chatId: string) {
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
      WHERE c.chat_id = ?
      GROUP BY c.chat_id
    `)
    .get(chatId) as any;
}

export function getKnowledgeItemByIdWeb(id: number) {
  ensureTelegramKnowledgeSchemaWeb();
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
    category: r.category,
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

export function listKnowledgeItemsWeb(filter?: {
  chatId?: string;
  category?: string;
  days?: number;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  ensureTelegramKnowledgeSchemaWeb();
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
  const limit = Math.min(filter?.limit || 50, 500);
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

  const items = rows.map((r) => ({
    id: r.id,
    chat_id: r.chat_id,
    category: r.category,
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

export function listRawMessagesWeb(filter?: {
  chatId?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: any = {};

  if (filter?.chatId && filter.chatId !== "all") {
    conditions.push("m.chat_id = @chatId");
    params.chatId = filter.chatId;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filter?.limit || 50, 100);
  const offset = filter?.offset || 0;
  params.limit = limit;
  params.offset = offset;

  const totalRow = db
    .prepare(`SELECT COUNT(*) as total FROM telegram_messages m ${whereClause}`)
    .get(params) as any;

  const rows = db
    .prepare(`
      SELECT 
        m.*,
        c.title as chat_title
      FROM telegram_messages m
      LEFT JOIN telegram_tracked_chats c ON c.chat_id = m.chat_id
      ${whereClause}
      ORDER BY m.date DESC
      LIMIT @limit OFFSET @offset
    `)
    .all(params);

  return { messages: rows, total: totalRow?.total || 0 };
}

export function listTelegramExportsWeb(limit = 20) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM telegram_exports ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

export function recordTelegramExportWeb(job: {
  title: string;
  file_name: string;
  file_path: string;
  file_size: number;
  item_count: number;
  filter_category?: string;
  filter_days?: number;
}) {
  const db = getDb();
  return db
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
      created_at: Date.now(),
    });
}

function safeParseJson(val: any, fallback: any): any {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

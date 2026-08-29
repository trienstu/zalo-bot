import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

/**
 * Lớp truy cập DB. better-sqlite3 ĐỒNG BỘ (không async). 1 connection chia sẻ.
 * Mọi truy cập SQL nằm ở đây — phần còn lại của code chỉ gọi hàm typed export.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = "2026-08-15-telegram-forwards";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  runColumnMigrations(db);
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at, note)
     VALUES (@version, @appliedAt, @note)`,
  ).run({
    version: SCHEMA_VERSION,
    appliedAt: Date.now(),
    note: "Tin thu hồi: deleted_at ở group_messages + gỡ bản sao bên Telegram.",
  });
  return db;
}

/**
 * Thêm cột cho bảng ĐÃ TỒN TẠI.
 *
 * schema.sql chỉ dùng CREATE TABLE IF NOT EXISTS nên bảng đã có sẽ không nhận
 * được cột mới — DB đang chạy trên VPS sẽ thiếu cột và mọi câu lệnh gãy. Hàm này
 * so với PRAGMA table_info rồi ALTER khi thiếu, chạy được cả trên DB mới lẫn cũ.
 *
 * Chỉ dùng cho cột THÊM VÀO có giá trị mặc định. Đổi kiểu hay xoá cột thì SQLite
 * cần dựng lại bảng, phải viết migration riêng.
 */
function runColumnMigrations(database: Database.Database): void {
  const additions: [table: string, column: string, definition: string][] = [
    // Thành phố đã chuẩn hoá từ location, để trang tuyển dụng lọc theo nơi làm
    // việc mà không phải so chuỗi tự do ("Lê Văn Lương, HN" vs "Cầu Giấy, Hà Nội").
    ["job_posts", "city", "TEXT NOT NULL DEFAULT ''"],
    // Tin bị thu hồi trên Zalo / bị bot kiểm duyệt xoá — giữ dòng nhưng loại khỏi
    // mọi nội dung đăng ra ngoài (tóm tắt, bản tin, tin tuyển dụng).
    ["group_messages", "deleted_at", "INTEGER"],
    ["group_messages", "deleted_source", "TEXT NOT NULL DEFAULT ''"],
    ["group_media_events", "deleted_at", "INTEGER"],
    ["group_media_events", "deleted_source", "TEXT NOT NULL DEFAULT ''"],
    // Ảnh đính kèm của một mẩu tin thô (JSON mảng link/đường dẫn file), để bước
    // xử lý đọc chữ trong ảnh khi bài gần như không có chữ.
    ["job_raw", "image_urls", "TEXT NOT NULL DEFAULT '[]'"],
    // Vân tay nội dung, chặn cùng một bài đăng chéo nhiều group trước khi tốn
    // một lượt gọi model.
    ["job_raw", "text_hash", "TEXT NOT NULL DEFAULT ''"],
    ["job_raw", "ocr_text", "TEXT NOT NULL DEFAULT ''"],
    // Ảnh Zalo: link tạm do Zalo trả về + file đã tải sẵn về đĩa + chữ đọc được.
    ["group_media_events", "media_url", "TEXT NOT NULL DEFAULT ''"],
    ["group_media_events", "local_path", "TEXT NOT NULL DEFAULT ''"],
    ["group_media_events", "ocr_text", "TEXT NOT NULL DEFAULT ''"],
    ["group_media_events", "ocr_at", "INTEGER"],
    // Phân loại tương tác theo từng nhóm để hỗ trợ nhiều nhóm không bị lẫn
    ["interactions", "thread_id", "TEXT NOT NULL DEFAULT ''"],
    // Phân loại thành viên theo nhóm quản lý
    ["members", "group_id", "TEXT NOT NULL DEFAULT ''"],
    // Chế độ hoạt động cho từng nhóm: 'interactive' | 'silent' | 'disabled'
    ["bot_groups", "mode", "TEXT NOT NULL DEFAULT 'interactive'"],
    // Cá tính AI, prompt tùy chỉnh, biệt danh xưng hô và thông điệp chào mừng
    ["bot_groups", "persona", "TEXT NOT NULL DEFAULT 'humorous'"],
    ["bot_groups", "custom_prompt", "TEXT NOT NULL DEFAULT ''"],
    ["bot_groups", "bot_name", "TEXT NOT NULL DEFAULT 'Sen Chúa'"],
    ["bot_groups", "welcome_msg", "TEXT NOT NULL DEFAULT ''"],
    // Bản tin thời tiết & AQI chào buổi sáng tự động theo nhóm
    ["bot_groups", "weather_auto", "INTEGER NOT NULL DEFAULT 0"],
    ["bot_groups", "weather_time", "TEXT NOT NULL DEFAULT '07:00'"],
    ["bot_groups", "weather_city", "TEXT NOT NULL DEFAULT 'Hồ Chí Minh'"],
  ];

  for (const [table, column, definition] of additions) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.length === 0) continue; // Bảng chưa tồn tại — schema.sql lo phần đó.
    if (columns.some((c) => c.name === column)) continue;
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  // Index trên CỘT VỪA THÊM phải tạo ở đây, KHÔNG được để trong schema.sql.
  // schema.sql chạy trước bước trên, nên với DB đang chạy (bảng đã có từ trước,
  // cột thì chưa) câu CREATE INDEX gãy ngay — mà getDb() là cửa vào của mọi
  // lệnh, gãy ở đây là listener chết theo. Đã xảy ra thật ngày 16/08/2026.
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_job_raw_text_hash ON job_raw(text_hash, posted_at)`,
  );
}

// ---- Types ----

export type MemberRole = "owner" | "admin" | "member";
export type MemberEventType = "joined" | "left" | "removed" | "blocked" | "reactivated";
export type MemberEventSource = "listener" | "snapshot_sync" | "bot_cleanup" | "moderation" | "manual_web";
export type MemberSyncRunStatus = "running" | "done" | "failed";
export type InteractionType = "message" | "reaction" | "vote" | "manual" | "image" | "video";
export type InteractionSource = "listener" | "manual" | "poll";
export type ScanRunStatus =
  | "collecting"
  | "warned"
  | "planned"
  | "pending_approval"
  | "kicking"
  | "done"
  | "cancelled"
  | "skipped"
  | "failed";

export interface MemberRow {
  zalo_user_id: string;
  display_name: string;
  role: MemberRole;
  joined_at: number | null;
  first_seen_at: number;
  is_active: number;
  left_at: number | null;
}

export interface MemberStats {
  zalo_user_id: string;
  display_name: string;
  role: MemberRole;
  joined_at: number | null;
  first_seen_at: number;
  interaction_count: number;
  last_interaction: number | null;
}

export interface MemberSyncRunRow {
  id: number;
  requested_by: string;
  started_at: number;
  finished_at: number | null;
  status: MemberSyncRunStatus;
  group_id: string | null;
  group_name: string | null;
  member_count: number | null;
  snapshot_count: number | null;
  upserted: number | null;
  marked_left: number | null;
  error: string | null;
}

export interface BotErrorRow {
  id: number;
  source: string;
  code: string;
  message: string;
  detail: string | null;
  created_at: number;
}

export interface ScanRunRow {
  id: number;
  started_at: number;
  finished_at: number | null;
  status: ScanRunStatus;
  target_count: number;
  member_count: number | null;
  planned_kicks: number | null;
  actual_kicks: number | null;
  note: string | null;
}

export type CleanupPlanItemStatus = "planned" | "removed" | "failed" | "skipped";

export interface CleanupPlanItemRow {
  id: number;
  scan_run_id: number;
  zalo_user_id: string;
  display_name: string;
  interaction_count: number;
  last_interaction: number | null;
  rank: number;
  status: CleanupPlanItemStatus;
  error: string | null;
  updated_at: number;
}

export interface GroupMessageInput {
  threadId: string;
  messageId: string;
  zaloUserId: string;
  displayName?: string;
  text: string;
  msgType?: string;
  ts: number;
  isSelf?: boolean;
  source?: "listener";
  now: number;
}

export interface GroupMediaEventInput {
  threadId: string;
  messageId: string;
  zaloUserId: string;
  displayName?: string;
  mediaType: "image" | "video";
  mediaCount: number;
  msgType?: string;
  ts: number;
  isSelf?: boolean;
  source?: "listener";
  now: number;
  /** Link media Zalo trả về — link TẠM, giữ lại chỉ để tra cứu khi cần đối chiếu. */
  mediaUrl?: string;
  /** File đã tải sẵn về đĩa; đây mới là thứ dùng được lúc đọc chữ trong ảnh. */
  localPath?: string;
}

// ---- Members ----

/**
 * Tạo mới hoặc cập nhật member. Giữ nguyên first_seen_at của lần đầu (COALESCE),
 * cập nhật tên/role/joined_at mới nhất, đánh dấu active lại nếu họ quay lại.
 */
export function upsertMember(input: {
  zaloUserId: string;
  displayName?: string;
  role?: MemberRole;
  joinedAt?: number | null;
  groupId?: string;
  now: number;
}): void {
  const database = getDb();
  // 1. Lưu bảng members chung
  database
    .prepare(
      `INSERT INTO members (zalo_user_id, display_name, role, joined_at, first_seen_at, is_active, left_at, group_id)
       VALUES (@id, @name, @roleInsert, @joinedAt, @now, 1, NULL, @groupId)
       ON CONFLICT(zalo_user_id) DO UPDATE SET
         display_name = CASE WHEN @name != '' THEN @name ELSE display_name END,
         role         = CASE WHEN @role != '' THEN @role ELSE role END,
         group_id     = CASE WHEN @groupId != '' THEN @groupId ELSE group_id END,
         joined_at    = COALESCE(members.joined_at, @joinedAt),
         is_active    = 1,
         left_at      = NULL`,
    )
    .run({
      id: input.zaloUserId,
      name: input.displayName ?? "",
      role: input.role ?? "",
      roleInsert: input.role ?? "member",
      joinedAt: input.joinedAt ?? null,
      groupId: input.groupId ?? "",
      now: input.now,
    });

  // 2. Lưu bảng group_members riêng theo từng nhóm
  if (input.groupId) {
    try {
      database
        .prepare(
          `INSERT INTO group_members (zalo_user_id, group_id, display_name, role, joined_at, first_seen_at, is_active, left_at)
           VALUES (@id, @groupId, @name, @roleInsert, @joinedAt, @now, 1, NULL)
           ON CONFLICT(zalo_user_id, group_id) DO UPDATE SET
             display_name = CASE WHEN @name != '' THEN @name ELSE display_name END,
             role         = CASE WHEN @role != '' THEN @role ELSE role END,
             joined_at    = COALESCE(group_members.joined_at, @joinedAt),
             is_active    = 1,
             left_at      = NULL`,
        )
        .run({
          id: input.zaloUserId,
          groupId: input.groupId,
          name: input.displayName ?? "",
          role: input.role ?? "",
          roleInsert: input.role ?? "member",
          joinedAt: input.joinedAt ?? null,
          now: input.now,
        });
    } catch {}
  }
}

/** Đánh dấu member đã rời/bị kick khỏi một nhóm cụ thể (hoặc toàn bộ nếu không truyền groupId). */
export function markMemberLeft(zaloUserId: string, now: number, groupId?: string): void {
  const database = getDb();
  if (groupId) {
    try {
      database
        .prepare(`UPDATE group_members SET is_active = 0, left_at = @now WHERE zalo_user_id = @id AND group_id = @groupId`)
        .run({ id: zaloUserId, groupId, now });
    } catch {}
  } else {
    database
      .prepare(`UPDATE members SET is_active = 0, left_at = @now WHERE zalo_user_id = @id`)
      .run({ id: zaloUserId, now });
  }
}

export function getMember(zaloUserId: string, groupId?: string): MemberRow | undefined {
  const database = getDb();
  if (groupId) {
    try {
      const row = database
        .prepare(`SELECT * FROM group_members WHERE zalo_user_id = @id AND group_id = @groupId`)
        .get({ id: zaloUserId, groupId }) as MemberRow | undefined;
      if (row) return row;
    } catch {}
  }
  return database
    .prepare(`SELECT * FROM members WHERE zalo_user_id = @id`)
    .get({ id: zaloUserId }) as MemberRow | undefined;
}

// ---- Ops errors ----

export function recordBotError(input: {
  source: string;
  code?: string;
  message: string;
  detail?: string | null;
  now?: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO bot_errors (source, code, message, detail, created_at)
       VALUES (@source, @code, @message, @detail, @now)`,
    )
    .run({
      source: input.source,
      code: input.code ?? "",
      message: input.message.slice(0, 1000),
      detail: input.detail ? input.detail.slice(0, 5000) : null,
      now: input.now ?? Date.now(),
    });
}

// ---- Member sync / audit ----

export function createMemberSyncRun(input: { requestedBy: string; startedAt: number }): number {
  const res = getDb()
    .prepare(
      `INSERT INTO member_sync_runs (requested_by, started_at, status)
       VALUES (@requestedBy, @startedAt, 'running')`,
    )
    .run(input);
  return Number(res.lastInsertRowid);
}

export function finishMemberSyncRun(input: {
  id: number;
  finishedAt: number;
  status: MemberSyncRunStatus;
  groupId?: string | null;
  groupName?: string | null;
  memberCount?: number | null;
  snapshotCount?: number | null;
  upserted?: number | null;
  markedLeft?: number | null;
  error?: string | null;
}): void {
  getDb()
    .prepare(
      `UPDATE member_sync_runs
       SET finished_at = @finishedAt,
           status = @status,
           group_id = COALESCE(@groupId, group_id),
           group_name = COALESCE(@groupName, group_name),
           member_count = COALESCE(@memberCount, member_count),
           snapshot_count = COALESCE(@snapshotCount, snapshot_count),
           upserted = COALESCE(@upserted, upserted),
           marked_left = COALESCE(@markedLeft, marked_left),
           error = @error
       WHERE id = @id`,
    )
    .run({
      id: input.id,
      finishedAt: input.finishedAt,
      status: input.status,
      groupId: input.groupId ?? null,
      groupName: input.groupName ?? null,
      memberCount: input.memberCount ?? null,
      snapshotCount: input.snapshotCount ?? null,
      upserted: input.upserted ?? null,
      markedLeft: input.markedLeft ?? null,
      error: input.error ?? null,
    });
}

export function recordMemberEvent(input: {
  zaloUserId: string;
  displayName?: string;
  role?: MemberRole | null;
  eventType: MemberEventType;
  source: MemberEventSource;
  syncRunId?: number | null;
  ts: number;
  note?: string | null;
}): void {
  if (!input.zaloUserId) return;
  getDb()
    .prepare(
      `INSERT INTO member_events
         (zalo_user_id, display_name, role, event_type, source, sync_run_id, ts, note)
       VALUES
         (@zaloUserId, @displayName, @role, @eventType, @source, @syncRunId, @ts, @note)`,
    )
    .run({
      zaloUserId: input.zaloUserId,
      displayName: input.displayName ?? "",
      role: input.role ?? null,
      eventType: input.eventType,
      source: input.source,
      syncRunId: input.syncRunId ?? null,
      ts: input.ts,
      note: input.note ?? null,
    });
}

export function getLatestMemberSyncRun(): MemberSyncRunRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM member_sync_runs ORDER BY id DESC LIMIT 1`)
    .get() as MemberSyncRunRow | undefined;
}

// ---- Interactions (append-only) ----

/**
 * Ghi 1 tương tác. INSERT OR IGNORE để seed lịch sử chạy lại không nhân đôi
 * (unique index dedupe theo user+ts+type+source).
 */
export function logInteraction(input: {
  zaloUserId: string;
  type: InteractionType;
  ts: number;
  source?: InteractionSource;
  threadId?: string;
}): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO interactions (zalo_user_id, type, ts, source, thread_id)
       VALUES (@id, @type, @ts, @source, @threadId)`,
    )
    .run({
      id: input.zaloUserId,
      type: input.type,
      ts: input.ts,
      source: input.source ?? "listener",
      threadId: input.threadId ?? "",
    });
}

/**
 * Ghi tương tác reaction: CHỈ TÍNH 1 ĐIỂM DUY NHẤT cho mỗi tin nhắn đối với mỗi thành viên.
 * Nếu thành viên đổi reaction hoặc bấm lại trên cùng 1 tin nhắn -> KHÔNG cộng thêm điểm.
 */
export function logReactionOnce(input: {
  zaloUserId: string;
  targetMsgId: string;
  ts: number;
  threadId?: string;
}): boolean {
  const db = getDb();
  const source = input.targetMsgId ? `react:${input.targetMsgId}` : "listener";
  const threadId = input.threadId ?? "";

  if (input.targetMsgId) {
    const existing = db
      .prepare(
        `SELECT 1 FROM interactions
         WHERE zalo_user_id = @id AND type = 'reaction' AND source = @source
         LIMIT 1`,
      )
      .get({ id: input.zaloUserId, source });

    if (existing) {
      return false; // Đã từng tính điểm reaction cho tin nhắn này -> bỏ qua
    }
  }

  db.prepare(
    `INSERT OR IGNORE INTO interactions (zalo_user_id, type, ts, source, thread_id)
     VALUES (@id, 'reaction', @ts, @source, @threadId)`,
  ).run({
    id: input.zaloUserId,
    ts: input.ts,
    source,
    threadId,
  });

  return true;
}

// ---- Group text message archive ----

/** Lưu text message để sau này export/tổng hợp blog. Dedupe theo thread_id + message_id. */
export function saveGroupMessage(input: GroupMessageInput): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO group_messages
         (thread_id, message_id, zalo_user_id, display_name, text, msg_type, ts, is_self, source, created_at)
       VALUES
         (@threadId, @messageId, @zaloUserId, @displayName, @text, @msgType, @ts, @isSelf, @source, @now)`,
    )
    .run({
      threadId: input.threadId,
      messageId: input.messageId,
      zaloUserId: input.zaloUserId,
      displayName: input.displayName ?? "",
      text: input.text,
      msgType: input.msgType ?? "",
      ts: input.ts,
      isSelf: input.isSelf ? 1 : 0,
      source: input.source ?? "listener",
      now: input.now,
    });
}

/**
 * Lưu metadata ảnh/video, kèm link Zalo và file đã tải sẵn (nếu có).
 *
 * File tải sẵn là thứ để đọc chữ trong ảnh về sau. Không có file thì dòng này
 * vẫn có giá trị nguyên như trước: đếm ảnh/video cho bản tóm tắt.
 */
export function saveGroupMediaEvent(input: GroupMediaEventInput): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO group_media_events
         (thread_id, message_id, zalo_user_id, display_name, media_type, media_count,
          msg_type, ts, is_self, source, created_at, media_url, local_path)
       VALUES
         (@threadId, @messageId, @zaloUserId, @displayName, @mediaType, @mediaCount,
          @msgType, @ts, @isSelf, @source, @now, @mediaUrl, @localPath)`,
    )
    .run({
      threadId: input.threadId,
      messageId: input.messageId,
      zaloUserId: input.zaloUserId,
      displayName: input.displayName ?? "",
      mediaType: input.mediaType,
      mediaCount: Math.max(1, Math.trunc(input.mediaCount)),
      msgType: input.msgType ?? "",
      ts: input.ts,
      isSelf: input.isSelf ? 1 : 0,
      source: input.source ?? "listener",
      now: input.now,
      mediaUrl: input.mediaUrl ?? "",
      localPath: input.localPath ?? "",
    });
}

/**
 * Ảnh Zalo đã tải về mà chưa đọc chữ, trong một khoảng thời gian.
 *
 * Chỉ lấy ảnh (video đọc chữ không có ý nghĩa) và bỏ tin đã thu hồi — người ta
 * đã rút lại thì chữ trong đó cũng không được vào bản tóm tắt hay trang tuyển
 * dụng, đúng nếp đang áp cho phần chữ.
 */
export function listGroupMediaPendingOcr(
  threadId: string,
  startTs: number,
  endTs: number,
  limit: number,
): GroupMediaOcrRow[] {
  return getDb()
    .prepare(
      `SELECT id, zalo_user_id, display_name, ts, local_path
         FROM group_media_events
        WHERE thread_id = @threadId AND ts >= @startTs AND ts < @endTs
          AND media_type = 'image' AND local_path <> '' AND ocr_at IS NULL
          AND deleted_at IS NULL
        ORDER BY ts ASC
        LIMIT @limit`,
    )
    .all({ threadId, startTs, endTs, limit }) as GroupMediaOcrRow[];
}

export interface GroupMediaOcrRow {
  id: number;
  zalo_user_id: string;
  display_name: string;
  ts: number;
  local_path: string;
}

/**
 * Ghi lại chữ đọc được từ một ảnh.
 *
 * Ghi `ocr_at` cả khi không đọc ra chữ nào: ảnh chế, ảnh chụp mèo thì lần chạy
 * sau không việc gì phải đọc lại lần nữa.
 */
export function saveGroupMediaOcr(id: number, ocrText: string, now: number): void {
  getDb()
    .prepare(`UPDATE group_media_events SET ocr_text = @ocrText, ocr_at = @now WHERE id = @id`)
    .run({ id, ocrText, now });
}

/** Chữ đã đọc được từ ảnh trong khoảng thời gian — cho bản tóm tắt và tin tuyển dụng dùng lại. */
export function listGroupMediaOcrBetween(
  threadId: string,
  startTs: number,
  endTs: number,
): { zalo_user_id: string; display_name: string; ts: number; ocr_text: string }[] {
  return getDb()
    .prepare(
      `SELECT zalo_user_id, display_name, ts, ocr_text
         FROM group_media_events
        WHERE thread_id = @threadId AND ts >= @startTs AND ts < @endTs
          AND ocr_text <> '' AND deleted_at IS NULL AND is_self = 0
        ORDER BY ts ASC`,
    )
    .all({ threadId, startTs, endTs }) as {
    zalo_user_id: string;
    display_name: string;
    ts: number;
    ocr_text: string;
  }[];
}

/** Đường dẫn ảnh đã đọc xong hoặc quá cũ — để dọn đĩa. */
export function listGroupMediaFilesToClean(olderThanTs: number): { id: number; local_path: string }[] {
  return getDb()
    .prepare(
      `SELECT id, local_path FROM group_media_events
        WHERE local_path <> '' AND (ocr_at IS NOT NULL OR ts < @olderThanTs)`,
    )
    .all({ olderThanTs }) as { id: number; local_path: string }[];
}

/**
 * Gắn file ảnh đã tải xong vào dòng media tương ứng.
 *
 * Tách khỏi lúc ghi dòng vì việc tải diễn ra SAU: luồng nhận tin real-time
 * không được đứng chờ mạng, nên dòng được ghi trước rồi đường dẫn điền sau.
 */
export function setGroupMediaLocalPath(
  threadId: string,
  messageId: string,
  localPath: string,
): void {
  getDb()
    .prepare(
      `UPDATE group_media_events SET local_path = @localPath
        WHERE thread_id = @threadId AND message_id = @messageId AND media_type = 'image'`,
    )
    .run({ threadId, messageId, localPath });
}

/** Quên đường dẫn file đã xoá khỏi đĩa (dòng thống kê và chữ đã đọc vẫn giữ nguyên). */
export function clearGroupMediaLocalPath(id: number): void {
  getDb().prepare(`UPDATE group_media_events SET local_path = '' WHERE id = @id`).run({ id });
}

export type DeletedSource = "undo" | "moderation";

/**
 * Đánh dấu tin (và ảnh/video kèm theo) là ĐÃ THU HỒI — soft-delete, không xoá dòng.
 *
 * Zalo chỉ báo id của tin bị thu hồi, mà id lưu lúc nhận tin có thể là msgId HOẶC
 * cliMsgId (xem extractMessageId ở listener) → nhận nhiều id ứng viên, khớp cái nào
 * cũng được. Đã đánh dấu rồi thì giữ nguyên mốc cũ (thu hồi lặp không ghi đè).
 *
 * Trả về số dòng vừa đánh dấu ở mỗi bảng — 0/0 nghĩa là tin không có trong kho
 * (tin ảnh không caption, tin trước khi bot vào nhóm, hoặc id không khớp).
 */
export function markGroupContentDeleted(input: {
  threadId: string;
  messageIds: string[];
  source: DeletedSource;
  now: number;
}): { messages: number; media: number } {
  const ids = [...new Set(input.messageIds.map((id) => String(id).trim()).filter((id) => id !== ""))];
  if (ids.length === 0) return { messages: 0, media: 0 };

  const placeholders = ids.map(() => "?").join(", ");
  const markOne = (table: "group_messages" | "group_media_events"): number =>
    getDb()
      .prepare(
        `UPDATE ${table}
         SET deleted_at = ?, deleted_source = ?
         WHERE thread_id = ? AND message_id IN (${placeholders}) AND deleted_at IS NULL`,
      )
      .run(input.now, input.source, input.threadId, ...ids).changes;

  return { messages: markOne("group_messages"), media: markOne("group_media_events") };
}

// ---- Bản sao tin Zalo bên Telegram (để gỡ khi tin gốc bị thu hồi) ----

export interface TelegramForwardRow {
  id: number;
  zalo_message_id: string;
  chat_id: string;
  tg_message_id: number;
}

/** Nhớ tin vừa forward. Gửi lại cùng tin (Zalo redeliver) không sinh dòng thừa. */
export function saveTelegramForward(input: {
  threadId: string;
  zaloMessageId: string;
  chatId: string;
  tgMessageId: number;
  ts: number;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO telegram_forwards
         (thread_id, zalo_message_id, chat_id, tg_message_id, ts, created_at)
       VALUES (@threadId, @zaloMessageId, @chatId, @tgMessageId, @ts, @now)`,
    )
    .run(input);
}

/** Bản sao Telegram CHƯA gỡ của các tin Zalo này. */
export function listPendingTelegramForwards(
  threadId: string,
  zaloMessageIds: string[],
): TelegramForwardRow[] {
  const ids = [...new Set(zaloMessageIds.map((id) => String(id).trim()).filter((id) => id !== ""))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return getDb()
    .prepare(
      `SELECT id, zalo_message_id, chat_id, tg_message_id
       FROM telegram_forwards
       WHERE thread_id = ? AND zalo_message_id IN (${placeholders}) AND removed_at IS NULL`,
    )
    .all(threadId, ...ids) as TelegramForwardRow[];
}

/** Đã gỡ xong: how = 'deleted' (xoá hẳn) | 'relabeled' (quá 48h nên chỉ đổi nhãn). */
export function markTelegramForwardRemoved(id: number, how: string, now: number): void {
  getDb()
    .prepare(`UPDATE telegram_forwards SET removed_at = @now, removed_how = @how WHERE id = @id`)
    .run({ id, how, now });
}

// ---- Reads cho tóm tắt hằng ngày ----

export interface GroupMessageRow {
  zalo_user_id: string;
  display_name: string;
  text: string;
  ts: number;
}

/**
 * Tin nhắn text của 1 thread trong [startTs, endTs), sắp theo thời gian tăng dần.
 * Loại tin bot tự gửi (is_self=1) — cảnh báo cleanup/bản tin của bot không phải
 * thảo luận của thành viên, không được lọt vào tóm tắt hay top "sôi nổi nhất".
 * Loại luôn tin ĐÃ THU HỒI (deleted_at) — người gửi đã rút lại thì không được
 * đăng tiếp ra tóm tắt / bản tin công khai / kho tin tuyển dụng.
 */
export function listGroupMessagesBetween(
  threadId: string,
  startTs: number,
  endTs: number,
): GroupMessageRow[] {
  return getDb()
    .prepare(
      `SELECT zalo_user_id, display_name, text, ts
       FROM group_messages
       WHERE thread_id = @threadId AND ts >= @startTs AND ts < @endTs AND is_self = 0
         AND deleted_at IS NULL
       ORDER BY ts ASC`,
    )
    .all({ threadId, startTs, endTs }) as GroupMessageRow[];
}

/** Đếm ảnh/video thành viên gửi trong [startTs, endTs) — cho phần thống kê của tóm tắt. */
export function countGroupMediaBetween(
  threadId: string,
  startTs: number,
  endTs: number,
): { images: number; videos: number } {
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN media_type = 'image' THEN media_count ELSE 0 END), 0) AS images,
         COALESCE(SUM(CASE WHEN media_type = 'video' THEN media_count ELSE 0 END), 0) AS videos
       FROM group_media_events
       WHERE thread_id = @threadId AND ts >= @startTs AND ts < @endTs AND is_self = 0
         AND deleted_at IS NULL`,
    )
    .get({ threadId, startTs, endTs }) as { images: number; videos: number };
  return { images: Number(row.images), videos: Number(row.videos) };
}

// ---- Daily summaries (kho lưu vĩnh viễn) ----

export interface DailySummaryInput {
  /** 'YYYY-MM-DD' theo giờ VN — khoá nghiệp vụ, mỗi ngày đúng 1 dòng. */
  dayDate: string;
  /** 'dd/mm/yyyy' đúng như in trong bản tin. */
  dayLabel: string;
  /** Epoch ms 00:00 giờ VN của ngày được tóm tắt. */
  dayStartTs: number;
  threadId: string;
  /** Bản tóm tắt thô từ model (chưa chia tin, chưa gắn header/footer). */
  summaryText: string;
  /** Các tin nhắn đã compose để gửi đi. */
  parts: string[];
  totalMessages?: number | null;
  includedMessages?: number | null;
  uniqueSenders?: number | null;
  images?: number | null;
  videos?: number | null;
  topSenders?: string[];
  model?: string;
  transcriptChars?: number | null;
  source?: "live" | "state_backfill" | "backfill";
  now: number;
}

function dailySummaryParams(input: DailySummaryInput): Record<string, unknown> {
  return {
    dayDate: input.dayDate,
    dayLabel: input.dayLabel,
    dayStartTs: input.dayStartTs,
    threadId: input.threadId,
    summaryText: input.summaryText,
    partsJson: JSON.stringify(input.parts),
    totalMessages: input.totalMessages ?? null,
    includedMessages: input.includedMessages ?? null,
    uniqueSenders: input.uniqueSenders ?? null,
    images: input.images ?? null,
    videos: input.videos ?? null,
    topSendersJson: JSON.stringify(input.topSenders ?? []),
    model: input.model ?? "",
    transcriptChars: input.transcriptChars ?? null,
    source: input.source ?? "live",
    now: input.now,
  };
}

const DAILY_SUMMARY_INSERT_SQL = `INTO daily_summaries
    (day_date, day_label, day_start_ts, thread_id, summary_text, parts_json,
     total_messages, included_messages, unique_senders, images, videos,
     top_senders_json, model, transcript_chars, source, created_at)
  VALUES
    (@dayDate, @dayLabel, @dayStartTs, @threadId, @summaryText, @partsJson,
     @totalMessages, @includedMessages, @uniqueSenders, @images, @videos,
     @topSendersJson, @model, @transcriptChars, @source, @now)`;

/**
 * Lưu bản tóm tắt của 1 ngày (upsert theo day_date). Chạy lại cùng ngày sau khi
 * state bị mất → bản sinh mới (đầy đủ thống kê) ghi đè bản cũ.
 */
export function saveDailySummary(input: DailySummaryInput): void {
  getDb()
    .prepare(
      `INSERT ${DAILY_SUMMARY_INSERT_SQL}
       ON CONFLICT(day_date) DO UPDATE SET
         day_label = @dayLabel,
         day_start_ts = @dayStartTs,
         thread_id = @threadId,
         summary_text = @summaryText,
         parts_json = @partsJson,
         total_messages = @totalMessages,
         included_messages = @includedMessages,
         unique_senders = @uniqueSenders,
         images = @images,
         videos = @videos,
         top_senders_json = @topSendersJson,
         model = @model,
         transcript_chars = @transcriptChars,
         source = @source,
         created_at = @now`,
    )
    .run(dailySummaryParams(input));
}

/**
 * Backfill từ bot_state cũ: chỉ chèn khi ngày đó CHƯA có trong kho — bản 'live'
 * (đầy đủ thống kê) không bao giờ bị bản khôi phục nghèo dữ liệu hơn ghi đè.
 */
export function backfillDailySummaryIfMissing(input: DailySummaryInput): boolean {
  const res = getDb()
    .prepare(`INSERT OR IGNORE ${DAILY_SUMMARY_INSERT_SQL}`)
    .run(dailySummaryParams({ ...input, source: input.source ?? "state_backfill" }));
  return res.changes > 0;
}

/** Ngày ('YYYY-MM-DD') đã có trong kho chưa — backfill check trước khi tốn tiền gọi model. */
export function hasDailySummaryForDate(dayDate: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM daily_summaries WHERE day_date = @dayDate`)
    .get({ dayDate }) as { ok: number } | undefined;
  return row !== undefined;
}

/** Mốc ts của tin nhắn thành viên đầu tiên trong kho — điểm bắt đầu quét backfill. */
export function getEarliestGroupMessageTs(threadId: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(ts) AS t FROM group_messages
       WHERE thread_id = @threadId AND is_self = 0 AND deleted_at IS NULL`,
    )
    .get({ threadId }) as { t: number | null };
  return row.t ?? null;
}

// ---- Bản tin công khai hằng ngày (Facebook Page + bahub.vn/ban-tin) ----

export interface PublicPostRow {
  day_date: string;
  day_label: string;
  day_start_ts: number;
  main_caption: string;
  topics_json: string;
  fb_post_id: string | null;
  fb_posted_at: number | null;
  skipped_reason: string | null;
  model: string;
  source: string;
  created_at: number;
  updated_at: number;
}

export interface PublicPostInput {
  dayDate: string;
  dayLabel: string;
  dayStartTs: number;
  mainCaption: string;
  /** JSON array [{title, caption, image_prompt, image_file, image_url}] — rỗng = ngày không có bản tin. */
  topicsJson: string;
  skippedReason?: string | null;
  model?: string;
  source?: "live" | "backfill";
  now: number;
}

/**
 * Lưu bản tin công khai của 1 ngày (upsert theo day_date).
 *
 * KHÔNG đụng fb_post_id: soạn lại nội dung không có nghĩa là bài trên Page biến
 * mất — giữ id để lần chạy sau vẫn biết ngày này đã đăng rồi.
 * created_at giữ nguyên lần đầu; updated_at là con trỏ cho lệnh sync-posts.
 */
export function savePublicPost(input: PublicPostInput): void {
  getDb()
    .prepare(
      `INSERT INTO daily_public_posts
         (day_date, day_label, day_start_ts, main_caption, topics_json,
          skipped_reason, model, source, created_at, updated_at)
       VALUES
         (@dayDate, @dayLabel, @dayStartTs, @mainCaption, @topicsJson,
          @skippedReason, @model, @source, @now, @now)
       ON CONFLICT(day_date) DO UPDATE SET
         day_label = @dayLabel,
         day_start_ts = @dayStartTs,
         main_caption = @mainCaption,
         topics_json = @topicsJson,
         skipped_reason = @skippedReason,
         model = @model,
         source = @source,
         updated_at = @now`,
    )
    .run({
      dayDate: input.dayDate,
      dayLabel: input.dayLabel,
      dayStartTs: input.dayStartTs,
      mainCaption: input.mainCaption,
      topicsJson: input.topicsJson,
      skippedReason: input.skippedReason ?? null,
      model: input.model ?? "",
      source: input.source ?? "live",
      now: input.now,
    });
}

export function getPublicPostByDate(dayDate: string): PublicPostRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM daily_public_posts WHERE day_date = @dayDate`)
    .get({ dayDate }) as PublicPostRow | undefined;
}

/** Ghi id bài Facebook sau khi đăng thành công (chống đăng trùng khi cron chạy lại). */
export function setPublicPostFbId(dayDate: string, fbPostId: string, now: number): void {
  getDb()
    .prepare(
      `UPDATE daily_public_posts
          SET fb_post_id = @fbPostId, fb_posted_at = @now, updated_at = @now
        WHERE day_date = @dayDate`,
    )
    .run({ dayDate, fbPostId, now });
}

/**
 * Ghi lại topics_json sau khi đã có URL ảnh công khai.
 *
 * KHÔNG chạm updated_at: con trỏ sync chỉ nên nhích khi NỘI DUNG đổi. Lệnh
 * sync-posts tự gọi hàm này ngay trước lúc đẩy, nhích con trỏ ở đây sẽ khiến
 * chính nó thấy dòng "mới" và đẩy lại vòng sau, lặp vô tận.
 */
export function updatePublicPostTopics(dayDate: string, topicsJson: string): void {
  getDb()
    .prepare(`UPDATE daily_public_posts SET topics_json = @topicsJson WHERE day_date = @dayDate`)
    .run({ dayDate, topicsJson });
}

/**
 * Các bản tin công khai cần đẩy lên bahub.vn, cũ → mới theo con trỏ ghép
 * (updated_at, day_date): backfill chạy vòng lặp nhanh có thể ghi nhiều ngày
 * trong cùng một mili-giây — chỉ so updated_at là mất ngày.
 *
 * Ngày topics rỗng (không đủ nội dung đáng đăng) VẪN nằm trong kết quả: web
 * cần biết để gỡ ngày đó xuống nếu trước đó đã trót đăng.
 */
export function listPublicPostsForSync(
  cursor: { updatedAt: number; dayDate: string },
  limit: number,
): PublicPostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM daily_public_posts
        WHERE updated_at > @updatedAt
           OR (updated_at = @updatedAt AND day_date > @dayDate)
        ORDER BY updated_at ASC, day_date ASC
        LIMIT @limit`,
    )
    .all({ updatedAt: cursor.updatedAt, dayDate: cursor.dayDate, limit }) as PublicPostRow[];
}

/**
 * Tên hiển thị của MỌI thành viên từng thấy trong group, kể cả người đã rời.
 *
 * Dùng để dò tên lọt vào bản tin công khai. Lấy cả người đã rời là cố ý: họ
 * vẫn xuất hiện trong tin nhắn của ngày đang tóm tắt, và rời nhóm không có
 * nghĩa là đồng ý cho nêu tên lên Facebook.
 */
export function listMemberDisplayNames(): string[] {
  const rows = getDb()
    .prepare(`SELECT DISTINCT display_name FROM members WHERE trim(display_name) <> ''`)
    .all() as { display_name: string }[];
  return rows.map((row) => row.display_name);
}

/** Ngày đã có bản tin công khai chưa — backfill check trước khi tốn tiền gọi model/sinh ảnh. */
export function hasPublicPostForDate(dayDate: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM daily_public_posts WHERE day_date = @dayDate`)
    .get({ dayDate }) as { ok: number } | undefined;
  return row !== undefined;
}

// ---- Tin tuyển dụng ----

export interface JobRawRow {
  id: number;
  source: string;
  source_id: string;
  author: string;
  source_url: string | null;
  text: string;
  posted_at: number;
  processed_at: number | null;
  is_job: number | null;
  created_at: number;
  image_urls: string;
  ocr_text: string;
  text_hash: string;
}

export interface JobRawInput {
  source: string;
  sourceId: string;
  author: string;
  sourceUrl: string | null;
  text: string;
  postedAt: number;
  imageUrls?: string[];
  textHash?: string;
}

/**
 * Lưu nội dung thô mới lấy về. Trả về SỐ DÒNG THỰC SỰ THÊM MỚI.
 *
 * Trùng (source, source_id) thì bỏ qua im lặng — bài ghim của group Facebook
 * xuất hiện trong mọi lần lấy, và cụm Zalo/Telegram có thể được gom lại y hệt
 * ở lần chạy sau. Bỏ qua ở tầng DB rẻ hơn nhiều so với hỏi AI lần nữa.
 */
export function saveJobRawBatch(items: JobRawInput[], now: number): number {
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO job_raw
       (source, source_id, author, source_url, text, posted_at, created_at, image_urls, text_hash)
     VALUES (@source, @sourceId, @author, @sourceUrl, @text, @postedAt, @now, @imageUrls, @textHash)`,
  );
  const run = getDb().transaction((rows: JobRawInput[]) => {
    let inserted = 0;
    for (const row of rows) {
      inserted += stmt.run({
        source: row.source,
        sourceId: row.sourceId,
        author: row.author,
        sourceUrl: row.sourceUrl,
        text: row.text,
        postedAt: row.postedAt,
        imageUrls: JSON.stringify(row.imageUrls ?? []),
        textHash: row.textHash ?? "",
        now,
      }).changes;
    }
    return inserted;
  });
  return run(items);
}

/**
 * Vân tay nội dung này đã từng vào kho chưa (trong khoảng thời gian còn ý nghĩa).
 *
 * Dùng để bỏ bài đăng chéo group TRƯỚC khi gọi model: cùng một JD được copy y
 * nguyên sang group khác thì chống trùng ở tầng sau vẫn bắt được, nhưng đã tốn
 * một lượt gọi model để bắt. Chỉ so trong cửa sổ gần đây vì cùng một nhà tuyển
 * dụng đăng lại đúng nội dung cũ sau vài tháng là một đợt tuyển khác.
 */
export function hasJobRawWithTextHash(textHash: string, sinceTs: number): boolean {
  if (!textHash) return false;
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM job_raw
        WHERE text_hash = @textHash AND posted_at >= @sinceTs
        LIMIT 1`,
    )
    .get({ textHash, sinceTs }) as { ok: number } | undefined;
  return row !== undefined;
}

/** Ghi lại chữ đã đọc từ ảnh của một mẩu thô, để chạy lại không phải đọc lần nữa. */
export function setJobRawOcrText(id: number, ocrText: string): void {
  getDb().prepare(`UPDATE job_raw SET ocr_text = @ocrText WHERE id = @id`).run({ id, ocrText });
}

/** Các mẩu thô chưa qua AI, cũ → mới (tin cũ được xử lý trước để thứ tự đăng đúng). */
export function listPendingJobRaw(limit: number): JobRawRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM job_raw
        WHERE processed_at IS NULL
        ORDER BY posted_at ASC
        LIMIT @limit`,
    )
    .all({ limit }) as JobRawRow[];
}

export function markJobRawProcessed(id: number, isJob: boolean, now: number): void {
  getDb()
    .prepare(`UPDATE job_raw SET processed_at = @now, is_job = @isJob WHERE id = @id`)
    .run({ id, isJob: isJob ? 1 : 0, now });
}

/**
 * Mốc thời gian bài mới nhất đã lấy của một nguồn — con trỏ để lần sau chỉ lấy
 * phần mới. Chưa có gì thì trả null, bên gọi tự quyết định lùi lại bao lâu.
 */
export function getLatestJobRawPostedAt(source: string): number | null {
  const row = getDb()
    .prepare(`SELECT MAX(posted_at) AS ts FROM job_raw WHERE source = @source`)
    .get({ source }) as { ts: number | null } | undefined;
  return row?.ts ?? null;
}

/**
 * Mốc bài mới nhất đã lấy của MỘT group Facebook.
 *
 * Phải tách theo group chứ không dùng chung mốc của cả nguồn `facebook`: thêm
 * group mới vào danh sách mà đi theo mốc chung thì group mới chỉ lấy được bài
 * đăng sau thời điểm thêm, mất trắng khoảng mười ngày bài mà Facebook vẫn đang
 * trả về sẵn trong trang.
 */
export function getLatestFbGroupPostedAt(groupSlug: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(posted_at) AS ts FROM job_raw
        WHERE source = 'facebook' AND source_url LIKE @pattern`,
    )
    .get({ pattern: `%/groups/${groupSlug}/%` }) as { ts: number | null } | undefined;
  return row?.ts ?? null;
}

export interface JobPostRow {
  id: number;
  fingerprint: string;
  title: string;
  company: string;
  level: string;
  location: string;
  city: string;
  work_mode: string;
  salary: string;
  employment_type: string;
  years_exp: string;
  skills_json: string;
  deadline: string;
  contact: string;
  summary: string;
  description: string;
  source: string;
  source_id: string;
  source_url: string | null;
  author: string;
  sources_json: string;
  posted_at: number;
  last_seen_at: number;
  repost_count: number;
  expires_at: number;
  risk_level: string;
  risk_reason: string | null;
  model: string;
  is_published: number;
  created_at: number;
  updated_at: number;
}

export interface JobPostInput {
  fingerprint: string;
  title: string;
  company: string;
  level: string;
  location: string;
  city: string;
  workMode: string;
  salary: string;
  employmentType: string;
  yearsExp: string;
  skillsJson: string;
  deadline: string;
  contact: string;
  summary: string;
  description: string;
  source: string;
  sourceId: string;
  sourceUrl: string | null;
  author: string;
  sourcesJson: string;
  postedAt: number;
  expiresAt: number;
  riskLevel: string;
  riskReason: string | null;
  model: string;
  now: number;
}

export function getJobPostByFingerprint(fingerprint: string): JobPostRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM job_posts WHERE fingerprint = @fingerprint`)
    .get({ fingerprint }) as JobPostRow | undefined;
}

/** Thêm tin tuyển dụng mới. Trùng fingerprint thì dùng markJobPostReposted thay vì hàm này. */
export function insertJobPost(input: JobPostInput): void {
  getDb()
    .prepare(
      `INSERT INTO job_posts
         (fingerprint, title, company, level, location, city, work_mode, salary, employment_type,
          years_exp, skills_json, deadline, contact, summary, description,
          source, source_id, source_url, author, sources_json,
          posted_at, last_seen_at, repost_count, expires_at,
          risk_level, risk_reason, model, is_published, created_at, updated_at)
       VALUES
         (@fingerprint, @title, @company, @level, @location, @city, @workMode, @salary, @employmentType,
          @yearsExp, @skillsJson, @deadline, @contact, @summary, @description,
          @source, @sourceId, @sourceUrl, @author, @sourcesJson,
          @postedAt, @postedAt, 0, @expiresAt,
          @riskLevel, @riskReason, @model, @isPublished, @now, @now)`,
    )
    .run({
      ...input,
      // Tin nghi ngờ lừa đảo vào kho nhưng KHÔNG hiện ra ngoài cho tới khi
      // quản trị viên tự bật lên — đây là ngoại lệ duy nhất của "đăng tự động".
      isPublished: input.riskLevel === "ok" ? 1 : 0,
    });
}

/**
 * Cùng một tin được đăng lại (nguồn khác hoặc chính người đó đăng lại): nhích
 * mốc thấy gần nhất, gia hạn, gộp thêm nguồn.
 *
 * KHÔNG chạm is_published: ngày quản trị viên đã ẩn tay thì lần đăng lại của
 * nhà tuyển dụng không được tự bật lại.
 */
export function markJobPostReposted(input: {
  fingerprint: string;
  sourcesJson: string;
  lastSeenAt: number;
  expiresAt: number;
  now: number;
}): void {
  getDb()
    .prepare(
      `UPDATE job_posts
          SET last_seen_at = @lastSeenAt,
              repost_count = repost_count + 1,
              sources_json = @sourcesJson,
              expires_at = @expiresAt,
              updated_at = @now
        WHERE fingerprint = @fingerprint`,
    )
    .run(input);
}

/**
 * Đổi NGUỒN CHÍNH của một tin đã có sang một nơi khác.
 *
 * Chỉ dùng cho đúng một việc: cùng một JD xuất hiện ở nhiều group Facebook thì
 * link hiển thị trên trang phải trỏ về group đứng trước trong JOB_FB_GROUP_SLUG.
 * Nếu không có hàm này, link chính là nơi ĐẾN TRƯỚC — mà thứ tự đến chỉ phụ
 * thuộc hôm đó ai đăng sớm hơn, tức là group nhà thua chỉ vì đăng chậm nửa ngày.
 *
 * KHÔNG đụng vào nội dung hiển thị (mô tả, tiêu đề, lương): bản bóc tách đầu
 * tiên thường đầy đủ hơn, và đổi nội dung theo mỗi lần đăng lại là cách chắc
 * chắn nhất để một tin đang đúng bỗng thành sai.
 */
export function updateJobPostPrimarySource(input: {
  fingerprint: string;
  source: string;
  sourceId: string;
  sourceUrl: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `UPDATE job_posts
          SET source = @source,
              source_id = @sourceId,
              source_url = @sourceUrl,
              updated_at = @now
        WHERE fingerprint = @fingerprint`,
    )
    .run(input);
}

/** Tin tuyển dụng cần đẩy lên bahub.vn, theo con trỏ ghép (updated_at, id). */
export function listJobPostsForSync(
  cursor: { updatedAt: number; id: number },
  limit: number,
): JobPostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM job_posts
        WHERE updated_at > @updatedAt
           OR (updated_at = @updatedAt AND id > @id)
        ORDER BY updated_at ASC, id ASC
        LIMIT @limit`,
    )
    .all({ updatedAt: cursor.updatedAt, id: cursor.id, limit }) as JobPostRow[];
}

/**
 * Tin còn hạn, mới → cũ. Dùng để so trùng: một JD đăng lại thường lệch vài chữ
 * nên ngoài fingerprint còn phải so tương đối với các tin gần đây.
 */
export function listActiveJobPosts(now: number, limit = 200): JobPostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM job_posts
        WHERE expires_at > @now
        ORDER BY last_seen_at DESC
        LIMIT @limit`,
    )
    .all({ now, limit }) as JobPostRow[];
}

/** Cả kho tin tuyển dụng, cũ → mới. Dùng cho lệnh vá dữ liệu, không dùng để hiển thị. */
export function listAllJobPosts(): JobPostRow[] {
  return getDb().prepare(`SELECT * FROM job_posts ORDER BY id ASC`).all() as JobPostRow[];
}

/**
 * Đổi tên vị trí của một tin đã nằm trong kho.
 *
 * Nhích `updated_at` là cố ý: con trỏ của `sync-jobs` chạy theo cột này, nên tin
 * vừa sửa sẽ tự được đẩy lên Supabase ở lần sync kế tiếp mà không cần `--full`.
 */
export function updateJobPostTitle(id: number, title: string, now: number): void {
  getDb()
    .prepare(`UPDATE job_posts SET title = @title, updated_at = @now WHERE id = @id`)
    .run({ id, title, now });
}

/**
 * Đánh dấu tin đã hết hạn là hết hiển thị. Trả về số tin vừa bị gỡ.
 *
 * Trang tuyển dụng đầy tin chết là thứ giết uy tín nhanh nhất, nên bước này
 * chạy mỗi ngày chứ không chờ ai bấm.
 */
export function expireJobPosts(now: number): number {
  return getDb()
    .prepare(
      `UPDATE job_posts
          SET is_published = 0, updated_at = @now
        WHERE is_published = 1 AND expires_at <= @now`,
    )
    .run({ now }).changes;
}

// ---- Reads cho ranking / export ----

/**
 * Trọng số điểm tương tác theo loại — reaction quá dễ thả trên Zalo nên bị hạ thấp
 * so với message. vote (poll) đứng giữa. manual/image/video giữ tương đương gốc.
 * Dùng chung ở mọi query tính interaction_count (bot + web) để khỏi lệch điểm.
 */
export const INTERACTION_WEIGHT_SQL = `CASE i.type
    WHEN 'message' THEN 10
    WHEN 'image'   THEN 10
    WHEN 'video'   THEN 10
    WHEN 'vote'    THEN 3
    WHEN 'reaction' THEN 1
    WHEN 'manual'  THEN 1
    ELSE 1
  END`;

/**
 * Thống kê tương tác mỗi member còn active: điểm có trọng số + lần cuối.
 * Dùng cho export-members (M1) và ranking (M2 — sắp theo count ASC, last_interaction ASC).
 * Trọng số: message/image/video = 10, vote = 3, reaction/manual = 1.
 */
export function getMemberStats(groupId?: string): MemberStats[] {
  const targetGroupId = (groupId || "").trim();
  const primaryGroupId = "1913869945242410752";
  let groupClause = "WHERE m.is_active = 1";
  if (targetGroupId && targetGroupId !== "all") {
    if (targetGroupId === primaryGroupId) {
      groupClause = "WHERE m.is_active = 1 AND (m.group_id = @targetGroupId OR m.group_id = '' OR m.group_id IS NULL)";
    } else {
      groupClause = "WHERE m.is_active = 1 AND m.group_id = @targetGroupId";
    }
  }

  return getDb()
    .prepare(
      `SELECT m.zalo_user_id, m.display_name, m.role, m.joined_at, m.first_seen_at,
              COALESCE(SUM(${INTERACTION_WEIGHT_SQL}), 0) AS interaction_count,
              MAX(i.ts)         AS last_interaction
       FROM members m
       LEFT JOIN interactions i ON i.zalo_user_id = m.zalo_user_id
       ${groupClause}
       GROUP BY m.zalo_user_id
       ORDER BY interaction_count ASC, last_interaction ASC`,
    )
    .all({ targetGroupId }) as MemberStats[];
}

export type LeaderboardPeriod = "7d" | "30d" | "all";

export interface LeaderboardRow {
  rank: number;
  display_name: string;
  interaction_count: number;
  message_count: number;
  reaction_count: number;
  vote_count: number;
  other_count: number;
  last_interaction: number | null;
}

/**
 * Bảng xếp hạng public: chỉ trả tên + số liệu tổng hợp, tuyệt đối không trả Zalo ID.
 * Cùng query với web/src/lib/db.ts listLeaderboard (2 project riêng, không share code)
 * — dùng cho sync-leaderboard đẩy lên bahub.vn.
 */
export function listLeaderboard(period: LeaderboardPeriod, limit = 50): LeaderboardRow[] {
  const now = Date.now();
  const since =
    period === "7d" ? now - 7 * 86400000 : period === "30d" ? now - 30 * 86400000 : 0;

  const rows = getDb()
    .prepare(
      `SELECT
         m.display_name,
         SUM(${INTERACTION_WEIGHT_SQL}) AS interaction_count,
         SUM(CASE WHEN i.type = 'message' THEN 1 ELSE 0 END) AS message_count,
         SUM(CASE WHEN i.type = 'reaction' THEN 1 ELSE 0 END) AS reaction_count,
         SUM(CASE WHEN i.type = 'vote' THEN 1 ELSE 0 END) AS vote_count,
         SUM(CASE WHEN i.type NOT IN ('message', 'reaction', 'vote') THEN 1 ELSE 0 END) AS other_count,
         MAX(i.ts) AS last_interaction
       FROM interactions i
       JOIN members m ON m.zalo_user_id = i.zalo_user_id
       WHERE m.is_active = 1
         AND i.ts >= @since
       GROUP BY i.zalo_user_id, m.display_name
       ORDER BY interaction_count DESC, last_interaction DESC, LOWER(m.display_name) ASC
       LIMIT @limit`,
    )
    .all({
      since,
      limit: Math.min(Math.max(limit, 1), 100),
    }) as Omit<LeaderboardRow, "rank">[];

  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function countActiveMembers(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM members WHERE is_active = 1`)
    .get() as { n: number };
  return row.n;
}

// ---- Scan runs / cleanup warnings / removals ----

export function createScanRun(input: {
  startedAt: number;
  status: ScanRunStatus;
  targetCount: number;
  memberCount?: number | null;
  plannedKicks?: number | null;
  actualKicks?: number | null;
  note?: string | null;
}): number {
  const res = getDb()
    .prepare(
      `INSERT INTO scan_runs
         (started_at, status, target_count, member_count, planned_kicks, actual_kicks, note)
       VALUES
         (@startedAt, @status, @targetCount, @memberCount, @plannedKicks, @actualKicks, @note)`,
    )
    .run({
      startedAt: input.startedAt,
      status: input.status,
      targetCount: input.targetCount,
      memberCount: input.memberCount ?? null,
      plannedKicks: input.plannedKicks ?? null,
      actualKicks: input.actualKicks ?? null,
      note: input.note ?? null,
    });
  return Number(res.lastInsertRowid);
}

export function finishScanRun(input: {
  id: number;
  finishedAt: number;
  status: ScanRunStatus;
  memberCount?: number | null;
  plannedKicks?: number | null;
  actualKicks?: number | null;
  note?: string | null;
}): void {
  getDb()
    .prepare(
      `UPDATE scan_runs
       SET finished_at = @finishedAt,
           status = @status,
           member_count = COALESCE(@memberCount, member_count),
           planned_kicks = COALESCE(@plannedKicks, planned_kicks),
           actual_kicks = COALESCE(@actualKicks, actual_kicks),
           note = COALESCE(@note, note)
       WHERE id = @id`,
    )
    .run({
      id: input.id,
      finishedAt: input.finishedAt,
      status: input.status,
      memberCount: input.memberCount ?? null,
      plannedKicks: input.plannedKicks ?? null,
      actualKicks: input.actualKicks ?? null,
      note: input.note ?? null,
    });
}

export function getScanRun(id: number): ScanRunRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM scan_runs WHERE id = @id`)
    .get({ id }) as ScanRunRow | undefined;
}

export function getLatestScanRunByStatus(statuses: ScanRunStatus[]): ScanRunRow | undefined {
  if (statuses.length === 0) return undefined;
  const placeholders = statuses.map((_, i) => `@s${i}`).join(", ");
  const params = Object.fromEntries(statuses.map((s, i) => [`s${i}`, s]));
  return getDb()
    .prepare(`SELECT * FROM scan_runs WHERE status IN (${placeholders}) ORDER BY id DESC LIMIT 1`)
    .get(params) as ScanRunRow | undefined;
}

export function saveCleanupPlanItems(input: {
  scanRunId: number;
  items: {
    zaloUserId: string;
    displayName: string;
    interactionCount: number;
    lastInteraction: number | null;
    rank: number;
  }[];
  now: number;
}): void {
  const stmt = getDb().prepare(
    `INSERT INTO cleanup_plan_items
       (scan_run_id, zalo_user_id, display_name, interaction_count, last_interaction, rank, status, updated_at)
     VALUES
       (@scanRunId, @zaloUserId, @displayName, @interactionCount, @lastInteraction, @rank, 'planned', @now)
     ON CONFLICT(scan_run_id, zalo_user_id) DO UPDATE SET
       display_name = @displayName,
       interaction_count = @interactionCount,
       last_interaction = @lastInteraction,
       rank = @rank,
       updated_at = @now`,
  );
  const tx = getDb().transaction(() => {
    for (const item of input.items) {
      stmt.run({ scanRunId: input.scanRunId, now: input.now, ...item });
    }
  });
  tx();
}

export function listCleanupPlanItems(scanRunId: number): CleanupPlanItemRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM cleanup_plan_items
       WHERE scan_run_id = @scanRunId
       ORDER BY rank ASC`,
    )
    .all({ scanRunId }) as CleanupPlanItemRow[];
}

export function markCleanupPlanItem(input: {
  id: number;
  status: CleanupPlanItemStatus;
  error?: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `UPDATE cleanup_plan_items
       SET status = @status, error = @error, updated_at = @now
       WHERE id = @id`,
    )
    .run({ id: input.id, status: input.status, error: input.error ?? null, now: input.now });
}

export function markCleanupPlanItemsForRun(input: {
  scanRunId: number;
  fromStatus: CleanupPlanItemStatus;
  toStatus: CleanupPlanItemStatus;
  error?: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `UPDATE cleanup_plan_items
       SET status = @toStatus, error = @error, updated_at = @now
       WHERE scan_run_id = @scanRunId AND status = @fromStatus`,
    )
    .run({
      scanRunId: input.scanRunId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      error: input.error ?? null,
      now: input.now,
    });
}

export function hasCleanupWarning(zaloUserId: string): boolean {
  const row = getDb()
    .prepare(`SELECT 1 AS ok FROM cleanup_warnings WHERE zalo_user_id = @id`)
    .get({ id: zaloUserId }) as { ok: number } | undefined;
  return row !== undefined;
}

export function upsertCleanupWarning(input: {
  zaloUserId: string;
  scanRunId: number;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO cleanup_warnings
         (zalo_user_id, first_warned_run, first_warned_at, last_warned_run, last_warned_at, warning_count)
       VALUES
         (@id, @runId, @now, @runId, @now, 1)
       ON CONFLICT(zalo_user_id) DO UPDATE SET
         last_warned_run = @runId,
         last_warned_at = @now,
         warning_count = warning_count + 1`,
    )
    .run({ id: input.zaloUserId, runId: input.scanRunId, now: input.now });
}

export function recordRemoval(input: {
  scanRunId: number | null;
  zaloUserId: string;
  displayName: string;
  interactionCount: number;
  lastInteraction: number | null;
  removedAt: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO removals
         (scan_run_id, zalo_user_id, display_name, interaction_count, last_interaction, removed_at)
       VALUES
         (@scanRunId, @zaloUserId, @displayName, @interactionCount, @lastInteraction, @removedAt)`,
    )
    .run(input);
}

// ---- Moderation (real-time keyword filter) ----

export type ModerationActionType = "delete_only" | "delete_and_ban";

/** Ghi 1 lần kiểm duyệt (append-only). Lưu cả khi dry-run để soi lại bot "sẽ" làm gì. */
export function recordModerationAction(input: {
  threadId: string;
  messageId: string;
  zaloUserId: string;
  displayName: string;
  matchedWord: string;
  text: string;
  action: ModerationActionType;
  dryRun: boolean;
  deleted: boolean;
  kicked: boolean;
  blocked: boolean;
  error?: string | null;
  now: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO moderation_actions
         (thread_id, message_id, zalo_user_id, display_name, matched_word, text,
          action, dry_run, deleted, kicked, blocked, error, created_at)
       VALUES
         (@threadId, @messageId, @zaloUserId, @displayName, @matchedWord, @text,
          @action, @dryRun, @deleted, @kicked, @blocked, @error, @now)`,
    )
    .run({
      threadId: input.threadId,
      messageId: input.messageId,
      zaloUserId: input.zaloUserId,
      displayName: input.displayName,
      matchedWord: input.matchedWord,
      text: input.text,
      action: input.action,
      dryRun: input.dryRun ? 1 : 0,
      deleted: input.deleted ? 1 : 0,
      kicked: input.kicked ? 1 : 0,
      blocked: input.blocked ? 1 : 0,
      error: input.error ?? null,
      now: input.now,
    });
}

// ---- bot_state (key-value) ----

export function getBotState(key: string): string | undefined {
  const row = getDb()
    .prepare(`SELECT value FROM bot_state WHERE key = @key`)
    .get({ key }) as { value: string } | undefined;
  return row?.value;
}

export function setBotState(key: string, value: string, now: number): void {
  getDb()
    .prepare(
      `INSERT INTO bot_state (key, value, updated_at) VALUES (@key, @value, @now)
       ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @now`,
    )
    .run({ key, value, now });
}

export function deleteBotState(key: string): void {
  getDb().prepare(`DELETE FROM bot_state WHERE key = @key`).run({ key });
}

/**
 * Khóa chống chạy chồng (ATOMIC). Trả true nếu giành được khóa, false nếu đã có khóa
 * còn hiệu lực. Khóa cũ hơn staleMs coi như chết (process trước crash) → cho phép chiếm lại.
 *
 * Phải atomic vì `telegram-poll` chạy cron MỖI PHÚT còn 1 batch kick kéo dài tới ~100 phút
 * (50 người × 2 phút) → nhiều tiến trình chạy CHỒNG nhau. Read-then-write (2 statement) bị
 * TOCTOU: 2 process cùng SELECT thấy trống rồi cùng INSERT → cả hai tưởng thắng → KICK CHỒNG.
 * Gộp check-and-set vào 1 statement: INSERT ... ON CONFLICT DO UPDATE chỉ ghi đè khi khóa cũ
 * đã stale (WHERE), nếu khóa còn tươi thì UPDATE thành no-op (changes=0 = thua). SQLite ghi
 * tuần tự từng statement nên 1 trong 2 process chắc chắn changes=0.
 */
export function acquireLock(key: string, now: number, staleMs: number): boolean {
  const res = getDb()
    .prepare(
      `INSERT INTO bot_state (key, value, updated_at) VALUES (@key, @now, @now)
       ON CONFLICT(key) DO UPDATE SET value = @now, updated_at = @now
       WHERE CAST(bot_state.value AS INTEGER) <= 0
          OR @now - CAST(bot_state.value AS INTEGER) >= @staleMs`,
    )
    .run({ key, now, staleMs });
  // changes=1: INSERT mới / chiếm lại khóa stale / khóa giá trị hỏng (<=0) → an toàn không kẹt vĩnh viễn.
  // changes=0: khóa còn tươi → thua.
  return res.changes > 0;
}

export function releaseLock(key: string): void {
  deleteBotState(key);
}

export interface GroupSettings {
  groupId: string;
  name: string;
  totalMembers: number;
  mode: "interactive" | "silent" | "disabled";
  persona: "humorous" | "professional" | "friendly" | "strict" | "custom";
  customPrompt: string;
  botName: string;
  welcomeMsg: string;
  weatherAuto: boolean;
  weatherTime: string;
  weatherCity: string;
  isActive: boolean;
  updatedAt: number;
}

/** Lấy đầy đủ cấu hình cá tính và cài đặt của nhóm */
export function getGroupSettings(groupId: string): GroupSettings {
  try {
    const row = getDb()
      .prepare(
        `SELECT group_id as groupId, name, total_members as totalMembers, mode,
                COALESCE(persona, 'humorous') as persona,
                COALESCE(custom_prompt, '') as customPrompt,
                COALESCE(bot_name, 'Sen Chúa') as botName,
                COALESCE(welcome_msg, '') as welcomeMsg,
                COALESCE(weather_auto, 0) as weatherAuto,
                COALESCE(weather_time, '07:00') as weatherTime,
                COALESCE(weather_city, 'Hồ Chí Minh') as weatherCity,
                is_active as isActive, updated_at as updatedAt
         FROM bot_groups WHERE group_id = ?`,
      )
      .get(groupId) as any;
    if (row) {
      return {
        groupId: row.groupId,
        name: row.name || `Nhóm ${groupId.slice(-4)}`,
        totalMembers: row.totalMembers || 0,
        mode: row.mode || "interactive",
        persona: row.persona || "humorous",
        customPrompt: row.customPrompt || "",
        botName: row.botName || "Sen Chúa",
        welcomeMsg: row.welcomeMsg || "",
        weatherAuto: Boolean(row.weatherAuto),
        weatherTime: row.weatherTime || "07:00",
        weatherCity: row.weatherCity || "Hồ Chí Minh",
        isActive: Boolean(row.isActive),
        updatedAt: row.updatedAt || Date.now(),
      };
    }
  } catch {}

  return {
    groupId,
    name: `Nhóm ${groupId.slice(-4)}`,
    totalMembers: 0,
    mode: "interactive",
    persona: "humorous",
    customPrompt: "",
    botName: "Sen Chúa",
    welcomeMsg: "",
    weatherAuto: false,
    weatherTime: "07:00",
    weatherCity: "Hồ Chí Minh",
    isActive: true,
    updatedAt: Date.now(),
  };
}

/** Cập nhật toàn diện cài đặt cá tính cho nhóm */
export function updateGroupSettings(
  groupId: string,
  settings: Partial<{
    name: string;
    mode: "interactive" | "silent" | "disabled";
    persona: "humorous" | "professional" | "friendly" | "strict" | "custom";
    customPrompt: string;
    botName: string;
    welcomeMsg: string;
    weatherAuto: boolean;
    weatherTime: string;
    weatherCity: string;
  }>,
): void {
  const current = getGroupSettings(groupId);
  getDb()
    .prepare(
      `INSERT INTO bot_groups (group_id, name, total_members, mode, persona, custom_prompt, bot_name, welcome_msg, weather_auto, weather_time, weather_city, is_active, updated_at)
       VALUES (@groupId, @name, @totalMembers, @mode, @persona, @customPrompt, @botName, @welcomeMsg, @weatherAuto, @weatherTime, @weatherCity, @isActive, @now)
       ON CONFLICT(group_id) DO UPDATE SET
         name = COALESCE(@name, name),
         mode = COALESCE(@mode, mode),
         persona = COALESCE(@persona, persona),
         custom_prompt = COALESCE(@customPrompt, custom_prompt),
         bot_name = COALESCE(@botName, bot_name),
         welcome_msg = COALESCE(@welcomeMsg, welcome_msg),
         weather_auto = COALESCE(@weatherAuto, weather_auto),
         weather_time = COALESCE(@weatherTime, weather_time),
         weather_city = COALESCE(@weatherCity, weather_city),
         updated_at = @now`,
    )
    .run({
      groupId,
      name: settings.name ?? current.name,
      totalMembers: current.totalMembers,
      mode: settings.mode ?? current.mode,
      persona: settings.persona ?? current.persona,
      customPrompt: settings.customPrompt ?? current.customPrompt,
      botName: settings.botName ?? current.botName,
      welcomeMsg: settings.welcomeMsg ?? current.welcomeMsg,
      weatherAuto: settings.weatherAuto !== undefined ? (settings.weatherAuto ? 1 : 0) : (current.weatherAuto ? 1 : 0),
      weatherTime: settings.weatherTime ?? current.weatherTime,
      weatherCity: settings.weatherCity ?? current.weatherCity,
      isActive: current.isActive ? 1 : 0,
      now: Date.now(),
    });
}

/** Lấy chế độ hoạt động của nhóm: 'interactive' | 'silent' | 'disabled' */
export function getGroupMode(groupId: string): "interactive" | "silent" | "disabled" {
  try {
    const row = getDb()
      .prepare(`SELECT mode FROM bot_groups WHERE group_id = ?`)
      .get(groupId) as { mode?: string } | undefined;
    if (row?.mode === "silent" || row?.mode === "disabled" || row?.mode === "interactive") {
      return row.mode;
    }
  } catch {}
  return "interactive";
}

/** Cập nhật chế độ hoạt động của nhóm */
export function setGroupMode(groupId: string, mode: "interactive" | "silent" | "disabled"): void {
  updateGroupSettings(groupId, { mode });
}

export interface GroupKnowledgeItem {
  id?: number;
  threadId: string;
  title: string;
  fileName: string;
  fileType: string;
  fileUrl?: string;
  contentText: string;
  summary: string;
  senderName: string;
  createdAt: number;
}

/**
 * Ghi nhớ tri thức từ tài liệu/file/ảnh đã phân tích vào bộ nhớ dài hạn của nhóm.
 */
export function saveGroupKnowledge(item: GroupKnowledgeItem): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO group_knowledge (thread_id, title, file_name, file_type, file_url, content_text, summary, sender_name, created_at)
         VALUES (@threadId, @title, @fileName, @fileType, @fileUrl, @contentText, @summary, @senderName, @createdAt)`,
      )
      .run({
        threadId: item.threadId,
        title: item.title || item.fileName || "Tài liệu",
        fileName: item.fileName || "",
        fileType: item.fileType || "document",
        fileUrl: item.fileUrl || null,
        contentText: item.contentText || "",
        summary: item.summary || "",
        senderName: item.senderName || "",
        createdAt: item.createdAt || Date.now(),
      });
    console.log(`[db] 🧠 Đã lưu tri thức "${item.title || item.fileName}" vào bộ nhớ dài hạn của nhóm ${item.threadId}`);
  } catch (e) {
    console.warn(`[db] saveGroupKnowledge lỗi: ${String(e)}`);
  }
}

function tableExists(tableName: string): boolean {
  try {
    const row = getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(tableName);
    return Boolean(row);
  } catch {
    return false;
  }
}

/**
 * Tra cứu kho tri thức & tài liệu đã ghi nhớ của nhóm theo từ khóa.
 */
export function searchGroupKnowledge(threadId: string, query?: string, limit = 10): GroupKnowledgeItem[] {
  try {
    if (!tableExists("group_knowledge")) return [];
    if (query && query.trim() !== "") {
      const words = query
        .toLowerCase()
        .replace(/[?,.!/\\:;]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !["hỏi", "về", "gì", "cho", "xin", "file", "tài", "liệu"].includes(w));
      if (words.length > 0) {
        const conditions = words.map(() => `(LOWER(title) LIKE ? OR LOWER(file_name) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(content_text) LIKE ?)`).join(" OR ");
        const params: string[] = [];
        for (const w of words) {
          params.push(`%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`);
        }
        return getDb()
          .prepare(
            `SELECT * FROM group_knowledge
             WHERE (thread_id = ? OR thread_id = '') AND (${conditions})
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(threadId, ...params, limit) as GroupKnowledgeItem[];
      }
    }
    return getDb()
      .prepare(
        `SELECT * FROM group_knowledge
         WHERE (thread_id = ? OR thread_id = '')
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(threadId, limit) as GroupKnowledgeItem[];
  } catch {
    return [];
  }
}

export interface AdminUserInfo {
  zaloUserId: string;
  displayName: string;
  addedAt: number;
}

export function isUserAdmin(zaloUserId: string): boolean {
  try {
    const rawState = getBotState("admin_user_ids");
    if (!rawState) return false;
    const list = JSON.parse(rawState) as AdminUserInfo[];
    return list.some((u) => u.zaloUserId === zaloUserId);
  } catch {
    return false;
  }
}

export function addAdminUser(zaloUserId: string, displayName: string): void {
  try {
    const rawState = getBotState("admin_user_ids");
    const list: AdminUserInfo[] = rawState ? (JSON.parse(rawState) as AdminUserInfo[]) : [];
    if (!list.some((u) => u.zaloUserId === zaloUserId)) {
      list.push({ zaloUserId, displayName, addedAt: Date.now() });
      setBotState("admin_user_ids", JSON.stringify(list), Date.now());
      console.log(`[db] 👑 Đã cấp quyền Super Admin cho ${displayName} (${zaloUserId})`);
    }
  } catch (e) {
    console.warn(`[db] addAdminUser error: ${String(e)}`);
  }
}

export function getAdminUsers(): AdminUserInfo[] {
  try {
    const rawState = getBotState("admin_user_ids");
    return rawState ? (JSON.parse(rawState) as AdminUserInfo[]) : [];
  } catch {
    return [];
  }
}

// ---- QUẢN LÝ LỊCH HẸN & BÁO THỨC TỰ ĐỘNG (SCHEDULED REMINDERS) ----

export interface ScheduledReminder {
  id: number;
  threadId: string;
  isDirect: boolean;
  creatorId: string;
  creatorName: string;
  targetType: "sender" | "all";
  remindAt: number;
  content: string;
  status: "pending" | "completed" | "cancelled";
  createdAt: number;
}

/**
 * Tạo mới một lịch hẹn / báo thức tự động.
 */
export function createScheduledReminder(data: {
  threadId: string;
  isDirect?: boolean;
  creatorId: string;
  creatorName: string;
  targetType?: "sender" | "all";
  remindAt: number;
  content: string;
}): number {
  try {
    const result = getDb()
      .prepare(
        `INSERT INTO scheduled_reminders (thread_id, is_direct, creator_id, creator_name, target_type, remind_at, content, status, created_at)
         VALUES (@threadId, @isDirect, @creatorId, @creatorName, @targetType, @remindAt, @content, 'pending', @createdAt)`,
      )
      .run({
        threadId: data.threadId,
        isDirect: data.isDirect ? 1 : 0,
        creatorId: data.creatorId,
        creatorName: data.creatorName || "Bạn",
        targetType: data.targetType || "sender",
        remindAt: data.remindAt,
        content: data.content,
        createdAt: Date.now(),
      });
    return Number(result.lastInsertRowid);
  } catch (e) {
    console.error("[db] createScheduledReminder error:", e);
    return 0;
  }
}

/**
 * Lấy danh sách các lịch hẹn đang chờ đến hạn cần gửi.
 */
export function getPendingScheduledReminders(beforeTs?: number): ScheduledReminder[] {
  try {
    const cutoff = beforeTs || Date.now();
    const rows = getDb()
      .prepare(
        `SELECT id, thread_id as threadId, is_direct as isDirect, creator_id as creatorId,
                creator_name as creatorName, target_type as targetType, remind_at as remindAt,
                content, status, created_at as createdAt
         FROM scheduled_reminders
         WHERE status = 'pending' AND remind_at <= ?
         ORDER BY remind_at ASC`,
      )
      .all(cutoff) as any[];

    return rows.map((r) => ({
      id: r.id,
      threadId: r.threadId,
      isDirect: Boolean(r.isDirect),
      creatorId: r.creatorId,
      creatorName: r.creatorName,
      targetType: r.targetType || "sender",
      remindAt: r.remindAt,
      content: r.content,
      status: r.status,
      createdAt: r.createdAt,
    }));
  } catch (e) {
    console.error("[db] getPendingScheduledReminders error:", e);
    return [];
  }
}

/**
 * Đánh dấu lịch hẹn đã gửi thành công.
 */
export function markScheduledReminderCompleted(id: number): void {
  try {
    getDb().prepare(`UPDATE scheduled_reminders SET status = 'completed' WHERE id = ?`).run(id);
  } catch (e) {
    console.error("[db] markScheduledReminderCompleted error:", e);
  }
}

/**
 * Lấy danh sách lịch hẹn của một người dùng.
 */
export function getUserScheduledReminders(creatorId: string, limit = 10): ScheduledReminder[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, thread_id as threadId, is_direct as isDirect, creator_id as creatorId,
                creator_name as creatorName, target_type as targetType, remind_at as remindAt,
                content, status, created_at as createdAt
         FROM scheduled_reminders
         WHERE creator_id = ? AND status = 'pending'
         ORDER BY remind_at ASC
         LIMIT ?`,
      )
      .all(creatorId, limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      threadId: r.threadId,
      isDirect: Boolean(r.isDirect),
      creatorId: r.creatorId,
      creatorName: r.creatorName,
      targetType: r.targetType || "sender",
      remindAt: r.remindAt,
      content: r.content,
      status: r.status,
      createdAt: r.createdAt,
    }));
  } catch (e) {
    console.error("[db] getUserScheduledReminders error:", e);
    return [];
  }
}

/**
 * Hủy một lịch hẹn.
 */
export function cancelScheduledReminder(id: number, creatorId?: string): boolean {
  try {
    let result;
    if (creatorId) {
      result = getDb()
        .prepare(`UPDATE scheduled_reminders SET status = 'cancelled' WHERE id = ? AND creator_id = ? AND status = 'pending'`)
        .run(id, creatorId);
    } else {
      result = getDb()
        .prepare(`UPDATE scheduled_reminders SET status = 'cancelled' WHERE id = ? AND status = 'pending'`)
        .run(id);
    }
    return result.changes > 0;
  } catch (e) {
    console.error("[db] cancelScheduledReminder error:", e);
    return false;
  }
}





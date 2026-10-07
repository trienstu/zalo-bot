import { getDb } from "./index.js";

export interface ZaloMktContact {
  phone: string;
  zalo_uid?: string | null;
  zalo_name?: string;
  display_name?: string;
  gender?: number; // -1: unk, 0: female, 1: male
  dob?: number | null;
  sdob?: string;
  avatar?: string;
  bio?: string;
  status_code: "unverified" | "valid" | "no_zalo" | "blocked_stranger" | "invalid_phone";
  is_blacklisted?: number;
  total_sent?: number;
  last_sent_at?: number | null;
  last_checked_at?: number | null;
  ai_tags?: string[];
  ai_notes?: string;
  created_at?: number;
  updated_at?: number;
}

export interface ScheduleSlot {
  time: string; // "HH:mm" (ví dụ: "09:00", "13:30", "18:00")
  batchSize: number; // số lượng gửi tối đa mỗi ca
}

export interface ZaloMktCampaignConfig {
  minDelay?: number; // ms
  maxDelay?: number; // ms
  autoAlias?: boolean;
  autoFriend?: boolean;
  aiRewrite?: boolean;
  dailyLimit?: number;
  batchLimit?: number; // Số tin nhắn thành công tối đa cho lượt chạy này (0 hoặc undefined = không giới hạn)
  runSentCount?: number; // Số tin nhắn đã gửi thành công trong lượt chạy hiện tại
  scheduleSlots?: ScheduleSlot[]; // Hẹn giờ đa khung giờ trong ngày
  currentSlotTime?: string; // Mốc giờ của ca hiện tại đang chạy
}

export interface ZaloMktCampaign {
  id: string;
  title: string;
  raw_content: string;
  images_json: string; // JSON array of paths
  status: "draft" | "running" | "paused" | "completed" | "stopped" | "scheduled";
  config_json: string; // JSON of ZaloMktCampaignConfig
  scheduled_at?: number | null; // epoch ms hẹn giờ
  total_leads: number;
  sent_count: number;
  failed_count: number;
  not_found_count: number;
  skipped_count: number;
  created_at: number;
  updated_at: number;
}

export interface ZaloMktContactGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  created_at: number;
  updated_at: number;
  member_count?: number;
}

export interface ZaloMktLead {
  id: number;
  campaign_id: string;
  phone: string;
  custom_name: string;
  zalo_uid?: string | null;
  display_name: string;
  gender: number;
  avatar: string;
  status: "pending" | "searching" | "ready" | "sending" | "sent" | "failed" | "skipped";
  skip_reason: string;
  personalized_text: string;
  alias_updated: number;
  alias_name: string;
  friend_requested: number;
  error_message: string;
  sent_at?: number | null;
  created_at: number;
}

/**
 * Bảng tra cứu chuyển đổi đầu số 11 số sang 10 số theo quy hoạch Viễn thông Việt Nam
 */
export const OLD_PREFIX_11_TO_10: Record<string, string> = {
  // Viettel (0162 - 0169 -> 032 - 039)
  "0162": "032",
  "0163": "033",
  "0164": "034",
  "0165": "035",
  "0166": "036",
  "0167": "037",
  "0168": "038",
  "0169": "039",
  // MobiFone (0120, 0121, 0122, 0126, 0128 -> 070, 079, 077, 076, 078)
  "0120": "070",
  "0121": "079",
  "0122": "077",
  "0126": "076",
  "0128": "078",
  // VinaPhone (0123, 0124, 0125, 0127, 0129 -> 083, 084, 085, 081, 082)
  "0123": "083",
  "0124": "084",
  "0125": "085",
  "0127": "081",
  "0129": "082",
  // Vietnamobile (0186, 0188 -> 056, 058)
  "0186": "056",
  "0188": "058",
  // Gmobile (0199 -> 059)
  "0199": "059",
};

/** Chuẩn hóa số điện thoại: loại bỏ ký tự lạ, chuyển +84/84 về 0, chuyển 11 số cũ sang 10 số mới */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone) return "";
  let cleaned = rawPhone.replace(/[\s\-_.\(\)]/g, "").trim();
  if (cleaned.startsWith("+84")) {
    cleaned = "0" + cleaned.slice(3);
  } else if (cleaned.startsWith("84") && cleaned.length >= 11) {
    cleaned = "0" + cleaned.slice(2);
  }

  // Chuyển đổi từ 11 số sang 10 số nếu thuộc các đầu số cũ của Việt Nam
  if (cleaned.length === 11 && cleaned.startsWith("0")) {
    const prefix4 = cleaned.slice(0, 4);
    const newPrefix = OLD_PREFIX_11_TO_10[prefix4];
    if (newPrefix) {
      cleaned = newPrefix + cleaned.slice(4);
    }
  }

  return cleaned;
}

/** Kiểm tra SĐT Việt Nam hợp lệ sau khi chuẩn hóa */
export function isValidVietnamesePhone(phone: string): boolean {
  return /^0[235789]\d{8}$/.test(phone);
}

/**
 * Tự động bóc tách và chuẩn hóa danh sách số điện thoại từ văn bản:
 * - Hỗ trợ nhiều SĐT trên 1 dòng (ví dụ: "0908120591 - 09888123456", "0908120591, 09888123456")
 * - Tự động tách tên gợi ý nếu có (ví dụ: "0908120591 - Anh Nam")
 * - Chuyển toàn bộ 11 số cũ về 10 số chuẩn
 * - Khử trùng lặp (deduplicate)
 */
export function extractPhonesWithNamesFromText(rawText: string): Array<{ phone: string; customName: string }> {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const results: Array<{ phone: string; customName: string }> = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // 1. Kiểm tra định dạng phân tách rõ ràng (CSV/TSV): "0908120591, Nguyễn Văn A" hoặc "0908120591\tNguyễn Văn A"
    const delimiterMatch = line.match(/^([+0-9\s.\-_()]+)[,\t;|]+(.*)$/);
    if (delimiterMatch && delimiterMatch[1]) {
      const p1 = normalizePhoneNumber(delimiterMatch[1]);
      const namePart = (delimiterMatch[2] || "").trim();
      // Nếu phần đầu là 1 SĐT hợp lệ duy nhất
      if (isValidVietnamesePhone(p1)) {
        if (!seen.has(p1)) {
          seen.add(p1);
          results.push({ phone: p1, customName: namePart });
        }
        continue;
      }
    }

    // 2. Tìm tất cả các chuỗi giống số điện thoại trong dòng (hỗ trợ nhiều số: 0908120591 - 09888123456)
    const phoneRegex = /(?:\+84|84|0)(?:[\s\-_.]*\d){8,10}\b/g;
    const matches = line.match(phoneRegex);

    if (matches && matches.length > 0) {
      // Tìm tên nếu có (phần chữ còn lại sau khi bóc tách tất cả các số)
      let remainingText = line;
      for (const m of matches) {
        remainingText = remainingText.replace(m, " ");
      }
      const extractedName = remainingText.replace(/[\-–—/,;|()]/g, " ").replace(/\s+/g, " ").trim();

      for (const rawP of matches) {
        const norm = normalizePhoneNumber(rawP);
        if (isValidVietnamesePhone(norm) && !seen.has(norm)) {
          seen.add(norm);
          results.push({ phone: norm, customName: extractedName });
        }
      }
    }
  }

  return results;
}

/** Lấy thông tin contact trong kho data toàn cục */
export function getMktContact(phone: string): ZaloMktContact | null {
  const db = getDb();
  const normalized = normalizePhoneNumber(phone);
  const row = db.prepare(`SELECT * FROM zalomkt_contacts WHERE phone = ?`).get(normalized) as any;
  if (!row) return null;
  return {
    ...row,
    ai_tags: row.ai_tags ? JSON.parse(row.ai_tags) : [],
  };
}

/** Lưu hoặc cập nhật thông tin contact vào kho data toàn cục */
export function upsertMktContact(contact: Partial<ZaloMktContact> & { phone: string }): void {
  const db = getDb();
  const normalized = normalizePhoneNumber(contact.phone);
  const now = Date.now();
  const existing = getMktContact(normalized);

  if (existing) {
    db.prepare(`
      UPDATE zalomkt_contacts
      SET zalo_uid = COALESCE(?, zalo_uid),
          zalo_name = COALESCE(?, zalo_name),
          display_name = COALESCE(?, display_name),
          gender = CASE WHEN ? >= 0 THEN ? ELSE gender END,
          dob = COALESCE(?, dob),
          sdob = COALESCE(?, sdob),
          avatar = COALESCE(?, avatar),
          bio = COALESCE(?, bio),
          status_code = COALESCE(?, status_code),
          is_blacklisted = COALESCE(?, is_blacklisted),
          total_sent = total_sent + ?,
          last_sent_at = COALESCE(?, last_sent_at),
          last_checked_at = COALESCE(?, last_checked_at),
          ai_tags = COALESCE(?, ai_tags),
          ai_notes = COALESCE(?, ai_notes),
          updated_at = ?
      WHERE phone = ?
    `).run(
      contact.zalo_uid ?? null,
      contact.zalo_name ?? null,
      contact.display_name ?? null,
      contact.gender !== undefined ? contact.gender : -1,
      contact.gender !== undefined ? contact.gender : -1,
      contact.dob ?? null,
      contact.sdob ?? null,
      contact.avatar ?? null,
      contact.bio ?? null,
      contact.status_code ?? null,
      contact.is_blacklisted ?? null,
      contact.total_sent ? contact.total_sent : 0,
      contact.last_sent_at ?? null,
      contact.last_checked_at ?? null,
      contact.ai_tags ? JSON.stringify(contact.ai_tags) : null,
      contact.ai_notes ?? null,
      now,
      normalized,
    );
  } else {
    db.prepare(`
      INSERT INTO zalomkt_contacts (
        phone, zalo_uid, zalo_name, display_name, gender, dob, sdob, avatar, bio,
        status_code, is_blacklisted, total_sent, last_sent_at, last_checked_at,
        ai_tags, ai_notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalized,
      contact.zalo_uid || null,
      contact.zalo_name || "",
      contact.display_name || "",
      contact.gender !== undefined ? contact.gender : -1,
      contact.dob || null,
      contact.sdob || "",
      contact.avatar || "",
      contact.bio || "",
      contact.status_code || "unverified",
      contact.is_blacklisted || 0,
      contact.total_sent || 0,
      contact.last_sent_at || null,
      contact.last_checked_at || null,
      contact.ai_tags ? JSON.stringify(contact.ai_tags) : "[]",
      contact.ai_notes || "",
      now,
      now,
    );
  }
}

/** Lấy chiến dịch đang chạy */
export function getActiveRunningCampaign(): ZaloMktCampaign | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM zalomkt_campaigns WHERE status = 'running' ORDER BY updated_at ASC LIMIT 1`).get() as any;
  return row || null;
}

/** Lấy thông tin 1 chiến dịch */
export function getCampaignById(id: string): ZaloMktCampaign | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM zalomkt_campaigns WHERE id = ?`).get(id) as any;
  return row || null;
}

/** Cập nhật trạng thái chiến dịch */
export function updateCampaignStatus(id: string, status: ZaloMktCampaign["status"]): void {
  const db = getDb();
  db.prepare(`UPDATE zalomkt_campaigns SET status = ?, updated_at = ? WHERE id = ?`).run(status, Date.now(), id);
}

/** Cập nhật cấu hình chiến dịch (config_json) */
export function updateCampaignConfig(id: string, config: ZaloMktCampaignConfig): void {
  const db = getDb();
  db.prepare(`UPDATE zalomkt_campaigns SET config_json = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(config),
    Date.now(),
    id,
  );
}

/** Lấy lead tiếp theo cần xử lý trong chiến dịch */
export function getNextPendingLead(campaignId: string): ZaloMktLead | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM zalomkt_campaign_leads 
    WHERE campaign_id = ? AND status = 'pending' 
    ORDER BY id ASC LIMIT 1
  `).get(campaignId) as any;
  return row || null;
}

const ALLOWED_LEAD_FIELDS = new Set([
  "campaign_id",
  "phone",
  "custom_name",
  "zalo_uid",
  "display_name",
  "gender",
  "avatar",
  "status",
  "skip_reason",
  "personalized_text",
  "alias_updated",
  "alias_name",
  "friend_requested",
  "error_message",
  "sent_at",
]);

/** Cập nhật thông tin chi tiết của 1 lead */
export function updateLead(leadId: number, update: Partial<ZaloMktLead>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  for (const [k, v] of Object.entries(update)) {
    if (k === "id" || !ALLOWED_LEAD_FIELDS.has(k)) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;

  values.push(leadId);
  db.prepare(`UPDATE zalomkt_campaign_leads SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

/** Cập nhật bộ đếm thống kê cho chiến dịch */
export function recalculateCampaignCounts(campaignId: string): void {
  const db = getDb();
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
      SUM(CASE WHEN status = 'skipped' AND skip_reason LIKE '%không có Zalo%' THEN 1 ELSE 0 END) as not_found
    FROM zalomkt_campaign_leads
    WHERE campaign_id = ?
  `).get(campaignId) as any;

  db.prepare(`
    UPDATE zalomkt_campaigns
    SET total_leads = ?,
        sent_count = ?,
        failed_count = ?,
        skipped_count = ?,
        not_found_count = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    stats.total || 0,
    stats.sent || 0,
    stats.failed || 0,
    stats.skipped || 0,
    stats.not_found || 0,
    Date.now(),
    campaignId,
  );
}

/**
 * Kiểm tra và kích hoạt các chiến dịch hẹn giờ đến hạn chạy
 */
export function checkAndActivateScheduledCampaigns(): string[] {
  const db = getDb();
  const now = Date.now();
  const dueCampaigns = db.prepare(`
    SELECT id, title FROM zalomkt_campaigns
    WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
  `).all(now) as { id: string; title: string }[];

  if (dueCampaigns.length === 0) return [];

  const updateStmt = db.prepare(`UPDATE zalomkt_campaigns SET status = 'running', updated_at = ? WHERE id = ?`);
  const activatedIds: string[] = [];

  for (const camp of dueCampaigns) {
    updateStmt.run(now, camp.id);
    activatedIds.push(camp.id);
    console.log(`[zalomkt-db] ⏰ Tự động kích hoạt chiến dịch hẹn giờ [${camp.title}] (ID: ${camp.id})`);
  }

  return activatedIds;
}

/** Lấy danh sách nhóm khách hàng kèm số lượng thành viên */
export function listContactGroups(): ZaloMktContactGroup[] {
  const db = getDb();
  return db.prepare(`
    SELECT g.*, COUNT(m.phone) as member_count
    FROM zalomkt_contact_groups g
    LEFT JOIN zalomkt_contact_group_members m ON g.id = m.group_id
    GROUP BY g.id
    ORDER BY g.created_at DESC
  `).all() as ZaloMktContactGroup[];
}

/** Tạo nhóm khách hàng mới */
export function createContactGroup(name: string, description = "", color = "sky"): ZaloMktContactGroup {
  const db = getDb();
  const id = `grp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO zalomkt_contact_groups (id, name, description, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), description.trim(), color.trim(), now, now);

  return {
    id,
    name: name.trim(),
    description: description.trim(),
    color: color.trim(),
    created_at: now,
    updated_at: now,
    member_count: 0,
  };
}

/** Xóa nhóm khách hàng */
export function deleteContactGroup(id: string): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM zalomkt_contact_group_members WHERE group_id = ?`).run(id);
    db.prepare(`DELETE FROM zalomkt_contact_groups WHERE id = ?`).run(id);
  });
  transaction();
}

/** Thêm danh sách số điện thoại vào nhóm */
export function addPhonesToGroup(groupId: string, phones: string[]): { added: number; total: number } {
  const db = getDb();
  const now = Date.now();
  let added = 0;

  const insertMemberStmt = db.prepare(`
    INSERT OR IGNORE INTO zalomkt_contact_group_members (group_id, phone, added_at)
    VALUES (?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const raw of phones) {
      const p = normalizePhoneNumber(raw);
      if (!p || p.length < 9 || p.length > 12) continue;
      // Đảm bảo số có trong kho zalomkt_contacts
      upsertMktContact({ phone: p });
      const res = insertMemberStmt.run(groupId, p, now);
      if (res.changes > 0) added++;
    }
  });

  transaction();
  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM zalomkt_contact_group_members WHERE group_id = ?`).get(groupId) as any;
  return { added, total: totalRow?.count || 0 };
}

/** Xóa danh sách số điện thoại khỏi nhóm */
export function removePhonesFromGroup(groupId: string, phones: string[]): number {
  const db = getDb();
  let removed = 0;
  const deleteMemberStmt = db.prepare(`DELETE FROM zalomkt_contact_group_members WHERE group_id = ? AND phone = ?`);

  const transaction = db.transaction(() => {
    for (const raw of phones) {
      const p = normalizePhoneNumber(raw);
      const res = deleteMemberStmt.run(groupId, p);
      removed += res.changes;
    }
  });

  transaction();
  return removed;
}

/** Lấy toàn bộ số điện thoại thuộc các nhóm được chỉ định (hỗ trợ phân loại: tất cả, chưa từng gửi, chỉ số có Zalo) */
export function getPhonesByGroupIds(
  groupIds: string[],
  filterMode: "all" | "uncontacted" | "valid_only" = "all",
): string[] {
  if (groupIds.length === 0) return [];
  const db = getDb();
  const placeholders = groupIds.map(() => "?").join(", ");

  if (filterMode === "uncontacted") {
    // Chỉ lấy các số chưa từng được gửi thành công trong bất kỳ chiến dịch nào
    const rows = db.prepare(`
      SELECT DISTINCT m.phone
      FROM zalomkt_contact_group_members m
      LEFT JOIN zalomkt_contacts c ON m.phone = c.phone
      WHERE m.group_id IN (${placeholders})
        AND (c.total_sent IS NULL OR c.total_sent = 0)
        AND m.phone NOT IN (
          SELECT DISTINCT phone FROM zalomkt_campaign_leads WHERE status = 'sent'
        )
    `).all(...groupIds) as { phone: string }[];
    return rows.map((r) => r.phone);
  }

  if (filterMode === "valid_only") {
    // Chỉ lấy các số đã xác nhận có Zalo (valid)
    const rows = db.prepare(`
      SELECT DISTINCT m.phone
      FROM zalomkt_contact_group_members m
      JOIN zalomkt_contacts c ON m.phone = c.phone
      WHERE m.group_id IN (${placeholders})
        AND c.status_code = 'valid'
    `).all(...groupIds) as { phone: string }[];
    return rows.map((r) => r.phone);
  }

  const rows = db.prepare(`
    SELECT DISTINCT phone FROM zalomkt_contact_group_members
    WHERE group_id IN (${placeholders})
  `).all(...groupIds) as { phone: string }[];
  return rows.map((r) => r.phone);
}

/**
 * Tính timestamp hẹn giờ tiếp theo dựa trên danh sách ca chạy (scheduleSlots)
 * Ví dụ slots: [{ time: "09:00", batchSize: 50 }, { time: "13:00", batchSize: 50 }, { time: "18:00", batchSize: 50 }]
 */
export function calculateNextSlotSchedule(
  slots: ScheduleSlot[],
  referenceDate = new Date(),
): { nextSlot: ScheduleSlot; nextScheduledAt: number } | null {
  if (!slots || slots.length === 0) return null;

  // Sắp xếp các slot theo thứ tự thời gian tăng dần trong ngày
  const sortedSlots = [...slots].sort((a, b) => a.time.localeCompare(b.time));

  const currentHour = referenceDate.getHours();
  const currentMinute = referenceDate.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  // 1. Tìm slot đầu tiên trong ngày hôm nay có mốc giờ lớn hơn giờ hiện tại (ít nhất 1 phút)
  for (const slot of sortedSlots) {
    const parts = slot.time.split(":");
    const h = parseInt(parts[0] || "0", 10);
    const m = parseInt(parts[1] || "0", 10);
    if (isNaN(h) || isNaN(m)) continue;
    const slotTotalMinutes = h * 60 + m;

    if (slotTotalMinutes > currentTotalMinutes) {
      const targetDate = new Date(referenceDate);
      targetDate.setHours(h, m, 0, 0);
      return { nextSlot: slot, nextScheduledAt: targetDate.getTime() };
    }
  }

  // 2. Nếu đã qua hết các ca hôm nay -> Lấy ca sớm nhất của ngày mai
  const firstSlot = sortedSlots[0];
  if (!firstSlot) return null;
  const parts = firstSlot.time.split(":");
  const h = parseInt(parts[0] || "0", 10) || 0;
  const m = parseInt(parts[1] || "0", 10) || 0;

  const tomorrow = new Date(referenceDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(h, m, 0, 0);

  return { nextSlot: firstSlot, nextScheduledAt: tomorrow.getTime() };
}

export interface ZaloMktVerifyTask {
  id: string;
  status: "running" | "completed" | "stopped";
  total_phones: number;
  checked_count: number;
  valid_count: number;
  no_zalo_count: number;
  error_count: number;
  target_group_id: string;
  created_at: number;
  updated_at: number;
}

/** Đảm bảo bảng zalomkt_verify_tasks tồn tại */
export function ensureVerifyTaskTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS zalomkt_verify_tasks (
      id              TEXT PRIMARY KEY,
      status          TEXT NOT NULL DEFAULT 'running',
      total_phones    INTEGER NOT NULL DEFAULT 0,
      checked_count   INTEGER NOT NULL DEFAULT 0,
      valid_count     INTEGER NOT NULL DEFAULT 0,
      no_zalo_count   INTEGER NOT NULL DEFAULT 0,
      error_count     INTEGER NOT NULL DEFAULT 0,
      target_group_id TEXT NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    )
  `);
}

/** Tạo tác vụ quét kiểm tra SĐT Zalo mới */
export function createVerifyTask(totalPhones: number, targetGroupId = ""): ZaloMktVerifyTask {
  ensureVerifyTaskTable();
  const db = getDb();
  const id = `vtask_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = Date.now();

  // Dừng bất kỳ task cũ nào còn đang running
  db.prepare(`UPDATE zalomkt_verify_tasks SET status = 'stopped', updated_at = ? WHERE status = 'running'`).run(now);

  db.prepare(`
    INSERT INTO zalomkt_verify_tasks (
      id, status, total_phones, checked_count, valid_count, no_zalo_count, error_count, target_group_id, created_at, updated_at
    ) VALUES (?, 'running', ?, 0, 0, 0, 0, ?, ?, ?)
  `).run(id, totalPhones, targetGroupId, now, now);

  return {
    id,
    status: "running",
    total_phones: totalPhones,
    checked_count: 0,
    valid_count: 0,
    no_zalo_count: 0,
    error_count: 0,
    target_group_id: targetGroupId,
    created_at: now,
    updated_at: now,
  };
}

/** Lấy tác vụ xác minh đang chạy */
export function getActiveVerifyTask(): ZaloMktVerifyTask | null {
  ensureVerifyTaskTable();
  const db = getDb();
  const row = db.prepare(`SELECT * FROM zalomkt_verify_tasks WHERE status = 'running' ORDER BY created_at DESC LIMIT 1`).get() as any;
  return row || null;
}

/** Lấy tác vụ xác minh gần nhất */
export function getLatestVerifyTask(): ZaloMktVerifyTask | null {
  ensureVerifyTaskTable();
  const db = getDb();
  const row = db.prepare(`SELECT * FROM zalomkt_verify_tasks ORDER BY created_at DESC LIMIT 1`).get() as any;
  return row || null;
}

/** Cập nhật tiến độ tác vụ xác minh */
export function updateVerifyTask(
  id: string,
  update: Partial<ZaloMktVerifyTask>,
): void {
  ensureVerifyTaskTable();
  const db = getDb();
  const fields: string[] = ["updated_at = ?"];
  const values: any[] = [Date.now()];

  if (typeof update.status === "string") {
    fields.push("status = ?");
    values.push(update.status);
  }
  if (typeof update.checked_count === "number") {
    fields.push("checked_count = ?");
    values.push(update.checked_count);
  }
  if (typeof update.valid_count === "number") {
    fields.push("valid_count = ?");
    values.push(update.valid_count);
  }
  if (typeof update.no_zalo_count === "number") {
    fields.push("no_zalo_count = ?");
    values.push(update.no_zalo_count);
  }
  if (typeof update.error_count === "number") {
    fields.push("error_count = ?");
    values.push(update.error_count);
  }

  values.push(id);
  db.prepare(`UPDATE zalomkt_verify_tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

/** Lấy danh sách SĐT cần xác minh (chưa có kết quả hoặc unverified) */
export function getUnverifiedContacts(limit = 100, groupId = ""): string[] {
  const db = getDb();
  if (groupId && groupId !== "all") {
    const rows = db.prepare(`
      SELECT m.phone FROM zalomkt_contact_group_members m
      JOIN zalomkt_contacts c ON m.phone = c.phone
      WHERE m.group_id = ? AND c.status_code = 'unverified'
      LIMIT ?
    `).all(groupId, limit) as { phone: string }[];
    return rows.map((r) => r.phone);
  }

  const rows = db.prepare(`
    SELECT phone FROM zalomkt_contacts
    WHERE status_code = 'unverified'
    LIMIT ?
  `).all(limit) as { phone: string }[];
  return rows.map((r) => r.phone);
}



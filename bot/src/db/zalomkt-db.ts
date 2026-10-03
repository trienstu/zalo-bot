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

export interface ZaloMktCampaignConfig {
  minDelay?: number; // ms
  maxDelay?: number; // ms
  autoAlias?: boolean;
  autoFriend?: boolean;
  aiRewrite?: boolean;
  dailyLimit?: number;
  batchLimit?: number; // Số tin nhắn thành công tối đa cho lượt chạy này (0 hoặc undefined = không giới hạn)
  runSentCount?: number; // Số tin nhắn đã gửi thành công trong lượt chạy hiện tại
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

/** Chuẩn hóa số điện thoại: loại bỏ khoảng trắng, dấu gạch nối, dấu chấm, chuyển +84 hoặc 84 về 0 */
export function normalizePhoneNumber(rawPhone: string): string {
  let cleaned = rawPhone.replace(/[\s\-_.\(\)]/g, "").trim();
  if (cleaned.startsWith("+84")) {
    cleaned = "0" + cleaned.slice(3);
  } else if (cleaned.startsWith("84") && cleaned.length >= 11) {
    cleaned = "0" + cleaned.slice(2);
  }
  return cleaned;
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

/** Lấy toàn bộ số điện thoại thuộc các nhóm được chỉ định (đã deduplicate) */
export function getPhonesByGroupIds(groupIds: string[]): string[] {
  if (groupIds.length === 0) return [];
  const db = getDb();
  const placeholders = groupIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT DISTINCT phone FROM zalomkt_contact_group_members
    WHERE group_id IN (${placeholders})
  `).all(...groupIds) as { phone: string }[];
  return rows.map((r) => r.phone);
}


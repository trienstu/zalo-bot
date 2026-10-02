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
}

export interface ZaloMktCampaign {
  id: string;
  title: string;
  raw_content: string;
  images_json: string; // JSON array of paths
  status: "draft" | "running" | "paused" | "completed" | "stopped";
  config_json: string; // JSON of ZaloMktCampaignConfig
  total_leads: number;
  sent_count: number;
  failed_count: number;
  not_found_count: number;
  skipped_count: number;
  created_at: number;
  updated_at: number;
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

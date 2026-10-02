import { getDb } from "./db";

export interface ZaloMktContact {
  phone: string;
  zalo_uid?: string | null;
  zalo_name: string;
  display_name: string;
  gender: number;
  dob?: number | null;
  sdob: string;
  avatar: string;
  bio: string;
  status_code: "unverified" | "valid" | "no_zalo" | "blocked_stranger" | "invalid_phone";
  is_blacklisted: number;
  total_sent: number;
  last_sent_at?: number | null;
  last_checked_at?: number | null;
  ai_tags: string[];
  ai_notes: string;
  created_at: number;
  updated_at: number;
}

export interface ZaloMktCampaign {
  id: string;
  title: string;
  raw_content: string;
  images_json: string;
  status: "draft" | "running" | "paused" | "completed" | "stopped";
  config_json: string;
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

export function normalizePhoneNumber(rawPhone: string): string {
  let cleaned = rawPhone.replace(/[\s\-_.\(\)]/g, "").trim();
  if (cleaned.startsWith("+84")) {
    cleaned = "0" + cleaned.slice(3);
  } else if (cleaned.startsWith("84") && cleaned.length >= 11) {
    cleaned = "0" + cleaned.slice(2);
  }
  return cleaned;
}

/** Lấy danh sách chiến dịch */
export function listMktCampaigns(botId = "bot-1"): ZaloMktCampaign[] {
  const db = getDb(botId);
  return db.prepare(`SELECT * FROM zalomkt_campaigns ORDER BY created_at DESC`).all() as ZaloMktCampaign[];
}

/** Lấy thông tin 1 chiến dịch */
export function getMktCampaign(id: string, botId = "bot-1"): ZaloMktCampaign | null {
  const db = getDb(botId);
  const row = db.prepare(`SELECT * FROM zalomkt_campaigns WHERE id = ?`).get(id) as ZaloMktCampaign | undefined;
  return row || null;
}

/** Tạo chiến dịch mới */
export function createMktCampaign(
  params: {
    title: string;
    rawContent: string;
    images?: string[];
    config?: Record<string, any>;
    rawPhones: string; // mỗi dòng 1 số (hoặc SĐT, Tên)
  },
  botId = "bot-1",
): { id: string; totalLeads: number; skippedLeads: number } {
  const db = getDb(botId);
  const campaignId = `camp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();

  const lines = params.rawPhones
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const seenPhones = new Set<string>();
  const parsedLeads: { phone: string; customName: string }[] = [];

  for (const line of lines) {
    // Hỗ trợ định dạng: "0912345678" hoặc "0912345678, Nguyễn Văn A" hoặc "0912345678\tNguyễn Văn A"
    const parts = line.split(/[,\t;|]+/).map((s) => s.trim());
    const rawP = parts[0] || "";
    const name = parts[1] || "";
    const cleanPhone = normalizePhoneNumber(rawP);

    if (cleanPhone && cleanPhone.length >= 9 && cleanPhone.length <= 12 && !seenPhones.has(cleanPhone)) {
      seenPhones.add(cleanPhone);
      parsedLeads.push({ phone: cleanPhone, customName: name });
    }
  }

  // Pre-flight filter: Đối chiếu tức thì với Kho Data Toàn Cục
  let skippedCount = 0;
  const insertLeadStmt = db.prepare(`
    INSERT INTO zalomkt_campaign_leads (
      campaign_id, phone, custom_name, zalo_uid, display_name, gender, avatar,
      status, skip_reason, personalized_text, alias_updated, friend_requested,
      error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getContactStmt = db.prepare(`SELECT * FROM zalomkt_contacts WHERE phone = ?`);

  const transaction = db.transaction(() => {
    // 1. Tạo bản ghi chiến dịch
    db.prepare(`
      INSERT INTO zalomkt_campaigns (
        id, title, raw_content, images_json, status, config_json,
        total_leads, sent_count, failed_count, not_found_count, skipped_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, ?, 0, 0, 0, 0, ?, ?)
    `).run(
      campaignId,
      params.title.trim(),
      params.rawContent.trim(),
      JSON.stringify(params.images || []),
      JSON.stringify(params.config || {}),
      parsedLeads.length,
      now,
      now,
    );

    // 2. Chèn từng lead và gán cờ lọc trước nếu đã biết số chết/chặn
    for (const item of parsedLeads) {
      const contact = getContactStmt.get(item.phone) as any;
      let status = "pending";
      let skipReason = "";
      let uid = null;
      let displayName = item.customName;
      let gender = -1;
      let avatar = "";

      if (contact) {
        if (contact.is_blacklisted) {
          status = "skipped";
          skipReason = "Nằm trong danh sách đen (Blacklist)";
          skippedCount++;
        } else if (contact.status_code === "no_zalo") {
          status = "skipped";
          skipReason = "Số không có Zalo (đã ghi nhận từ trước)";
          skippedCount++;
        } else if (contact.status_code === "blocked_stranger") {
          status = "skipped";
          skipReason = "Chặn tin nhắn người lạ (đã ghi nhận từ trước)";
          skippedCount++;
        } else if (contact.status_code === "valid") {
          uid = contact.zalo_uid;
          displayName = displayName || contact.display_name || contact.zalo_name;
          gender = contact.gender ?? -1;
          avatar = contact.avatar || "";
        }
      }

      insertLeadStmt.run(
        campaignId,
        item.phone,
        item.customName,
        uid,
        displayName,
        gender,
        avatar,
        status,
        skipReason,
        "",
        0,
        0,
        "",
        now,
      );
    }

    // 3. Cập nhật lại số lượng skipped ban đầu
    db.prepare(`UPDATE zalomkt_campaigns SET skipped_count = ? WHERE id = ?`).run(skippedCount, campaignId);
  });

  transaction();

  return {
    id: campaignId,
    totalLeads: parsedLeads.length,
    skippedLeads: skippedCount,
  };
}

/** Điều khiển chiến dịch: start, pause, resume, stop */
export function controlMktCampaign(
  id: string,
  action: "start" | "pause" | "resume" | "stop",
  botId = "bot-1",
): boolean {
  const db = getDb(botId);
  let newStatus: ZaloMktCampaign["status"] = "draft";
  if (action === "start" || action === "resume") newStatus = "running";
  else if (action === "pause") newStatus = "paused";
  else if (action === "stop") newStatus = "stopped";

  const res = db.prepare(`UPDATE zalomkt_campaigns SET status = ?, updated_at = ? WHERE id = ?`).run(
    newStatus,
    Date.now(),
    id,
  );
  return res.changes > 0;
}

/** Xóa chiến dịch */
export function deleteMktCampaign(id: string, botId = "bot-1"): boolean {
  const db = getDb(botId);
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM zalomkt_campaign_leads WHERE campaign_id = ?`).run(id);
    db.prepare(`DELETE FROM zalomkt_campaigns WHERE id = ?`).run(id);
  });
  transaction();
  return true;
}

/** Lấy danh sách leads của 1 chiến dịch */
export function getCampaignLeads(
  campaignId: string,
  filter?: { status?: string; page?: number; limit?: number },
  botId = "bot-1",
): { leads: ZaloMktLead[]; total: number } {
  const db = getDb(botId);
  const page = Math.max(1, filter?.page || 1);
  const limit = Math.min(100, Math.max(10, filter?.limit || 50));
  const offset = (page - 1) * limit;

  let where = "WHERE campaign_id = ?";
  const params: any[] = [campaignId];

  if (filter?.status && filter.status !== "all") {
    where += " AND status = ?";
    params.push(filter.status);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM zalomkt_campaign_leads ${where}`).get(...params) as any;
  const total = countRow?.total || 0;

  const rows = db.prepare(`
    SELECT * FROM zalomkt_campaign_leads 
    ${where}
    ORDER BY id ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as ZaloMktLead[];

  return { leads: rows, total };
}

/** Lấy danh sách contacts trong Kho Data Toàn Cục */
export function listMktContacts(
  params?: { search?: string; status?: string; page?: number; limit?: number },
  botId = "bot-1",
): { contacts: ZaloMktContact[]; total: number } {
  const db = getDb(botId);
  const page = Math.max(1, params?.page || 1);
  const limit = Math.min(100, Math.max(10, params?.limit || 50));
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const queryParams: any[] = [];

  if (params?.search?.trim()) {
    const s = `%${params.search.trim()}%`;
    where += " AND (phone LIKE ? OR display_name LIKE ? OR zalo_name LIKE ?)";
    queryParams.push(s, s, s);
  }

  if (params?.status && params.status !== "all") {
    where += " AND status_code = ?";
    queryParams.push(params.status);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM zalomkt_contacts ${where}`).get(...queryParams) as any;
  const total = countRow?.total || 0;

  const rows = db.prepare(`
    SELECT * FROM zalomkt_contacts
    ${where}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams, limit, offset) as any[];

  const contacts: ZaloMktContact[] = rows.map((r) => ({
    ...r,
    ai_tags: r.ai_tags ? JSON.parse(r.ai_tags) : [],
  }));

  return { contacts, total };
}

/** Nạp danh sách SĐT vào Kho Data Toàn Cục để lưu trữ và quản lý */
export function importMktContacts(
  rawPhones: string[],
  botId = "bot-1",
): { imported: number; updated: number } {
  const db = getDb(botId);
  const now = Date.now();
  let imported = 0;
  let updated = 0;

  const checkStmt = db.prepare(`SELECT phone FROM zalomkt_contacts WHERE phone = ?`);
  const insertStmt = db.prepare(`
    INSERT INTO zalomkt_contacts (
      phone, status_code, created_at, updated_at
    ) VALUES (?, 'unverified', ?, ?)
  `);

  const transaction = db.transaction(() => {
    const updateStmt = db.prepare(`UPDATE zalomkt_contacts SET updated_at = ? WHERE phone = ?`);
    for (const raw of rawPhones) {
      const p = normalizePhoneNumber(raw);
      if (!p || p.length < 9 || p.length > 12) continue;

      const exists = checkStmt.get(p);
      if (exists) {
        updateStmt.run(now, p);
        updated++;
      } else {
        insertStmt.run(p, now, now);
        imported++;
      }
    }
  });

  transaction();
  return { imported, updated };
}

/** Thống kê tổng quan Kho Data Marketing */
export function getMktStats(botId = "bot-1"): {
  totalContacts: number;
  validContacts: number;
  noZaloContacts: number;
  blockedStrangerContacts: number;
  totalCampaigns: number;
  runningCampaigns: number;
  totalSentMessages: number;
} {
  const db = getDb(botId);

  const contactStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status_code = 'valid' THEN 1 ELSE 0 END) as valid,
      SUM(CASE WHEN status_code = 'no_zalo' THEN 1 ELSE 0 END) as no_zalo,
      SUM(CASE WHEN status_code = 'blocked_stranger' THEN 1 ELSE 0 END) as blocked_stranger,
      SUM(total_sent) as sent_total
    FROM zalomkt_contacts
  `).get() as any;

  const campStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(sent_count) as sent_total
    FROM zalomkt_campaigns
  `).get() as any;

  return {
    totalContacts: contactStats?.total || 0,
    validContacts: contactStats?.valid || 0,
    noZaloContacts: contactStats?.no_zalo || 0,
    blockedStrangerContacts: contactStats?.blocked_stranger || 0,
    totalCampaigns: campStats?.total || 0,
    runningCampaigns: campStats?.running || 0,
    totalSentMessages: (contactStats?.sent_total || 0) + (campStats?.sent_total || 0),
  };
}

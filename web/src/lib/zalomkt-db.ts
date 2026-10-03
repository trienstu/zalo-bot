import { getDb } from "./db";

export interface ZaloMktContact {
  phone: string;
  zalo_uid?: string | null;
  zalo_name: string;
  display_name: string;
  gender: number; // -1/2: unk, 0: male (Nam), 1: female (Nữ)
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

export interface ZaloMktCampaignConfig {
  minDelay?: number; // ms
  maxDelay?: number; // ms
  autoAlias?: boolean;
  autoFriend?: boolean;
  aiRewrite?: boolean;
  dailyLimit?: number;
  batchLimit?: number; // Số tin nhắn thành công tối đa cho lượt chạy này (0 hoặc undefined: không giới hạn)
  runSentCount?: number; // Số tin nhắn đã gửi thành công trong lượt chạy hiện tại
}

export interface ZaloMktCampaign {
  id: string;
  title: string;
  raw_content: string;
  images_json: string;
  status: "draft" | "running" | "paused" | "completed" | "stopped" | "scheduled";
  config_json: string;
  scheduled_at?: number | null;
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

/** Tạo chiến dịch mới (hỗ trợ nhập số trực tiếp, nạp từ nhóm, hẹn giờ và lưu nháp) */
export function createMktCampaign(
  params: {
    title: string;
    rawContent: string;
    images?: string[];
    config?: Record<string, any>;
    rawPhones?: string; // mỗi dòng 1 số (hoặc SĐT, Tên)
    groupIds?: string[]; // danh sách id nhóm khách hàng
    scheduledAt?: number | null; // epoch ms hẹn giờ
    isDraft?: boolean;
  },
  botId = "bot-1",
): { id: string; totalLeads: number; skippedLeads: number } {
  const db = getDb(botId);
  const campaignId = `camp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();

  const seenPhones = new Set<string>();
  const parsedLeads: { phone: string; customName: string }[] = [];

  // 1. Phân tích danh sách số nhập tay / paste
  if (params.rawPhones) {
    const lines = params.rawPhones
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const parts = line.split(/[,\t;|]+/).map((s) => s.trim());
      const rawP = parts[0] || "";
      const name = parts[1] || "";
      const cleanPhone = normalizePhoneNumber(rawP);

      if (cleanPhone && cleanPhone.length >= 9 && cleanPhone.length <= 12 && !seenPhones.has(cleanPhone)) {
        seenPhones.add(cleanPhone);
        parsedLeads.push({ phone: cleanPhone, customName: name });
      }
    }
  }

  // 2. Nạp số từ các Nhóm Khách Hàng được chọn (nếu có)
  if (params.groupIds && params.groupIds.length > 0) {
    const groupPhones = getPhonesByGroupIds(params.groupIds, botId);
    for (const p of groupPhones) {
      const cleanPhone = normalizePhoneNumber(p);
      if (cleanPhone && cleanPhone.length >= 9 && cleanPhone.length <= 12 && !seenPhones.has(cleanPhone)) {
        seenPhones.add(cleanPhone);
        parsedLeads.push({ phone: cleanPhone, customName: "" });
      }
    }
  }

  // 3. Xác định trạng thái ban đầu của chiến dịch
  let initialStatus: ZaloMktCampaign["status"] = "draft";
  const scheduledTime = typeof params.scheduledAt === "number" && params.scheduledAt > now ? params.scheduledAt : null;

  if (scheduledTime) {
    initialStatus = "scheduled";
  } else if (params.isDraft) {
    initialStatus = "draft";
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
        id, title, raw_content, images_json, status, config_json, scheduled_at,
        total_leads, sent_count, failed_count, not_found_count, skipped_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
    `).run(
      campaignId,
      params.title.trim(),
      params.rawContent.trim(),
      JSON.stringify(params.images || []),
      initialStatus,
      JSON.stringify(params.config || {}),
      scheduledTime,
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
  batchLimit?: number,
): boolean {
  const db = getDb(botId);
  let newStatus: ZaloMktCampaign["status"] = "draft";
  if (action === "start" || action === "resume") newStatus = "running";
  else if (action === "pause") newStatus = "paused";
  else if (action === "stop") newStatus = "stopped";

  // Khi start hoặc resume: nếu có chỉ định batchLimit (hoặc cập nhật lượt chạy mới), cập nhật config_json
  if (action === "start" || action === "resume") {
    const camp = db.prepare(`SELECT config_json FROM zalomkt_campaigns WHERE id = ?`).get(id) as any;
    if (camp) {
      let config: ZaloMktCampaignConfig = {};
      try {
        config = JSON.parse(camp.config_json || "{}");
      } catch {}

      if (typeof batchLimit === "number") {
        config.batchLimit = Math.max(0, batchLimit);
      }
      config.runSentCount = 0; // Luôn reset bộ đếm gửi thành công của lượt chạy mới này về 0

      const res = db.prepare(`UPDATE zalomkt_campaigns SET status = ?, config_json = ?, updated_at = ? WHERE id = ?`).run(
        newStatus,
        JSON.stringify(config),
        Date.now(),
        id,
      );
      return res.changes > 0;
    }
  }

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
  params?: { search?: string; status?: string; groupId?: string; page?: number; limit?: number },
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

  if (params?.groupId && params.groupId !== "all") {
    where += " AND phone IN (SELECT phone FROM zalomkt_contact_group_members WHERE group_id = ?)";
    queryParams.push(params.groupId);
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

/** Lấy danh sách nhóm khách hàng kèm số lượng thành viên */
export function listContactGroups(botId = "bot-1"): ZaloMktContactGroup[] {
  const db = getDb(botId);
  return db.prepare(`
    SELECT g.*, COUNT(m.phone) as member_count
    FROM zalomkt_contact_groups g
    LEFT JOIN zalomkt_contact_group_members m ON g.id = m.group_id
    GROUP BY g.id
    ORDER BY g.created_at DESC
  `).all() as ZaloMktContactGroup[];
}

/** Tạo nhóm khách hàng mới */
export function createContactGroup(
  name: string,
  description = "",
  color = "sky",
  botId = "bot-1",
): ZaloMktContactGroup {
  const db = getDb(botId);
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
export function deleteContactGroup(id: string, botId = "bot-1"): void {
  const db = getDb(botId);
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM zalomkt_contact_group_members WHERE group_id = ?`).run(id);
    db.prepare(`DELETE FROM zalomkt_contact_groups WHERE id = ?`).run(id);
  });
  transaction();
}

/** Thêm danh sách số điện thoại vào nhóm */
export function addPhonesToGroup(
  groupId: string,
  phones: string[],
  botId = "bot-1",
): { added: number; total: number } {
  const db = getDb(botId);
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
      const exists = db.prepare(`SELECT phone FROM zalomkt_contacts WHERE phone = ?`).get(p);
      if (!exists) {
        db.prepare(
          `INSERT INTO zalomkt_contacts (phone, status_code, created_at, updated_at) VALUES (?, 'unverified', ?, ?)`,
        ).run(p, now, now);
      }
      const res = insertMemberStmt.run(groupId, p, now);
      if (res.changes > 0) added++;
    }
  });

  transaction();
  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM zalomkt_contact_group_members WHERE group_id = ?`)
    .get(groupId) as any;
  return { added, total: totalRow?.count || 0 };
}

/** Xóa danh sách số điện thoại khỏi nhóm */
export function removePhonesFromGroup(
  groupId: string,
  phones: string[],
  botId = "bot-1",
): number {
  const db = getDb(botId);
  let removed = 0;
  const deleteMemberStmt = db.prepare(
    `DELETE FROM zalomkt_contact_group_members WHERE group_id = ? AND phone = ?`,
  );

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
export function getPhonesByGroupIds(groupIds: string[], botId = "bot-1"): string[] {
  if (groupIds.length === 0) return [];
  const db = getDb(botId);
  const placeholders = groupIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT DISTINCT phone FROM zalomkt_contact_group_members WHERE group_id IN (${placeholders})`,
    )
    .all(...groupIds) as { phone: string }[];
  return rows.map((r) => r.phone);
}


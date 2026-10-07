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
    if (delimiterMatch) {
      const p1 = normalizePhoneNumber(delimiterMatch[1]);
      const namePart = delimiterMatch[2].trim();
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
    rawPhones?: string; // mỗi dòng 1 số hoặc nhiều số kèm tên
    groupIds?: string[]; // danh sách id nhóm khách hàng
    groupFilterMode?: "all" | "uncontacted" | "valid_only"; // bộ lọc nhóm
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

  // 1. Phân tích danh sách số nhập tay / paste (Tự động bóc tách đa số, 11->10 số và tên)
  if (params.rawPhones) {
    const extracted = extractPhonesWithNamesFromText(params.rawPhones);
    for (const item of extracted) {
      if (!seenPhones.has(item.phone)) {
        seenPhones.add(item.phone);
        parsedLeads.push(item);
      }
    }
  }

  // 2. Nạp số từ các Nhóm Khách Hàng được chọn (hỗ trợ bộ lọc chưa gửi / valid)
  if (params.groupIds && params.groupIds.length > 0) {
    const groupPhones = getPhonesByGroupIds(params.groupIds, params.groupFilterMode || "all", botId);
    for (const p of groupPhones) {
      const cleanPhone = normalizePhoneNumber(p);
      if (cleanPhone && isValidVietnamesePhone(cleanPhone) && !seenPhones.has(cleanPhone)) {
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
  rawPhones: string[] | string,
  botId = "bot-1",
): { imported: number; updated: number } {
  const db = getDb(botId);
  const now = Date.now();
  let imported = 0;
  let updated = 0;

  const rawText = Array.isArray(rawPhones) ? rawPhones.join("\n") : rawPhones;
  const extracted = extractPhonesWithNamesFromText(rawText);

  const checkStmt = db.prepare(`SELECT phone, display_name FROM zalomkt_contacts WHERE phone = ?`);
  const insertStmt = db.prepare(`
    INSERT INTO zalomkt_contacts (
      phone, display_name, status_code, created_at, updated_at
    ) VALUES (?, ?, 'unverified', ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE zalomkt_contacts 
    SET updated_at = ?,
        display_name = CASE WHEN display_name = '' AND ? != '' THEN ? ELSE display_name END
    WHERE phone = ?
  `);

  const transaction = db.transaction(() => {
    for (const item of extracted) {
      const p = item.phone;
      if (!isValidVietnamesePhone(p)) continue;

      const exists = checkStmt.get(p) as any;
      if (exists) {
        updateStmt.run(now, item.customName || "", item.customName || "", p);
        updated++;
      } else {
        insertStmt.run(p, item.customName || "", now, now);
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

/** Lấy toàn bộ số điện thoại thuộc các nhóm được chỉ định (hỗ trợ phân loại: tất cả, chưa từng gửi, chỉ số có Zalo) */
export function getPhonesByGroupIds(
  groupIds: string[],
  filterMode: "all" | "uncontacted" | "valid_only" = "all",
  botId = "bot-1",
): string[] {
  if (groupIds.length === 0) return [];
  const db = getDb(botId);
  const placeholders = groupIds.map(() => "?").join(", ");

  if (filterMode === "uncontacted") {
    const rows = db
      .prepare(`
        SELECT DISTINCT m.phone
        FROM zalomkt_contact_group_members m
        LEFT JOIN zalomkt_contacts c ON m.phone = c.phone
        WHERE m.group_id IN (${placeholders})
          AND (c.total_sent IS NULL OR c.total_sent = 0)
          AND m.phone NOT IN (
            SELECT DISTINCT phone FROM zalomkt_campaign_leads WHERE status = 'sent'
          )
      `)
      .all(...groupIds) as { phone: string }[];
    return rows.map((r) => r.phone);
  }

  if (filterMode === "valid_only") {
    const rows = db
      .prepare(`
        SELECT DISTINCT m.phone
        FROM zalomkt_contact_group_members m
        JOIN zalomkt_contacts c ON m.phone = c.phone
        WHERE m.group_id IN (${placeholders})
          AND c.status_code = 'valid'
      `)
      .all(...groupIds) as { phone: string }[];
    return rows.map((r) => r.phone);
  }

  const rows = db
    .prepare(
      `SELECT DISTINCT phone FROM zalomkt_contact_group_members WHERE group_id IN (${placeholders})`,
    )
    .all(...groupIds) as { phone: string }[];
  return rows.map((r) => r.phone);
}

/** Nhân bản / Sao chép chiến dịch Marketing (hỗ trợ sao chép kèm leads hoặc tạo draft mới) */
export function copyMktCampaign(
  campaignId: string,
  options?: {
    newTitle?: string;
    copyLeads?: boolean;
  },
  botId = "bot-1",
): { id: string; totalLeads: number } {
  const db = getDb(botId);
  const original = getMktCampaign(campaignId, botId);
  if (!original) {
    throw new Error("Không tìm thấy chiến dịch gốc để nhân bản");
  }

  const newId = `camp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();
  const newTitle = options?.newTitle?.trim() || `${original.title} (Bản sao)`;
  const copyLeads = options?.copyLeads ?? false;

  let totalLeads = 0;

  const transaction = db.transaction(() => {
    // 1. Tạo campaign mới ở trạng thái draft
    db.prepare(`
      INSERT INTO zalomkt_campaigns (
        id, title, raw_content, images_json, status, config_json,
        scheduled_at, total_leads, sent_count, failed_count, not_found_count, skipped_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, NULL, 0, 0, 0, 0, 0, ?, ?)
    `).run(
      newId,
      newTitle,
      original.raw_content,
      original.images_json,
      original.config_json,
      now,
      now,
    );

    // 2. Nếu copyLeads = true, copy toàn bộ danh sách leads ở trạng thái 'pending'
    if (copyLeads) {
      const leads = db.prepare(`
        SELECT phone, custom_name, zalo_uid, display_name, gender, avatar
        FROM zalomkt_campaign_leads
        WHERE campaign_id = ?
      `).all(campaignId) as any[];

      const insertLeadStmt = db.prepare(`
        INSERT INTO zalomkt_campaign_leads (
          campaign_id, phone, custom_name, zalo_uid, display_name, gender, avatar,
          status, skip_reason, personalized_text, alias_updated, friend_requested,
          error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '', '', 0, 0, '', ?)
      `);

      for (const lead of leads) {
        insertLeadStmt.run(
          newId,
          lead.phone,
          lead.custom_name || "",
          lead.zalo_uid || null,
          lead.display_name || "",
          lead.gender ?? -1,
          lead.avatar || "",
          now,
        );
      }
      totalLeads = leads.length;

      db.prepare(`UPDATE zalomkt_campaigns SET total_leads = ? WHERE id = ?`).run(totalLeads, newId);
    }
  });

  transaction();
  return { id: newId, totalLeads };
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
export function ensureVerifyTaskTable(botId = "bot-1"): void {
  const db = getDb(botId);
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
export function createVerifyTask(totalPhones: number, targetGroupId = "", botId = "bot-1"): ZaloMktVerifyTask {
  ensureVerifyTaskTable(botId);
  const db = getDb(botId);
  const id = `vtask_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = Date.now();

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

/** Lấy tác vụ xác minh đang chạy hoặc gần nhất */
export function getLatestVerifyTask(botId = "bot-1"): ZaloMktVerifyTask | null {
  ensureVerifyTaskTable(botId);
  const db = getDb(botId);
  const row = db.prepare(`SELECT * FROM zalomkt_verify_tasks ORDER BY created_at DESC LIMIT 1`).get() as any;
  return row || null;
}

/** Cập nhật tiến độ hoặc dừng tác vụ xác minh */
export function updateVerifyTask(
  id: string,
  update: Partial<ZaloMktVerifyTask>,
  botId = "bot-1",
): void {
  ensureVerifyTaskTable(botId);
  const db = getDb(botId);
  const fields: string[] = ["updated_at = ?"];
  const values: any[] = [Date.now()];

  if (typeof update.status === "string") {
    fields.push("status = ?");
    values.push(update.status);
  }
  values.push(id);
  db.prepare(`UPDATE zalomkt_verify_tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

/** Đếm số lượng SĐT chưa xác minh trong kho data hoặc nhóm */
export function countUnverifiedContacts(groupId = "", botId = "bot-1"): number {
  const db = getDb(botId);
  if (groupId && groupId !== "all") {
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM zalomkt_contact_group_members m
      JOIN zalomkt_contacts c ON m.phone = c.phone
      WHERE m.group_id = ? AND c.status_code = 'unverified'
    `).get(groupId) as any;
    return row?.count || 0;
  }
  const row = db.prepare(`SELECT COUNT(*) as count FROM zalomkt_contacts WHERE status_code = 'unverified'`).get() as any;
  return row?.count || 0;
}



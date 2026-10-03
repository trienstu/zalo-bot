import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhoneNumber, getMktContact, upsertMktContact } from "../db/zalomkt-db.js";
import { generatePersonalizedMessage } from "./zalomkt-worker.js";

test("normalizePhoneNumber chuẩn hóa chính xác các định dạng SĐT Việt Nam", () => {
  assert.equal(normalizePhoneNumber("0912 345 678"), "0912345678");
  assert.equal(normalizePhoneNumber("+84912345678"), "0912345678");
  assert.equal(normalizePhoneNumber("+84 912-345-678"), "0912345678");
  assert.equal(normalizePhoneNumber("84912345678"), "0912345678");
  assert.equal(normalizePhoneNumber("098.765.4321"), "0987654321");
});

test("resolveVietnamesePronoun xác định chuẩn xác đại từ xưng hô theo Zalo API & Heuristic tiếng Việt", async () => {
  const { resolveVietnamesePronoun } = await import("./zalomkt-worker.js");

  // 1. Chuẩn Zalo API (0: Nam, 1: Nữ)
  assert.equal(resolveVietnamesePronoun({ gender: 0, fullName: "Hoàng" }), "Anh");
  assert.equal(resolveVietnamesePronoun({ gender: 1, fullName: "Hoa" }), "Chị");

  // 2. Kính ngữ người lớn tuổi (>= 55 tuổi từ sdob)
  assert.equal(resolveVietnamesePronoun({ gender: 0, fullName: "Nguyễn Văn A", sdob: "10/05/1960" }), "Bác");
  assert.equal(resolveVietnamesePronoun({ gender: 1, fullName: "Trần Thị B", sdob: "10/05/1960" }), "Cô");

  // 3. Giới tính ẩn (-1 hoặc 2) -> Heuristic tên tiếng Việt
  assert.equal(resolveVietnamesePronoun({ gender: -1, fullName: "Trần Văn Hoàng" }), "Anh");
  assert.equal(resolveVietnamesePronoun({ gender: -1, fullName: "Nguyễn Thị Mai" }), "Chị");
  assert.equal(resolveVietnamesePronoun({ gender: 2, fullName: "Phạm Thảo" }), "Chị");
  assert.equal(resolveVietnamesePronoun({ gender: 2, fullName: "Lê Tuấn" }), "Anh");
  assert.equal(resolveVietnamesePronoun({ gender: -1, fullName: "Alex Smith" }), "Anh/Chị");
});

test("generatePersonalizedMessage thay thế token chuẩn xác khi fallback", async () => {
  const raw = "Chào {gender_call} {name}, bên em gửi thông tin qua số {phone}.";
  const result = await generatePersonalizedMessage({
    rawContent: raw,
    recipientName: "Nguyễn Văn Hoàng",
    gender: 0, // Nam (Zalo standard)
    phone: "0342320596",
  });

  assert.ok(result.includes("Nguyễn Văn Hoàng"));
  assert.ok(result.includes("0342320596"));
  assert.ok(result.includes("Anh Nguyễn Văn Hoàng") || result.includes("Chào Anh"));
});

test("upsertMktContact và getMktContact lưu trữ và truy xuất Profile khách hàng chuẩn xác", () => {
  const testPhone = "0999888777";
  upsertMktContact({
    phone: testPhone,
    zalo_uid: "uid_test_123",
    display_name: "Anh Test",
    gender: 0, // Nam
    sdob: "15/08/1990",
    status_code: "valid",
    ai_tags: ["vip", "bds"],
  });

  const contact = getMktContact(testPhone);
  assert.ok(contact);
  assert.equal(contact.phone, testPhone);
  assert.equal(contact.zalo_uid, "uid_test_123");
  assert.equal(contact.display_name, "Anh Test");
  assert.equal(contact.gender, 0);
  assert.equal(contact.sdob, "15/08/1990");
  assert.equal(contact.status_code, "valid");
  assert.deepEqual(contact.ai_tags, ["vip", "bds"]);
});

import {
  createContactGroup,
  listContactGroups,
  addPhonesToGroup,
  getPhonesByGroupIds,
  deleteContactGroup,
  checkAndActivateScheduledCampaigns,
} from "../db/zalomkt-db.js";
import { getDb } from "../db/index.js";

test("Quản lý Nhóm Khách Hàng (Contact Groups): tạo nhóm, thêm thành viên, lấy danh sách SĐT", () => {
  const group = createContactGroup("Dự Án Test VIP", "Nhóm test phân loại", "emerald");
  assert.ok(group.id);
  assert.equal(group.name, "Dự Án Test VIP");

  // Thêm SĐT vào nhóm
  const res = addPhonesToGroup(group.id, ["0911222333", "+84933444555", "0911222333"]); // trùng lặp
  assert.equal(res.added, 2); // Chỉ thêm 2 số duy nhất

  // Truy vấn SĐT từ nhóm
  const phones = getPhonesByGroupIds([group.id]);
  assert.ok(phones.includes("0911222333"));
  assert.ok(phones.includes("0933444555"));

  // Xóa nhóm
  deleteContactGroup(group.id);
  const groupsAfter = listContactGroups();
  assert.ok(!groupsAfter.some((g) => g.id === group.id));
});

test("checkAndActivateScheduledCampaigns tự động kích hoạt chiến dịch đến hạn hẹn giờ", () => {
  const db = getDb();
  const campId = `camp_sched_test_${Date.now()}`;
  const pastScheduledTime = Date.now() - 5000; // Đã quá hạn 5s

  // Tạo chiến dịch hẹn giờ giả lập
  db.prepare(`
    INSERT INTO zalomkt_campaigns (
      id, title, raw_content, status, scheduled_at, total_leads, created_at, updated_at
    ) VALUES (?, 'Chiến dịch Test Hẹn Giờ', 'Nội dung test', 'scheduled', ?, 1, ?, ?)
  `).run(campId, pastScheduledTime, Date.now(), Date.now());

  // Kích hoạt
  const activated = checkAndActivateScheduledCampaigns();
  assert.ok(activated.includes(campId));

  // Kiểm tra trạng thái mới
  const row = db.prepare(`SELECT status FROM zalomkt_campaigns WHERE id = ?`).get(campId) as any;
  assert.equal(row?.status, "running");

  // Dọn dẹp
  db.prepare(`DELETE FROM zalomkt_campaigns WHERE id = ?`).run(campId);
});

test("Cấu hình lượt chạy (batchLimit) và updateCampaignConfig lưu trữ chuẩn xác", async () => {
  const { updateCampaignConfig, getCampaignById } = await import("../db/zalomkt-db.js");
  const db = getDb();
  const campId = `camp_batch_test_${Date.now()}`;

  db.prepare(`
    INSERT INTO zalomkt_campaigns (
      id, title, raw_content, status, config_json, total_leads, created_at, updated_at
    ) VALUES (?, 'Test Batch Limit', 'Content', 'running', '{}', 50, ?, ?)
  `).run(campId, Date.now(), Date.now());

  // Cập nhật cấu hình lượt chạy: giới hạn 30 tin
  updateCampaignConfig(campId, {
    batchLimit: 30,
    runSentCount: 15,
  });

  const camp = getCampaignById(campId);
  assert.ok(camp);
  const cfg = JSON.parse(camp.config_json);
  assert.equal(cfg.batchLimit, 30);
  assert.equal(cfg.runSentCount, 15);

  // Dọn dẹp
  db.prepare(`DELETE FROM zalomkt_campaigns WHERE id = ?`).run(campId);
});


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

test("generatePersonalizedMessage thay thế token chuẩn xác khi fallback", async () => {
  const raw = "Chào {gender_call} {name}, bên em gửi thông tin qua số {phone}.";
  const result = await generatePersonalizedMessage({
    rawContent: raw,
    recipientName: "Nguyễn Văn A",
    gender: 1, // Nam
    phone: "0912345678",
  });

  assert.ok(result.includes("Nguyễn Văn A"));
  assert.ok(result.includes("0912345678"));
});

test("upsertMktContact và getMktContact lưu trữ và truy xuất Profile khách hàng chuẩn xác", () => {
  const testPhone = "0999888777";
  upsertMktContact({
    phone: testPhone,
    zalo_uid: "uid_test_123",
    display_name: "Anh Test",
    gender: 1,
    sdob: "15/08/1990",
    status_code: "valid",
    ai_tags: ["vip", "bds"],
  });

  const contact = getMktContact(testPhone);
  assert.ok(contact);
  assert.equal(contact.phone, testPhone);
  assert.equal(contact.zalo_uid, "uid_test_123");
  assert.equal(contact.display_name, "Anh Test");
  assert.equal(contact.gender, 1);
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


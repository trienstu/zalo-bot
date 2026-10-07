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

  assert.ok(/0342320596/.test(result));
  assert.ok(/Hoàng/i.test(result));
  assert.ok(/Anh/i.test(result));
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

test("Chuẩn hóa 11 số sang 10 số cho tất cả nhà mạng Việt Nam", async () => {
  const { normalizePhoneNumber } = await import("../db/zalomkt-db.js");

  // Viettel: 0162 - 0169 -> 032 - 039
  assert.equal(normalizePhoneNumber("0168.123.4567"), "0381234567");
  assert.equal(normalizePhoneNumber("+841691234567"), "0391234567");
  assert.equal(normalizePhoneNumber("01639998888"), "0339998888");

  // MobiFone: 0120, 0121, 0122, 0126, 0128 -> 070, 079, 077, 076, 078
  assert.equal(normalizePhoneNumber("01201234567"), "0701234567");
  assert.equal(normalizePhoneNumber("01211234567"), "0791234567");
  assert.equal(normalizePhoneNumber("01221234567"), "0771234567");
  assert.equal(normalizePhoneNumber("01261234567"), "0761234567");
  assert.equal(normalizePhoneNumber("01281234567"), "0781234567");

  // VinaPhone: 0123, 0124, 0125, 0127, 0129 -> 083, 084, 085, 081, 082
  assert.equal(normalizePhoneNumber("01231234567"), "0831234567");
  assert.equal(normalizePhoneNumber("01241234567"), "0841234567");
  assert.equal(normalizePhoneNumber("01251234567"), "0851234567");
  assert.equal(normalizePhoneNumber("01271234567"), "0811234567");
  assert.equal(normalizePhoneNumber("01291234567"), "0821234567");

  // Vietnamobile: 0186, 0188 -> 056, 058
  assert.equal(normalizePhoneNumber("01861234567"), "0561234567");
  assert.equal(normalizePhoneNumber("01881234567"), "0581234567");

  // Gmobile: 0199 -> 059
  assert.equal(normalizePhoneNumber("01991234567"), "0591234567");

  // Số 10 số hiện hành giữ nguyên
  assert.equal(normalizePhoneNumber("0908120591"), "0908120591");
  assert.equal(normalizePhoneNumber("0988812345"), "0988812345");
});

test("extractPhonesWithNamesFromText tự động bóc tách nhiều SĐT trên 1 dòng và kèm tên", async () => {
  const { extractPhonesWithNamesFromText } = await import("../db/zalomkt-db.js");

  const rawData = `
    0908120591 - 0988812345 Anh Tuấn
    0911222333, Chị Ngọc
    01681234567 / 0903334445 (Bác Hoàng)
    0908120591
  `;

  const items = extractPhonesWithNamesFromText(rawData);
  const phones = items.map((i) => i.phone);

  assert.ok(phones.includes("0908120591"));
  assert.ok(phones.includes("0988812345"));
  assert.ok(phones.includes("0911222333"));
  assert.ok(phones.includes("0381234567")); // Chuyển từ 01681234567
  assert.ok(phones.includes("0903334445"));

  // Đảm bảo không bị ghép dính thành số 20 chữ số
  assert.ok(!phones.some((p) => p.length > 10));

  // Kiểm tra tên bóc tách
  const itemTuan = items.find((i) => i.phone === "0908120591");
  assert.ok(itemTuan?.customName.includes("Anh Tuấn"));
});

test("calculateNextSlotSchedule tính toán ca chạy tiếp theo chuẩn xác", async () => {
  const { calculateNextSlotSchedule } = await import("../db/zalomkt-db.js");

  const slots = [
    { time: "09:00", batchSize: 50 },
    { time: "13:30", batchSize: 60 },
    { time: "18:00", batchSize: 70 },
  ];

  // Giả sử mốc giờ đang là 10:00 sáng
  const refDate10AM = new Date();
  refDate10AM.setHours(10, 0, 0, 0);

  const next1 = calculateNextSlotSchedule(slots, refDate10AM);
  assert.ok(next1);
  assert.equal(next1?.nextSlot.time, "13:30");
  assert.equal(next1?.nextSlot.batchSize, 60);

  // Giả sử mốc giờ đang là 19:00 tối (đã qua hết các ca hôm nay)
  const refDate7PM = new Date();
  refDate7PM.setHours(19, 0, 0, 0);

  const next2 = calculateNextSlotSchedule(slots, refDate7PM);
  assert.ok(next2);
  assert.equal(next2?.nextSlot.time, "09:00");
  assert.equal(next2?.nextSlot.batchSize, 50);
  assert.ok(next2!.nextScheduledAt > refDate7PM.getTime());
});



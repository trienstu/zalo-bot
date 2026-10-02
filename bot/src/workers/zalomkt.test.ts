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

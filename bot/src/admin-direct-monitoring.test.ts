import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

import { isDmSummaryOrErrorQuery, deriveConversationPronouns } from "./admin-assistant.js";
import {
  isDirectUsersListQuery,
  isSingleUserProfileQuery,
  parseAdminProfileUpdateIntent,
} from "./user-memory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("isDmSummaryOrErrorQuery parses direct commands and natural questions", () => {
  // Lệnh rõ ràng
  assert.deepEqual(isDmSummaryOrErrorQuery("/dm"), { type: "summary", hours: 24 });
  assert.deepEqual(isDmSummaryOrErrorQuery("/tomtat11"), { type: "summary", hours: 24 });
  assert.deepEqual(isDmSummaryOrErrorQuery("/loi11"), { type: "errors", hours: 24 });
  assert.deepEqual(isDmSummaryOrErrorQuery("!loi11"), { type: "errors", hours: 24 });
  assert.deepEqual(isDmSummaryOrErrorQuery("/dmerrors"), { type: "errors", hours: 24 });

  // Câu hỏi tự nhiên về tóm tắt 1:1
  assert.equal(isDmSummaryOrErrorQuery("Hôm nay có ai nhắn tin riêng không?")?.type, "summary");
  assert.equal(isDmSummaryOrErrorQuery("Hôm nay có ai nhắn cho bot không?")?.type, "summary");
  assert.equal(isDmSummaryOrErrorQuery("tóm tắt tình hình khách nhắn 1:1")?.type, "summary");
  assert.equal(isDmSummaryOrErrorQuery("xem tin nhắn riêng của khách hôm nay")?.type, "summary");

  // Dynamic time window
  assert.deepEqual(isDmSummaryOrErrorQuery("tóm tắt tương tác 1:1 trong 3 ngày qua"), {
    type: "summary",
    hours: 72,
  });
  assert.deepEqual(isDmSummaryOrErrorQuery("kiểm tra lỗi 1:1 trong 6 giờ qua"), {
    type: "errors",
    hours: 6,
  });

  // Câu hỏi tự nhiên về lỗi tác vụ 1:1
  assert.equal(isDmSummaryOrErrorQuery("có ai nhờ bot làm gì bị lỗi không?")?.type, "errors");
  assert.equal(isDmSummaryOrErrorQuery("hôm nay có tác vụ 1:1 nào thất bại không?")?.type, "errors");
  assert.equal(isDmSummaryOrErrorQuery("ai nhờ gì mà bot không làm được không")?.type, "errors");

  // Tin nhắn thông thường không khớp
  assert.equal(isDmSummaryOrErrorQuery("thời tiết hôm nay thế nào")?.type, null);
  assert.equal(isDmSummaryOrErrorQuery("chào bot buổi sáng")?.type, null);
  assert.equal(isDmSummaryOrErrorQuery("tạo cho tôi slide bài giảng")?.type, null);
});

test("deriveConversationPronouns ưu tiên tuyệt đối trí nhớ giới tính / xưng hô đã lưu", () => {
  // 1. Trí nhớ lưu là Nữ -> Gọi bằng Chị dù tên là Minh (thường nhầm là Nam)
  const femaleRes = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Minh",
    rawText: "Chào bot nhé",
    memories: [{ memory_key: "gender", memory_value: "nữ" }],
  });
  assert.equal(femaleRes.userTitle, "Chị");
  assert.equal(femaleRes.botPronoun, "em");

  // 2. Trí nhớ lưu pronoun là Chị
  const chiRes = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Hải",
    rawText: "Em làm giúp cái này",
    memories: [{ memory_key: "pronoun", memory_value: "Chị" }],
  });
  assert.equal(chiRes.userTitle, "Chị");
  assert.equal(chiRes.botPronoun, "em");

  // 3. Trí nhớ lưu pronoun là Cô
  const coRes = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Thanh",
    rawText: "Chào bot",
    memories: [{ memory_key: "pronoun", memory_value: "Cô" }],
  });
  assert.equal(coRes.userTitle, "Cô");
  assert.equal(coRes.botPronoun, "cháu");

  // 4. Trí nhớ lưu pronoun là Anh
  const anhRes = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Tuấn",
    rawText: "Giúp tôi việc này",
    memories: [{ memory_key: "pronoun", memory_value: "Anh" }],
  });
  assert.equal(anhRes.userTitle, "Anh");
  assert.equal(anhRes.botPronoun, "em");
});

test("isDirectUsersListQuery & isSingleUserProfileQuery nhận diện chính xác yêu cầu hồ sơ", () => {
  assert.equal(isDirectUsersListQuery("/users11"), true);
  assert.equal(isDirectUsersListQuery("/ds11"), true);
  assert.equal(isDirectUsersListQuery("Cho anh xem danh sách người chat 1:1 với bot"), true);
  assert.equal(isDirectUsersListQuery("Những ai đã từng nhắn tin riêng cho bot vậy em"), true);
  assert.equal(isDirectUsersListQuery("Thời tiết hôm nay thế nào"), false);

  assert.equal(isSingleUserProfileQuery("/userinfo Thao"), "Thao");
  assert.equal(isSingleUserProfileQuery("/hoso 123456"), "123456");
  assert.equal(isSingleUserProfileQuery("Bot nhớ gì về bạn Thảo?"), "Thảo");
  assert.equal(isSingleUserProfileQuery("xem thông tin bạn Nguyễn Văn A"), "Nguyễn Văn A");
  assert.equal(isSingleUserProfileQuery("chào bot buổi sáng"), null);
});

test("parseAdminProfileUpdateIntent trích xuất chuẩn xác lệnh cập nhật hồ sơ", async () => {
  const update1 = await parseAdminProfileUpdateIntent("Lưu bạn Thảo là nữ, gọi bằng chị nhé");
  assert.ok(update1);
  assert.equal(update1.targetQuery, "Thảo");
  assert.equal(update1.gender, "nữ");
  assert.equal(update1.pronoun, "Chị");

  const update2 = await parseAdminProfileUpdateIntent("Đổi bạn Minh thành nữ, xưng chị giúp anh");
  assert.ok(update2);
  assert.equal(update2.targetQuery, "Minh");
  assert.equal(update2.gender, "nữ");
  assert.equal(update2.pronoun, "Chị");

  const update3 = await parseAdminProfileUpdateIntent("Bạn Tuấn thích xe phân khối lớn và làm nghề kiến trúc sư");
  assert.ok(update3);
  assert.equal(update3.targetQuery, "Tuấn");
  assert.ok(update3.preferences?.some((p) => p.includes("xe phân khối lớn")));
  assert.ok(update3.facts?.some((f) => f.includes("kiến trúc sư")));

  const cmdUpdate = await parseAdminProfileUpdateIntent("/setuser 3501936 nữ, xưng chị, thích hoa lan");
  assert.ok(cmdUpdate);
  assert.equal(cmdUpdate.targetQuery, "3501936");
  assert.equal(cmdUpdate.gender, "nữ");
  assert.equal(cmdUpdate.pronoun, "Chị");
  assert.ok(cmdUpdate.preferences?.some((p) => p.includes("hoa lan")));
});

test("direct_interactions DB operations work with fresh schema", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bot-dm-test-"));
  const dbPath = path.join(dir, "test.db");

  try {
    const db = new Database(dbPath);
    const schemaPath = path.join(__dirname, "db", "schema.sql");
    const schemaSql = readFileSync(schemaPath, "utf8");
    db.exec(schemaSql);

    // Thêm bản ghi tương tác thành công
    const now = Date.now();
    db.prepare(
      `INSERT INTO direct_interactions (user_id, display_name, user_message, bot_reply, status, error_detail, tasks_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("111", "Khách A", "Hỏi thời tiết", "Trời nắng", "success", "", "[]", now - 1000);

    // Thêm bản ghi tương tác thất bại
    db.prepare(
      `INSERT INTO direct_interactions (user_id, display_name, user_message, bot_reply, status, error_detail, tasks_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("222", "Khách B", "Tạo file docx", "Lỗi tạo file", "failed", "Timeout model", "[]", now);

    // Truy vấn tất cả
    const all = db.prepare("SELECT * FROM direct_interactions ORDER BY id DESC").all() as any[];
    assert.equal(all.length, 2);
    assert.equal(all[0].status, "failed");
    assert.equal(all[0].user_id, "222");

    // Truy vấn chỉ lỗi
    const failures = db.prepare("SELECT * FROM direct_interactions WHERE status = 'failed'").all() as any[];
    assert.equal(failures.length, 1);
    assert.equal(failures[0].error_detail, "Timeout model");

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

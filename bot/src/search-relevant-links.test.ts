import assert from "node:assert/strict";
import { test } from "node:test";
import { searchRelevantLinksAndResources } from "./member-assistant.js";
import { getDb } from "./db/index.js";

test("searchRelevantLinksAndResources trả về rỗng khi từ khóa không khớp với bất kỳ link nào", () => {
  const db = getDb();
  const testThreadId = "test_group_links_" + Date.now();

  try {
    // Chèn member để thỏa mãn foreign key
    db.prepare(`
      INSERT OR IGNORE INTO members (zalo_user_id, display_name, group_id, is_active, first_seen_at)
      VALUES (?, ?, ?, 1, ?)
    `).run("user_tuan", "Tuân", testThreadId, Date.now());

    // Chèn 1 link về kỹ năng tán gái
    db.prepare(`
      INSERT INTO group_messages (thread_id, message_id, zalo_user_id, display_name, text, ts, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      testThreadId,
      "msg_" + Date.now(),
      "user_tuan",
      "Tuân",
      "Gửi anh em tài liệu kỹ năng mềm tán gái: https://drive.google.com/drive/folders/sample_drive_folder",
      Date.now() - 3600000,
      Date.now() - 3600000
    );

    // 1. Khi hỏi từ khóa hoàn toàn không khớp (TTS, âm thanh, giọng đọc, audio)
    const resultUnmatched = searchRelevantLinksAndResources(testThreadId, "gửi lại TTS giọng đọc AI web app", 10);
    // Trước khi sửa: fallback trả về link drive tán gái!
    // Sau khi sửa: bắt buộc trả về mảng rỗng []
    assert.equal(resultUnmatched.length, 0, "Không được trả về link khi từ khóa không khớp");

    // 2. Khi hỏi từ khóa khớp (tán gái, kỹ năng)
    const resultMatched = searchRelevantLinksAndResources(testThreadId, "tài liệu tán gái", 10);
    assert.equal(resultMatched.length, 1, "Phải tìm thấy đúng link khớp từ khóa");
    assert.equal(resultMatched[0]?.url, "https://drive.google.com/drive/folders/sample_drive_folder");

    // 3. Khi hỏi theo tên tác giả (Tuân)
    const resultAuthor = searchRelevantLinksAndResources(testThreadId, "link do bác Tuân gửi", 10);
    assert.equal(resultAuthor.length, 1, "Phải tìm thấy khi có authorHint khớp");

    // 4. Khi hỏi toàn bộ link (wantsAll)
    const resultAll = searchRelevantLinksAndResources(testThreadId, "cho xin toàn bộ link trong nhóm", 10);
    assert.equal(resultAll.length, 1, "Phải trả về link khi người dùng yêu cầu toàn bộ link");
  } finally {
    // Dọn dẹp dữ liệu test
    try {
      db.prepare("DELETE FROM group_messages WHERE thread_id = ?").run(testThreadId);
    } catch {}
  }
});

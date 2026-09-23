import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isMemoryControlCommand,
  detectPotentialMemorySignal,
  formatUserMemoriesForPrompt,
  handleMemoryControlCommand,
} from "./user-memory.js";
import {
  upsertUserMemory,
  getUserMemories,
  searchUserMemories,
  deleteUserMemory,
  type UserMemoryItem,
} from "./db/index.js";

test("isMemoryControlCommand nhận diện đúng lệnh xem trí nhớ", () => {
  assert.equal(isMemoryControlCommand("!xemtrinho"), "view");
  assert.equal(isMemoryControlCommand("/my_memories"), "view");
  assert.equal(isMemoryControlCommand("bot nhớ gì về tôi"), "view");
  assert.equal(isMemoryControlCommand("em nhớ gì về anh thế"), "view");
  assert.equal(isMemoryControlCommand("kiểm tra trí nhớ của mình"), "view");
});

test("isMemoryControlCommand nhận diện đúng lệnh xóa trí nhớ", () => {
  assert.equal(isMemoryControlCommand("!xoatrinho"), "clear");
  assert.equal(isMemoryControlCommand("/clear_memories"), "clear");
  assert.equal(isMemoryControlCommand("quên hết về tôi đi"), "clear");
  assert.equal(isMemoryControlCommand("xóa toàn bộ thông tin về anh"), "clear");
  assert.equal(isMemoryControlCommand("đừng nhớ gì về em nữa"), "clear");
});

test("isMemoryControlCommand trả về null với tin nhắn thông thường", () => {
  assert.equal(isMemoryControlCommand("hôm nay thời tiết thế nào?"), null);
  assert.equal(isMemoryControlCommand("vẽ cho anh biểu đồ tăng trưởng"), null);
  assert.equal(isMemoryControlCommand("Arsenal hôm qua thắng mấy không"), null);
});

test("detectPotentialMemorySignal lọc chính xác tín hiệu cần ghi nhớ", () => {
  // Có tín hiệu
  assert.ok(detectPotentialMemorySignal("anh là kỹ sư phần mềm AI"));
  assert.ok(detectPotentialMemorySignal("mình thích câu lạc bộ Arsenal"));
  assert.ok(detectPotentialMemorySignal("tôi mê phong cách biểu đồ nền tối"));
  assert.ok(detectPotentialMemorySignal("nhớ giúp anh là anh thích tone màu đỏ burgundy"));
  assert.ok(detectPotentialMemorySignal("tôi đang theo dõi dự án Palm River"));

  // Không có tín hiệu (câu hỏi thường, chào hỏi)
  assert.ok(!detectPotentialMemorySignal("chào bot"));
  assert.ok(!detectPotentialMemorySignal("thời tiết hôm nay thế nào"));
  assert.ok(!detectPotentialMemorySignal("giá vàng hôm nay bao nhiêu một chỉ"));
  assert.ok(!detectPotentialMemorySignal("!taoanh poster bóng đá"));
});

test("formatUserMemoriesForPrompt định dạng đúng cấu trúc cho system prompt", () => {
  const sampleMemories: UserMemoryItem[] = [
    {
      id: 1,
      user_id: "u123",
      thread_id: "g1",
      user_name: "Triển",
      category: "preference",
      memory_key: "fav_team",
      memory_value: "Arsenal FC",
      source_snippet: "anh fan Arsenal nhé",
      confidence: 0.95,
      created_at: 1000,
      updated_at: 1000,
    },
    {
      id: 2,
      user_id: "u123",
      thread_id: "g1",
      user_name: "Triển",
      category: "fact",
      memory_key: "job_role",
      memory_value: "Chuyên gia AI & BĐS",
      source_snippet: "mình làm mảng AI",
      confidence: 1.0,
      created_at: 1000,
      updated_at: 1000,
    },
  ];

  const prompt = formatUserMemoriesForPrompt(sampleMemories, "Triển");
  assert.ok(prompt.includes("[HỒ SƠ & BỘ NHỚ VỀ THÀNH VIÊN ĐANG TRÒ CHUYỆN (@Triển)]:"));
  assert.ok(prompt.includes("Arsenal FC"));
  assert.ok(prompt.includes("Chuyên gia AI & BĐS"));
});

test("CRUD user_memories hoạt động an toàn và chính xác", () => {
  const testUserId = `test_user_${Date.now()}`;

  // 1. Thêm memory mới
  upsertUserMemory({
    userId: testUserId,
    userName: "Test User",
    category: "preference",
    memoryKey: "favorite_color",
    memoryValue: "Gold",
  });

  let list = getUserMemories(testUserId);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.memory_key, "favorite_color");
  assert.equal(list[0]?.memory_value, "Gold");

  // 2. Cập nhật trùng key (UPSERT)
  upsertUserMemory({
    userId: testUserId,
    userName: "Test User",
    category: "preference",
    memoryKey: "favorite_color",
    memoryValue: "Deep Gold & Midnight Navy",
  });

  list = getUserMemories(testUserId);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.memory_value, "Deep Gold & Midnight Navy");

  // 3. Tìm kiếm
  const searchRes = searchUserMemories(testUserId, "navy");
  assert.equal(searchRes.length, 1);

  // 4. Lệnh view
  const viewText = handleMemoryControlCommand("view", testUserId, "Test User");
  assert.ok(viewText.includes("Deep Gold & Midnight Navy"));

  // 5. Xóa cụ thể và xóa sạch
  const deleted = deleteUserMemory(testUserId, "favorite_color");
  assert.equal(deleted, true);
  assert.equal(getUserMemories(testUserId).length, 0);

  // 6. Lệnh clear
  const clearText = handleMemoryControlCommand("clear", testUserId, "Test User");
  assert.ok(clearText.includes("chưa lưu thông tin") || clearText.includes("xóa sạch"));
});

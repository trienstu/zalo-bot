import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  collectGroupDiscussions,
  generateGroupInsightWordDocument,
  formatInsightZaloMessage,
  type GroupInsightResult,
} from "./group-insight.js";
import { getDb, saveGroupMessage } from "./db/index.js";

test("collectGroupDiscussions thu thập chính xác các thảo luận trong khung giờ", () => {
  const db = getDb();
  const testGid = `grp_insight_test_${Date.now()}`;
  const now = Date.now();
  const startTs = now - 60 * 60 * 1000;
  const endTs = now;

  // Đảm bảo group tồn tại trong bot_groups
  db.prepare(
    `INSERT OR REPLACE INTO bot_groups (group_id, name, mode, updated_at)
     VALUES (?, ?, 'interactive', ?)`,
  ).run(testGid, "Nhóm Thảo Luận Công Nghệ", now);

  // Thêm tin nhắn hợp lệ
  saveGroupMessage({
    threadId: testGid,
    messageId: `msg_${now}_1`,
    zaloUserId: "user_a",
    displayName: "Nguyễn Văn A",
    text: "Hôm nay Gemini 3.5 và Claude 3.7 dùng ngon thật anh em ạ!",
    msgType: "chat.message",
    ts: now - 30 * 60 * 1000,
    isSelf: false,
    now: now - 30 * 60 * 1000,
  });

  saveGroupMessage({
    threadId: testGid,
    messageId: `msg_${now}_2`,
    zaloUserId: "user_b",
    displayName: "Trần Thị B",
    text: "Có ai làm video tự động với Remotion chưa, hướng dẫn mình với?",
    msgType: "chat.message",
    ts: now - 20 * 60 * 1000,
    isSelf: false,
    now: now - 20 * 60 * 1000,
  });

  const collected = collectGroupDiscussions({ startTs, endTs });
  const myGroup = collected.find((g) => g.groupId === testGid);

  assert.ok(myGroup, "Phải tìm thấy nhóm test trong danh sách thảo luận");
  assert.equal(myGroup.totalMessages, 2);
  assert.equal(myGroup.totalParticipants, 2);
  assert.ok(myGroup.transcript.includes("Nguyễn Văn A"));
  assert.ok(myGroup.transcript.includes("Trần Thị B"));
});

test("formatInsightZaloMessage tạo nội dung tóm tắt Zalo trực quan", () => {
  const mockInsights: GroupInsightResult[] = [
    {
      groupId: "grp_1",
      groupName: "Cộng Đồng AI",
      totalMessages: 150,
      totalParticipants: 25,
      topMembers: [{ name: "Admin", count: 40 }],
      hotTopics: [
        {
          topic: "Remotion Video & Tự động hoá",
          summary: "Thảo luận về pipeline render video nhanh trên cloud",
          sentiment: "positive",
          keyConclusions: ["Nên dùng EdgeTTS kết hợp Remotion"],
        },
      ],
      painPointsAndQuestions: [
        {
          issue: "Lỗi kết nối API Zalo socket",
          asker: "Hoàng Long",
          isResolved: false,
          suggestion: "Admin kiểm tra lại session key",
        },
      ],
      businessOpportunities: [
        {
          description: "Khách cần đặt hàng bot Zalo quản lý 10 nhóm",
          potential: "high",
          contactOrContext: "Zalo user @DungDev",
          actionItem: "Inbox tư vấn gói Pro",
        },
      ],
      actionableRecommendations: ["Hỗ trợ bạn Hoàng Long khắc phục lỗi"],
    },
  ];

  const msg = formatInsightZaloMessage({
    dateLabel: "01/10/2026",
    insights: mockInsights,
    totalMessages: 150,
  });

  assert.ok(msg.includes("BÁO CÁO INSIGHT & TRI THỨC NHÓM ZALO"));
  assert.ok(msg.includes("Cộng Đồng AI"));
  assert.ok(msg.includes("Remotion Video"));
  assert.ok(msg.includes("Lỗi kết nối API Zalo socket"));
  assert.ok(msg.includes("Khách cần đặt hàng bot Zalo"));
});

test("generateGroupInsightWordDocument xuất file .docx hợp lệ chuẩn A4", async () => {
  const mockInsights: GroupInsightResult[] = [
    {
      groupId: "grp_test",
      groupName: "Nhóm Bất Động Sản & AI",
      totalMessages: 45,
      totalParticipants: 12,
      topMembers: [
        { name: "Sếp Lân", count: 20 },
        { name: "Minh Tuấn", count: 15 },
      ],
      hotTopics: [
        {
          topic: "Thị trường căn hộ Đông Sài Gòn",
          summary: "Phân tích xu hướng dòng tiền quý 4",
          sentiment: "positive",
          keyConclusions: ["Dự án Celesta và Eaton Park thanh khoản tốt"],
        },
      ],
      painPointsAndQuestions: [
        {
          issue: "Khách hỏi thủ tục vay ngân hàng gói 6%",
          asker: "Anh Hùng",
          isResolved: false,
          suggestion: "Gửi bảng tính Excel lãi suất cho anh Hùng",
        },
      ],
      businessOpportunities: [
        {
          description: "Nhà đầu tư tìm căn hộ 2PN ngân sách 5 tỷ",
          potential: "high",
          contactOrContext: "Thành viên Lê An",
          actionItem: "Gửi 3 căn giỏ hàng độc quyền",
        },
      ],
      actionableRecommendations: ["Admin liên hệ anh Hùng và gửi rổ hàng cho Lê An"],
    },
  ];

  const docxPath = await generateGroupInsightWordDocument({
    dateLabel: "01/10/2026",
    insights: mockInsights,
    timeRangeLabel: "24 giờ qua",
  });

  assert.ok(fs.existsSync(docxPath), "File .docx phải được tạo ra");
  const buffer = fs.readFileSync(docxPath);
  assert.ok(buffer.length > 2000, "Dung lượng file Word phải > 2KB");

  // Kiểm tra header zip PK\x03\x04 của file docx
  assert.equal(buffer[0], 0x50); // 'P'
  assert.equal(buffer[1], 0x4b); // 'K'
  assert.equal(buffer[2], 0x03);
  assert.equal(buffer[3], 0x04);

  // Dọn dẹp file test
  try {
    fs.unlinkSync(docxPath);
  } catch {}
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCustomerUrgency } from "./host-assistant.js";
import { getSystemMetrics, formatSystemReport } from "./system-monitor.js";
import {
  saveAdminMentionAlert,
  markAdminMentionsAnswered,
  getPendingAdminMentionAlerts,
  markAdminMentionNotified,
  hasAdminRepliedInGroup,
  saveGroupMessage,
} from "./db/index.js";

test("evaluateCustomerUrgency nhận diện chính xác các cấp độ khẩn cấp", () => {
  // 1. Khiếu nại, tố cáo, lừa đảo
  const r1 = evaluateCustomerUrgency("Admin xem lại tài khoản chứ bên bạn lừa đảo à? Tôi sẽ báo công an đấy!");
  assert.equal(r1.isUrgent, true);
  assert.ok(r1.score >= 50);
  assert.ok(r1.reasons.includes("Khiếu nại/Tố cáo/Gian lận"));

  // 2. Sự cố cháy tài khoản, kẹt tiền, khẩn cấp
  const r2 = evaluateCustomerUrgency("Alo gấp với ad ơi, cháy tài khoản của em rồi, tiền chưa vào cứu em!!!");
  assert.equal(r2.isUrgent, true);
  assert.ok(r2.score >= 60);
  assert.ok(r2.reasons.includes("Sự cố khẩn cấp/Mất mát/Kẹt tiền"));

  // 3. Tin nhắn bình thường
  const r3 = evaluateCustomerUrgency("Chào ad, bên mình hôm nay có hỗ trợ không ạ?");
  assert.equal(r3.isUrgent, false);
  assert.equal(r3.score, 0);

  // 4. Thái độ bức xúc
  const r4 = evaluateCustomerUrgency("Sao lâu thế ad? Chờ mãi không thấy ai rep, bực mình thật sự!");
  assert.ok(r4.score >= 30);
});

test("getSystemMetrics và formatSystemReport hoạt động trơn tru không lỗi", async () => {
  const metrics = await getSystemMetrics();
  assert.ok(metrics.timestamp > 0);
  assert.ok(metrics.ram.totalBytes > 0);
  assert.ok(metrics.ram.usedPercent >= 0 && metrics.ram.usedPercent <= 100);
  assert.ok(metrics.cpu.cores > 0);
  assert.ok(metrics.uptime.seconds >= 0);

  const report = formatSystemReport(metrics);
  assert.ok(report.includes("BÁO CÁO SỨC KHỎE MÁY CHỦ"));
  assert.ok(report.includes("TÀI NGUYÊN MÁY CHỦ"));
  assert.ok(report.includes("RAM"));
  assert.ok(report.includes("Socket"));
});

test("Quy trình theo dõi tag admin trong nhóm (admin_mention_alerts)", () => {
  const testGid = `test_grp_${Date.now()}`;
  const testAdminId = "3501936437672262924";
  const now = Date.now();

  // 1. Lưu alert tag admin với thời gian 15 phút trước
  const pastTs = now - 15 * 60 * 1000;
  saveAdminMentionAlert({
    groupId: testGid,
    groupName: "Nhóm Kiểm Thử",
    messageId: `msg_${now}`,
    senderId: "test_member_1",
    senderName: "Member Test",
    text: "Sếp @Admin ơi xem giúp em case này với",
    adminId: testAdminId,
    createdAt: pastTs,
  });

  // 2. Kiểm tra alert đang ở trạng thái pending
  const pending = getPendingAdminMentionAlerts(10 * 60 * 1000, 30 * 60 * 1000);
  const myAlert = pending.find((a) => a.group_id === testGid && a.admin_id === testAdminId);
  assert.ok(myAlert);
  assert.equal(myAlert.status, "pending");

  // 3. Đánh dấu đã thông báo
  markAdminMentionNotified(myAlert.id);

  // 4. Admin gửi tin nhắn phản hồi trong nhóm
  assert.equal(hasAdminRepliedInGroup(testGid, testAdminId, pastTs), false);

  saveGroupMessage({
    threadId: testGid,
    messageId: `reply_${Date.now()}`,
    zaloUserId: testAdminId,
    displayName: "Admin",
    text: "Anh đây, case này để anh xử lý",
    msgType: "chat.message",
    ts: Date.now(),
    isSelf: false,
    now: Date.now(),
  });

  assert.equal(hasAdminRepliedInGroup(testGid, testAdminId, pastTs), true);

  // 5. Đánh dấu answered
  markAdminMentionsAnswered(testGid, testAdminId);
  const remaining = getPendingAdminMentionAlerts(10 * 60 * 1000, 30 * 60 * 1000);
  assert.equal(remaining.some((a) => a.group_id === testGid), false);
});

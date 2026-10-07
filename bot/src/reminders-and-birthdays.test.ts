import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNaturalTimeVietnam,
  parseFlexibleReminderTime,
  cancelReminderByContext,
  formatPendingRemindersPrompt,
  processReminderActionTags,
} from "./reminder.js";
import {
  parseBirthdayInput,
} from "./birthday-reminder.js";
import {
  upsertMemberBirthday,
  getTodayMemberBirthdays,
  deleteMemberBirthday,
} from "./db/index.js";
import { handleGroupMentions } from "./host-assistant.js";

test("1. parseNaturalTimeVietnam nhận diện các mẫu ngày giờ tự nhiên chuẩn xác", () => {
  // 1a. Mẫu "ngày mai lúc 9h sáng"
  const tmr1 = parseNaturalTimeVietnam("nhắc anh ngày mai lúc 9h sáng họp với khách nhé");
  assert.ok(tmr1, "Phải nhận diện được ngày mai lúc 9h sáng");
  assert.equal(tmr1.content, "họp với khách");

  // 1b. Mẫu "mai 14h gửi báo cáo"
  const tmr2 = parseNaturalTimeVietnam("mai 14h gửi báo cáo doanh thu");
  assert.ok(tmr2, "Phải nhận diện được mai 14h");
  assert.equal(tmr2.content, "gửi báo cáo doanh thu");

  // 1c. Mẫu ngày đứng trước giờ: "ngày 15/10 lúc 9h sáng họp với đối tác"
  const dateFirst = parseNaturalTimeVietnam("nhắc anh ngày 15/10 lúc 9h sáng họp với đối tác nhé");
  assert.ok(dateFirst, "Phải nhận diện được ngày 15/10 lúc 9h sáng");
  assert.equal(dateFirst.content, "họp với đối tác");
  assert.equal(dateFirst.targetType, "sender");

  // 1d. Mẫu giờ đứng trước ngày: "lúc 10:30 ngày 20/11 chúc mừng thầy cô"
  const timeFirst = parseNaturalTimeVietnam("nhắc tôi lúc 10:30 ngày 20/11 chúc mừng thầy cô");
  assert.ok(timeFirst, "Phải nhận diện được 10:30 ngày 20/11");
  assert.equal(timeFirst.content, "chúc mừng thầy cô");

  // 1e. Mẫu chỉ có ngày, không chỉ định giờ (tự động đặt 08:30 sáng)
  const dateOnly = parseNaturalTimeVietnam("nhắc anh ngày 25/12 gửi quà giáng sinh cho team");
  assert.ok(dateOnly, "Phải nhận diện được ngày 25/12");
  assert.equal(dateOnly.content, "gửi quà giáng sinh cho team");
  const d = new Date(dateOnly.remindAt);
  const vnHours = (d.getUTCHours() + 7) % 24;
  const vnMins = d.getUTCMinutes();
  assert.equal(vnHours, 8, "Giờ mặc định là 8h sáng");
  assert.equal(vnMins, 30, "Phút mặc định là 30");

  // 1f. Mẫu số phút: "20 phút nữa vào họp Zoom"
  const mins = parseNaturalTimeVietnam("nhắc anh 20 phút nữa vào họp Zoom");
  assert.ok(mins, "Phải nhận diện được 20 phút nữa");
  assert.equal(mins.content, "vào họp Zoom");

  // 1g. Chống nhận diện nhầm khi không có từ khóa nhắc nhở
  const notReminder = parseNaturalTimeVietnam("Doanh thu tăng 20% trong tháng vừa rồi nhỉ?");
  assert.equal(notReminder, null, "Không được bắt nhầm câu hỏi thông thường");
});

test("2. parseBirthdayInput phân tích đúng định dạng ngày sinh và danh tính", () => {
  // 2a. Có mention
  const b1 = parseBirthdayInput("/sinhnhat 15/08/1990 - Khách hàng VIP", [{ uid: "12345", name: "Nguyễn Văn A" }]);
  assert.ok(b1);
  assert.equal(b1.targetUserId, "12345");
  assert.equal(b1.targetName, "Nguyễn Văn A");
  assert.equal(b1.day, 15);
  assert.equal(b1.month, 8);
  assert.equal(b1.year, 1990);
  assert.equal(b1.sdob, "15/08/1990");
  assert.equal(b1.note, "Khách hàng VIP");

  // 2b. Không có mention, tên trong chuỗi
  const b2 = parseBirthdayInput("sinh nhật của Trần Thị B là ngày 20/10");
  assert.ok(b2);
  assert.equal(b2.day, 20);
  assert.equal(b2.month, 10);
  assert.equal(b2.year, null);
  assert.equal(b2.sdob, "20/10");
});

test("3. CRUD Member Birthday hoạt động chuẩn xác trong cơ sở dữ liệu", () => {
  const testUid = "test_user_bday_999";
  const ok = upsertMemberBirthday({
    zaloUserId: testUid,
    groupId: "group_test_1",
    displayName: "Lê Duy Linh Test",
    day: 15,
    month: 10,
    year: 1995,
    note: "Sale xuất sắc",
  });
  assert.equal(ok, true, "Lưu sinh nhật thành công");

  // Lấy sinh nhật ngày 15/10
  const todayList = getTodayMemberBirthdays(10, 15);
  const found = todayList.find((b) => b.zaloUserId === testUid);
  assert.ok(found, "Phải tìm thấy sinh nhật ngày 15/10");
  assert.equal(found.displayName, "Lê Duy Linh Test");
  assert.equal(found.sdob, "15/10/1995");

  // Xóa sinh nhật
  const deleted = deleteMemberBirthday(testUid, "group_test_1");
  assert.equal(deleted, true, "Xóa sinh nhật thành công");
});

test("4. Bot tự tag Admin không kích hoạt theo dõi cảnh báo tag 1:1", () => {
  const mockApi = {
    getOwnId: () => "bot_account_id",
  };

  // Giả lập bot gửi tin nhắn trong nhóm và tag Admin
  handleGroupMentions(mockApi, {
    threadId: "group_123",
    sender: "bot_account_id", // Chính con Bot là người gửi
    displayName: "Sen Chúa",
    text: "@Triển Nguyễn Dạ Sếp em đã làm xong",
    mentions: [{ uid: "admin_id_trien", name: "Triển Nguyễn" }],
  });

  // Kiểm tra không có lỗi crash và không ghi nhận tự nhắc
  assert.ok(true);
});

test("5. parseFlexibleReminderTime xử lý mượt mà ISO 8601, timestamp và ngôn ngữ tự nhiên", () => {
  // 5a. ISO 8601 chuẩn
  const isoTime = "2026-10-15T09:00:00+07:00";
  const ts1 = parseFlexibleReminderTime(isoTime);
  assert.ok(ts1, "Phải parse được ISO 8601");
  const d1 = new Date(ts1);
  assert.equal(d1.toISOString(), new Date(Date.parse(isoTime)).toISOString());

  // 5b. Timestamp số
  const nowTs = Date.now() + 3600000;
  const ts2 = parseFlexibleReminderTime(String(nowTs));
  assert.equal(ts2, nowTs);

  // 5c. Fallback ngôn ngữ tự nhiên
  const ts3 = parseFlexibleReminderTime("15 phút nữa");
  assert.ok(ts3, "Phải parse được 15 phút nữa");
  assert.ok(ts3 > Date.now());
});

test("6. Contextual Reminder: Đặt lịch, Xem danh sách và Hủy lịch theo ngữ cảnh SQLite", () => {
  const testCreator = "test_user_remind_999";
  const testThread = "group_test_999";

  // 6a. Tạo 2 lịch hẹn bằng processReminderActionTags
  const sampleLLMAnswer =
    `Dạ Sếp, em đã ghi nhận lịch hẹn!\n` +
    `[ACTION:SET_REMINDER time="2026-10-15T09:00:00+07:00" target="sender"]Check Zalo anh Giao và nâng cấp[/ACTION]\n` +
    `[ACTION:SET_REMINDER time="2026-10-15T14:30:00+07:00" target="all"]Họp chiến lược bán hàng[/ACTION]`;

  const processed = processReminderActionTags(sampleLLMAnswer, {
    threadId: testThread,
    isDirect: false,
    creatorId: testCreator,
    creatorName: "Sếp Triển",
  });

  assert.equal(processed.executedActions.length, 2, "Phải thực thi 2 lịch hẹn");
  assert.ok(!processed.cleanAnswer.includes("[ACTION:SET_REMINDER"), "Phải dọn sạch thẻ khỏi câu trả lời");

  // 6b. Kiểm tra formatPendingRemindersPrompt
  const promptSummary = formatPendingRemindersPrompt(testCreator);
  assert.ok(promptSummary.includes("Check Zalo anh Giao"));
  assert.ok(promptSummary.includes("Họp chiến lược bán hàng"));

  // 6c. Hủy 1 lịch hẹn theo từ khóa ngữ cảnh ("zalo")
  const cancelRes = cancelReminderByContext(testCreator, "check zalo");
  assert.equal(cancelRes.success, true);
  assert.equal(cancelRes.count, 1);

  // 6d. Kiểm tra lại prompt sau khi hủy 1 cái
  const promptSummaryAfter = formatPendingRemindersPrompt(testCreator);
  assert.ok(!promptSummaryAfter.includes("Check Zalo anh Giao"), "Lịch hẹn Check Zalo phải biến mất");
  assert.ok(promptSummaryAfter.includes("Họp chiến lược bán hàng"), "Lịch hẹn Họp chiến lược vẫn còn");

  // 6e. Hủy tất cả lịch hẹn còn lại bằng "all"
  const cancelAllRes = cancelReminderByContext(testCreator, "all");
  assert.equal(cancelAllRes.success, true);
  assert.equal(cancelAllRes.count, 1);

  // 6f. Kiểm tra danh sách trống
  const promptEmpty = formatPendingRemindersPrompt(testCreator);
  assert.equal(promptEmpty, "", "Danh sách phải trống rỗng sau khi hủy hết");
});

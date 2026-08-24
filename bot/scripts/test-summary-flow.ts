import { summarizeWithAI, buildTranscript, composeSummaryMessages } from "../src/summary.js";
import type { GroupMessageRow } from "../src/db/index.js";

async function testSummary() {
  console.log("🧪 Đang kiểm tra luồng tóm tắt tin nhắn nhóm với Gemini AI...\n");

  const mockMessages: GroupMessageRow[] = [
    {
      msg_id: "1",
      thread_id: "g1",
      zalo_user_id: "u1",
      display_name: "Nguyễn Văn An (Lead)",
      text: "Chào cả nhà, sáng mai 9h nhóm mình họp định kỳ triển khai tính năng thanh toán QR nhé!",
      ts: Date.now() - 3600 * 1000 * 5,
      created_at: Date.now() - 3600 * 1000 * 5,
    },
    {
      msg_id: "2",
      thread_id: "g1",
      zalo_user_id: "u2",
      display_name: "Trần Minh Bình (Dev)",
      text: "Dạ anh, em đã tích hợp xong SDK cổng thanh toán rồi, chiều nay em đẩy lên staging test.",
      ts: Date.now() - 3600 * 1000 * 4,
      created_at: Date.now() - 3600 * 1000 * 4,
    },
    {
      msg_id: "3",
      thread_id: "g1",
      zalo_user_id: "u3",
      display_name: "Lê Hoàng Cúc (QA)",
      text: "Em gửi mọi người tài liệu test case ở link này nhé: https://docs.google.com/document/d/testcase123",
      ts: Date.now() - 3600 * 1000 * 3,
      created_at: Date.now() - 3600 * 1000 * 3,
    },
    {
      msg_id: "4",
      thread_id: "g1",
      zalo_user_id: "u1",
      display_name: "Nguyễn Văn An (Lead)",
      text: "Ok Cúc. Mọi người chú ý kiểm tra kỹ luồng hoàn tiền refund nhé, hôm qua đối tác báo lỗi vụ này.",
      ts: Date.now() - 3600 * 1000 * 2,
      created_at: Date.now() - 3600 * 1000 * 2,
    },
    {
      msg_id: "5",
      thread_id: "g1",
      zalo_user_id: "u2",
      display_name: "Trần Minh Bình (Dev)",
      text: "Trưa nay ăn bún bò ở quán đầu ngõ không anh em ơi? Đang có voucher giảm 20% haha.",
      ts: Date.now() - 3600 * 1000 * 1,
      created_at: Date.now() - 3600 * 1000 * 1,
    }
  ];

  const transcript = buildTranscript(mockMessages);
  console.log("📝 Transcript log được tạo từ tin nhắn nhóm:");
  console.log(transcript.text);
  console.log("\n-------------------------------------------");
  console.log("🤖 Đang gửi transcript cho Gemini AI tóm tắt...\n");

  const summary = await summarizeWithAI({
    transcript: transcript.text,
    dayLabel: "24/08/2026",
    maxParts: 1,
  });

  console.log("📋 KẾT QUẢ TÓM TẮT TỪ GEMINI:");
  console.log("-------------------------------------------");
  console.log(summary);
  console.log("-------------------------------------------");

  const messagesToSend = composeSummaryMessages({
    summary,
    dayLabel: "24/08/2026",
    totalMessages: mockMessages.length,
    includedMessages: transcript.includedMessages,
    topSenders: ["Nguyễn Văn An (2)", "Trần Minh Bình (2)", "Lê Hoàng Cúc (1)"],
    maxParts: 1,
  });

  console.log("\n💬 BẢN TIN ĐÃ ĐƯỢC FORMAT ĐỂ GỬI VÀO NHÓM ZALO:");
  console.log("===========================================");
  console.log(messagesToSend[0]);
  console.log("===========================================");
}

testSummary().catch(console.error);

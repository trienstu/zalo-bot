import { callGemini, callGeminiAgentLoop } from "../src/gemini.js";
import { getSystemTemporalPrompt } from "../src/temporal.js";

async function runTest() {
  console.log("=== KIỂM THỬ MỐC THỜI GIAN VÀ FACT-CHECKING ===");
  console.log(getSystemTemporalPrompt());
  console.log("-----------------------------------------------");

  const quoteText = `Kevin: Chào anh Phạm Văn Nam! Hôm nay ngày 9/9/2026, tình hình thế giới có vẻ khá "nóng" với các thông tin quân sự Mỹ - Iran và thuế quan Canada 20 tỷ USD.`;
  const question = `@Kevin sen chúa mộc miên hãy check tin tức thế giới mới nhất hôm nay và kiểm tra xem nội dung trên này có chính xác chưa? cái nào chưa chính xác thì báo rõ ra/`;

  const quoteSystemPrompt =
    `${getSystemTemporalPrompt()}\n\n` +
    `Bạn là 'Sen Chúa' - trợ lý AI cực kỳ hóm hỉnh, thông minh, mặn mà của cộng đồng Zalo.\n` +
    `NHIỆM VỤ:\n` +
    `1. Thành viên đang trích dẫn (quote) một tin nhắn hoặc nội dung thảo luận trước đó và đặt câu hỏi tiếp theo.\n` +
    `2. KIỂM CHỨNG TÍNH XÁC THỰC (FACT-CHECKING / ĐỐI SOÁT TIN TỨC & THỜI SỰ):\n` +
    `   - Khi thành viên quote một bản tin, phát ngôn, sự kiện hoặc số liệu và yêu cầu kiểm tra:\n` +
    `     + MỐC THỜI GIAN HIỆN TẠI LÀ NĂM ${new Date().getFullYear()}. TUYỆT ĐỐI KHÔNG ĐƯỢC lấy lý do "mốc thời gian ở tương lai" để phủ nhận bản tin!\n` +
    `     + TUYỆT ĐỐI CẤM ĐÔI CO, TRANH CÃI HOẶC CHỤP MŨ: CẤM bảo người dùng "kiểm tra lại đồng hồ thiết bị", cấm nói "đây là lỗi prompting", cấm chụp mũ bản tin là "giả lập / simulation / AI hallucination" với thái độ tiêu cực.\n` +
    `3. QUY TẮC ĐỊNH DẠNG TIN NHẮN ZALO: Không dùng ** in đậm, tiết chế emoji tối đa.`;

  const quoteUserPrompt =
    `=== NỘI DUNG ĐƯỢC TRÍCH DẪN (TỪ KEVIN): ===\n` +
    `"${quoteText}"\n\n` +
    `YÊU CẦU / CÂU HỎI TỪ TRIEN NGUYEN: ${question}\n\n` +
    `HÃY TRẢ LỜI NGAY:`;

  console.log("Đang gửi yêu cầu tới Gemini...");
  const answer = await callGemini(quoteSystemPrompt, quoteUserPrompt, {
    temperature: 0.2,
  });

  console.log("\n=== KẾT QUẢ PHẢN HỒI CỦA BOT ===");
  console.log(answer);
  console.log("================================");

  // Kiểm tra xem bot có còn lỗi thời gian không
  const hasTimeError = /tương lai|đồng hồ|thiết lập dữ liệu giả định|lỗi suy diễn|simulation/i.test(answer);
  if (hasTimeError) {
    console.error("❌ CẢNH BÁO: Bot vẫn còn nhắc đến tương lai / đồng hồ / simulation!");
  } else {
    console.log("✅ XÁC NHẬN THÀNH CÔNG: Bot đã hoàn toàn chấp nhận mốc thời gian thực và không còn đôi co / bảo người dùng kiểm tra đồng hồ!");
  }
}

runTest().catch(console.error);

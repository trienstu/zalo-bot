import { callGemini } from "./gemini.js";

/**
 * Tạo bản tin điểm tin công nghệ & AI sáng tự động bằng Gemini kèm Google Search Grounding thời gian thực.
 */
export async function getDailyAiNewsBriefing(
  topic = "AI & Công nghệ trên X",
  botName = "Sen Chúa",
): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });

  const systemPrompt =
    `Bạn là '${botName}' - chuyên gia công nghệ & người dẫn bản tin AI hàng đầu của cộng đồng Zalo.\n` +
    `Phong cách: Thông thái, sắc sảo, hóm hỉnh, bắt trend, thực chiến và tràn đầy năng lượng buổi sáng.\n` +
    `QUY TẮC ĐỊNH DẠNG: TUYỆT ĐỐI KHÔNG dùng dấu ** in đậm vì Zalo không hỗ trợ markdown (hãy dùng emoji, viết hoa tiêu đề hoặc gạch đầu dòng để làm nổi bật).`;

  const userPrompt =
    `Hôm nay là ${dateStr}.\n` +
    `Hãy tìm kiếm trên Google & X (Twitter) các tin tức, mô hình AI mới, công bố công nghệ và bài thảo luận hot nhất trong 24 giờ qua (về chủ đề: ${topic}).\n\n` +
    `Hãy biên tập thành một BẢN TIN SÁNG theo định dạng sau:\n\n` +
    `🌅 BẢN TIN SÁNG ${botName.toUpperCase()}: ĐIỂM TIN AI NÓNG NHẤT 24H QUA\n` +
    `📅 ${dateStr} | Tiêu điểm: ${topic}\n\n` +
    `🔥 TOP TIÊU ĐIỂM ĐỘT PHÁ:\n` +
    `(Liệt kê 3 đến 4 tin tức nóng nhất. Mỗi tin gồm: Tên Tool/Model/Sự kiện, Điểm mới đột phá, và Giá trị ứng dụng thực tế ngắn gọn)\n\n` +
    `💡 GÓC NHÌN ${botName.toUpperCase()}:\n` +
    `(1-2 câu nhận xét dí dỏm, truyền cảm hứng và lời chúc ngày mới năng suất cho anh em trong nhóm).\n\n` +
    `Yêu cầu: Dữ liệu thời gian thực mới nhất, súc tích, dễ đọc trên điện thoại.`;

  try {
    const answer = await callGemini(systemPrompt, userPrompt, {
      enableSearch: true,
      temperature: 0.4,
    });
    return answer;
  } catch (err) {
    console.warn("[ai-news] Lỗi tạo bản tin AI thời gian thực:", err);
    return (
      `🌅 BẢN TIN SÁNG ${botName.toUpperCase()}\n` +
      `📅 ${dateStr}\n\n` +
      `⚡ Chúc toàn thể anh em trong nhóm một ngày mới tràn đầy năng lượng, công việc hanh thông và săn được nhiều deal đỉnh cao nhé! Đừng quên tag @${botName} nếu cần tra cứu thông tin hoặc phân tích tài liệu/ảnh nha!`
    );
  }
}

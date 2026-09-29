import { callGemini } from "./gemini.js";
import { searchRealtimeNews } from "./realtime-search.js";

/**
 * Tạo bản tin điểm tin công nghệ & AI sáng tự động bằng Gemini kèm dữ liệu Google News RSS thời gian thực.
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

  let liveNews = "";
  try {
    liveNews = await searchRealtimeNews(topic || "AI công nghệ mô hình mới");
  } catch (e) {
    console.warn("[ai-news] searchRealtimeNews error:", e);
  }

  const liveNewsSection = liveNews
    ? `\n\n=== CÁC BẢN TIN THỜI GIAN THỰC MỚI NHẤT TỪ GOOGLE NEWS: ===\n${liveNews}\n`
    : "";

  const systemPrompt =
    `Bạn là '${botName}' - chuyên gia công nghệ & người dẫn bản tin AI hàng đầu của cộng đồng Zalo.\n` +
    `Phong cách: Thông thái, sắc sảo, hóm hỉnh, bắt trend, thực chiến và tràn đầy năng lượng buổi sáng.\n` +
    `QUY TẮC ĐỊNH DẠNG: Dùng cú pháp Markdown **in đậm** cho tiêu đề và từ khóa quan trọng. Định dạng tiêu đề theo chuẩn: In đậm chữ thường (viết hoa chữ cái đầu, ví dụ: '**Top tiêu điểm đột phá:**'), TUYỆT ĐỐI KHÔNG VIẾT HOA NGUYÊN KHỐI CẢ DÒNG. Tiết chế icon/emoji tối đa.`;

  const userPrompt =
    `Hôm nay là ${dateStr}.${liveNewsSection}\n` +
    `Dựa vào các tin tức mới nhất ở trên kết hợp với tri thức của bạn về chủ đề '${topic}', hãy biên tập thành một bản tin sáng theo định dạng sau:\n\n` +
    `🌅 **Bản tin sáng ${botName}: Điểm tin AI nổi bật 24h qua**\n` +
    `📅 ${dateStr} | **Tiêu điểm:** ${topic}\n\n` +
    `🔥 **Top tiêu điểm đột phá:**\n` +
    `(Liệt kê 3 đến 4 tin tức nóng nhất. Mỗi tin gồm: **Tên Tool/Model/Sự kiện**, điểm mới đột phá và giá trị ứng dụng thực tế ngắn gọn)\n\n` +
    `💡 **Góc nhìn ${botName}:**\n` +
    `(1-2 câu nhận xét dí dỏm, truyền cảm hứng và lời chúc ngày mới năng suất cho anh em trong nhóm).\n\n` +
    `Yêu cầu: Dữ liệu thời gian thực mới nhất, súc tích, dễ đọc trên điện thoại.`;

  try {
    const answer = await callGemini(systemPrompt, userPrompt, {
      enableSearch: false,
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

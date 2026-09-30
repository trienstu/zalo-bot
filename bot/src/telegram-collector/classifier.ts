import { callGeminiJson } from "../gemini.js";
import { saveKnowledgeItem } from "./db.js";
import type { TelegramRawMessage, KnowledgeCategory } from "./types.js";

const SYSTEM_PROMPT = `Bạn là chuyên gia chắt lọc và hệ thống hóa tri thức từ các cuộc thảo luận trên Telegram.
Nhiệm vụ của bạn:
1. Đọc kỹ dòng tin nhắn thảo luận trong nhóm.
2. Bỏ qua hoàn toàn: tin nhắn chào hỏi, tin nhắn quá ngắn (ok, cảm ơn, vâng, icon...), tin rao vặt spam vô nghĩa.
3. Gom các trao đổi hữu ích thành các "Đơn vị tri thức" (Knowledge Items) có giá trị cao, dùng để lưu trữ vào tài liệu Word tra cứu lâu dài.

Mỗi đơn vị tri thức BẮT BUỘC có cấu trúc JSON sau:
{
  "category": "ai_prompt" | "tools_tech" | "business_real_estate" | "tips_workflow" | "news_insight" | "general",
  "title": "Tiêu đề ngắn gọn, chuẩn chuyên môn (khoảng 8 - 15 từ)",
  "summary": "Tóm tắt bản chất vấn đề, kiến thức hoặc giải pháp được bàn luận (2 - 4 câu)",
  "key_takeaways": [
    "Điểm cốt lõi 1 (kinh nghiệm thực chiến/bước làm cụ thể)",
    "Điểm cốt lõi 2",
    "Điểm cốt lõi 3"
  ],
  "useful_links": ["https://..."],
  "original_quotes": "Câu nói đúc kết hoặc chia sẻ hay nhất của người trong cuộc (nếu có)",
  "raw_message_ids": [101, 102]
}

Quy ước danh mục:
- "ai_prompt": Cách viết prompt, mẹo dùng ChatGPT/Claude/Midjourney/Gemini, kỹ thuật AI Prompting.
- "tools_tech": Giới thiệu phần mềm, GitHub repo, tool tự động hóa, extension, API hay.
- "business_real_estate": Kinh nghiệm kinh doanh, đầu tư, kiến thức Bất động sản, tài chính.
- "tips_workflow": Thủ thuật tối ưu công việc, quy trình làm việc hiệu quả, mẹo văn phòng.
- "news_insight": Phân tích xu hướng thị trường, góc nhìn chuyên gia về sự kiện công nghệ/kinh tế.
- "general": Các kiến thức hữu ích tổng hợp khác.

Nếu toàn bộ tin nhắn chỉ là chat nhảm không có kiến thức nào đáng giữ lại, hãy trả về mảng rỗng [].
BẮT BUỘC trả về đúng định dạng mảng JSON: [{"category": ...}, ...]`;

/**
 * Phân tích và trích xuất tri thức từ danh sách tin nhắn Telegram
 */
export async function classifyAndExtractKnowledge(
  chatId: string,
  messages: TelegramRawMessage[],
  dateRangeStr?: string,
): Promise<number> {
  // Lọc sơ bộ các tin có độ dài đủ để chứa thông tin
  const meaningfulMessages = messages.filter((m) => {
    const text = m.message_text.trim();
    if (text.length < 15) return false;
    // Bỏ qua các tin nhắn rác điển hình
    if (/^(hi|hello|alo|ok|oke|bye|chào|thanks|cảm ơn|cam on|bot ơi|ad ơi)\b/i.test(text) && text.length < 25) {
      return false;
    }
    return true;
  });

  if (meaningfulMessages.length === 0) {
    return 0;
  }

  // Dựng transcript cho AI
  const transcript = meaningfulMessages
    .map((m) => {
      const sender = m.sender_name || m.sender_username || "Thành viên";
      const timeStr = new Date(m.date * 1000).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `[ID:${m.message_id} | ${timeStr}] ${sender}: ${m.message_text}`;
    })
    .join("\n");

  const userPrompt = `Dưới đây là các trao đổi trong nhóm Telegram:\n\n${transcript}\n\nHãy phân loại và trích xuất các đơn vị tri thức hữu ích dưới dạng mảng JSON.`;

  try {
    const rawJson = await callGeminiJson(SYSTEM_PROMPT, userPrompt, 4000);
    const parsed = parseKnowledgeItemsJson(rawJson);

    let savedCount = 0;
    const now = Date.now();
    const dateRange = dateRangeStr || new Date().toISOString().slice(0, 10);

    for (const item of parsed) {
      if (!item.title || !item.summary) continue;

      const validCategory: KnowledgeCategory = [
        "ai_prompt",
        "tools_tech",
        "business_real_estate",
        "tips_workflow",
        "news_insight",
        "general",
      ].includes(item.category)
        ? (item.category as KnowledgeCategory)
        : "general";

      saveKnowledgeItem({
        chat_id: chatId,
        category: validCategory,
        title: item.title.trim(),
        summary: item.summary.trim(),
        key_takeaways: Array.isArray(item.key_takeaways) ? item.key_takeaways : [],
        original_quotes: item.original_quotes?.trim() || "",
        useful_links: Array.isArray(item.useful_links) ? item.useful_links : [],
        raw_message_ids: Array.isArray(item.raw_message_ids) ? item.raw_message_ids : [],
        date_range: dateRange,
        created_at: now,
        updated_at: now,
      });
      savedCount++;
    }

    return savedCount;
  } catch (err) {
    console.error("[telegram-classifier] ❌ Lỗi khi phân loại tin nhắn qua AI:", err);
    return 0;
  }
}

function parseKnowledgeItemsJson(raw: string): any[] {
  if (!raw) return [];
  try {
    const clean = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const data = JSON.parse(clean);
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    console.warn("[telegram-classifier] Không thể parse JSON:", e, "Raw output:", raw.slice(0, 200));
    return [];
  }
}

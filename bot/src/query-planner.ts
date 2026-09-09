/**
 * Module Lập Kế Hoạch Ngữ Nghĩa (LLM Semantic Query Planner)
 * Sử dụng mô hình nhẹ & siêu tốc (gemini-flash-lite-latest) để hiểu sâu ngữ cảnh,
 * ý định thực sự của người dùng và bóc tách thành các truy vấn tìm kiếm chuyên biệt (Multi-query Expansion).
 * Trang bị Graceful Fallback hoàn toàn để không bao giờ làm gián đoạn luồng bot.
 */

import { callGemini } from "./gemini.js";
import { getSystemTemporalPrompt } from "./temporal.js";

export interface QueryPlanResult {
  needsSearch: boolean;
  intent: "fact_check" | "realtime_news" | "project_qa" | "chat";
  queries: string[];
  summaryIntent?: string;
}

/**
 * Trích xuất từ khóa dự phòng bằng heuristic regex khi AI Planner gặp sự cố hoặc timeout
 */
function fallbackRegexPlanner(question: string, quoteText = ""): QueryPlanResult {
  const needsSearch =
    /(?:tìm kiếm|tra cứu|tin tức|tin mới|thông tin mới|thông tin thêm|xem có|là ai\b|vụ gì\b|sự việc gì\b|bản quyền|đạo nhái|phốt|drama|tiểu sử|vụ việc|giá|bao nhiêu|ở đâu|mua ở đâu|bán ở đâu|chỗ nào|nơi nào|link|web|shop|mua|check|kiểm tra|xác thực|đối soát|có thật không|đúng không|thực hư|chuẩn chưa|chính xác chưa|sai không|đúng hay sai|soi lại|check lại|ngáo|xem lại|bịa|hư cấu)/i.test(
      question
    );

  if (!needsSearch) {
    return {
      needsSearch: false,
      intent: "chat",
      queries: [],
    };
  }

  const cleanQ = question
    .replace(/@\S+/g, "")
    .replace(/\b(?:sen chúa|mộc miên|kevin|bot)\b/gi, "")
    .replace(/\b(?:hãy|vui lòng|giúp|check|kiểm tra|xem|nội dung|trên này|có chính xác chưa|chính xác chưa|báo rõ ra|đúng không|có thật không|nhé|nha|ạ|em|anh|bác)\b/gi, "")
    .replace(/[\/?.!,]+/g, " ")
    .trim();

  let subject = "";
  if (quoteText) {
    const cleanQuote = quoteText
      .replace(/^[🤖\s]*[^\n]*?(?:trả lời|chào|bản tin)[^\n]*\n*/gi, "")
      .replace(/Chào anh[^.!\n]+[.!\n]*/gi, "")
      .replace(/[\/?.!,]+/g, " ")
      .trim();
    subject = cleanQuote.slice(0, 80);
  }

  const query = cleanQ.length >= 6 ? cleanQ : subject || question.slice(0, 60);
  return {
    needsSearch: true,
    intent: "fact_check",
    queries: [query.slice(0, 80)],
    summaryIntent: "Fallback regex heuristic",
  };
}

/**
 * Phân tích câu hỏi và trích dẫn bằng mô hình AI siêu tốc để lập kế hoạch tìm kiếm đa luồng
 */
export async function planSearchQueries(params: {
  question: string;
  quoteText?: string;
  displayName?: string;
}): Promise<QueryPlanResult> {
  const { question, quoteText, displayName } = params;

  // Nếu câu chào đơn giản hoặc quá ngắn, bỏ qua planner để tiết kiệm tài nguyên
  const trimmed = question.trim();
  if (/^(?:chào|hi|hello|alo|ê|cảm ơn|thanks|ok|oki|vâng|dạ)\b/i.test(trimmed) && trimmed.length < 20) {
    return {
      needsSearch: false,
      intent: "chat",
      queries: [],
    };
  }

  const system =
    `${getSystemTemporalPrompt()}\n\n` +
    `Bạn là Bộ Lập Kế Hoạch Ngữ Nghĩa (Query Planner) chuyên bóc tách ý định người dùng trong cộng đồng Zalo.\n` +
    `NHIỆM VỤ:\n` +
    `1. Đọc câu hỏi của người dùng và nội dung được trích dẫn (nếu có).\n` +
    `2. Xác định người dùng có cần tra cứu thông tin bên ngoài không (needsSearch: true/false).\n` +
    `3. Nếu cần tra cứu: BÓC TÁCH TỐI ĐA 2-3 TỪ KHÓA TÌM KIẾM CÔ ĐỌNG (queries) cho từng khía cạnh/sự kiện cụ thể.\n` +
    `   - Ví dụ người dùng hỏi: "check tin thế giới hôm nay và kiểm tra xem Kevin nói Mỹ Iran, thuế Canada và giá vàng đúng chưa":\n` +
    `     => queries: ["tin tức thế giới nóng nhất hôm nay", "quân sự Mỹ Iran CENTCOM tàu dầu", "giá vàng thế giới hôm nay"]\n` +
    `   - Từng query phải ngắn gọn, súc tích (dưới 10 từ), tập trung vào thực thể và hành động chính, loại bỏ hoàn toàn các từ rác (hãy, check, xem, giúp, sen chúa...).\n` +
    `4. Xuất định dạng JSON duy nhất:\n` +
    `{\n` +
    `  "needsSearch": boolean,\n` +
    `  "intent": "fact_check" | "realtime_news" | "project_qa" | "chat",\n` +
    `  "queries": string[],\n` +
    `  "summaryIntent": string\n` +
    `}`;

  const user =
    (quoteText ? `=== NỘI DUNG ĐƯỢC TRÍCH DẪN: ===\n"${quoteText.slice(0, 1000)}"\n\n` : "") +
    `NGƯỜI DÙNG (${displayName || "Thành viên"}): ${question}\n\n` +
    `HÃY XUẤT KẾ HOẠCH JSON:`;

  try {
    const plannerPromise = (async () => {
      const text = await callGemini(system, user, {
        model: "gemini-flash-lite-latest",
        maxTokens: 500,
        json: true,
      });
      return JSON.parse(text);
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("QUERY_PLANNER_TIMEOUT")), 2500)
    );

    const raw = (await Promise.race([plannerPromise, timeoutPromise])) as any;

    if (raw && typeof raw === "object") {
      const needsSearch = Boolean(raw.needsSearch);
      const queries = Array.isArray(raw.queries)
        ? raw.queries.map((q: any) => String(q).trim()).filter((q: string) => q.length > 2).slice(0, 3)
        : [];
      const intent = ["fact_check", "realtime_news", "project_qa", "chat"].includes(raw.intent)
        ? raw.intent
        : "chat";

      return {
        needsSearch: needsSearch || queries.length > 0,
        intent,
        queries,
        summaryIntent: String(raw.summaryIntent || ""),
      };
    }
  } catch (err: any) {
    console.warn(`[query-planner] AI Planner fallback (${err?.message || err})`);
  }

  // Graceful fallback: Sử dụng heuristic regex
  return fallbackRegexPlanner(question, quoteText);
}

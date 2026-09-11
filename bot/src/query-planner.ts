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
  intent: "fact_check" | "realtime_news" | "project_qa" | "knowledge" | "chat";
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
  recentContext?: string;
  displayName?: string;
}): Promise<QueryPlanResult> {
  const { question, quoteText, recentContext, displayName } = params;

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
    `Bạn là Bộ Điều Hướng Ngữ Nghĩa & Lập Kế Hoạch Tra Cứu (Semantic Router & Query Planner) chuyên bóc tách ý định người dùng.\n` +
    `NHIỆM VỤ:\n` +
    `1. Đọc kỹ câu hỏi của người dùng, nội dung trích dẫn (nếu có) và lịch sử thảo luận gần đây (nếu có).\n` +
    `2. Phân loại câu hỏi thành 2 nhóm rõ rệt:\n` +
    `   a) NHÓM TRI THỨC NỀN TẢNG / TƯ DUY / CHAT (needsSearch: false):\n` +
    `      - Câu hỏi về lý thuyết, khoa học nền tảng, định lý, toán học, vật lý, triết học, lập trình/code, viết lách, dịch thuật, giải thích khái niệm bất biến, tư vấn logic, hoặc chào hỏi tán gẫu thông thường.\n` +
    `      - Những câu hỏi này KHÔNG cần tìm kiếm bên ngoài vì bộ não tri thức có sẵn của mô hình đã đủ để trả lời xuất sắc.\n` +
    `      => needsSearch: false, intent: "knowledge" hoặc "chat", queries: []\n\n` +
    `   b) NHÓM DỮ LIỆU THỰC TẾ BIẾN ĐỘNG / THỜI GIAN THỰC (needsSearch: true):\n` +
    `      - Câu hỏi về tin tức thời sự, sự kiện nóng, biến động 24h-7 ngày qua, thể thao, giá cả/thị trường, thời tiết, phát ngôn mới.\n` +
    `        => needsSearch: true, intent: "realtime_news"\n` +
    `      - Câu hỏi về pháp lý, luật mới, nghị quyết, quy định, đơn vị hành chính/tỉnh thành, số liệu thực tế, hồ sơ nhân vật/doanh nghiệp, tiến độ dự án có khả năng đã thay đổi ngoài đời thực.\n` +
    `        => needsSearch: true, intent: "fact_check"\n\n` +
    `3. Khi needsSearch: true -> Bóc tách 1-3 cụm từ tìm kiếm (queries) tối ưu:\n` +
    `   - Bóc tách đúng THỰC THỂ CHÍNH (Entities) và MỤC TIÊU CẦN TÌM (Target attribute/action).\n` +
    `   - LOẠI BỎ TOÀN BỘ từ rác, từ xưng hô, mệnh lệnh (như: check, kiểm tra, xem, giúp, cho anh, sen chúa, kevin, bot ơi, nhé, nha, ạ...).\n` +
    `   - TUYỆT ĐỐI KHÔNG TỰ BỊA ĐẶT hay đoán trước kết quả con vào query (Ví dụ: hỏi về tỉnh thành thì query là "số lượng đơn vị hành chính cấp tỉnh Việt Nam hiện nay", KHÔNG tự ý nhét tên một tỉnh/thành phố cụ thể nào vào query nếu người dùng không nhắc tới).\n` +
    `   - Giữ query súc tích, tự nhiên, mang tính tra cứu thông tin khách quan.\n\n` +
    `4. Xuất định dạng JSON duy nhất:\n` +
    `{\n` +
    `  "needsSearch": boolean,\n` +
    `  "intent": "realtime_news" | "fact_check" | "knowledge" | "chat",\n` +
    `  "queries": string[],\n` +
    `  "summaryIntent": string\n` +
    `}`;

  const user =
    (recentContext ? `=== LỊCH SỬ THẢO LUẬN GẦN ĐÂY TRONG NHÓM: ===\n${recentContext.slice(-2000)}\n\n` : "") +
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
      const intent = ["fact_check", "realtime_news", "project_qa", "knowledge", "chat"].includes(raw.intent)
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

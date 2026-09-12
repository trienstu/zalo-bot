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
 * Kế hoạch dự phòng an toàn khi AI Planner gặp sự cố mạng hoặc timeout (không dùng regex khoá cứng)
 */
function fallbackSafePlanner(question: string, quoteText = ""): QueryPlanResult {
  const cleanQ = question
    .replace(/@\S+/g, "")
    .replace(/\b(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot)\b/gi, "")
    .replace(/[\/?.!,]+/g, " ")
    .trim();

  const query = cleanQ.length >= 4 ? cleanQ : (quoteText || question).slice(0, 80);
  return {
    needsSearch: true,
    intent: "realtime_news",
    queries: [query.slice(0, 80)],
    summaryIntent: "Fallback safe planner",
  };
}

function normalizePlannerText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, (char) => (char === "Đ" ? "D" : "d"))
    .toLowerCase();
}

function uniqQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const query of queries) {
    const compact = String(query || "").replace(/\s+/g, " ").trim();
    const key = normalizePlannerText(compact);
    if (compact && !seen.has(key)) {
      seen.add(key);
      out.push(compact);
    }
  }
  return out.slice(0, 4);
}

function extractDeveloperEntity(question: string, plan: QueryPlanResult): string {
  const raw = `${question} ${plan.queries.join(" ")}`;
  const properMatches = [...raw.matchAll(/\b([A-Z0-9]{2,}(?:\s+(?:Group|Land|Homes|Corp|Corporation|JSC|Holdings|Capital|Properties|Realty))?|[A-Z][A-Za-z0-9&.-]*(?:\s+(?:Group|Land|Homes|Corp|Corporation|JSC|Holdings|Capital|Properties|Realty)))\b/g)]
    .map((match) => match[1]?.trim() || "")
    .filter((value) => value && !/^(?:TP|HCM|AI|CEO)$/i.test(value));
  const withSuffix = properMatches.find((value) => /\b(?:Group|Land|Homes|Corp|Corporation|JSC|Holdings|Capital|Properties|Realty)\b/i.test(value));
  if (withSuffix) return withSuffix;

  const ofMatch = raw.match(/(?:của|cua)\s+([^,?.!\n]{2,80})/i);
  const fromOf = ofMatch?.[1]
    ?.replace(/\b(?:dự án|du an|bất động sản|bat dong san|đang triển khai|dang trien khai|mới nhất|moi nhat|năm|nam|20\d{2}|cho anh|cho a|giúp anh|giup anh|nhé|nha|ạ|sen chúa|sen chua|mộc miên|moc mien|kevin|bot)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (fromOf && /[A-ZÀ-Ỹ0-9]/.test(fromOf)) return fromOf;

  return properMatches[0] || "";
}

function augmentDeveloperProjectQueries(plan: QueryPlanResult, question: string): QueryPlanResult {
  const text = normalizePlannerText(`${question} ${plan.summaryIntent || ""} ${plan.queries.join(" ")}`);
  const asksRealEstateDeveloperProjects =
    /\b(?:du an|bat dong san|bds|chung cu|can ho|khu do thi)\b/i.test(text) &&
    /\b(?:moi nhat|dang trien khai|danh muc|khai cong|ra mat|mo ban|chu dau tu|tap doan|developer)\b/i.test(text);

  if (!plan.needsSearch || !asksRealEstateDeveloperProjects) return plan;

  const entity = extractDeveloperEntity(question, plan);
  if (!entity) return plan;

  const currentYear = new Date().getFullYear();
  return {
    ...plan,
    queries: uniqQueries([
      `${entity} khởi công dự án ${currentYear}`,
      `${entity} ra mắt dự án mới ${currentYear}`,
      ...plan.queries,
    ]),
  };
}

export function normalizeQueryPlanIntent(plan: QueryPlanResult, question: string, quoteText = ""): QueryPlanResult {
  const text = normalizePlannerText(`${question} ${quoteText}`);
  const fallbackQuery = question
    .replace(/@\S+/g, "")
    .replace(/[\/?.!,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  const asksMedicalAction = /\b(?:thuoc|lieu dung|lieu luong|dieu tri|vac xin|vaccine|phac do|uong thuoc|nen uong|ke don|tac dung phu|chong chi dinh|tuong tac thuoc)\b/i.test(text);
  if (asksMedicalAction) {
    return {
      ...plan,
      needsSearch: true,
      intent: "fact_check",
      queries: plan.queries.length > 0 ? plan.queries : [fallbackQuery].filter(Boolean),
    };
  }

  if (!plan.needsSearch || plan.intent !== "fact_check") return plan;

  const asksOverview =
    /\b(?:tong quan|gioi thieu|thong tin|review|danh gia|overview|introduction|about|profile)\b/i.test(text);
  const textWithoutReviewPhrase = text.replace(/\bdanh gia\b/g, " ");
  const asksPrice =
    /\b(?:gia ban|bang gia|muc gia|don gia|bao gia|gia vang|gia xang|gia dau|gia du an|gia xe|gia nha|gia can ho|gia chung cu)\b/i.test(text) ||
    /\bgia\b/i.test(textWithoutReviewPhrase);
  const asksStrictFact =
    asksPrice ||
    /\b(?:hien nay|hien tai|moi nhat|hom nay|dang|con|phap ly|so hong|giay phep|tien do|mo ban|ban giao|chu dau tu|so huu|ai|bao nhieu|khi nao|ngay nao|dung khong|kiem tra|check|xac minh|fact check)\b/i.test(text);

  if (asksOverview && !asksStrictFact) {
    return augmentDeveloperProjectQueries({ ...plan, intent: "knowledge" }, question);
  }
  return augmentDeveloperProjectQueries(plan, question);
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
    `2. Phân loại câu hỏi thành 2 nhóm rõ rệt:\n\n` +
    `   A) NHÓM TRI THỨC NỀN TẢNG / TƯ DUY / CHAT (needsSearch: false):\n` +
    `      - Khoa học tự nhiên, toán học, định lý, vật lý, hóa học, sinh học, giải phẫu.\n` +
    `      - Kỹ thuật, lập trình/code, cú pháp, thuật toán, viết regex, kiến trúc phần mềm.\n` +
    `      - Lịch sử cổ - trung đại đã cố định (các cuộc chiến lịch sử, triều đại phong kiến, năm diễn ra sự kiện lịch sử cố định hàng chục/trăm năm trước).\n` +
    `      - Văn hóa, nghệ thuật, triết học, giải thích khái niệm trừu tượng, sáng tác, dịch thuật, soạn email.\n` +
    `      - Chào hỏi xã giao, khen ngợi, đùa vui thông thường.\n` +
    `      => KHÔNG tìm kiếm bên ngoài, dùng 100% bộ não tri thức có sẵn: needsSearch: false, intent: "knowledge" hoặc "chat", queries: []\n\n` +
    `   B) 8 MẢNG DỮ LIỆU THỰC TẾ BIẾN ĐỘNG (BẮT BUỘC needsSearch: true - KỂ CẢ KHI CÂU HỎI KHÔNG CÓ TỪ 'CHECK' HAY 'HIỆN NAY'):\n` +
    `      1. Thể chế, Địa giới & Hạ tầng quốc gia: Số lượng/cơ cấu tỉnh, thành phố, đặc khu, quận, huyện, xã, phường, sáp nhập, quy hoạch cao tốc, sân bay, vành đai...\n` +
    `      2. Nhân sự Lãnh đạo & Chức danh: Ai là Chủ tịch nước, Thủ tướng, Tổng Bí thư, Bộ trưởng, Bí thư/Chủ tịch tỉnh, CEO tập đoàn lớn (OpenAI, Apple, Google, Vingroup...), HLV trưởng thể thao...\n` +
    `      3. Pháp lý, Thuế, Lệ phí & Thủ tục: Biểu thuế TNCN, Luật Đất đai, bảng giá đất, thủ tục sổ đỏ, mức phạt giao thông, nồng độ cồn, định danh VNeID, hộ chiếu...\n` +
    `      4. Tài chính, Lãi suất & Giá cả: Lãi suất tiết kiệm/cho vay ngân hàng, giá vàng SJC/nhẫn, giá xăng dầu, tỷ giá ngoại tệ, giá Bitcoin/crypto, VN-Index...\n` +
    `      5. Công nghệ, Dòng sản phẩm & Mô hình AI: Phiên bản iPhone/smartphone mới nhất, GPU/chip mới, model AI mới (DeepSeek, Claude, GPT, Gemini...), tính năng mới mở bán...\n` +
    `      6. Doanh nghiệp, Bất động sản & M&A: Danh mục dự án của tập đoàn (Keppel Land, Vinhomes, Masterise...), tình trạng mở bán, thâu tóm/sáp nhập, chủ sở hữu...\n` +
    `      7. Thể thao, Đương kim vô địch & Chuyển nhượng: Đội vô địch giải đấu (Cúp C1, Ngoại hạng Anh, World Cup, V-League), CLB hiện tại của cầu thủ, bảng xếp hạng...\n` +
    `      8. Thống kê Kinh tế - Xã hội & Kỷ lục: Dân số Việt Nam/thế giới, GDP, người giàu nhất thế giới, tòa nhà cao nhất...\n` +
    `      => BẮT BUỘC needsSearch: true! Phân loại intent: "realtime_news" (với tin nóng, thể thao, biến động 24h-7d) hoặc "fact_check" (với hành chính, pháp lý, lãnh đạo, hồ sơ, số liệu).\n\n` +
    `3. Khi needsSearch: true -> Bóc tách 1-3 cụm từ tìm kiếm (queries) tối ưu:\n` +
    `   - Bóc tách đúng THỰC THỂ CHÍNH (Entities) và MỤC TIÊU CẦN TÌM (Target attribute/action).\n` +
    `   - LOẠI BỎ TOÀN BỘ từ rác, xưng hô, mệnh lệnh (check, kiểm tra, xem, giúp, cho anh, sen chúa, kevin, bot ơi, nhé, nha, ạ...).\n` +
    `   - BẮT BUỘC giữ nguyên dấu tiếng Việt chuẩn xác (TUYỆT ĐỐI KHÔNG viết không dấu vì tiếng Việt không dấu sẽ làm sai lệch hoàn toàn kết quả tra cứu báo chí và văn bản pháp luật).\n` +
    `   - Giữ query ngắn gọn, tự nhiên, mang tính tra cứu thông tin khách quan.\n\n` +
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
        model: "gemini-3.1-flash-lite-preview",
        maxTokens: 500,
        json: true,
      });
      return JSON.parse(text);
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("QUERY_PLANNER_TIMEOUT")), 6500)
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

      return normalizeQueryPlanIntent({
        needsSearch: needsSearch || queries.length > 0,
        intent,
        queries,
        summaryIntent: String(raw.summaryIntent || ""),
      }, question, quoteText);
    }
  } catch (err: any) {
    console.warn(`[query-planner] AI Planner fallback (${err?.message || err})`);
  }

  // Graceful fallback: Kế hoạch an toàn không khoá cứng
  return fallbackSafePlanner(question, quoteText);
}

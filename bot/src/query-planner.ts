/**
 * Module Lập Kế Hoạch Ngữ Nghĩa (LLM Semantic Query Planner)
 * Sử dụng mô hình nhẹ & siêu tốc (gemini-flash-lite-latest) để hiểu sâu ngữ cảnh,
 * ý định thực sự của người dùng và bóc tách thành các truy vấn tìm kiếm chuyên biệt (Multi-query Expansion).
 * Trang bị Graceful Fallback hoàn toàn để không bao giờ làm gián đoạn luồng bot.
 */

import { callGemini } from "./gemini.js";
import {
  normalizeExecutionSignals,
  type ResponseMode,
  type RiskLevel,
  type TaskComplexity,
  type ToolIntent,
} from "./hybrid-routing.js";
import { getSystemTemporalPrompt } from "./temporal.js";

export interface QueryPlanResult {
  needsSearch: boolean;
  intent: "fact_check" | "realtime_news" | "project_qa" | "knowledge" | "chat";
  queries: string[];
  summaryIntent?: string;
  responseMode?: ResponseMode;
  complexity?: TaskComplexity;
  toolIntent?: ToolIntent;
  riskLevel?: RiskLevel;
}

/**
 * Tín hiệu do planner sinh ra chỉ là đề xuất. Lớp policy xác định sẽ nâng mức
 * an toàn khi cần và không cho planner tự cấp quyền gọi công cụ.
 */
export function applyExecutionSignals(
  plan: QueryPlanResult,
  question: string,
  quoteText = "",
  rawSignals?: Record<string, unknown> | null,
): QueryPlanResult {
  const signals = normalizeExecutionSignals(rawSignals, {
    question,
    quoteText,
    needsSearch: plan.needsSearch,
    intent: plan.intent,
  });
  return { ...plan, ...signals };
}

/**
 * Trích xuất truy vấn gốc sạch sẽ trực tiếp từ câu hỏi người dùng (BẤT KHẢ XÂM PHẠM).
 * Loại bỏ từ rác xưng hô, mệnh lệnh để giữ nguyên 100% tên thực thể (Entity).
 */
export function extractCleanUserQuery(question: string, quoteText = ""): string {
  let clean = question
    .replace(/@\S+/g, "")
    .replace(/(?<=^|[^\p{L}\p{N}])(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot)(?=[^\p{L}\p{N}]|$)/giu, "")
    // Xóa tiền tố mệnh lệnh/tra cứu thường gặp ở đầu câu
    .replace(/^(?:check|kiểm tra|kiem tra|xem|tra cứu|tra cuu|hỏi|hoi)\s+/iu, "")
    // Xóa từ xưng hô, đệm, trợ từ câu hỏi đuôi
    .replace(/(?<=^|[^\p{L}\p{N}])(?:có|chưa|rồi|khi nào|bao giờ|ở đâu|sắp tới đó|sắp tới|vừa qua|cho a|cho anh|cho em|giúp anh|giúp a|giúp em|với anh|với a|với em|nhé|nha|ạ|với|đó|vậy|thế|nhỉ|hả|hử|sao)(?=[^\p{L}\p{N}]|$)/giu, "")
    .replace(/[\/?.!,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length < 3 && quoteText) {
    clean = quoteText
      .replace(/@\S+/g, "")
      .replace(/[\/?.!,]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return clean.slice(0, 100);
}

function isAdvisoryComparison(text: string): boolean {
  return /\b(?:so sanh|cai nao|loai nao|nen dung|nen chon|nen mua|xin hon|tot hon|phu hop hon|uu nhuoc diem|recommend|recommendation|compare|comparison|versus|vs)\b/i.test(text);
}

function isHighStakesAdvice(text: string): boolean {
  const scienceLaw = /\b(?:dinh luat|quy luat|luat bao toan|luat hap dan|luat newton|luat ohm)\b/i.test(text);
  const highStakes = /\b(?:thuoc|lieu dung|lieu luong|dieu tri|vac xin|vaccine|phac do|benh|trieu chung|chan doan|mang thai|thai ky|dinh duong|thuc pham chuc nang|y te|phap ly|luat|thue|hop dong|khoi kien|muc phat|dau tu|co phieu|chung khoan|crypto|tien dien tu|tin dung|vay|bao hiem)\b/i.test(text);
  return highStakes && !scienceLaw;
}

type PlannerSignals = {
  advisoryComparison: boolean;
  highStakes: boolean;
  explicitlyCurrent: boolean;
  inherentlyVolatile: boolean;
  stableTask: boolean;
};

/**
 * Guardrail deterministic độc lập với LLM. Không trả lời câu hỏi thay LLM;
 * chỉ xác định mức độ cần dữ liệu mới và mức rủi ro để planner không thể
 * vô tình hạ một câu hỏi biến động/rủi ro cao thành tri thức nền.
 */
function detectPlannerSignals(question: string, quoteText = ""): PlannerSignals {
  const text = normalizePlannerText(`${question} ${quoteText}`);
  const scienceLaw = /\b(?:dinh luat|quy luat|luat bao toan|luat hap dan|luat newton|luat ohm)\b/i.test(text);
  const explicitlyCurrent = /\b(?:hien nay|hien tai|hom nay|luc nay|bay gio|moi nhat|co gi moi|tin moi|nghien cuu moi|vua qua|sap toi|nam nay|thang nay|tuan nay|cap nhat|dang dien ra|con hieu luc|phien ban moi|vua ra mat|sap ra mat|bang gia|bao gia|gia ban|gia mua|gia thi truong|lich thi dau|ket qua|ti so|bang xep hang|du bao|thoi tiet)\b/i.test(text) ||
    /^gia\s+/i.test(text);
  const inherentlyVolatile = /\b(?:lanh dao|chu tich|bi thu|tong bi thu|thu tuong|bo truong|giam doc|ceo|hlv|chuc vu|nhan su|gia vang|gia xang|gia dau|ty gia|lai suat|chung khoan|co phieu|vn-index|crypto|bitcoin|thoi tiet|bao so|bao ap thap|con bao|lu lut|ngap lut|dong dat|lich thi dau|ket qua tran|ti so|bang xep hang|vo dich|chuyen nhuong|phap luat|luat|nghi dinh|thong tu|thue|muc phat|thu tuc|quy hoach|sap nhap|dia gioi|dan so|gdp|du an|bat dong san|mo ban|tien do|phap ly|chu dau tu|chuyen bay|xo so|dich benh|canh bao an ninh|lo hong bao mat|tuyen sinh|diem chuan|hoc phi|lich thi|visa|thi thuc|giay phep|lich mo cua|gio mo cua|thong so ky thuat|ngay phat hanh)\b/i.test(text) && !scienceLaw;
  const stableTask = /\b(?:dich|viet lai|tom tat van ban|soan|sang tac|dat ten|giai phuong trinh|tinh toan|chung minh|viet code|sua code|regex|thuat toan|giai thich khai niem|la gi|hoat dong nhu the nao|cach hoat dong)\b/i.test(text) &&
    !explicitlyCurrent && !inherentlyVolatile;
  return {
    advisoryComparison: isAdvisoryComparison(text),
    highStakes: isHighStakesAdvice(text),
    explicitlyCurrent,
    inherentlyVolatile,
    stableTask,
  };
}

/**
 * Kế hoạch dự phòng an toàn khi AI Planner gặp sự cố mạng hoặc timeout (không dùng regex khoá cứng)
 */
function fallbackSafePlanner(question: string, quoteText = ""): QueryPlanResult {
  const cleanQ = extractCleanUserQuery(question, quoteText);
  const query = cleanQ.length >= 4 ? cleanQ : (quoteText || question).slice(0, 80);
  const currentYear = new Date().getFullYear();
  const queries: string[] = [query.slice(0, 80)];
  const signals = detectPlannerSignals(question, quoteText);

  if (signals.advisoryComparison) {
    return applyExecutionSignals({
      needsSearch: true,
      intent: signals.highStakes || signals.explicitlyCurrent ? "fact_check" : "knowledge",
      queries: uniqQueries(queries),
      summaryIntent: "Fallback comparison planner",
    }, question, quoteText);
  }

  // Nếu câu hỏi về thể thao / bóng đá / lịch thi đấu
  if (/(?:lịch thi đấu|kết quả|bóng đá|la\s*liga|ngoại hạng|champions league|cúp c1|serie a|bundesliga|v-league)/i.test(query)) {
    queries.push(`${query} ${currentYear} mới nhất`.slice(0, 80));
  } else if (/(?:giá vàng|tỷ giá|chứng khoán|thời tiết|tin tức)/i.test(query)) {
    queries.push(`${query} hôm nay`.slice(0, 80));
  }

  const needsSearch = signals.highStakes || signals.explicitlyCurrent || signals.inherentlyVolatile;
  return applyExecutionSignals({
    needsSearch,
    intent: needsSearch ? "fact_check" : "knowledge",
    queries: needsSearch ? uniqQueries(queries) : [],
    summaryIntent: needsSearch ? "Fallback verified planner" : "Fallback stable knowledge planner",
  }, question, quoteText);
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

function buildContextualFallbackQuery(question: string, quoteText = ""): string {
  const cleanQuestion = extractCleanUserQuery(question, quoteText);
  const isFollowUp = /^(?:còn|con|vậy|vay|thế|the|nó|no|người này|nguoi nay|cái này|cai nay|trường hợp này|truong hop nay)\b/i
    .test(normalizePlannerText(question.trim()));
  if (isFollowUp && quoteText.trim()) {
    const cleanQuote = extractCleanUserQuery(quoteText);
    return `${cleanQuote} ${cleanQuestion}`.replace(/\s+/g, " ").trim().slice(0, 180);
  }
  return cleanQuestion.slice(0, 180);
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

function preserveCoreUserEntities(plan: QueryPlanResult, question: string): QueryPlanResult {
  if (!plan.needsSearch) return plan;

  const raw = question
    .replace(/@\S+/g, "")
    .replace(/\b(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot)\b/gi, "")
    .replace(/[\/?.!,]+/g, " ")
    .trim();

  // Bắt các cụm thực thể viết hoa đặc thù (acronyms như FIFA, UEFA, AFC, VFF, SJC, VNeID, ASEAN...)
  const acronymMatches = [...raw.matchAll(/\b([A-Z]{2,}(?:\s+[A-Z][a-z0-9]+)*)\b/g)]
    .map((m) => m[1]?.trim())
    .filter((w): w is string => typeof w === "string" && w.length > 0 && !/^(?:AI|TP|HCM|HN|OK|YES|NO)$/i.test(w));

  for (const acr of acronymMatches) {
    const hasAcr = plan.queries.some((q) => new RegExp(`\\b${acr}\\b`, "i").test(q));
    if (!hasAcr) {
      console.log(`[query-planner] 🛡️ Khôi phục thực thể viết hoa '${acr}' vào truy vấn tìm kiếm.`);
      const baseClean = raw
        .replace(/\b(?:có|chưa|rồi|khi nào|bao giờ|ở đâu|cho anh|cho em|giúp anh|nhé|nha|ạ)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      const newQuery = baseClean.length >= 3 ? baseClean : raw;
      return {
        ...plan,
        queries: uniqQueries([newQuery, ...plan.queries]),
      };
    }
  }

  return plan;
}

export function normalizeQueryPlanIntent(plan: QueryPlanResult, question: string, quoteText = ""): QueryPlanResult {
  const guardedPlan = preserveCoreUserEntities(plan, question);
  const text = normalizePlannerText(`${question} ${quoteText}`);
  const signals = detectPlannerSignals(question, quoteText);
  const fallbackQuery = buildContextualFallbackQuery(question, quoteText);
  if (signals.highStakes) {
    return {
      ...guardedPlan,
      needsSearch: true,
      intent: "fact_check",
      queries: guardedPlan.queries.length > 0 ? guardedPlan.queries : [fallbackQuery].filter(Boolean),
    };
  }

  if (signals.advisoryComparison && !signals.explicitlyCurrent) {
    return {
      ...guardedPlan,
      needsSearch: guardedPlan.needsSearch,
      intent: "knowledge",
      queries: guardedPlan.needsSearch
        ? (guardedPlan.queries.length > 0 ? guardedPlan.queries : [fallbackQuery].filter(Boolean))
        : [],
    };
  }

  // Dữ kiện vốn biến động hoặc có neo thời gian luôn cần kiểm chứng, kể cả khi
  // LLM planner trả needsSearch=false. Đây là chốt an toàn đa lĩnh vực.
  if (signals.explicitlyCurrent || signals.inherentlyVolatile) {
    return augmentDeveloperProjectQueries({
      ...guardedPlan,
      needsSearch: true,
      intent: signals.explicitlyCurrent && /\b(?:tin|su kien|tran|thoi tiet|bao|lu|dong dat)\b/i.test(text)
        ? "realtime_news"
        : "fact_check",
      queries: guardedPlan.queries.length > 0 ? guardedPlan.queries : [fallbackQuery].filter(Boolean),
    }, question);
  }

  if (signals.stableTask || !guardedPlan.needsSearch) {
    return {
      ...guardedPlan,
      needsSearch: false,
      intent: guardedPlan.intent === "chat" ? "chat" : "knowledge",
      queries: [],
    };
  }

  if (!guardedPlan.needsSearch || guardedPlan.intent !== "fact_check") return guardedPlan;

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
    return augmentDeveloperProjectQueries({ ...guardedPlan, intent: "knowledge" }, question);
  }
  return augmentDeveloperProjectQueries(guardedPlan, question);
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
    return applyExecutionSignals({
      needsSearch: false,
      intent: "chat",
      queries: [],
    }, question, quoteText);
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
    `      - Câu hỏi so sánh/tư vấn kỹ thuật kiểu "cái nào tốt hơn", "nên dùng/chọn cái nào": có thể needsSearch: true để lấy tài liệu bổ trợ nhưng intent phải là "knowledge", không được biến thiếu RSS thành từ chối trả lời. Ngoại lệ: y tế, pháp lý, tài chính/đầu tư hoặc câu hỏi giá/phiên bản hiện tại vẫn là fact_check.\n` +
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
    `   NGUYÊN TẮC BA TRỤC ÁP DỤNG CHO MỌI LĨNH VỰC NGOÀI 8 VÍ DỤ TRÊN:\n` +
    `   - TÍNH BIẾN ĐỘNG: thông tin có thể đổi theo thời gian (người giữ chức vụ, giá, lịch, trạng thái, phiên bản, quy định, hồ sơ thương mại) => cần search.\n` +
    `   - RỦI RO SAI SÓT: y tế, pháp lý, tài chính/đầu tư, an toàn/an ninh => fact_check kể cả khi người dùng không nói "mới nhất".\n` +
    `   - TÍNH CỤ THỂ: câu hỏi đòi tên người, con số, ngày, giá trị, điều khoản, thông số hoặc trạng thái của một thực thể có thật => ưu tiên fact_check; câu giải thích khái niệm/cách làm ổn định mới dùng knowledge.\n` +
    `   Không giới hạn vào danh sách từ khóa hay 8 lĩnh vực minh họa; phải suy luận theo ba trục này.\n\n` +
    `3. Khi needsSearch: true -> Bóc tách 1-3 cụm từ tìm kiếm (queries) tối ưu:\n` +
    `   - BẢO TỒN NGUYÊN VẸN TÊN THỰC THỂ CỐT LÕI (STRICT ENTITY PRESERVATION):\n` +
    `     + TUYỆT ĐỐI KHÔNG TỰ Ý THAY THẾ, SUY DIỄN HOẶC HOÁN ĐỔI tên giải đấu, thương hiệu, tổ chức, công nghệ hoặc sự kiện mà người dùng hỏi sang một cái tên khác (ví dụ: người dùng hỏi "FIFA ASEAN Cup" thì BẮT BUỘC query 1 phải có cụm từ "FIFA ASEAN Cup", TUYỆT ĐỐI CẤM tự ý đổi sang "ASEAN Mitsubishi Electric Cup" hay "AFF Cup"; hỏi "iPhone 16" cấm đổi sang "iPhone 15"; hỏi "Luật Đất đai 2024" cấm đổi sang "Luật 2013").\n` +
    `     + Query đầu tiên (queries[0]) BẮT BUỘC phải giữ nguyên vẹn toàn bộ các danh từ riêng / cụm từ định danh thực thể của người dùng kết hợp với mục tiêu tra cứu.\n` +
    `   - Bóc tách đúng THỰC THỂ CHÍNH (Entities) và MỤC TIÊU CẦN TÌM (Target attribute/action).\n` +
    `   - LOẠI BỎ TOÀN BỘ từ rác, xưng hô, mệnh lệnh (check, kiểm tra, xem, giúp, cho anh, sen chúa, mộc miên, kevin, bot ơi, nhé, nha, ạ, có ... chưa, rồi chưa...).\n` +
    `   - BẮT BUỘC giữ nguyên dấu tiếng Việt chuẩn xác (TUYỆT ĐỐI KHÔNG viết không dấu vì tiếng Việt không dấu sẽ làm sai lệch hoàn toàn kết quả tra cứu báo chí và văn bản pháp luật).\n` +
    `   - Giữ query ngắn gọn, tự nhiên, mang tính tra cứu thông tin khách quan.\n\n` +
    `4. Đề xuất cách thực thi theo bốn trục tổng quát, không phụ thuộc lĩnh vực:\n` +
    `   - responseMode: "fast" cho câu đơn giản/ổn định; "grounded" khi cần dữ liệu kiểm chứng; "deep" cho phân tích nhiều bước; "action" chỉ khi người dùng yêu cầu rõ việc đọc/tạo/chạy công cụ.\n` +
    `   - complexity: "low" | "medium" | "high" theo số bước suy luận và phạm vi tổng hợp.\n` +
    `   - toolIntent: "none" | "read" | "create" | "execute". Không tự suy diễn quyền thao tác nếu người dùng chỉ hỏi giải thích.\n` +
    `   - riskLevel: "normal" | "high"; high cho dữ kiện biến động hoặc nội dung y tế, pháp lý, tài chính, an toàn/an ninh cần kiểm chứng.\n\n` +
    `5. Xuất định dạng JSON duy nhất:\n` +
    `{\n` +
    `  "needsSearch": boolean,\n` +
    `  "intent": "realtime_news" | "fact_check" | "knowledge" | "chat",\n` +
    `  "queries": string[],\n` +
    `  "summaryIntent": string,\n` +
    `  "responseMode": "fast" | "grounded" | "deep" | "action",\n` +
    `  "complexity": "low" | "medium" | "high",\n` +
    `  "toolIntent": "none" | "read" | "create" | "execute",\n` +
    `  "riskLevel": "normal" | "high"\n` +
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
      const rawClean = buildContextualFallbackQuery(question, quoteText);
      const llmQueries = Array.isArray(raw.queries)
        ? raw.queries.map((q: any) => String(q).trim()).filter((q: string) => q.length > 2).slice(0, 3)
        : [];
      const intent = ["fact_check", "realtime_news", "project_qa", "knowledge", "chat"].includes(raw.intent)
        ? raw.intent
        : "chat";

      // NGUYÊN TẮC BẤT KHẢ XÂM PHẠM TRUY VẤN GỐC (RAW QUERY FIRST):
      // Khi cần tìm kiếm, Query #1 LUÔN LUÔN là câu hỏi gốc sạch của người dùng (bảo tồn 100% thực thể, giải đấu, sản phẩm, nhân vật).
      // Các truy vấn của AI Planner sẽ đóng vai trò mở rộng (Query #2, #3).
      const queries = (needsSearch && rawClean && rawClean.length >= 3)
        ? uniqQueries([rawClean, ...llmQueries])
        : llmQueries;

      const normalizedPlan = normalizeQueryPlanIntent({
        needsSearch: needsSearch || queries.length > 0,
        intent,
        queries,
        summaryIntent: String(raw.summaryIntent || ""),
      }, question, quoteText);
      return applyExecutionSignals(normalizedPlan, question, quoteText, raw);
    }
  } catch (err: any) {
    console.warn(`[query-planner] AI Planner fallback (${err?.message || err})`);
  }

  // Graceful fallback: Kế hoạch an toàn không khoá cứng
  return fallbackSafePlanner(question, quoteText);
}

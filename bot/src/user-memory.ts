import {
  upsertUserMemory,
  getUserMemories,
  getRelevantUserMemories,
  clearUserMemories,
  type UserMemoryItem,
  type UserMemoryCategory,
} from "./db/index.js";
import { callGemini } from "./gemini.js";

export { getRelevantUserMemories };

/**
 * Kiểm tra nhanh xem tin nhắn có chứa ý định quản lý trí nhớ (xem/xóa) hay không.
 */
export function isMemoryControlCommand(text: string): "view" | "clear" | null {
  const clean = text.trim().toLowerCase();
  if (/^[!/](?:xemtrinho|trinho|xem_nho|my_memories|memory)\b/i.test(clean) ||
      /(?:bot|em|sen)\s+(?:nhớ|biết)\s+gì\s+về\s+(?:tôi|anh|chị|em|mình)/i.test(clean) ||
      /(?:xem|kiểm tra)\s+(?:trí\s*nhớ|bộ\s*nhớ|thông tin\s*đã\s*nhớ)\s+(?:của|về)\s*(?:tôi|anh|chị|em|mình)/i.test(clean)) {
    return "view";
  }

  if (/^[!/](?:xoatrinho|quenhet|xoa_nho|clear_memories|forget_me)\b/i.test(clean) ||
      /(?:quên|xoá|xóa|đừng\s+nhớ|hủy\s+nhớ|bỏ\s+nhớ)\s+.*?(?:về|của)\s*(?:tôi|anh|chị|em|mình)/i.test(clean) ||
      /(?:quên|xoá|xóa)\s+(?:hết|sạch|toàn bộ|tất cả)\s+(?:thông tin|trí nhớ|ký ức|dữ liệu)/i.test(clean)) {
    return "clear";
  }

  return null;
}

/**
 * Xử lý lệnh xem/xóa trí nhớ của người dùng.
 */
export function handleMemoryControlCommand(
  action: "view" | "clear",
  userId: string,
  displayName: string,
): string {
  if (action === "clear") {
    const deletedCount = clearUserMemories(userId);
    if (deletedCount > 0) {
      return `🧹 Dạ em đã xóa sạch toàn bộ ${deletedCount} mục ghi nhớ cá nhân của bác @${displayName} rồi ạ! Từ bây giờ em sẽ xem như mới gặp bác lần đầu. ✨`;
    }
    return `🧹 Dạ trong bộ nhớ của em hiện tại chưa lưu thông tin cá nhân nào của bác @${displayName} cả ạ!`;
  }

  // action === "view"
  const memories = getUserMemories(userId, 15);
  if (memories.length === 0) {
    return `🧠 Dạ em chưa ghi nhớ được thói quen hay thông tin cá nhân cụ thể nào của bác @${displayName} ạ.\n\n💡 Bác có thể chia sẻ tự nhiên (ví dụ: "anh thích bóng đá Arsenal", "tôi làm kỹ sư xây dựng", "nhớ là anh thích biểu đồ nền tối") là em sẽ tự khắc ghi nhớ ngay nhé!`;
  }

  const categoryLabels: Record<UserMemoryCategory, string> = {
    preference: "🎨 Sở thích & Phong cách",
    fact: "💼 Thông tin & Chuyên môn",
    task: "📌 Công việc & Quan tâm",
  };

  const grouped: Record<string, string[]> = {};
  for (const m of memories) {
    const cat = categoryLabels[m.category] || "📝 Khác";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(`• **${m.memory_key}**: ${m.memory_value}`);
  }

  const sections = Object.entries(grouped)
    .map(([cat, items]) => `${cat}:\n${items.join("\n")}`)
    .join("\n\n");

  return `🧠 **HỒ SƠ GHI NHỚ CỦA EM VỀ BÁC @${displayName}:**\n\n${sections}\n\n💡 *Bác có thể gõ "!xoatrinho" bất cứ lúc nào nếu muốn em quên hết nhé!*`;
}

/**
 * Fast Regex Heuristic: Nhận diện xem tin nhắn người dùng có chứa phát ngôn cá nhân
 * hoặc sở thích/vai trò để kích hoạt trích xuất bộ nhớ nền hay không.
 */
export function detectPotentialMemorySignal(text: string): boolean {
  if (!text || text.trim().length < 8) return false;
  const clean = text.trim();

  // Bỏ qua các lệnh điều khiển, câu hỏi tra cứu tin tức / thời tiết / giá cả thông thường
  if (/^[!/]\w+/i.test(clean)) return false;
  if (/^(?:thời tiết|giá vàng|tỷ giá|chứng khoán|kết quả|tin tức|hôm nay|bao giờ|ai là|định giá)/i.test(clean) &&
      !/(?:tôi|mình|anh|em|tớ)\s+(?:là|thích|làm)/iu.test(clean)) {
    return false;
  }

  // Tín hiệu 1: Yêu cầu ghi nhớ tường minh
  const explicitRemember =
    /(?:nhớ|ghi nhớ|lưu ý|note lại|đừng quên)\s+(?:giúp|hộ)?\s*(?:là|rằng|nè)?/iu.test(clean);
  if (explicitRemember) return true;

  // Tín hiệu 2: Tuyên bố danh tính, vai trò, công việc, nơi ở
  const identityDeclaration =
    /(?:tôi|mình|anh|em|tớ|chị)\s+(?:là|làm|chuyên|phụ trách|quản lý|kinh doanh|ở|sống tại|đang làm)\s+[\p{L}\p{N}\s]{2,}/iu.test(clean);

  // Tín hiệu 3: Sở thích, thói quen, phong cách ưa chuộng, công nghệ/công cụ hay dùng
  const preferenceDeclaration =
    /(?:tôi|mình|anh|em|tớ|chị)\s+(?:thích|mê|khoái|cuồng|chuộng|hay dùng|quen dùng|chuyên code|chuyên dùng|fan|ủng hộ)\s+[\p{L}\p{N}\s]{2,}/iu.test(clean) ||
    /(?:sở thích|gu|phong cách|đội bóng|câu lạc bộ|màu sắc|tone màu|hệ điều hành|ngôn ngữ|framework)\s+(?:của\s+)?(?:tôi|mình|anh|em|tớ)/iu.test(clean);

  // Tín hiệu 4: Công việc, mục tiêu hoặc dự án đang theo dõi
  const taskDeclaration =
    /(?:tôi|mình|anh|em|tớ|chị)\s+(?:đang làm|đang nghiên cứu|đang theo dõi|đang build|đang phát triển|đang đầu tư|đang học)\s+[\p{L}\p{N}\s]{2,}/iu.test(clean);

  return identityDeclaration || preferenceDeclaration || taskDeclaration;
}

/**
 * Trích xuất các sự thật / sở thích / thói quen từ tin nhắn người dùng
 * và lưu vào bảng SQLite user_memories (Chạy bất đồng bộ, zero-latency).
 */
export async function extractAndSaveUserMemories(params: {
  userId: string;
  threadId: string;
  userName: string;
  text: string;
}): Promise<void> {
  const { userId, threadId, userName, text } = params;
  if (!userId || !text) return;

  if (!detectPotentialMemorySignal(text)) {
    return;
  }

  try {
    const promptSystem = `Bạn là bộ máy trích xuất thông tin người dùng (User Profile & Memory Extractor) cho trợ lý AI Zalo.
Nhiệm vụ: Phân tích tin nhắn của người dùng xem có chứa THÔNG TIN CÁ NHÂN DÀI HẠN ĐÁNG NHỚ không (Sở thích, Nghề nghiệp/Vai trò, Đội bóng yêu thích, Công nghệ/Ngôn ngữ/Công cụ quen dùng, Phong cách giao diện/màu sắc ưa thích, Công việc/Dự án đang làm).

NGUYÊN TẮC:
1. CHỈ trích xuất thông tin có tính chất dài hạn, đặc trưng của cá nhân người nói (VD: "anh thích Arsenal", "tôi làm môi giới BĐS", "mình chuyên code Python/React", "nhớ là mình thích biểu đồ nền tối").
2. TUYỆT ĐỐI KHÔNG trích xuất các câu tán gẫu nhất thời, cảm thán vu vơ (VD: "hôm nay nóng quá", "tôi đang đói", "buồn ngủ ghê").
3. Trả về đúng định dạng JSON chuẩn:
{
  "memories": [
    {
      "category": "preference" | "fact" | "task",
      "memory_key": "tên_khóa_tiếng_anh_viết_thường_ngắn_gọn",
      "memory_value": "Nội dung ngắn gọn súc tích bằng tiếng Việt",
      "confidence": 0.95
    }
  ]
}
Nếu không có thông tin dài hạn đáng nhớ, trả về {"memories": []}.`;

    const promptUser = `Người dùng (${userName || "User"}, ID: ${userId}) vừa nói:
"${text}"

Hãy trích xuất thông tin đáng nhớ:`;

    const rawResponse = await callGemini(promptSystem, promptUser, {
      model: "ag/gemini-3.1-pro-low",
      temperature: 0.1,
    });

    if (!rawResponse) return;

    // Bóc tách JSON
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed || !Array.isArray(parsed.memories) || parsed.memories.length === 0) {
      return;
    }

    for (const mem of parsed.memories) {
      if (!mem.memory_key || !mem.memory_value) continue;
      const validCategory: UserMemoryCategory =
        mem.category === "preference" || mem.category === "task" ? mem.category : "fact";

      upsertUserMemory({
        userId,
        threadId,
        userName,
        category: validCategory,
        memoryKey: String(mem.memory_key),
        memoryValue: String(mem.memory_value),
        sourceSnippet: text.slice(0, 300),
        confidence: typeof mem.confidence === "number" ? mem.confidence : 1.0,
      });
      console.log(`[user-memory] 🧠 Đã ghi nhớ cho ${userName} (${userId}): [${validCategory}] ${mem.memory_key} = "${mem.memory_value}"`);
    }
  } catch (err) {
    // Không bao giờ để lỗi trích xuất nền làm ảnh hưởng hệ thống
    console.warn(`[user-memory] Lỗi trích xuất bộ nhớ người dùng:`, err);
  }
}

/**
 * Định dạng danh sách memory thành khối ngữ cảnh gọn gàng để nhúng vào system prompt.
 */
export function formatUserMemoriesForPrompt(
  memories: UserMemoryItem[],
  displayName: string,
): string {
  if (!memories || memories.length === 0) return "";

  const lines: string[] = [];
  for (const m of memories) {
    const tag =
      m.category === "preference"
        ? "Sở thích/Phong cách"
        : m.category === "task"
        ? "Dự án/Công việc"
        : "Đặc điểm/Vai trò";
    lines.push(`- [${tag}] ${m.memory_value}`);
  }

  return (
    `[HỒ SƠ & BỘ NHỚ VỀ THÀNH VIÊN ĐANG TRÒ CHUYỆN (@${displayName})]:\n` +
    lines.join("\n") +
    `\n(Hãy tinh tế vận dụng các thông tin trên khi phù hợp để cá nhân hóa câu trả lời, không nhắc lại máy móc nếu không liên quan).\n`
  );
}

export interface ParsedProfileUpdate {
  targetQuery: string;
  gender?: string;
  pronoun?: string;
  preferences?: string[];
  facts?: string[];
  customNotes?: string;
  messageToSend?: string;
}

/**
 * Kiểm tra xem tin nhắn có phải là yêu cầu xem danh sách khách hàng 1:1 không.
 */
export function isDirectUsersListQuery(text: string): boolean {
  const clean = text.trim().toLowerCase();
  if (/^[!/](?:users11|ds11|danhsach11|khach11|friends11)\b/i.test(clean)) return true;
  return (
    /(?:danh sách|những ai|ai|các bạn|khách).*(?:nhắn|chat|inbox|gửi tin).*(?:1:1|riêng|với bot|cho bot)/i.test(clean) ||
    /(?:xem|cho xem|danh sách)\s+(?:khách|người dùng|bạn bè)\s+(?:1:1|nhắn riêng|chat riêng)/i.test(clean)
  );
}

/**
 * Kiểm tra xem tin nhắn có phải là yêu cầu tra cứu thông tin / trí nhớ của 1 người cụ thể không.
 */
export function isSingleUserProfileQuery(text: string): string | null {
  const clean = text.trim();

  const cmdMatch = clean.match(/^[!/](?:userinfo|hoso|trinho|thongtinkhach)\s+([^\s]+)/i);
  if (cmdMatch && cmdMatch[1]) {
    return cmdMatch[1].trim();
  }

  // Câu hỏi tự nhiên: "bot nhớ gì về bạn Thảo?", "xem thông tin bạn Thảo", "hồ sơ bạn Nguyễn Văn A"
  const naturalMatch = clean.match(
    /(?:bot\s+(?:nhớ|biết)\s+gì\s+về|xem\s+(?:thông tin|hồ sơ|trí nhớ|profile)\s+(?:của\s+)?|thông tin\s+(?:của\s+)?)(?:bạn|khách|thành viên|anh|chị|em|user)?\s+([^\n?,.:]+?)(?:\s+không|\s+vậy|\s+nhé|[?,.]|$)/iu
  );
  if (naturalMatch && naturalMatch[1]) {
    let candidate = naturalMatch[1].trim();
    candidate = candidate.replace(/^(?:bạn|khách|thành viên|anh|chị|em|user)\s+/iu, "").trim();
    if (candidate.length >= 2 && !/^(?:tôi|mình|tất cả|ai|hôm nay)$/i.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Trích xuất ý định cập nhật trí nhớ/hồ sơ của Admin đối với 1 người dùng.
 * Kết hợp Regex bóc tách nhanh và AI (Gemini) để hiểu trọn vẹn ngữ nghĩa tự nhiên.
 */
export async function parseAdminProfileUpdateIntent(
  text: string
): Promise<ParsedProfileUpdate | null> {
  const clean = text.trim();
  if (!clean || clean.length < 5) return null;
  const lower = clean.toLowerCase();

  // 1. Phân tích lệnh quản trị nhanh: /setuser <target> <content>
  const cmdMatch = clean.match(/^[!/](?:setuser|suathongtin|doithongtin|ghinho)\s+([^\s,]+)\s+([\s\S]+)/i);
  if (cmdMatch && cmdMatch[1] && cmdMatch[2]) {
    const target = cmdMatch[1].trim();
    const content = cmdMatch[2].trim();
    return parseUpdateContentFast(target, content);
  }

  // 2. Nhận diện các mẫu câu tự nhiên có thể là ý định cập nhật hồ sơ, xưng hô hoặc nhắn tin cho user
  const hasUpdateKeyword = /(?:lưu|sửa|cập nhật|đổi|chỉnh|note|ghi nhớ|dặn|nhớ|xưng|xưng hô|danh xưng|gọi|hồ sơ|trí nhớ|bộ nhớ|thông tin|profile)\b/iu.test(lower);
  const hasEntityOrPronoun = /(?:anh|ảnh|chị|em|cô|chú|bác|dì|thím|ông|bà|nam|nữ|con trai|con gái|sở thích|thích|nghề|làm|bạn|khách|thành viên)\b/iu.test(lower);
  const hasDirectPattern =
    /(?:là anh|là chị|là em|là nam|là nữ|xưng anh|xưng chị|gọi là anh|gọi là chị|không phải dì|ko phải dì|nhắn tin xin lỗi|nhắn xin lỗi)/iu.test(lower) ||
    /^(?:bạn|khách|thành viên|user)\s+[^\s,:]+\s+(?:là|thích|mê|làm|chuyên|xưng|gọi)/iu.test(clean);

  const isCandidateText = (hasUpdateKeyword && hasEntityOrPronoun) || hasDirectPattern;
  if (!isCandidateText) return null;

  // 2.1. Dạng dặn trực tiếp: "Bạn Tuấn thích ...", "Bạn Thảo là nữ xưng chị", "Bạn Nam làm nghề..."
  const directUserMatch = clean.match(
    /^(?:bạn|khách|thành viên|user|em|anh|chị)\s+([^\s,:]+)\s+(?:là|thích|mê|làm|chuyên|xưng|gọi)\s+([\s\S]+)/iu
  );
  if (directUserMatch && directUserMatch[1] && directUserMatch[2]) {
    const target = directUserMatch[1].trim();
    const content = clean.slice(clean.indexOf(target) + target.length).trim();
    if (target.length >= 2 && !/^(?:tôi|mình|em|anh|chị|bot|ai)$/i.test(target)) {
      if (!/(?:nhắn|gửi|xin lỗi|bảo)/iu.test(content)) {
        return parseUpdateContentFast(target, content);
      }
    }
  }

  // 2.2. Dạng có từ khóa hành động: "Lưu / đổi / sửa bạn <target> là/thành/xưng/gọi..."
  const actionRegex = clean.match(
    /(?:lưu|sửa|cập nhật|đổi|chỉnh|dặn|ghi nhớ)\s+(?:trí nhớ|thông tin|hồ sơ)?\s*(?:của\s+)?(?:bạn|khách|thành viên|user|em|anh|chị)?\s+([^\s:,]+(?:(?!\s+là|\s+thành|\s+sang|\s+thích|\s+xưng|\s+gọi)[\s\S])*?)\s*(?:là|thành|sang|thích|xưng|gọi|:)\s*([\s\S]+)/iu
  );
  if (actionRegex && actionRegex[1] && actionRegex[2]) {
    const target = actionRegex[1].trim();
    const content = actionRegex[2].trim();
    if (target.length >= 2 && !/^(?:tôi|mình|em|anh|chị|bot|ai)$/i.test(target)) {
      if (!/(?:nhắn|gửi|xin lỗi|bảo)/iu.test(content)) {
        return parseUpdateContentFast(target, content);
      }
    }
  }

  // 3. Fallback AI thông minh cho các câu văn nói tiếng Việt phức tạp
  try {
    const prompt = `Phân tích câu lệnh của Admin về việc cập nhật hồ sơ/trí nhớ hoặc nhắn tin cho một người dùng:
"${clean}"

Hãy bóc tách thành JSON chuẩn (nếu câu này không phải yêu cầu cập nhật hồ sơ, danh xưng, trí nhớ hoặc gửi tin nhắn cho người dùng, trả về {"isUpdate": false}):
{
  "isUpdate": true,
  "targetQuery": "Tên hoặc ID người dùng cần xử lý (VD: Trần Văn Tuyến, Tuấn, 123456...)",
  "gender": "nữ" | "nam" | null,
  "pronoun": "Chị" | "Anh" | "Em" | "Cô" | "Chú" | "Bác" | null,
  "preferences": ["sở thích 1", ...],
  "facts": ["thông tin/nghề nghiệp 1", ...],
  "customNotes": "ghi chú khác nếu có",
  "messageToSend": "Nội dung tin nhắn 1:1 cần gửi cho người dùng nếu Admin yêu cầu (ví dụ: 'Dạ em chào Anh Tuyến, em rất xin lỗi Anh vì sự nhầm lẫn trong cách xưng hô vừa rồi ạ! Em đã ghi nhớ lại chuẩn xác rồi ạ.'). Nếu Admin KHÔNG dặn nhắn tin hoặc xin lỗi thì bắt buộc để null"
}
QUY TẮC BẮT BUỘC:
- Nếu bảo là "anh", "con trai", "nam" -> gender: "nam", pronoun: "Anh"
- Nếu bảo là "chị", "con gái", "nữ" -> gender: "nữ", pronoun: "Chị"
- Nếu bảo "không phải Dì, là anh" -> pronoun: "Anh", gender: "nam"
- Nếu Admin dặn "nhắn tin xin lỗi", "nhắn tin cho ảnh": Soạn ngay một tin nhắn 1:1 ngắn gọn, lịch sự, xưng hô chuẩn xác danh xưng mới để bot gửi cho người đó.
- Trả về DUY NHẤT mã JSON hợp lệ, không có giải thích.`;

    const rawResponse = await callGemini(
      "Bạn là bộ trích xuất thông tin có cấu trúc cho trợ lý AI Zalo.",
      prompt,
      { model: "ag/gemini-3.1-pro-low", temperature: 0.1 }
    );
    if (!rawResponse) return null;
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const json = JSON.parse(jsonMatch[0]);
    if (!json.isUpdate || !json.targetQuery) return null;

    return {
      targetQuery: String(json.targetQuery).trim(),
      gender: json.gender || undefined,
      pronoun: json.pronoun || undefined,
      preferences: Array.isArray(json.preferences) ? json.preferences.filter(Boolean) : [],
      facts: Array.isArray(json.facts) ? json.facts.filter(Boolean) : [],
      customNotes: json.customNotes || undefined,
      messageToSend: json.messageToSend ? String(json.messageToSend).trim() : undefined,
    };
  } catch (e) {
    console.warn("[user-memory] parseAdminProfileUpdateIntent AI error:", e);
    return null;
  }
}

function parseUpdateContentFast(target: string, content: string): ParsedProfileUpdate {
  const lower = content.toLowerCase();
  let gender: string | undefined;
  let pronoun: string | undefined;
  const preferences: string[] = [];
  const facts: string[] = [];

  if (/(?:nữ|con gái|phái nữ|bà|cô gái)/i.test(lower)) {
    gender = "nữ";
    if (!pronoun) pronoun = "Chị";
  } else if (/(?:nam|con trai|phái nam|đàn ông)/i.test(lower)) {
    gender = "nam";
    if (!pronoun) pronoun = "Anh";
  }

  if (/(?:gọi bằng chị|xưng chị|là chị|gọi chị)/i.test(lower)) {
    pronoun = "Chị";
    if (!gender) gender = "nữ";
  } else if (/(?:gọi bằng anh|xưng anh|là anh|gọi anh)/i.test(lower)) {
    pronoun = "Anh";
    if (!gender) gender = "nam";
  } else if (/(?:gọi bằng em|xưng em|là em|gọi em)/i.test(lower)) {
    pronoun = "Em";
  } else if (/(?:gọi bằng cô|xưng cô|là cô|gọi cô)/i.test(lower)) {
    pronoun = "Cô";
    if (!gender) gender = "nữ";
  } else if (/(?:gọi bằng chú|xưng chú|là chú|gọi chú)/i.test(lower)) {
    pronoun = "Chú";
    if (!gender) gender = "nam";
  } else if (/(?:gọi bằng bác|xưng bác|là bác|gọi bác)/i.test(lower)) {
    pronoun = "Bác";
  }

  const prefMatch = content.match(/(?:thích|sở thích|mê|khoái)\s+([^,.;]+)/i);
  if (prefMatch && prefMatch[1]) {
    preferences.push(prefMatch[1].trim());
  }

  const factMatch = content.match(/(?:làm nghề|làm|chuyên|nghề nghiệp|công việc)\s+([^,.;]+)/i);
  if (factMatch && factMatch[1]) {
    facts.push(factMatch[1].trim());
  }

  return {
    targetQuery: target,
    gender,
    pronoun,
    preferences,
    facts,
    customNotes: content,
  };
}

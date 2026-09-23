import {
  upsertUserMemory,
  getUserMemories,
  clearUserMemories,
  type UserMemoryItem,
  type UserMemoryCategory,
} from "./db/index.js";
import { callGemini } from "./gemini.js";

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

  // Tín hiệu 3: Sở thích, thói quen, phong cách ưa chuộng
  const preferenceDeclaration =
    /(?:tôi|mình|anh|em|tớ|chị)\s+(?:thích|mê|khoái|cuồng|chuộng|hay dùng|fan|ủng hộ)\s+[\p{L}\p{N}\s]{2,}/iu.test(clean) ||
    /(?:sở thích|gu|phong cách|đội bóng|câu lạc bộ|màu sắc|tone màu)\s+(?:của\s+)?(?:tôi|mình|anh|em|tớ)/iu.test(clean);

  // Tín hiệu 4: Công việc, mục tiêu hoặc dự án đang theo dõi
  const taskDeclaration =
    /(?:tôi|mình|anh|em|tớ|chị)\s+(?:đang làm|đang nghiên cứu|đang theo dõi|đang build|đang phát triển|đang đầu tư)\s+[\p{L}\p{N}\s]{2,}/iu.test(clean);

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
Nhiệm vụ: Phân tích tin nhắn của người dùng xem có chứa THÔNG TIN CÁ NHÂN DÀI HẠN ĐÁNG NHỚ không (Sở thích, Nghề nghiệp/Vai trò, Đội bóng yêu thích, Phong cách thiết kế ưa chuộng, Công việc/Dự án đang làm).

NGUYÊN TẮC:
1. CHỈ trích xuất thông tin có tính chất dài hạn, đặc trưng của cá nhân người nói (VD: "anh thích Arsenal", "tôi làm môi giới BĐS", "nhớ là mình thích biểu đồ nền tối").
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
      model: "gemini-3.1-flash-lite-preview",
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

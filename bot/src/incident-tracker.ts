/**
 * incident-tracker.ts
 * Quản lý bộ đệm sự cố và fallback gần nhất của từng thread (In-memory LRU với TTL).
 * Giúp Bot nắm bắt chính xác các lỗi backend thực tế (kể cả tác vụ non-Hermes như vẽ ảnh, tạo video, cào web)
 * để minh bạch hóa lý do kỹ thuật khi trả lời người dùng, tránh hiện tượng LLM hallucinate (tự suy đoán mò).
 */

export type IncidentAction =
  | "image_generation"
  | "video_generation"
  | "web_crawl"
  | "tts"
  | "doc_processing"
  | "tool_execution";

export interface IncidentRecord {
  id: string;
  threadId: string;
  action: IncidentAction;
  targetProvider: string;
  status: "failed" | "fallback_triggered";
  fallbackProvider?: string;
  errorReason: string;
  userPrompt?: string;
  timestamp: number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 phút
const MAX_INCIDENTS_PER_THREAD = 10;
const MAX_TRACKED_THREADS = 500;

class IncidentTracker {
  private threadIncidents: Map<string, IncidentRecord[]> = new Map();

  /**
   * Ghi nhận một sự cố hoặc sự kiện fallback kỹ thuật
   */
  public recordIncident(
    entry: Omit<IncidentRecord, "id" | "timestamp"> & { timestamp?: number }
  ): IncidentRecord {
    const threadId = entry.threadId || "global";
    const record: IncidentRecord = {
      id: `inc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: entry.timestamp || Date.now(),
      ...entry,
    };

    const list = this.threadIncidents.get(threadId) || [];
    // Thêm vào đầu danh sách
    list.unshift(record);

    // Giới hạn số lượng bản ghi mỗi thread
    if (list.length > MAX_INCIDENTS_PER_THREAD) {
      list.length = MAX_INCIDENTS_PER_THREAD;
    }

    // Tránh memory leak: Giới hạn tối đa 500 thread theo cơ chế LRU eviction
    if (this.threadIncidents.size >= MAX_TRACKED_THREADS && !this.threadIncidents.has(threadId)) {
      const oldestKey = this.threadIncidents.keys().next().value;
      if (oldestKey) {
        this.threadIncidents.delete(oldestKey);
      }
    }

    this.threadIncidents.set(threadId, list);
    return record;
  }

  /**
   * Lấy danh sách sự cố gần nhất còn hiệu lực trong thread
   */
  public getRecentIncidents(
    threadId: string,
    maxAgeMs: number = DEFAULT_TTL_MS
  ): IncidentRecord[] {
    const list = this.threadIncidents.get(threadId) || [];
    const now = Date.now();
    const active = list.filter((item) => now - item.timestamp <= maxAgeMs);

    // Cập nhật lại danh sách đã lọc hết hạn
    if (active.length !== list.length) {
      this.threadIncidents.set(threadId, active);
    }

    return active;
  }

  /**
   * Lấy sự cố mới nhất của một loại action cụ thể trong thread
   */
  public getLatestIncident(
    threadId: string,
    action?: IncidentAction,
    maxAgeMs: number = DEFAULT_TTL_MS
  ): IncidentRecord | null {
    const list = this.getRecentIncidents(threadId, maxAgeMs);
    if (!action) return list[0] || null;
    return list.find((item) => item.action === action) || null;
  }

  /**
   * Sinh đoạn chỉ dẫn kỹ thuật để mớm vào System Prompt của LLM
   */
  public getRecentIncidentPrompt(
    threadId: string,
    maxAgeMs: number = DEFAULT_TTL_MS
  ): string | null {
    const incidents = this.getRecentIncidents(threadId, maxAgeMs);
    if (incidents.length === 0) return null;

    const descriptions = incidents.map((inc) => {
      const minutesAgo = Math.max(0, Math.floor((Date.now() - inc.timestamp) / 60000));
      const timeStr = minutesAgo === 0 ? "vừa xong" : `${minutesAgo} phút trước`;

      if (inc.status === "fallback_triggered" && inc.fallbackProvider) {
        return (
          `- Tác vụ ${inc.action} với ${inc.targetProvider} (${timeStr}) không thành công do "${inc.errorReason}". ` +
          `Hệ thống đã tự động chuyển sang tầng dự phòng ${inc.fallbackProvider} để hoàn thành.`
        );
      }
      return (
        `- Tác vụ ${inc.action} với ${inc.targetProvider} (${timeStr}) bị lỗi: "${inc.errorReason}".`
      );
    });

    return (
      `[THÔNG TIN SỰ CỐ KỸ THUẬT VỪA XẢY RA TRONG PHÒNG NÀY (HỆ THỐNG GHI NHẬN THỰC TẾ)]:\n` +
      descriptions.join("\n") +
      `\n⚠️ NGUYÊN TẮC TRẢ LỜI: Nếu người dùng thắc mắc về lỗi, hỏi tại sao không dùng đúng model/dịch vụ được yêu cầu, hoặc hỏi lý do kỹ thuật, hãy dựa trên thông tin thực tế ở trên để giải thích trung thực, lịch sự và ngắn gọn. TUYỆT ĐỐI KHÔNG tự suy diễn hoặc bịa ra lý do khác.`
    );
  }

  /**
   * Dọn dẹp dữ liệu (dùng cho testing hoặc reset)
   */
  public clear(threadId?: string) {
    if (threadId) {
      this.threadIncidents.delete(threadId);
    } else {
      this.threadIncidents.clear();
    }
  }
}

export const incidentTracker = new IncidentTracker();

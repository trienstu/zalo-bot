/**
 * ThreadMutex - Quản lý hàng đợi và khóa luồng tuần tự theo threadId (nhóm Zalo / chat 1:1)
 * Đảm bảo các tin nhắn trong cùng 1 thread được xử lý tuần tự (FIFO),
 * không chạy song song đè lên nhau gây xung đột dữ liệu, lãng phí token hoặc out-of-order replies.
 */

interface ThreadQueueState {
  promise: Promise<void>;
  inFlightCount: number;
  lastActiveAt: number;
}

export class ThreadMutexManager {
  private threads = new Map<string, ThreadQueueState>();

  /**
   * Chạy một tác vụ độc quyền cho threadId.
   * Nếu thread đang có tác vụ đang chạy, tác vụ mới sẽ xếp hàng và đợi tác vụ trước hoàn tất.
   */
  async runExclusive<T>(threadId: string, _taskName: string, task: () => Promise<T>): Promise<T> {
    const cleanId = String(threadId || "global").trim();
    const existing = this.threads.get(cleanId);

    const prevPromise = existing ? existing.promise : Promise.resolve();
    let releaseLock: () => void;
    const currentPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const state: ThreadQueueState = {
      promise: prevPromise.then(() => currentPromise),
      inFlightCount: (existing?.inFlightCount || 0) + 1,
      lastActiveAt: Date.now(),
    };
    this.threads.set(cleanId, state);

    try {
      // Đợi lượt xử lý tuần tự
      await prevPromise;
      return await task();
    } finally {
      state.inFlightCount = Math.max(0, state.inFlightCount - 1);
      state.lastActiveAt = Date.now();
      releaseLock!();

      // Nếu hàng đợi của thread này đã rỗng, giải phóng map sau 5s để tránh rò rỉ bộ nhớ
      if (state.inFlightCount === 0) {
        setTimeout(() => {
          const current = this.threads.get(cleanId);
          if (current && current.inFlightCount === 0) {
            this.threads.delete(cleanId);
          }
        }, 5000);
      }
    }
  }

  /**
   * Kiểm tra xem thread có đang có tác vụ in-flight đang chạy hay không
   */
  isBusy(threadId: string): boolean {
    const cleanId = String(threadId || "global").trim();
    const state = this.threads.get(cleanId);
    return Boolean(state && state.inFlightCount > 0);
  }

  /**
   * Số lượng tác vụ đang xếp hàng trong thread
   */
  getQueueLength(threadId: string): number {
    const cleanId = String(threadId || "global").trim();
    return this.threads.get(cleanId)?.inFlightCount || 0;
  }
}

export const threadMutex = new ThreadMutexManager();

import type { ChildProcess } from "child_process";

export interface ActiveRenderJob {
  jobId: string;
  threadId: string;
  userId?: string;
  type: "motion_video" | "presentation_video";
  title?: string;
  childProcess?: ChildProcess;
  abortController: AbortController;
  cancelled: boolean;
  startTime: number;
}

const activeJobs = new Map<string, ActiveRenderJob>();

/**
 * Đăng ký tiến trình render video đang chạy cho thread.
 */
export function registerRenderJob(job: ActiveRenderJob): void {
  activeJobs.set(job.threadId, job);
  console.log(`[active-render-jobs] 📝 Đã đăng ký job ${job.jobId} (${job.type}) cho thread [${job.threadId}]`);
}

/**
 * Hủy đăng ký khi render hoàn tất hoặc kết thúc.
 */
export function unregisterRenderJob(threadId: string, jobId?: string): void {
  const existing = activeJobs.get(threadId);
  if (!existing) return;
  if (!jobId || existing.jobId === jobId) {
    activeJobs.delete(threadId);
    console.log(`[active-render-jobs] 🗑️ Đã giải phóng job ${existing.jobId} cho thread [${threadId}]`);
  }
}

/**
 * Lấy job đang chạy của thread nếu có.
 */
export function getActiveRenderJob(threadId: string): ActiveRenderJob | undefined {
  return activeJobs.get(threadId);
}

/**
 * Hủy tiến trình render video đang chạy:
 * 1. Đặt cờ cancelled = true
 * 2. Kích hoạt abortController.abort()
 * 3. Gửi tín hiệu SIGTERM / SIGKILL tới tiến trình hệ điều hành (Remotion/FFmpeg)
 */
export function cancelActiveRenderJob(threadId: string): { cancelled: boolean; job?: ActiveRenderJob } {
  const job = activeJobs.get(threadId);
  if (!job) {
    return { cancelled: false };
  }

  job.cancelled = true;
  try {
    job.abortController.abort();
  } catch (e) {
    console.warn(`[active-render-jobs] Lỗi abortController cho thread [${threadId}]:`, e);
  }

  if (job.childProcess && !job.childProcess.killed) {
    try {
      const pid = job.childProcess.pid;
      job.childProcess.kill("SIGTERM");
      setTimeout(() => {
        if (job.childProcess && !job.childProcess.killed) {
          try {
            job.childProcess.kill("SIGKILL");
          } catch (killErr) {
            console.warn(`[active-render-jobs] Không thể gửi SIGKILL cho process PID=${job.childProcess?.pid}:`, killErr);
          }
        }
      }, 1500);
      console.log(`[active-render-jobs] 🛑 Đã gửi tín hiệu dừng tới subprocess PID=${pid} của thread [${threadId}]`);
    } catch (e) {
      console.warn(`[active-render-jobs] Lỗi khi kill process PID:`, e);
    }
  }

  activeJobs.delete(threadId);
  console.log(`[active-render-jobs] 🛑 Đã hủy thành công render job cho thread [${threadId}]`);
  return { cancelled: true, job };
}

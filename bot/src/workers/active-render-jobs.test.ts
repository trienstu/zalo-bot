import test from "node:test";
import assert from "node:assert/strict";
import {
  registerRenderJob,
  getActiveRenderJob,
  cancelActiveRenderJob,
  unregisterRenderJob,
} from "./active-render-jobs.js";

test("active-render-jobs: đăng ký, truy vấn, hủy bỏ và dọn dẹp job render", () => {
  const threadId = "test_thread_render_123";
  const jobId = "test_job_1";
  const abortController = new AbortController();

  // Đăng ký job
  registerRenderJob({
    jobId,
    threadId,
    userId: "user_test_999",
    type: "motion_video",
    title: "Test render Remotion",
    abortController,
    cancelled: false,
    startTime: Date.now(),
  });

  const active = getActiveRenderJob(threadId);
  assert.ok(active);
  assert.equal(active.jobId, jobId);
  assert.equal(active.cancelled, false);
  assert.equal(abortController.signal.aborted, false);

  // Hủy job (mô phỏng người dùng bảo rút điện á)
  const cancelRes = cancelActiveRenderJob(threadId);
  assert.equal(cancelRes.cancelled, true);
  assert.equal(cancelRes.job?.jobId, jobId);
  assert.equal(abortController.signal.aborted, true);

  // Sau khi unregister
  unregisterRenderJob(threadId, jobId);
  assert.equal(getActiveRenderJob(threadId), undefined);
});

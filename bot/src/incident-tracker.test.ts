import { test } from "node:test";
import assert from "node:assert/strict";
import { incidentTracker } from "./incident-tracker.js";

test("IncidentTracker: records and retrieves active incidents", () => {
  incidentTracker.clear();

  incidentTracker.recordIncident({
    threadId: "test_thread_1",
    action: "image_generation",
    targetProvider: "muse",
    status: "fallback_triggered",
    fallbackProvider: "codex",
    errorReason: "Hết thời gian chờ Muse (65000ms)",
  });

  const list = incidentTracker.getRecentIncidents("test_thread_1");
  assert.equal(list.length, 1);
  assert.equal(list[0]?.targetProvider, "muse");
  assert.equal(list[0]?.fallbackProvider, "codex");
  assert.equal(list[0]?.status, "fallback_triggered");
});

test("IncidentTracker: generates accurate context prompt for LLM", () => {
  incidentTracker.clear();

  incidentTracker.recordIncident({
    threadId: "test_thread_2",
    action: "image_generation",
    targetProvider: "muse",
    status: "fallback_triggered",
    fallbackProvider: "codex",
    errorReason: "Hết thời gian chờ Muse (65000ms)",
  });

  const prompt = incidentTracker.getRecentIncidentPrompt("test_thread_2");
  assert.ok(prompt);
  assert.match(prompt, /THÔNG TIN SỰ CỐ KỸ THUẬT VỪA XẢY RA TRONG PHÒNG NÀY/);
  assert.match(prompt, /tầng dự phòng codex/);
  assert.match(prompt, /Hết thời gian chờ Muse/);
});

test("IncidentTracker: respects TTL and filters expired incidents", () => {
  incidentTracker.clear();

  const past = Date.now() - 20 * 60 * 1000; // 20 phút trước (quá TTL 15m)
  incidentTracker.recordIncident({
    threadId: "test_thread_3",
    action: "video_generation",
    targetProvider: "muse",
    status: "failed",
    errorReason: "Connection refused",
    timestamp: past,
  });

  const list = incidentTracker.getRecentIncidents("test_thread_3");
  assert.equal(list.length, 0);

  const prompt = incidentTracker.getRecentIncidentPrompt("test_thread_3");
  assert.equal(prompt, null);
});

test("IncidentTracker: evicts oldest thread when exceeding 500 threads", () => {
  incidentTracker.clear();

  for (let i = 0; i < 505; i++) {
    incidentTracker.recordIncident({
      threadId: `thread_${i}`,
      action: "image_generation",
      targetProvider: "muse",
      status: "failed",
      errorReason: "test error",
    });
  }

  // The earliest threads (e.g. thread_0 to thread_4) should be evicted
  assert.equal(incidentTracker.getRecentIncidents("thread_0").length, 0);
  assert.equal(incidentTracker.getRecentIncidents("thread_504").length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveExecutionSignals,
  normalizeExecutionSignals,
  selectResponseMode,
} from "./hybrid-routing.js";

test("stable simple knowledge stays on the fast path", () => {
  const signals = deriveExecutionSignals({
    question: "Giải thích closure trong JavaScript",
    needsSearch: false,
    intent: "knowledge",
  });

  assert.equal(signals.responseMode, "fast");
  assert.equal(signals.complexity, "low");
  assert.equal(selectResponseMode({ signals, needsSearch: false }), "fast");
});

test("fresh or high-risk facts cannot be downgraded below grounded", () => {
  const normalized = normalizeExecutionSignals(
    {
      responseMode: "fast",
      complexity: "low",
      toolIntent: "none",
      riskLevel: "high",
    },
    {
      question: "Thông tin hiện tại cần được kiểm chứng",
      needsSearch: true,
      intent: "fact_check",
    },
  );

  assert.equal(normalized.responseMode, "grounded");
  assert.equal(selectResponseMode({ signals: normalized, needsSearch: true }), "grounded");
});

test("multi-step analytical work can use the deep path", () => {
  const signals = deriveExecutionSignals({
    question: "Phân tích sâu các phương án, so sánh rủi ro rồi đề xuất kế hoạch triển khai theo từng giai đoạn",
    needsSearch: false,
    intent: "knowledge",
  });

  assert.equal(signals.complexity, "high");
  assert.equal(selectResponseMode({ signals, needsSearch: false }), "deep");
});

test("planner cannot invent action authority without an explicit tool request", () => {
  const signals = normalizeExecutionSignals(
    {
      responseMode: "action",
      complexity: "medium",
      toolIntent: "execute",
      riskLevel: "normal",
    },
    {
      question: "Giải thích cách cron hoạt động",
      needsSearch: false,
      intent: "knowledge",
    },
  );

  assert.notEqual(signals.responseMode, "action");
  assert.equal(signals.toolIntent, "none");
});

test("explicit file or execution request selects action mode", () => {
  const signals = deriveExecutionSignals({
    question: "Tạo file Excel tổng hợp dữ liệu này giúp tôi",
    needsSearch: false,
    intent: "knowledge",
  });

  assert.equal(signals.toolIntent, "create");
  assert.equal(selectResponseMode({ signals, needsSearch: false, explicitToolRequest: true }), "action");
});

test("media stays on the existing path even if planner recommends deep", () => {
  const mode = selectResponseMode({
    signals: {
      responseMode: "deep",
      complexity: "high",
      toolIntent: "none",
      riskLevel: "normal",
    },
    needsSearch: false,
    hasMedia: true,
  });

  assert.equal(mode, "fast");
});

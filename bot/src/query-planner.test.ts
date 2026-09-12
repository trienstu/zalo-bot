import assert from "node:assert/strict";
import test from "node:test";

import { normalizeQueryPlanIntent, type QueryPlanResult } from "./query-planner.js";

function factPlan(): QueryPlanResult {
  return {
    needsSearch: true,
    intent: "fact_check",
    queries: ["tổng quan dự án mẫu"],
    summaryIntent: "test",
  };
}

test("câu tổng quan dự án là knowledge dù planner thô trả fact_check", () => {
  const plan = normalizeQueryPlanIntent(factPlan(), "tổng quan dự án Gladia Heights");

  assert.equal(plan.intent, "knowledge");
});

test("câu tổng quan sản phẩm là knowledge khi không hỏi dữ kiện biến động", () => {
  const plan = normalizeQueryPlanIntent(factPlan(), "giới thiệu sản phẩm Acme Phone");

  assert.equal(plan.intent, "knowledge");
});

test("câu dự án hỏi giá, pháp lý, tiến độ hoặc chủ đầu tư vẫn giữ fact_check", () => {
  const cases = [
    "giá dự án Gladia Heights hiện nay",
    "pháp lý dự án Gladia Heights thế nào",
    "tiến độ dự án Gladia Heights mới nhất",
    "chủ đầu tư dự án Gladia Heights là ai",
  ];

  for (const question of cases) {
    assert.equal(normalizeQueryPlanIntent(factPlan(), question).intent, "fact_check", question);
  }
});

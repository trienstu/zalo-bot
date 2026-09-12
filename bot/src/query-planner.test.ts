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

test("câu review hoặc đánh giá tổng quan không bị khóa fact_check nếu không hỏi dữ kiện biến động", () => {
  const cases = [
    "đánh giá tổng quan VinFast VF 3",
    "review laptop Acme Book 14",
    "thông tin thương hiệu Acme",
  ];

  for (const question of cases) {
    assert.equal(normalizeQueryPlanIntent(factPlan(), question).intent, "knowledge", question);
  }
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

test("câu hỏi danh mục dự án chủ đầu tư được bổ sung query hành động để tránh nguồn thị trường chung", () => {
  const base: QueryPlanResult = {
    needsSearch: true,
    intent: "fact_check",
    queries: [
      "dự án bất động sản mới nhất MIK Group 2026",
      "danh mục dự án MIK Group đang triển khai",
    ],
    summaryIntent: "Tra cứu dự án bất động sản mới nhất của MIK Group",
  };

  const plan = normalizeQueryPlanIntent(base, "tổng quan dự án mới nhất của MIK");

  assert.match(plan.queries[0] || "", /MIK.*khởi công dự án/i);
  assert.match(plan.queries[1] || "", /MIK.*ra mắt dự án mới/i);
});

test("câu y tế về thuốc, liều dùng hoặc điều trị luôn cần fact_check", () => {
  const base: QueryPlanResult = {
    needsSearch: false,
    intent: "knowledge",
    queries: [],
    summaryIntent: "test",
  };
  const cases = [
    "liều dùng paracetamol cho trẻ em",
    "nên uống thuốc gì khi đau dạ dày",
    "thuốc điều trị cúm A hiện nay",
  ];

  for (const question of cases) {
    const plan = normalizeQueryPlanIntent(base, question);
    assert.equal(plan.needsSearch, true, question);
    assert.equal(plan.intent, "fact_check", question);
    assert.ok(plan.queries.length > 0, question);
  }
});

test("câu y tế mô tả triệu chứng chung không bị ép fact_check", () => {
  const base: QueryPlanResult = {
    needsSearch: false,
    intent: "knowledge",
    queries: [],
    summaryIntent: "test",
  };

  const plan = normalizeQueryPlanIntent(base, "triệu chứng sốt xuất huyết ở trẻ em");

  assert.equal(plan.needsSearch, false);
  assert.equal(plan.intent, "knowledge");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  applyExecutionSignals,
  normalizeQueryPlanIntent,
  extractCleanUserQuery,
  type QueryPlanResult,
} from "./query-planner.js";

function factPlan(): QueryPlanResult {
  return {
    needsSearch: true,
    intent: "fact_check",
    queries: ["tổng quan dự án mẫu"],
    summaryIntent: "test",
  };
}

test("câu tổng quan dự án cần fact_check vì hồ sơ dự án là dữ liệu thương mại biến động", () => {
  const plan = normalizeQueryPlanIntent(factPlan(), "tổng quan dự án Gladia Heights");

  assert.equal(plan.intent, "fact_check");
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

  assert.equal(plan.needsSearch, true);
  assert.equal(plan.intent, "fact_check");
});

test("guardrail nâng câu biến động lên fact_check dù planner LLM bỏ search", () => {
  const unsafePlan: QueryPlanResult = {
    needsSearch: false,
    intent: "knowledge",
    queries: [],
  };
  const cases = [
    "Bí thư Tỉnh ủy Quảng Ngãi hiện nay là ai",
    "giá vàng SJC hôm nay",
    "lịch thi đấu La Liga tối nay",
    "quy định thuế thu nhập cá nhân",
    "tổng quan dự án Serena Riverside",
    "thời tiết Đà Nẵng ngày mai",
    "lỗ hổng bảo mật Chrome mới nhất",
    "điểm chuẩn đại học Bách Khoa năm nay",
    "học phí trường X bao nhiêu",
    "visa Nhật Bản cần thủ tục gì",
    "giờ mở cửa bảo tàng",
    "thông số kỹ thuật máy ảnh Sony A1",
    "đội nào vô địch Champions League",
    "nghiên cứu mới về pin thể rắn",
    "GPT-6 có gì mới",
  ];

  for (const question of cases) {
    const plan = normalizeQueryPlanIntent(unsafePlan, question);
    assert.equal(plan.needsSearch, true, question);
    assert.ok(["fact_check", "realtime_news"].includes(plan.intent), question);
    assert.ok(plan.queries.length > 0, question);
  }
});

test("câu ổn định không bị planner ép tìm kiếm chỉ vì sinh dư query", () => {
  const noisyPlan: QueryPlanResult = {
    needsSearch: false,
    intent: "knowledge",
    queries: ["nguồn RSS không cần thiết"],
  };
  const cases = [
    "giải phương trình bậc hai như thế nào",
    "viết regex kiểm tra email",
    "dịch câu này sang tiếng Anh",
    "giải thích định luật Newton",
    "soạn email cảm ơn khách hàng",
    "soạn báo cáo tổng kết quý",
    "cấu hình nginx reverse proxy như thế nào",
    "giải thích thông số của hàm JavaScript",
  ];

  for (const question of cases) {
    const plan = normalizeQueryPlanIntent(noisyPlan, question);
    assert.equal(plan.needsSearch, false, question);
    assert.equal(plan.intent, "knowledge", question);
    assert.deepEqual(plan.queries, [], question);
  }
});

test("câu tư vấn rủi ro cao ở nhiều lĩnh vực luôn cần kiểm chứng", () => {
  const unsafePlan: QueryPlanResult = { needsSearch: false, intent: "knowledge", queries: [] };
  const cases = [
    "triệu chứng đau ngực có nguy hiểm không",
    "mang thai có nên dùng thực phẩm chức năng này không",
    "hợp đồng này có đủ điều kiện khởi kiện không",
    "nên vay gói lãi suất thả nổi hay cố định",
    "bảo hiểm có chi trả trường hợp này không",
  ];

  for (const question of cases) {
    const plan = normalizeQueryPlanIntent(unsafePlan, question);
    assert.equal(plan.needsSearch, true, question);
    assert.equal(plan.intent, "fact_check", question);
  }
});

test("nội dung quote tham gia phân loại để câu hỏi nối tiếp không mất chủ đề", () => {
  const unsafePlan: QueryPlanResult = { needsSearch: false, intent: "knowledge", queries: [] };
  const plan = normalizeQueryPlanIntent(unsafePlan, "còn hiện nay thì sao", "Bí thư Tỉnh ủy Quảng Ngãi là ai");

  assert.equal(plan.needsSearch, true);
  assert.ok(["fact_check", "realtime_news"].includes(plan.intent));
  assert.match(plan.queries[0] || "", /Bí thư Tỉnh ủy Quảng Ngãi.*hiện nay/i);
});

test("so sánh tư vấn kỹ thuật dùng knowledge dù planner trả fact-check hoặc realtime", () => {
  const cases = [
    "google vision với apple vision cái nào xịn hơn",
    "AWS hay Google Cloud nên dùng cái nào",
    "camera Sony và Canon loại nào phù hợp hơn",
    "so sánh OCR Tesseract vs PaddleOCR",
  ];

  for (const question of cases) {
    for (const intent of ["fact_check", "realtime_news"] as const) {
      const plan = normalizeQueryPlanIntent({ ...factPlan(), intent }, question);
      assert.equal(plan.intent, "knowledge", `${intent}: ${question}`);
    }
  }
});

test("so sánh thuộc lĩnh vực rủi ro cao hoặc hỏi giá hiện tại vẫn cần bằng chứng", () => {
  const cases = [
    "thuốc A hay thuốc B loại nào tốt hơn",
    "cổ phiếu ABC hay XYZ nên đầu tư cái nào",
    "gói vay ngân hàng A hay B tốt hơn",
    "iPhone hay Samsung giá hiện nay cái nào tốt hơn",
  ];

  for (const question of cases) {
    const plan = normalizeQueryPlanIntent(factPlan(), question);
    assert.equal(plan.intent, "fact_check", question);
  }
});

test("extractCleanUserQuery bóc tách sạch sẽ và bảo toàn nguyên vẹn 100% tên thực thể", () => {
  const cases = [
    {
      input: "có lịch thi đấu fifa asean cup 2026 chưa sen chúa mộc miên",
      expected: "lịch thi đấu fifa asean cup 2026",
    },
    {
      input: "check giá vàng sjc hôm nay bao nhiêu vậy bot",
      expected: "giá vàng sjc hôm nay bao nhiêu",
    },
    {
      input: "xem tỷ số trận real madrid vs barca vừa qua với",
      expected: "tỷ số trận real madrid vs barca",
    },
  ];

  for (const c of cases) {
    const res = extractCleanUserQuery(c.input);
    assert.equal(res, c.expected);
  }
});

test("preserveCoreUserEntities khôi phục thực thể viết hoa nếu planner AI vô tình làm mất", () => {
  const rawPlan: QueryPlanResult = {
    needsSearch: true,
    intent: "realtime_news",
    queries: ["lịch thi đấu giải vô địch đông nam á 2026"],
    summaryIntent: "test",
  };

  const plan = normalizeQueryPlanIntent(rawPlan, "có lịch thi đấu FIFA ASEAN Cup 2026 chưa");
  assert.ok(plan.queries.some((q) => /FIFA/i.test(q) && /ASEAN/i.test(q)));
});

test("planner không thể hạ câu hỏi cần kiểm chứng xuống fast", () => {
  const plan = applyExecutionSignals(
    {
      needsSearch: true,
      intent: "fact_check",
      queries: ["giá vàng SJC hôm nay"],
    },
    "giá vàng SJC hôm nay",
    "",
    {
      responseMode: "fast",
      complexity: "low",
      toolIntent: "none",
      riskLevel: "normal",
    },
  );

  assert.equal(plan.responseMode, "grounded");
  assert.equal(plan.riskLevel, "high");
});

test("planner không thể tự cấp action khi người dùng chỉ hỏi giải thích", () => {
  const plan = applyExecutionSignals(
    {
      needsSearch: false,
      intent: "knowledge",
      queries: [],
    },
    "Giải thích cron hoạt động như thế nào",
    "",
    {
      responseMode: "action",
      complexity: "low",
      toolIntent: "execute",
      riskLevel: "normal",
    },
  );

  assert.equal(plan.responseMode, "fast");
  assert.equal(plan.toolIntent, "none");
});

test("câu hỏi chất vấn/phản biện meta (sao em nhầm vậy, bot nói sai rồi) luôn là chat, needsSearch: false", async () => {
  const { planSearchQueries } = await import("./query-planner.js");
  const cases = [
    "Sen chúa sao e nhầm vậy",
    "Sao lại nói sai thế bot",
    "Em nhầm rồi",
    "Sao bot ngáo vậy",
    "Tại sao lại sai thế",
  ];

  for (const q of cases) {
    const res = await planSearchQueries({ question: q, quoteText: "Nội dung cũ" });
    assert.equal(res.needsSearch, false, `Failed on: ${q}`);
    assert.equal(res.intent, "chat", `Failed on: ${q}`);
    assert.deepEqual(res.queries, [], `Failed on: ${q}`);
  }
});


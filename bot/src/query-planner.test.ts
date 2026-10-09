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
      expected: "có lịch thi đấu fifa asean cup 2026 chưa",
    },
    {
      input: "check giá vàng sjc hôm nay bao nhiêu vậy bot",
      expected: "giá vàng sjc hôm nay bao nhiêu vậy",
    },
    {
      input: "xem tỷ số trận real madrid vs barca vừa qua với",
      expected: "xem tỷ số trận real madrid vs barca vừa qua với",
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
    "trả lời lại xem . sếp chú mày cho phép chưa",
    "chú mày yếu",
    "a vừa chát với Sếp của chú mày. chú mày báo có cần duyệt gì đâu. chú mày đang lươn a hả",
  ];

  for (const q of cases) {
    const res = await planSearchQueries({ question: q, quoteText: "Nội dung cũ" });
    assert.equal(res.needsSearch, false, `Failed on: ${q}`);
    assert.equal(res.intent, "chat", `Failed on: ${q}`);
    assert.deepEqual(res.queries, [], `Failed on: ${q}`);
  }
});

test("các slash command video được kích hoạt fast-path lập tức", async () => {
  const { planSearchQueries } = await import("./query-planner.js");
  const mediaCases = [
    { q: "/tiktok 3 đột phá của AI Agent", expectedTask: "motion_video" },
    { q: "/shorts tóm tắt tin tức công nghệ", expectedTask: "motion_video" },
    { q: "/video so sánh đối đầu iPhone và Samsung", expectedTask: "motion_video" },
    { q: "/remotion hiệu ứng karaoke pop scale", expectedTask: "motion_video" },
  ];

  for (const item of mediaCases) {
    const res = await planSearchQueries({ question: item.q });
    assert.equal(res.needsSearch, false, `Failed on: ${item.q}`);
    assert.equal(res.taskType, item.expectedTask, `Failed on: ${item.q}`);
    assert.equal(res.toolIntent, "create", `Failed on: ${item.q}`);
    assert.deepEqual(res.queries, [], `Failed on: ${item.q}`);
  }
});

test("câu yêu cầu làm video tiktok/shorts không bị cướp quyền bởi affirmative execution", async () => {
  const { isAffirmativeTaskExecution } = await import("./query-planner.js");
  
  // Các câu lệnh làm video dài không được tính là affirmative
  assert.equal(isAffirmativeTaskExecution("Làm video tiktok về 3 đột phá của AI Agent  Mộc Miên"), false);
  assert.equal(isAffirmativeTaskExecution("tạo video bằng muse về hoàng hôn"), false);
  assert.equal(isAffirmativeTaskExecution("làm file excel tính lương cho công ty"), false);

  // Các câu khẳng định ngắn gọn tiếp tục tác vụ trước đó
  assert.equal(isAffirmativeTaskExecution("ok làm đi"), true);
  assert.equal(isAffirmativeTaskExecution("làm luôn đi em"), true);
  assert.equal(isAffirmativeTaskExecution("tiến hành đi"), true);
  assert.equal(isAffirmativeTaskExecution("triển khai nhé"), true);
});

test("câu hỏi lý thuyết/thăm dò về tạo ảnh hoặc video KHÔNG bị cướp quyền tạo file", async () => {
  const { planSearchQueries } = await import("./query-planner.js");
  const theoreticalQuery = "tạo video bằng AI có khó không em?";
  const res = await planSearchQueries({ question: theoreticalQuery });
  // Phải được phân loại là chat hoặc không bị gán toolIntent: create
  assert.notEqual(res.toolIntent, "create", `Hypothetical query must not trigger toolIntent: create`);
});

test("câu hỏi khái niệm, lý thuyết, giải thích không bị ép needsSearch=true", async () => {
  const { normalizeQueryPlanIntent } = await import("./query-planner.js");
  const basePlan = {
    needsSearch: false,
    intent: "knowledge" as const,
    queries: [],
  };
  const conceptQueries = [
    "Luật cung cầu trong kinh tế là gì?",
    "Nguyên lý hoạt động của động cơ phản lực",
    "Tại sao thời tiết lại có 4 mùa?",
    "Định nghĩa hợp đồng thông minh trong blockchain",
    "Ý nghĩa của chỉ số P/E trong đầu tư chứng khoán",
  ];

  for (const q of conceptQueries) {
    const res = normalizeQueryPlanIntent(basePlan, q);
    assert.equal(res.needsSearch, false, `Failed on: ${q}`);
    assert.equal(res.intent, "knowledge", `Failed on: ${q}`);
    assert.deepEqual(res.queries, [], `Failed on: ${q}`);
  }
});
test("câu hỏi tra cứu, tìm kiếm hoặc đọc hiểu kèm quote tài liệu KHÔNG bị nhận nhầm thành tạo file", async () => {
  const { checkIsFileOrVoiceGeneration } = await import("./tools/file-generator.js");

  // Sự cố Bác Trần Thuận: quote tin nhắn xin pdf và hỏi tìm bản dịch tiếng việt
  const isFile1 = checkIsFileOrVoiceGeneration(
    "tìm thử bản dịch tiếng việt nha",
    "có bác nào có pdf quyển start with why hem em xin zí ạ",
  );
  assert.equal(isFile1, false);

  // Các câu tra cứu / đọc hiểu / hỏi đáp kèm quote khác
  assert.equal(checkIsFileOrVoiceGeneration("sách này có hay không em", "bác nào có pdf start with why"), false);
  assert.equal(checkIsFileOrVoiceGeneration("tóm tắt nội dung giúp anh nhé", "gửi file pdf báo cáo"), false);
  assert.equal(checkIsFileOrVoiceGeneration("cho mình hỏi tác giả là ai vậy bot", "file pdf start with why"), false);
  assert.equal(checkIsFileOrVoiceGeneration("giải thích ý nghĩa câu này với nha", "file word hop_dong.docx"), false);

  // Câu hỏi tra cứu công cụ/phần mềm/AI (tránh sự cố Bác Nguyễn Huy Hoàng)
  assert.equal(checkIsFileOrVoiceGeneration("@Sen Chúa các phần mềm, AI hỗ trợ chỉnh ảnh"), false);
  assert.equal(checkIsFileOrVoiceGeneration("những công cụ hỗ trợ edit video tốt nhất"), false);
  assert.equal(checkIsFileOrVoiceGeneration("danh sách tool bóc tách âm thanh"), false);
  assert.equal(checkIsFileOrVoiceGeneration("hướng dẫn dịch chuyển biểu đồ trên mt5 bằng chuột"), false);
});

test("isConversationalMessage và planSearchQueries nhận diện chính xác câu xã giao / thông báo cá nhân", async () => {
  const { isConversationalMessage, planSearchQueries } = await import("./query-planner.js");

  // Các câu đàm thoại, tiếp nhận, thông báo cá nhân
  assert.equal(isConversationalMessage("Ok em. Tối nay mình gửi nhé"), true);
  assert.equal(isConversationalMessage("ok em"), true);
  assert.equal(isConversationalMessage("chào em"), true);
  assert.equal(isConversationalMessage("cảm ơn bạn nhé"), true);
  assert.equal(isConversationalMessage("dạ vâng em"), true);
  assert.equal(isConversationalMessage("để mai mình gửi sau nhé"), true);
  assert.equal(isConversationalMessage("chút nữa mình gửi nhé"), true);
  assert.equal(isConversationalMessage("tối nay anh gửi nha"), true);

  // Các câu hỏi dữ liệu thời gian thực / biến động KHÔNG được là conversational
  assert.equal(isConversationalMessage("Tối nay mấy giờ đá bóng?"), false);
  assert.equal(isConversationalMessage("Hôm nay giá vàng bao nhiêu?"), false);
  assert.equal(isConversationalMessage("Ai là huấn luyện viên trưởng tuyển Anh?"), false);

  // Fast-path của planSearchQueries: không search và intent là chat kể cả khi có recentContext cũ
  const res = await planSearchQueries({
    question: "Ok em. Tối nay mình gửi nhé",
    recentContext: "Đề thi khảo sát chất lượng môn Vật lí 12 trường THPT Chuyên Bắc Ninh lần 1 năm học 2024-2025",
  });
  assert.equal(res.needsSearch, false);
  assert.equal(res.intent, "chat");
  assert.deepEqual(res.queries, []);
});


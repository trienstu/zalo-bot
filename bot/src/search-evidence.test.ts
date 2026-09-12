import assert from "node:assert/strict";
import test from "node:test";

import {
  assessEvidenceSufficiency,
  finalizeGroundedAnswer,
  formatEvidenceContext,
  rankEvidence,
  scoreEvidence,
  type SearchEvidence,
} from "./search-evidence.js";

const NOW = Date.UTC(2026, 8, 12);

function evidence(overrides: Partial<SearchEvidence> & Pick<SearchEvidence, "title" | "url">): SearchEvidence {
  return {
    snippet: overrides.title,
    sourceType: "news",
    publishedAt: null,
    retrievedAt: NOW,
    ...overrides,
  };
}

test("xếp nguồn chính thức mới hơn lên trước snippet cũ dài hơn", () => {
  const query = "giám đốc sở giao thông thành phố hiện nay";
  const ranked = rankEvidence([
    evidence({
      title: "Giám đốc Sở Giao thông thành phố nhiệm kỳ trước",
      snippet: "Một đoạn mô tả cũ rất dài, có nhiều chữ nhưng không thể đại diện cho tình trạng hiện tại.",
      url: "https://news.example/old",
      publishedAt: Date.UTC(2023, 1, 1),
    }),
    evidence({
      title: "Công bố Giám đốc Sở Giao thông thành phố",
      url: "https://city.gov.vn/appointment",
      sourceType: "official",
      publishedAt: Date.UTC(2026, 7, 20),
    }),
  ], query, "fact_check", NOW);

  assert.equal(ranked[0]?.url, "https://city.gov.vn/appointment");
});

test("khớp đủ thực thể và thuộc tính cho CEO và huấn luyện viên", () => {
  const cases = [
    ["CEO Acme hiện tại", "Acme công bố CEO hiện tại", "Lịch sử thương hiệu Acme"],
    ["huấn luyện viên trưởng đội Orion hiện nay", "Đội Orion bổ nhiệm huấn luyện viên trưởng", "Orion thắng trận giao hữu"],
  ];

  for (const [query, relevant, generic] of cases) {
    const good = scoreEvidence(evidence({ title: relevant!, url: "https://official.example/item" }), query!, "fact_check", NOW);
    const bad = scoreEvidence(evidence({ title: generic!, url: "https://blog.example/item" }), query!, "fact_check", NOW);
    assert.ok(good.relevanceScore > bad.relevanceScore, query);
  }
});

test("vai trò cấp phó không được xếp ngang vai trò chính khi câu hỏi không hỏi cấp phó", () => {
  const query = "chủ tịch hội đồng Acme hiện nay";
  const ranked = rankEvidence([
    evidence({ title: "Phó chủ tịch hội đồng Acme nhận nhiệm vụ", url: "https://news.example/deputy", publishedAt: Date.UTC(2026, 8, 11) }),
    evidence({ title: "Chủ tịch hội đồng Acme làm việc với đối tác", url: "https://news-two.example/chair", publishedAt: Date.UTC(2026, 8, 8) }),
  ], query, "fact_check", NOW);

  assert.equal(ranked[0]?.url, "https://news-two.example/chair");
});

test("câu hỏi hỏi ai ưu tiên tiêu đề có tín hiệu danh tính cụ thể", () => {
  const query = "chủ tịch hội đồng Acme hiện nay là ai";
  const ranked = rankEvidence([
    evidence({
      title: "Chủ tịch hội đồng Acme: 5 ưu tiên trong nhiệm kỳ mới",
      url: "https://news.example/generic",
      publishedAt: Date.UTC(2026, 8, 10),
    }),
    evidence({
      title: "Chủ tịch hội đồng Jane Doe làm việc với đối tác Acme",
      url: "https://official.example/person",
      sourceType: "primary",
      publishedAt: Date.UTC(2026, 8, 8),
    }),
  ], query, "fact_check", NOW);

  assert.equal(ranked[0]?.url, "https://official.example/person");
});

test("ngày mới hơn phá hòa giữa các bằng chứng cùng độ khớp", () => {
  const query = "giám đốc Acme hiện nay";
  const ranked = rankEvidence([
    evidence({ title: "Giám đốc Acme phát biểu", url: "https://news.example/old", publishedAt: Date.UTC(2026, 5, 1) }),
    evidence({ title: "Giám đốc Acme làm việc", url: "https://news.example/new", publishedAt: Date.UTC(2026, 8, 10) }),
  ], query, "fact_check", NOW);

  assert.equal(ranked[0]?.url, "https://news.example/new");
});

test("kết quả không ngày không bao giờ được coi là mới hơn kết quả có ngày thật", () => {
  const query = "quy định đăng ký phương tiện mới nhất";
  const ranked = rankEvidence([
    evidence({ title: "Quy định đăng ký phương tiện mới nhất", url: "https://blog.example/no-date" }),
    evidence({
      title: "Quy định đăng ký phương tiện mới nhất",
      url: "https://law.gov.vn/rule",
      sourceType: "official",
      publishedAt: Date.UTC(2026, 8, 1),
    }),
  ], query, "fact_check", NOW);

  assert.equal(ranked[0]?.url, "https://law.gov.vn/rule");
  assert.equal(ranked[1]?.publishedAt, null);
});

test("một token chung không đủ cho câu hỏi tài chính hoặc y tế cụ thể", () => {
  const finance = rankEvidence([
    evidence({ title: "Bí quyết giữ giá trị đồ cổ", url: "https://lifestyle.example/story" }),
  ], "giá vàng miếng hôm nay", "fact_check", NOW);
  const health = rankEvidence([
    evidence({ title: "Tin tức bệnh viện địa phương", url: "https://local.example/story" }),
  ], "liều dùng thuốc Nova cho trẻ em", "fact_check", NOW);

  assert.equal(finance.length, 0);
  assert.equal(health.length, 0);
});

test("thứ tự đầu vào không làm thay đổi thứ tự xếp hạng", () => {
  const query = "phiên bản hệ điều hành Acme mới nhất";
  const items = [
    evidence({ title: "Acme giới thiệu phiên bản hệ điều hành mới nhất", url: "https://acme.example/release", sourceType: "primary", publishedAt: Date.UTC(2026, 8, 2) }),
    evidence({ title: "Đánh giá phiên bản hệ điều hành Acme mới nhất", url: "https://news.example/review", publishedAt: Date.UTC(2026, 8, 3) }),
    evidence({ title: "Lịch sử hệ điều hành Acme", url: "https://wiki.example/acme", sourceType: "encyclopedia" }),
  ];

  assert.deepEqual(
    rankEvidence(items, query, "fact_check", NOW).map((item) => item.url),
    rankEvidence([...items].reverse(), query, "fact_check", NOW).map((item) => item.url),
  );
});

test("fact-check đủ bằng chứng với một nguồn chính thức mạnh", () => {
  const ranked = rankEvidence([
    evidence({
      title: "Cơ quan công bố mức phí đăng ký phương tiện",
      snippet: "Mức phí đăng ký phương tiện áp dụng hiện nay",
      url: "https://agency.gov.vn/fees",
      sourceType: "official",
      publishedAt: Date.UTC(2026, 7, 1),
    }),
  ], "mức phí đăng ký phương tiện hiện nay", "fact_check", NOW);

  assert.equal(assessEvidenceSufficiency(ranked, "fact_check").sufficient, true);
});

test("publisher gốc dạng miền chính phủ trong aggregator vẫn được coi là nguồn chính thức", () => {
  const ranked = rankEvidence([
    evidence({
      title: "Công bố giám đốc Acme hiện nay",
      snippet: "Cơ quan xác nhận giám đốc Acme hiện nay.",
      url: "https://news.google.com/rss/articles/example",
      sourceName: "agency.gov.vn",
      sourceType: "news",
      publishedAt: Date.UTC(2026, 8, 1),
    }),
  ], "giám đốc Acme hiện nay", "fact_check", NOW);

  assert.equal(assessEvidenceSufficiency(ranked, "fact_check").sufficient, true);
});

test("fact-check đủ bằng chứng khi hai miền độc lập cùng xác nhận", () => {
  const ranked = rankEvidence([
    evidence({ title: "Acme bổ nhiệm CEO mới", url: "https://source-one.example/acme-ceo", publishedAt: Date.UTC(2026, 8, 1) }),
    evidence({ title: "CEO mới của Acme nhận nhiệm vụ", url: "https://source-two.example/acme-ceo", publishedAt: Date.UTC(2026, 8, 1) }),
  ], "CEO mới của Acme", "fact_check", NOW);

  assert.equal(assessEvidenceSufficiency(ranked, "fact_check").sufficient, true);
});

test("hai nhà xuất bản độc lập qua cùng aggregator vẫn được coi là hai nguồn", () => {
  const ranked = rankEvidence([
    evidence({ title: "Acme bổ nhiệm CEO mới", url: "https://aggregator.example/a", sourceName: "Publisher One", publishedAt: Date.UTC(2026, 8, 1) }),
    evidence({ title: "CEO mới của Acme nhận nhiệm vụ", url: "https://aggregator.example/b", sourceName: "Publisher Two", publishedAt: Date.UTC(2026, 8, 1) }),
  ], "CEO mới của Acme", "fact_check", NOW);

  assert.equal(assessEvidenceSufficiency(ranked, "fact_check").sufficient, true);
});

test("fact-check từ chối một nguồn yếu hoặc không liên quan", () => {
  const ranked = rankEvidence([
    evidence({ title: "Lịch sử Acme", url: "https://wiki.example/acme", sourceType: "encyclopedia" }),
  ], "CEO Acme hiện tại", "fact_check", NOW);

  assert.equal(assessEvidenceSufficiency(ranked, "fact_check").sufficient, false);
});

test("context fact-check ưu tiên nguồn có ngày thật và citation cuối chỉ ghi tên nguồn ngắn", () => {
  const ranked = rankEvidence([
    evidence({
      title: "Đội Orion bổ nhiệm huấn luyện viên trưởng",
      url: "https://orion.example/coach",
      sourceType: "primary",
      sourceName: "orion.example",
      publishedAt: Date.UTC(2026, 8, 1),
    }),
    evidence({ title: "Huấn luyện viên trưởng đội Orion", url: "https://news.example/orion" }),
  ], "huấn luyện viên trưởng đội Orion hiện nay", "fact_check", NOW);
  const context = formatEvidenceContext(ranked, "fact_check");

  assert.match(context, /\[E1\]/);
  assert.match(context, /URL: https:\/\/orion\.example\/coach/);
  assert.match(context, /Ngày công bố: 01\/09\/2026/);
  assert.doesNotMatch(context, /https:\/\/news\.example\/orion/);
  assert.doesNotMatch(context, /Không rõ ngày công bố/);

  const answer = finalizeGroundedAnswer(
    "Đội Orion đã có huấn luyện viên mới.\n\nNguồn kiểm chứng:\n- [E1] Cơ quan tưởng tượng (09/2026)\n- https://outside.example/very-long-url",
    context,
    true,
  );
  assert.doesNotMatch(answer, /Cơ quan tưởng tượng/);
  assert.match(answer, /Nguồn kiểm chứng: orion\.example\./);
  assert.doesNotMatch(answer, /https:\/\/orion\.example\/coach/);
  assert.doesNotMatch(answer, /https:\/\/outside\.example/);
  assert.equal((answer.match(/Nguồn kiểm chứng:/g) || []).length, 1);
});

test("context fact-check bỏ nguồn cũ không ngày và nguồn cấp phó khi đã có bằng chứng chính", () => {
  const ranked = rankEvidence([
    evidence({
      title: "Chủ tịch hội đồng Jane Doe làm việc với đối tác Acme",
      url: "https://official.example/chair",
      sourceType: "primary",
      publishedAt: Date.UTC(2026, 8, 8),
    }),
    evidence({
      title: "Chủ tịch hội đồng John Roe được chỉ định nhiệm kỳ 2020-2025",
      snippet: "Thông tin nhiệm kỳ 2020-2025.",
      url: "https://agency.gov.vn/old-chair",
      sourceType: "official",
      publishedAt: null,
    }),
    evidence({
      title: "Phó chủ tịch hội đồng Acme nhận nhiệm vụ",
      url: "https://agency.gov.vn/deputy",
      sourceType: "official",
      publishedAt: Date.UTC(2026, 8, 10),
    }),
  ], "chủ tịch hội đồng Acme hiện nay là ai", "fact_check", NOW);
  const context = formatEvidenceContext(ranked, "fact_check");

  assert.match(context, /https:\/\/official\.example\/chair/);
  assert.doesNotMatch(context, /https:\/\/agency\.gov\.vn\/old-chair/);
  assert.doesNotMatch(context, /https:\/\/agency\.gov\.vn\/deputy/);
});

test("context thiếu bằng chứng buộc câu trả lời từ chối thay vì đoán", () => {
  const context = formatEvidenceContext([], "fact_check");
  const answer = finalizeGroundedAnswer("Tôi đoán người giữ chức vụ là X.", context, true);

  assert.doesNotMatch(answer, /là X/);
  assert.match(answer, /chưa đủ bằng chứng/i);
});

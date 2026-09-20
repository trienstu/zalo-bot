import assert from "node:assert/strict";
import test from "node:test";

import { detectNewsCategories, matchesVolatileTopic, parseOpenWebRssItems } from "./realtime-search.js";
import { formatEvidenceContext, rankEvidence } from "./search-evidence.js";

const NOW = Date.UTC(2026, 8, 12);

test("Bing RSS giữ ngày thật và để nguồn không ngày ở trạng thái không rõ", () => {
  const xml = `
    <rss><channel>
      <item>
        <title>Acme công bố CEO mới</title>
        <description>Acme xác nhận CEO mới nhận nhiệm vụ.</description>
        <link>https://company.example/ceo</link>
        <pubDate>Tue, 01 Sep 2026 03:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Lịch sử lãnh đạo Acme</title>
        <description>Trang tổng hợp không ghi ngày xuất bản.</description>
        <link>https://archive.example/acme</link>
      </item>
    </channel></rss>`;

  const items = parseOpenWebRssItems(xml, NOW);
  assert.equal(items[0]?.timestamp, Date.UTC(2026, 8, 1, 3));
  assert.match(items[0]?.timeLabel || "", /01\/09\/2026/);
  assert.equal(items[1]?.timestamp, 0);
  assert.equal(items[1]?.timeLabel, "Không rõ ngày công bố");
  assert.equal(items[1]?.ageHours, Number.POSITIVE_INFINITY);
});

test("context fact-check bỏ nguồn yếu không ngày khi đã có bằng chứng có ngày", () => {
  const query = "CEO mới của Acme hiện nay";
  const ranked = rankEvidence([
    {
      title: "Acme công bố CEO mới",
      snippet: "Thông cáo bổ nhiệm CEO mới của Acme.",
      url: "https://acme.example/press-release",
      sourceType: "primary",
      sourceName: "Acme",
      publishedAt: Date.UTC(2026, 8, 1),
    },
    {
      title: "CEO mới của Acme chia sẻ kế hoạch",
      snippet: "Một bài phỏng vấn cung cấp thêm bối cảnh.",
      url: "https://news.example/interview",
      sourceType: "news",
      sourceName: "News Example",
      publishedAt: null,
    },
  ], query, "fact_check", NOW);
  const context = formatEvidenceContext(ranked, "fact_check");

  assert.match(context, /EVIDENCE_STATUS: SUFFICIENT/);
  assert.match(context, /URL: https:\/\/acme\.example\/press-release/);
  assert.match(context, /Ngày công bố: 01\/09\/2026/);
  assert.doesNotMatch(context, /URL: https:\/\/news\.example\/interview/);
  assert.doesNotMatch(context, /Không rõ ngày công bố/);
});

test("phân loại các nhu cầu cần dữ liệu mới theo lĩnh vực, không phụ thuộc một thực thể cụ thể", () => {
  assert.deepEqual(detectNewsCategories("Cảnh báo bão và lũ quét mới nhất"), [
    "thoi-su",
    "thoi-tiet-thien-tai",
  ]);
  assert.deepEqual(detectNewsCategories("Lỗ hổng zero-day mới trên trình duyệt"), [
    "an-ninh-mang",
  ]);
  assert.deepEqual(detectNewsCategories("Giá Bitcoin và tin tiền điện tử hôm nay"), [
    "crypto",
  ]);
  assert.deepEqual(detectNewsCategories("Lịch thi đấu V-League hôm nay"), [
    "the-thao",
  ]);
  assert.deepEqual(detectNewsCategories("tin mới nhất hôm nay về AI"), [
    "so-hoa",
  ]);
  assert.deepEqual(detectNewsCategories("cập nhật thị trường xe điện mới nhất"), [
    "xe-co",
  ]);
});

test("lọc tin dài nhưng sai thuộc tính khỏi câu hỏi giá vàng", () => {
  assert.equal(matchesVolatileTopic({
    title: "Chứng khoán Việt Nam được nâng hạng",
    snippet: "Thị trường chuyển từ cận biên lên mới nổi và doanh nghiệp chuẩn bị niêm yết quốc tế.",
  }, "giá vàng hôm nay"), false);
  assert.equal(matchesVolatileTopic({
    title: "Giá vàng SJC tăng trong phiên sáng",
    snippet: "Vàng miếng được niêm yết theo giá mua vào và bán ra.",
  }, "giá vàng hôm nay"), true);
});

test("lọc lịch thể thao theo đúng giải được hỏi", () => {
  assert.equal(matchesVolatileTopic({ title: "Lịch thi đấu La Liga hôm nay", snippet: "Các trận vòng 7" }, "lịch thi đấu La Liga hôm nay"), true);
  assert.equal(matchesVolatileTopic({ title: "Lịch bóng đá Thụy Điển", snippet: "Các trận giải Ettan" }, "lịch thi đấu La Liga hôm nay"), false);
});

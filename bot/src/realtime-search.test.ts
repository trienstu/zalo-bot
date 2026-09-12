import assert from "node:assert/strict";
import test from "node:test";

import { parseOpenWebRssItems } from "./realtime-search.js";
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

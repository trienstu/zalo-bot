import test from "node:test";
import assert from "node:assert/strict";
import { formatZaloMarkdown, formatAndChunkZaloMarkdown, pickSmartReaction } from "./zalo-formatter.js";
import { Reactions } from "zca-js";

test("formatZaloMarkdown: Chuyển đổi **in đậm** thành Zalo Bold Style", () => {
  const input = "Xin chào **Thành viên VIP** đã tham gia!";
  const res = formatZaloMarkdown(input);

  assert.equal(res.msg, "Xin chào Thành viên VIP đã tham gia!");
  assert.equal(res.styles.length, 1);
  assert.equal(res.styles[0]?.st, "b");
  assert.equal(res.msg.slice(res.styles[0]!.start, res.styles[0]!.start + res.styles[0]!.len), "Thành viên VIP");
});

test("formatZaloMarkdown: Hỗ trợ thẻ màu sắc [do], [xanh], [cam], [vang]", () => {
  const input = "Cảnh báo: [do]Nguy hiểm[/do] và [xanh]An toàn[/xanh]!";
  const res = formatZaloMarkdown(input);

  assert.equal(res.msg, "Cảnh báo: Nguy hiểm và An toàn!");
  assert.equal(res.styles.length, 2);
  assert.equal(res.styles[0]?.st, "c_db342e"); // Red
  assert.equal(res.styles[1]?.st, "c_15a85f"); // Green
});

test("formatZaloMarkdown: Chuyển tiêu đề Markdown ## thành In đậm + Chữ to", () => {
  const input = "## BÁO CÁO THỊ TRƯỜNG\nNội dung chi tiết ở đây.";
  const res = formatZaloMarkdown(input);

  assert.equal(res.msg, "BÁO CÁO THỊ TRƯỜNG\nNội dung chi tiết ở đây.");
  // Heading has Bold ('b') and Big ('f_18')
  const headingStyles = res.styles.filter((s) => s.start === 0 && s.len === "BÁO CÁO THỊ TRƯỜNG".length);
  assert.ok(headingStyles.some((s) => s.st === "b"));
  assert.ok(headingStyles.some((s) => s.st === "f_18"));
});

test("formatAndChunkZaloMarkdown: Tự động phân đoạn khi vượt giới hạn 2000 ký tự hoặc 40 styles", () => {
  const longParagraph = "Đây là một đoạn phân tích rất dài về công nghệ và tài chính. ".repeat(40);
  const chunks = formatAndChunkZaloMarkdown(longParagraph);

  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.msg.length <= 2000);
    assert.ok(chunk.styles.length <= 40);
  }
});

test("pickSmartReaction: Tự động nhận diện ngữ cảnh cảm xúc chính xác", () => {
  const hahaCandidates = [Reactions.HAHA, Reactions.TEARS_OF_JOY, Reactions.BIG_SMILE];
  assert.ok(hahaCandidates.includes(pickSmartReaction("Haha buồn cười quá bot ơi") as any));

  const thanksCandidates = [Reactions.PRAY, Reactions.THANKS, Reactions.ROSE, Reactions.PEACE];
  assert.ok(thanksCandidates.includes(pickSmartReaction("Em cảm ơn bác nhiều nhé") as any));

  const coolCandidates = [Reactions.COOL, Reactions.HANDCLAP, Reactions.SUNGLASSES, Reactions.WOW];
  assert.ok(coolCandidates.includes(pickSmartReaction("Quá đỉnh luôn, xuất sắc") as any));

  const confusedCandidates = [Reactions.CONFUSED, Reactions.NERD, Reactions.OK];
  assert.ok(confusedCandidates.includes(pickSmartReaction("Tại sao lại như thế nhỉ? Cần kiểm tra lại") as any));

  const cryCandidates = [Reactions.CRY, Reactions.SAD, Reactions.BROKEN_HEART];
  assert.ok(cryCandidates.includes(pickSmartReaction("Tiếc quá, buồn ghê") as any));
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  setPendingAction,
  getPendingAction,
  clearPendingAction,
  isAffirmativeConfirmation,
  isCancelConfirmation,
} from "./pending-actions.js";
import {
  isRealEstateProjectProfileQuery,
  buildRealEstateProjectSearchQueries,
} from "./real-estate-profile.js";

test("pending-actions lưu trữ, lấy lại và dọn dẹp chính xác theo threadId và userId", () => {
  const threadId = "thread-123";
  const userId = "user-456";

  clearPendingAction(threadId, userId);
  assert.equal(getPendingAction(threadId, userId), null);

  setPendingAction(threadId, userId, {
    type: "create_presentation_video",
    summary: "Dựng video slide dự án",
    data: { userPrompt: "Làm video 5 slide", slideCount: 5 },
  });

  const pending = getPendingAction(threadId, userId);
  assert.ok(pending);
  assert.equal(pending.type, "create_presentation_video");
  assert.equal(pending.summary, "Dựng video slide dự án");
  assert.equal(pending.data.slideCount, 5);

  clearPendingAction(threadId, userId);
  assert.equal(getPendingAction(threadId, userId), null);
});

test("isAffirmativeConfirmation và isCancelConfirmation nhận diện chuẩn xác các biến thể tiếng Việt", () => {
  const affirmativeCases = [
    "ok",
    "oke",
    "okie",
    "ok em",
    "ok nhé",
    "ok nha",
    "duyệt",
    "tiến hành",
    "tiến hành đi",
    "làm đi",
    "làm luôn",
    "chốt đi",
    "thực hiện đi",
    "triển đi",
  ];

  for (const text of affirmativeCases) {
    assert.equal(isAffirmativeConfirmation(text), true, `Failed on affirmative: ${text}`);
  }

  const cancelCases = [
    "hủy",
    "thôi",
    "bỏ",
    "không",
    "cancel",
    "đừng",
    "bỏ qua",
    "dừng",
  ];

  for (const text of cancelCases) {
    assert.equal(isCancelConfirmation(text), true, `Failed on cancel: ${text}`);
  }

  assert.equal(isAffirmativeConfirmation("chưa làm"), false);
  assert.equal(isCancelConfirmation("tiếp tục"), false);
});

test("isRealEstateProjectProfileQuery nhận diện câu hỏi tư vấn đầu tư / chiến lược dự án BĐS", () => {
  const query = "e tư vấn chiến lược cho a, thời điểm này có nên đầu tư dự án Sunshine Legend City ko? và phân tích nguyên nhân";
  assert.equal(isRealEstateProjectProfileQuery(query), true);

  const queries = buildRealEstateProjectSearchQueries(query);
  assert.ok(queries.length >= 3);
  assert.ok(queries.some((q) => q.toLowerCase().includes("sunshine legend city")));
  assert.ok(queries.some((q) => q.toLowerCase().includes("tiềm năng đầu tư")));
});

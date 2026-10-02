import test from "node:test";
import assert from "node:assert/strict";
import {
  checkIsFileOrVoiceGeneration,
  isImageRequest,
} from "../tools/file-generator.js";
import { isMotionVideoRequest } from "./motion-video-processor.js";
import { isPresentationVideoRequest } from "./presentation-video-processor.js";
import {
  isAffirmativeConfirmation,
  isCancelConfirmation,
  setPendingAction,
  getPendingAction,
  clearPendingAction,
} from "../pending-actions.js";
import {
  registerRenderJob,
  cancelActiveRenderJob,
  unregisterRenderJob,
} from "./active-render-jobs.js";

test("Phương án B: Phân biệt rõ File vật lý (cần xác nhận 2 bước) vs Ảnh tạo trong chat (trực tiếp)", () => {
  // 1. Các file vật lý (Word, Excel, PowerPoint, CSV, Audio, Video): Bắt buộc rơi vào isPhysicalFileReq
  const physicalQueries = [
    "tạo file word tóm tắt nội dung cuộc họp",
    "xuất file excel báo cáo doanh thu tháng này",
    "làm bài thuyết trình powerpoint về AI Agent",
    "xuất file csv danh sách thành viên",
    "đọc thơ diễn cảm bài thơ này thành file audio",
    "chuyển tài liệu này sang file word",
  ];

  for (const q of physicalQueries) {
    const isFile = checkIsFileOrVoiceGeneration(q);
    const isImg = isImageRequest(q);
    assert.equal(isFile, true, `Câu này phải là yêu cầu file/voice: "${q}"`);
    assert.equal(isImg, false, `Câu này không được nhận là ảnh: "${q}"`);
  }

  // 2. Yêu cầu tạo/vẽ ảnh (Option B: Trực tiếp, không hỏi xác nhận 2 bước)
  const imageQueries = [
    "vẽ ảnh một chú mèo phi hành gia trong vũ trụ",
    "tạo ảnh logo phong cách tối giản",
    "thiết kế ảnh banner khai trương quán cafe",
    "/taoanh phong cảnh hoàng hôn trên biển",
  ];

  for (const q of imageQueries) {
    const isImg = isImageRequest(q);
    assert.equal(isImg, true, `Câu này phải là yêu cầu ảnh trực tiếp: "${q}"`);
  }
});

test("Chống hiểu nhầm câu hỏi tra cứu công cụ / repo và chống lỗi regex chữ 'u'", () => {
  // Sự cố Bác Vũ: "Có repo nào tạo video vox style k"
  assert.equal(isMotionVideoRequest("Có repo nào tạo video vox style k"), false);
  assert.equal(isPresentationVideoRequest("Có repo nào tạo video vox style k"), false);
  assert.equal(checkIsFileOrVoiceGeneration("Có repo nào tạo video vox style k"), false);

  // Sự cố Thầy Hoa Van: Khen ảnh minh họa hoặc nói từ có chữ 'u' (như 'quá', 'đâu') kèm quote
  const quoteVideoProposal = "🎬 Sếp có muốn em dựng Video TikTok Remotion không ạ?";
  assert.equal(isMotionVideoRequest("Quá đẹp, mình thích hình ảnh này", quoteVideoProposal), false);
  assert.equal(isPresentationVideoRequest("Quá chuẩn luôn", quoteVideoProposal), false);

  // Người dùng từ chối / bảo rút điện / đâu cần
  assert.equal(isMotionVideoRequest("rút điện á", quoteVideoProposal), false);
  assert.equal(isMotionVideoRequest("đâu cần đâu nào", quoteVideoProposal), false);
  assert.equal(isPresentationVideoRequest("rút điện á", quoteVideoProposal), false);
  assert.equal(isPresentationVideoRequest("đâu cần đâu nào", quoteVideoProposal), false);
});

test("Quy trình xác nhận 2 bước: pending -> 'ok'/'tiến hành' -> thực thi, hoặc 'rút điện'/'hủy' -> dừng an toàn", () => {
  const threadId = "thread_group_confirm_test";
  const userId = "user_sender_test";

  clearPendingAction(threadId, userId);

  // Bước 1: Khi có yêu cầu tạo file Word/Video, hệ thống ghi nhận Pending Action
  setPendingAction(threadId, userId, {
    type: "generate_file",
    userName: "Anh Vũ",
    data: { userPrompt: "Tạo file Word tóm tắt" },
    summary: "Tạo file Word: Tạo file Word tóm tắt",
  });

  const pending = getPendingAction(threadId, userId);
  assert.ok(pending);
  assert.equal(pending.type, "generate_file");

  // Bước 2A: Nếu người dùng xác nhận "ok" hoặc "tiến hành"
  assert.equal(isAffirmativeConfirmation("ok"), true);
  assert.equal(isAffirmativeConfirmation("tiến hành đi"), true);
  assert.equal(isAffirmativeConfirmation("làm đi em"), true);

  // Bước 2B: Nếu người dùng nhắn "rút điện á", "thôi khỏi", "đâu cần" -> Hủy pending và dừng job render
  assert.equal(isCancelConfirmation("rút điện á"), true);
  assert.equal(isCancelConfirmation("đâu cần đâu nào"), true);
  assert.equal(isCancelConfirmation("thôi khỏi"), true);
  assert.equal(isCancelConfirmation("hủy bỏ"), true);

  // Kiểm tra hủy render job nền bằng signal
  const jobId = "render_job_test_123";
  const abortCtrl = new AbortController();
  registerRenderJob({
    jobId,
    threadId,
    userId,
    type: "motion_video",
    title: "Video test",
    abortController: abortCtrl,
    cancelled: false,
    startTime: Date.now(),
  });

  const cancelResult = cancelActiveRenderJob(threadId);
  assert.equal(cancelResult.cancelled, true);
  assert.equal(abortCtrl.signal.aborted, true);

  clearPendingAction(threadId, userId);
  unregisterRenderJob(threadId, jobId);
  assert.equal(getPendingAction(threadId, userId), null);
});

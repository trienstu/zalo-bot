import test from "node:test";
import assert from "node:assert/strict";
import {
  isMotionVideoRequest,
  determineMotionVideoGenre,
} from "./motion-video-processor.js";

test("isMotionVideoRequest nhận diện chính xác các yêu cầu làm video Remotion / TikTok / So sánh", () => {
  // 1. Nhận diện các câu lệnh tạo video shorts / tiktok / motion
  assert.equal(isMotionVideoRequest("làm video tiktok 3 sai lầm của người mới học AI"), true);
  assert.equal(isMotionVideoRequest("tạo video shorts giới thiệu dự án"), true);
  assert.equal(isMotionVideoRequest("dựng video so sánh vàng SJC và bất động sản"), true);
  assert.equal(isMotionVideoRequest("làm video tin nóng thị trường chứng khoán sáng nay"), true);
  assert.equal(isMotionVideoRequest("xuất video chuyển động Remotion tóm tắt nội dung này"), true);
  assert.equal(isMotionVideoRequest("làm video clip tiktok về kiến trúc bot zalo"), true);
  assert.equal(isMotionVideoRequest("làm video vox về tệ nạn ma túy"), true);
  assert.equal(isMotionVideoRequest("tạo video explainer phân tích thị trường bất động sản"), true);

  // 2. Chống nhận nhầm khi chỉ là khiếu nại, tải link, tóm tắt video
  assert.equal(isMotionVideoRequest("sao bot lại tự làm video thế?"), false);
  assert.equal(isMotionVideoRequest("tải video tiktok https://www.tiktok.com/@user/video/123"), false);
  assert.equal(isMotionVideoRequest("tóm tắt video này giúp tôi với"), false);

  // 3. Phủ định tuyệt đối nếu có từ khóa Muse (để dành cho Muse AI Video)
  assert.equal(isMotionVideoRequest("tạo video bằng muse về hoàng hôn trên biển"), false);
  assert.equal(isMotionVideoRequest("dùng muse2api biến ảnh này thành video"), false);
  assert.equal(isMotionVideoRequest("vẽ video muse"), false);

  // 4. Nhận diện các Slash commands trực tiếp
  assert.equal(isMotionVideoRequest("/tiktok 3 sai lầm của trader"), true);
  assert.equal(isMotionVideoRequest("/shorts giới thiệu bot sen chúa"), true);
  assert.equal(isMotionVideoRequest("/video phân tích thị trường vàng"), true);
  assert.equal(isMotionVideoRequest("/remotion"), true);

  // 5. Chống nhận nhầm câu hỏi hoài nghi hoặc thăm dò năng lực
  const quoteWithVideo = "Repo này dùng để ghép ảnh làm video hoạt họa chuyển động";
  assert.equal(isMotionVideoRequest("@Sen Chúa có thiệt e tự làm được ko đó", quoteWithVideo), false);
  assert.equal(isMotionVideoRequest("có thật bot tự làm được video không?", quoteWithVideo), false);
  assert.equal(isMotionVideoRequest("làm video có khó không nhỉ?", quoteWithVideo), false);

  // 6. Nhận diện yêu cầu chuyển đổi trích dẫn (quote transformation)
  const newsQuote = "Thị trường hôm nay tăng mạnh 20 điểm nhờ nhóm cổ phiếu ngân hàng";
  assert.equal(isMotionVideoRequest("làm video tiktok", newsQuote), true);
  assert.equal(isMotionVideoRequest("chuyển thành video shorts", newsQuote), true);
  assert.equal(isMotionVideoRequest("video hóa đoạn này", newsQuote), true);

  // 7. Nhận diện phản hồi đồng ý khi bot đề xuất
  const quoteProposal = "🎬 Sếp có muốn em xuất bản Video TikTok đồ họa chuyển động không ạ?";
  assert.equal(isMotionVideoRequest("ok triển đi em", quoteProposal), true);
  assert.equal(isMotionVideoRequest("làm luôn đi", quoteProposal), true);
  assert.equal(isMotionVideoRequest(""), false);
});

test("determineMotionVideoGenre phân loại chính xác 5 thể loại video", () => {
  assert.equal(determineMotionVideoGenre("làm video so sánh vàng và chứng khoán"), "versus");
  assert.equal(determineMotionVideoGenre("dựng video đối đầu iPhone vs Samsung"), "versus");

  assert.equal(determineMotionVideoGenre("làm video tin nóng thị trường sáng nay"), "breaking_news");
  assert.equal(determineMotionVideoGenre("dựng video thời sự cập nhật tin bão"), "breaking_news");

  assert.equal(determineMotionVideoGenre("làm video thuyết trình 16:9 báo cáo dự án"), "landscape");
  assert.equal(determineMotionVideoGenre("dựng video ngang keynote cho ban giám đốc"), "landscape");
  assert.equal(determineMotionVideoGenre("làm video vox phân tích kinh tế"), "landscape");

  assert.equal(determineMotionVideoGenre("làm video tiktok 3 bí mật của AI Agent"), "tiktok_story");
  assert.equal(determineMotionVideoGenre("dựng video shorts phụ đề karaoke nhảy chữ"), "tiktok_story");

  assert.equal(determineMotionVideoGenre("làm video ngắn tóm tắt kiến thức"), "spotlight");
});

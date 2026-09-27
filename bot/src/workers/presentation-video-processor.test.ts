import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import sharp from "sharp";
import {
  isPresentationVideoRequest,
  renderSlideToImageWithSharp,
  createSlideVideoSegment,
  concatenateVideoSegments,
  renderPresentationVideoFromSlides,
} from "./presentation-video-processor.js";
import { getTheme } from "../tools/file-generator.js";

test("isPresentationVideoRequest nhận diện chính xác các yêu cầu tạo video bài thuyết trình / video slide", () => {
  // Các câu lệnh dương tính (Positive cases)
  assert.equal(isPresentationVideoRequest("Làm cho anh video thuyết trình 5 slide giới thiệu dự án Palm River"), true);
  assert.equal(isPresentationVideoRequest("Tạo video bài giảng kèm slide về chuyển đổi số doanh nghiệp"), true);
  assert.equal(isPresentationVideoRequest("Xuất video slide thuyết minh giới thiệu sản phẩm mới"), true);
  assert.equal(isPresentationVideoRequest("Tạo video trình chiếu từ tài liệu này kèm giọng đọc"), true);
  assert.equal(isPresentationVideoRequest("Làm clip thuyết trình kèm kịch bản thuyết minh"), true);
  assert.equal(isPresentationVideoRequest("chuyển bài viết này thành video thuyết trình nhé", "Dự án năng lượng mặt trời"), true);
  assert.equal(isPresentationVideoRequest("tạo video powerpoint kèm giọng đọc AI"), true);
  assert.equal(
    isPresentationVideoRequest(
      "sen chúa hãy làm video giải thích kiến trúc SQLite đơn giản dễ hiểu và cách vận hành để xử lý lịch sử, ghi nhớ ngữ cảnh mượt mà cho multi-channel và multi-group, khổ dọc",
    ),
    true,
  );
  assert.equal(isPresentationVideoRequest("dựng cho anh 1 clip ngắn giải thích quy trình bóc băng âm thanh nhé"), true);

  // Các câu hỏi phủ định (Negative cases)
  assert.equal(isPresentationVideoRequest("Tạo slide powerpoint 5 trang về du lịch Đà Lạt"), false); // Chỉ tạo slide PPTX
  assert.equal(isPresentationVideoRequest("Làm file word hợp đồng mua bán nhà đất"), false);
  assert.equal(isPresentationVideoRequest("Tạo bản nhạc remix sôi động mùa hè"), false);
  assert.equal(isPresentationVideoRequest("bot có biết làm video thuyết trình không nhỉ?"), false); // Câu hỏi thăm dò
  assert.equal(isPresentationVideoRequest("làm video trên TikTok có khó không bot?"), false); // Câu hỏi ý kiến
  assert.equal(isPresentationVideoRequest("xin chào bot, hôm nay thời tiết thế nào"), false);
  assert.equal(
    isPresentationVideoRequest(
      "tóm tắt ko chuẩn rồi e ơi. Repo này chuyên tải video, âm thanh... Dành cho người làm nội dung cần tải video tư liệu bài giảng",
    ),
    false,
  );
  assert.equal(isPresentationVideoRequest("tóm tắt video này giúp tôi với"), false);
  assert.equal(isPresentationVideoRequest("phần mềm này dùng để tải video Douyin và Kuaishou"), false);
  assert.equal(isPresentationVideoRequest(""), false);
});

test("renderSlideToImageWithSharp xuất ảnh slide 1080p Full HD (1920x1080) chuẩn xác", async () => {
  const tmpImg = path.join("/tmp", `test_sharp_slide_${Date.now()}.png`);
  const theme = getTheme("navy");

  try {
    await renderSlideToImageWithSharp(
      {
        layout: "title",
        title: "Dự Án Palm River Đột Phá 2026",
        subtitle: "Chiến lược phát triển khu đô thị sinh thái thông minh",
        kicker: "BÁO CÁO CHIẾN LƯỢC",
      },
      theme,
      0,
      3,
      tmpImg,
    );

    assert.equal(fs.existsSync(tmpImg), true);
    const meta = await sharp(tmpImg).metadata();
    assert.equal(meta.width, 1920);
    assert.equal(meta.height, 1080);
    assert.equal(meta.format, "png");
  } finally {
    if (fs.existsSync(tmpImg)) {
      fs.unlinkSync(tmpImg);
    }
  }
});

test("createSlideVideoSegment và concatenateVideoSegments ghép video MP4 chuẩn chỉnh qua ffmpeg", async () => {
  const tmpDir = path.join("/tmp", `test_video_pipeline_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const ffmpegBin = execSync("which ffmpeg 2>/dev/null", { encoding: "utf8" }).trim();
  if (!ffmpegBin) {
    console.log("Bỏ qua test ffmpeg vì không tìm thấy binary ffmpeg.");
    return;
  }

  const slideImg1 = path.join(tmpDir, "slide1.png");
  const slideImg2 = path.join(tmpDir, "slide2.png");
  const audio1 = path.join(tmpDir, "audio1.mp3");
  const audio2 = path.join(tmpDir, "audio2.mp3");
  const seg1 = path.join(tmpDir, "seg1.mp4");
  const seg2 = path.join(tmpDir, "seg2.mp4");
  const concatTxt = path.join(tmpDir, "concat.txt");
  const finalMp4 = path.join(tmpDir, "final.mp4");

  try {
    // 1. Tạo 2 ảnh slide test
    const theme = getTheme("blue");
    await renderSlideToImageWithSharp(
      { layout: "title", title: "Slide 1 Test", subtitle: "Giới thiệu" },
      theme,
      0,
      2,
      slideImg1,
    );
    await renderSlideToImageWithSharp(
      {
        layout: "bullets",
        title: "Slide 2 Test",
        bullets: ["Ý 1: Tối ưu hiệu suất", "Ý 2: Trải nghiệm mượt mà"],
        takeaway: "Giải pháp toàn diện",
      },
      theme,
      1,
      2,
      slideImg2,
    );

    // 2. Tạo 2 file audio test (1.5 giây mỗi file)
    execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 1.5 -q:a 9 -acodec libmp3lame "${audio1}" 2>/dev/null`);
    execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 1.5 -q:a 9 -acodec libmp3lame "${audio2}" 2>/dev/null`);

    // 3. Dựng từng phân đoạn
    await createSlideVideoSegment(ffmpegBin, slideImg1, audio1, seg1);
    await createSlideVideoSegment(ffmpegBin, slideImg2, audio2, seg2);

    assert.equal(fs.existsSync(seg1), true);
    assert.equal(fs.existsSync(seg2), true);
    assert.ok(fs.statSync(seg1).size > 1000);
    assert.ok(fs.statSync(seg2).size > 1000);

    // 4. Ghép 2 phân đoạn thành video tổng thể
    await concatenateVideoSegments(ffmpegBin, [seg1, seg2], concatTxt, finalMp4);

    assert.equal(fs.existsSync(finalMp4), true);
    assert.ok(fs.statSync(finalMp4).size > 2000);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test("renderPresentationVideoFromSlides xuất bản file MP4 và PowerPoint từ slide data", async () => {
  const result = await renderPresentationVideoFromSlides(
    "test_pipeline_video",
    "Test Video Kiến Trúc SQLite",
    [
      {
        layout: "title",
        title: "Kiến Trúc SQLite Đa Nhóm",
        subtitle: "Phân tích hệ thống lưu trữ và đồng bộ",
        speakerNotes: "Xin chào các bạn, hôm nay chúng ta cùng tìm hiểu kiến trúc SQLite trong bot Zalo.",
      },
      {
        layout: "bullets",
        title: "Ưu Điểm Cốt Lõi",
        bullets: ["Hiệu năng cao", "Không phụ thuộc server ngoài", "WAL mode siêu tốc"],
        speakerNotes: "SQLite hoạt động cực kỳ nhanh với WAL mode và đáp ứng tức thì.",
      },
    ],
    "navy",
  );

  assert.equal(result.success, true);
  assert.equal(result.isVideo, true);
  assert.ok(result.filePath.endsWith(".mp4"));
  assert.equal(fs.existsSync(result.filePath), true);
  assert.ok(result.fileSize > 2000);
  assert.ok(result.pptxPath && fs.existsSync(result.pptxPath));

  // Clean up
  try {
    if (fs.existsSync(result.filePath)) fs.unlinkSync(result.filePath);
    if (result.pptxPath && fs.existsSync(result.pptxPath)) fs.unlinkSync(result.pptxPath);
  } catch {}
});


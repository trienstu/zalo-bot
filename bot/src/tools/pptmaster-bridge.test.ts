import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSlideSVG,
  getPPTMasterConfig,
} from "./pptmaster-bridge.js";
import { getTheme, type SlideContent } from "./file-generator.js";

test("generateSlideSVG sinh mã SVG chuẩn DrawingML (không chứa dominant-baseline, thoát XML đúng)", () => {
  const theme = getTheme("navy");
  const slideCover: SlideContent = {
    layout: "title",
    title: "Báo Cáo Chiến Lược & Phát Triển <2026>",
    subtitle: "Tối ưu hóa quy trình 'AI' & Automation",
    kicker: "TỔNG QUAN",
  };

  const svgCover = generateSlideSVG(slideCover, 0, 3, theme);
  assert.ok(svgCover.includes("<svg"), "Phải chứa thẻ mở svg");
  assert.ok(svgCover.includes("viewBox=\"0 0 1280 720\""), "Phải có kích thước 1280x720");
  assert.ok(!svgCover.includes("dominant-baseline"), "TUYỆT ĐỐI KHÔNG chứa dominant-baseline gây lỗi DrawingML");
  assert.ok(svgCover.includes("&amp;"), "Phải thoát ký tự & thành &amp;");
  assert.ok(svgCover.includes("&lt;2026&gt;"), "Phải thoát dấu < > thành &lt; &gt;");

  const slideStats: SlideContent = {
    layout: "stats",
    title: "Chỉ Số Tăng Trưởng",
    stats: [
      { value: "98.5%", label: "Tỷ lệ chính xác", desc: "Đo đạc thực nghiệm" },
      { value: "+150%", label: "Tốc độ xử lý", desc: "So với phiên bản cũ" },
    ],
  };

  const svgStats = generateSlideSVG(slideStats, 1, 3, theme);
  assert.ok(svgStats.includes("stat_card_1"), "Phải render card stat 1");
  assert.ok(svgStats.includes("98.5%"), "Phải chứa giá trị số liệu");
  assert.ok(!svgStats.includes("dominant-baseline"), "Slide stats không chứa dominant-baseline");
});

test("getPPTMasterConfig nhận diện môi trường cấu hình chính xác", () => {
  const config = getPPTMasterConfig();
  assert.ok(typeof config.isAvailable === "boolean", "isAvailable phải là boolean");
  assert.ok(typeof config.pythonBin === "string", "pythonBin phải là string");
  assert.ok(typeof config.rootDir === "string", "rootDir phải là string");
});

test("wrapTextToLines ngắt dòng chính xác và không bị tràn text", async () => {
  const { wrapTextToLines } = await import("./pptmaster-bridge.js");
  const longSentence = "Tổ hợp căn hộ cao cấp ven sông Sài Gòn với quy mô 622 căn hộ";
  const lines = wrapTextToLines(longSentence, 25, 3);
  assert.ok(lines.length >= 2, "Văn bản dài phải được tách thành ít nhất 2 dòng");
  lines.forEach((l) => {
    assert.ok(l.length <= 28, `Độ dài dòng "${l}" không được vượt quá giới hạn`);
  });
});

test("generateSlideSVG cho two_content bọc dòng trong cột và không đè nhau", () => {
  const theme = getTheme("navy");
  const slide2Col: SlideContent = {
    layout: "two_content",
    title: "Vị Trí & Liên Kết",
    col1Title: "Vị Trí Ven Sông",
    col1Bullets: ["Mặt tiền đường Vĩnh Phú 29 khu vực Lái Thiêu ven sông Sài Gòn"],
    col2Title: "Hạ Tầng Giao Thông",
    col2Bullets: ["Kết nối trực tiếp trục huyết mạch Đông Bắc về trung tâm"],
  };

  const svg = generateSlideSVG(slide2Col, 2, 5, theme);
  assert.ok(svg.includes("col_left"), "Phải có group col_left");
  assert.ok(svg.includes("col_right"), "Phải có group col_right");
  assert.ok(!svg.includes("dominant-baseline"), "Không chứa dominant-baseline");
});

test("generateSlideSVG cho two_content hỗ trợ định dạng left / right của LLM", () => {
  const theme = getTheme("luxury");
  const slideFromLlm: SlideContent = {
    layout: "two_content",
    title: "Tọa Độ Kim Cương",
    left: {
      title: "Lợi Thế Tọa Độ Ven Sông",
      bullets: ["Cách bờ sông Sài Gòn chỉ 200m", "Vi khí hậu mát mẻ quanh năm"],
    },
    right: {
      title: "Mạng Lưới Tiện Ích Ngoại Khu",
      bullets: ["Liền kề Bệnh viện Quốc tế Hạnh Phúc", "5 phút đến TTTM Giga Mall"],
    },
  };

  const svg = generateSlideSVG(slideFromLlm, 3, 8, theme);
  assert.ok(svg.includes("Lợi Thế Tọa Độ Ven Sông"), "Phải trích xuất được left.title");
  assert.ok(svg.includes("Mạng Lưới Tiện Ích Ngoại Khu"), "Phải trích xuất được right.title");
  assert.ok(svg.includes("Cách bờ sông Sài Gòn chỉ 200m"), "Phải trích xuất được bullet bên trái");
  assert.ok(svg.includes("Liền kề Bệnh viện Quốc tế Hạnh Phúc"), "Phải trích xuất được bullet bên phải");
  assert.ok(!svg.includes("Khía cạnh chính"), "Không được fallback về tiêu đề mặc định khi đã có left.title");
});

test("generateSlideSVG dùng theme.primary cho tiêu đề và nhãn để không bị tàng hình trên nền sáng", () => {
  const theme = getTheme("navy");
  const slideCover: SlideContent = {
    layout: "title",
    title: "Tiêu Đề Báo Cáo Chiến Lược",
    subtitle: "Thuyết minh chi tiết",
  };
  const svgCover = generateSlideSVG(slideCover, 0, 3, theme);
  assert.ok(svgCover.includes(`fill="#${theme.primary}"`), "Tiêu đề trang bìa phải dùng màu primary để rõ nét");

  const slideStats: SlideContent = {
    layout: "stats",
    title: "Chỉ Số Trọng Yếu",
    stats: [{ value: "1.175 Tỷ", label: "Tổng vốn đầu tư" }],
  };
  const svgStats = generateSlideSVG(slideStats, 1, 3, theme);
  assert.ok(svgStats.includes(`fill="#${theme.primary}"`), "Tiêu đề và nhãn stat card phải dùng màu primary");
});

test("parseStatsFromBullets phân tích chính xác chuỗi có dấu gạch đứng | hoặc dấu hai chấm :", async () => {
  const { parseStatsFromBullets } = await import("./pptmaster-bridge.js");
  const bullets = [
    "50 Tr/m² | Mức giá dự kiến | Giai đoạn 1",
    "Quy mô: 622 căn",
    "1.175 Tỷ: Tổng vốn đầu tư",
    "10.000 m² diện tích khuôn viên xanh",
  ];

  const parsed = parseStatsFromBullets(bullets);
  assert.strictEqual(parsed.length, 4, "Phải phân tích được cả 4 dòng");
  assert.strictEqual(parsed[0]?.value, "50 Tr/m²");
  assert.strictEqual(parsed[0]?.label, "Mức giá dự kiến");
  assert.strictEqual(parsed[0]?.desc, "Giai đoạn 1");

  assert.strictEqual(parsed[1]?.value, "622 căn");
  assert.strictEqual(parsed[1]?.label, "Quy mô");

  assert.strictEqual(parsed[2]?.value, "1.175 Tỷ");
  assert.strictEqual(parsed[2]?.label, "Tổng vốn đầu tư");

  assert.strictEqual(parsed[3]?.value, "10.000 m²");
  assert.ok(parsed[3]?.label.includes("diện tích"));
});

test("generateSlideSVG tự động chia 2 cột (auto-split) khi layout: two_content chỉ có mảng bullets chung", () => {
  const theme = getTheme("navy");
  const slide2ColBullets: SlideContent = {
    layout: "two_content",
    title: "Phân Tích Đa Chiều Dự Án",
    bullets: [
      "Ý 1: Vị trí ven sông mát mẻ",
      "Ý 2: Pháp lý hoàn chỉnh phê duyệt 1/500",
      "Ý 3: Mật độ xây dựng thấp chỉ 30%",
      "Ý 4: Tiện ích nội khu chuẩn resort",
    ],
  };

  const svg = generateSlideSVG(slide2ColBullets, 1, 4, theme);
  assert.ok(svg.includes("col_left"), "Phải có cột bên trái");
  assert.ok(svg.includes("col_right"), "Phải có cột bên phải");
  assert.ok(svg.includes("Ý 1: Vị trí ven sông"), "Cột trái phải có bullet 1");
  assert.ok(svg.includes("Ý 2: Pháp lý hoàn chỉnh"), "Cột trái phải có bullet 2");
  assert.ok(svg.includes("Ý 3: Mật độ xây dựng"), "Cột phải phải có bullet 3");
  assert.ok(svg.includes("Ý 4: Tiện ích nội khu"), "Cột phải phải có bullet 4");
});

test("generateSlideSVG tự động parse stats khi layout: stats nhưng Hermes chỉ gửi mảng bullets", () => {
  const theme = getTheme("emerald");
  const slideStatsFromBullets: SlideContent = {
    layout: "stats",
    title: "Chỉ Số Tài Chính Dự Kiến",
    bullets: [
      "50 Tr/m² | Mức giá dự kiến",
      "622 Căn | Quy mô dự án",
      "1.175 Tỷ | Tổng vốn đầu tư",
    ],
  };

  const svg = generateSlideSVG(slideStatsFromBullets, 2, 5, theme);
  assert.ok(svg.includes("stat_card_1"), "Phải render stat_card_1");
  assert.ok(svg.includes("50 Tr/m²"), "Phải chứa giá trị 50 Tr/m²");
  assert.ok(svg.includes("Mức giá dự kiến"), "Phải chứa nhãn Mức giá dự kiến");
  assert.ok(svg.includes("622 Căn"), "Phải chứa giá trị 622 Căn");
  assert.ok(svg.includes("1.175 Tỷ"), "Phải chứa giá trị 1.175 Tỷ");
});

test("generateSlideSVG hỗ trợ layout split_image và image", () => {
  const theme = getTheme("luxury");
  const slideSplitImage: SlideContent = {
    layout: "split_image",
    title: "Phối Cảnh Căn Hộ",
    bullets: ["Thiết kế hiện đại", "Ban công đón gió sông"],
    imageCaption: "Phối cảnh tổng thể dự án",
  };

  const svgSplit = generateSlideSVG(slideSplitImage, 3, 6, theme);
  assert.ok(svgSplit.includes("col_content"), "Phải có cột nội dung");
  assert.ok(svgSplit.includes("col_image"), "Phải có cột ảnh");
  assert.ok(svgSplit.includes("Phối cảnh tổng thể dự án"), "Phải chứa caption ảnh");

  const slideHeroImage: SlideContent = {
    layout: "image",
    title: "Mặt Bằng Tầng Điển Hình",
    imageCaption: "Bố trí căn hộ 2 phòng ngủ",
  };

  const svgHero = generateSlideSVG(slideHeroImage, 4, 6, theme);
  assert.ok(svgHero.includes("hero_image"), "Phải có khung hero_image");
  assert.ok(svgHero.includes("Bố trí căn hộ 2 phòng ngủ"), "Phải chứa caption ảnh");
});




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



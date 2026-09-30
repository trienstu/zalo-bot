import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

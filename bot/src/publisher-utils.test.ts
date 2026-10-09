import test from "node:test";
import assert from "node:assert/strict";
import { extractPublisherName, isJunkOrBettingDomain } from "./publisher-utils.js";

test("extractPublisherName bóc tách chuẩn xác tên cơ quan & tòa soạn từ URL thật", () => {
  assert.equal(extractPublisherName(undefined, "https://vnexpress.net/thoi-su/bai-viet.html"), "VnExpress");
  assert.equal(extractPublisherName(undefined, "https://moet.gov.vn/tintuc/Pages/Default.aspx"), "Bộ GD&ĐT");
  assert.equal(extractPublisherName(undefined, "https://thuvienphapluat.vn/van-ban/giao-duc/quyet-dinh-764.aspx"), "Thư viện Pháp luật");
  assert.equal(extractPublisherName(undefined, "https://tuoitre.vn/giao-duc.htm"), "Tuổi Trẻ");
});

test("extractPublisherName bóc tách URL đích thực từ Google/Vertex redirect", () => {
  const vertexRedirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABC123XYZ?url=https%3A%2F%2Fvnexpress.net%2Ftin-tuc-123.html";
  assert.equal(extractPublisherName("VnExpress - Tin tức", vertexRedirect), "VnExpress");

  const googleRedirect = "https://www.google.com/url?q=https%3A%2F%2Fthuvienphapluat.vn%2Fquyet-dinh-764";
  assert.equal(extractPublisherName(undefined, googleRedirect), "Thư viện Pháp luật");
});

test("extractPublisherName làm sạch ký tự HTML entity và dấu ngoặc đơn thừa", () => {
  assert.equal(extractPublisherName("VnExpress &amp; Tin Nhanh - VnExpress"), "VnExpress");
  // Khi title có dấu ngoặc đóng thừa nhưng là tên hợp lệ
  assert.equal(extractPublisherName("Tin tức mới - Tuổi Trẻ"), "Tuổi Trẻ");
});

test("extractPublisherName tuyệt đối KHÔNG cắt vụn tiêu đề thành nguồn rác", () => {
  // Tiêu đề rác không có trong danh bạ
  assert.equal(extractPublisherName("Đề thi thử THPT có đáp án chi tiết 2026"), "");
  assert.equal(extractPublisherName("Đại lý bán ván ép giá rẻ tại Di Linh"), "");
  assert.equal(extractPublisherName("Đề thi Vật Lí 12 - 2026 bảng A"), "");
  assert.equal(extractPublisherName("Scribd - Xem tài liệu miễn phí"), "");
});

test("isJunkOrBettingDomain chặn đứng link cá độ và rác", () => {
  assert.equal(isJunkOrBettingDomain("https://bet88.com/soikeo"), true);
  assert.equal(isJunkOrBettingDomain("xoilac7.tv"), true);
  assert.equal(isJunkOrBettingDomain("vnexpress.net"), false);
});

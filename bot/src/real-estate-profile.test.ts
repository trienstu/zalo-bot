import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealEstateProjectSearchQueries,
  extractRealEstateProjectFactsFromText,
  isRealEstateProjectProfileQuery,
} from "./real-estate-profile.js";

test("nhận diện câu hỏi hồ sơ dự án bất động sản nhưng bỏ qua tin thị trường chung", () => {
  assert.equal(isRealEstateProjectProfileQuery("tổng quan dự án Serena Riverside"), true);
  assert.equal(isRealEstateProjectProfileQuery("pháp lý chung cư Gladia Heights hiện nay"), true);
  assert.equal(isRealEstateProjectProfileQuery("tin tức thị trường bất động sản hôm nay"), false);
});

test("tạo truy vấn đa trường cho dự án bất động sản, không bám cứng một dự án cụ thể", () => {
  const queries = buildRealEstateProjectSearchQueries("tổng quan dự án Gladia Heights đi sen chúa");

  assert.ok(queries.some((q) => /chủ đầu tư quy mô/i.test(q)));
  assert.ok(queries.some((q) => /pháp lý tiến độ bàn giao/i.test(q)));
  assert.ok(queries.some((q) => /bảng giá số căn diện tích mặt bằng/i.test(q)));
  assert.ok(queries.every((q) => !/sen chúa/i.test(q)));
});

test("bóc các trường hồ sơ dự án phổ biến từ nội dung trang", () => {
  const facts = extractRealEstateProjectFactsFromText(`
    Chủ đầu tư: Công ty Cổ phần Đầu tư Đạt Phước.
    Vị trí: Đường Vĩnh Phú 29, khu vực Lái Thiêu, TP.HCM.
    Quy mô đất: khoảng 5.692 m².
    Cấu trúc xây dựng: gồm 2 block, Block A cao 25 tầng, Block B cao 30 tầng, 1 tầng hầm.
    Số lượng sản phẩm: khoảng 622 sản phẩm bao gồm căn hộ, officetel và shophouse.
    Giá tham khảo: 55 - 60 triệu/m².
    Tiến độ: dự kiến bàn giao Q4/2028.
  `, "Trang dự án mẫu");

  const byKey = new Map(facts.map((fact) => [fact.key, fact.value]));
  assert.match(byKey.get("developer") || "", /Đạt Phước/);
  assert.match(byKey.get("location") || "", /Vĩnh Phú 29/);
  assert.match(byKey.get("landArea") || "", /5\.692/);
  assert.match(byKey.get("towers") || "", /2 block/i);
  assert.match(byKey.get("floors") || "", /25 tầng/i);
  assert.match(byKey.get("basement") || "", /1 tầng hầm/i);
  assert.match(byKey.get("productCount") || "", /622/);
  assert.match(byKey.get("unitTypes") || "", /officetel/);
  assert.match(byKey.get("price") || "", /55 - 60 triệu/);
  assert.match(byKey.get("progress") || "", /Q4\/2028/);
});

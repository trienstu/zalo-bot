import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealEstateProjectSearchQueries,
  extractRealEstateProjectFactsFromText,
  formatRealEstateProjectProfileAnswer,
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

test("làm sạch HTML entity và đoạn marketing bị kéo dính vào số liệu dự án", () => {
  const facts = extractRealEstateProjectFactsFromText(`
    Quy mô đất: gần 5ha nhưng mật độ xây dựng khối thấp chỉ chiếm 28%, phần lớn không gian được MIK Group hợp tác cùng đơn vị thiết kế cao cấp.
    Mật độ xây dựng: 30,5%.
    Sản phẩm: 922 căn hộ từ 1-3PN và 93 nhà phố, biệt thự, dự án mang triết lý sống &#8220;chuẩn mới&#8221;.
    Tiện ích nổi bật: Hồ bơi tràn bờ, Công viên Green Park, Clubhouse, Kids Zone&#8230;
  `, "Trang Imperia mẫu");

  const byKey = new Map(facts.map((fact) => [fact.key, fact.value]));
  assert.equal(byKey.get("landArea"), "gần 5ha");
  assert.equal(byKey.get("density"), "30,5%");
  assert.doesNotMatch(byKey.get("productCount") || "", /&#8220|triết lý sống|chuẩn mới/i);
  assert.doesNotMatch(byKey.get("amenities") || "", /&#8230/);
});

test("format câu trả lời hồ sơ dự án trực tiếp từ schema, không để LLM tự suy diễn", () => {
  const answer = formatRealEstateProjectProfileAnswer(`
🏗️ HỒ SƠ DỰ ÁN BẤT ĐỘNG SẢN ĐÃ MỞ TRANG VÀ TRÍCH XUẤT THEO SCHEMA:
- Chủ đầu tư / đơn vị phát triển: Công ty CP Đầu tư Đạt Phước (Nguồn: serenariversides.com, serenariverside.vn)
- Vị trí: Đường Vĩnh Phú 29, Phường Lái Thiêu, TP (Nguồn: serenariversides.com)
- Quy mô đất: 5.691,6 m² (Nguồn: serenariversides.com, serenariverside.vn)
- Số block/tháp: 2 Block (Nguồn: serenariversides.com, serenariverside.vn)
- Số tầng: 25 – 30 tầng và 1 hầm (Nguồn: serenariversides.com, serenariverside.vn)
- Số lượng sản phẩm: 622 căn (Nguồn: serenariversides.com)
Nguồn đã mở: serenariversides.com, serenariverside.com.vn, serenariverside.vn
`, "sen chúa cho a tổng quan dự án serena riverside");

  assert.match(answer, /SERENA RIVERSIDE/i);
  assert.match(answer, /Công ty CP Đầu tư Đạt Phước/);
  assert.match(answer, /5\.691,6 m²/);
  assert.match(answer, /2 Block/);
  assert.match(answer, /622 căn/);
  assert.doesNotMatch(answer, /Palm City|Palm River|21 tòa|500 căn|1,5 tỷ/i);
  assert.match(answer, /Nguồn tham khảo: serenariversides\.com/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { extractMarkdownTable, extractSimulatedGenerateFile } from "./simulated-tool-interceptor.js";
import { isBotStatusOrMetaQuestion } from "../search-evidence.js";
import { checkIsFileOrVoiceGeneration, extractAllMarkdownTables } from "./file-generator.js";

test("extractMarkdownTable: trích xuất đúng bảng Markdown thành headers và rows", () => {
  const markdown = `
Dưới đây là chi tiết hóa đơn thanh toán:

| STT | Tên món | Số lượng | Đơn giá | Thành tiền |
|:---:|:---|:---:|:---:|:---:|
| 1 | Bò sốt tiêu đen | 2 | 150.000 | 300.000 |
| 2 | Cơm chiên hải sản | 1 | 120.000 | 120.000 |
| 3 | Nước suối Lavie | 3 | 15.000 | 45.000 |

Tổng cộng thanh toán: 465.000 VNĐ.
`;

  const table = extractMarkdownTable(markdown);
  assert.ok(table);
  assert.deepEqual(table.headers, ["STT", "Tên món", "Số lượng", "Đơn giá", "Thành tiền"]);
  assert.equal(table.rows.length, 3);
  assert.deepEqual(table.rows[0], ["1", "Bò sốt tiêu đen", "2", "150.000", "300.000"]);
  assert.deepEqual(table.rows[2], ["3", "Nước suối Lavie", "3", "15.000", "45.000"]);
});

test("extractSimulatedGenerateFile: tự động bọc Markdown table thành Excel khi có dữ liệu hóa đơn/bảng biểu", () => {
  const markdown = `
Hóa đơn bán lẻ cửa hàng:

| STT | Mã SP | Tên hàng | Số lượng | Đơn giá | Thành tiền |
|---|---|---|---|---|---|
| 1 | SP01 | Áo sơ mi nam | 2 | 250000 | 500000 |
| 2 | SP02 | Quần tây âu | 1 | 400000 | 400000 |
`;

  const extracted = extractSimulatedGenerateFile(markdown);
  assert.ok(extracted);
  assert.equal(extracted.toolName, "generate_file");
  assert.equal(extracted.args.fileType, "xlsx");
  assert.deepEqual(extracted.args.excelHeaders, ["STT", "Mã SP", "Tên hàng", "Số lượng", "Đơn giá", "Thành tiền"]);
  assert.equal(extracted.args.excelRows?.length, 2);
});

test("isBotStatusOrMetaQuestion: nhận diện các câu phàn nàn/giục xuất kết quả không cho search Google", () => {
  assert.equal(isBotStatusOrMetaQuestion("Trình bày nhiều làm gì, xuất kết quả nhanh là được"), true);
  assert.equal(isBotStatusOrMetaQuestion("Nói nhiều quá làm nhanh đi"), true);
  assert.equal(isBotStatusOrMetaQuestion("Lắm lời thế xuất file nhanh lên"), true);
  assert.equal(isBotStatusOrMetaQuestion("Xuất kết quả nhanh hộ anh cái"), true);
  assert.equal(isBotStatusOrMetaQuestion("Làm lẹ đi em ơi"), true);
});

test("checkIsFileOrVoiceGeneration: nhận diện đúng biến thể tự nhiên 'về dạng excell'", () => {
  assert.equal(checkIsFileOrVoiceGeneration("Vậy chuyển nó về dạng excell cho a"), true);
  assert.equal(checkIsFileOrVoiceGeneration("Chuyển thành file exel giúp mình"), true);
  assert.equal(checkIsFileOrVoiceGeneration("Xuất sang dạng pptx cho sếp"), true);
});

test("extractAllMarkdownTables: trích xuất và gom toàn bộ bảng qua nhiều trang, loại bỏ header lặp", () => {
  const multiPageDoc = `
=== TRANG 1 ===
| STT | Họ tên | Điểm Toán | Điểm Văn |
|---|---|---|---|
| 1 | Nguyễn Văn A | 9.0 | 8.5 |
| 2 | Trần Thị B | 8.0 | 9.0 |

=== TRANG 2 ===
| STT | Họ tên | Điểm Toán | Điểm Văn |
|:---:|:---|:---:|:---:|
| 3 | Lê Văn C | 7.5 | 8.0 |
| 4 | Phạm Thị D | 10.0 | 9.5 |
`;

  const result = extractAllMarkdownTables(multiPageDoc);
  assert.ok(result);
  assert.deepEqual(result.headers, ["STT", "Họ tên", "Điểm Toán", "Điểm Văn"]);
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.rows[0], ["1", "Nguyễn Văn A", "9.0", "8.5"]);
  assert.deepEqual(result.rows[2], ["3", "Lê Văn C", "7.5", "8.0"]);
  assert.deepEqual(result.rows[3], ["4", "Phạm Thị D", "10.0", "9.5"]);
});


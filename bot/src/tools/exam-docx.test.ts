import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseMarkdownToWordBlocks, generateWordDoc } from "./file-generator.js";

test("parseMarkdownToWordBlocks: Nhận diện câu hỏi trắc nghiệm viết dính chùm trên 1 dòng và tách thành 2 cột", () => {
  const content = `**Câu 1.** Nguyên nhân làm cho dao động tắt dần trong không khí là do A. trọng lực. B. lực cản môi trường. C. dây treo nhẹ. D. chu kỳ nhỏ.`;
  const blocks = parseMarkdownToWordBlocks(content, "Đề Kiểm Tra");

  // Khối 0 là heading tiêu đề
  // Khối 1 là câu hỏi
  assert.equal(blocks[1]?.type, "paragraph");
  assert.ok(blocks[1]?.text?.includes("Nguyên nhân làm cho dao động tắt dần"));

  // Khối 2 là bảng 2 cột cho các phương án
  assert.equal(blocks[2]?.type, "two_columns");
  assert.deepEqual(blocks[2]?.leftCol, ["A. trọng lực.", "C. dây treo nhẹ."]);
  assert.deepEqual(blocks[2]?.rightCol, ["B. lực cản môi trường.", "D. chu kỳ nhỏ."]);
});

test("parseMarkdownToWordBlocks: Nhận diện câu hỏi trắc nghiệm có phương án ở các dòng tiếp theo", () => {
  const content = `**Câu 2.** Đơn vị của cảm ứng từ trong hệ SI là:
A. Tesla (T).
B. Vôn (V).
C. Veba (Wb).
D. Ampe (A).`;
  const blocks = parseMarkdownToWordBlocks(content, "Đề Kiểm Tra");

  assert.equal(blocks[1]?.type, "paragraph");
  assert.ok(blocks[1]?.text?.includes("Đơn vị của cảm ứng từ"));
  assert.equal(blocks[2]?.type, "two_columns");
  assert.deepEqual(blocks[2]?.leftCol, ["A. Tesla (T).", "C. Veba (Wb)."]);
  assert.deepEqual(blocks[2]?.rightCol, ["B. Vôn (V).", "D. Ampe (A)."]);
});

test("parseMarkdownToWordBlocks: Nhận diện câu hỏi Đúng/Sai (Phần II) với 4 ý a, b, c, d", () => {
  const content = `**Câu 1.** Khảo sát con lắc đơn trong toa tàu hỏa:
a) Tần số dao động riêng phụ thuộc vào khối lượng.
b) Chu kì dao động xấp xỉ 1,4 s.
c) Con lắc dao động mạnh nhất khi xảy ra cộng hưởng.
d) Tàu chạy với vận tốc 32 km/h thì rung mạnh nhất.`;
  const blocks = parseMarkdownToWordBlocks(content, "Đề Kiểm Tra");

  assert.equal(blocks[1]?.type, "paragraph");
  assert.ok(blocks[1]?.text?.includes("Khảo sát con lắc đơn"));
  // 4 ý a, b, c, d là 4 paragraph tách biệt
  assert.equal(blocks[2]?.type, "paragraph");
  assert.ok(blocks[2]?.text?.includes("a) Tần số dao động"));
  assert.equal(blocks[3]?.type, "paragraph");
  assert.ok(blocks[3]?.text?.includes("b) Chu kì dao động"));
  assert.equal(blocks[4]?.type, "paragraph");
  assert.ok(blocks[4]?.text?.includes("c) Con lắc dao động"));
  assert.equal(blocks[5]?.type, "paragraph");
  assert.ok(blocks[5]?.text?.includes("d) Tàu chạy"));
});

test("generateWordDoc: Xuất file Word đề thi chuẩn in ấn, khử sạch LaTeX và định dạng đẹp", async () => {
  const content = `**Câu 1.** Một con lắc lò xo có độ cứng $k = 100\\text{ N/m}$, tần số góc $\\omega = \\sqrt{\\frac{k}{m}}$.
A. $\\omega = 10\\text{ rad/s}$.
B. $\\omega = 20\\text{ rad/s}$.
C. $\\omega = 30\\text{ rad/s}$.
D. $\\omega = 40\\text{ rad/s}$.`;
  const blocks = parseMarkdownToWordBlocks(content, "Đề Thi Vật Lí");
  const result = await generateWordDoc("test_exam_output", "Đề Thi Vật Lí", blocks);

  assert.ok(result.filePath.endsWith(".docx"));
  assert.ok(fs.existsSync(result.filePath));

  // Kiểm tra file có header zip PK\x03\x04
  const buf = fs.readFileSync(result.filePath);
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);

  // Xóa file test sau khi chạy
  fs.unlinkSync(result.filePath);
});

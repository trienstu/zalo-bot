import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseMarkdownToWordBlocks, generateWordDoc, parseMarkdownRuns } from "./file-generator.js";

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

test("parseMarkdownRuns: Chuyển đổi công thức sang Word Equation bản địa (OMML) và hỗ trợ chế độ MathType", () => {
  // 1. Mặc định: Chuyển đổi sang đối tượng DocxMath bản địa Word Equation (<m:oMath>)
  const ommlRuns = parseMarkdownRuns("Một vật dao động điều hòa với phương trình $x = 4\\cos(10\\pi t + \\pi/3)$ và độ cứng $k = 100\\text{ N/m}$.");
  const ommlJson = JSON.stringify(ommlRuns);
  assert.ok(ommlJson.includes("m:oMath") || ommlRuns.some((r: any) => r.rootKey === "m:oMath" || r.constructor?.name === "Math"), "Phải có ít nhất 1 phần tử DocxMath");

  // 2. Chế độ MathType: Giữ nguyên TeX với font Cambria Math
  const mathTypeRuns = parseMarkdownRuns(
    "Một vật dao động điều hòa với phương trình $x = 4\\cos(10\\pi t + \\pi/3)$ và độ cứng $k = 100\\text{ N/m}$.",
    "Times New Roman",
    26,
    { mathMode: "mathtype" },
  );
  const mathRuns = mathTypeRuns.filter((r: any) => r.root?.[1]?.[0]?.root?.[0] === "Cambria Math" || JSON.stringify(r).includes("Cambria Math"));
  assert.ok(mathRuns.length >= 2, "Phải có ít nhất 2 run mang font Cambria Math");
  const textJson = JSON.stringify(mathTypeRuns);
  assert.ok(textJson.includes("$x = 4\\\\cos(10\\\\pi t + \\\\pi/3)$"));
  assert.ok(textJson.includes("$k = 100\\\\text{ N/m}$"));
});

test("parseMarkdownToWordBlocks: Chuẩn hóa thể thức hành chính Nghị định 30 (Header 2 cột không viền, khử #### Điều, Footer)", () => {
  const text = `BỘ GIÁO DỤC VÀ ĐÀO TẠO
Số: 317/QĐ-BGDĐT
CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
Hà Nội, ngày 11 tháng 8 năm 2026

# QUYẾT ĐỊNH
Về việc phê duyệt kế hoạch tổ chức kỳ thi

#### Điều 1. Ban hành kế hoạch
Ban hành kèm theo Quyết định này Kế hoạch tổ chức kỳ thi học sinh giỏi quốc gia.

#### Điều 2. Trách nhiệm thi hành
Các ông Chánh Văn phòng, Cục trưởng Cục Quản lý chất lượng chịu trách nhiệm thi hành.

**Nơi nhận:**
- Như Điều 2;
- Bộ trưởng (để b/c);
- Lưu: VT, QLCL.
BỘ TRƯỞNG
(Đã ký)
Nguyễn Kim Sơn`;

  const blocks = parseMarkdownToWordBlocks(text);

  // 1. Khối đầu tiên là Header 2 cột không viền
  assert.equal(blocks[0]?.type, "two_columns");
  assert.equal(blocks[0]?.borderless, true);
  assert.ok(blocks[0]?.leftCol?.some((l) => l.includes("BỘ GIÁO DỤC")));
  assert.ok(blocks[0]?.rightCol?.some((l) => l.includes("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM")));
  assert.ok(blocks[0]?.rightCol?.some((l) => l.includes("Độc lập - Tự do - Hạnh phúc")));

  // 2. Khử sạch #### Điều 1, Điều 2 thành paragraph in đậm sạch sẽ
  const dieu1Block = blocks.find((b) => b.type === "paragraph" && b.text?.includes("Điều 1."));
  assert.ok(dieu1Block, "Phải có khối Điều 1");
  assert.ok(!dieu1Block.text?.includes("####"), "Tuyệt đối không được chứa ký tự rác ####");
  assert.ok(dieu1Block.text?.startsWith("**Điều 1."), "Điều 1 phải được in đậm sạch sẽ");

  // 3. Khối Footer là 2 cột không viền (Nơi nhận bên trái, Chữ ký bên phải)
  const footerBlock = blocks.find((b) => b.type === "two_columns" && b.leftCol?.some((l) => l.includes("Nơi nhận")));
  assert.ok(footerBlock, "Phải có khối Footer 2 cột");
  assert.equal(footerBlock.borderless, true);
  assert.ok(footerBlock.rightCol?.some((r) => r.includes("BỘ TRƯỞNG")));
});

test("parseMarkdownToWordBlocks: Tự động gắn cờ borderless cho bảng trắc nghiệm hoặc ma trận đáp án", () => {
  const tableContent = `| Câu | A | B | C | D |
|---|---|---|---|---|
| 1 | Đúng | Sai | Đúng | Sai |
| 2 | A | B | C | D |`;

  const blocks = parseMarkdownToWordBlocks(tableContent, "Bảng Đáp Án borderless");
  const tableBlock = blocks.find((b) => b.type === "table");
  assert.ok(tableBlock, "Phải có khối table");
  assert.equal(tableBlock.borderless, true, "Bảng trắc nghiệm / đáp án phải có cờ borderless: true");
});

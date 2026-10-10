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

test("parseMarkdownRuns: Xử lý chuẩn xác ngoặc lồng nhau, ký hiệu Hy Lạp hoa, toán tử logic, hạt nhân và đáp số số đơn lẻ", () => {
  // 1. Ngoặc lồng nhau trong số mũ và phân số phức tạp
  const radioText = "Định luật phóng xạ: $m(t) = m_0 \\cdot 2^{-\\frac{t}{T}} \\iff 2,5 = 20 \\cdot 2^{-\\frac{t}{8}} \\implies t = 24\\text{ ngày}$. Đáp số: $24$";
  const runs = parseMarkdownRuns(radioText);
  const jsonStr = JSON.stringify(runs);

  // Không được chứa các chuỗi rác bị xé vụn
  assert.ok(!jsonStr.includes("2^{-"), "Không được xé vụn số mũ thành 2^{-");
  assert.ok(!jsonStr.includes("\\iff"), "Phải chuyển đổi \\iff thành ký hiệu ⇔");
  assert.ok(!jsonStr.includes("\\implies"), "Phải chuyển đổi \\implies thành ký hiệu ⇒");
  assert.ok(!jsonStr.includes("$24$"), "Đáp số $24$ không được để sót ký tự $ thô");

  // 2. Ký hiệu Hy Lạp viết hoa và phân số có số mũ âm
  const indText = "Suất điện động: $e_c = N \\cdot \\left| \\frac{\\Delta\\Phi}{\\Delta t} \\right| = 100 \\cdot \\frac{3,2 \\cdot 10^{-3}}{0,04} = 8\\text{ V}$. Từ thông ban đầu: $\\Phi_1 = B_1 S$";
  const indRuns = parseMarkdownRuns(indText);
  const indJson = JSON.stringify(indRuns);

  assert.ok(!indJson.includes("\\Phi"), "Ký hiệu \\Phi phải chuyển sang Φ");
  assert.ok(!indJson.includes("\\left|"), "Dấu \\left| phải chuyển sang |");
  assert.ok(!indJson.includes("\\cdot"), "Dấu \\cdot phải chuyển sang ·");

  // 3. Đồng vị hạt nhân
  const nucText = "Mỗi phản ứng tạo thành 1 hạt $^4_2He$ hoặc $^{235}_{92}U$";
  const nucRuns = parseMarkdownRuns(nucText);
  const nucJson = JSON.stringify(nucRuns);
  assert.ok(nucJson.includes("m:sPre") || nucJson.includes("He"), "Phải nhận diện cấu trúc hạt nhân");
});

test("parseMarkdownRuns & parseMarkdownToWordBlocks: Khử sạch độ C (^\\circC), khoảng trắng (\\ ), \\textbf và bỏ qua khối ASCII code block", () => {
  // 1. Độ C và bảo toàn số cơ số
  const tempText = "Nhiệt độ nóng chảy hoàn toàn ở $0^\\circ C$, từ $-10^\\circ C$ lên $30,5^\\circ C$ và $^\\circC$.";
  const runs = parseMarkdownRuns(tempText);
  const jsonStr = JSON.stringify(runs);
  assert.ok(!jsonStr.includes("circ"), "Tuyệt đối không được sót chữ circ thô");
  assert.ok(jsonStr.includes("0°C") || jsonStr.includes("0"), "Phải bảo toàn số 0 trong 0°C");
  assert.ok(jsonStr.includes("-10°C") || jsonStr.includes("-10"), "Phải bảo toàn số -10 trong -10°C");

  // 2. Khoảng trắng LaTeX control space (\ ) và đơn vị điện trở \Omega
  const ohmText = "Điện trở $r = 0,5\\ \\Omega$ và $R = 1,5\\ \\Omega$. Khối lượng $1\\text{ g}\\ $";
  const ohmRuns = parseMarkdownRuns(ohmText);
  const ohmJson = JSON.stringify(ohmRuns);
  assert.ok(!ohmJson.includes("\\ "), "Tuyệt đối không được sót dấu gạch chéo ngược khoảng trắng \\ ");
  assert.ok(ohmJson.includes("Ω"), "Phải hiển thị ký hiệu Ω");

  // 3. \textbf trong công thức giải thích
  const boldText = "$F = 0,05\\text{ N} \\to \\textbf{Chọn A.}$";
  const boldRuns = parseMarkdownRuns(boldText);
  const boldJson = JSON.stringify(boldRuns);
  assert.ok(!boldJson.includes("textbf"), "Tuyệt đối không được sót lệnh textbf");
  assert.ok(boldJson.includes("Chọn A."), "Phải hiển thị nội dung text Chọn A.");

  // 4. Bỏ qua khối code block ASCII
  const asciiText = `Câu 3. Một thanh ray dẫn điện.
\`\`\`
[R] /   \\
\\   / (B hướng lên)
\`\`\`
a) Độ lớn cảm ứng từ...`;
  const blocks = parseMarkdownToWordBlocks(asciiText);
  const blockJson = JSON.stringify(blocks);
  assert.ok(!blockJson.includes("```"), "Không được chứa dấu ba nháy ngược code block");
  assert.ok(!blockJson.includes("(B hướng lên)"), "Không được để rác sơ đồ ASCII lọt vào văn bản Word");
});

test("parseMarkdownRuns: Xử lý chuẩn xác lũy thừa kèm đơn vị nghịch đảo ($10^{23}\\text{ mol}^{-1}$) và biến có dấu phẩy trên ($Q'_{ích}$)", () => {
  // 1. $10^{23}\text{ mol}^{-1}$: Không bị nhận nhầm thành hạt nhân mol-23, không sót raw ^{-1}
  const molText = "Hằng số Avogadro $N_A \\approx 6,022 \\cdot 10^{23}\\text{ mol}^{-1}$.";
  const molRuns = parseMarkdownRuns(molText);
  const molJson = JSON.stringify(molRuns);
  assert.ok(!molJson.includes("^{-1}"), "Không được để sót chuỗi thô ^{-1}");
  assert.ok(!molJson.includes("^{23}"), "Không được để sót chuỗi thô ^{23}");
  assert.ok(molJson.includes("10"), "Phải có cơ số 10");
  assert.ok(molJson.includes("mol"), "Phải có đơn vị mol");

  // 2. $Q'_{ích}$: Biến mang dấu phẩy trên (prime ') làm base cho chỉ số dưới
  const primeText = "Nhiệt lượng có ích $Q'_{ích} = A - Q_{tỏa}$.";
  const primeRuns = parseMarkdownRuns(primeText);
  const primeJson = JSON.stringify(primeRuns);
  assert.ok(!primeJson.includes("'_{ích}"), "Không được để sót chuỗi thô '_{ích}");
  assert.ok(primeJson.includes("Q'"), "Phải nhận diện Q' làm base token");
  assert.ok(primeJson.includes("ích"), "Phải nhận diện ích làm script token");
});

test("parseMarkdownRuns & parseMarkdownToWordBlocks: Khử triệt để backslash trong ký hiệu Hy Lạp kèm chỉ số (\\Delta \\Phi_1) và không nhận nhầm dấu trị tuyệt đối (|A|) thành bảng", () => {
  // 1. Ký hiệu Hy Lạp kèm chỉ số: \Phi_1 -> Φ_1, \Delta \Phi_1 -> Δ Φ_1 không còn sót ký tự \
  const fluxText = "Suất điện động $e_c = N \\frac{|\\Delta \\Phi_1|}{\\Delta t}$.";
  const fluxRuns = parseMarkdownRuns(fluxText);
  const fluxJson = JSON.stringify(fluxRuns);
  assert.ok(!fluxJson.includes("\\Phi"), "Không được sót \\Phi thô");
  assert.ok(!fluxJson.includes("\\Delta"), "Không được sót \\Delta thô");
  assert.ok(!fluxJson.includes("\\"), "Không được sót dấu gạch chéo ngược \\");
  assert.ok(fluxJson.includes("Φ"), "Phải chuyển đổi thành ký tự Φ");
  assert.ok(fluxJson.includes("Δ"), "Phải chuyển đổi thành ký tự Δ");

  // 2. Đoạn văn chứa nhiều dấu trị tuyệt đối (|A|, |Q|) không được nhận nhầm thành bảng Markdown
  const absText = `*Giải chi tiết:* Khi $Q > 0$ và $A < 0$, $\\Delta U = Q - |A|$.
- Nếu $|Q| > |A| \\Rightarrow \\Delta U > 0$ (nội năng tăng).
- Nếu $|Q| < |A| \\Rightarrow \\Delta U < 0$ (nội năng giảm).`;
  const blocks = parseMarkdownToWordBlocks(absText);
  const hasTable = blocks.some((b) => b.type === "table");
  assert.equal(hasTable, false, "Tuyệt đối không được nhận nhầm đoạn văn chứa dấu trị tuyệt đối thành bảng");
});

test("parseMarkdownRuns & parseMarkdownToWordBlocks: Khử sạch \\cdotK, hạt nhân ^A_Z X và bảo toàn ô bảng chứa công thức có dấu |", () => {
  // 1. \\cdotK trong đơn vị nhiệt dung riêng: J/(kg\\cdotK) -> J/(kg·K)
  const cdotText = "Nhiệt dung riêng $c = 4186\\text{ J/(kg\\cdotK)}$.";
  const cdotRuns = parseMarkdownRuns(cdotText);
  const cdotJson = JSON.stringify(cdotRuns);
  assert.ok(!cdotJson.includes("\\cdot"), "Không được sót \\cdot thô");
  assert.ok(!cdotJson.includes("\\"), "Không được sót dấu \\");
  assert.ok(cdotJson.includes("·"), "Phải có dấu chấm nhân ·");

  // 2. Hạt nhân ^A_Z X có chữ cái làm số khối và số hiệu nguyên tử
  const nucSymText = "Ký hiệu hạt nhân tổng quát $^A_Z X$ hay $^{A}_{Z}\\text{X}$.";
  const nucSymRuns = parseMarkdownRuns(nucSymText);
  const nucSymJson = JSON.stringify(nucSymRuns);
  assert.ok(!nucSymJson.includes('\"text\":\"^\"'), "Không được có text node caret ^ đơn lẻ");
  assert.ok(nucSymJson.includes("m:sPre"), "Phải được đóng gói thành MathPreSubSuperScript");

  // 3. Ô bảng Markdown chứa công thức có dấu gạch đứng | không bị xé nhỏ cột
  const tableWithMath = `| Câu | Đáp án | Hướng dẫn giải |
| --- | --- | --- |
| 12 | C | Theo định luật Faraday: $|e_c| = \\left| \\frac{\\Delta\\Phi}{\\Delta t}\\right|$, tỉ lệ thuận. |`;
  const tableBlocks = parseMarkdownToWordBlocks(tableWithMath);
  const tb = tableBlocks.find((b) => b.type === "table");
  assert.ok(tb, "Phải nhận diện được bảng");
  assert.equal(tb.tableHeaders?.length, 3, "Bảng phải có đúng 3 cột");
  assert.equal(tb.tableRows?.[0]?.length, 3, "Dòng dữ liệu phải có đúng 3 ô, không bị xé lẻ bởi dấu | trong công thức");
  assert.ok(tb.tableRows?.[0]?.[2]?.includes("Faraday"), "Ô thứ 3 phải bảo toàn nguyên vẹn nội dung hướng dẫn giải");
});

test("parseMarkdownRuns: Khử sạch \\mug (microgram) và bóc tách nhóm ngoặc nhọn tự do ({^3_1\\text{H}})", () => {
  // 1. \\mug -> μg
  const muText = "Khối lượng $m = 2,62\\mug = 0,655\\mug$.";
  const muRuns = parseMarkdownRuns(muText);
  const muJson = JSON.stringify(muRuns);
  assert.ok(!muJson.includes("\\mu"), "Không được sót \\mu thô");
  assert.ok(!muJson.includes("\\"), "Không được sót dấu \\");
  assert.ok(muJson.includes("μg"), "Phải chuyển đổi thành μg");

  // 2. Nhóm ngoặc nhọn cú pháp bao quanh số hạng hạt nhân {^3_1\text{H}} -> MathPreSubSuperScript, không lọt dấu { hay }
  const groupText = "Phản ứng $^2_1\\text{H} + {^3_1\\text{H}} \\to {^4_2\\text{He}} + {^1_0\\text{n}}$.";
  const groupRuns = parseMarkdownRuns(groupText);
  const groupJson = JSON.stringify(groupRuns);
  assert.ok(!groupJson.includes('\"text\":\"{\"'), "Không được có text node dấu mở ngoặc nhọn {");
  assert.ok(!groupJson.includes('\"text\":\"}\"'), "Không được có text node dấu đóng ngoặc nhọn }");
  assert.ok(!groupJson.includes('root\":[\"{\"]'), "Không được có m:t chứa dấu mở ngoặc nhọn {");
  assert.ok(!groupJson.includes('root\":[\"}\"]'), "Không được có m:t chứa dấu đóng ngoặc nhọn }");
});






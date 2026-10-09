import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseExamText, shuffleExam, exportShuffledExamToDocx } from "./exam-shuffler.js";

test("parseExamText: Bóc tách chính xác đề thi 3 phần chuẩn GDPT 2018", () => {
  const sampleExam = `ĐỀ KIỂM TRA ĐỊNH KỲ VẬT LÍ 12
PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn
Câu 1. Đơn vị của cảm ứng từ là
A. Tesla (T)
B. Vôn (V)
C. Ampe (A)
D. Oét (W)

Câu 2. Lực từ tác dụng lên đoạn dây dẫn mang dòng điện xác định theo quy tắc
A. Nắm tay phải
**B. Bàn tay trái**
C. Vặn đinh ốc
D. Bàn tay phải

PHẦN II. Câu trắc nghiệm đúng sai
Câu 1. Khảo sát một con lắc lò xo treo thẳng đứng:
a) Ở vị trí cân bằng lò xo giãn đoạn delta l. (Đúng)
b) Chu kì dao động không phụ thuộc gia tốc trọng trường g. (Sai)
c) Lực đàn hồi cực đại luôn lớn hơn trọng lực. (Đúng)
d) Động năng biến thiên tuần hoàn với chu kì T. (Sai)

PHẦN III. Câu trắc nghiệm trả lời ngắn
Câu 1. Một dây dẫn dài 0,2 m mang dòng điện 5 A đặt trong từ trường đều B = 0,04 T. Tính lực từ (N).
Đáp án: 0,04
`;

  const parsed = parseExamText(sampleExam);

  assert.equal(parsed.partI.length, 2);
  assert.equal(parsed.partI[0]?.options.A, "Tesla (T)");
  assert.equal(parsed.partI[1]?.correctKey, "B");

  assert.equal(parsed.partII.length, 1);
  assert.equal(parsed.partII[0]?.statements.length, 4);
  assert.equal(parsed.partII[0]?.statements[0]?.isTrue, true);
  assert.equal(parsed.partII[0]?.statements[1]?.isTrue, false);

  assert.equal(parsed.partIII.length, 1);
  assert.equal(parsed.partIII[0]?.answer, "0,04");
});

test("shuffleExam: Hoán vị chuẩn xác 4 mã đề và theo dõi đáp án đối chiếu", () => {
  const sampleExam = `PHẦN I. Câu trắc nghiệm nhiều phương án
Câu 1. Câu hỏi số một
**A. Đáp án đúng 1**
B. Sai 1
C. Sai 2
D. Sai 3

Câu 2. Câu hỏi số hai
A. Sai A
**B. Đáp án đúng 2**
C. Sai C
D. Sai D
`;

  const parsed = parseExamText(sampleExam);
  const codes = ["101", "102", "103", "104"];
  const { variants, matrix } = shuffleExam(parsed, codes);

  assert.equal(variants.length, 4);

  // Mỗi mã đề đều có 2 câu hỏi
  variants.forEach((v) => {
    assert.equal(v.partI.length, 2);
    // Bảng đáp án phải ghi nhận đáp án đúng cho từng câu
    assert.ok(matrix.partIKeys[v.code]![1]);
    assert.ok(matrix.partIKeys[v.code]![2]);

    // Kiểm tra tính nhất quán: phương án tương ứng với mã đáp án phải chứa chuỗi "Đáp án đúng"
    const q1 = v.partI[0]!;
    const key1 = matrix.partIKeys[v.code]![1] as "A" | "B" | "C" | "D";
    assert.ok(q1.options[key1].includes("Đáp án đúng"));
  });
});

test("exportShuffledExamToDocx: Xuất file Word 4 mã đề kèm ma trận đáp án thành công", async () => {
  const sampleExam = `BÀI KIỂM TRA CHƯƠNG III: TỪ TRƯỜNG
PHẦN I. Trắc nghiệm
Câu 1. Đơn vị cảm ứng từ là A. Tesla B. Vôn C. Ampe D. Kelvin
Câu 2. Chiều lực từ xác định theo A. Tay phải B. Tay trái C. Đinh ốc D. Con lắc

PHẦN II. Đúng sai
Câu 1. Xét hạt mang điện chuyển động trong từ trường:
a) Lực Lorenxo không sinh công. (Đ)
b) Quỹ đạo luôn là đường tròn. (S)
c) Độ lớn phụ thuộc vận tốc. (Đ)
d) Hạt đứng yên vẫn chịu lực Lorenxo. (S)
`;

  const parsed = parseExamText(sampleExam);
  const res = await exportShuffledExamToDocx(parsed, ["101", "102", "103", "104"], "test_tron_de_4_ma");

  assert.ok(res.filePath.endsWith(".docx"));
  assert.ok(fs.existsSync(res.filePath));

  const buf = fs.readFileSync(res.filePath);
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);

  fs.unlinkSync(res.filePath);
});

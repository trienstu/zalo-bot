import fs from "fs";
import path from "path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
  ShadingType,
} from "docx";

const outputPath = "/Volumes/SSD NVME/BOT MEMBER ZALO/QUY_CHUAN_DE_THI_VAT_LI_2025_BGD.docx";

const FONT_NAME = "Times New Roman";

function headingP(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    text,
    heading: level,
    spacing: { before: 240, after: 120 },
  });
}

function boldPara(label, text = "") {
  return new Paragraph({
    children: [
      new TextRun({ text: label, bold: true, font: FONT_NAME, size: 24 }),
      new TextRun({ text: text ? " " + text : "", font: FONT_NAME, size: 24 }),
    ],
    spacing: { after: 100 },
  });
}

function normalPara(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT_NAME, size: 24 })],
    spacing: { after: 100 },
  });
}

function bulletPara(boldPrefix, content) {
  return new Paragraph({
    bullet: { level: 0 },
    children: [
      new TextRun({ text: boldPrefix + " ", bold: true, font: FONT_NAME, size: 24 }),
      new TextRun({ text: content, font: FONT_NAME, size: 24 }),
    ],
    spacing: { after: 80 },
  });
}

// Bảng cấu trúc đề thi
const tableBorder = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: "999999",
};

const cellBorders = {
  top: tableBorder,
  bottom: tableBorder,
  left: tableBorder,
  right: tableBorder,
};

function makeCell(text, isHeader = false, widthPct = 25, align = AlignmentType.LEFT) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: cellBorders,
    shading: isHeader
      ? { type: ShadingType.CLEAR, fill: "F1F5F9" }
      : undefined,
    children: [
      new Paragraph({
        alignment: align,
        children: [
          new TextRun({
            text,
            bold: isHeader,
            font: FONT_NAME,
            size: isHeader ? 22 : 22,
          }),
        ],
      }),
    ],
  });
}

const structureTable = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({
      children: [
        makeCell("Phần thi", true, 20, AlignmentType.CENTER),
        makeCell("Dạng thức câu hỏi", true, 35),
        makeCell("Số lượng câu", true, 15, AlignmentType.CENTER),
        makeCell("Cách tính điểm", true, 15, AlignmentType.CENTER),
        makeCell("Điểm tối đa", true, 15, AlignmentType.CENTER),
      ],
    }),
    new TableRow({
      children: [
        makeCell("PHẦN I", false, 20, AlignmentType.CENTER),
        makeCell("Trắc nghiệm nhiều lựa chọn (chọn 1 trong 4 đáp án A, B, C, D)", false, 35),
        makeCell("18 câu", false, 15, AlignmentType.CENTER),
        makeCell("0,25 đ / câu", false, 15, AlignmentType.CENTER),
        makeCell("4,50 điểm", false, 15, AlignmentType.CENTER),
      ],
    }),
    new TableRow({
      children: [
        makeCell("PHẦN II", false, 20, AlignmentType.CENTER),
        makeCell("Trắc nghiệm Đúng / Sai (mỗi câu có 4 lệnh hỏi a, b, c, d)", false, 35),
        makeCell("4 câu (16 ý)", false, 15, AlignmentType.CENTER),
        makeCell("Lũy tiến: 0,1 - 0,25 - 0,5 - 1,0 đ", false, 15, AlignmentType.CENTER),
        makeCell("4,00 điểm", false, 15, AlignmentType.CENTER),
      ],
    }),
    new TableRow({
      children: [
        makeCell("PHẦN III", false, 20, AlignmentType.CENTER),
        makeCell("Trắc nghiệm trả lời ngắn (tính toán điền số/kết quả)", false, 35),
        makeCell("6 câu", false, 15, AlignmentType.CENTER),
        makeCell("0,25 đ / câu", false, 15, AlignmentType.CENTER),
        makeCell("1,50 điểm", false, 15, AlignmentType.CENTER),
      ],
    }),
    new TableRow({
      children: [
        makeCell("TỔNG CỘNG", true, 20, AlignmentType.CENTER),
        makeCell("Toàn bài thi (thời gian làm bài: 50 phút)", true, 35),
        makeCell("28 câu (40 lệnh)", true, 15, AlignmentType.CENTER),
        makeCell("—", true, 15, AlignmentType.CENTER),
        makeCell("10,00 điểm", true, 15, AlignmentType.CENTER),
      ],
    }),
  ],
});

const doc = new Document({
  styles: {
    default: {
      document: {
        run: {
          font: FONT_NAME,
          size: 24,
        },
      },
    },
  },
  sections: [
    {
      children: [
        new Paragraph({
          text: "BỘ GIÁO DỤC VÀ ĐÀO TẠO — CHƯƠNG TRÌNH GDPT 2018",
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: "BỘ GIÁO DỤC VÀ ĐÀO TẠO — CHƯƠNG TRÌNH GDPT 2018\n",
              bold: true,
              font: FONT_NAME,
              size: 24,
            }),
            new TextRun({
              text: "QUY CHUẨN ĐỊNH DẠNG ĐỀ THI TỐT NGHIỆP THPT TỪ NĂM 2025 MÔN VẬT LÍ\n",
              bold: true,
              font: FONT_NAME,
              size: 28,
              color: "1E3A8A",
            }),
            new TextRun({
              text: "(Căn cứ Quyết định số 764/QĐ-BGDĐT ngày 29/12/2023 của Bộ GD&ĐT)",
              italics: true,
              font: FONT_NAME,
              size: 20,
              color: "64748B",
            }),
          ],
          spacing: { after: 280 },
        }),

        headingP("I. TỔNG QUAN CẤU TRÚC ĐỀ THI ĐỊNH DẠNG MỚI (TỪ NĂM 2025)"),
        normalPara(
          "Từ kỳ thi tốt nghiệp THPT năm 2025 theo Chương trình Giáo dục phổ thông 2018, môn Vật lí áp dụng cấu trúc định dạng đề thi mới gồm 3 phần thi độc lập, thời gian làm bài 50 phút, tổng điểm tối đa là 10,0 điểm:"
        ),
        structureTable,
        new Paragraph({ spacing: { after: 200 } }),

        headingP("II. NGUYÊN TẮC VÀ QUY TẮC CHẤM ĐIỂM CHI TIẾT"),
        boldPara("1. Phần I — Câu trắc nghiệm nhiều phương án lựa chọn (18 câu, 4,5 điểm)"),
        bulletPara("Hình thức:", "Mỗi câu hỏi có 4 phương án trả lời A, B, C, D. Thí sinh chỉ chọn 1 phương án duy nhất."),
        bulletPara("Thang điểm:", "Chọn đúng được 0,25 điểm / câu. Chọn sai hoặc không chọn: 0 điểm."),
        bulletPara("Mức độ nhận thức:", "Tập trung vào cấp độ Nhận biết và Thông hiểu cơ bản (khoảng 14-16 câu nhận biết, 2-4 câu thông hiểu)."),

        boldPara("2. Phần II — Câu trắc nghiệm dạng Đúng / Sai (4 câu, 4,0 điểm)"),
        bulletPara("Hình thức:", "Mỗi câu hỏi đưa ra một hiện tượng, thí nghiệm hoặc bảng số liệu/đồ thị cụ thể, kèm 4 ý lệnh hỏi a), b), c), d). Thí sinh lựa chọn Đúng (Đ) hoặc Sai (S) cho từng ý."),
        bulletPara("Quy tắc tính điểm lũy tiến (rất quan trọng):", "Điểm được chấm lũy tiến theo số lượng ý đúng trong từng câu như sau:"),
        new Paragraph({
          children: [
            new TextRun({ text: "  • Thí sinh chỉ lựa chọn chính xác 01 ý trong 01 câu: ", font: FONT_NAME }),
            new TextRun({ text: "0,10 điểm\n", bold: true, font: FONT_NAME }),
            new TextRun({ text: "  • Thí sinh lựa chọn chính xác 02 ý trong 01 câu: ", font: FONT_NAME }),
            new TextRun({ text: "0,25 điểm\n", bold: true, font: FONT_NAME }),
            new TextRun({ text: "  • Thí sinh lựa chọn chính xác 03 ý trong 01 câu: ", font: FONT_NAME }),
            new TextRun({ text: "0,50 điểm\n", bold: true, font: FONT_NAME }),
            new TextRun({ text: "  • Thí sinh lựa chọn chính xác cả 04 ý trong 01 câu: ", font: FONT_NAME }),
            new TextRun({ text: "1,00 điểm", bold: true, font: FONT_NAME, color: "059669" }),
          ],
          spacing: { after: 120 },
        }),
        bulletPara("Mức độ nhận thức:", "Kết hợp Thông hiểu, Vận dụng và phân tích hiện tượng vật lý đa chiều."),

        boldPara("3. Phần III — Câu trắc nghiệm dạng trả lời ngắn (6 câu, 1,5 điểm)"),
        bulletPara("Hình thức:", "Thí sinh tự giải toán và ghi kết quả tính toán cuối cùng vào phiếu trả lời (không có đáp án A, B, C, D để đoán mò)."),
        bulletPara("Thang điểm:", "Trả lời đúng đáp số: được 0,25 điểm / câu. Sai hoặc sai đơn vị: 0 điểm."),
        bulletPara("Mức độ nhận thức:", "Tập trung vào Vận dụng và Vận dụng cao, yêu cầu năng lực tính toán định lượng chính xác."),

        headingP("III. MA TRẬN ĐỀ THI & PHÂN PHỐI NỘI DUNG VẬT LÍ"),
        bulletPara("Tỉ lệ phân bố mức độ tư duy:", "Nhận biết: ~40% (4,0 đ) | Thông hiểu: ~30% (3,0 đ) | Vận dụng: ~30% (3,0 đ)."),
        bulletPara("Nội dung cốt lõi:", "Vật lí nhiệt (Nhiệt độ, nhiệt dung riêng, nhiệt nóng chảy, nội năng); Khí lí tưởng (Các định luật chất khí, phương trình Clapeyron - Mendeleev); Từ trường & Cảm ứng từ; Vật lí hạt nhân & Năng lượng hạt nhân; Dao động & Sóng cơ."),

        headingP("IV. CHỈ DẪN BẮT BUỘC KHI TRỢ LÝ AI (BOT) BIÊN SOẠN ĐỀ THI"),
        normalPara("Khi thầy cô yêu cầu 'soạn đề kiểm tra', 'tạo đề thi học kì' hoặc 'ra đề Vật lí theo chuẩn mới', Bot BẮT BUỘC phải tuân thủ nghiêm ngặt các quy tắc sau:"),
        bulletPara("1. Bố cục đầy đủ 3 Phần:", "Không được gộp lại thành 40 câu trắc nghiệm kiểu cũ. Phải ghi rõ tiêu đề và thang điểm của Phần I (18 câu), Phần II (4 câu a-b-c-d), Phần III (6 câu điền số)."),
        bulletPara("2. Soạn đủ 4 phương án cho Phần I:", "Các đáp án A, B, C, D phải rõ ràng, ngắn gọn, có tính nhiễu hợp lí."),
        bulletPara("3. Phần II phải có ngữ cảnh rõ ràng:", "Mỗi câu phải có 1 đoạn văn bối cảnh thí nghiệm/hiện tượng, sau đó liệt kê 4 mệnh đề a), b), c), d) để đánh giá Đúng/Sai."),
        bulletPara("4. Phần III phải là câu hỏi tính toán ra giá trị:", "Ghi rõ đơn vị yêu cầu làm tròn (ví dụ: 'làm tròn đến 1 chữ số thập phân' hoặc 'đơn vị m/s')."),
        bulletPara("5. Bảng đáp án & Lời giải chi tiết:", "Cuối đề thi BẮT BUỘC xuất kèm:\n   - Bảng đáp án tổng hợp Phần I (1-18).\n   - Bảng Đúng/Sai Phần II (Câu 1: a-Đ, b-S, c-Đ, d-S...).\n   - Đáp số Phần III (1-6).\n   - Lời giải chi tiết từng bước cho toàn bộ 28 câu hỏi."),
        bulletPara("6. Tự động xuất file Word:", "Gọi công cụ 'generate_file' với fileType='docx' để nộp file đính kèm trực tiếp cho thầy cô tải về máy!"),

        new Paragraph({ spacing: { after: 240 } }),
        new Paragraph({
          text: "— HẾT QUY CHUẨN —",
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: "— HẾT TÀI LIỆU QUY CHUẨN ĐỀ THI —",
              bold: true,
              font: FONT_NAME,
              size: 22,
              color: "64748B",
            }),
          ],
        }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outputPath, buffer);
  console.log("✅ Đã tạo thành công file Word tại:", outputPath);
});

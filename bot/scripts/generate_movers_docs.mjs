import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
} from "docx";

const CACHE_FILE = "/tmp/movers_cd1_transcripts.json";
const OUTPUT_DIR = "/tmp/movers_out";
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const OUTPUT_DOCX = path.join(OUTPUT_DIR, "Get_Ready_for_Movers_CD1_Full_35_Tracks.docx");
const OUTPUT_HTML = path.join(OUTPUT_DIR, "Get_Ready_for_Movers_CD1_Full_35_Tracks.html");
const OUTPUT_PDF = path.join(OUTPUT_DIR, "Get_Ready_for_Movers_CD1_Full_35_Tracks.pdf");

const cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));

// ==========================================
// 1. TẠO FILE DOCX CHUẨN ĐẸP 100%
// ==========================================
async function buildDocx() {
  const docChildren = [];
  const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

  // Trang bìa & Header
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "OXFORD UNIVERSITY PRESS • CAMBRIDGE ENGLISH",
          font: "Times New Roman",
          size: 20,
          color: "555555",
          bold: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "GET READY FOR MOVERS - CD 1",
          font: "Times New Roman",
          size: 38,
          bold: true,
          color: "1F497D",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "TOÀN BỘ TRANSCRIPT SONG NGỮ ANH - VIỆT & HƯỚNG DẪN BÀI HỌC (35 TRACKS)",
          font: "Times New Roman",
          size: 24,
          bold: true,
          color: "2E75B6",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Biên soạn chi tiết từng câu thoại • Dịch nghĩa chuẩn sư phạm • Từ vựng & Mẹo thi",
          font: "Times New Roman",
          size: 20,
          italics: true,
          color: "666666",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 350 },
    })
  );

  // Bảng mục lục
  const indexHeaders = ["Mã bài", "Tên bài học", "Chủ đề / Dạng bài"];
  const indexColWidths = [1800, 4200, 3000];
  const indexRows = [];

  for (let i = 1; i <= 35; i++) {
    const key = `track_${String(i).padStart(2, "0")}`;
    const data = cache[key] || { title: `Track ${i}`, topic: "Listening" };
    indexRows.push([
      `Track ${String(i).padStart(2, "0")}`,
      data.title || `Listening ${i}`,
      data.topic || "Cambridge Movers Listening",
    ]);
  }

  const indexTable = new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [1800, 4200, 3000],
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: indexHeaders.map(
          (h, idx) =>
            new TableCell({
              width: {
                size: indexColWidths[idx] || 3000,
                type: WidthType.DXA,
              },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: h,
                      bold: true,
                      font: "Times New Roman",
                      size: 22,
                      color: "FFFFFF",
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                }),
              ],
              shading: { fill: "1F497D" },
              borders: cellBorders,
            })
        ),
      }),
      ...indexRows.map(
        (row, rIdx) =>
          new TableRow({
            cantSplit: true,
            children: row.map(
              (c, cIdx) =>
                new TableCell({
                  width: {
                    size: indexColWidths[cIdx] || 3000,
                    type: WidthType.DXA,
                  },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: c,
                          font: "Times New Roman",
                          size: 20,
                          bold: cIdx === 0,
                        }),
                      ],
                      alignment: cIdx === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
                    }),
                  ],
                  shading: { fill: rIdx % 2 === 0 ? "F2F2F2" : "FFFFFF" },
                  borders: cellBorders,
                })
            ),
          })
      ),
    ],
  });

  docChildren.push(indexTable);
  docChildren.push(new Paragraph({ spacing: { after: 400 } }));

  // Nội dung chi tiết 35 tracks
  for (let i = 1; i <= 35; i++) {
    const key = `track_${String(i).padStart(2, "0")}`;
    const item = cache[key] || {
      trackNumber: i,
      title: `Listening ${i}`,
      topic: "Listening Practice",
      dialogues: [],
      vocabulary: [],
      notes: "",
    };

    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `TRACK ${String(i).padStart(2, "0")}: ${item.title.toUpperCase()}`,
            font: "Times New Roman",
            size: 26,
            bold: true,
            color: "1F497D",
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 60 },
      })
    );

    if (item.topic) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `📌 Chủ đề: `,
              font: "Times New Roman",
              bold: true,
              size: 22,
              color: "333333",
            }),
            new TextRun({
              text: item.topic,
              font: "Times New Roman",
              size: 22,
              italics: true,
              color: "1F497D",
            }),
          ],
          spacing: { after: 120 },
        })
      );
    }

    const dialogues = item.dialogues || [];
    if (dialogues.length > 0) {
      const dialogueHeaders = ["Người nói", "Lời thoại tiếng Anh (English)", "Bản dịch tiếng Việt (Vietnamese)"];
      const dColWidths = [1800, 3800, 3400];
      const dTable = new Table({
        width: { size: 9000, type: WidthType.DXA },
        columnWidths: [1800, 3800, 3400],
        rows: [
          new TableRow({
            tableHeader: true,
            cantSplit: true,
            children: dialogueHeaders.map(
              (h, idx) =>
                new TableCell({
                  width: {
                    size: dColWidths[idx] || 3000,
                    type: WidthType.DXA,
                  },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: h,
                          bold: true,
                          font: "Times New Roman",
                          size: 21,
                          color: "FFFFFF",
                        }),
                      ],
                      alignment: AlignmentType.CENTER,
                    }),
                  ],
                  shading: { fill: "2E75B6" },
                  borders: cellBorders,
                })
            ),
          }),
          ...dialogues.map(
            (d, dIdx) =>
              new TableRow({
                cantSplit: true,
                children: [
                  new TableCell({
                    width: { size: 1800, type: WidthType.DXA },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: d.speaker || "Speaker",
                            bold: true,
                            font: "Times New Roman",
                            size: 20,
                            color: "1F497D",
                          }),
                        ],
                      }),
                    ],
                    shading: { fill: dIdx % 2 === 0 ? "F9FBFD" : "FFFFFF" },
                    borders: cellBorders,
                  }),
                  new TableCell({
                    width: { size: 3800, type: WidthType.DXA },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: d.en || "",
                            font: "Times New Roman",
                            size: 20,
                          }),
                        ],
                      }),
                    ],
                    shading: { fill: dIdx % 2 === 0 ? "F9FBFD" : "FFFFFF" },
                    borders: cellBorders,
                  }),
                  new TableCell({
                    width: { size: 3400, type: WidthType.DXA },
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: d.vi || "",
                            font: "Times New Roman",
                            size: 20,
                            color: "262626",
                          }),
                        ],
                      }),
                    ],
                    shading: { fill: dIdx % 2 === 0 ? "F9FBFD" : "FFFFFF" },
                    borders: cellBorders,
                  }),
                ],
              })
          ),
        ],
      });
      docChildren.push(dTable);
    }

    if (item.vocabulary && item.vocabulary.length > 0) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "🔑 Từ vựng & Điểm ngữ pháp trọng tâm:",
              bold: true,
              font: "Times New Roman",
              size: 22,
              color: "1F497D",
            }),
          ],
          spacing: { before: 140, after: 60 },
        })
      );
      for (const vocab of item.vocabulary) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: vocab,
                font: "Times New Roman",
                size: 20,
              }),
            ],
            bullet: { level: 0 },
            spacing: { after: 40 },
          })
        );
      }
    }

    if (item.notes) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "💡 Ghi chú sư phạm & Mẹo làm bài: ",
              bold: true,
              font: "Times New Roman",
              size: 21,
              color: "70AD47",
            }),
            new TextRun({
              text: item.notes,
              font: "Times New Roman",
              size: 20,
              italics: true,
            }),
          ],
          spacing: { before: 100, after: 200 },
        })
      );
    }

    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "—".repeat(45),
            color: "D9D9D9",
            size: 16,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 250 },
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1000,
              bottom: 1000,
              left: 1200,
              right: 1200,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(OUTPUT_DOCX, buffer);
  console.log(`✅ Đã tạo file DOCX: ${OUTPUT_DOCX} (${Math.round(buffer.length / 1024)} KB)`);
}

// ==========================================
// 2. TẠO FILE HTML & PDF CHUẨN XUẤT BẢN
// ==========================================
function buildHtml() {
  let trackSections = "";

  for (let i = 1; i <= 35; i++) {
    const key = `track_${String(i).padStart(2, "0")}`;
    const item = cache[key] || {
      trackNumber: i,
      title: `Listening ${i}`,
      topic: "Listening Practice",
      dialogues: [],
      vocabulary: [],
      notes: "",
    };

    const dialoguesHtml = (item.dialogues || [])
      .map(
        (d, idx) => `
        <tr class="${idx % 2 === 0 ? "even" : "odd"}">
          <td class="col-speaker"><strong>${d.speaker || "Speaker"}</strong></td>
          <td class="col-en">${d.en || ""}</td>
          <td class="col-vi">${d.vi || ""}</td>
        </tr>
      `
      )
      .join("");

    const vocabHtml =
      item.vocabulary && item.vocabulary.length > 0
        ? `
        <div class="vocab-box">
          <div class="vocab-title">🔑 Từ vựng & Ngữ pháp trọng tâm:</div>
          <ul class="vocab-list">
            ${item.vocabulary.map((v) => `<li>${v}</li>`).join("")}
          </ul>
        </div>
      `
        : "";

    const notesHtml = item.notes
      ? `
        <div class="notes-box">
          💡 <strong>Ghi chú sư phạm & Mẹo thi Movers:</strong> <em>${item.notes}</em>
        </div>
      `
      : "";

    trackSections += `
      <section class="track-section">
        <h2 class="track-title">TRACK ${String(i).padStart(2, "0")}: ${item.title.toUpperCase()}</h2>
        ${item.topic ? `<div class="track-topic">📌 <strong>Chủ đề:</strong> <em>${item.topic}</em></div>` : ""}
        <table class="dialogue-table">
          <thead>
            <tr>
              <th style="width: 20%;">Người nói</th>
              <th style="width: 42%;">Lời thoại tiếng Anh (English)</th>
              <th style="width: 38%;">Bản dịch tiếng Việt (Vietnamese)</th>
            </tr>
          </thead>
          <tbody>
            ${dialoguesHtml}
          </tbody>
        </table>
        ${vocabHtml}
        ${notesHtml}
      </section>
    `;
  }

  // Mục lục HTML
  let indexRowsHtml = "";
  for (let i = 1; i <= 35; i++) {
    const key = `track_${String(i).padStart(2, "0")}`;
    const data = cache[key] || { title: `Track ${i}`, topic: "Listening" };
    indexRowsHtml += `
      <tr class="${i % 2 === 0 ? "even" : "odd"}">
        <td style="text-align: center; font-weight: bold;">Track ${String(i).padStart(2, "0")}</td>
        <td>${data.title || `Listening ${i}`}</td>
        <td>${data.topic || "Movers Listening"}</td>
      </tr>
    `;
  }

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Get Ready for Movers - CD 1 Full Transcript</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm 12mm 15mm 12mm;
      @bottom-right {
        content: counter(page);
      }
    }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #222;
      background: #fff;
      margin: 0;
      padding: 0;
    }
    .cover-header {
      text-align: center;
      margin-bottom: 25px;
      padding-bottom: 15px;
      border-bottom: 2px solid #1F497D;
    }
    .cover-sub {
      font-size: 9.5pt;
      letter-spacing: 1.5px;
      color: #555;
      font-weight: bold;
      margin-bottom: 6px;
    }
    .cover-main-title {
      font-size: 22pt;
      font-weight: bold;
      color: #1F497D;
      margin: 4px 0;
    }
    .cover-doc-title {
      font-size: 13pt;
      font-weight: bold;
      color: #2E75B6;
      margin: 4px 0;
    }
    .cover-desc {
      font-size: 10pt;
      color: #666;
      font-style: italic;
      margin-top: 4px;
    }
    .index-title {
      font-size: 13pt;
      font-weight: bold;
      color: #1F497D;
      margin-top: 15px;
      margin-bottom: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
      page-break-inside: auto;
    }
    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }
    th, td {
      border: 1px solid #D0D7DE;
      padding: 6px 8px;
      font-size: 10pt;
      vertical-align: top;
    }
    th {
      background-color: #1F497D;
      color: #fff;
      font-weight: bold;
      text-align: center;
    }
    .dialogue-table th {
      background-color: #2E75B6;
    }
    tr.even {
      background-color: #F8FAFC;
    }
    tr.odd {
      background-color: #FFFFFF;
    }
    .col-speaker {
      color: #1F497D;
      font-weight: bold;
      width: 20%;
    }
    .col-en {
      color: #111;
      width: 42%;
    }
    .col-vi {
      color: #262626;
      width: 38%;
    }
    .track-section {
      margin-top: 25px;
      padding-top: 15px;
      border-top: 1px dashed #CCC;
      page-break-inside: avoid;
    }
    .track-title {
      font-size: 13pt;
      font-weight: bold;
      color: #1F497D;
      margin: 0 0 6px 0;
    }
    .track-topic {
      font-size: 10.5pt;
      color: #444;
      margin-bottom: 10px;
    }
    .vocab-box {
      background: #F0F4F8;
      border-left: 3px solid #1F497D;
      padding: 6px 12px;
      margin: 10px 0;
      border-radius: 0 4px 4px 0;
    }
    .vocab-title {
      font-weight: bold;
      color: #1F497D;
      font-size: 10pt;
      margin-bottom: 4px;
    }
    .vocab-list {
      margin: 0;
      padding-left: 18px;
      font-size: 9.5pt;
    }
    .vocab-list li {
      margin-bottom: 2px;
    }
    .notes-box {
      background: #F3FAF2;
      border-left: 3px solid #70AD47;
      padding: 6px 12px;
      margin: 8px 0 15px 0;
      font-size: 9.5pt;
      color: #2E5618;
      border-radius: 0 4px 4px 0;
    }
  </style>
</head>
<body>
  <div class="cover-header">
    <div class="cover-sub">OXFORD UNIVERSITY PRESS • CAMBRIDGE ENGLISH</div>
    <div class="cover-main-title">GET READY FOR MOVERS - CD 1</div>
    <div class="cover-doc-title">TOÀN BỘ TRANSCRIPT SONG NGỮ ANH - VIỆT & HƯỚNG DẪN BÀI HỌC (35 TRACKS)</div>
    <div class="cover-desc">Biên soạn chi tiết từng câu thoại • Dịch nghĩa chuẩn sư phạm • Từ vựng & Mẹo làm bài thi</div>
  </div>

  <div class="index-title">📋 BẢNG MỤC LỤC 35 TRACKS</div>
  <table>
    <thead>
      <tr>
        <th style="width: 18%;">Mã bài</th>
        <th style="width: 48%;">Tên bài học</th>
        <th style="width: 34%;">Chủ đề / Dạng bài</th>
      </tr>
    </thead>
    <tbody>
      ${indexRowsHtml}
    </tbody>
  </table>

  ${trackSections}
</body>
</html>`;

  fs.writeFileSync(OUTPUT_HTML, html, "utf8");
  console.log(`✅ Đã tạo file HTML: ${OUTPUT_HTML}`);

  // Chuyển HTML sang PDF bằng Chrome Headless
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  console.log(`🔄 Đang chuyển HTML sang PDF qua Chrome headless...`);
  const cmd = `"${chromePath}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${OUTPUT_PDF}" "${OUTPUT_HTML}"`;
  execSync(cmd, { stdio: "inherit" });
  const pdfStats = fs.statSync(OUTPUT_PDF);
  console.log(`✅ Đã tạo file PDF: ${OUTPUT_PDF} (${Math.round(pdfStats.size / 1024)} KB)`);
}

async function run() {
  await buildDocx();
  buildHtml();
}

run().catch((e) => {
  console.error("Lỗi:", e);
  process.exit(1);
});

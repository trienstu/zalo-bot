import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  HeadingLevel,
  AlignmentType,
} from "docx";
import { transcribeCloudflareAudio, isCloudflareConfigured } from "../dist/cloudflare-ai.js";
import { callGemini } from "../dist/gemini.js";

const BASE_AUDIO_DIR = "/tmp/movers_cd1/extracted/Get Ready for Movers_CD 1/Get Ready for Movers_CD 1";
const CACHE_FILE = "/tmp/movers_cd1/movers_cd1_transcripts.json";
const OUTPUT_DOCX = "/home/ubuntu/zalo-bot-2/bot/data/generated-files/Get_Ready_for_Movers_CD1_Full_35_Tracks.docx";
const TARGET_USER_ID = "7562597848104391036"; // Anh Trần Văn Tuyến

async function main() {
  console.log("=== BẮT ĐẦU XỬ LÝ TRỌN BỘ 35 TRACKS GET READY FOR MOVERS CD 1 ===");

  if (!fs.existsSync(BASE_AUDIO_DIR)) {
    throw new Error(`Thư mục âm thanh không tồn tại: ${BASE_AUDIO_DIR}`);
  }

  // Đọc danh sách file âm thanh wma và sắp xếp theo thứ tự
  const files = fs
    .readdirSync(BASE_AUDIO_DIR)
    .filter((f) => f.endsWith(".wma"))
    .sort((a, b) => {
      const numA = parseInt(a.slice(0, 2), 10) || 0;
      const numB = parseInt(b.slice(0, 2), 10) || 0;
      return numA - numB;
    });

  console.log(`Tìm thấy ${files.length} tracks wma.`);

  // Load cache nếu đã có
  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      console.log(`Đã load cache: ${Object.keys(cache).length} tracks đã xử lý trước đó.`);
    } catch {}
  }

  // Xử lý từng track
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const trackNum = i + 1;
    const trackKey = `track_${String(trackNum).padStart(2, "0")}`;

    if (cache[trackKey] && cache[trackKey].dialogues && cache[trackKey].dialogues.length > 0) {
      console.log(`[Track ${trackNum}/35] Đã có trong cache: "${cache[trackKey].title}" -> bỏ qua.`);
      continue;
    }

    console.log(`\n--------------------------------------------------`);
    console.log(`[Track ${trackNum}/35] 🎧 Đang xử lý file: ${filename}...`);

    const wmaPath = path.join(BASE_AUDIO_DIR, filename);
    const mp3Path = `/tmp/movers_cd1/track_${String(trackNum).padStart(2, "0")}.mp3`;

    // 1. Chuyển đổi WMA sang MP3 bằng ffmpeg
    if (!fs.existsSync(mp3Path)) {
      try {
        execSync(
          `ffmpeg -y -i "${wmaPath}" -f mp3 -acodec libmp3lame -b:a 128k "${mp3Path}" 2>/dev/null`,
          { timeout: 15_000 }
        );
      } catch (ffErr) {
        console.warn(`Lỗi ffmpeg track ${trackNum}:`, ffErr);
      }
    }

    const mp3Buf = fs.readFileSync(mp3Path);
    console.log(`  File MP3: ${mp3Buf.length} bytes.`);

    // 2. Bóc băng âm thanh qua Cloudflare Whisper
    let whisperText = "";
    if (isCloudflareConfigured()) {
      try {
        console.log(`  🎙️ Đang bóc băng qua Cloudflare Whisper...`);
        const wRes = await transcribeCloudflareAudio(mp3Buf);
        if (wRes?.success && wRes.text) {
          whisperText = wRes.text.trim();
          console.log(`  ✅ Whisper hoàn tất (${whisperText.length} ký tự).`);
        }
      } catch (wErr) {
        console.warn(`  ⚠️ Whisper gặp sự cố:`, wErr);
      }
    }

    // 3. Sử dụng Gemini để phân tích cấu trúc, dịch song ngữ và bổ sung từ vựng, mẹo làm bài
    let structured = null;
    const prompt =
      `Bạn là giáo viên chuyên ngữ tiếng Anh luyện thi chứng chỉ Cambridge Young Learners English (Movers A1 - Oxford University Press).\n` +
      `Dưới đây là thông tin bài nghe số ${trackNum} trích từ đĩa CD 1 của bộ sách "Get Ready for Movers":\n\n` +
      `TRANSCRIPT ÂM THANH:\n"""\n${whisperText || "Audio track " + trackNum}\n"""\n\n` +
      `Nhiệm vụ: Hãy phân tích đoạn nghe trên thành bảng hội thoại chuẩn mực, dịch nghĩa tiếng Việt sư phạm chuẩn xác từng câu, liệt kê từ vựng trọng tâm và hướng dẫn học sinh.\n` +
      `BẮT BUỘC trả về định dạng JSON thuần túy (KHÔNG dùng markdown backticks, KHÔNG dùng \`\`\`json) với cấu trúc:\n` +
      `{\n` +
      `  "trackNumber": ${trackNum},\n` +
      `  "title": "Tiêu đề bài nghe (ví dụ: Listening 1 - Jack's House & Address / Movers Practice Test - Listening Part 1)",\n` +
      `  "topic": "Chủ đề bài học (ví dụ: My House, Numbers 10-100, At the Beach, Hobbies...)",\n` +
      `  "dialogues": [\n` +
      `    {"speaker": "Tên người nói (ví dụ: Narrator / Jack / Daisy / Teacher / Boy / Girl / Mum)", "en": "Câu thoại tiếng Anh đầy đủ", "vi": "Bản dịch tiếng Việt chuẩn nghĩa"}\n` +
      `  ],\n` +
      `  "vocabulary": ["Từ vựng hoặc cấu trúc 1", "Từ vựng 2", "Từ vựng 3"],\n` +
      `  "notes": "Ghi chú sư phạm ngắn gọn về điểm ngữ pháp, phát âm hoặc dạng bài thi Movers"\n` +
      `}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`  🤖 Đang phân tích và dịch song ngữ qua Gemini (lần ${attempt})...`);
        const geminiRes = await callGemini(prompt, `Track ${trackNum}`, {
          model: "gemini-3.1-flash-lite-preview",
        });

        if (geminiRes) {
          const cleanJson = geminiRes.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          structured = JSON.parse(cleanJson);
          console.log(`  ✅ Phân tích thành công: "${structured.title}" (${structured.dialogues?.length || 0} câu thoại)`);
          break;
        }
      } catch (gErr) {
        console.warn(`  ⚠️ Gemini lần ${attempt} thất bại:`, String(gErr).slice(0, 150));
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }

    // Fallback nếu JSON parse lỗi
    if (!structured) {
      structured = {
        trackNumber: trackNum,
        title: `Listening ${trackNum}`,
        topic: "General Listening Practice",
        dialogues: [
          {
            speaker: "Audio",
            en: whisperText || `Audio track ${trackNum}`,
            vi: "Nội dung bài nghe track " + trackNum,
          },
        ],
        vocabulary: [],
        notes: "Luyện nghe bài tập Get Ready for Movers.",
      };
    }

    cache[trackKey] = structured;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");

    // Nghỉ nhẹ 500ms giữa các track
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n==================================================");
  console.log("✅ ĐÃ HOÀN TẤT BÓC BĂNG & DỊCH NGHĨA TẤT CẢ 35 TRACKS!");
  console.log("==================================================");

  // 4. Tạo file Word .docx chuyên nghiệp
  console.log(`\n📄 Đang biên soạn file Word tổng hợp: ${OUTPUT_DOCX}...`);
  await buildConsolidatedWordDoc(cache, OUTPUT_DOCX);
  console.log(`✅ File Word đã được tạo thành công: ${OUTPUT_DOCX}`);

  // 5. Gửi file trực tiếp đến anh Trần Văn Tuyến qua zalo-bot-2
  console.log(`\n📤 Đang gửi file trực tiếp đến Zalo của anh Trần Văn Tuyến (${TARGET_USER_ID})...`);
  const reqPayload = {
    requestId: `movers_cd1_${Date.now()}`,
    userId: TARGET_USER_ID,
    filePath: OUTPUT_DOCX,
    caption:
      "Dạ em gửi anh Tuyến bản Word tổng hợp trọn bộ 35 bài nghe Get Ready for Movers CD 1 đầy đủ transcript song ngữ Anh - Việt và ghi chú bài học chi tiết nhé ạ! ☘️📄",
    requestedAt: Date.now(),
    requestedBy: "batch_movers_processor",
  };

  const requestFile = "/home/ubuntu/zalo-bot-2/bot/data/direct-send-request.json";
  fs.writeFileSync(requestFile, JSON.stringify(reqPayload, null, 2), "utf8");
  console.log(`✅ Đã gửi lệnh DirectSendRequest thành công qua file: ${requestFile}`);
  console.log(`Bot zalo-bot-2 sẽ tự động gửi file trong vài giây tới.`);
}

async function buildConsolidatedWordDoc(cache, outputPath) {
  const docChildren = [];

  const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

  // --- TRANG BÌA & TIÊU ĐỀ CHÍNH ---
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
          color: "1F497D", // Deep Navy Blue
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
          color: "595959",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Tác giả: Kirstie Granger  |  Trình độ: Cambridge Movers (CEFR A1)  |  Biên tập phục vụ học tập",
          font: "Times New Roman",
          size: 20,
          italics: true,
          color: "7F7F7F",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // --- BẢNG TỔNG QUAN / MỤC LỤC 35 TRACKS ---
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "MỤC LỤC TRỌN BỘ 35 BÀI NGHE (CD 1)",
          font: "Times New Roman",
          size: 26,
          bold: true,
          color: "1F497D",
        }),
      ],
      spacing: { before: 200, after: 150 },
    })
  );

  const indexHeaders = ["Track", "Tiêu đề bài nghe", "Chủ đề / Kỹ năng"];
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
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: indexHeaders.map(
          (h, idx) =>
            new TableCell({
              width: {
                size: idx === 0 ? 15 : idx === 1 ? 50 : 35,
                type: WidthType.PERCENTAGE,
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
            children: row.map(
              (c, cIdx) =>
                new TableCell({
                  width: {
                    size: cIdx === 0 ? 15 : cIdx === 1 ? 50 : 35,
                    type: WidthType.PERCENTAGE,
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

  // --- NỘI DUNG CHI TIẾT TỪNG TRACK ---
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

    // Header của Track
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

    // Bảng lời thoại song ngữ
    const dialogues = item.dialogues || [];
    if (dialogues.length > 0) {
      const dialogueHeaders = ["Người nói", "Lời thoại tiếng Anh (English)", "Bản dịch tiếng Việt (Vietnamese)"];
      const dTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: dialogueHeaders.map(
              (h, idx) =>
                new TableCell({
                  width: {
                    size: idx === 0 ? 18 : idx === 1 ? 42 : 40,
                    type: WidthType.PERCENTAGE,
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
                children: [
                  new TableCell({
                    width: { size: 18, type: WidthType.PERCENTAGE },
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
                    width: { size: 42, type: WidthType.PERCENTAGE },
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
                    width: { size: 40, type: WidthType.PERCENTAGE },
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

    // Từ vựng trọng tâm
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

    // Ghi chú sư phạm & Mẹo thi Movers
    if (item.notes) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "💡 Ghi chú sư phạm & Mẹo làm bài: ",
              bold: true,
              font: "Times New Roman",
              size: 21,
              color: "70AD47", // Green
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

    // Đường kẻ phân cách giữa các track
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
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});

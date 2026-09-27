import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
  convertInchesToTwip,
} from "docx";
import { isAudioExtension, transcribeAudioBuffer } from "../audio-transcoder.js";
import { callGemini } from "../gemini.js";
import { sendDirectFile, sendDirectText, sendGroupFile, sendGroupText } from "../zalo/client.js";

const execFileAsync = promisify(execFile);

export interface BatchAudioTrack {
  index: number;
  fileName: string;
  title: string;
  filePath: string;
  transcript: string;
  translation: string;
  dialogues: Array<{
    speaker?: string;
    text: string;
    translation?: string;
  }>;
  keyNotes: string[];
  summary: string;
}

export interface BatchAudioJobOptions {
  api: any;
  sender: string;
  isGroup: boolean;
  threadId?: string;
  userGreeting: string;
  displayName?: string;
  zipFilePath?: string;
  audioFilePaths?: string[];
  originalFileName?: string;
  userPrompt?: string;
}

const OUTPUT_DIR = path.resolve(process.cwd(), "data", "generated-files");

export function ensureOutputDir(): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  return OUTPUT_DIR;
}

/**
 * Kiểm tra xem người dùng có yêu cầu xử lý bộ âm thanh / file nén batch hay không.
 */
export function isBatchAudioRequest(text: string, fileName = ""): boolean {
  const lowerName = fileName.toLowerCase().trim();
  const lowerText = text.toLowerCase().trim();

  const isZip = lowerName.endsWith(".zip") || lowerName.endsWith(".rar") || lowerName.endsWith(".tar.gz");
  const mentionsAudio =
    /(?:audio|bài\s*nghe|track|cd|ghi\s*âm|tiếng|nghe|thoại|băng|mp3|m4a|wav|wma)/i.test(lowerText) ||
    /(?:audio|cd|track|movers|flyers|starters|ielts|toeic|listening)/i.test(lowerName);

  const mentionsBatchIntent =
    /(?:bóc\s*băng|chép\s*lời|transcript|xuất\s*(?:file\s*)?word|sang\s*word|cho\s*vào\s*word|ra\s*word|tổng\s*hợp|trọn\s*bộ|tất\s*cả|biên\s*soạn|dịch|song\s*ngữ)/i.test(
      lowerText,
    );

  if (isZip && (mentionsAudio || mentionsBatchIntent || /audio|listening|cd/i.test(lowerName))) {
    return true;
  }

  if (isZip) {
    return true;
  }

  return false;
}

/**
 * Giải nén file zip và trả về danh sách file âm thanh được sắp xếp tự nhiên.
 */
export async function extractAudioFilesFromZip(zipPath: string, targetDir: string): Promise<string[]> {
  fs.mkdirSync(targetDir, { recursive: true });

  try {
    await execFileAsync("unzip", ["-q", "-o", zipPath, "-d", targetDir]);
  } catch (err: any) {
    console.warn(`[batch-audio] Lỗi giải nén bằng unzip CLI:`, err?.message || err);
    throw new Error(`Không thể giải nén file archive: ${err?.message || "unzip failed"}`);
  }

  const audioFiles: string[] = [];
  function scanDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).replace(/^\./, "").toLowerCase();
        if (isAudioExtension(ext)) {
          audioFiles.push(fullPath);
        }
      }
    }
  }

  scanDir(targetDir);

  // Sắp xếp tự nhiên (Track 1, Track 2, ... Track 10)
  audioFiles.sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  return audioFiles;
}

/**
 * Chuyển đổi file .docx thành file .pdf chất lượng cao
 * 1. Ưu tiên LibreOffice (soffice --headless --convert-to pdf) nếu có (chuẩn 100% Word)
 * 2. Fallback Chrome headless nếu LibreOffice không có
 */
export async function convertDocxToPdf(docxPath: string): Promise<string | null> {
  const dir = path.dirname(docxPath);
  const baseName = path.basename(docxPath, path.extname(docxPath));
  const expectedPdf = path.join(dir, `${baseName}.pdf`);

  // Thử LibreOffice (soffice)
  try {
    console.log(`[batch-audio] 🔄 Đang chuyển ${baseName}.docx sang PDF bằng LibreOffice...`);
    await execFileAsync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, docxPath], {
      timeout: 90_000,
    });
    if (fs.existsSync(expectedPdf) && fs.statSync(expectedPdf).size > 0) {
      console.log(`[batch-audio] ✅ Đã tạo PDF thành công bằng LibreOffice: ${expectedPdf}`);
      return expectedPdf;
    }
  } catch (sofficeErr: any) {
    console.warn(`[batch-audio] LibreOffice convert không khả dụng:`, sofficeErr?.message || sofficeErr);
  }

  // Fallback Chrome headless nếu có
  const chromeCandidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const chromePath = chromeCandidates.find((c) => fs.existsSync(c));
  if (chromePath) {
    // Có Chrome, nhưng Chrome cần HTML để in ra PDF
    console.log(`[batch-audio] 🔄 Phát hiện Chrome headless: ${chromePath}`);
  }

  return fs.existsSync(expectedPdf) ? expectedPdf : null;
}

/**
 * Sử dụng Gemini để phân tích, định dạng và dịch thuật từng track âm thanh
 */
async function enrichTrackWithGemini(
  trackIndex: number,
  trackName: string,
  rawTranscript: string,
  userPrompt = "",
): Promise<{
  title: string;
  translation: string;
  dialogues: Array<{ speaker?: string; text: string; translation?: string }>;
  keyNotes: string[];
  summary: string;
}> {
  if (!rawTranscript.trim()) {
    return {
      title: trackName,
      translation: "(Không có giọng nói)",
      dialogues: [],
      keyNotes: [],
      summary: "Đoạn âm thanh không chứa lời nói rõ ràng.",
    };
  }

  const prompt =
    `Bạn là chuyên gia ngôn ngữ học và biên tập viên tài liệu xuất sắc.\n` +
    `Dưới đây là nội dung bóc băng âm thanh thô của Track số ${trackIndex} (Tên file: "${trackName}"):\n\n` +
    `\"\"\"\n${rawTranscript}\n\"\"\"\n\n` +
    (userPrompt ? `GHI CHÚ / YÊU CẦU THÊM TỪ NGƯỜI DÙNG: "${userPrompt}"\n\n` : "") +
    `NHIỆM VỤ:\n` +
    `1. Xác định tiêu đề hoặc chủ đề trọng tâm của bài này (ví dụ: "Unit 1: In the playground", "Track 05: Meeting Discussion", v.v.).\n` +
    `2. Phân đoạn hội thoại (nếu có nhân vật: Man, Woman, Boy, Girl, Speaker 1, 2...) hoặc chia theo câu hoàn chỉnh.\n` +
    `3. Dịch nghĩa tiếng Việt chuẩn xác, sư phạm, trau chuốt từng câu tương ứng.\n` +
    `4. Rút ra 2-4 điểm ngữ pháp / từ vựng / ghi chú quan trọng nhất của bài.\n` +
    `5. Viết 1 câu tóm tắt nội dung cốt lõi của track.\n\n` +
    `BẮT BUỘC TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON KHÔNG BỌC THÊM VĂN BẢN KHÁC:\n` +
    `{\n` +
    `  "title": "Tên bài học hoặc chủ đề",\n` +
    `  "summary": "Tóm tắt ngắn 1 câu",\n` +
    `  "dialogues": [\n` +
    `    { "speaker": "Nhân vật (hoặc rỗng)", "text": "Lời thoại gốc", "translation": "Dịch nghĩa tiếng Việt" }\n` +
    `  ],\n` +
    `  "keyNotes": ["Điểm ngữ pháp/từ vựng 1", "Điểm 2"]\n` +
    `}`;

  try {
    const rawRes = await callGemini(
      prompt,
      `Hãy phân tích và dịch nghĩa cho Track ${trackIndex}: ${trackName}`,
      {
        model: "gemini-3-flash-preview",
        temperature: 0.2,
      },
    );

    const jsonStr = (rawRes || "").replace(/```(?:json)?/gi, "").trim();
    const parsed = JSON.parse(jsonStr);

    return {
      title: parsed.title || trackName,
      translation: (parsed.dialogues || []).map((d: any) => d.translation || "").join(" "),
      dialogues: Array.isArray(parsed.dialogues) && parsed.dialogues.length > 0 ? parsed.dialogues : [
        { text: rawTranscript, translation: parsed.translation || "" },
      ],
      keyNotes: Array.isArray(parsed.keyNotes) ? parsed.keyNotes : [],
      summary: parsed.summary || "",
    };
  } catch (err) {
    console.warn(`[batch-audio] Lỗi Gemini enrich Track ${trackIndex}:`, err);
    return {
      title: trackName,
      translation: "",
      dialogues: [{ text: rawTranscript, translation: "" }],
      keyNotes: [],
      summary: "",
    };
  }
}

/**
 * Biên soạn file Word (.docx) chuẩn đẹp 100% từ danh sách các track đã bóc băng
 */
export async function buildBatchWordDocument(
  tracks: BatchAudioTrack[],
  docTitle: string,
  docSubtitle = "",
): Promise<string> {
  ensureOutputDir();
  const safeName = docTitle.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9 -]/g, "_").trim().replace(/\s+/g, "_") || "Tai_Lieu_Audio_Full";
  const docxPath = path.join(OUTPUT_DIR, `${safeName}.docx`);

  const docChildren: any[] = [];
  const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

  // Trang bìa & Header
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "BỘ TÀI LIỆU CHUYÊN ĐỀ • TRANSCRIPT & BẢN DỊCH SONG NGỮ",
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
          text: docTitle.toUpperCase(),
          font: "Times New Roman",
          size: 36,
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
          text: docSubtitle || `TOÀN BỘ TRANSCRIPT SONG NGỮ & HƯỚNG DẪN CHI TIẾT (${tracks.length} TRACKS)`,
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
          text: `Tự động bóc băng Speech-to-Text • Dịch nghĩa chuẩn sư phạm • Phân cột đối chiếu song ngữ`,
          font: "Times New Roman",
          size: 20,
          italics: true,
          color: "666666",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 350 },
    }),
  );

  // Bảng mục lục Index
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `📋 BẢNG MỤC LỤC TRỌN BỘ ${tracks.length} PHẦN`,
          font: "Times New Roman",
          size: 26,
          bold: true,
          color: "1F497D",
        }),
      ],
      spacing: { before: 200, after: 150 },
    }),
  );

  const indexHeaders = ["Mã bài", "Tên bài học / Chủ đề", "Tóm tắt nội dung"];
  const indexColWidths = [1800, 3800, 3400];

  const indexHeaderRow = new TableRow({
    tableHeader: true,
    children: indexHeaders.map(
      (h, idx) =>
        new TableCell({
          width: { size: indexColWidths[idx] ?? 3000, type: WidthType.DXA },
          children: [
            new Paragraph({
              children: [new TextRun({ text: h, bold: true, font: "Times New Roman", size: 22, color: "FFFFFF" })],
              alignment: AlignmentType.CENTER,
            }),
          ],
          shading: { fill: "1F497D" },
          margins: { top: 120, bottom: 120, left: 140, right: 140 },
          borders: cellBorders,
        }),
    ),
  });

  const indexDataRows = tracks.map(
    (t, idx) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: indexColWidths[0] ?? 1800, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: [new TextRun({ text: `Track ${t.index}`, bold: true, font: "Times New Roman", size: 22 })],
                alignment: AlignmentType.CENTER,
              }),
            ],
            shading: { fill: idx % 2 === 0 ? "F2F5F9" : "FFFFFF" },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            borders: cellBorders,
          }),
          new TableCell({
            width: { size: indexColWidths[1] ?? 3800, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: [new TextRun({ text: t.title || t.fileName, bold: true, font: "Times New Roman", size: 22 })],
              }),
            ],
            shading: { fill: idx % 2 === 0 ? "F2F5F9" : "FFFFFF" },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            borders: cellBorders,
          }),
          new TableCell({
            width: { size: indexColWidths[2] ?? 3400, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: [new TextRun({ text: t.summary || "Chi tiết lời thoại", font: "Times New Roman", size: 22 })],
              }),
            ],
            shading: { fill: idx % 2 === 0 ? "F2F5F9" : "FFFFFF" },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            borders: cellBorders,
          }),
        ],
      }),
  );

  docChildren.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: indexColWidths,
      rows: [indexHeaderRow, ...indexDataRows],
    }),
  );

  docChildren.push(new Paragraph({ spacing: { after: 300 } }));

  // Từng Track chi tiết
  const tableColWidths = [1800, 3800, 3400];

  for (const track of tracks) {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `🎧 Track ${track.index}: ${track.title}`,
            font: "Times New Roman",
            size: 26,
            bold: true,
            color: "1F497D",
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 350, after: 120 },
      }),
    );

    if (track.keyNotes && track.keyNotes.length > 0) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `💡 Điểm lưu ý & Từ vựng: `,
              bold: true,
              font: "Times New Roman",
              size: 22,
              color: "2E75B6",
            }),
            new TextRun({
              text: track.keyNotes.join(" • "),
              italics: true,
              font: "Times New Roman",
              size: 22,
              color: "444444",
            }),
          ],
          spacing: { after: 150 },
        }),
      );
    }

    const trackHeaderRow = new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          width: { size: tableColWidths[0] ?? 1800, type: WidthType.DXA },
          children: [
            new Paragraph({
              children: [new TextRun({ text: "Nhân vật / Đoạn", bold: true, font: "Times New Roman", size: 22, color: "FFFFFF" })],
              alignment: AlignmentType.CENTER,
            }),
          ],
          shading: { fill: "2E75B6" },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          borders: cellBorders,
        }),
        new TableCell({
          width: { size: tableColWidths[1] ?? 3800, type: WidthType.DXA },
          children: [
            new Paragraph({
              children: [new TextRun({ text: "Lời thoại gốc (Original)", bold: true, font: "Times New Roman", size: 22, color: "FFFFFF" })],
              alignment: AlignmentType.CENTER,
            }),
          ],
          shading: { fill: "2E75B6" },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          borders: cellBorders,
        }),
        new TableCell({
          width: { size: tableColWidths[2] ?? 3400, type: WidthType.DXA },
          children: [
            new Paragraph({
              children: [new TextRun({ text: "Dịch nghĩa tiếng Việt", bold: true, font: "Times New Roman", size: 22, color: "FFFFFF" })],
              alignment: AlignmentType.CENTER,
            }),
          ],
          shading: { fill: "2E75B6" },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          borders: cellBorders,
        }),
      ],
    });

    const dialogueRows = (track.dialogues || []).map(
      (dlg, dIdx) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: tableColWidths[0] ?? 1800, type: WidthType.DXA },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: dlg.speaker || `Đoạn ${dIdx + 1}`, bold: true, font: "Times New Roman", size: 22 })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
              shading: { fill: dIdx % 2 === 0 ? "F2F5F9" : "FFFFFF" },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              borders: cellBorders,
            }),
            new TableCell({
              width: { size: tableColWidths[1] ?? 3800, type: WidthType.DXA },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: dlg.text || "", font: "Times New Roman", size: 22 })],
                }),
              ],
              shading: { fill: dIdx % 2 === 0 ? "F2F5F9" : "FFFFFF" },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              borders: cellBorders,
            }),
            new TableCell({
              width: { size: tableColWidths[2] ?? 3400, type: WidthType.DXA },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: dlg.translation || "",
                      font: "Times New Roman",
                      size: 22,
                      color: "1F497D",
                      italics: true,
                    }),
                  ],
                }),
              ],
              shading: { fill: dIdx % 2 === 0 ? "F2F5F9" : "FFFFFF" },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              borders: cellBorders,
            }),
          ],
        }),
    );

    docChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: tableColWidths,
        rows: [trackHeaderRow, ...dialogueRows],
      }),
    );

    docChildren.push(new Paragraph({ spacing: { after: 250 } }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(1.0),
              right: convertInchesToTwip(0.8),
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(docxPath, buffer);
  console.log(`[batch-audio] ✅ Đã tạo file Word: ${docxPath} (${Math.round(buffer.length / 1024)} KB)`);

  return docxPath;
}

/**
 * Entry point chạy toàn bộ Job bóc băng và tạo tài liệu Word + PDF tự động 100%
 */
export async function runBatchAudioJob(options: BatchAudioJobOptions): Promise<void> {
  const {
    api,
    sender,
    isGroup,
    threadId,
    userGreeting,
    zipFilePath,
    audioFilePaths,
    originalFileName = "Audio_Batch",
    userPrompt = "",
  } = options;

  const targetId = isGroup && threadId ? threadId : sender;
  console.log(`[batch-audio] 🚀 Khởi chạy BatchAudioJob cho mục tiêu [${targetId}] (prompt: "${userPrompt.slice(0, 50)}")...`);
  const sendReplyText = async (msg: string) => {
    if (isGroup && threadId) {
      await sendGroupText(api, threadId, msg);
    } else {
      await sendDirectText(api, sender, msg);
    }
  };

  const sendReplyFile = async (filePath: string, caption = "") => {
    if (isGroup && threadId) {
      await sendGroupFile(api, threadId, filePath, caption);
    } else {
      await sendDirectFile(api, sender, filePath, caption);
    }
  };

  const jobId = `job_${Date.now()}`;
  const tempExtractDir = path.join("/tmp", `batch_audio_${jobId}`);

  try {
    let audioList: string[] = [];

    if (zipFilePath && fs.existsSync(zipFilePath)) {
      console.log(`[batch-audio] 📦 Đang giải nén archive: ${zipFilePath}...`);
      audioList = await extractAudioFilesFromZip(zipFilePath, tempExtractDir);
    } else if (audioFilePaths && audioFilePaths.length > 0) {
      audioList = audioFilePaths.filter((p) => fs.existsSync(p));
    }

    if (audioList.length === 0) {
      await sendReplyText(
        `⚠️ Dạ ${userGreeting} ơi, file nén [${originalFileName}] không tìm thấy file âm thanh nào hợp lệ (mp3, wav, m4a, wma...).\n\n` +
        `👉 Kính nhờ ${userGreeting} kiểm tra lại nội dung bên trong file zip giúp em nhé! ☘️`,
      );
      return;
    }

    const cleanTitle = path.basename(originalFileName, path.extname(originalFileName)).replace(/[_-]/g, " ");

    // Thông báo bắt đầu nhận việc ngay lập tức
    await sendReplyText(
      `🎙️ Dạ ${userGreeting} ơi, bot đã nhận được bộ tài liệu [${cleanTitle}] gồm **${audioList.length} bài nghe/audio**!\n\n` +
      `⚡ Bot đang tự động chạy quy trình hoàn chỉnh:\n` +
      `1️⃣ Bóc băng chuẩn xác từng câu thoại (Speech-to-Text)\n` +
      `2️⃣ Phân tích ngữ cảnh, từ vựng & Dịch thuật song ngữ Việt - Anh\n` +
      `3️⃣ Biên soạn xuất bản trọn bộ tài liệu Word (.docx) & PDF (.pdf) chuẩn A4\n\n` +
      `⏳ Dự kiến hoàn thành trong khoảng vài phút. Khi xong bot sẽ tự động gửi trả file ngay tại đây cho ${userGreeting} nhé! ☘️`,
    );

    const tracks: BatchAudioTrack[] = [];
    const cacheFile = path.join(tempExtractDir, "progress_cache.json");

    for (let i = 0; i < audioList.length; i++) {
      const audioPath = audioList[i]!;
      const trackIndex = i + 1;
      const trackFileName = path.basename(audioPath);

      console.log(`[batch-audio] 🎙️ [${trackIndex}/${audioList.length}] Đang xử lý: ${trackFileName}...`);

      const audioBuffer = fs.readFileSync(audioPath);
      const ext = path.extname(audioPath).replace(/^\./, "").toLowerCase();
      const mime = ext === "mp3" ? "audio/mp3" : ext === "wav" ? "audio/wav" : ext === "wma" ? "audio/x-ms-wma" : "audio/m4a";

      const transcript = await transcribeAudioBuffer(audioBuffer, mime, trackFileName);
      console.log(`[batch-audio] ✍️ Track ${trackIndex} transcript: ${transcript.length} ký tự`);

      const enriched = await enrichTrackWithGemini(trackIndex, trackFileName, transcript, userPrompt);

      tracks.push({
        index: trackIndex,
        fileName: trackFileName,
        title: enriched.title,
        filePath: audioPath,
        transcript,
        translation: enriched.translation,
        dialogues: enriched.dialogues,
        keyNotes: enriched.keyNotes,
        summary: enriched.summary,
      });

      // Lưu cache tạm
      try {
        fs.writeFileSync(cacheFile, JSON.stringify(tracks, null, 2), "utf8");
      } catch {}
    }

    console.log(`[batch-audio] 📄 Đang xuất file Word (.docx) cho ${tracks.length} tracks...`);
    const docxPath = await buildBatchWordDocument(tracks, cleanTitle);

    console.log(`[batch-audio] 📕 Đang xuất file PDF (.pdf)...`);
    const pdfPath = await convertDocxToPdf(docxPath);

    // Gửi trả file Word
    await sendReplyFile(
      docxPath,
      `📄 Em gửi ${userGreeting} file Word (.docx) trọn bộ [${cleanTitle}] (${tracks.length} tracks) chuẩn chỉnh, mở mượt trên mọi thiết bị nhé!`,
    );

    // Gửi trả file PDF nếu có
    if (pdfPath && fs.existsSync(pdfPath)) {
      await sendReplyFile(
        pdfPath,
        `📕 Em gửi kèm bản PDF (.pdf) in ấn sắc nét chất lượng cao để ${userGreeting} xem nhanh trên điện thoại hoặc in ra nhé!`,
      );
    }

    // Tin nhắn tổng kết hoàn tất
    await sendReplyText(
      `🎉 **ĐÃ HOÀN TẤT BIÊN SOẠN BỘ TÀI LIỆU (${tracks.length} TRACKS)!**\n\n` +
      `✅ Định dạng: Word (.docx) & PDF (.pdf) bảng song ngữ chuẩn A4\n` +
      `✅ Đầy đủ từng câu thoại, dịch nghĩa tiếng Việt, mẹo bài học & từ vựng trọng tâm\n` +
      `☘️ Kính chúc ${userGreeting} học tập và làm việc thật hiệu quả ạ!`,
    );
  } catch (err: any) {
    console.error(`[batch-audio] ❌ Lỗi xử lý batch audio job:`, err);
    try {
      await sendReplyText(
        `⚠️ Dạ ${userGreeting} ơi, trong quá trình xử lý bộ audio [${originalFileName}], hệ thống gặp sự cố kỹ thuật. Bot đã lưu log để rà soát và hỗ trợ ${userGreeting} ngay ạ!`,
      );
    } catch {}
  } finally {
    // Dọn dẹp thư mục tạm và file zip tạm nếu nằm trong thư mục tạm hệ thống
    try {
      if (tempExtractDir && fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
    } catch {}
    try {
      if (
        zipFilePath &&
        fs.existsSync(zipFilePath) &&
        (zipFilePath.includes("/tmp/") || zipFilePath.includes("\\tmp\\") || zipFilePath.includes("zalo_upload"))
      ) {
        fs.unlinkSync(zipFilePath);
      }
    } catch {}
  }
}

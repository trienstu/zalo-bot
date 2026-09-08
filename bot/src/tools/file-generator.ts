import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import ExcelJS from "exceljs";

const GENERATED_FILES_DIR = path.resolve(process.cwd(), "data", "generated-files");

function ensureOutputDir(): string {
  if (!fs.existsSync(GENERATED_FILES_DIR)) {
    fs.mkdirSync(GENERATED_FILES_DIR, { recursive: true });
  }
  return GENERATED_FILES_DIR;
}

export interface GeneratedFileResult {
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;
  message?: string;
}

/**
 * 1. Tạo file Word (.docx) chuẩn văn phòng chuyên nghiệp
 */
export async function generateWordDoc(
  fileName: string,
  title: string,
  sections: Array<{ heading?: string; paragraphs: string[] }>,
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    const safeName = fileName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "tai_lieu";
    const fullFileName = safeName.endsWith(".docx") ? safeName : `${safeName}.docx`;
    const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

    const docChildren: Paragraph[] = [
      new Paragraph({
        text: title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
      }),
    ];

    for (const sec of sections) {
      if (sec.heading) {
        docChildren.push(
          new Paragraph({
            text: sec.heading,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 120 },
          }),
        );
      }
      for (const p of sec.paragraphs) {
        if (!p.trim()) continue;
        if (p.startsWith("- ") || p.startsWith("* ") || p.startsWith("• ")) {
          docChildren.push(
            new Paragraph({
              children: [new TextRun(p.slice(2).trim())],
              bullet: { level: 0 },
              spacing: { after: 80 },
            }),
          );
        } else {
          docChildren.push(
            new Paragraph({
              children: [new TextRun(p.trim())],
              spacing: { after: 150 },
            }),
          );
        }
      }
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: docChildren,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(targetPath, buffer);

    return {
      success: true,
      filePath: targetPath,
      fileName: fullFileName,
      fileSize: buffer.length,
    };
  } catch (err: any) {
    console.error("[file-generator] Lỗi tạo file Word:", err);
    return {
      success: false,
      filePath: "",
      fileName: `${fileName}.docx`,
      fileSize: 0,
      message: String(err?.message || err),
    };
  }
}

/**
 * 2. Tạo bảng tính Excel (.xlsx) có công thức tự động
 */
export async function generateExcelFile(
  fileName: string,
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    const safeName = fileName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "bang_tinh";
    const fullFileName = safeName.endsWith(".xlsx") ? safeName : `${safeName}.xlsx`;
    const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName || "Sheet1");

    // Header styling
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: "FFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "1F4E79" }, // Xanh dương đậm chuyên nghiệp
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 28;

    // Add rows
    for (const r of rows) {
      const addedRow = sheet.addRow(r);
      addedRow.height = 22;
      addedRow.alignment = { vertical: "middle" };
    }

    // Auto-fit column widths
    sheet.columns.forEach((col) => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const valStr = cell.value ? String(cell.value) : "";
        if (valStr.length > maxLen) maxLen = Math.min(valStr.length + 4, 45);
      });
      col.width = maxLen;
    });

    await workbook.xlsx.writeFile(targetPath);
    const stats = fs.statSync(targetPath);

    return {
      success: true,
      filePath: targetPath,
      fileName: fullFileName,
      fileSize: stats.size,
    };
  } catch (err: any) {
    console.error("[file-generator] Lỗi tạo file Excel:", err);
    return {
      success: false,
      filePath: "",
      fileName: `${fileName}.xlsx`,
      fileSize: 0,
      message: String(err?.message || err),
    };
  }
}

/**
 * 3. Tạo file Markdown (.md), Text (.txt), Code (.py, .js, .sh, .json)
 */
export async function generateTextFile(
  fileName: string,
  content: string,
  ext = "md",
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    const cleanExt = ext.replace(/^\./, "") || "md";
    const baseName = fileName.replace(/\.[a-zA-Z0-9]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "tai_lieu";
    const fullFileName = `${baseName}.${cleanExt}`;
    const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

    fs.writeFileSync(targetPath, content, "utf8");
    const stats = fs.statSync(targetPath);

    return {
      success: true,
      filePath: targetPath,
      fileName: fullFileName,
      fileSize: stats.size,
    };
  } catch (err: any) {
    console.error("[file-generator] Lỗi tạo file text/md:", err);
    return {
      success: false,
      filePath: "",
      fileName: `${fileName}.${ext}`,
      fileSize: 0,
      message: String(err?.message || err),
    };
  }
}

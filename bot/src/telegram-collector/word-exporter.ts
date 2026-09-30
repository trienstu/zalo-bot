import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ShadingType,
} from "docx";
import type { TelegramKnowledgeItem, KnowledgeCategory } from "./types.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "data", "generated-files");

export function ensureTelegramExportDir(): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  return OUTPUT_DIR;
}

const CATEGORY_META: Record<
  KnowledgeCategory,
  { order: number; label: string; icon: string; color: string }
> = {
  ai_prompt: {
    order: 1,
    label: "KỸ NĂNG & NGHỆ THUẬT PROMPT AI (PROMPT ENGINEERING)",
    icon: "🤖",
    color: "1F497D",
  },
  tools_tech: {
    order: 2,
    label: "CÔNG CỤ, PHẦN MỀM & THƯ VIỆN CÔNG NGHỆ MỚI (TOOLS & TECH)",
    icon: "🛠️",
    color: "0070C0",
  },
  business_real_estate: {
    order: 3,
    label: "KINH DOANH, ĐẦU TƯ & THỊ TRƯỜNG BẤT ĐỘNG SẢN",
    icon: "📈",
    color: "C00000",
  },
  tips_workflow: {
    order: 4,
    label: "QUY TRÌNH & THỦ THUẬT TỐI ƯU CÔNG VIỆC (WORKFLOW & TIPS)",
    icon: "⚡",
    color: "375623",
  },
  news_insight: {
    order: 5,
    label: "TIN TỨC, PHÂN TÍCH & GÓC NHÌN CHUYÊN GIA (INSIGHTS)",
    icon: "📰",
    color: "7030A0",
  },
  trading_signals: {
    order: 6,
    label: "KÈO GIAO DỊCH, SETUP & TÍN HIỆU THỊ TRƯỜNG (TRADING SIGNALS)",
    icon: "🎯",
    color: "7030A0",
  },
  technical_analysis: {
    order: 7,
    label: "PHÂN TÍCH KỸ THUẬT & CHỈ BÁO THỰC CHIẾN (PRICE ACTION, SMC, INDICATORS)",
    icon: "📊",
    color: "1F497D",
  },
  macro_news: {
    order: 8,
    label: "VĨ MÔ, TIN TỨC KINH TẾ & DÒNG TIỀN (MACRO & FLOWS)",
    icon: "🌐",
    color: "C00000",
  },
  risk_psychology: {
    order: 9,
    label: "TÂM LÝ GIAO DỊCH & QUẢN TRỊ RỦI RO (RISK MANAGEMENT & PSYCHOLOGY)",
    icon: "🛡️",
    color: "B25900",
  },
  shared_files: {
    order: 10,
    label: "TÀI LIỆU, SÁCH & FILE ĐÍNH KÈM CHIA SẺ TRONG NHÓM",
    icon: "📁",
    color: "375623",
  },
  general: {
    order: 11,
    label: "THẢO LUẬN & KIẾN THỨC TỔNG HỢP HỮU ÍCH",
    icon: "💡",
    color: "595959",
  },
};

/**
 * Tạo Buffer của file Word (.docx) chất lượng cao từ danh sách tri thức Telegram
 */
export async function buildTelegramKnowledgeWordBuffer(
  items: TelegramKnowledgeItem[],
  customTitle?: string,
): Promise<Buffer> {
  const docTitle = customTitle || "TỔNG HỢP TRI THỨC & KINH NGHIỆM THỰC CHIẾN TỪ CỘNG ĐỒNG TELEGRAM";
  const nowStr = new Date().toLocaleDateString("vi-VN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const docChildren: any[] = [];

  // 1. Trang bìa & Header
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "BỘ TÀI LIỆU CHUYÊN ĐỀ • TRI THỨC CỘNG ĐỒNG TELEGRAM",
          font: "Times New Roman",
          size: 20,
          color: "7F7F7F",
          bold: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: docTitle.toUpperCase(),
          font: "Times New Roman",
          size: 34,
          bold: true,
          color: "1F497D",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Thời gian biên tập: ${nowStr} • Tổng số: ${items.length} đơn vị tri thức được chọn lọc`,
          font: "Times New Roman",
          size: 22,
          italics: true,
          color: "555555",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          color: "B0C4DE",
          size: 16,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),
  );

  // 2. Nhóm các mục tri thức theo từng Category
  const grouped: Record<string, TelegramKnowledgeItem[]> = {};
  for (const it of items) {
    const cat = it.category || "general";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(it);
  }

  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    const orderA = CATEGORY_META[a as KnowledgeCategory]?.order ?? 99;
    const orderB = CATEGORY_META[b as KnowledgeCategory]?.order ?? 99;
    return orderA - orderB;
  });

  // 3. Render từng chuyên mục
  for (const catKey of sortedCategories) {
    const catItems = grouped[catKey];
    if (!catItems || catItems.length === 0) continue;

    const meta = CATEGORY_META[catKey as KnowledgeCategory] || CATEGORY_META.general;

    // Tiêu đề Category (Heading 1)
    docChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: `${meta.icon} ${meta.label} (${catItems.length})`,
            font: "Times New Roman",
            size: 28,
            bold: true,
            color: meta.color,
          }),
        ],
        spacing: { before: 300, after: 150 },
      }),
    );

    // Từng bài học / đơn vị tri thức trong Category
    for (let i = 0; i < catItems.length; i++) {
      const item = catItems[i];
      if (!item) continue;
      const itemIndex = i + 1;

      // Tiêu đề mục (Heading 2)
      docChildren.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [
            new TextRun({
              text: `${itemIndex}. ${item.title}`,
              font: "Times New Roman",
              size: 24,
              bold: true,
              color: "203864",
            }),
          ],
          spacing: { before: 180, after: 80 },
        }),
      );

      // Metadata nguồn & ngày
      const sourceInfo = item.chat_title ? `Tại: ${item.chat_title}` : "Telegram Group";
      const dateInfo = item.date_range ? ` • Mốc: ${item.date_range}` : "";
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `📍 Nguồn: ${sourceInfo}${dateInfo}`,
              font: "Times New Roman",
              size: 18,
              italics: true,
              color: "7F7F7F",
            }),
          ],
          spacing: { after: 100 },
        }),
      );

      // Tóm tắt cốt lõi
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "Tóm tắt cốt lõi: ",
              font: "Times New Roman",
              size: 22,
              bold: true,
              color: "1F497D",
            }),
            new TextRun({
              text: item.summary,
              font: "Times New Roman",
              size: 22,
              color: "262626",
            }),
          ],
          spacing: { after: 120 },
        }),
      );

      // Hộp Callout: Điểm mấu chốt & Key Takeaways
      if (item.key_takeaways && item.key_takeaways.length > 0) {
        const takeawayParagraphs: Paragraph[] = [
          new Paragraph({
            children: [
              new TextRun({
                text: "🎯 BÀI HỌC CỐT LÕI & CÁCH ÁP DỤNG THỰC TẾ:",
                font: "Times New Roman",
                size: 20,
                bold: true,
                color: "1F497D",
              }),
            ],
            spacing: { after: 80 },
          }),
        ];

        for (const kw of item.key_takeaways) {
          takeawayParagraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `• ${kw}`,
                  font: "Times New Roman",
                  size: 20,
                  color: "333333",
                }),
              ],
              spacing: { after: 40 },
            }),
          );
        }

        const calloutTable = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  shading: {
                    type: ShadingType.CLEAR,
                    fill: "F2F5F9", // Nền xanh nhạt dịu mắt
                  },
                  borders: {
                    left: { style: BorderStyle.SINGLE, size: 24, color: "1F497D" }, // Cột nhấn màu xanh đậm
                    top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    right: { style: BorderStyle.NONE, size: 0, color: "auto" },
                  },
                  margins: {
                    top: 120,
                    bottom: 120,
                    left: 180,
                    right: 180,
                  },
                  children: takeawayParagraphs,
                }),
              ],
            }),
          ],
        });

        docChildren.push(calloutTable);
        docChildren.push(new Paragraph({ spacing: { after: 100 } }));
      }

      // Trích dẫn lời khuyên hay (nếu có)
      if (item.original_quotes && item.original_quotes.trim()) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `💬 Trích dẫn thực tế: "${item.original_quotes.trim()}"`,
                font: "Times New Roman",
                size: 20,
                italics: true,
                color: "595959",
              }),
            ],
            spacing: { after: 80 },
          }),
        );
      }

      // Các link tham khảo hữu ích
      if (item.useful_links && item.useful_links.length > 0) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "🔗 Liên kết hữu ích: ",
                font: "Times New Roman",
                size: 20,
                bold: true,
                color: "0070C0",
              }),
              new TextRun({
                text: item.useful_links.join(" | "),
                font: "Times New Roman",
                size: 20,
                color: "0070C0",
                underline: {},
              }),
            ],
            spacing: { after: 120 },
          }),
        );
      }

      // Đường kẻ ngăn cách nhẹ giữa các item
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -",
              color: "D9D9D9",
              size: 14,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 140 },
        }),
      );
    }
  }

  // Khởi tạo Document
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/**
 * Biên soạn và ghi thẳng file Word (.docx) vào thư mục generated-files
 */
export async function exportTelegramKnowledgeToDocxFile(
  items: TelegramKnowledgeItem[],
  customTitle?: string,
): Promise<{ filePath: string; fileName: string; fileSize: number }> {
  ensureTelegramExportDir();
  const timestamp = Date.now();
  const safeTitle = (customTitle || "Telegram_Knowledge")
    .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9 -]/g, "_")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 50);

  const fileName = `${safeTitle}_${timestamp}.docx`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  const buffer = await buildTelegramKnowledgeWordBuffer(items, customTitle);
  fs.writeFileSync(filePath, buffer);

  return {
    filePath,
    fileName,
    fileSize: buffer.length,
  };
}

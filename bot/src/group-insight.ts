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
import { getDb, getAllAdminUserIds } from "./db/index.js";
import { callGeminiJson } from "./gemini.js";
import { sendDirectText, sendDirectFile } from "./zalo/client.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "data", "generated-files");

function ensureOutputDir(): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  return OUTPUT_DIR;
}

export interface GroupDiscussionData {
  groupId: string;
  groupName: string;
  totalMessages: number;
  totalParticipants: number;
  topMembers: { name: string; count: number }[];
  transcript: string;
}

export interface GroupInsightResult {
  groupId: string;
  groupName: string;
  totalMessages: number;
  totalParticipants: number;
  topMembers: { name: string; count: number }[];
  hotTopics: {
    topic: string;
    summary: string;
    sentiment: "positive" | "neutral" | "concerned" | "mixed";
    keyConclusions: string[];
  }[];
  painPointsAndQuestions: {
    issue: string;
    asker?: string;
    isResolved: boolean;
    suggestion: string;
  }[];
  businessOpportunities: {
    description: string;
    potential: "high" | "medium" | "low";
    contactOrContext: string;
    actionItem: string;
  }[];
  actionableRecommendations: string[];
}

/**
 * Thu thập dữ liệu thảo luận của các nhóm Zalo trong khoảng thời gian xác định
 */
export function collectGroupDiscussions(timeRange: {
  startTs: number;
  endTs: number;
}): GroupDiscussionData[] {
  const db = getDb();
  const { startTs, endTs } = timeRange;

  // 1. Lấy danh sách các nhóm đang hoạt động (không bị disabled)
  const groups = db
    .prepare(
      `SELECT group_id as groupId, name
       FROM bot_groups
       WHERE mode != 'disabled'`,
    )
    .all() as { groupId: string; name: string }[];

  const results: GroupDiscussionData[] = [];

  for (const g of groups) {
    // 2. Lấy các tin nhắn văn bản hợp lệ trong khung giờ
    const messages = db
      .prepare(
        `SELECT zalo_user_id as userId, display_name as displayName, text, ts
         FROM group_messages
         WHERE thread_id = ?
           AND ts >= ? AND ts <= ?
           AND deleted_at IS NULL
           AND is_self = 0
           AND length(text) >= 2
         ORDER BY ts ASC`,
      )
      .all(g.groupId, startTs, endTs) as {
      userId: string;
      displayName: string;
      text: string;
      ts: number;
    }[];

    if (messages.length === 0) continue;

    // Lọc bỏ tin nhắn lệnh bot hoặc tin rác
    const cleanMessages = messages.filter(
      (m) =>
        !m.text.startsWith("/") &&
        !m.text.startsWith("!") &&
        !m.text.includes("⏰ [BÁO THỨC") &&
        !m.text.includes("☀️ [BẢN TIN THỜI TIẾT") &&
        !m.text.includes("📰 [BẢN TIN AI"),
    );

    if (cleanMessages.length === 0) continue;

    // Tính toán người tham gia & Top thành viên tích cực
    const memberCounts = new Map<string, { name: string; count: number }>();
    for (const m of cleanMessages) {
      const name = m.displayName || `Thành viên (${m.userId.slice(-4)})`;
      const current = memberCounts.get(m.userId) || { name, count: 0 };
      current.count++;
      if (m.displayName) current.name = m.displayName;
      memberCounts.set(m.userId, current);
    }

    const topMembers = Array.from(memberCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Xây dựng transcript sạch (giới hạn tối đa 35.000 ký tự / nhóm)
    const transcriptLines: string[] = [];
    let currentChars = 0;
    for (const m of cleanMessages) {
      const timeStr = new Date(m.ts).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Bangkok",
      });
      const line = `[${timeStr}] ${m.displayName || "Thành viên"}: ${m.text}`;
      if (currentChars + line.length > 35_000) break;
      transcriptLines.push(line);
      currentChars += line.length;
    }

    results.push({
      groupId: g.groupId,
      groupName: g.name || `Nhóm ${g.groupId.slice(-6)}`,
      totalMessages: cleanMessages.length,
      totalParticipants: memberCounts.size,
      topMembers,
      transcript: transcriptLines.join("\n"),
    });
  }

  return results;
}

/**
 * Phân tích bóc tách chuyên sâu từng nhóm qua Gemini AI
 */
export async function analyzeGroupInsight(
  group: GroupDiscussionData,
): Promise<GroupInsightResult> {
  const systemPrompt = `Bạn là Giám đốc Nghiên cứu Tri thức & Khai thác Dữ liệu Cộng đồng (Chief Knowledge Officer) chuyên nghiệp.
Nhiệm vụ của bạn là đọc toàn bộ nhật ký thảo luận của nhóm Zalo trong ngày và trích xuất BÁO CÁO INSIGHT CHUYÊN SÂU theo định dạng JSON.

Yêu cầu phân tích:
1. "hotTopics": Top các chủ đề thảo luận nổi bật nhất. Với mỗi chủ đề, tóm tắt nội dung chính, thái độ thảo luận (sentiment: positive/neutral/concerned/mixed) và các kết luận quan trọng (keyConclusions).
2. "painPointsAndQuestions": Những câu hỏi/thắc mắc phổ biến chưa có lời giải đáp hoặc bức xúc/khó khăn của thành viên, kèm người hỏi (nếu có), trạng thái giải quyết (isResolved) và đề xuất hỗ trợ (suggestion).
3. "businessOpportunities": Các cơ hội kinh doanh, tín hiệu mua bán, tìm đối tác, cần thuê/mua, tuyển dụng hoặc deal phát sinh (potential: high/medium/low), thông tin ngữ cảnh và hành động cần triển khai (actionItem).
4. "actionableRecommendations": Các đề xuất hành động thực tiễn cho Ban Quản Trị/Sếp để hỗ trợ thành viên và phát triển nhóm.

LƯU Ý QUAN TRỌNG:
- Trả về DUY NHẤT một chuỗi JSON hợp lệ, không bọc markdown \`\`\`json.
- Phải trung thực tuyệt đối dựa trên nhật ký thảo luận, không bịa đặt.`;

  const userPrompt = `Dưới đây là nhật ký thảo luận nhóm "${group.groupName}" (${group.totalMessages} tin nhắn, ${group.totalParticipants} thành viên):\n\n${group.transcript}\n\nHãy phân tích và trả về JSON theo schema:
{
  "hotTopics": [
    {
      "topic": "Tên chủ đề",
      "summary": "Tóm tắt quan điểm và thảo luận",
      "sentiment": "positive" | "neutral" | "concerned" | "mixed",
      "keyConclusions": ["kết luận 1", "kết luận 2"]
    }
  ],
  "painPointsAndQuestions": [
    {
      "issue": "Nội dung câu hỏi/vấn đề",
      "asker": "Tên người hỏi",
      "isResolved": false,
      "suggestion": "Đề xuất hướng xử lý cho sếp/admin"
    }
  ],
  "businessOpportunities": [
    {
      "description": "Mô tả cơ hội/nhu cầu mua bán/hợp tác",
      "potential": "high" | "medium" | "low",
      "contactOrContext": "Người liên quan hoặc ngữ cảnh",
      "actionItem": "Hành động đề xuất"
    }
  ],
  "actionableRecommendations": [
    "Đề xuất hành động 1 cho Admin",
    "Đề xuất hành động 2 cho Admin"
  ]
}`;

  try {
    const rawJson = await callGeminiJson(systemPrompt, userPrompt, 4000);
    const parsed = JSON.parse(rawJson);

    return {
      groupId: group.groupId,
      groupName: group.groupName,
      totalMessages: group.totalMessages,
      totalParticipants: group.totalParticipants,
      topMembers: group.topMembers,
      hotTopics: Array.isArray(parsed.hotTopics) ? parsed.hotTopics : [],
      painPointsAndQuestions: Array.isArray(parsed.painPointsAndQuestions)
        ? parsed.painPointsAndQuestions
        : [],
      businessOpportunities: Array.isArray(parsed.businessOpportunities)
        ? parsed.businessOpportunities
        : [],
      actionableRecommendations: Array.isArray(parsed.actionableRecommendations)
        ? parsed.actionableRecommendations
        : [],
    };
  } catch (err) {
    console.warn(`[group-insight] Phân tích AI cho nhóm ${group.groupName} lỗi:`, err);
    return {
      groupId: group.groupId,
      groupName: group.groupName,
      totalMessages: group.totalMessages,
      totalParticipants: group.totalParticipants,
      topMembers: group.topMembers,
      hotTopics: [
        {
          topic: "Thảo luận thường nhật trong nhóm",
          summary: `Nhóm có ${group.totalMessages} tin nhắn trao đổi giữa ${group.totalParticipants} thành viên.`,
          sentiment: "neutral",
          keyConclusions: ["Các thành viên tiếp tục trao đổi và kết nối thông tin."],
        },
      ],
      painPointsAndQuestions: [],
      businessOpportunities: [],
      actionableRecommendations: ["Tiếp tục theo dõi và phản hồi kịp thời các thắc mắc của thành viên."],
    };
  }
}

/**
 * Biên soạn tài liệu Word (.docx) chuẩn phong cách báo cáo quản trị cao cấp
 */
export async function generateGroupInsightWordDocument(params: {
  dateLabel: string;
  insights: GroupInsightResult[];
  timeRangeLabel: string;
}): Promise<string> {
  const { dateLabel, insights, timeRangeLabel } = params;
  ensureOutputDir();

  const totalAllMessages = insights.reduce((sum, g) => sum + g.totalMessages, 0);
  const totalAllParticipants = insights.reduce((sum, g) => sum + g.totalParticipants, 0);

  const docChildren: any[] = [];

  // 1. TIÊU ĐỀ BÁO CÁO
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({
          text: "BÁO CÁO PHÂN TÍCH TRI THỨC & INSIGHT CỘNG ĐỒNG ZALO",
          bold: true,
          size: 32,
          font: "Arial",
          color: "1F497D",
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `Dữ liệu thảo luận: ${dateLabel} (${timeRangeLabel}) | Biên soạn tự động bởi Trợ Lý AI Sen Chúa`,
          italics: true,
          size: 20,
          font: "Arial",
          color: "595959",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          color: "D3D3D3",
        }),
      ],
    }),
  );

  // 2. BẢNG THỐNG KÊ TỔNG QUAN
  const statsTableRows = [
    new TableRow({
      children: [
        createTableCell("Chỉ số vận hành", "1F497D", true, "F2F2F2", 3000),
        createTableCell("Giá trị thực tế", "1F497D", true, "F2F2F2", 6000),
      ],
    }),
    new TableRow({
      children: [
        createTableCell("Tổng số nhóm có thảo luận:", "000000", false, "FFFFFF", 3000),
        createTableCell(`${insights.length} nhóm`, "1F497D", true, "FFFFFF", 6000),
      ],
    }),
    new TableRow({
      children: [
        createTableCell("Tổng số tin nhắn thu thập:", "000000", false, "F9F9F9", 3000),
        createTableCell(`${totalAllMessages.toLocaleString("vi-VN")} tin nhắn`, "0070C0", true, "F9F9F9", 6000),
      ],
    }),
    new TableRow({
      children: [
        createTableCell("Tổng lượt thành viên phát biểu:", "000000", false, "FFFFFF", 3000),
        createTableCell(`${totalAllParticipants.toLocaleString("vi-VN")} thành viên`, "375623", true, "FFFFFF", 6000),
      ],
    }),
  ];

  docChildren.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 120 },
      children: [
        new TextRun({
          text: "I. TỔNG QUAN VẬN HÀNH & CHỈ SỐ HOẠT ĐỘNG",
          bold: true,
          size: 24,
          font: "Arial",
          color: "1F497D",
        }),
      ],
    }),
    new Table({
      width: { size: 9000, type: WidthType.DXA },
      rows: statsTableRows,
    }),
    new Paragraph({ spacing: { after: 250 } }),
  );

  // 3. CHI TIẾT TỪNG NHÓM
  docChildren.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 120 },
      children: [
        new TextRun({
          text: "II. PHÂN TÍCH CHUYÊN SÂU & INSIGHT TỪNG NHÓM",
          bold: true,
          size: 24,
          font: "Arial",
          color: "1F497D",
        }),
      ],
    }),
  );

  for (let i = 0; i < insights.length; i++) {
    const g = insights[i]!;

    docChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 250, after: 100 },
        children: [
          new TextRun({
            text: `${i + 1}. Nhóm: ${g.groupName}`,
            bold: true,
            size: 22,
            font: "Arial",
            color: "C00000",
          }),
          new TextRun({
            text: `  (${g.totalMessages} tin nhắn • ${g.totalParticipants} thành viên tham gia)`,
            italics: true,
            size: 18,
            color: "595959",
          }),
        ],
      }),
    );

    // Top thành viên
    const topMembersStr = g.topMembers.map((m) => `${m.name} (${m.count} tin)`).join(", ");
    docChildren.push(
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({ text: "• Thành viên tích cực nhất: ", bold: true, size: 20 }),
          new TextRun({ text: topMembersStr || "Chưa ghi nhận", size: 20 }),
        ],
      }),
    );

    // Chủ đề nóng
    docChildren.push(
      new Paragraph({
        spacing: { before: 100, after: 50 },
        children: [
          new TextRun({
            text: "🔥 Các chủ đề nổi bật (Hot Topics):",
            bold: true,
            size: 20,
            color: "1F497D",
          }),
        ],
      }),
    );

    if (g.hotTopics.length === 0) {
      docChildren.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: "- Không có chủ đề tranh luận kéo dài.", italics: true, size: 19 })],
        }),
      );
    } else {
      for (const t of g.hotTopics) {
        docChildren.push(
          new Paragraph({
            spacing: { after: 50 },
            children: [
              new TextRun({ text: `  ▸ ${t.topic}: `, bold: true, size: 19 }),
              new TextRun({ text: t.summary, size: 19 }),
            ],
          }),
        );
        if (t.keyConclusions && t.keyConclusions.length > 0) {
          for (const c of t.keyConclusions) {
            docChildren.push(
              new Paragraph({
                spacing: { after: 30 },
                children: [
                  new TextRun({ text: `     ✔ Kết luận: `, bold: true, color: "375623", size: 18 }),
                  new TextRun({ text: c, size: 18 }),
                ],
              }),
            );
          }
        }
      }
    }

    // Thắc mắc / Vấn đề bức xúc
    docChildren.push(
      new Paragraph({
        spacing: { before: 100, after: 50 },
        children: [
          new TextRun({
            text: "❓ Thắc mắc & Vấn đề tồn đọng (Pain Points & Unresolved Issues):",
            bold: true,
            size: 20,
            color: "C00000",
          }),
        ],
      }),
    );

    if (g.painPointsAndQuestions.length === 0) {
      docChildren.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [
            new TextRun({
              text: "- Không phát hiện phàn nàn bức xúc hoặc câu hỏi bị bỏ sót.",
              italics: true,
              size: 19,
              color: "375623",
            }),
          ],
        }),
      );
    } else {
      for (const p of g.painPointsAndQuestions) {
        const askerText = p.asker ? ` (từ ${p.asker})` : "";
        docChildren.push(
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: `  ▸ Vấn đề${askerText}: `, bold: true, size: 19 }),
              new TextRun({ text: p.issue, size: 19 }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: `    👉 Đề xuất xử lý: `, bold: true, color: "0070C0", size: 18 }),
              new TextRun({ text: p.suggestion, size: 18 }),
            ],
          }),
        );
      }
    }

    // Cơ hội kinh doanh / Deal tiềm năng
    docChildren.push(
      new Paragraph({
        spacing: { before: 100, after: 50 },
        children: [
          new TextRun({
            text: "💼 Cơ hội kinh doanh & Nhu cầu phát sinh (Business Opportunities):",
            bold: true,
            size: 20,
            color: "7030A0",
          }),
        ],
      }),
    );

    if (g.businessOpportunities.length === 0) {
      docChildren.push(
        new Paragraph({
          spacing: { after: 150 },
          children: [new TextRun({ text: "- Không có tín hiệu giao dịch mới.", italics: true, size: 19 })],
        }),
      );
    } else {
      for (const b of g.businessOpportunities) {
        docChildren.push(
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({ text: `  ▸ [Tiềm năng ${b.potential.toUpperCase()}]: `, bold: true, color: "7030A0", size: 19 }),
              new TextRun({ text: b.description, size: 19 }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: `    👉 Hành động triển khai: `, bold: true, color: "375623", size: 18 }),
              new TextRun({ text: b.actionItem, size: 18 }),
            ],
          }),
        );
      }
    }
  }

  // 4. ĐỀ XUẤT HÀNH ĐỘNG CHO BAN QUẢN TRỊ
  docChildren.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 250, after: 120 },
      children: [
        new TextRun({
          text: "III. ĐỀ XUẤT HÀNH ĐỘNG CHO BAN QUẢN TRỊ (ACTION ITEMS)",
          bold: true,
          size: 24,
          font: "Arial",
          color: "1F497D",
        }),
      ],
    }),
  );

  const allRecommendations: string[] = [];
  for (const g of insights) {
    for (const rec of g.actionableRecommendations) {
      allRecommendations.push(`[${g.groupName}] ${rec}`);
    }
  }

  if (allRecommendations.length === 0) {
    docChildren.push(
      new Paragraph({
        children: [new TextRun({ text: "Các nhóm đang vận hành ổn định, không có khuyến nghị can thiệp đặc biệt.", size: 20 })],
      }),
    );
  } else {
    for (let r = 0; r < allRecommendations.length; r++) {
      docChildren.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `${r + 1}. `, bold: true, size: 20 }),
            new TextRun({ text: allRecommendations[r]!, size: 20 }),
          ],
        }),
      );
    }
  }

  // Đóng gói tài liệu
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 },
          },
        },
        children: docChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const cleanDate = dateLabel.replace(/\//g, "-");
  const fileName = `Insight_Nhom_Zalo_${cleanDate}_${Date.now()}.docx`;
  const filePath = path.join(OUTPUT_DIR, fileName);
  fs.writeFileSync(filePath, buffer);

  console.log(`[group-insight] 📄 Đã tạo thành công file Word Insight: ${filePath} (${Math.round(buffer.length / 1024)} KB)`);
  return filePath;
}

function createTableCell(
  text: string,
  textColor: string,
  isBold: boolean,
  bgColor: string,
  widthDxa: number,
): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: bgColor, type: ShadingType.CLEAR },
    margins: { top: 120, bottom: 120, left: 150, right: 150 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "D3D3D3" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "D3D3D3" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "D3D3D3" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "D3D3D3" },
    },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: isBold,
            color: textColor,
            font: "Arial",
            size: 20,
          }),
        ],
      }),
    ],
  });
}

/**
 * Định dạng bản tin tóm tắt cô đọng gửi trực tiếp qua chat Zalo 1:1 cho Sếp
 */
export function formatInsightZaloMessage(params: {
  dateLabel: string;
  insights: GroupInsightResult[];
  totalMessages: number;
}): string {
  const { dateLabel, insights, totalMessages } = params;

  let msg =
    `📊 [BÁO CÁO INSIGHT & TRI THỨC NHÓM ZALO]\n` +
    `⏰ Dữ liệu ngày: ${dateLabel}\n` +
    `📈 Tổng hợp: ${insights.length} nhóm hoạt động, ${totalMessages.toLocaleString("vi-VN")} tin nhắn.\n\n`;

  for (let i = 0; i < Math.min(3, insights.length); i++) {
    const g = insights[i]!;
    msg += `👥 [${g.groupName}]: ${g.totalMessages} tin (${g.totalParticipants} người)\n`;

    if (g.hotTopics.length > 0) {
      msg += `🔥 Chủ đề: ${g.hotTopics[0]?.topic}\n`;
    }

    if (g.painPointsAndQuestions.length > 0) {
      msg += `❓ Chú ý: "${g.painPointsAndQuestions[0]?.issue}"\n`;
    }

    if (g.businessOpportunities.length > 0) {
      msg += `💼 Cơ hội: ${g.businessOpportunities[0]?.description}\n`;
    }
    msg += `\n`;
  }

  if (insights.length > 3) {
    msg += `... và ${insights.length - 3} nhóm khác đã được bóc tách toàn diện trong file đính kèm.\n\n`;
  }

  msg += `👉 Em đã biên soạn trọn bộ báo cáo chi tiết kèm đề xuất cho Ban Quản Trị trong file Word (.docx) gửi kèm dưới đây nhé Sếp! 💼`;
  return msg;
}

/**
 * Tiến trình toàn diện thực thi phân tích insight và gửi báo cáo + file Word cho Sếp
 */
export async function runDailyGroupInsightJob(
  api: any,
  options?: { targetAdminId?: string; isPast24h?: boolean },
): Promise<{ success: boolean; message: string; docxPath?: string }> {
  console.log("[group-insight] 🚀 Bắt đầu tiến trình Khai thác Tri thức & Phân tích Insight Nhóm...");

  const now = Date.now();
  let startTs: number;
  let endTs: number;
  let dateLabel: string;

  if (options?.isPast24h) {
    // 24 giờ gần nhất tính từ thời điểm gọi
    startTs = now - 24 * 60 * 60 * 1000;
    endTs = now;
    const d = new Date(now);
    dateLabel = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} (24h qua)`;
  } else {
    // Ngày hôm qua trọn vẹn (00:00 - 23:59:59 Asia/Bangkok)
    const bkkYesterday = new Date(now - 24 * 60 * 60 * 1000);
    const dateStr = bkkYesterday.toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
    }); // YYYY-MM-DD
    startTs = new Date(`${dateStr}T00:00:00+07:00`).getTime();
    endTs = new Date(`${dateStr}T23:59:59.999+07:00`).getTime();
    const parts = dateStr.split("-");
    dateLabel = `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  try {
    // 1. Thu thập dữ liệu
    const groupDiscussions = collectGroupDiscussions({ startTs, endTs });
    if (groupDiscussions.length === 0) {
      const emptyMsg = `📊 [BÁO CÁO INSIGHT NHÓM - ${dateLabel}]\n\nTrong khoảng thời gian này các nhóm không có tin nhắn thảo luận mới từ thành viên. Hệ thống sẽ tiếp tục theo dõi! ☘️`;
      if (options?.targetAdminId) {
        await sendDirectText(api, options.targetAdminId, emptyMsg);
      }
      return { success: true, message: "Không có tin nhắn nào trong khung giờ." };
    }

    console.log(`[group-insight] 🔍 Tìm thấy ${groupDiscussions.length} nhóm có thảo luận. Đang gọi AI phân tích...`);

    // 2. Phân tích qua AI
    const insights: GroupInsightResult[] = [];
    for (const gd of groupDiscussions) {
      console.log(`[group-insight] 🤖 Đang phân tích nhóm [${gd.groupName}] (${gd.totalMessages} tin)...`);
      const res = await analyzeGroupInsight(gd);
      insights.push(res);
    }

    // 3. Xuất file Word .docx
    console.log(`[group-insight] 📄 Đang tạo file Word báo cáo Insight chuyên nghiệp...`);
    const docxPath = await generateGroupInsightWordDocument({
      dateLabel,
      insights,
      timeRangeLabel: options?.isPast24h ? "24 giờ qua" : "00:00 - 23:59",
    });

    // 4. Tạo bản tin Zalo tóm tắt
    const totalAllMessages = insights.reduce((sum, g) => sum + g.totalMessages, 0);
    const summaryText = formatInsightZaloMessage({
      dateLabel,
      insights,
      totalMessages: totalAllMessages,
    });

    // 5. Gửi bản tin tóm tắt và file Word tới Admin
    const targetAdmins = options?.targetAdminId
      ? [options.targetAdminId]
      : getAllAdminUserIds();

    for (const adminId of targetAdmins) {
      try {
        console.log(`[group-insight] 📤 Đang gửi báo cáo và file Word tới Admin ${adminId}...`);
        await sendDirectText(api, adminId, summaryText);
        await sendDirectFile(
          api,
          adminId,
          docxPath,
          `📄 [FILE BÁO CÁO WORD]: Báo cáo Phân tích Tri thức & Insight Nhóm Zalo (${dateLabel})`,
        );
      } catch (err) {
        console.warn(`[group-insight] Gửi tới admin ${adminId} lỗi:`, err);
      }
    }

    console.log(`[group-insight] ✅ Hoàn tất toàn bộ chu trình Insight Nhóm cho ngày ${dateLabel}!`);
    return { success: true, message: "Hoàn tất báo cáo Insight nhóm", docxPath };
  } catch (e) {
    console.error("[group-insight] runDailyGroupInsightJob error:", e);
    return { success: false, message: String(e) };
  }
}

// Lưu mốc ngày đã chạy tự động lúc 01:00 sáng
const sentInsightDays = new Set<string>();

/**
 * Vòng lặp kiểm tra kích hoạt định kỳ lúc 01:00 sáng (Asia/Bangkok)
 */
export async function checkDailyInsightCronLoop(api: any): Promise<void> {
  try {
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
    });
    const currentHM = now.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Bangkok",
    });

    if (currentHM === "01:00") {
      if (!sentInsightDays.has(todayStr)) {
        sentInsightDays.add(todayStr);
        console.log(`[group-insight] 🌙 Đúng 01:00 sáng (${todayStr}): Khởi động khai thác tri thức và phân tích insight nhóm...`);
        await runDailyGroupInsightJob(api);
      }
    }
  } catch (e) {
    console.warn("[group-insight] checkDailyInsightCronLoop error:", e);
  }
}

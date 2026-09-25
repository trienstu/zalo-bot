import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
} from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";

const GENERATED_FILES_DIR = path.resolve(process.cwd(), "data", "generated-files");

export function ensureOutputDir(): string {
  if (!fs.existsSync(GENERATED_FILES_DIR)) {
    fs.mkdirSync(GENERATED_FILES_DIR, { recursive: true });
  }
  return GENERATED_FILES_DIR;
}

/**
 * Nhận diện toàn diện ý định tạo/xuất file, bài thuyết trình/slide, voice, podcast hoặc vẽ biểu đồ/ảnh.
 * Hỗ trợ cả câu lệnh trực tiếp lẫn câu trả lời tiếp nối tin nhắn trích dẫn (quote) hoặc giục thực thi ("soạn luôn đi e").
 */
export function checkIsFileOrVoiceGeneration(question: string, quoteText = ""): boolean {
  const combined = `${question || ""} ${quoteText || ""}`.toLowerCase();
  const qLower = (question || "").toLowerCase();

  // Bỏ qua nếu chỉ là câu hỏi thăm dò năng lực thuần túy không có chủ đề cụ thể (VD: "em có biết tạo file không?", "bot có tạo được slide không hả?")
  const isGenericCapabilityInquiry =
    /^(?:em|bot|mày|bác)?\s*(?:có\s+)?(?:biết|làm|tạo|xuất|soạn)?\s*(?:được|đc|duoc)?(?:\s+(?:tạo|làm|soạn|xuất))?\s+(?:file|slide|voice|ảnh|nhạc|tài\s*liệu)\s*(?:không|ko)?\s*(?:hả|nhỉ|hở|ạ|không|ko)\s*[?]?$/i.test(
      qLower.trim(),
    );
  if (isGenericCapabilityInquiry) return false;

  const hasFileTarget =
    /(?:powerpoint|slide|pptx|trình\s*chiếu|thuyết\s*trình|word|docx|văn\s*bản\s*hành\s*chính|hợp\s*đồng|excel|xlsx|bảng\s*tính|báo\s*giá|csv|html|báo\s*cáo\s*web|pdf|file|tệp|voice|podcast|thu\s*âm|ghi\s*âm|audio|giọng\s*đọc|poster|biểu\s*đồ|đồ\s*thị|chart|plot|sơ\s*đồ|lưu\s*đồ|flowchart|mindmap|infographic|hình\s*ảnh|ảnh|bảng\s+(?:thi\s*đấu|đấu|xếp\s*hạng|điểm|so\s*sánh|thống\s*kê)|lịch\s+(?:thi\s*đấu|trình))/i.test(combined);

  // Nhận diện nếu đang trích dẫn một file/ảnh/biểu đồ/voice bot đã tạo trước đó
  const isQuotingGeneratedArtifact =
    /(?:biểu\s*đồ|hình\s*ảnh|bài\s*thuyết\s*trình|slide|file|voice|poster|đã\s*hoàn\s*tất|đã\s*tạo\s*xong|đã\s*soạn\s*xong|\[hình\s*ảnh\])/i.test(quoteText);

  // Ý định làm lại, chỉnh sửa hoặc phàn nàn chất lượng để bot làm lại cẩn thận
  const isReworkOrCritique =
    /(?:làm\s*lại|vẽ\s*lại|sửa\s*lại|chỉnh\s*lại|tạo\s*lại|soạn\s*lại|xuất\s*lại|cẩn\s*thận|đẹp\s*hơn|xấu|lỗi\s*font|font\s*lỗi|đồ\s*họa|chưa\s*đẹp|sơ\s*sài|chuyên\s*nghiệp|làm\s*ăn\s*thế\s*này|làm\s*đi)/i.test(qLower);

  if (isQuotingGeneratedArtifact && isReworkOrCritique) return true;

  // Nhận diện cấu trúc ngữ pháp tự nhiên đưa nội dung vào/ra file hoặc voice
  const hasStructuralDirection =
    /(?:vào|ra|thành|sang|qua|lên|bằng)\s+(?:thành\s+)?(?:file\s+)?(?:docx|word|excel|xlsx|bảng\s*tính|pptx|powerpoint|slide|pdf|csv|txt|voice|audio)/i.test(qLower);

  const hasAction =
    /(?:tạo|xuất|soạn|làm|viết|gửi|lưu|thiết\s*kế|chuyển\s*(?:thành|sang|qua|lên|ra)?|đổi\s*(?:thành|sang|qua)?|bật|convert|generate|export|triển\s*khai|đọc\s*(?:giúp|hộ|cho|bằng)?|ngâm(?:\s+thơ)?|thu\s*âm|ghi\s*âm|vẽ(?:\s+lại)?|làm(?:\s+lại)?|thiết\s*kế(?:\s+lại)?|sửa(?:\s+lại)?|chỉnh(?:\s+lại)?|đóng\s*gói|gom|cho\s*vào|bỏ\s*vào|lưu\s*vào|nhét\s*vào|in\s*ra)/i.test(qLower);

  const isAffirmativeFollowUp =
    /^(?:soạn|làm|tạo|xuất|viết|triển\s*khai|chốt|triển|lên|đóng\s*gói|gom)\s*(?:luôn|ngay|hộ|giúp|cho|đi|nhé|nha|e|em|luôn\s*đi|luôn\s*đi\s*e|luôn\s*hộ\s*e|luôn\s*nhé|luôn\s*nha|tiếp\s*đi)\b/i.test(qLower.trim());

  if (hasStructuralDirection) return true;
  if (hasFileTarget && (hasAction || isAffirmativeFollowUp)) return true;

  const isSpeechOrVoiceRequest =
    /(?:đọc|nói|phát|kể|ngâm)\s+(?:cho\s+)?(?:[\p{L}\s]+)?\s*nghe/iu.test(qLower) ||
    /(?:bận|đang\s+lái\s+xe|không\s+tiện\s+đọc)\s*[,.]*\s*(?:đọc|phát|nói|voice|audio)/iu.test(qLower) ||
    /(?:chuyển|phát|đọc|đổi|bật)\s+(?:thành|ra|sang|qua)?\s*(?:giọng|tiếng|âm\s*thanh|lời\s*nói|voice|audio|podcast)/iu.test(qLower) ||
    /(?:thu\s*âm|ghi\s*âm|ngâm\s*thơ)\s+(?:bài|thơ|văn|đoạn|nội\s*dung)/iu.test(qLower) ||
    /\b(?:voice\s*bubble|bong\s*bóng\s*thoại)\b/i.test(qLower);

  if (isSpeechOrVoiceRequest) return true;

  const isDialogueOrPodcastRequest =
    /(?:kịch\s*bản|đối\s*thoại|hội\s*thoại|trò\s*chuyện|cuộc\s*nói\s*chuyện|thảo\s*luận|podcast)\s+(?:giữa\s+)?2\s*(?:người|bạn|nhân\s*vật|mc)/iu.test(qLower) ||
    /2\s*(?:người|bạn|nhân\s*vật|mc)\s+(?:nói\s*chuyện|đối\s*thoại|trò\s*chuyện|thảo\s*luận|đối\s*đáp|tâm\s*sự)/iu.test(qLower) ||
    /(?:làm|tạo|soạn|phát|chuyển)\s+(?:thành\s+)?(?:podcast|đối\s*thoại|hội\s*thoại|talkshow)/iu.test(qLower);

  if (isDialogueOrPodcastRequest) return true;

  const isCodeOrChart =
    /(?:vẽ|tạo|xuất|lập|thiết\s*kế|làm|soạn)(?:\s+lại)?\s*(?:cho\s*.*?\s*)?(?:biểu\s*đồ|đồ\s*thị|chart|plot|sơ\s*đồ|lưu\s*đồ|flowchart|mindmap|infographic|poster|ảnh|hình|bảng\s+(?:thi\s*đấu|đấu|xếp\s*hạng|điểm|so\s*sánh|thống\s*kê)|lịch\s+(?:thi\s*đấu|trình))/i.test(qLower) ||
    /(?:biểu\s*đồ|đồ\s*họa|poster|infographic|hình\s*ảnh).*?(?:làm\s*lại|sửa\s*lại|vẽ\s*lại|cẩn\s*thận|đẹp\s*hơn|chuyên\s*nghiệp)/i.test(qLower) ||
    /^[/!](?:taoanh|veanh|draw|plot|chart)\b/i.test(qLower) ||
    /(?:chạy|viết|run|execute)\s*(?:code|mã|script)\s*(?:python|py)/i.test(qLower);

  return isCodeOrChart;
}

/**
 * Dọn dẹp file đã sinh ra cũ hơn maxAgeHours để tiết kiệm dung lượng ổ cứng
 */
export function cleanOldGeneratedFiles(maxAgeHours = 24): void {
  try {
    if (!fs.existsSync(GENERATED_FILES_DIR)) return;
    const now = Date.now();
    const thresholdMs = maxAgeHours * 60 * 60 * 1000;
    const files = fs.readdirSync(GENERATED_FILES_DIR);

    for (const f of files) {
      const fullPath = path.join(GENERATED_FILES_DIR, f);
      try {
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > thresholdMs) {
          fs.unlinkSync(fullPath);
        }
      } catch { }
    }
  } catch (err) {
    console.warn("[file-generator] Lỗi dọn dẹp file cũ:", err);
  }
}

export interface GeneratedFileResult {
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;
  caption?: string;
  message?: string;
}

export type ThemeName = "navy" | "blue" | "green" | "burgundy" | "slate" | "teal" | "emerald" | "luxury";

export interface ColorTheme {
  primary: string;       // Mã hex 6 ký tự không dấu #
  accent: string;
  headerText: string;
  bgLight: string;
  border: string;
  cardBg: string;
  canvasBg: string;
  darkText: string;
  mutedText: string;
  highlight: string;
}

export const COLOR_THEMES: Record<ThemeName, ColorTheme> = {
  navy: {
    primary: "0F2027",
    accent: "203A43",
    headerText: "FFFFFF",
    bgLight: "F2F5F9",
    border: "D0D7DE",
    cardBg: "FFFFFF",
    canvasBg: "F8FAFC",
    darkText: "1A202C",
    mutedText: "718096",
    highlight: "2C5364",
  },
  blue: {
    primary: "1E3A8A",
    accent: "2563EB",
    headerText: "FFFFFF",
    bgLight: "EFF6FF",
    border: "BFDBFE",
    cardBg: "FFFFFF",
    canvasBg: "F8FAFC",
    darkText: "1E293B",
    mutedText: "64748B",
    highlight: "3B82F6",
  },
  green: {
    primary: "166534",
    accent: "22C55E",
    headerText: "FFFFFF",
    bgLight: "F0FDF4",
    border: "BBF7D0",
    cardBg: "FFFFFF",
    canvasBg: "F8FAFC",
    darkText: "14532D",
    mutedText: "4B5563",
    highlight: "4ADE80",
  },
  burgundy: {
    primary: "5B0E2D",
    accent: "9F1239",
    headerText: "FFFFFF",
    bgLight: "FFF1F2",
    border: "FECDD3",
    cardBg: "FFFFFF",
    canvasBg: "F8FAFC",
    darkText: "4C0519",
    mutedText: "6B7280",
    highlight: "E11D48",
  },
  slate: {
    primary: "1E293B",
    accent: "475569",
    headerText: "FFFFFF",
    bgLight: "F1F5F9",
    border: "CBD5E1",
    cardBg: "FFFFFF",
    canvasBg: "F8FAFC",
    darkText: "0F172A",
    mutedText: "64748B",
    highlight: "334155",
  },
  teal: {
    primary: "0F4C5C",
    accent: "008891",
    headerText: "FFFFFF",
    bgLight: "F0F9FF",
    border: "BAE6FD",
    cardBg: "FFFFFF",
    canvasBg: "F8FAFC",
    darkText: "164E63",
    mutedText: "64748B",
    highlight: "00B4D8",
  },
  emerald: {
    primary: "064E3B",
    accent: "059669",
    headerText: "FFFFFF",
    bgLight: "ECFDF5",
    border: "A7F3D0",
    cardBg: "FFFFFF",
    canvasBg: "F8FAFC",
    darkText: "064E3B",
    mutedText: "4B5563",
    highlight: "10B981",
  },
  luxury: {
    primary: "1C1917",
    accent: "B45309",
    headerText: "FFFFFF",
    bgLight: "FEF3C7",
    border: "FDE68A",
    cardBg: "FFFFFF",
    canvasBg: "FAFAF9",
    darkText: "292524",
    mutedText: "78716C",
    highlight: "D97706",
  },
};

export function getTheme(name?: string): ColorTheme {
  const clean = String(name || "navy").toLowerCase().trim() as ThemeName;
  return COLOR_THEMES[clean] || COLOR_THEMES.navy;
}

// ==========================================
// 1. TẠO FILE POWERPOINT (.pptx)
// ==========================================

export interface SlideStep {
  number?: string | number;
  title: string;
  desc: string;
}

export interface SlideStat {
  value: string;
  label: string;
  desc?: string;
}

export interface SlideContent {
  layout?: "title" | "bullets" | "table" | "two_content" | "three_column" | "timeline" | "stats";
  title: string;
  subtitle?: string;
  kicker?: string;
  takeaway?: string;
  bullets?: string[];
  tableHeaders?: string[];
  tableRows?: Array<Array<string | number>>;
  col1Title?: string;
  col1Bullets?: string[];
  col2Title?: string;
  col2Bullets?: string[];
  col3Title?: string;
  col3Bullets?: string[];
  steps?: SlideStep[];
  stats?: SlideStat[];
}

/**
 * Phân tích nội dung Markdown/văn bản thành mảng slide cấu trúc chuẩn
 * Tự động phân loại layout thông minh: title, stats, timeline, three_column, two_content, table, bullets.
 */
export function parseMarkdownToSlides(content: string, defaultTitle = "Tài Liệu Trình Chiếu"): SlideContent[] {
  if (!content || !content.trim()) {
    return [
      { layout: "title", title: defaultTitle, subtitle: "Báo cáo trình chiếu tự động" },
      { layout: "bullets", title: "Nội dung tổng quan", bullets: ["Chưa có nội dung chi tiết."] },
    ];
  }

  const normalized = content.replace(/\r\n/g, "\n");

  // Phân chia theo slide delimiters: "---" hoặc tiêu đề cấp 1/2 hoặc "Slide X:"
  let rawChunks: string[] = [];
  if (/\n\s*---+\s*\n/.test(normalized)) {
    rawChunks = normalized.split(/\n\s*---+\s*\n/).map((c) => c.trim()).filter(Boolean);
  } else {
    rawChunks = normalized
      .split(/\n(?=(?:#{1,2}\s|[Ss]lide\s*\d+[:.]|[Tt]rang\s*\d+[:.]|[Pp]hần\s*\d+[:.]))/g)
      .map((c) => c.trim())
      .filter(Boolean);
  }

  if (rawChunks.length === 0) {
    rawChunks = [normalized.trim()];
  }

  const slides: SlideContent[] = [];

  for (const [idx, chunk] of rawChunks.entries()) {
    if (!chunk) continue;
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    let title = "";
    let kicker = "";
    let takeaway = "";
    const remainingLines: string[] = [];

    // Parse các dòng tiêu đề, badge, takeaway
    for (const line of lines) {
      if (/^\[([\p{L}0-9\s/_-]{2,30})\]$/u.test(line)) {
        kicker = line.replace(/^\[|\]$/g, "").trim();
        continue;
      }
      if (/^(?:💡\s*)?(?:ghi chú|takeaway|lưu ý|chú ý|kết luận)[:.]\s*/iu.test(line)) {
        takeaway = line.replace(/^(?:💡\s*)?(?:ghi chú|takeaway|lưu ý|chú ý|kết luận)[:.]\s*/iu, "").trim();
        continue;
      }
      if (!title && (/^#{1,3}\s/.test(line) || /^(?:[Ss]lide|[Tt]rang|[Pp]hần)\s*\d+[:.]/i.test(line))) {
        title = line.replace(/^#{1,3}\s*/, "").replace(/^(?:[Ss]lide|[Tt]rang|[Pp]hần)\s*\d+[:.]\s*/i, "").trim();
        continue;
      }
      if (!title && !line.startsWith("-") && !line.startsWith("*") && !line.startsWith("•") && !line.includes("|")) {
        title = line;
        continue;
      }
      remainingLines.push(line);
    }

    if (!title) {
      title = idx === 0 ? defaultTitle : `Nội Dung ${idx + 1}`;
    }

    // Slide 1 (Bìa) nếu là chunk đầu tiên và chỉ có mô tả ngắn
    if (idx === 0 && remainingLines.length <= 2 && !remainingLines.some((l) => /^[-*•\d]/.test(l))) {
      slides.push({
        layout: "title",
        title,
        subtitle: remainingLines.join(" - ") || "Tài liệu thuyết trình chiến lược",
        kicker: kicker || undefined,
      });
      continue;
    }

    // Kiểm tra H3 (###) chia 2 hoặc 3 cột
    const h3Sections = chunk.split(/\n(?=###\s+)/g).map((s) => s.trim()).filter(Boolean);
    if (h3Sections.length === 2 && h3Sections[0]?.startsWith("###") && h3Sections[1]?.startsWith("###")) {
      const col1Lines = h3Sections[0]!.split("\n").map((l) => l.trim()).filter(Boolean);
      const col2Lines = h3Sections[1]!.split("\n").map((l) => l.trim()).filter(Boolean);
      slides.push({
        layout: "two_content",
        title,
        kicker: kicker || undefined,
        takeaway: takeaway || undefined,
        col1Title: col1Lines[0]?.replace(/^###\s*/, "") || "Mục 1",
        col1Bullets: col1Lines.slice(1).map((l) => l.replace(/^[-*•]\s*/, "")),
        col2Title: col2Lines[0]?.replace(/^###\s*/, "") || "Mục 2",
        col2Bullets: col2Lines.slice(1).map((l) => l.replace(/^[-*•]\s*/, "")),
      });
      continue;
    } else if (h3Sections.length === 3 && h3Sections.every((s) => s.startsWith("###"))) {
      const col1Lines = h3Sections[0]!.split("\n").map((l) => l.trim()).filter(Boolean);
      const col2Lines = h3Sections[1]!.split("\n").map((l) => l.trim()).filter(Boolean);
      const col3Lines = h3Sections[2]!.split("\n").map((l) => l.trim()).filter(Boolean);
      slides.push({
        layout: "three_column",
        title,
        kicker: kicker || undefined,
        takeaway: takeaway || undefined,
        col1Title: col1Lines[0]?.replace(/^###\s*/, "") || "Mục 1",
        col1Bullets: col1Lines.slice(1).map((l) => l.replace(/^[-*•]\s*/, "")),
        col2Title: col2Lines[0]?.replace(/^###\s*/, "") || "Mục 2",
        col2Bullets: col2Lines.slice(1).map((l) => l.replace(/^[-*•]\s*/, "")),
        col3Title: col3Lines[0]?.replace(/^###\s*/, "") || "Mục 3",
        col3Bullets: col3Lines.slice(1).map((l) => l.replace(/^[-*•]\s*/, "")),
      });
      continue;
    }

    // Kiểm tra Table: dòng bắt đầu bằng |
    const tableLines = remainingLines.filter((l) => l.startsWith("|") && l.endsWith("|"));
    if (tableLines.length >= 2 && tableLines[0]) {
      const headers = tableLines[0].split("|").slice(1, -1).map((h) => h.trim());
      const hasDashRow = tableLines[1]?.includes("---");
      const dataRows = tableLines.slice(hasDashRow ? 2 : 1).map((row) =>
        row.split("|").slice(1, -1).map((cell) => cell.trim()),
      );
      slides.push({
        layout: "table",
        title,
        kicker: kicker || undefined,
        takeaway: takeaway || undefined,
        tableHeaders: headers,
        tableRows: dataRows,
      });
      continue;
    }

    // Kiểm tra Stats hoặc Timeline
    const statMatches: SlideStat[] = [];
    const stepMatches: SlideStep[] = [];
    const bulletList: string[] = [];

    const statValRegex = /^(?:[0-9.,]+(?:\s*[%+kKmMBb]|\s*(?:tỷ|triệu|tr|nghìn|căn|ha|m2|m²|usd|vnd|vnđ|ngày|tháng|năm|h|giờ))?|Q[1-4](?:\/\d{2,4})?)$/iu;

    for (const rLine of remainingLines) {
      const cleanLine = rLine.replace(/^[-*•]\s*/, "").trim();

      const pipeParts = cleanLine.split("|").map((p) => p.trim());
      const colonParts = cleanLine.split(/:\s+/).map((p) => p.trim());
      const part0 = pipeParts[0];
      const part1 = pipeParts[1];
      const colon0 = colonParts[0];
      const colon1 = colonParts[1];

      if (pipeParts.length >= 2 && part0 && part1 && statValRegex.test(part0)) {
        statMatches.push({
          value: part0.toUpperCase(),
          label: part1,
          desc: pipeParts[2] || undefined,
        });
      } else if (colonParts.length === 2 && colon0 && colon1 && statValRegex.test(colon0)) {
        statMatches.push({
          value: colon0.toUpperCase(),
          label: colon1,
        });
      } else if (/^(?:bước|giai\s*đoạn|phase|step|\d+)\s*(\d+)[:.]\s*(.+)$/iu.test(cleanLine)) {
        const m = cleanLine.match(/^(?:bước|giai\s*đoạn|phase|step|\d+)\s*(\d+)[:.]\s*(.+)$/iu);
        if (m && m[1] && m[2]) {
          const num = m[1].padStart(2, "0");
          const rest = m[2];
          const splitHyphen = rest.split(/\s*[-–—]\s*/);
          const stTitle = splitHyphen[0] || rest;
          stepMatches.push({
            number: num,
            title: stTitle,
            desc: splitHyphen.slice(1).join(" - ") || stTitle,
          });
        }
      } else {
        bulletList.push(cleanLine);
      }
    }

    if (statMatches.length >= 2 && bulletList.length <= 1) {
      slides.push({
        layout: "stats",
        title,
        kicker: kicker || undefined,
        takeaway: takeaway || undefined,
        stats: statMatches.slice(0, 4),
      });
    } else if (stepMatches.length >= 2 && bulletList.length <= 1) {
      slides.push({
        layout: "timeline",
        title,
        kicker: kicker || undefined,
        takeaway: takeaway || undefined,
        steps: stepMatches.slice(0, 4),
      });
    } else {
      slides.push({
        layout: "bullets",
        title,
        kicker: kicker || undefined,
        takeaway: takeaway || undefined,
        bullets: bulletList.length > 0 ? bulletList : remainingLines,
      });
    }
  }

  // Đảm bảo có slide tiêu đề ở đầu
  const firstSlide = slides[0];
  if (slides.length > 0 && (!firstSlide || firstSlide.layout !== "title")) {
    slides.unshift({
      layout: "title",
      title: defaultTitle,
      subtitle: "Báo cáo trình chiếu tự động",
    });
  }

  return slides;
}

export async function generatePowerPointFile(
  fileName: string,
  title: string,
  slides: SlideContent[],
  themeName: ThemeName = "navy",
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    cleanOldGeneratedFiles(24);

    const safeName = fileName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "bai_thuyet_trinh";
    const fullFileName = safeName.endsWith(".pptx") ? safeName : `${safeName}.pptx`;
    const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

    const theme = getTheme(themeName);
    const PptxConstructor: any = (PptxGenJS as any).default || PptxGenJS;
    const pres = new PptxConstructor();
    pres.layout = "LAYOUT_16x9";
    pres.title = title;

    // Slide 1: Bìa (Title Slide) theo phong cách Modern PPTmaster
    let startIdx = 0;
    const s0 = slides[0];
    const isCustomCover = s0 && s0.layout === "title";
    const coverTitle = isCustomCover ? (s0.title || title) : title;
    const coverSubtitle = isCustomCover ? (s0.subtitle || "Tài liệu thuyết trình chiến lược") : "Tài liệu trình chiếu AI Zalo Assistant";
    const coverKicker = isCustomCover && s0.kicker ? s0.kicker : "BÁO CÁO THUYẾT TRÌNH";
    if (isCustomCover) startIdx = 1;

    const coverSlide = pres.addSlide();
    coverSlide.background = { color: theme.canvasBg };

    // Vạch nhấn dọc bên trái tiêu đề
    coverSlide.addShape(pres.ShapeType.rect, {
      x: 0.8,
      y: 1.3,
      w: 0.1,
      h: 2.9,
      fill: { color: theme.accent },
    });

    // Badge phân loại / Kicker
    const badgeW = Math.min(3.6, coverKicker.length * 0.14 + 0.5);
    coverSlide.addShape(pres.ShapeType.roundRect, {
      x: 1.1,
      y: 1.3,
      w: badgeW,
      h: 0.35,
      fill: { color: theme.primary },
      rectRadius: 0.05,
    });
    coverSlide.addText(coverKicker.toUpperCase(), {
      x: 1.1,
      y: 1.3,
      w: badgeW,
      h: 0.35,
      fontSize: 10,
      bold: true,
      color: theme.headerText,
      align: "center",
      valign: "middle",
      fontFace: "Arial",
    });

    // Tiêu đề bìa lớn
    coverSlide.addText(coverTitle, {
      x: 1.1,
      y: 1.75,
      w: 8.1,
      h: 1.4,
      fontSize: 28,
      bold: true,
      color: theme.primary,
      align: "left",
      valign: "middle",
      fontFace: "Arial",
    });

    // Phụ đề bìa
    coverSlide.addText(coverSubtitle, {
      x: 1.1,
      y: 3.2,
      w: 8.1,
      h: 0.8,
      fontSize: 15,
      color: theme.mutedText,
      align: "left",
      fontFace: "Arial",
    });

    // Đường kẻ phân cách & Footer metadata
    coverSlide.addShape(pres.ShapeType.line, {
      x: 1.1,
      y: 4.4,
      w: 8.1,
      h: 0,
      line: { color: theme.border, width: 1 },
    });
    coverSlide.addText("Tài liệu trình chiếu • Zalo AI Assistant • Phát hành tự động", {
      x: 1.1,
      y: 4.6,
      w: 8.1,
      h: 0.4,
      fontSize: 11,
      color: theme.mutedText,
      fontFace: "Arial",
    });

    // Khối hình học trang trí góc phải
    coverSlide.addShape(pres.ShapeType.roundRect, {
      x: 8.5,
      y: 0.8,
      w: 0.7,
      h: 0.7,
      fill: { color: theme.accent, transparency: 85 },
      rectRadius: 0.1,
    });

    // Render các slide nội dung
    for (let i = startIdx; i < slides.length; i++) {
      const s = slides[i];
      if (!s) continue;
      const slide = pres.addSlide();
      slide.background = { color: theme.canvasBg };

      const layout =
        s.layout ||
        (s.stats && s.stats.length > 0
          ? "stats"
          : s.steps && s.steps.length > 0
            ? "timeline"
            : s.col3Title
              ? "three_column"
              : s.col1Title
                ? "two_content"
                : s.tableHeaders
                  ? "table"
                  : "bullets");

      // 1. Header slide: Kicker badge (nếu có) + Tiêu đề + Đường gạch nhấn
      if (s.kicker) {
        slide.addText(s.kicker.toUpperCase(), {
          x: 0.8,
          y: 0.35,
          w: 8.4,
          h: 0.3,
          fontSize: 10,
          bold: true,
          color: theme.accent,
          fontFace: "Arial",
        });
      }
      slide.addText(s.title || `Nội dung ${i + 1}`, {
        x: 0.8,
        y: s.kicker ? 0.6 : 0.45,
        w: 8.4,
        h: 0.6,
        fontSize: 20,
        bold: true,
        color: theme.primary,
        fontFace: "Arial",
      });

      // Đường kẻ trang trí đôi (accent bar + line)
      slide.addShape(pres.ShapeType.rect, {
        x: 0.8,
        y: s.kicker ? 1.25 : 1.1,
        w: 1.2,
        h: 0.035,
        fill: { color: theme.accent },
        line: { color: theme.accent },
      });
      slide.addShape(pres.ShapeType.line, {
        x: 2.1,
        y: s.kicker ? 1.27 : 1.12,
        w: 7.1,
        h: 0,
        line: { color: theme.border, width: 1 },
      });

      // 2. Body Slide theo từng Layout
      if (layout === "timeline" && s.steps && s.steps.length > 0) {
        // Layout: Lộ trình / Quy trình các bước (Cards nằm ngang kèm mũi tên)
        const displaySteps = s.steps.slice(0, 4);
        const N = Math.max(1, displaySteps.length);
        const gap = 0.25;
        const cardW = (8.4 - (N - 1) * gap) / N;

        displaySteps.forEach((st, idx) => {
          const cx = 0.8 + idx * (cardW + gap);
          // Container card với đổ bóng nhẹ
          slide.addShape(pres.ShapeType.roundRect, {
            x: cx,
            y: 1.55,
            w: cardW,
            h: 3.3,
            fill: { color: theme.cardBg },
            line: { color: theme.border, width: 1 },
            rectRadius: 0.08,
            shadow: { type: "outer", color: "000000", blur: 4, offset: 2, angle: 45, opacity: 0.06 },
          });
          // Thanh màu phía trên card
          slide.addShape(pres.ShapeType.rect, {
            x: cx,
            y: 1.55,
            w: cardW,
            h: 0.07,
            fill: { color: idx === 0 ? theme.accent : theme.primary },
          });
          // Huy hiệu số thứ tự bước
          slide.addShape(pres.ShapeType.roundRect, {
            x: cx + 0.15,
            y: 1.75,
            w: 0.55,
            h: 0.35,
            fill: { color: idx === 0 ? theme.accent : theme.primary },
            rectRadius: 0.05,
          });
          slide.addText(String(st.number || idx + 1).padStart(2, "0"), {
            x: cx + 0.15,
            y: 1.75,
            w: 0.55,
            h: 0.35,
            fontSize: 12,
            bold: true,
            color: theme.headerText,
            align: "center",
            valign: "middle",
            fontFace: "Arial",
          });
          // Tên bước
          slide.addText(st.title, {
            x: cx + 0.15,
            y: 2.25,
            w: cardW - 0.3,
            h: 0.65,
            fontSize: 13,
            bold: true,
            color: theme.primary,
            valign: "top",
            fontFace: "Arial",
          });
          // Mô tả bước
          slide.addText(st.desc, {
            x: cx + 0.15,
            y: 2.95,
            w: cardW - 0.3,
            h: 1.75,
            fontSize: 11,
            color: theme.darkText,
            valign: "top",
            fontFace: "Arial",
            lineSpacing: 16,
          });
          // Mũi tên kết nối
          if (idx < N - 1) {
            slide.addText("➔", {
              x: cx + cardW - 0.02,
              y: 2.95,
              w: 0.3,
              h: 0.4,
              fontSize: 13,
              bold: true,
              color: theme.accent,
              align: "center",
              fontFace: "Arial",
            });
          }
        });
      } else if (layout === "stats" && s.stats && s.stats.length > 0) {
        // Layout: Chỉ số ấn tượng / Hero Stat Cards
        const displayStats = s.stats.slice(0, 4);
        const N = Math.max(1, displayStats.length);
        const gap = 0.25;
        const cardW = (8.4 - (N - 1) * gap) / N;

        displayStats.forEach((st, idx) => {
          const cx = 0.8 + idx * (cardW + gap);
          slide.addShape(pres.ShapeType.roundRect, {
            x: cx,
            y: 1.6,
            w: cardW,
            h: 3.1,
            fill: { color: theme.cardBg },
            line: { color: theme.border, width: 1 },
            rectRadius: 0.08,
            shadow: { type: "outer", color: "000000", blur: 4, offset: 2, angle: 45, opacity: 0.06 },
          });
          // Vạch màu nhấn trên đỉnh thẻ
          slide.addShape(pres.ShapeType.rect, {
            x: cx + 0.05,
            y: 1.6,
            w: cardW - 0.1,
            h: 0.06,
            fill: { color: idx % 2 === 0 ? theme.primary : theme.accent },
          });
          // Số liệu lớn
          slide.addText(st.value, {
            x: cx + 0.1,
            y: 1.9,
            w: cardW - 0.2,
            h: 0.9,
            fontSize: 24,
            bold: true,
            color: theme.accent,
            align: "center",
            valign: "middle",
            fontFace: "Arial",
          });
          // Nhãn chỉ số
          slide.addText(st.label, {
            x: cx + 0.1,
            y: 2.8,
            w: cardW - 0.2,
            h: 0.6,
            fontSize: 12,
            bold: true,
            color: theme.primary,
            align: "center",
            valign: "middle",
            fontFace: "Arial",
          });
          // Mô tả phụ (nếu có)
          if (st.desc) {
            slide.addText(st.desc, {
              x: cx + 0.1,
              y: 3.45,
              w: cardW - 0.2,
              h: 1.0,
              fontSize: 10,
              color: theme.mutedText,
              align: "center",
              valign: "top",
              fontFace: "Arial",
            });
          }
        });
      } else if (layout === "three_column" && (s.col1Title || s.col2Title || s.col3Title)) {
        // Layout: 3 cột thẻ
        const gap = 0.25;
        const cardW = (8.4 - 2 * gap) / 3;
        const cols = [
          { title: s.col1Title || "Mục 1", bullets: s.col1Bullets || [] },
          { title: s.col2Title || "Mục 2", bullets: s.col2Bullets || [] },
          { title: s.col3Title || "Mục 3", bullets: s.col3Bullets || [] },
        ];

        cols.forEach((col, idx) => {
          const cx = 0.8 + idx * (cardW + gap);
          slide.addShape(pres.ShapeType.roundRect, {
            x: cx,
            y: 1.55,
            w: cardW,
            h: 3.3,
            fill: { color: theme.cardBg },
            line: { color: theme.border, width: 1 },
            rectRadius: 0.08,
            shadow: { type: "outer", color: "000000", blur: 4, offset: 2, angle: 45, opacity: 0.06 },
          });
          slide.addShape(pres.ShapeType.rect, {
            x: cx,
            y: 1.55,
            w: cardW,
            h: 0.07,
            fill: { color: idx === 1 ? theme.accent : theme.primary },
          });
          slide.addText(col.title, {
            x: cx + 0.15,
            y: 1.8,
            w: cardW - 0.3,
            h: 0.5,
            fontSize: 14,
            bold: true,
            color: theme.primary,
            align: "center",
            fontFace: "Arial",
          });
          const textObjs = col.bullets.slice(0, 6).map((b) => ({
            text: `• ${b}\n\n`,
            options: { fontSize: 12, color: theme.darkText, fontFace: "Arial", lineSpacing: 18 },
          }));
          slide.addText(textObjs, { x: cx + 0.15, y: 2.4, w: cardW - 0.3, h: 2.2 });
        });
      } else if (layout === "two_content") {
        // Layout: 2 cột so sánh
        const gap = 0.3;
        const cardW = (8.4 - gap) / 2;
        const cols = [
          { title: s.col1Title || "Phương án A", bullets: s.col1Bullets || [] },
          { title: s.col2Title || "Phương án B", bullets: s.col2Bullets || [] },
        ];

        cols.forEach((col, idx) => {
          const cx = 0.8 + idx * (cardW + gap);
          slide.addShape(pres.ShapeType.roundRect, {
            x: cx,
            y: 1.55,
            w: cardW,
            h: 3.3,
            fill: { color: theme.cardBg },
            line: { color: theme.border, width: 1 },
            rectRadius: 0.08,
            shadow: { type: "outer", color: "000000", blur: 4, offset: 2, angle: 45, opacity: 0.06 },
          });
          slide.addShape(pres.ShapeType.rect, {
            x: cx,
            y: 1.55,
            w: cardW,
            h: 0.07,
            fill: { color: idx === 0 ? theme.accent : theme.primary },
          });
          slide.addText(col.title, {
            x: cx + 0.2,
            y: 1.8,
            w: cardW - 0.4,
            h: 0.5,
            fontSize: 15,
            bold: true,
            color: theme.primary,
            align: "center",
            fontFace: "Arial",
          });
          const textObjs = col.bullets.slice(0, 7).map((b) => ({
            text: `• ${b}\n\n`,
            options: { fontSize: 13, color: theme.darkText, fontFace: "Arial", lineSpacing: 20 },
          }));
          slide.addText(textObjs, { x: cx + 0.2, y: 2.4, w: cardW - 0.4, h: 2.3 });
        });
      } else if (layout === "table" && s.tableHeaders && s.tableRows) {
        // Layout: Bảng dữ liệu chuyên nghiệp
        const tableData: any[][] = [];
        tableData.push(
          s.tableHeaders.map((h) => ({
            text: h,
            options: { fill: theme.primary, color: theme.headerText, bold: true, align: "center", fontSize: 13 },
          })),
        );
        s.tableRows.forEach((row, rIdx) => {
          tableData.push(
            row.map((cell) => ({
              text: String(cell ?? ""),
              options: {
                fill: rIdx % 2 === 0 ? "FFFFFF" : theme.bgLight,
                fontSize: 12,
                color: theme.darkText,
              },
            })),
          );
        });
        slide.addTable(tableData, { x: 0.8, y: 1.6, w: 8.4, colW: Array(s.tableHeaders.length).fill(8.4 / s.tableHeaders.length) });
      } else {
        // Layout: Bullets (Tối ưu hóa: Nếu <= 4 ý thì vẽ Card ngang; Nếu > 4 ý thì vẽ Container Card)
        const bulletList = (s.bullets || []).slice(0, 8);
        if (bulletList.length <= 4 && bulletList.length > 0) {
          const cardH = 0.68;
          const gap = 0.16;
          bulletList.forEach((b, bIdx) => {
            const cy = 1.5 + bIdx * (cardH + gap);
            slide.addShape(pres.ShapeType.roundRect, {
              x: 0.8,
              y: cy,
              w: 8.4,
              h: cardH,
              fill: { color: theme.cardBg },
              line: { color: theme.border, width: 1 },
              rectRadius: 0.06,
              shadow: { type: "outer", color: "000000", blur: 3, offset: 1, angle: 45, opacity: 0.05 },
            });
            // Badge số thứ tự bên trái
            slide.addShape(pres.ShapeType.roundRect, {
              x: 0.95,
              y: cy + 0.14,
              w: 0.45,
              h: 0.4,
              fill: { color: theme.bgLight },
              line: { color: theme.border, width: 1 },
              rectRadius: 0.04,
            });
            slide.addText(String(bIdx + 1).padStart(2, "0"), {
              x: 0.95,
              y: cy + 0.14,
              w: 0.45,
              h: 0.4,
              fontSize: 11,
              bold: true,
              color: theme.accent,
              align: "center",
              valign: "middle",
              fontFace: "Arial",
            });
            // Nội dung ý
            slide.addText(b, {
              x: 1.55,
              y: cy + 0.08,
              w: 7.5,
              h: 0.52,
              fontSize: 13,
              color: theme.darkText,
              valign: "middle",
              fontFace: "Arial",
            });
          });
        } else {
          // Nhiều hơn 4 ý: Khung card nền trắng bóng đổ
          slide.addShape(pres.ShapeType.roundRect, {
            x: 0.8,
            y: 1.5,
            w: 8.4,
            h: 3.3,
            fill: { color: theme.cardBg },
            line: { color: theme.border, width: 1 },
            rectRadius: 0.08,
            shadow: { type: "outer", color: "000000", blur: 4, offset: 2, angle: 45, opacity: 0.06 },
          });
          const textObjects = bulletList.map((b) => ({
            text: `${b.startsWith("•") || b.startsWith("-") ? b : `•  ${b}`}\n\n`,
            options: { fontSize: 13, color: theme.darkText, fontFace: "Arial", lineSpacing: 20 },
          }));
          slide.addText(textObjects, { x: 1.1, y: 1.7, w: 7.8, h: 2.9 });
        }
      }

      // 3. Takeaway Pill / Ghi chú chân trang (nếu có)
      if (s.takeaway) {
        slide.addShape(pres.ShapeType.roundRect, {
          x: 0.8,
          y: 5.0,
          w: 8.4,
          h: 0.38,
          fill: { color: theme.bgLight },
          line: { color: theme.border, width: 1 },
          rectRadius: 0.05,
        });
        slide.addText(`💡 ${s.takeaway}`, {
          x: 0.9,
          y: 5.0,
          w: 8.2,
          h: 0.38,
          fontSize: 10,
          color: theme.darkText,
          valign: "middle",
          fontFace: "Arial",
        });
      }
    }

    await pres.writeFile({ fileName: targetPath });
    const stats = fs.statSync(targetPath);

    return {
      success: true,
      filePath: targetPath,
      fileName: fullFileName,
      fileSize: stats.size,
    };
  } catch (err: any) {
    console.error("[file-generator] Lỗi tạo file PowerPoint:", err);
    return {
      success: false,
      filePath: "",
      fileName: `${fileName}.pptx`,
      fileSize: 0,
      message: String(err?.message || err),
    };
  }
}

// ==========================================
// 2. TẠO FILE WORD (.docx) CHUẨN NGHỊ ĐỊNH 30
// ==========================================

export interface WordBlock {
  type: "heading" | "paragraph" | "bullets" | "table" | "two_columns";
  level?: 1 | 2 | 3;
  text?: string;
  paragraphs?: string[];
  align?: "left" | "center" | "right" | "justify";
  bold?: boolean;
  italic?: boolean;
  tableHeaders?: string[];
  tableRows?: Array<Array<string | number>>;
  leftCol?: string[];
  rightCol?: string[];
}

/**
 * Chuyển đổi văn bản chứa Markdown (**in đậm**, *in nghiêng*) thành mảng TextRun chuẩn của Word.
 */
export function parseMarkdownRuns(text: string, baseFont = "Times New Roman", baseSize = 26): TextRun[] {
  if (!text) return [];
  const runs: TextRun[] = [];
  const tokenRegex = /(\*\*.*?\*\*|\*.*?\*)/g;
  const parts = text.split(tokenRegex);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      runs.push(new TextRun({ text: part.slice(2, -2), font: baseFont, size: baseSize, bold: true }));
    } else if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      runs.push(new TextRun({ text: part.slice(1, -1), font: baseFont, size: baseSize, italics: true }));
    } else {
      runs.push(new TextRun({ text: part, font: baseFont, size: baseSize }));
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text, font: baseFont, size: baseSize })];
}

export async function generateWordDoc(
  fileName: string,
  title: string,
  sections: Array<{ heading?: string; paragraphs: string[] }> | WordBlock[],
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    cleanOldGeneratedFiles(24);

    const safeName = fileName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "tai_lieu";
    const fullFileName = safeName.endsWith(".docx") ? safeName : `${safeName}.docx`;
    const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

    const docChildren: any[] = [];

    // Kiểm tra kiểu sections truyền vào: blocks mới hay sections cũ
    const firstSec = sections[0];
    const isNewBlocks = Boolean(firstSec && "type" in firstSec);

    if (!isNewBlocks) {
      // Tương thích ngược với định dạng sections cũ
      docChildren.push(
        new Paragraph({
          text: title,
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),
      );

      for (const sec of (sections as Array<{ heading?: string; paragraphs: string[] }>)) {
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
                children: parseMarkdownRuns(p.slice(2).trim()),
                bullet: { level: 0 },
                spacing: { after: 80 },
              }),
            );
          } else {
            docChildren.push(
              new Paragraph({
                children: parseMarkdownRuns(p.trim()),
                spacing: { after: 150 },
              }),
            );
          }
        }
      }
    } else {
      // Định dạng blocks mới nâng cao (hỗ trợ hai cột Nghị định 30, bảng biểu)
      for (const block of (sections as WordBlock[])) {
        if (block.type === "two_columns") {
          // Bảng 2 cột không viền cho thể thức hành chính (Quốc hiệu/Tiêu ngữ hoặc Nơi nhận/Người ký)
          const leftParas = (block.leftCol || []).map(
            (t) =>
              new Paragraph({
                children: [
                  new TextRun({
                    text: t,
                    bold: t.toUpperCase() === t && t.length > 3,
                    font: "Times New Roman",
                    size: 24,
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 60 },
              }),
          );
          const rightParas = (block.rightCol || []).map(
            (t) =>
              new Paragraph({
                children: [
                  new TextRun({
                    text: t,
                    bold: t.toUpperCase() === t && t.length > 3,
                    italics: t.includes("ngày") && t.includes("tháng"),
                    font: "Times New Roman",
                    size: 24,
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 60 },
              }),
          );

          const noneBorder = { style: BorderStyle.NONE, size: 0, color: "auto" };
          const borders = { top: noneBorder, bottom: noneBorder, left: noneBorder, right: noneBorder };

          const twoColTable = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: leftParas,
                    borders,
                  }),
                  new TableCell({
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    children: rightParas,
                    borders,
                  }),
                ],
              }),
            ],
          });
          docChildren.push(twoColTable);
          docChildren.push(new Paragraph({ spacing: { after: 200 } }));
        } else if (block.type === "heading") {
          const hLevel =
            block.level === 2
              ? HeadingLevel.HEADING_2
              : block.level === 3
                ? HeadingLevel.HEADING_3
                : HeadingLevel.HEADING_1;

          docChildren.push(
            new Paragraph({
              text: block.text || "",
              heading: hLevel,
              alignment: block.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
              spacing: { before: 240, after: 120 },
            }),
          );
        } else if (block.type === "paragraph") {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: block.text || "",
                  font: "Times New Roman",
                  size: 26, // 13pt
                  bold: block.bold,
                  italics: block.italic,
                }),
              ],
              alignment:
                block.align === "center"
                  ? AlignmentType.CENTER
                  : block.align === "right"
                    ? AlignmentType.RIGHT
                    : block.align === "justify"
                      ? AlignmentType.JUSTIFIED
                      : AlignmentType.LEFT,
              spacing: { after: 120, line: 276 }, // Giãn dòng 1.15
            }),
          );
        } else if (block.type === "bullets") {
          for (const item of block.paragraphs || []) {
            docChildren.push(
              new Paragraph({
                children: parseMarkdownRuns(item.replace(/^[•*-]\s*/, "")),
                bullet: { level: 0 },
                spacing: { after: 80 },
              }),
            );
          }
        } else if (block.type === "table" && block.tableHeaders && block.tableRows) {
          const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: "888888" };
          const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

          const headerRow = new TableRow({
            tableHeader: true,
            children: block.tableHeaders.map(
              (h) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: h, bold: true, font: "Times New Roman", size: 24 })],
                      alignment: AlignmentType.CENTER,
                    }),
                  ],
                  shading: { fill: "D9E1F2" },
                  borders: cellBorders,
                }),
            ),
          });

          const dataRows = block.tableRows.map(
            (row) =>
              new TableRow({
                children: row.map(
                  (c) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: String(c ?? ""), font: "Times New Roman", size: 24 })],
                        }),
                      ],
                      borders: cellBorders,
                    }),
                ),
              }),
          );

          docChildren.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [headerRow, ...dataRows],
            }),
          );
          docChildren.push(new Paragraph({ spacing: { after: 180 } }));
        }
      }
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

// ==========================================
// 3. TẠO FILE EXCEL (.xlsx) ĐA SHEET & CÔNG THỨC
// ==========================================

export interface ExcelSheetData {
  name: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  note?: string;
}

export async function generateExcelFile(
  fileName: string,
  sheetNameOrSheets: string | ExcelSheetData[],
  headersOrTheme?: string[] | ThemeName,
  rowsInput?: Array<Array<string | number>>,
  themeNameInput: ThemeName = "navy",
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    cleanOldGeneratedFiles(24);

    const safeName = fileName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "bang_tinh";
    const fullFileName = safeName.endsWith(".xlsx") ? safeName : `${safeName}.xlsx`;
    const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

    const workbook = new ExcelJS.Workbook();

    // Chuẩn hóa dữ liệu đầu vào: nhiều sheet hoặc 1 sheet đơn
    let sheets: ExcelSheetData[] = [];
    let activeThemeName: ThemeName = "navy";

    if (Array.isArray(sheetNameOrSheets)) {
      sheets = sheetNameOrSheets;
      activeThemeName = (typeof headersOrTheme === "string" ? headersOrTheme : "navy") as ThemeName;
    } else {
      const singleSheetName = String(sheetNameOrSheets || "Sheet1");
      const headers = Array.isArray(headersOrTheme) ? headersOrTheme : [];
      const rows = Array.isArray(rowsInput) ? rowsInput : [];
      sheets = [{ name: singleSheetName, headers, rows }];
      activeThemeName = themeNameInput;
    }

    const theme = getTheme(activeThemeName);

    for (const sheetData of sheets) {
      const sheet = workbook.addWorksheet(sheetData.name.slice(0, 31) || "Sheet1");

      // Subtitle nếu có
      if (sheetData.subtitle) {
        const subRow = sheet.addRow([sheetData.subtitle]);
        subRow.font = { italic: true, bold: true, color: { argb: theme.primary } };
        sheet.addRow([]);
      }

      // Headers
      const headerRow = sheet.addRow(sheetData.headers);
      headerRow.font = { bold: true, color: { argb: theme.headerText } };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: theme.primary },
      };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 28;

      // Rows
      for (const r of sheetData.rows) {
        // Tự động nhận diện công thức tính toán dạng =SUM(...) hoặc =B2*C2
        const processedRow = r.map((cell) => {
          if (typeof cell === "string" && cell.startsWith("=")) {
            return { formula: cell.slice(1) };
          }
          return cell;
        });
        const addedRow = sheet.addRow(processedRow);
        addedRow.height = 22;
        addedRow.alignment = { vertical: "middle" };
      }

      // Note chân bảng
      if (sheetData.note) {
        sheet.addRow([]);
        const noteRow = sheet.addRow([`* ${sheetData.note}`]);
        noteRow.font = { italic: true, size: 10, color: { argb: "666666" } };
      }

      // Auto-fit column widths
      sheet.columns.forEach((col: any) => {
        let maxLen = 12;
        col.eachCell?.({ includeEmpty: false }, (cell: any) => {
          const valStr = cell.value?.formula ? String(cell.value.formula) : (cell.value ? String(cell.value) : "");
          if (valStr.length > maxLen) maxLen = Math.min(valStr.length + 4, 45);
        });
        col.width = maxLen;
      });
    }

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

// ==========================================
// 4. TẠO FILE CSV (.csv) CHÈN BOM UTF-8
// ==========================================

export async function generateCsvFile(
  fileName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    cleanOldGeneratedFiles(24);

    const safeName = fileName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "du_lieu";
    const fullFileName = safeName.endsWith(".csv") ? safeName : `${safeName}.csv`;
    const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

    function escapeCsvValue(val: string | number | null | undefined): string {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    const lines: string[] = [];
    lines.push(headers.map(escapeCsvValue).join(","));

    for (const r of rows) {
      lines.push(r.map(escapeCsvValue).join(","));
    }

    // Tiền tố BOM \uFEFF giúp Excel trên Windows hiển thị đúng 100% tiếng Việt
    const csvContent = "\uFEFF" + lines.join("\r\n");
    fs.writeFileSync(targetPath, csvContent, "utf8");
    const stats = fs.statSync(targetPath);

    return {
      success: true,
      filePath: targetPath,
      fileName: fullFileName,
      fileSize: stats.size,
    };
  } catch (err: any) {
    console.error("[file-generator] Lỗi tạo file CSV:", err);
    return {
      success: false,
      filePath: "",
      fileName: `${fileName}.csv`,
      fileSize: 0,
      message: String(err?.message || err),
    };
  }
}

// ==========================================
// 5. TẠO FILE HTML (.html) ĐƯỢC LÀM SẠCH AN TOÀN
// ==========================================

export async function generateHtmlFile(
  fileName: string,
  title: string,
  htmlContent: string,
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    cleanOldGeneratedFiles(24);

    const safeName = fileName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "trang_web";
    const fullFileName = safeName.endsWith(".html") ? safeName : `${safeName}.html`;
    const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

    // Sanitize: Loại bỏ hoàn toàn script và inline event handlers để triệt tiêu mã độc
    let cleanHtml = htmlContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

    if (!cleanHtml.includes("<!DOCTYPE html>")) {
      cleanHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #24292f; margin: 40px auto; max-width: 900px; padding: 0 20px; }
    h1, h2, h3 { color: #0969da; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #d0d7de; padding: 10px 14px; text-align: left; }
    th { background: #f6f8fa; }
    tr:nth-child(even) { background: #fcfcfc; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
${cleanHtml}
</body>
</html>`;
    }

    fs.writeFileSync(targetPath, cleanHtml, "utf8");
    const stats = fs.statSync(targetPath);

    return {
      success: true,
      filePath: targetPath,
      fileName: fullFileName,
      fileSize: stats.size,
    };
  } catch (err: any) {
    console.error("[file-generator] Lỗi tạo file HTML:", err);
    return {
      success: false,
      filePath: "",
      fileName: `${fileName}.html`,
      fileSize: 0,
      message: String(err?.message || err),
    };
  }
}

// ==========================================
// 6. TẠO FILE TEXT (.txt, .md, .py, .js)
// ==========================================

export async function generateTextFile(
  fileName: string,
  content: string,
  ext = "md",
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    cleanOldGeneratedFiles(24);

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

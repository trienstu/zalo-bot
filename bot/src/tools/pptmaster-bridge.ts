import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type SlideContent,
  type ThemeName,
  type ColorTheme,
  type GeneratedFileResult,
  getTheme,
  sanitizeSafeFileName,
  cleanOldGeneratedFiles,
} from "./file-generator.js";
import { synthesizeSingleAudio } from "./voice-generator.js";

const execFileAsync = promisify(execFile);

const GENERATED_FILES_DIR = path.resolve(process.cwd(), "data", "generated-files");

function ensureOutputDir(): string {
  if (!fs.existsSync(GENERATED_FILES_DIR)) {
    fs.mkdirSync(GENERATED_FILES_DIR, { recursive: true });
  }
  return GENERATED_FILES_DIR;
}

/**
 * Tìm kiếm đường dẫn Python venv và thư mục gốc của PPT Master
 */
export function getPPTMasterConfig(): {
  pythonBin: string;
  rootDir: string;
  isAvailable: boolean;
} {
  const homeDir = os.homedir();
  const candidateDirs = [
    process.env.PPTMASTER_DIR?.trim(),
    path.join(homeDir, "ppt-master"),
    path.resolve(process.cwd(), "..", "ppt-master"),
    path.resolve(process.cwd(), "ppt-master"),
  ].filter(Boolean) as string[];

  let rootDir = "";
  let pythonBin = "";

  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      const venvPy = path.join(dir, "venv", "bin", "python");
      const venvWinPy = path.join(dir, "venv", "Scripts", "python.exe");
      if (fs.existsSync(venvPy)) {
        rootDir = dir;
        pythonBin = venvPy;
        break;
      } else if (fs.existsSync(venvWinPy)) {
        rootDir = dir;
        pythonBin = venvWinPy;
        break;
      }
    }
  }

  // Fallback to env variable if directly specified
  if (!pythonBin && process.env.PPTMASTER_PYTHON && fs.existsSync(process.env.PPTMASTER_PYTHON)) {
    pythonBin = process.env.PPTMASTER_PYTHON.trim();
  }

  return {
    pythonBin,
    rootDir,
    isAvailable: Boolean(pythonBin && rootDir && fs.existsSync(path.join(rootDir, "skills", "ppt-master", "scripts", "svg_to_pptx.py"))),
  };
}

/**
 * Thoát các ký tự đặc biệt trong XML/SVG
 */
function escapeXml(unsafe: string): string {
  return String(unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Cắt ngắn văn bản nếu quá dài để không bị tràn slide
 */
function truncateText(text: string, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Chia văn bản thành các dòng ngắn theo độ dài tối đa để tránh tràn khung trong SVG
 */
export function wrapTextToLines(text: string, maxCharsPerLine: number, maxLines: number = 4): string[] {
  if (!text) return [];
  const words = text.trim().split(/\s+/);
  if (words.length === 0 || words[0] === "") return [];

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (!currentLine) {
      if (word.length > maxCharsPerLine) {
        lines.push(word.slice(0, maxCharsPerLine));
        currentLine = word.slice(maxCharsPerLine);
      } else {
        currentLine = word;
      }
    } else if (currentLine.length + 1 + word.length <= maxCharsPerLine) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      if (lines.length >= maxLines) {
        lines[lines.length - 1] = truncateText(lines[lines.length - 1]!, maxCharsPerLine);
        return lines;
      }
      currentLine = word;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  } else if (currentLine && lines.length >= maxLines) {
    lines[lines.length - 1] = truncateText(lines[lines.length - 1]! + " " + currentLine, maxCharsPerLine);
  }

  return lines;
}

/**
 * Render mảng dòng text thành các thẻ <text> trong SVG với Y tăng dần theo lineHeight
 */
function renderSvgTextLines(
  lines: string[],
  x: number,
  startY: number,
  lineHeight: number,
  fontSize: number,
  color: string,
  fontWeight: string = "normal",
): string {
  return lines
    .map((line, idx) => {
      const y = startY + idx * lineHeight;
      const weightAttr = fontWeight !== "normal" ? ` font-weight="${fontWeight}"` : "";
      return `<text x="${x}" y="${y}" font-size="${fontSize}"${weightAttr} fill="#${color}">${escapeXml(line)}</text>`;
    })
    .join("\n        ");
}

/**
 * Sinh mã nguồn SVG 1280x720 tuân thủ DrawingML cho từng SlideContent
 */
export function generateSlideSVG(
  slide: SlideContent,
  index: number,
  totalSlides: number,
  theme: ColorTheme,
): string {
  const layout = slide.layout || (index === 0 ? "title" : "bullets");
  const slideNum = index + 1;
  const isGenericTitle = !slide.title || /^(nội dung|slide|phần)\s*\d*$/i.test(slide.title.trim());
  let displayTitle = slide.title || "";
  let kicker = slide.kicker || "";

  if (isGenericTitle) {
    if (kicker && kicker.trim().length > 3) {
      displayTitle = kicker.trim();
      kicker = "BÁO CÁO CHI TIẾT";
    } else if (slide.col1Title && slide.col1Title.trim().length > 3) {
      displayTitle = slide.col1Title.trim();
      kicker = "BÁO CÁO CHI TIẾT";
    } else {
      displayTitle = `Nội Dung Phần ${slideNum}`;
      if (!kicker) kicker = "TỔNG QUAN";
    }
  } else if (!kicker) {
    kicker = "BÁO CÁO CHIẾN LƯỢC";
  }

  const subtitle = slide.subtitle || "";
  const takeaway = slide.takeaway || "";

  // 1. Slide Bìa (Title Slide)
  if (layout === "title" || index === 0) {
    const titleLines = wrapTextToLines(displayTitle, 32, 2);
    const titleStartY = titleLines.length > 1 ? 250 : 270;
    const titleSvg = renderSvgTextLines(titleLines, 125, titleStartY, 48, 38, theme.headerText, "bold");

    const subtitleStartY = titleStartY + titleLines.length * 48 + 18;
    const subtitleLines = wrapTextToLines(
      subtitle || "Tài liệu thuyết trình được tối ưu bởi AI Zalo Assistant",
      52,
      2,
    );
    const subtitleSvg = renderSvgTextLines(subtitleLines, 125, subtitleStartY, 28, 20, theme.darkText);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" font-family="Arial">
  <rect id="bg" x="0" y="0" width="1280" height="720" fill="#${theme.canvasBg}"/>
  <rect id="accent_bar" x="90" y="160" width="10" height="380" fill="#${theme.accent}" rx="5"/>
  <g id="badge">
    <rect x="125" y="160" width="260" height="40" fill="#${theme.cardBg}" rx="8" stroke="#${theme.accent}" stroke-width="1.5"/>
    <text x="145" y="185" font-size="13" font-weight="bold" fill="#${theme.accent}">${escapeXml(kicker.toUpperCase())}</text>
  </g>
  <g id="title_group">
    ${titleSvg}
    ${subtitleSvg}
  </g>
  <g id="footer_badge">
    <rect x="125" y="470" width="460" height="50" fill="#${theme.cardBg}" rx="10" stroke="#${theme.border}" stroke-width="1"/>
    <text x="150" y="501" font-size="14" fill="#${theme.accent}">✦ Nền tảng PPT Master DrawingML chuẩn PowerPoint</text>
  </g>
</svg>`;
  }

  // Header chung cho các slide nội dung (Trang 2 trở đi)
  const headerSvg = `
  <g id="header">
    <rect x="80" y="42" width="6" height="62" fill="#${theme.accent}" rx="3"/>
    <text x="100" y="62" font-size="12" font-weight="bold" fill="#${theme.accent}">${escapeXml(kicker.toUpperCase())}</text>
    <text x="100" y="96" font-size="26" font-weight="bold" fill="#${theme.headerText}">${escapeXml(truncateText(displayTitle, 55))}</text>
  </g>
  <g id="footer">
    <line x1="80" y1="660" x2="1200" y2="660" stroke="#${theme.border}" stroke-width="1"/>
    <text x="80" y="682" font-size="12" fill="#${theme.mutedText}">AI Zalo Assistant • Báo cáo trình chiếu chuyên nghiệp</text>
    <text x="1170" y="682" font-size="12" font-weight="bold" fill="#${theme.accent}">${slideNum} / ${totalSlides}</text>
  </g>`;

  // 2. Slide Thống Kê / KPI (Stats)
  if (layout === "stats" && Array.isArray(slide.stats) && slide.stats.length > 0) {
    const stats = slide.stats.slice(0, 4);
    const cardW = Math.floor((1120 - (stats.length - 1) * 25) / stats.length);
    let cardsSvg = "";

    stats.forEach((st, idx) => {
      const cardX = 80 + idx * (cardW + 25);
      const textX = cardX + 22;
      const maxTextChars = Math.max(16, Math.floor((cardW - 44) / 9.5));

      // Label (1-2 dòng)
      const labelLines = wrapTextToLines(st.label, maxTextChars, 2);
      const labelSvg = renderSvgTextLines(labelLines, textX, 310, 22, 16, theme.headerText, "bold");

      // Desc (2-4 dòng)
      const descStartY = 310 + labelLines.length * 22 + 10;
      const descLines = wrapTextToLines(st.desc || "", maxTextChars, 4);
      const descSvg = renderSvgTextLines(descLines, textX, descStartY, 20, 13, theme.darkText);

      cardsSvg += `
      <g id="stat_card_${idx + 1}">
        <rect x="${cardX}" y="150" width="${cardW}" height="460" fill="#${theme.cardBg}" rx="14" stroke="#${theme.border}" stroke-width="1.5"/>
        <rect x="${textX}" y="180" width="${cardW - 44}" height="4" fill="#${theme.accent}" rx="2"/>
        <text x="${textX}" y="255" font-size="38" font-weight="bold" fill="#${theme.accent}">${escapeXml(truncateText(st.value, 12))}</text>
        ${labelSvg}
        ${descSvg}
      </g>`;
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" font-family="Arial">
  <rect id="bg" x="0" y="0" width="1280" height="720" fill="#${theme.canvasBg}"/>
  ${headerSvg}
  ${cardsSvg}
</svg>`;
  }

  // 3. Slide Quy Trình / Dòng Thời Gian (Timeline / Steps)
  if ((layout === "timeline" || (layout as string) === "steps") && Array.isArray(slide.steps) && slide.steps.length > 0) {
    const steps = slide.steps.slice(0, 4);
    const cardW = Math.floor((1120 - (steps.length - 1) * 20) / steps.length);
    let stepsSvg = "";

    steps.forEach((st, idx) => {
      const cardX = 80 + idx * (cardW + 20);
      const textX = cardX + 22;
      const maxTextChars = Math.max(16, Math.floor((cardW - 44) / 9.5));

      // Title (1-2 dòng)
      const titleLines = wrapTextToLines(st.title, maxTextChars, 2);
      const titleSvg = renderSvgTextLines(titleLines, textX, 275, 22, 17, theme.headerText, "bold");

      // Desc (2-5 dòng)
      const descStartY = 275 + titleLines.length * 22 + 10;
      const descLines = wrapTextToLines(st.desc || "", maxTextChars, 5);
      const descSvg = renderSvgTextLines(descLines, textX, descStartY, 20, 13, theme.darkText);

      stepsSvg += `
      <g id="step_card_${idx + 1}">
        <rect x="${cardX}" y="160" width="${cardW}" height="450" fill="#${theme.cardBg}" rx="12" stroke="#${theme.border}" stroke-width="1.5"/>
        <circle cx="${cardX + 45}" cy="210" r="22" fill="#${theme.primary}" stroke="#${theme.accent}" stroke-width="2"/>
        <text x="${cardX + 45}" y="217" font-size="16" font-weight="bold" fill="#${theme.accent}" text-anchor="middle">${idx + 1}</text>
        ${titleSvg}
        ${descSvg}
      </g>`;
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" font-family="Arial">
  <rect id="bg" x="0" y="0" width="1280" height="720" fill="#${theme.canvasBg}"/>
  ${headerSvg}
  ${stepsSvg}
</svg>`;
  }

  // 4. Slide Bảng Biểu (Table)
  if (layout === "table" && Array.isArray(slide.tableHeaders) && slide.tableHeaders.length > 0) {
    const headers = slide.tableHeaders.slice(0, 6);
    const rows = (slide.tableRows || []).slice(0, 6);
    const colW = Math.floor(1120 / headers.length);
    let tableSvg = `
    <g id="table_container">
      <rect x="80" y="150" width="1120" height="470" fill="#${theme.cardBg}" rx="12" stroke="#${theme.border}" stroke-width="1"/>
      <rect x="80" y="150" width="1120" height="55" fill="#${theme.primary}" rx="12"/>
    `;

    // Render Headers
    headers.forEach((h, hIdx) => {
      tableSvg += `<text x="${95 + hIdx * colW}" y="185" font-size="15" font-weight="bold" fill="#${theme.headerText}">${escapeXml(truncateText(h, 20))}</text>`;
    });

    // Render Rows
    rows.forEach((r, rIdx) => {
      const rowY = 210 + rIdx * 65;
      const isEven = rIdx % 2 === 1;
      if (isEven) {
        tableSvg += `<rect x="80" y="${rowY}" width="1120" height="65" fill="#${theme.canvasBg}" opacity="0.4"/>`;
      }
      r.slice(0, headers.length).forEach((cell, cIdx) => {
        tableSvg += `<text x="${95 + cIdx * colW}" y="${rowY + 38}" font-size="14" fill="#${theme.darkText}">${escapeXml(truncateText(String(cell), 22))}</text>`;
      });
      tableSvg += `<line x1="80" y1="${rowY + 65}" x2="1200" y2="${rowY + 65}" stroke="#${theme.border}" stroke-width="1" opacity="0.5"/>`;
    });
    tableSvg += `</g>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" font-family="Arial">
  <rect id="bg" x="0" y="0" width="1280" height="720" fill="#${theme.canvasBg}"/>
  ${headerSvg}
  ${tableSvg}
</svg>`;
  }

  // 5. Slide 2 Cột (Two Content)
  if (layout === "two_content" || (slide.col1Bullets && slide.col2Bullets)) {
    const col1Title = slide.col1Title || "Khía cạnh chính";
    const col2Title = slide.col2Title || "Chi tiết bổ sung";
    const b1 = slide.col1Bullets || [];
    const b2 = slide.col2Bullets || [];

    const renderColumnBullets = (bulletsList: string[], startX: number) => {
      let bulletsSvg = "";
      let currentY = 255;
      const bulletX = startX + 18;
      const textX = startX + 38;
      const maxChars = 36; // 36 ký tự * ~9px = 324px, card rộng 540px

      bulletsList.slice(0, 4).forEach((item) => {
        const lines = wrapTextToLines(item, maxChars, 3);
        if (lines.length === 0) return;

        bulletsSvg += `\n      <circle cx="${bulletX}" cy="${currentY - 5}" r="4" fill="#${theme.accent}"/>`;
        bulletsSvg += `\n      ${renderSvgTextLines(lines, textX, currentY, 22, 14, theme.darkText)}`;
        currentY += lines.length * 22 + 16;
      });
      return bulletsSvg;
    };

    const c1Svg = renderColumnBullets(b1, 95);
    const c2Svg = renderColumnBullets(b2, 675);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" font-family="Arial">
  <rect id="bg" x="0" y="0" width="1280" height="720" fill="#${theme.canvasBg}"/>
  ${headerSvg}
  <g id="col_left">
    <rect x="80" y="150" width="540" height="470" fill="#${theme.cardBg}" rx="14" stroke="#${theme.border}" stroke-width="1.5"/>
    <text x="115" y="195" font-size="20" font-weight="bold" fill="#${theme.accent}">${escapeXml(truncateText(col1Title, 35))}</text>
    <line x1="115" y1="212" x2="585" y2="212" stroke="#${theme.border}" stroke-width="1"/>
    ${c1Svg}
  </g>
  <g id="col_right">
    <rect x="660" y="150" width="540" height="470" fill="#${theme.cardBg}" rx="14" stroke="#${theme.border}" stroke-width="1.5"/>
    <text x="695" y="195" font-size="20" font-weight="bold" fill="#${theme.accent}">${escapeXml(truncateText(col2Title, 35))}</text>
    <line x1="695" y1="212" x2="1165" y2="212" stroke="#${theme.border}" stroke-width="1"/>
    ${c2Svg}
  </g>
</svg>`;
  }

  // 6. Slide Danh Sách Ý Chính (Bullets - Mặc định)
  const bullets = slide.bullets || ["Chưa có nội dung chi tiết"];
  let bulletsSvg = "";
  const maxBullets = takeaway ? 4 : 5;
  const cardHeight = takeaway ? 68 : 74;
  const gap = takeaway ? 14 : 16;

  bullets.slice(0, maxBullets).forEach((b, bIdx) => {
    const cardY = 145 + bIdx * (cardHeight + gap);
    const lines = wrapTextToLines(b, 78, 2);
    const textStartY = lines.length > 1 ? cardY + 28 : cardY + 38;
    const textSvg = renderSvgTextLines(lines, 155, textStartY, 22, 15, theme.darkText);

    bulletsSvg += `
    <g id="bullet_item_${bIdx + 1}">
      <rect x="80" y="${cardY}" width="1120" height="${cardHeight}" fill="#${theme.cardBg}" rx="10" stroke="#${theme.border}" stroke-width="1"/>
      <circle cx="120" cy="${cardY + Math.floor(cardHeight / 2)}" r="14" fill="#${theme.primary}"/>
      <text x="120" y="${cardY + Math.floor(cardHeight / 2) + 5}" font-size="14" font-weight="bold" fill="#${theme.accent}" text-anchor="middle">${bIdx + 1}</text>
      ${textSvg}
    </g>`;
  });

  let takeawaySvg = "";
  if (takeaway) {
    const takeawayLines = wrapTextToLines(takeaway, 72, 2);
    const takeawayTextSvg = renderSvgTextLines(takeawayLines, 235, takeawayLines.length > 1 ? 595 : 605, 20, 13.5, theme.headerText);
    takeawaySvg = `
    <g id="takeaway_box">
      <rect x="80" y="575" width="1120" height="55" fill="#${theme.primary}" rx="8" stroke="#${theme.accent}" stroke-width="1"/>
      <text x="110" y="608" font-size="14" font-weight="bold" fill="#${theme.accent}">💡 ĐIỂM CỐT LÕI: </text>
      ${takeawayTextSvg}
    </g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" font-family="Arial">
  <rect id="bg" x="0" y="0" width="1280" height="720" fill="#${theme.canvasBg}"/>
  ${headerSvg}
  ${bulletsSvg}
  ${takeawaySvg}
</svg>`;
}

export interface PPTMasterRenderOptions {
  fileName: string;
  title: string;
  slides: SlideContent[];
  themeName?: ThemeName;
  enableNarration?: boolean;
  voiceHint?: string;
  voiceStyle?: string;
}

/**
 * Tạo file PowerPoint chuẩn vector DrawingML bằng PPT Master
 * Khâu thuyết minh được sinh bằng Google AI Studio TTS (Tier 1) như yêu cầu của người dùng
 */
export async function renderPPTMasterPresentation(
  options: PPTMasterRenderOptions,
): Promise<GeneratedFileResult> {
  const config = getPPTMasterConfig();
  if (!config.isAvailable) {
    throw new Error("PPT Master engine chưa được cấu hình hoặc không khả dụng trên hệ thống.");
  }

  ensureOutputDir();
  cleanOldGeneratedFiles(24);

  const safeName = sanitizeSafeFileName(options.fileName, "bai_thuyet_trinh");
  const fullFileName = safeName.endsWith(".pptx") ? safeName : `${safeName}.pptx`;
  const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

  const theme = getTheme(options.themeName || "navy");
  const tempProjectDir = path.join(os.tmpdir(), `ppt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  const svgOutputDir = path.join(tempProjectDir, "svg_output");
  const notesDir = path.join(tempProjectDir, "notes");
  const audioDir = path.join(tempProjectDir, "audio");

  fs.mkdirSync(svgOutputDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  if (options.enableNarration) {
    fs.mkdirSync(audioDir, { recursive: true });
  }

  const scriptsDir = path.join(config.rootDir, "skills", "ppt-master", "scripts");
  let hasAudio = false;

  try {
    const total = options.slides.length;
    for (let i = 0; i < total; i++) {
      const s = options.slides[i]!;
      const prefix = String(i + 1).padStart(2, "0");
      const svgPath = path.join(svgOutputDir, `${prefix}_slide.svg`);
      const notePath = path.join(notesDir, `${prefix}_slide.md`);

      // 1. Tạo file SVG chuẩn cho slide
      const svgContent = generateSlideSVG(s, i, total, theme);
      fs.writeFileSync(svgPath, svgContent, "utf8");

      // 2. Tạo Speaker Notes
      let noteText = (s.speakerNotes || "").trim();
      if (!noteText) {
        if (s.layout === "title" || i === 0) {
          noteText = `Kính chào quý vị, xin mời quý vị theo dõi bài thuyết trình: ${s.title}. ${s.subtitle || ""}`;
        } else {
          noteText = `${s.title}. ${s.takeaway || ""}. ${s.bullets ? s.bullets.join(". ") : ""}`;
        }
      }
      fs.writeFileSync(notePath, noteText, "utf8");

      // 3. Khâu thuyết minh bằng Google AI Studio TTS (Tier 1) theo đúng chỉ đạo người dùng
      if (options.enableNarration && noteText) {
        const audioPath = path.join(audioDir, `${prefix}_slide.mp3`);
        try {
          await synthesizeSingleAudio(noteText, audioPath, options.voiceHint, {
            stylePrompt: options.voiceStyle,
          });
          if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0) {
            hasAudio = true;
          }
        } catch (ttsErr) {
          console.warn(`[pptmaster-bridge] Lỗi sinh thuyết minh slide ${i + 1}:`, ttsErr);
        }
      }
    }

    // 4. Bước tiền xử lý: Chạy finalize_svg.py
    const finalizeScript = path.join(scriptsDir, "finalize_svg.py");
    await execFileAsync(config.pythonBin, [finalizeScript, tempProjectDir, "-q"]);

    // 5. Bước xuất PPTX: Chạy svg_to_pptx.py
    const svgToPptxScript = path.join(scriptsDir, "svg_to_pptx.py");
    const args = [
      svgToPptxScript,
      tempProjectDir,
      "-s",
      "final",
      "-o",
      targetPath,
      "--with-notes",
      "-t",
      "fade",
      "-q",
    ];

    if (hasAudio) {
      args.push("--narration-audio-dir", audioDir);
    }

    await execFileAsync(config.pythonBin, args);

    if (!fs.existsSync(targetPath)) {
      throw new Error("svg_to_pptx.py hoàn thành nhưng không tìm thấy file output.pptx");
    }

    const stats = fs.statSync(targetPath);
    console.log(`[pptmaster-bridge] ✅ Xuất PPTX thành công: ${fullFileName} (${stats.size} bytes, audio=${hasAudio})`);

    return {
      success: true,
      filePath: targetPath,
      fileName: fullFileName,
      fileSize: stats.size,
      caption: hasAudio ? "Kèm thuyết minh âm thanh AI Studio" : undefined,
    };
  } finally {
    // Dọn dẹp thư mục tạm
    try {
      if (fs.existsSync(tempProjectDir)) {
        fs.rmSync(tempProjectDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

/**
 * Soạn thảo văn bản hành chính đúng chuẩn Nghị định 30/2020/NĐ-CP qua PPT Master tools/vi/van_ban.py
 */
export async function renderDecree30Document(options: {
  fileName: string;
  data: Record<string, any>;
}): Promise<GeneratedFileResult> {
  const config = getPPTMasterConfig();
  if (!config.isAvailable) {
    throw new Error("PPT Master engine chưa khả dụng.");
  }

  ensureOutputDir();
  cleanOldGeneratedFiles(24);

  const safeName = sanitizeSafeFileName(options.fileName, "van_ban_nd30");
  const fullFileName = safeName.endsWith(".docx") ? safeName : `${safeName}.docx`;
  const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

  const tempDir = path.join(os.tmpdir(), `nd30_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const noiDungJsonPath = path.join(tempDir, "noi-dung.json");
    fs.writeFileSync(noiDungJsonPath, JSON.stringify(options.data, null, 2), "utf8");

    const vanBanScript = path.join(config.rootDir, "tools", "vi", "van_ban.py");
    await execFileAsync(config.pythonBin, [vanBanScript, tempDir]);

    const generatedDocx = path.join(tempDir, "van-ban.docx");
    if (!fs.existsSync(generatedDocx)) {
      throw new Error("van_ban.py hoàn tất nhưng không tìm thấy file van-ban.docx");
    }

    fs.copyFileSync(generatedDocx, targetPath);
    const stats = fs.statSync(targetPath);

    console.log(`[pptmaster-bridge] ✅ Xuất văn bản NĐ 30 thành công: ${fullFileName} (${stats.size} bytes)`);
    return {
      success: true,
      filePath: targetPath,
      fileName: fullFileName,
      fileSize: stats.size,
    };
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

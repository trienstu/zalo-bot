import fs from "node:fs";
import path from "node:path";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { callGeminiJson } from "../gemini.js";
import {
  generatePowerPointFile,
  parseMarkdownToSlides,
  getTheme,
  type SlideContent,
  type ThemeName,
  type ColorTheme,
} from "../tools/file-generator.js";
import { synthesizeSingleAudio } from "../tools/voice-generator.js";
import { sendDirectFile, sendDirectText, sendGroupFile, sendGroupText } from "../zalo/client.js";
import {
  registerRenderJob,
  unregisterRenderJob,
  getActiveRenderJob,
} from "./active-render-jobs.js";

const execFileAsync = promisify(execFile);

const GENERATED_FILES_DIR = path.resolve(process.cwd(), "data", "generated-files");

function ensureOutputDir(): string {
  if (!fs.existsSync(GENERATED_FILES_DIR)) {
    fs.mkdirSync(GENERATED_FILES_DIR, { recursive: true });
  }
  return GENERATED_FILES_DIR;
}

export interface PresentationVideoJobOptions {
  api: any;
  sender: string;
  isGroup: boolean;
  threadId?: string;
  userGreeting: string;
  displayName?: string;
  userPrompt: string;
  quoteText?: string;
  title?: string;
  theme?: ThemeName;
  voiceHint?: string;
}

export interface PresentationPlan {
  title: string;
  theme: ThemeName;
  voiceStyle?: string;
  slides: SlideContent[];
}

/**
 * Kiểm tra xem người dùng có yêu cầu tạo / xuất video bài thuyết trình / video slide / clip trình chiếu hay không.
 */
export function isPresentationVideoRequest(text: string, quoteText = ""): boolean {
  const combined = `${text || ""} ${quoteText || ""}`.trim().toLowerCase();
  const qLower = (text || "").trim().toLowerCase();
  const quoteLower = (quoteText || "").trim().toLowerCase();

  if (!qLower) return false;

  // 1. Phủ định ngay các trường hợp phản hồi, đính chính, góp ý, từ chối, rút điện
  const isCorrectionOrFeedback =
    /(?:tóm\s*tắt|dịch|nói|phân\s*loại)\s*(?:ko|không|chưa)\s*(?:chuẩn|đúng|chính\s*xác)|(?:sai|nhầm)\s*rồi|không\s*phải\s*(?:đâu|rồi)|(?:tóm\s*tắt|nói)\s*nhảm/i.test(
      qLower,
    ) ||
    /(?:đâu\s+cần|không\s+cần|ko\s+cần|chưa\s+cần|thôi\s+khỏi|thôi\s+đừng|rút\s+điện|hủy\s+bỏ|hủy\s+đi|dừng\s+lại|ngừng|đừng\s+tạo|không\s+phải|ai\s+mượn)/iu.test(
      qLower,
    );
  if (isCorrectionOrFeedback) return false;

  // 1.5. Phủ định nếu là câu hỏi tra cứu tài nguyên / hỏi repo / hỏi công cụ / hỏi cách làm
  const isResourceOrToolInquiry =
    /(?:có\s+(?:repo|mã\s*nguồn|thư\s*viện|tool|công\s*cụ|app|ứng\s*dụng|phần\s*mềm|web|site|kênh|hệ\s*thống|cách|phương\s*pháp|ai)\s+(?:nào|gì)|hướng\s*dẫn\s+cách|làm\s*sao\s+để|xin\s+(?:repo|tool|link)|chia\s*sẻ\s+(?:repo|tool|phần\s*mềm))/iu.test(
      qLower,
    );
  if (isResourceOrToolInquiry) return false;

  // 2. Phủ định các trường hợp miêu tả phần mềm tải video hoặc cào dữ liệu
  const isDownloaderOrScraperDesc =
    /(?:chuyên\s*tải|chỉ\s*tải|dùng\s*để\s*tải|tải\s*xuống|download|bắt\s*luồng)\s*(?:video|clip|nhạc|âm\s*thanh)/i.test(
      qLower,
    );
  if (isDownloaderOrScraperDesc) return false;

  // 3. Phủ định các yêu cầu tóm tắt / xem video có sẵn (Summarize an existing video)
  const isVideoSummaryReq =
    /(?:tóm\s*tắt|xem|đọc|hiểu)\s*(?:nội\s*dung\s*)?(?:video|clip|thước\s*phim)\s*(?:này|trên|ở|dưới)/i.test(
      qLower,
    );
  if (isVideoSummaryReq) return false;

  // 4. Bỏ qua nếu chỉ là câu hỏi thăm dò năng lực, nghi vấn/hoài nghi hoặc hỏi ý kiến/lý thuyết thông thường
  const isHypotheticalOrInquiry =
    /^(?:em|bot|mày|bác)?\s*(?:có\s+)?(?:biết|làm|tạo|xuất)?\s*(?:được|đc|duoc)?(?:\s+(?:tạo|làm|soạn|xuất))?\s+(?:video|clip)\s*(?:thuyết\s*trình|slide|trình\s*chiếu)?\s*(?:không|ko)?\s*(?:hả|nhỉ|hở|ạ|không|ko)\s*[?]?$/iu.test(
      qLower,
    ) ||
    /(?:có\s+(?:thật|thiệt)\s+.*?(?:được\s+không|được\s+ko|ko\s*đó|không\s*đó|hả|nhỉ|chăng)|tự\s+làm\s+(?:được|đc)\s+(?:không|ko|hả|sao)|chắc\s+làm\s+được|làm\s+sao\s+mà\s+làm\s+được)/iu.test(
      qLower,
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:làm|tạo|dựng|quay|xuất)\s+(?:video|clip).*?(?:có\s+khó|như\s+thế\s+nào|kiếm\s+tiền|phần\s+mềm|bằng\s+app|app\s+gì|dễ\s+không|sao\s+nhỉ|ở\s+đâu|bằng\s+cách\s+nào)/iu.test(
      qLower,
    );

  if (isHypotheticalOrInquiry) {
    return false;
  }

  // 5. Cụm từ trực tiếp trong câu hỏi người dùng: "video thuyết trình", "video slide", "video trình chiếu", "video powerpoint", "video bài giảng"
  const directMatch =
    /\b(?:video|clip)\s+(?:thuyết\s*trình|slide|trình\s*chiếu|powerpoint|pptx|bài\s*giảng)\b/i.test(qLower) ||
    /\b(?:thuyết\s*trình|slide|trình\s*chiếu|powerpoint|pptx)\s+(?:thành|ra|sang)\s+(?:video|clip)\b/i.test(qLower) ||
    /\b(?:slide|bài\s*thuyết\s*trình|bài\s*trình\s*chiếu)\s+(?:kèm|có)\s+(?:video|giọng\s*đọc|thuyết\s*minh|lồng\s*tiếng)\b/i.test(qLower);

  if (directMatch) return true;

  // 6. Động từ hành động RÕ RÀNG TRONG CÂU HỎI hướng vào tạo video + chủ đề trình chiếu/thuyết minh/giải thích kiến thức
  const hasDirectVideoCommandInQuestion =
    /(?:(?:hãy|giúp|nhờ|em)?\s*(?:làm|tạo|dựng|xuất|quay|sản\s*xuất|chuyển)\s+(?:cho\s*(?:anh|em|tôi|sếp|mình|nhóm)\s*)?(?:(?:1|một)?\s*(?:bản|file|bộ)?\s*)?(?:video|clip|mp4|thước\s*phim))/i.test(
      qLower,
    );
  const mentionsPresentation = /\b(?:thuyết\s*trình|trình\s*chiếu|slide|powerpoint|bài\s*giảng)\b/i.test(combined);
  const mentionsNarration = /\b(?:thuyết\s*minh|lồng\s*tiếng|giọng\s*đọc|lời\s*thoại|speaker\s*notes?)\b/i.test(combined);
  const mentionsExplaining = /\b(?:giải\s*thích|phân\s*tích|hướng\s*dẫn|kiến\s*trúc|vận\s*hành|khổ\s*dọc|khổ\s*ngang|9:16|16:9|shorts|reels|tiktok)\b/i.test(combined);

  if (hasDirectVideoCommandInQuestion && (mentionsPresentation || mentionsNarration || mentionsExplaining)) {
    return true;
  }

  if (/\b(?:video|clip)\b/i.test(qLower) && mentionsPresentation && mentionsNarration) {
    return true;
  }

  // 7. Nếu có tin nhắn trích dẫn (quoteText):
  if (quoteLower) {
    // 7A. Lệnh làm video rõ ràng hướng vào nội dung trích dẫn
    const isCommandOnQuote =
      /(?:dựng|làm|tạo|xuất|chuyển)\s+(?:thành\s+)?(?:video|clip)\s+(?:cho|từ)?\s*(?:bài|nội\s*dung|đoạn|kịch\s*bản|tài\s*liệu)?\s*(?:này|trên|đó|nhé|nha)/iu.test(
        qLower,
      );
    if (isCommandOnQuote) return true;

    // 7B. Trích dẫn một đề xuất làm video của bot VÀ người dùng đồng ý/xác nhận
    const isQuotingVideoProposal =
      /(?:video\s+thuyết\s*trình|xuất\s+bản\s+video|sản\s+xuất\s+video|dựng\s+clip)/iu.test(quoteLower);
    // Sử dụng ranh giới từ chặt chẽ chống bắt nhầm chữ "u" trong tiếng Việt
    const isAffirmation =
      /\b(?:ok(?:ela|ay|e)?|okie|ừ|uh|da|dạ|vâng|được|dc|triển|làm\s*đi|xuất\s*đi|làm\s*luôn|chốt|duyệt|tiến\s*hành)\b/iu.test(
        qLower,
      );
    if (isQuotingVideoProposal && isAffirmation) return true;
  }

  return false;
}

/**
 * Render trực tiếp video bài thuyết trình từ danh sách slide & speaker notes đã được biên soạn sẵn
 */
export async function renderPresentationVideoFromSlides(
  fileName: string,
  title: string,
  slides: SlideContent[],
  themeName: ThemeName = "navy",
  voiceHint?: string,
  voiceStyle?: string,
): Promise<{
  success: boolean;
  filePath: string;
  fileName: string;
  fileSize: number;
  pptxPath?: string;
  isVideo: boolean;
  message?: string;
}> {
  const safeTitle = (fileName || title || "video_thuyet_trinh")
    .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/giu, "_")
    .slice(0, 60) || "video_thuyet_trinh";

  const jobId = `pres_render_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const workDir = path.join("/tmp", jobId);
  fs.mkdirSync(workDir, { recursive: true });

  const ffmpegBin = findSystemBinary("ffmpeg", [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
  ]);

  if (!ffmpegBin) {
    return {
      success: false,
      filePath: "",
      fileName: `${safeTitle}.mp4`,
      fileSize: 0,
      isVideo: true,
      message: "Hệ thống máy chủ chưa cài đặt công cụ FFmpeg để render video.",
    };
  }

  try {
    const theme = getTheme(themeName);
    // 1. Tạo file PowerPoint (.pptx) có speaker notes
    const pptxRes = await generatePowerPointFile(safeTitle, title, slides, themeName);

    // 2. Chuyển đổi slide sang danh sách ảnh 1080p
    const slideImages = await convertPptxToSlideImages(pptxRes.filePath, workDir, slides, theme);
    if (slideImages.length === 0) {
      throw new Error("Không thể trích xuất hình ảnh slide để làm video.");
    }

    // 3. Thu âm giọng đọc theo từng slide & dựng phân đoạn video
    const segmentPaths: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i]!;
      const slideImg = slideImages[i] || slideImages[slideImages.length - 1]!;
      const slideAudioPath = path.join(workDir, `audio_slide_${i + 1}.mp3`);
      const segmentVideoPath = path.join(workDir, `segment_${i + 1}.mp4`);

      let spokenText = (s.speakerNotes || "").trim();
      if (!spokenText) {
        if (s.layout === "title" || i === 0) {
          spokenText = `Kính chào quý vị, xin mời quý vị theo dõi bài thuyết trình: ${s.title}. ${s.subtitle || ""}`;
        } else {
          spokenText = `${s.title}. ${s.takeaway || ""}. ${s.bullets ? s.bullets.join(". ") : ""}`;
        }
      }

      try {
        await synthesizeSingleAudio(spokenText, slideAudioPath, voiceHint, {
          stylePrompt: voiceStyle,
        });
      } catch (err) {
        await execFileAsync(ffmpegBin, [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=44100:cl=stereo",
          "-t",
          "3",
          "-q:a",
          "9",
          "-acodec",
          "libmp3lame",
          slideAudioPath,
        ]);
      }

      await createSlideVideoSegment(ffmpegBin, slideImg, slideAudioPath, segmentVideoPath);
      segmentPaths.push(segmentVideoPath);
    }

    // 4. Ghép toàn bộ phân đoạn thành file MP4 hoàn chỉnh
    ensureOutputDir();
    const finalVideoFileName = `${safeTitle}_${Date.now()}.mp4`;
    const finalVideoPath = path.join(GENERATED_FILES_DIR, finalVideoFileName);
    const concatListPath = path.join(workDir, "concat_list.txt");

    await concatenateVideoSegments(ffmpegBin, segmentPaths, concatListPath, finalVideoPath);
    const stats = fs.statSync(finalVideoPath);

    return {
      success: true,
      filePath: finalVideoPath,
      fileName: finalVideoFileName,
      fileSize: stats.size,
      pptxPath: pptxRes.filePath,
      isVideo: true,
    };
  } catch (err: any) {
    console.error("[presentation-video] renderPresentationVideoFromSlides error:", err);
    return {
      success: false,
      filePath: "",
      fileName: `${safeTitle}.mp4`,
      fileSize: 0,
      isVideo: true,
      message: String(err?.message || err),
    };
  } finally {
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

/**
 * Tìm đường dẫn thực thi của các công cụ nhị phân trên hệ thống (Linux / macOS)
 */
export function findSystemBinary(binName: string, candidatePaths: string[] = []): string | null {
  for (const c of candidatePaths) {
    if (fs.existsSync(c)) {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch {}
    }
  }

  try {
    const out = execSync(`which ${binName} 2>/dev/null`, { encoding: "utf8" }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch {}

  return null;
}

/**
 * Lên kế hoạch dàn bài thuyết trình và kịch bản thuyết minh (Speaker Notes) chi tiết qua Gemini
 */
export async function planPresentationWithGemini(
  userPrompt: string,
  quoteText = "",
  preferredTitle = "",
  preferredTheme?: ThemeName,
): Promise<PresentationPlan> {
  const combinedInput = [
    preferredTitle ? `TIÊU ĐỀ YÊU CẦU: ${preferredTitle}` : "",
    userPrompt ? `YÊU CẦU CỦA NGƯỜI DÙNG: ${userPrompt}` : "",
    quoteText ? `TÀI LIỆU / DỮ LIỆU ĐÍNH KÈM HOẶC TRÍCH DẪN:\n${quoteText}` : "",
  ].filter(Boolean).join("\n\n");

  const systemPrompt =
    `Bạn là Chuyên gia Cao cấp Thiết kế Slide Thuyết trình & Đạo diễn Video Presentation chuyên nghiệp.\n` +
    `NHIỆM VỤ: Hãy phân tích yêu cầu của người dùng để biên soạn một bộ slide thuyết trình hoàn chỉnh (từ 4 đến 8 slide) kèm KỊCH BẢN THUYẾT MINH DIỄN GIẢ (Speaker Notes) cực kỳ chuyên sâu và lôi cuốn.\n\n` +
    `QUY TẮC THIẾT KẾ SLIDE CHUẨN MỰC:\n` +
    `1. Slide 1 luôn là slide bìa (layout: 'title') với tiêu đề lớn, phụ đề và kicker ấn tượng.\n` +
    `2. Các slide nội dung phải lựa chọn layout thông minh, đa dạng (không được lặp lại 1 kiểu nhàm chán):\n` +
    `   - 'stats': Dành cho số liệu tài chính, thị trường, doanh số, các chỉ số đo lường ấn tượng (2-4 chỉ số).\n` +
    `   - 'timeline': Dành cho quy trình thực hiện, lộ trình các bước, giai đoạn phát triển (3-4 bước).\n` +
    `   - 'three_column' hoặc 'two_content': Dành cho so sánh, phân tích đa chiều hoặc 3 trụ cột chiến lược.\n` +
    `   - 'table': Dành cho bảng danh mục, kế hoạch chi tiết hoặc báo giá.\n` +
    `   - 'bullets': Dành cho danh sách luận điểm chính ngắn gọn (3-5 ý).\n` +
    `3. KICKER & TAKEAWAY:\n` +
    `   - Mỗi slide nên có 'kicker' (huy hiệu danh mục ngắn gọn 2-4 từ, ví dụ: 'TỔNG QUAN', 'CHIẾN LƯỢC', 'TĂNG TRƯỞNG').\n` +
    `   - Mỗi slide nên có 'takeaway' (câu đúc kết thông điệp cốt lõi ở chân trang).\n` +
    `4. ĐẶC BIỆT QUAN TRỌNG - SPEAKER NOTES (LỜI THOẠI DIỄN GIẢ):\n` +
    `   - Mỗi slide BẮT BUỘC PHẢI CÓ 'speakerNotes' dài từ 2 đến 5 câu (khoảng 30 - 80 từ).\n` +
    `   - Viết bằng văn phong nói tự nhiên, hào hứng, tự tin, diễn cảm của một diễn giả chuyên nghiệp.\n` +
    `   - Speaker Notes sẽ được chuyển trực tiếp thành giọng đọc AI Studio thuyết minh cho slide trong video!\n` +
    `5. CHỌN THEME MÀU SẮC PHÙ HỢP:\n` +
    `   - 'navy': Doanh nghiệp, quản trị, công nghệ\n` +
    `   - 'blue': Tài chính, ngân hàng, fintech, thương mại\n` +
    `   - 'green': Nông nghiệp, tăng trưởng, môi trường, y tế sinh thái\n` +
    `   - 'burgundy': Pháp lý, cảnh báo, an ninh, rượu vang, ẩm thực\n` +
    `   - 'slate': Kỹ thuật, xây dựng, kiến trúc, cơ sở hạ tầng\n` +
    `   - 'teal': Giáo dục, đào tạo, y tế, chăm sóc sức khỏe\n` +
    `   - 'emerald': Bất động sản cao cấp, sinh thái xanh, nghỉ dưỡng\n` +
    `   - 'luxury': Sang trọng, trang sức, VIP, dịch vụ thượng lưu\n\n` +
    `ĐỊNH DẠNG TRẢ VỀ: Trả về ĐÚNG 1 JSON Object hợp lệ (không kèm markdown ngoài block json):\n` +
    `{\n` +
    `  "title": "Tiêu đề bài thuyết trình",\n` +
    `  "theme": "navy",\n` +
    `  "voiceStyle": "Giọng đọc diễn thuyết truyền cảm, tự tin, tốc độ vừa phải",\n` +
    `  "slides": [\n` +
    `    {\n` +
    `      "layout": "title",\n` +
    `      "title": "...",\n` +
    `      "subtitle": "...",\n` +
    `      "kicker": "BÁO CÁO CHIẾN LƯỢC",\n` +
    `      "speakerNotes": "Kính chào quý vị, hôm nay tôi xin trân trọng giới thiệu..."\n` +
    `    },\n` +
    `    {\n` +
    `      "layout": "stats",\n` +
    `      "title": "...",\n` +
    `      "kicker": "CHỈ SỐ THEN CHỐT",\n` +
    `      "takeaway": "...",\n` +
    `      "stats": [ {"value": "...", "label": "...", "desc": "..."} ],\n` +
    `      "speakerNotes": "..."\n` +
    `    }\n` +
    `  ]\n` +
    `}`;

function cleanAndRepairPresentationJson(raw: string): any {
  if (!raw) return null;
  let s = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }

  try {
    return JSON.parse(s);
  } catch {}

  try {
    let repaired = s
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[}\]])/g, "$1")
      .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
      .replace(/,(\s*[}\]])/g, "$1");

    return JSON.parse(repaired);
  } catch {}

  return null;
}

function generateTopicSlideDeck(topic: string, title: string): SlideContent[] {
  const cleanTopic = topic.replace(/^(?:yêu cầu của người dùng:\s*|sen chúa\s*|tạo\s+file\s+|làm\s+video\s+)+/iu, "").trim();
  const effectiveTitle = title || cleanTopic || "Bài Thuyết Trình Chuyên Nghiệp";
  return [
    {
      layout: "title",
      title: effectiveTitle,
      subtitle: "Báo cáo tổng quan chi tiết và phương án thực thi",
      kicker: "TỔNG QUAN CHI TIẾT",
      speakerNotes: `Kính chào quý vị, hôm nay tôi xin trân trọng trình bày chi tiết về ${effectiveTitle}. Chúng ta sẽ cùng điểm qua các trọng tâm chiến lược và lộ trình thực thi ngay sau đây.`,
    },
    {
      layout: "three_column",
      title: "Trọng Tâm & Giá Trị Cốt Lõi",
      kicker: "GIÁ TRỊ NỀN TẢNG",
      takeaway: "Nắm vững 3 trụ cột để tối ưu hóa hiệu quả thực thi",
      col1Title: "Mục Tiêu",
      col1Bullets: ["Định vị phương hướng rõ ràng", "Đo lường theo cột mốc cụ thể"],
      col2Title: "Giải Pháp",
      col2Bullets: ["Quy trình chuẩn hóa", "Công nghệ tự động hiện đại"],
      col3Title: "Hiệu Quả",
      col3Bullets: ["Tối ưu hóa nguồn lực", "Tăng tốc độ triển khai"],
      speakerNotes: "Ở slide này, chúng ta phân tích 3 trụ cột giá trị then chốt: mục tiêu chuẩn xác, giải pháp thực thi bài bản và hiệu quả đo lường cụ thể cho toàn bộ kế hoạch.",
    },
    {
      layout: "timeline",
      title: "Lộ Trình Triển Khai Thực Hiện",
      kicker: "LỘ TRÌNH CHIẾN LƯỢC",
      takeaway: "Từng bước triển khai bài bản đảm bảo tiến độ và chất lượng",
      steps: [
        { number: 1, title: "Khảo Sát & Chuẩn Bị", desc: "Đánh giá hiện trạng, thu thập số liệu và hoàn thiện phương án sơ bộ." },
        { number: 2, title: "Triển Khai Cốt Lõi", desc: "Đẩy mạnh các hạng mục then chốt theo đúng tiến độ và tiêu chuẩn." },
        { number: 3, title: "Đo Lường & Hoàn Thiện", desc: "Nghiệm thu, đối soát các chỉ số cam kết và chuẩn hóa quy trình chuyển giao." },
      ],
      speakerNotes: "Về lộ trình thực hiện, dự án được chia làm 3 giai đoạn rõ rệt từ khâu chuẩn bị, triển khai cốt lõi đến giai đoạn đo lường nghiệm thu và bàn giao kết quả.",
    },
    {
      layout: "bullets",
      title: "Cam Kết & Định Hướng Tương Lai",
      kicker: "ĐỊNH HƯỚNG TƯƠNG LAI",
      takeaway: "Duy trì chất lượng cao nhất và sẵn sàng bứt phá",
      bullets: [
        "Kiểm soát chặt chẽ chất lượng và an toàn trên từng khâu thực thi.",
        "Đồng bộ hóa nguồn dữ liệu và báo cáo minh bạch theo thời gian thực.",
        "Tiếp tục mở rộng và nhân rộng mô hình trong các giai đoạn tiếp theo.",
      ],
      speakerNotes: "Để kết luận, việc bám sát các cam kết chất lượng và định hướng tương lai sẽ là chìa khóa giúp chúng ta bứt phá thành công rực rỡ.",
    },
  ];
}

  try {
    const rawJson = await callGeminiJson(systemPrompt, combinedInput, 4000);
    const parsed = cleanAndRepairPresentationJson(rawJson);

    if (parsed) {
      const title = parsed.title || preferredTitle || "Bài Thuyết Trình Chuyên Nghiệp";
      const theme = (preferredTheme || parsed.theme || "navy") as ThemeName;
      const parsedMd = parseMarkdownToSlides(combinedInput, title);
      const slides: SlideContent[] = Array.isArray(parsed.slides) && parsed.slides.length > 0
        ? parsed.slides
        : (parsedMd.length > 1 ? parsedMd : generateTopicSlideDeck(combinedInput, title));

      return {
        title,
        theme,
        voiceStyle: parsed.voiceStyle || "Phong cách thuyết trình tự tin, rõ ràng, truyền cảm hứng",
        slides,
      };
    }
  } catch (err) {
    console.warn("[presentation-video] Lỗi callGeminiJson, dùng bộ phân tích slide mặc định:", err);
  }

  const defaultTitle = preferredTitle || "Bài Thuyết Trình Chuyên Nghiệp";
  const slides = generateTopicSlideDeck(combinedInput, defaultTitle);
  return {
    title: defaultTitle,
    theme: preferredTheme || "navy",
    voiceStyle: "Phong cách thuyết trình tự tin, rõ ràng",
    slides,
  };
}

/**
 * Trình render Slide chuẩn Full HD 1080p (1920x1080) bằng Sharp SVG Engine
 * Đảm bảo 100% hoạt động độc lập và cho chất lượng hình ảnh sắc nét tuyệt đối.
 */
export async function renderSlideToImageWithSharp(
  slide: SlideContent,
  theme: ColorTheme,
  slideIndex: number,
  totalSlides: number,
  outputPath: string,
): Promise<void> {
  const width = 1920;
  const height = 1080;

  const escapeXml = (str = "") =>
    String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const primaryColor = `#${theme.primary}`;
  const accentColor = `#${theme.accent}`;
  const canvasBg = `#${theme.canvasBg}`;
  const cardBg = `#${theme.cardBg}`;
  const border = `#${theme.border}`;
  const darkText = `#${theme.darkText}`;
  const mutedText = `#${theme.mutedText}`;
  const kickerBg = `#${theme.bgLight}`;

  let innerElements = "";

  if (slide.layout === "title" || slideIndex === 0) {
    // Layout 1: Bìa thuyết trình hiện đại
    const safeTitle = escapeXml(slide.title || "Bài Thuyết Trình Chiến Lược");
    const safeSubtitle = escapeXml(slide.subtitle || "Tài liệu thuyết minh do AI Zalo Assistant tự động sản xuất");
    const safeKicker = escapeXml(slide.kicker || "BÁO CÁO THUYẾT TRÌNH");

    innerElements = `
      <!-- Vạch trang trí dọc -->
      <rect x="140" y="280" width="16" height="520" rx="8" fill="${accentColor}" />
      
      <!-- Kicker badge -->
      <rect x="180" y="280" width="280" height="50" rx="12" fill="${primaryColor}" />
      <text x="320" y="312" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${safeKicker}</text>

      <!-- Tiêu đề lớn -->
      <text x="180" y="440" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="${primaryColor}">${safeTitle}</text>
      
      <!-- Phụ đề -->
      <text x="180" y="540" font-family="Arial, sans-serif" font-size="32" fill="${mutedText}">${safeSubtitle}</text>

      <!-- Đường kẻ phân cách & Footer -->
      <line x1="180" y1="740" x2="1740" y2="740" stroke="${border}" stroke-width="2" />
      <text x="180" y="780" font-family="Arial, sans-serif" font-size="22" fill="${mutedText}">Zalo AI Assistant • Video Thuyết Trình AI Studio 1080p</text>
    `;
  } else {
    // Layout nội dung
    const safeTitle = escapeXml(slide.title || `Nội Dung ${slideIndex + 1}`);
    const safeKicker = escapeXml(slide.kicker || "THUYẾT TRÌNH");
    const safeTakeaway = escapeXml(slide.takeaway || "");

    const header = `
      <!-- Header -->
      <rect x="100" y="70" width="220" height="42" rx="10" fill="${kickerBg}" stroke="${border}" stroke-width="1.5" />
      <text x="210" y="96" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="${accentColor}" text-anchor="middle">${safeKicker}</text>
      <text x="100" y="165" font-family="Arial, sans-serif" font-size="44" font-weight="bold" fill="${primaryColor}">${safeTitle}</text>
      <rect x="100" y="195" width="260" height="6" rx="3" fill="${accentColor}" />
      <line x1="380" y1="198" x2="1820" y2="198" stroke="${border}" stroke-width="2" />
    `;

    let body = "";

    if (slide.layout === "stats" && slide.stats && slide.stats.length > 0) {
      const statsList = slide.stats.slice(0, 4);
      const n = statsList.length;
      const gap = 36;
      const cardW = (1720 - (n - 1) * gap) / n;

      body = statsList
        .map((st, i) => {
          const cx = 100 + i * (cardW + gap);
          return `
            <rect x="${cx}" y="280" width="${cardW}" height="560" rx="20" fill="${cardBg}" stroke="${border}" stroke-width="2" />
            <rect x="${cx}" y="280" width="${cardW}" height="14" rx="7" fill="${accentColor}" />
            <text x="${cx + cardW / 2}" y="480" font-family="Arial, sans-serif" font-size="56" font-weight="bold" fill="${accentColor}" text-anchor="middle">${escapeXml(st.value)}</text>
            <text x="${cx + cardW / 2}" y="560" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="${primaryColor}" text-anchor="middle">${escapeXml(st.label)}</text>
            ${st.desc ? `<text x="${cx + cardW / 2}" y="630" font-family="Arial, sans-serif" font-size="22" fill="${mutedText}" text-anchor="middle">${escapeXml(st.desc)}</text>` : ""}
          `;
        })
        .join("\n");
    } else if (slide.layout === "timeline" && slide.steps && slide.steps.length > 0) {
      const stepList = slide.steps.slice(0, 4);
      const n = stepList.length;
      const gap = 36;
      const cardW = (1720 - (n - 1) * gap) / n;

      body = stepList
        .map((st, i) => {
          const cx = 100 + i * (cardW + gap);
          return `
            <rect x="${cx}" y="280" width="${cardW}" height="560" rx="20" fill="${cardBg}" stroke="${border}" stroke-width="2" />
            <rect x="${cx + 30}" y="320" width="70" height="70" rx="16" fill="${primaryColor}" />
            <text x="${cx + 65}" y="365" font-family="Arial, sans-serif" font-size="30" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapeXml(String(st.number || i + 1).padStart(2, "0"))}</text>
            <text x="${cx + 30}" y="460" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="${primaryColor}">${escapeXml(st.title)}</text>
            <text x="${cx + 30}" y="520" font-family="Arial, sans-serif" font-size="22" fill="${darkText}">${escapeXml(st.desc)}</text>
          `;
        })
        .join("\n");
    } else if (slide.layout === "three_column" && (slide.col1Title || slide.col2Title || slide.col3Title)) {
      const cols = [
        { title: slide.col1Title || "Trọng tâm 1", bullets: slide.col1Bullets || [] },
        { title: slide.col2Title || "Trọng tâm 2", bullets: slide.col2Bullets || [] },
        { title: slide.col3Title || "Trọng tâm 3", bullets: slide.col3Bullets || [] },
      ];
      const gap = 36;
      const cardW = (1720 - 2 * gap) / 3;

      body = cols
        .map((col, i) => {
          const cx = 100 + i * (cardW + gap);
          const bulletsHtml = col.bullets
            .slice(0, 5)
            .map((b, bi) => `<text x="${cx + 35}" y="${400 + bi * 65}" font-family="Arial, sans-serif" font-size="22" fill="${darkText}">• ${escapeXml(b)}</text>`)
            .join("\n");
          return `
            <rect x="${cx}" y="280" width="${cardW}" height="560" rx="20" fill="${cardBg}" stroke="${border}" stroke-width="2" />
            <text x="${cx + 35}" y="345" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="${primaryColor}">${escapeXml(col.title)}</text>
            <line x1="${cx + 35}" y1="365" x2="${cx + cardW - 35}" y2="365" stroke="${border}" stroke-width="1.5" />
            ${bulletsHtml}
          `;
        })
        .join("\n");
    } else {
      // Bullets Card Layout
      const bullets = (slide.bullets || []).slice(0, 5);
      const cardH = 95;
      const gap = 20;

      body = bullets
        .map((b, bi) => {
          const cy = 270 + bi * (cardH + gap);
          return `
            <rect x="100" y="${cy}" width="1720" height="${cardH}" rx="16" fill="${cardBg}" stroke="${border}" stroke-width="2" />
            <rect x="130" y="${cy + 22}" width="50" height="50" rx="12" fill="${kickerBg}" stroke="${border}" stroke-width="1.5" />
            <text x="155" y="${cy + 55}" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="${accentColor}" text-anchor="middle">${String(bi + 1).padStart(2, "0")}</text>
            <text x="210" y="${cy + 55}" font-family="Arial, sans-serif" font-size="26" fill="${darkText}">${escapeXml(b)}</text>
          `;
        })
        .join("\n");
    }

    const footer = `
      ${safeTakeaway ? `
        <rect x="100" y="930" width="1720" height="65" rx="14" fill="${kickerBg}" stroke="${border}" stroke-width="1.5" />
        <text x="140" y="970" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="${darkText}">💡 ${safeTakeaway}</text>
      ` : ""}
      <text x="1820" y="1030" font-family="Arial, sans-serif" font-size="20" fill="${mutedText}" text-anchor="end">${slideIndex + 1} / ${totalSlides}</text>
    `;

    innerElements = `${header}\n${body}\n${footer}`;
  }

  const svgContent = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${canvasBg}" />
          <stop offset="100%" stop-color="#ffffff" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bgGrad)" />
      ${innerElements}
    </svg>
  `;

  await sharp(Buffer.from(svgContent)).png({ quality: 95 }).toFile(outputPath);
}

/**
 * Chuyển đổi file trình chiếu thành các file ảnh PNG sắc nét (1080p).
 * Ưu tiên dùng LibreOffice + pdftoppm nếu có; fallback sang Sharp SVG Engine nếu thiếu CLI.
 */
export async function convertPptxToSlideImages(
  pptxPath: string,
  workDir: string,
  slides: SlideContent[],
  theme: ColorTheme,
): Promise<string[]> {
  const sofficeBin = findSystemBinary("soffice", [
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ]);
  const pdftoppmBin = findSystemBinary("pdftoppm", [
    "/usr/bin/pdftoppm",
    "/usr/local/bin/pdftoppm",
    "/opt/homebrew/bin/pdftoppm",
  ]);

  if (sofficeBin && pdftoppmBin && fs.existsSync(pptxPath)) {
    try {
      console.log(`[presentation-video] 📄 Đang xuất PDF từ PPTX bằng ${sofficeBin}...`);
      await execFileAsync(sofficeBin, ["--headless", "--convert-to", "pdf", "--outdir", workDir, pptxPath]);

      const baseName = path.basename(pptxPath, path.extname(pptxPath));
      const pdfPath = path.join(workDir, `${baseName}.pdf`);

      if (fs.existsSync(pdfPath)) {
        console.log(`[presentation-video] 🖼️ Đang xuất PNG 150 DPI từ PDF bằng ${pdftoppmBin}...`);
        const slidePrefix = path.join(workDir, "slide");
        await execFileAsync(pdftoppmBin, ["-png", "-r", "150", pdfPath, slidePrefix]);

        const generatedFiles = fs
          .readdirSync(workDir)
          .filter((f) => f.startsWith("slide-") && f.endsWith(".png"))
          .sort((a, b) => {
            const na = parseInt(a.replace(/slide-0*|\.png/g, ""), 10) || 0;
            const nb = parseInt(b.replace(/slide-0*|\.png/g, ""), 10) || 0;
            return na - nb;
          })
          .map((f) => path.join(workDir, f));

        if (generatedFiles.length > 0) {
          console.log(`[presentation-video] ✅ Đã xuất thành công ${generatedFiles.length} ảnh slide từ LibreOffice.`);
          return generatedFiles;
        }
      }
    } catch (e: any) {
      console.warn("[presentation-video] Chuyển đổi qua LibreOffice/pdftoppm gặp lỗi, chuyển sang Sharp Engine:", e?.message || e);
    }
  }

  // Fallback: Sử dụng Sharp SVG Engine chất lượng cao
  console.log(`[presentation-video] 🎨 Đang tạo ${slides.length} ảnh slide 1080p bằng Sharp SVG Engine...`);
  const imagePaths: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]!;
    const outImg = path.join(workDir, `sharp_slide_${String(i + 1).padStart(2, "0")}.png`);
    await renderSlideToImageWithSharp(s, theme, i, slides.length, outImg);
    imagePaths.push(outImg);
  }

  return imagePaths;
}

/**
 * Tạo một phân đoạn video (video segment) từ 1 ảnh slide và 1 file âm thanh qua ffmpeg
 */
export async function createSlideVideoSegment(
  ffmpegBin: string,
  imagePath: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  const args = [
    "-y",
    "-loop",
    "1",
    "-i",
    imagePath,
    "-i",
    audioPath,
    "-af",
    "apad=pad_dur=0.8",
    "-c:v",
    "libx264",
    "-tune",
    "stillimage",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    "-r",
    "30",
    "-shortest",
    outputPath,
  ];

  await execFileAsync(ffmpegBin, args);
}

/**
 * Nối các phân đoạn video thành 1 video trình chiếu MP4 hoàn chỉnh
 */
export async function concatenateVideoSegments(
  ffmpegBin: string,
  segmentPaths: string[],
  concatListPath: string,
  finalOutputPath: string,
): Promise<void> {
  const fileLines = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  fs.writeFileSync(concatListPath, fileLines, "utf8");

  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    finalOutputPath,
  ];

  await execFileAsync(ffmpegBin, args);
}

/**
 * Worker chính: Xử lý trọn gói tác vụ tạo video bài thuyết trình kèm giọng đọc AI Studio
 */
export async function runPresentationVideoJob(options: PresentationVideoJobOptions): Promise<void> {
  const { api, sender, isGroup, threadId, userGreeting, userPrompt, quoteText, voiceHint } = options;

  const sendReplyText = async (msg: string) => {
    try {
      if (isGroup && threadId) {
        await sendGroupText(api, threadId, msg);
      } else {
        await sendDirectText(api, sender, msg);
      }
    } catch (e) {
      console.warn("[presentation-video] Lỗi gửi text:", e);
    }
  };

  const sendReplyFile = async (filePath: string, caption = "") => {
    try {
      if (isGroup && threadId) {
        await sendGroupFile(api, threadId, filePath, caption);
      } else {
        await sendDirectFile(api, sender, filePath, caption);
      }
    } catch (e) {
      console.warn("[presentation-video] Lỗi gửi file:", e);
    }
  };

  const currentThreadKey = threadId || sender;
  const jobId = `pres_job_${Date.now()}`;
  const workDir = path.join("/tmp", jobId);
  fs.mkdirSync(workDir, { recursive: true });

  const abortController = new AbortController();
  registerRenderJob({
    jobId,
    threadId: currentThreadKey,
    userId: sender,
    type: "presentation_video",
    title: userPrompt.slice(0, 60),
    abortController,
    cancelled: false,
    startTime: Date.now(),
  });

  const ffmpegBin = findSystemBinary("ffmpeg", [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
  ]);

  if (!ffmpegBin) {
    unregisterRenderJob(currentThreadKey, jobId);
    await sendReplyText(
      `⚠️ Dạ ${userGreeting} ơi, hệ thống máy chủ hiện chưa tìm thấy công cụ FFmpeg để dựng video MP4.\n` +
      `👉 Kính nhờ Admin kiểm tra cài đặt FFmpeg trên máy chủ giúp em nhé! ☘️`,
    );
    return;
  }

  try {
    // 1. Phản hồi nhận việc ngay lập tức để không làm gián đoạn hội thoại
    await sendReplyText(
      `🎬 Dạ ${userGreeting} ơi, bot đã tiếp nhận yêu cầu sản xuất **Video thuyết trình chuyên nghiệp kèm giọng đọc AI Studio**!\n\n` +
      `⚡ **Quy trình tự động gồm 4 giai đoạn**:\n` +
      `1️⃣ Biên soạn nội dung & kịch bản thuyết minh chi tiết từng slide (Speaker Notes)\n` +
      `2️⃣ Thiết kế bộ slide chuẩn 16:9 hiện đại & chuyển đổi sang khung hình 1080p sắc nét\n` +
      `3️⃣ Tạo giọng đọc thuyết minh diễn cảm theo từng slide (Google AI Studio TTS)\n` +
      `4️⃣ Dựng & đồng bộ hình ảnh + âm thanh xuất video MP4 và file PowerPoint (.pptx) gốc\n\n` +
      `⏳ Tiến trình đang chạy tự động trong nền (không làm gián đoạn trò chuyện). Khi xong bot sẽ gửi cả Video và Slide ngay tại đây cho ${userGreeting} nhé! ☘️`,
    );

    // 2. Lên dàn bài chi tiết & Speaker Notes với Gemini
    console.log(`[presentation-video] 🧠 Đang biên soạn dàn bài slide & speaker notes với Gemini...`);
    const plan = await planPresentationWithGemini(userPrompt, quoteText, options.title, options.theme);
    const theme = getTheme(plan.theme);
    const safeTitle = plan.title.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/giu, "_").slice(0, 60) || "Video_Thuyet_Trinh";

    console.log(`[presentation-video] 📊 Đã hoàn tất kế hoạch: ${plan.slides.length} slides, chủ đề: "${plan.title}" (theme: ${plan.theme})`);

    // 3. Tạo file PowerPoint (.pptx) gốc có chứa Speaker Notes
    console.log(`[presentation-video] 📝 Đang xuất file PowerPoint (.pptx)...`);
    const pptxRes = await generatePowerPointFile(safeTitle, plan.title, plan.slides, plan.theme);

    // 4. Chuyển đổi slide sang danh sách ảnh 1080p
    console.log(`[presentation-video] 🖼️ Đang chuyển đổi các slide sang hình ảnh 1080p...`);
    const slideImages = await convertPptxToSlideImages(pptxRes.filePath, workDir, plan.slides, theme);

    if (slideImages.length === 0) {
      throw new Error("Không thể trích xuất hình ảnh slide để làm video.");
    }

    // 5. Thu âm giọng đọc AI Studio theo từng slide & dựng từng phân đoạn video
    const segmentPaths: string[] = [];

    for (let i = 0; i < plan.slides.length; i++) {
      const s = plan.slides[i]!;
      const slideImg = slideImages[i] || slideImages[slideImages.length - 1]!;
      const slideAudioPath = path.join(workDir, `audio_slide_${i + 1}.mp3`);
      const segmentVideoPath = path.join(workDir, `segment_${i + 1}.mp4`);

      // Nội dung thuyết minh của slide
      let spokenText = (s.speakerNotes || "").trim();
      if (!spokenText) {
        if (s.layout === "title" || i === 0) {
          spokenText = `Kính chào quý vị, xin mời quý vị theo dõi bài thuyết trình: ${s.title}. ${s.subtitle || ""}`;
        } else {
          spokenText = `${s.title}. ${s.takeaway || ""}. ${s.bullets ? s.bullets.join(". ") : ""}`;
        }
      }

      console.log(`[presentation-video] 🎙️ Slide [${i + 1}/${plan.slides.length}]: Đang tạo giọng đọc (${spokenText.length} ký tự)...`);
      try {
        await synthesizeSingleAudio(spokenText, slideAudioPath, voiceHint, {
          stylePrompt: plan.voiceStyle,
        });
      } catch (err) {
        console.warn(`[presentation-video] Lỗi tạo audio cho slide ${i + 1}, fallback tạo khoảng lặng:`, err);
        // Fallback: 3 giây tĩnh nếu audio lỗi
        await execFileAsync(ffmpegBin, [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=44100:cl=stereo",
          "-t",
          "3",
          "-q:a",
          "9",
          "-acodec",
          "libmp3lame",
          slideAudioPath,
        ]);
      }

      console.log(`[presentation-video] 🎞️ Slide [${i + 1}/${plan.slides.length}]: Đang dựng phân đoạn video...`);
      await createSlideVideoSegment(ffmpegBin, slideImg, slideAudioPath, segmentVideoPath);
      segmentPaths.push(segmentVideoPath);
    }

    // 6. Ghép toàn bộ phân đoạn thành file MP4 hoàn chỉnh
    ensureOutputDir();
    const finalVideoFileName = `${safeTitle}_${Date.now()}.mp4`;
    const finalVideoPath = path.join(GENERATED_FILES_DIR, finalVideoFileName);
    const concatListPath = path.join(workDir, "concat_list.txt");

    console.log(`[presentation-video] 🎬 Đang ghép ${segmentPaths.length} phân đoạn thành video tổng thể: ${finalVideoFileName}...`);
    await concatenateVideoSegments(ffmpegBin, segmentPaths, concatListPath, finalVideoPath);

    const curJob = getActiveRenderJob(currentThreadKey);
    if (!curJob || curJob.cancelled || abortController.signal.aborted) {
      console.log(`[presentation-video] 🛑 Job render cho thread [${currentThreadKey}] đã bị hủy bởi người dùng. Không gửi file.`);
      try {
        if (fs.existsSync(finalVideoPath)) fs.unlinkSync(finalVideoPath);
      } catch {}
      return;
    }

    // 7. Gửi trả video và file PowerPoint cho người dùng trên Zalo
    console.log(`[presentation-video] 📤 Đang gửi video MP4 lên Zalo...`);
    await sendReplyFile(
      finalVideoPath,
      `🎬 Em gửi ${userGreeting} Video thuyết trình [${plan.title}] kèm giọng đọc AI Studio chuẩn 1080p Full HD!`,
    );

    if (pptxRes.success && pptxRes.filePath && fs.existsSync(pptxRes.filePath)) {
      console.log(`[presentation-video] 📤 Đang gửi file PowerPoint (.pptx) lên Zalo...`);
      await sendReplyFile(
        pptxRes.filePath,
        `📊 Em gửi kèm file PowerPoint (.pptx) gốc có đầy đủ Speaker Notes (ghi chú thuyết minh) để ${userGreeting} tiện chỉnh sửa slide và lời thoại nhé!`,
      );
    }

    // 8. Tin nhắn tổng kết hoàn thành
    await sendReplyText(
      `🎉 **ĐÃ HOÀN TẤT XUẤT BẢN VIDEO THUYẾT TRÌNH (${plan.slides.length} SLIDES)!**\n\n` +
      `✅ Định dạng: Video MP4 Full HD 1080p (1920x1080) & PowerPoint (.pptx)\n` +
      `✅ Giọng đọc: Google AI Studio TTS truyền cảm, đồng bộ khớp từng trang slide\n` +
      `✅ Kèm sẵn Speaker Notes trong slide để ${userGreeting} chủ động tập thuyết trình hoặc chỉnh sửa\n` +
      `☘️ Kính chúc ${userGreeting} có buổi thuyết trình/báo cáo thật thành công và ấn tượng ạ!`,
    );
  } catch (err: any) {
    if (abortController.signal.aborted || err?.name === "AbortError") {
      console.log(`[presentation-video] 🛑 Job render cho thread [${currentThreadKey}] đã dừng an toàn do lệnh hủy của người dùng.`);
      return;
    }
    console.error("[presentation-video] ❌ Lỗi xử lý job tạo video thuyết trình:", err);
    await sendReplyText(
      `⚠️ Dạ ${userGreeting} ơi, quá trình dựng video gặp sự cố kỹ thuật với bộ mã hóa đa phương tiện. Bot đã ghi nhận lỗi vào hệ thống để kỹ thuật viên kiểm tra xử lý ngay ạ!`,
    );
  } finally {
    unregisterRenderJob(currentThreadKey, jobId);
    // Dọn dẹp thư mục tạm
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

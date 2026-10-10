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
  Math as DocxMath,
  MathRun,
  MathFraction,
  MathRadical,
  MathSuperScript,
  MathSubScript,
  MathSubSuperScript,
  MathPreSubSuperScript,
} from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import { checkIsMusicRequest } from "./music-generator.js";
import { getPPTMasterConfig, renderPPTMasterPresentation } from "./pptmaster-bridge.js";
import { cleanLatexMathToUnicode } from "../utils/latex-cleaner.js";

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
/**
 * Kiểm tra xem người dùng có yêu cầu xuất giọng đọc / voice / podcast / ngâm thơ / đọc diễn cảm không
 */
export function checkIsVoiceRequest(question: string, quoteText = ""): boolean {
  const qLower = (question || "").toLowerCase().trim();
  const quoteLower = (quoteText || "").toLowerCase().trim();

  // Bỏ qua nếu là câu chất vấn, phàn nàn ngược hoặc từ chối tạo file/voice
  if (
    /(?:sao|tại\s*sao|sao\s*lại)\s+.*?(?:gửi|đóng\s*gói|xuất|tạo|làm|sinh|soạn|vẽ|thu\s*âm|ghi\s*âm|phát\s+voice|voice|audio|làm\s*gì|chi\s*vậy|thế|hả|à)/iu.test(qLower) ||
    /(?:không\s+yêu\s*cầu|ko\s+yêu\s*cầu|chưa\s+yêu\s*cầu|tự\s*nhiên\s+(?:gửi|xuất|tạo|làm|phát|thu)|ai\s+mượn|ai\s+bắt|ai\s+khiến|đâu\s+có\s+(?:bảo|kêu|nhờ|yêu\s*cầu))/iu.test(qLower) ||
    /(?:đừng|không\s*cần|ko\s*cần|chưa\s*cần|thôi|hủy|bỏ\s*qua)\s+(?:tạo|làm|xuất|soạn|vẽ|sinh|gửi|đóng\s*gói|thu\s*âm|ghi\s*âm|phát\s+voice|voice|audio)/iu.test(qLower) ||
    /^(?:không\s+cần|ko\s+cần|thôi|hủy)\s+(?:voice|giọng\s*đọc|audio)\b/iu.test(qLower)
  ) {
    return false;
  }

  // Bỏ qua nếu chỉ là câu hỏi thăm dò năng lực thuần túy
  if (
    /^(?:em|bot|mày|bác)?\s*(?:có\s+)?(?:biết|làm|tạo|thu)?\s*(?:được|đc|duoc)?(?:\s+(?:thu|làm|tạo))?\s+(?:voice|âm\s*thanh|giọng\s*đọc)\s*(?:không|ko)?\s*(?:hả|nhỉ|hở|ạ|không|ko)\s*[?]?$/i.test(
      qLower,
    )
  ) {
    return false;
  }

  // Bỏ qua nếu câu hỏi của người dùng là câu hỏi thăm dò/kỹ thuật/thắc mắc về cấu hình, cách làm, địa điểm
  const isHypotheticalOrInquiry =
    /(?:có\s+(?:khó|dễ|nhanh|lâu|được|đc|tốn|mất)\s*(?:không|ko|chăng|hả|hở|nhỉ|ạ)|(?:^|[^\p{L}\p{N}])(?:bằng\s+cách\s+nào|như\s+thế\s+nào|làm\s+sao|app\s+gì|phần\s+mềm\s+gì|tool\s+gì|trang\s+web\s+nào|web\s+gì|công\s+cụ\s+gì|ở\s+đâu|cấu\s+hình)(?=$|[^\p{L}\p{N}]))/iu.test(
      qLower,
    );
  if (
    isHypotheticalOrInquiry &&
    !/(?:hãy|giúp|cho\s*mình|cho\s*anh|cho\s*em|ngay|luôn|đọc\s+đi|phát\s+đi)\b/iu.test(qLower)
  ) {
    return false;
  }

  // 1. Ý định trực tiếp trong câu hỏi của người dùng (qLower)
  const isDirectSpeechOrVoice =
    /(?:đọc|ngâm)\s+diễn\s*cảm/iu.test(qLower) ||
    /(?:đọc|ngâm)\s+(?:giúp|hộ|cho\s+[^\s,!?]+\s+)?(?:bài\s+)?thơ/iu.test(qLower) ||
    /(?:đọc|nói|phát|kể|ngâm)\s+(?:cho\s+)?(?:[\p{L}\s]+)?\s*nghe/iu.test(qLower) ||
    /(?:bận|đang\s+lái\s+xe|không\s+tiện\s+đọc)\s*[,.]*\s*(?:đọc|phát|nói|voice|audio)/iu.test(qLower) ||
    /(?:chuyển|phát|đọc|đổi|bật)\s+(?:thành|ra|sang|qua)?\s*(?:giọng|tiếng|âm\s*thanh|lời\s*nói|voice|audio|podcast)/iu.test(qLower) ||
    /(?:thu\s*âm|ghi\s*âm|ngâm\s*thơ)\s+(?:bài|thơ|văn|đoạn|kịch|nội\s*dung|cho)/iu.test(qLower) ||
    /\b(?:thu\s*âm|ghi\s*âm)\s+(?:đi|giúp|hộ|cho|nào)/iu.test(qLower) ||
    /^(?:thu\s*âm|ghi\s*âm)\b/iu.test(qLower) ||
    /\b(?:voice\s*bubble|bong\s*bóng\s*thoại)\b/iu.test(qLower) ||
    /(?:thuyết\s*minh|lồng\s*tiếng)\s+(?:cho|giúp|hộ|bài|video|đoạn|phim|clip|vào|đi)/iu.test(qLower) ||
    /^(?:thuyết\s*minh|lồng\s*tiếng)\b/iu.test(qLower);

  const isDirectDialogueOrPodcast =
    /(?:kịch\s*bản|đối\s*thoại|hội\s*thoại|trò\s*chuyện|cuộc\s*nói\s*chuyện|thảo\s*luận|podcast)\s+(?:giữa\s+)?2\s*(?:người|bạn|nhân\s*vật|mc)/iu.test(qLower) ||
    /2\s*(?:người|bạn|nhân\s*vật|mc)\s+(?:nói\s*chuyện|đối\s*thoại|trò\s*chuyện|thảo\s*luận|đối\s*đáp|tâm\s*sự)/iu.test(qLower) ||
    /(?:làm|tạo|soạn|phát|chuyển)\s+(?:thành\s+)?(?:podcast|đối\s*thoại|hội\s*thoại|talkshow)/iu.test(qLower);

  if (isDirectSpeechOrVoice || isDirectDialogueOrPodcast) return true;

  // 2. Nếu có tin nhắn trích dẫn (quoteText):
  if (quoteLower) {
    // 2A. Người dùng ra lệnh đọc/thu âm/phát nội dung trong quote:
    const isCommandOnQuote =
      /(?:đọc|ngâm|phát|thu\s*âm|ghi\s*âm|lồng\s*tiếng|thuyết\s*minh)\s+(?:bài|đoạn|cái|nội\s*dung|file|video|clip)?\s*(?:này|trên|đó|hộ|giúp|cho|đi|nghe)/iu.test(qLower) ||
      /(?:cho\s+)?(?:[\p{L}\s]+)?\s*nghe\s+(?:thử|với|nào|đi)/iu.test(qLower) ||
      /^(?:đọc|ngâm|phát|thu\s*âm|lồng\s*tiếng)\s+(?:đi|hộ|giúp|nào)[!.]*$/iu.test(qLower);

    if (isCommandOnQuote) return true;

    // 2B. Tin nhắn quote là lời mời/gợi ý gửi voice từ bot VÀ người dùng đồng ý/xác nhận
    const isQuotingVoiceProposal =
      /(?:đọc\s+diễn\s*cảm|thu\s*âm\s+giọng\s*đọc|gửi\s+bản\s+đọc|phát\s+voice|nghe\s+thử\s+voice|ngâm\s+thơ)/iu.test(quoteLower);
    const isAffirmation =
      /(?:ok|oke|ừ|uh|u|dạ|vâng|được|triển|làm\s*đi|gửi\s*đi|cho\s*(?:mình|anh|em)\s*nghe|nghe\s*thử)/iu.test(qLower);

    if (isQuotingVoiceProposal && isAffirmation) return true;
  }

  return false;
}

/**
 * Nhận diện ý định tạo ảnh, vẽ tranh, sửa ảnh hoặc xác nhận vẽ ảnh từ tin nhắn trích dẫn (quote).
 */
export function isImageRequest(question: string, quoteText = ""): boolean {
  const qLower = (question || "").toLowerCase().trim();
  const quoteLower = (quoteText || "").toLowerCase().trim();

  // Bỏ qua nếu là câu hỏi thăm dò/kỹ thuật/phàn nàn
  if (/(?:sao|tại\s*sao)\s+.*?(?:vẽ|tạo|sinh)\s+ảnh/iu.test(qLower)) return false;
  if (/^(?:em|bot|mày|bác)?\s*(?:có\s+)?(?:biết|làm|tạo|vẽ)?\s*(?:được|đc|duoc)?(?:\s+(?:vẽ|tạo))?\s+ảnh\s*(?:không|ko)?\s*[?]?$/iu.test(qLower)) return false;

  const directImage =
    /(?:vẽ|ve|tạo|tao|thiết\s*kế|thiet\s*ke|sinh|chỉnh\s*sửa|chinh\s*sua|sửa|edit|làm\s*nét|biến\s*đổi)\s+(?:lại\s+)?(?:cho\s+.*?\s+)?(?:ảnh|hình|bức\s*ảnh|tấm\s*ảnh|tranh|poster|avatar|chân\s*dung|banner)/iu.test(qLower) ||
    /^[/!](?:taoanh|veanh|draw|suaanh|chinhanh|chinhsuaanh|editanh|editimage|modifyimage|imagine|image)\b/iu.test(qLower) ||
    /(?:dựa\s+(?:vào|theo)|theo)\s+(?:prompt|câu\s*lệnh|ý\s*tưởng|mô\s*tả)\s+.*?(?:vẽ|tạo|ảnh)/iu.test(qLower);

  if (directImage) return true;

  // Nếu có quoteText liên quan đến ảnh (yêu cầu vẽ ảnh, lời hứa hẹn tạo ảnh của bot, hoặc prompt ảnh)
  if (quoteLower) {
    const quoteHasImage = /(?:vẽ|tạo|xuất|sinh|trả|sửa)\s+(?:ảnh|hình|tranh|poster)|(?:bức|tấm)\s+ảnh|hệ\s*thống\s*codex|worker\s+kết\s*xuất|gemini.*?image|tool\s+tạo\s*ảnh/iu.test(quoteLower);
    const isAffirmationOrRework =
      /(?:^|[^\p{L}\p{N}])(?:ok(?:ela|ay|e)?|okie|ừ|uh|da|dạ|vâng|được|dc|triển|chốt|tiến\s*hành)(?=$|[^\p{L}\p{N}])/iu.test(qLower) ||
      /(?:vẽ|tạo|làm|sinh|sửa|chỉnh)\s*(?:lại|tiếp|luôn|ngay|đi|hộ|giúp)/iu.test(qLower);

    if (quoteHasImage && isAffirmationOrRework) return true;
  }

  return false;
}

/**
 * Nhận diện ý định tạo/dựng video AI hoặc biến ảnh thành video (Image-to-Video)
 */
export function checkIsVideoRequest(question: string, quoteText = ""): boolean {
  const qLower = (question || "").toLowerCase().trim();
  const quoteLower = (quoteText || "").toLowerCase().trim();

  // Bỏ qua nếu là câu hỏi thăm dò/kỹ thuật/phàn nàn hoặc yêu cầu tải/download video từ link bên ngoài
  if (/(?:tải|download|link|xem)\s+video/iu.test(qLower)) return false;
  if (/(?:sao|tại\s*sao)\s+.*?(?:tạo|làm|sinh|dựng)\s+video/iu.test(qLower)) return false;
  if (/(?:không\s+yêu\s*cầu|ko\s+yêu\s*cầu|đừng|không\s*cần|ko\s*cần|chưa\s*cần|ai\s+mượn)\s+.*?(?:tạo|làm|sinh|dựng|video)/iu.test(qLower)) return false;
  if (/^(?:em|bot|mày|bác)?\s*(?:có\s+)?(?:biết|làm|tạo)?\s*(?:được|đc|duoc)?(?:\s+(?:tạo|làm))?\s+video\s*(?:không|ko)?\s*[?]?$/iu.test(qLower)) return false;

  // Bỏ qua nếu là câu hỏi tra cứu công cụ / repo / thư viện
  const isResourceOrToolInquiry =
    /(?:có\s+(?:repo|mã\s*nguồn|thư\s*viện|tool|công\s*cụ|app|ứng\s*dụng|phần\s*mềm|web|site|kênh|hệ\s*thống|cách|phương\s*pháp|ai)\s+(?:nào|gì)|hướng\s*dẫn\s+cách|làm\s*sao\s+để|xin\s+(?:repo|tool|link)|chia\s*sẻ\s+(?:repo|tool|phần\s*mềm))/iu.test(
      qLower,
    );
  if (isResourceOrToolInquiry) return false;

  const directVideo =
    /(?:tạo|tao|làm|lam|sinh|dựng|dung|xuất|xuat|generate|make)\s+(?:cho\s+.*?\s+)?(?:video|clip|thước\s*phim)\s*(?:ai|ngắn)?/iu.test(qLower) ||
    /(?:biến|chuyển|làm)\s+(?:ảnh|hình|tấm\s*ảnh|bức\s*ảnh)\s+(?:này|trên|đó)?\s*(?:thành|thanh)\s+video/iu.test(qLower) ||
    /^[/!](?:taovideo|makevideo|videoai|genvideo|t2v|i2v)\b/iu.test(qLower);

  if (directVideo) return true;

  if (quoteLower) {
    const isQuestionInquiry = /[?？]$/.test(qLower.trim()) || /(?:như\s*thế\s*nào|ra\s*sao|là\s*gì|ngôn\s*ngữ\s*gì|ở\s*đâu|bao\s*nhiêu|cấu\s*hình\s*máy)/iu.test(qLower);
    if (!isQuestionInquiry) {
      const quoteHasVideo = /(?:tạo|làm|sinh|dựng|xuất)\s+(?:video|clip|thước\s*phim)|(?:video|clip)\s+(?:ai|ngắn|hoàn\s*tất|đã\s*tạo|theo\s*yêu\s*cầu)|muse.*?video/iu.test(quoteLower);
      const isAffirmation =
        /(?:^|[^\p{L}\p{N}])(?:ok(?:ela|ay|e)?|okie|ừ|uh|da|dạ|vâng|được|dc|triển|chốt|tiến\s*hành)(?=$|[^\p{L}\p{N}])/iu.test(qLower) ||
        /(?:tạo|làm|dựng|sinh)\s*(?:lại|tiếp|luôn|ngay|đi|hộ|giúp)/iu.test(qLower);
      if (quoteHasVideo && isAffirmation) return true;
    }
  }

  return false;
}

export function checkIsFileOrVoiceGeneration(question: string, quoteText = ""): boolean {
  const qLower = (question || "").toLowerCase().trim();
  const quoteLower = (quoteText || "").toLowerCase().trim();

  // 1. Chặn tuyệt đối các câu chất vấn, phàn nàn ngược ("sao gửi file word/excel/voice làm gì", "không yêu cầu", "ai mượn")
  const isNegativeOrComplaint =
    /(?:sao|tại\s*sao|sao\s*lại)\s+.*?(?:gửi|đóng\s*gói|xuất|tạo|làm|sinh|soạn|vẽ|thu\s*âm|ghi\s*âm|phát|file|word|excel|slide|voice|nhạc|ảnh|video|clip|làm\s*gì|chi\s*vậy|thế|hả|à)/iu.test(qLower) ||
    /(?:không\s+yêu\s*cầu|ko\s+yêu\s*cầu|chưa\s+yêu\s*cầu|tự\s*nhiên\s+(?:gửi|xuất|tạo|làm|sinh)|ai\s+mượn|ai\s+bắt|ai\s+khiến|đâu\s+có\s+(?:bảo|kêu|nhờ|yêu\s*cầu))/iu.test(qLower) ||
    /(?:đừng|không\s*cần|ko\s*cần|chưa\s*cần|thôi|hủy|bỏ\s*qua)\s+(?:tạo|làm|xuất|soạn|vẽ|sinh|gửi|đóng\s*gói|thu\s*âm|ghi\s*âm|phát\s+voice)/iu.test(qLower) ||
    /^(?:không\s+cần|ko\s+cần|thôi|hủy)\s+(?:file|slide|word|excel|voice|nhạc|ảnh|video|clip)\b/iu.test(qLower);

  if (isNegativeOrComplaint) {
    return false;
  }

  // 1.5. Chặn câu hỏi tra cứu công cụ / repo / thư viện / phần mềm / mô hình / hướng dẫn cách làm
  const isResourceOrToolInquiry =
    /(?:(?:có|các|những|danh\s*sách|top|gợi\s*ý|chia\s*sẻ|tổng\s*hợp)\s+.*?(?:repo|mã\s*nguồn|thư\s*viện|tool|công\s*cụ|app|ứng\s*dụng|phần\s*mềm|web|site|kênh|hệ\s*thống|mô\s*hình|model|ai)\b|hướng\s*dẫn\s+cách|làm\s*sao\s+để|xin\s+(?:repo|tool|link)|chia\s*sẻ\s+(?:repo|tool|phần\s*mềm))/iu.test(
      qLower,
    );
  if (isResourceOrToolInquiry) {
    return false;
  }

  // 1.5.1. Chặn tuyệt đối câu hỏi thao tác giao diện, chuột, phần mềm, kéo/dịch chuyển biểu đồ MT4/MT5/TradingView/Excel
  const isSoftwareUiInteraction =
    /(?:dịch\s*chuyển|kéo|cuộn|scroll|drag|phóng\s*to|thu\s*nhỏ|zoom|xem|bấm|click|chỉnh\s*(?:màu|trục|nến)|khóa|mở\s*khóa|qua\s*trái|qua\s*phải|lên\s*xuống)\s+.*?(?:biểu\s*đồ|đồ\s*thị|chart|nến)/iu.test(qLower) ||
    /(?:trên|ở|trong)\s+(?:mt4|mt5|metatrader|trading\s*view|tradingview|excel|bảng\s*giá).*?(?:biểu\s*đồ|đồ\s*thị|chart)/iu.test(qLower) ||
    /(?:biểu\s*đồ|đồ\s*thị|chart).*?(?:trên|ở|trong)\s+(?:mt4|mt5|metatrader|trading\s*view|tradingview)/iu.test(qLower);
  if (isSoftwareUiInteraction) {
    return false;
  }

  // 1.6. Chặn tuyệt đối câu hỏi tra cứu, tìm kiếm, đọc hiểu, hỏi đáp thông tin (kể cả khi quote có từ file/pdf/sách)
  const isInformationOrSearchInquiry =
    /(?:^|[^\p{L}\p{N}])(?:tìm|tra\s*cứu|tìm\s*kiếm|kiếm|hỏi|cho\s*hỏi|sách\s*này|cuốn\s*này|tác\s*giả|nội\s*dung\s*(?:là|gì)|bản\s*dịch|dịch\s*thuật|giải\s*thích|tóm\s*tắt\s*(?:nội\s*dung|ý\s*chính)?|review|đánh\s*giá)(?=$|[^\p{L}\p{N}])/iu.test(qLower) &&
    !/(?:xuất|tạo|làm|soạn|in|đóng\s*gói)\s+(?:thành\s+)?(?:file|bản|tệp|word|excel|slide|pdf)/iu.test(qLower);
  if (isInformationOrSearchInquiry) {
    return false;
  }

  // 2. Kiểm tra image request (trực tiếp hoặc quote xác nhận tạo ảnh)
  if (isImageRequest(question, quoteText)) return true;

  // 3. Kiểm tra video request (trực tiếp hoặc quote xác nhận tạo video)
  if (checkIsVideoRequest(question, quoteText)) return true;

  // 4. Kiểm tra voice request (chỉ khi không bị chặn bởi complaint)
  if (checkIsVoiceRequest(question, quoteText)) return true;

  // 5. Kiểm tra music request: chỉ khi người dùng trực tiếp yêu cầu nhạc HOẶC quote nhạc kèm xác nhận
  if (checkIsMusicRequest(question)) return true;
  if (quoteLower && checkIsMusicRequest(quoteText)) {
    const isAffirmation =
      /\b(?:ok(?:ela|ay|e)?|okie|ừ|uh|da|dạ|vâng|được|dc|triển|làm\s*đi|tạo\s*đi|sáng\s*tác\s*đi|hát\s*đi|phối\s*đi)\b/iu.test(qLower);
    if (isAffirmation) return true;
  }

  // 6. Bỏ qua nếu chỉ là câu hỏi thăm dò năng lực thuần túy không có chủ đề cụ thể (VD: "em có biết tạo file không?", "bot có tạo được slide không hả?")
  const isGenericCapabilityInquiry =
    /^(?:em|bot|mày|bác)?\s*(?:có\s+)?(?:biết|làm|tạo|xuất|soạn)?\s*(?:được|đc|duoc)?(?:\s+(?:tạo|làm|soạn|xuất))?\s+(?:file|slide|voice|ảnh|nhạc|video|tài\s*liệu)\s*(?:không|ko)?\s*(?:hả|nhỉ|hở|ạ|không|ko)\s*[?]?$/iu.test(
      qLower,
    );
  if (isGenericCapabilityInquiry) return false;

  // 7. Bỏ qua nếu là câu hỏi hỏi ý kiến / thăm dò công cụ / hỏi cách làm mà không có ý định ra lệnh tạo file
  const isHypotheticalOrInquiry =
    /(?:có\s+(?:khó|dễ|nhanh|lâu|được|đc|tốn|mất)\s*(?:không|ko|chăng|hả|hở|nhỉ|ạ)|(?:^|[^\p{L}\p{N}])(?:bằng\s+cách\s+nào|như\s+thế\s+nào|làm\s+sao|app\s+gì|phần\s+mềm\s+gì|tool\s+gì|trang\s+web\s+nào|web\s+gì|công\s+cụ\s+gì|ở\s+đâu)(?=$|[^\p{L}\p{N}]))/iu.test(qLower);
  if (isHypotheticalOrInquiry && !/(?:hãy|giúp|cho\s*mình|cho\s*anh|cho\s*em|ngay|luôn)\b/iu.test(qLower)) {
    return false;
  }

  const fileTargetRegex =
    /(?:powerpoint|slide|pptx|ppt|trình\s*chiếu|thuyết\s*trình|words?|docx|văn\s*bản\s*hành\s*chính|hợp\s*đồng|excel|excell|exel|xlsx|bảng\s*tính|báo\s*giá|csv|html|báo\s*cáo\s*web|pdf|markdown|\.md\b|file|tệp|voice|podcast|thu\s*âm|ghi\s*âm|audio|giọng\s*đọc|nhạc|bài\s*hát|ca\s*khúc|bản\s*nhạc|beat|track|poster|biểu\s*đồ|đồ\s*thị|chart|plot|sơ\s*đồ|lưu\s*đồ|flowchart|mindmap|infographic|hình\s*ảnh|ảnh|bảng\s+(?:thi\s*đấu|đấu|xếp\s*hạng|điểm|so\s*sánh|thống\s*kê)|lịch\s+(?:thi\s*đấu|trình))/iu;

  const hasFileTargetInQuestion = fileTargetRegex.test(qLower);
  const hasFileTargetInQuote = fileTargetRegex.test(quoteLower);

  // Nhận diện nếu đang trích dẫn một file/ảnh/biểu đồ/voice bot đã tạo trước đó
  const isQuotingGeneratedArtifact =
    /(?:biểu\s*đồ|hình\s*ảnh|bài\s*thuyết\s*trình|slide|file|voice|poster|đã\s*hoàn\s*tất|đã\s*tạo\s*xong|đã\s*soạn\s*xong|\[hình\s*ảnh\])/iu.test(quoteText);

  // Ý định làm lại, chỉnh sửa hoặc phàn nàn chất lượng để bot làm lại cẩn thận
  const isReworkOrCritique =
    /(?:làm\s*lại|vẽ\s*lại|sửa\s*lại|chỉnh\s*lại|tạo\s*lại|soạn\s*lại|xuất\s*lại|cẩn\s*thận|đẹp\s*hơn|xấu|lỗi\s*font|font\s*lỗi|đồ\s*họa|chưa\s*đẹp|sơ\s*sài|chuyên\s*nghiệp|làm\s*ăn\s*thế\s*này|làm\s*đi)/iu.test(qLower);

  if (isQuotingGeneratedArtifact && isReworkOrCritique) return true;

  // Nhận diện nếu đang trích dẫn tin nhắn bot vừa soạn dàn ý hoặc hỏi tín hiệu xuất file/ảnh
  const isQuotingProposalOrDraft =
    /(?:đóng\s*gói\s*thành\s*file|tải\s*về\s*máy|cho\s*em\s*tín\s*hiệu|xuất\s*file|soạn\s*thành\s*file|chuyển\s*đổi\s*sang|tạo\s*file|\.md|\.docx|\.pptx|\.xlsx|vẽ\s*ảnh|tạo\s*ảnh|trả\s*ảnh|kết\s*xuất|hệ\s*thống\s*codex|đợi\s*em.*?worker|nạp\s*lệnh\s*vào|tool\s*tạo\s*ảnh)/iu.test(quoteText);
  if (
    isQuotingProposalOrDraft &&
    /(?:^|[^\p{L}\p{N}])(?:ok(?:ela|ay|e)?|ừ|uh|u|dạ|vâng|được|dc|triển|làm|soạn|gửi|trả|cho\s*mình|cho\s*anh|cho\s*em|tín\s*hiệu|file|tạo|vẽ)(?=$|[^\p{L}\p{N}])/iu.test(qLower)
  ) {
    return true;
  }

  // Nhận diện cấu trúc ngữ pháp tự nhiên đưa nội dung vào/ra file hoặc voice (VD: "chuyển nó về dạng excell", "xuất thành file word")
  const hasStructuralDirection =
    /(?:vào|ra|thành|sang|qua|lên|bằng|về|dưới|dạng)\s+(?:thành\s+)?(?:dạng\s+)?(?:file\s+)?(?:docx|words?|excel|excell|exel|xlsx|bảng\s*tính|pptx|ppt|powerpoint|slide|pdf|csv|txt|md|markdown|html|voice|audio)/iu.test(qLower);

  const actionPattern =
    /(?:tạo|xuất|soạn|làm|dựng|quay|viết|gửi|lưu|thiết\s*kế|chuyển\s*(?:thành|sang|qua|lên|ra)?|đổi\s*(?:thành|sang|qua)?|bật|convert|generate|export|triển\s*khai|đọc\s*(?:giúp|hộ|cho|bằng)?|ngâm(?:\s+thơ)?|thu\s*âm|ghi\s*âm|vẽ(?:\s+lại)?|làm(?:\s+lại)?|thiết\s*kế(?:\s+lại)?|sửa(?:\s+lại)?|chỉnh(?:\s+lại)?|đóng\s*gói|gom|cho\s*vào|bỏ\s*vào|lưu\s*vào|nhét\s*vào|in\s*ra|trả\s*(?:file|cho)?|gửi\s*(?:file|cho)?|đưa\s*(?:file|cho)?|tải\s*(?:file)?)/iu;

  const isAffirmativeFollowUp =
    /^(?:ok(?:ela|ay|e)?|ừ|uh|u|dạ|da|vâng|vang|dc|được|chốt|nhất\s*trí|duyệt|tiến\s*hành)[\s,.:;!-]*(?:soạn|làm|tạo|xuất|viết|triển\s*khai|chốt|triển|lên|đóng\s*gói|gom|trả\s*file|gửi\s*file|lấy\s*file|trả|gửi|lấy|vẽ|sinh)?\s*(?:luôn|ngay|hộ|giúp|cho|đi|nhé|nha|e|em|tiếp|luôn\s*đi|cho\s*mình|cho\s*anh|cho\s*em)?\b/iu.test(qLower.trim()) ||
    /^(?:soạn|làm|tạo|xuất|viết|triển\s*khai|chốt|triển|lên|đóng\s*gói|gom|trả\s*file|gửi\s*file|lấy\s*file|trả|gửi|lấy|vẽ|sinh)\s*(?:luôn|ngay|hộ|giúp|cho|đi|nhé|nha|e|em|tiếp|luôn\s*đi|cho\s*mình|cho\s*anh|cho\s*em)?\b/iu.test(qLower.trim());

  // Hành động nằm trong câu hỏi mới HOẶC nằm trong nội dung trích dẫn (khi câu hỏi mới là một lệnh xác nhận rõ ràng)
  const isQuotingActionRequest =
    actionPattern.test(quoteLower) &&
    hasFileTargetInQuote &&
    isAffirmativeFollowUp;

  const hasAction = actionPattern.test(qLower) || isQuotingActionRequest;

  if (hasStructuralDirection) return true;
  const hasFileTarget = hasFileTargetInQuestion || (hasFileTargetInQuote && isAffirmativeFollowUp);
  if ((hasFileTarget || isQuotingActionRequest) && (hasAction || isAffirmativeFollowUp)) return true;

  const isCodeOrChart =
    /(?:vẽ|tạo|xuất|lập|thiết\s*kế|làm|soạn|sinh|render)(?:\s+lại)?\s*(?:cho\s*.*?\s*)?(?:biểu\s*đồ|đồ\s*thị|chart|plot|sơ\s*đồ|lưu\s*đồ|flowchart|mindmap|infographic|poster|ảnh|hình|tranh|bảng\s+(?:thi\s*đấu|đấu|xếp\s*hạng|điểm|so\s*sánh|thống\s*kê)|lịch\s+(?:thi\s*đấu|trình))/iu.test(qLower) ||
    /(?:biểu\s*đồ|đồ\s*họa|poster|infographic|hình\s*ảnh|bức\s*ảnh|tấm\s*ảnh).*?(?:làm\s*lại|sửa\s*lại|vẽ\s*lại|cẩn\s*thận|đẹp\s*hơn|chuyên\s*nghiệp)/iu.test(qLower) ||
    /^[/!](?:taoanh|veanh|draw|plot|chart|suaanh|chinhanh|chinhsuaanh|editanh|editimage|modifyimage|imagine|image)\b/iu.test(qLower) ||
    (!/(?:phần\s*mềm|công\s*cụ|tool|app|ứng\s*dụng|mô\s*hình|ai|giải\s*pháp|cách|hướng\s*dẫn)\s+.*?(?:chỉnh|sửa|edit)/iu.test(qLower) &&
     /(?:sửa|chỉnh\s*sửa|chỉnh|edit|thay|đổi|xoá|xóa|làm\s*nét|biến\s*đổi|phục\s*chế)\s+(?:ảnh|hình|bức\s*ảnh|tấm\s*ảnh|phông|nền|background|tóc|áo|quần|váy|kính|màu|người)/iu.test(qLower)) ||
    /(?:dựa\s+(?:vào|theo)|theo)\s+(?:prompt|câu\s*lệnh|ý\s*tưởng|mô\s*tả)\b/iu.test(qLower) ||
    /(?:chạy|viết|run|execute)\s*(?:code|mã|script)\s*(?:python|py)/iu.test(qLower);

  return isCodeOrChart;
}

/**
 * Kiểm tra xem người dùng có muốn xuất nhanh câu trả lời trước đó thành file Markdown (.md) hay không.
 * Ví dụ: "gửi tôi file md để lưu", "xuất file md câu trả lời trên", "lưu lại thành file md"
 */
export function isQuickMarkdownExportRequest(question: string, _quoteText = ""): boolean {
  const qLower = (question || "").toLowerCase();

  // Chặn tuyệt đối các câu chất vấn, phàn nàn ngược ("sao gửi file md làm gì", "không yêu cầu")
  if (/(?:sao|tại\s*sao|sao\s*lại)\s+.*?(?:gửi|đóng\s*gói|xuất|làm\s*gì|chi\s*vậy|thế|hả|à)/iu.test(qLower)) {
    return false;
  }
  if (/(?:không\s+yêu\s*cầu|ko\s+yêu\s*cầu|chưa\s+yêu\s*cầu|tự\s*nhiên\s+gửi|ai\s+mượn)/iu.test(qLower)) {
    return false;
  }

  // Mục tiêu Markdown bắt buộc phải được người dùng nêu rõ trong chính câu hỏi (không lấy từ quote cũ của bot)
  const isMdMentioned = /(?:\.md\b|markdown|file\s+md\b|tệp\s+md\b)/iu.test(qLower);
  if (!isMdMentioned) return false;

  const isExportOrSaveAction =
    /(?:xuất|gửi|lưu|cho\s+xin|xin|tải|export|trả|lấy|đóng\s*gói|gom)\s+.*?(?:file\s+md|\.md|markdown)/iu.test(qLower) ||
    (/(?:file\s+md|\.md|markdown)/iu.test(qLower) && /(?:để\s+lưu|lưu\s+lại|dễ\s+bị\s+trôi|lưu\s+trữ|về\s+máy|lưu\s+vào)/iu.test(qLower)) ||
    /^(?:cho\s+mình|cho\s+anh|cho\s+em|gửi|xuất|lưu)\s+(?:xin\s+)?(?:file\s+)?(?:md|\.md|markdown)\b/iu.test(qLower.trim());

  return isExportOrSaveAction;
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
  isMusic?: boolean;
  listenUrl?: string;
  coverPath?: string;
  title?: string;
  isVideo?: boolean;
  isMediaDownload?: boolean;
  pptxPath?: string;
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
    primary: "0F172A",
    accent: "0284C7",
    headerText: "FFFFFF",
    bgLight: "F0F9FF",
    border: "CBD5E1",
    cardBg: "FFFFFF",
    canvasBg: "F8FAFC",
    darkText: "0F172A",
    mutedText: "64748B",
    highlight: "38BDF8",
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
    accent: "D97706",
    headerText: "FFFFFF",
    bgLight: "FEF3C7",
    border: "FDE68A",
    cardBg: "FFFFFF",
    canvasBg: "FAFAF9",
    darkText: "292524",
    mutedText: "78716C",
    highlight: "F59E0B",
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
  layout?: "title" | "bullets" | "table" | "two_content" | "three_column" | "timeline" | "steps" | "stats" | "image" | "split_image";
  title: string;
  subtitle?: string;
  kicker?: string;
  takeaway?: string;
  speakerNotes?: string;
  bullets?: string[];
  tableHeaders?: string[];
  tableRows?: Array<Array<string | number>>;
  col1Title?: string;
  col1Bullets?: string[];
  col2Title?: string;
  col2Bullets?: string[];
  col3Title?: string;
  col3Bullets?: string[];
  left?: { title?: string; bullets?: string[] };
  right?: { title?: string; bullets?: string[] };
  column1?: { title?: string; bullets?: string[] };
  column2?: { title?: string; bullets?: string[] };
  columns?: Array<{ title?: string; bullets?: string[] }>;
  image?: string;
  imageUrl?: string;
  imageCaption?: string;
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
    let speakerNotes = "";
    const remainingLines: string[] = [];

    // Parse các dòng tiêu đề, badge, takeaway, speaker notes
    for (const line of lines) {
      if (/^\[([\p{L}0-9\s/_-]{2,30})\]$/u.test(line)) {
        kicker = line.replace(/^\[|\]$/g, "").trim();
        continue;
      }
      if (/^(?:💡\s*)?(?:ghi chú|takeaway|lưu ý|chú ý|kết luận)[:.]\s*/iu.test(line)) {
        takeaway = line.replace(/^(?:💡\s*)?(?:ghi chú|takeaway|lưu ý|chú ý|kết luận)[:.]\s*/iu, "").trim();
        continue;
      }
      if (/^(?:🎙️\s*|🗣️\s*)?(?:lời\s*thoại|speaker\s*notes?|thuyết\s*minh|diễn\s*thuyết|ghi\s*chú\s*thuyết\s*trình)[:.]\s*/iu.test(line)) {
        speakerNotes = line.replace(/^(?:🎙️\s*|🗣️\s*)?(?:lời\s*thoại|speaker\s*notes?|thuyết\s*minh|diễn\s*thuyết|ghi\s*chú\s*thuyết\s*trình)[:.]\s*/iu, "").trim();
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
        speakerNotes: speakerNotes || undefined,
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
        speakerNotes: speakerNotes || undefined,
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
        speakerNotes: speakerNotes || undefined,
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
        speakerNotes: speakerNotes || undefined,
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
        speakerNotes: speakerNotes || undefined,
      });
    } else if (stepMatches.length >= 2 && bulletList.length <= 1) {
      slides.push({
        layout: "timeline",
        title,
        kicker: kicker || undefined,
        takeaway: takeaway || undefined,
        speakerNotes: speakerNotes || undefined,
        steps: stepMatches.slice(0, 4),
      });
    } else {
      slides.push({
        layout: "bullets",
        title,
        kicker: kicker || undefined,
        takeaway: takeaway || undefined,
        speakerNotes: speakerNotes || undefined,
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

/**
 * Chuẩn hóa tên file an toàn cho hệ thống file và Zalo download:
 * Chuyển tiếng Việt có dấu thành không dấu thay vì biến thành dấu gạch dưới rác
 */
export function sanitizeSafeFileName(name: string, defaultName = "tai_lieu"): string {
  if (!name || typeof name !== "string") return defaultName;
  const unaccented = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (m) => (m === "Đ" ? "D" : "d"));
  const safe = unaccented
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return safe || defaultName;
}

/**
 * Slide Sanitizer: Lọc và gom các slide mồ côi (do LLM làm phẳng stats/steps)
 * và loại bỏ các slide rác không có nội dung để đảm bảo slide deck sạch 100%.
 */
export function sanitizeSlideList(rawSlides: any[], defaultTitle: string): SlideContent[] {
  if (!Array.isArray(rawSlides) || rawSlides.length === 0) return [];

  const cleanedSlides: SlideContent[] = [];

  for (let idx = 0; idx < rawSlides.length; idx++) {
    const raw = rawSlides[idx];
    if (!raw || typeof raw !== "object") continue;

    // 1. Kiểm tra nếu đây là item 'stat' mồ côi (chứa value + label, không có title hoặc title rỗng)
    if ((raw.value && raw.label) || (raw.value && !raw.title)) {
      const lastSlide = cleanedSlides[cleanedSlides.length - 1];
      if (lastSlide && lastSlide.layout === "stats") {
        if (!Array.isArray(lastSlide.stats)) lastSlide.stats = [];
        lastSlide.stats.push({
          value: String(raw.value),
          label: String(raw.label || raw.title || ""),
          desc: raw.desc ? String(raw.desc) : undefined,
        });
        continue;
      }
      continue;
    }

    // 2. Kiểm tra nếu đây là item 'step' mồ côi (chứa number + desc, không có bullets/content)
    if (raw.number && raw.desc && !raw.bullets && !raw.col1Bullets) {
      const lastSlide = cleanedSlides[cleanedSlides.length - 1];
      if (lastSlide && lastSlide.layout === "timeline") {
        if (!Array.isArray(lastSlide.steps)) lastSlide.steps = [];
        lastSlide.steps.push({
          number: String(raw.number),
          title: String(raw.title || `Bước ${lastSlide.steps.length + 1}`),
          desc: String(raw.desc),
        });
        continue;
      }
      continue;
    }

    const slideTitle = String(raw.title || "").trim();
    const hasBullets = Array.isArray(raw.bullets) && raw.bullets.some((b: any) => String(b).trim().length > 0);
    const hasCol1 = Array.isArray(raw.col1Bullets) && raw.col1Bullets.length > 0;
    const hasStats = Array.isArray(raw.stats) && raw.stats.length > 0;
    const hasSteps = Array.isArray(raw.steps) && raw.steps.length > 0;
    const hasTable = Array.isArray(raw.tableHeaders) && raw.tableHeaders.length > 0;
    const isCover = raw.layout === "title" || idx === 0;

    // Nếu không phải slide bìa, và không có bất kỳ content nào (hoặc chỉ có title mặc định "Nội dung X"):
    const isDefaultOrEmptyTitle = !slideTitle || /^Nội\s*dung\s*\d+$/i.test(slideTitle) || /^Slide\s*\d+$/i.test(slideTitle);
    if (!isCover && isDefaultOrEmptyTitle && !hasBullets && !hasCol1 && !hasStats && !hasSteps && !hasTable) {
      continue;
    }

    // Nếu có tiêu đề nhưng không có nội dung, kiểm tra subtitle/desc
    let finalBullets = Array.isArray(raw.bullets) ? raw.bullets : [];
    if (!isCover && !hasBullets && !hasCol1 && !hasStats && !hasSteps && !hasTable) {
      if (raw.subtitle || raw.desc || raw.description) {
        finalBullets = [String(raw.subtitle || raw.desc || raw.description)];
      } else {
        continue; // Bỏ qua slide rỗng
      }
    }

    let layout = raw.layout;
    if (!layout) {
      if (hasStats) layout = "stats";
      else if (hasSteps) layout = "timeline";
      else if (raw.col3Title || raw.col3Bullets) layout = "three_column";
      else if (raw.col1Title || raw.col1Bullets) layout = "two_content";
      else if (hasTable) layout = "table";
      else if (isCover && idx === 0) layout = "title";
      else layout = "bullets";
    }

    const isGeneric = !slideTitle || /^(nội dung|slide|phần)\s*\d*$/i.test(slideTitle.trim());
    let resolvedTitle = slideTitle;
    if (isGeneric) {
      if (raw.kicker && raw.kicker.trim().length > 3) {
        resolvedTitle = raw.kicker.trim();
      } else if (raw.col1Title && raw.col1Title.trim().length > 3) {
        resolvedTitle = raw.col1Title.trim();
      } else if (idx === 0) {
        resolvedTitle = defaultTitle;
      } else {
        resolvedTitle = `Nội Dung ${cleanedSlides.length + 1}`;
      }
    }

    cleanedSlides.push({
      ...raw,
      title: resolvedTitle,
      layout,
      bullets: finalBullets.length > 0 ? finalBullets : raw.bullets,
    });
  }

  if (cleanedSlides.length > 0 && cleanedSlides[0]?.layout !== "title") {
    cleanedSlides.unshift({
      layout: "title",
      title: defaultTitle,
      subtitle: "Tài liệu thuyết trình chiến lược",
    });
  }

  return cleanedSlides;
}

export async function generatePowerPointFile(
  fileName: string,
  title: string,
  slides: SlideContent[],
  themeName: ThemeName = "navy",
  options?: { enableNarration?: boolean; voiceHint?: string; voiceStyle?: string },
): Promise<GeneratedFileResult> {
  // 1. Ưu tiên render chuẩn PowerPoint DrawingML qua PPT Master
  try {
    const pptmasterConfig = getPPTMasterConfig();
    if (pptmasterConfig.isAvailable) {
      const sanitizedSlides = sanitizeSlideList(slides, title);
      const effectiveSlides = sanitizedSlides.length > 0 ? sanitizedSlides : slides;
      const res = await renderPPTMasterPresentation({
        fileName,
        title,
        slides: effectiveSlides,
        themeName,
        enableNarration: options?.enableNarration,
        voiceHint: options?.voiceHint,
        voiceStyle: options?.voiceStyle,
      });
      return res;
    }
  } catch (err: any) {
    console.warn("[file-generator] PPT Master engine gặp sự cố, fallback sang PptxGenJS:", err?.message || err);
  }

  // 2. Fallback sang PptxGenJS
  try {
    ensureOutputDir();
    cleanOldGeneratedFiles(24);

    const safeName = sanitizeSafeFileName(fileName, "bai_thuyet_trinh");
    const fullFileName = safeName.endsWith(".pptx") ? safeName : `${safeName}.pptx`;
    const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

    const theme = getTheme(themeName);
    const PptxConstructor: any = (PptxGenJS as any).default || PptxGenJS;
    const pres = new PptxConstructor();
    pres.layout = "LAYOUT_16x9";
    pres.title = title;

    // Làm sạch và lọc các slide rác
    const sanitizedSlides = sanitizeSlideList(slides, title);
    const effectiveSlides = sanitizedSlides.length > 0 ? sanitizedSlides : slides;

    // Slide 1: Bìa (Title Slide) theo phong cách Modern PPTmaster
    let startIdx = 0;
    const s0 = effectiveSlides[0];
    const isCustomCover = s0 && s0.layout === "title";
    const coverTitle = isCustomCover ? (s0.title || title) : title;
    const coverSubtitle = isCustomCover ? (s0.subtitle || "Tài liệu thuyết trình chiến lược") : "Tài liệu trình chiếu AI Zalo Assistant";
    const coverKicker = isCustomCover && s0.kicker ? s0.kicker : "BÁO CÁO THUYẾT TRÌNH";
    if (isCustomCover) startIdx = 1;

    const coverSlide = pres.addSlide();
    coverSlide.background = { color: theme.canvasBg };
    const coverNotes = isCustomCover ? s0?.speakerNotes : (slides[0]?.speakerNotes || "");
    if (coverNotes && typeof (coverSlide as any).addNotes === "function") {
      (coverSlide as any).addNotes(coverNotes);
    }

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
    for (let i = startIdx; i < effectiveSlides.length; i++) {
      const s = effectiveSlides[i];
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
        let bulletList = (s.bullets || []).filter((b: any) => typeof b === "string" && b.trim().length > 0).slice(0, 8);
        if (bulletList.length === 0) {
          if (s.subtitle) bulletList = [s.subtitle];
          else if (s.takeaway) bulletList = [s.takeaway];
        }

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
        } else if (bulletList.length > 0) {
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

      // 4. Speaker Notes (Lời thoại thuyết minh của diễn giả)
      if (s.speakerNotes && typeof (slide as any).addNotes === "function") {
        (slide as any).addNotes(s.speakerNotes);
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
  leftAlign?: "left" | "center" | "right";
  rightAlign?: "left" | "center" | "right";
  borderless?: boolean;
}

/**
 * Làm sạch ký hiệu LaTeX và chuyển các lệnh thông dụng sang ký tự Unicode tương ứng
 */
export function cleanTexSymbols(tex: string): string {
  return tex
    // 1. Nhóm Text / Định dạng font / Ký hiệu mũ
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/\\textbf\{([^{}]+)\}/g, "$1")
    .replace(/\\mathrm\{([^{}]+)\}/g, "$1")
    .replace(/\\mathbf\{([^{}]+)\}/g, "$1")
    .replace(/\\mathit\{([^{}]+)\}/g, "$1")
    .replace(/\\mathcal\{([^{}]+)\}/g, "$1")
    .replace(/\\operatorname\{([^{}]+)\}/g, "$1")
    .replace(/\\vec\{([^{}]+)\}/g, "$1")
    .replace(/\\overline\{([^{}]+)\}/g, "$1")
    .replace(/\\bar\{([^{}]+)\}/g, "$1")
    .replace(/\\bar\b/g, "")
    .replace(/\\hat\{([^{}]+)\}/g, "$1")
    .replace(/\\tilde\{([^{}]+)\}/g, "$1")
    .replace(/\\dot\{([^{}]+)\}/g, "$1")
    .replace(/\\ddot\{([^{}]+)\}/g, "$1")
    .replace(/\{\}/g, "")
    .replace(/\\%/g, "%")
    // 1.5. Độ C và ký hiệu độ: bắt triệt để trước mọi thứ
    .replace(/(?:\\?\^?\\circ\s*C\b|\\?\^?\\circ\s*\\text\{C\}|\\?\^?\\circC)/g, "°C")
    .replace(/(?:\\?\^?\\circ\b|\\deg\b|\\circ\b)/g, "°")
    // 2. Chữ cái Hy Lạp viết HOA
    .replace(/\\Phi\b/g, "Φ")
    .replace(/\\Psi\b/g, "Ψ")
    .replace(/\\Theta\b/g, "Θ")
    .replace(/\\Omega\b/g, "Ω")
    .replace(/\\Delta\b/g, "Δ")
    .replace(/\\Lambda\b/g, "Λ")
    .replace(/\\Sigma\b/g, "Σ")
    .replace(/\\Gamma\b/g, "Γ")
    .replace(/\\Pi\b/g, "Π")
    // 3. Chữ cái Hy Lạp viết THƯỜNG
    .replace(/\\(?:varphi|phi)\b/g, "φ")
    .replace(/\\(?:vartheta|theta)\b/g, "θ")
    .replace(/\\(?:varepsilon|epsilon)\b/g, "ε")
    .replace(/\\pi\b/g, "π")
    .replace(/\\omega\b/g, "ω")
    .replace(/\\alpha\b/g, "α")
    .replace(/\\beta\b/g, "β")
    .replace(/\\gamma\b/g, "γ")
    .replace(/\\lambda\b/g, "λ")
    .replace(/\\delta\b/g, "δ")
    .replace(/\\mu\b/g, "μ")
    .replace(/\\nu\b/g, "ν")
    .replace(/\\rho\b/g, "ρ")
    .replace(/\\tau\b/g, "τ")
    .replace(/\\psi\b/g, "ψ")
    .replace(/\\sigma\b/g, "σ")
    .replace(/\\eta\b/g, "η")
    .replace(/\\chi\b/g, "χ")
    .replace(/\\zeta\b/g, "ζ")
    .replace(/\\xi\b/g, "ξ")
    // 4. Mũi tên & Toán tử logic
    .replace(/\\(?:iff|Leftrightarrow)\b/g, "⇔")
    .replace(/\\(?:implies|Rightarrow)\b/g, "⇒")
    .replace(/\\Leftarrow\b/g, "⇐")
    .replace(/\\(?:to|rightarrow)\b/g, "→")
    .replace(/\\(?:gets|leftarrow)\b/g, "←")
    .replace(/\\leftrightarrow\b/g, "↔")
    // 5. Quan hệ toán học & phép tính
    .replace(/\\approx\b/g, "≈")
    .replace(/\\sim\b/g, "∼")
    .replace(/\\equiv\b/g, "≡")
    .replace(/\\pm\b/g, "±")
    .replace(/\\mp\b/g, "∓")
    .replace(/\\(?:le|leq)\b/g, "≤")
    .replace(/\\(?:ge|geq)\b/g, "≥")
    .replace(/\\(?:ne|neq)\b/g, "≠")
    .replace(/\\cdot\b|\\cdot(?=[A-Za-z0-9\p{L}])/gu, "·")
    .replace(/\\times\b/g, "×")
    .replace(/\\div\b/g, "÷")
    .replace(/\\infty\b/g, "∞")
    .replace(/\\in\b/g, "∈")
    .replace(/\\notin\b/g, "∉")
    .replace(/\\subset\b/g, "⊂")
    .replace(/\\forall\b/g, "∀")
    .replace(/\\exists\b/g, "∃")
    .replace(/\\angle\b/g, "∠")
    .replace(/\\parallel\b/g, "∥")
    .replace(/\\perp\b/g, "⊥")
    .replace(/\\triangle\b/g, "Δ")
    .replace(/\\propto\b/g, "∝")
    .replace(/\\(?:displaystyle|limits|nolimits|rm|bf|it|cal)\b/g, "")
    // 6. Hàm số toán học chuẩn
    .replace(/\\(?:cos|sin|tan|cot|ln|log|exp|lim|max|min)\b/g, (m) => m.slice(1))
    // 7. Dấu ngoặc mở rộng & khoảng trắng
    .replace(/\\\s+/g, " ")
    .replace(/\\~/g, " ")
    .replace(/\\(?:,|;|!|quad|qquad)/g, " ")
    .replace(/\\left\(/g, "(")
    .replace(/\\right\)/g, ")")
    .replace(/\\left\[/g, "[")
    .replace(/\\right\]/g, "]")
    .replace(/\\left\\\{/g, "{")
    .replace(/\\right\\\}/g, "}")
    .replace(/\\left\|/g, "|")
    .replace(/\\right\|/g, "|")
    .replace(/\\left\./g, "")
    .replace(/\\right\./g, "")
    .replace(/\\left\\langle|\\langle\b/g, "⟨")
    .replace(/\\right\\rangle|\\rangle\b/g, "⟩");
}

/**
 * Trích xuất khối ngoặc nhọn cân bằng bắt đầu tại startIndex (nơi s[startIndex] === '{')
 */
export function extractBalancedBraces(s: string, startIndex: number): { content: string; endIndex: number } | null {
  if (s[startIndex] !== "{") return null;
  let depth = 0;
  for (let i = startIndex; i < s.length; i++) {
    if (s[i] === "{" && (i === 0 || s[i - 1] !== "\\")) {
      depth++;
    } else if (s[i] === "}" && (i === 0 || s[i - 1] !== "\\")) {
      depth--;
      if (depth === 0) {
        return {
          content: s.slice(startIndex + 1, i),
          endIndex: i, // Vị trí ký tự '}'
        };
      }
    }
  }
  return null;
}

/**
 * Trích xuất token cơ số (base token) nằm ngay trước vị trí pos trong chuỗi s
 */
export function extractBaseTokenBefore(
  s: string,
  pos: number,
): { baseStr: string; startIndex: number; isGroup: boolean } | null {
  if (pos <= 0) return null;
  const lastChar = s[pos - 1];

  // 1. Nhóm ngoặc đóng: ), ], }
  if (lastChar === ")" || lastChar === "]" || lastChar === "}") {
    const openChar = lastChar === ")" ? "(" : lastChar === "]" ? "[" : "{";
    let depth = 0;
    for (let i = pos - 1; i >= 0; i--) {
      if (s[i] === lastChar && (i === 0 || s[i - 1] !== "\\")) depth++;
      else if (s[i] === openChar && (i === 0 || s[i - 1] !== "\\")) {
        depth--;
        if (depth === 0) {
          if (lastChar === "}") {
            // Nhóm ngoặc nhọn cú pháp TeX: bóc bỏ cặp ngoặc ngoài
            return {
              baseStr: s.slice(i + 1, pos - 1),
              startIndex: i,
              isGroup: true,
            };
          }
          // Ngoặc tròn hoặc vuông: giữ nguyên hiển thị
          return {
            baseStr: s.slice(i, pos),
            startIndex: i,
            isGroup: true,
          };
        }
      }
    }
    return null;
  }

  // 2. Ký tự đơn hoặc chuỗi chữ/số/ký hiệu
  let i = pos - 1;
  while (i >= 0 && /[a-zA-Z0-9\p{L}\p{N}°]/u.test(s[i]!)) {
    i--;
  }
  const start = i + 1;
  if (start < pos) {
    return { baseStr: s.slice(start, pos), startIndex: start, isGroup: false };
  }
  return null;
}

/**
 * Phân tích chuỗi TeX thành các phần tử toán bản địa OMML của docx (MathFraction, MathRadical, MathSuperScript, MathSubScript...)
 */
export function parseTexToMathChildren(rawTex: string): any[] {
  const s = cleanTexSymbols(rawTex).trim();
  if (!s) return [];

  const children: any[] = [];
  let i = 0;
  let textBuffer = "";

  const flushText = () => {
    if (textBuffer) {
      children.push(new MathRun(textBuffer));
      textBuffer = "";
    }
  };

  while (i < s.length) {
    // 1. Phân số \frac{numerator}{denominator}
    if (s.startsWith("\\frac", i)) {
      let cursor = i + 5;
      while (cursor < s.length && /\s/.test(s[cursor]!)) cursor++;
      const numMatch = extractBalancedBraces(s, cursor);
      if (numMatch) {
        cursor = numMatch.endIndex + 1;
        while (cursor < s.length && /\s/.test(s[cursor]!)) cursor++;
        const denMatch = extractBalancedBraces(s, cursor);
        if (denMatch) {
          flushText();
          children.push(
            new MathFraction({
              numerator: parseTexToMathChildren(numMatch.content),
              denominator: parseTexToMathChildren(denMatch.content),
            }),
          );
          i = denMatch.endIndex + 1;
          continue;
        }
      }
    }

    // 2. Căn thức \sqrt{content}
    if (s.startsWith("\\sqrt", i)) {
      let cursor = i + 5;
      while (cursor < s.length && /\s/.test(s[cursor]!)) cursor++;
      const radMatch = extractBalancedBraces(s, cursor);
      if (radMatch) {
        flushText();
        children.push(
          new MathRadical({
            children: parseTexToMathChildren(radMatch.content),
          }),
        );
        i = radMatch.endIndex + 1;
        continue;
      }
    }

    // 3. Đồng vị phóng xạ hạt nhân: ví dụ ^4_2He hoặc ^{4}_{2}He hoặc _2^4He
    if (s[i] === "^" || s[i] === "_") {
      const nuclearMatch = s
        .slice(i)
        .match(/^(?:\^(?:\{([^{}]+)\}|([0-9]+))_(?:\{([^{}]+)\}|([0-9]+))|_(?:\{([^{}]+)\}|([0-9]+))\^(?:\{([^{}]+)\}|([0-9]+)))\s*(?:\\text\{([^{}]+)\}|([a-zA-Z\p{L}]+))/u);
      if (nuclearMatch) {
        const superVal = nuclearMatch[1] || nuclearMatch[2] || nuclearMatch[7] || nuclearMatch[8] || "";
        const subVal = nuclearMatch[3] || nuclearMatch[4] || nuclearMatch[5] || nuclearMatch[6] || "";
        const elemVal = nuclearMatch[9] || nuclearMatch[10] || "";
        if (elemVal) {
          flushText();
          children.push(
            new MathPreSubSuperScript({
              children: [new MathRun(elemVal)],
              superScript: [new MathRun(superVal)],
              subScript: [new MathRun(subVal)],
            }),
          );
          i += nuclearMatch[0].length;
          continue;
        }
      }
    }

    // 4. Số mũ (^) và chỉ số dưới (_)
    if (s[i] === "^" || s[i] === "_") {
      const isSuper = s[i] === "^";
      const baseInfo = extractBaseTokenBefore(textBuffer, textBuffer.length);
      if (baseInfo) {
        const cursor = i + 1;
        let scriptContent = "";
        let nextIndex = cursor;

        if (s[cursor] === "{") {
          const bMatch = extractBalancedBraces(s, cursor);
          if (bMatch) {
            scriptContent = bMatch.content;
            nextIndex = bMatch.endIndex + 1;
          }
        } else if (cursor < s.length && /[0-9a-zA-Z\p{L}+-]/u.test(s[cursor]!)) {
          scriptContent = s[cursor]!;
          nextIndex = cursor + 1;
        }

        if (scriptContent !== "") {
          textBuffer = textBuffer.slice(0, baseInfo.startIndex);
          flushText();

          const baseChildren = baseInfo.isGroup
            ? parseTexToMathChildren(baseInfo.baseStr)
            : [new MathRun(baseInfo.baseStr)];
          const scriptChildren = parseTexToMathChildren(scriptContent);

          // Kiểm tra xem có script kép tiếp theo không (ví dụ base^super_sub hoặc base_sub^super)
          let secondCursor = nextIndex;
          while (secondCursor < s.length && /\s/.test(s[secondCursor]!)) secondCursor++;
          const hasDual =
            (isSuper && s[secondCursor] === "_") || (!isSuper && s[secondCursor] === "^");

          if (hasDual) {
            let secondScriptContent = "";
            let secondNextIndex = secondCursor + 1;
            if (s[secondNextIndex] === "{") {
              const b2Match = extractBalancedBraces(s, secondNextIndex);
              if (b2Match) {
                secondScriptContent = b2Match.content;
                secondNextIndex = b2Match.endIndex + 1;
              }
            } else if (secondNextIndex < s.length && /[0-9a-zA-Z\p{L}+-]/u.test(s[secondNextIndex]!)) {
              secondScriptContent = s[secondNextIndex]!;
              secondNextIndex = secondNextIndex + 1;
            }

            if (secondScriptContent !== "") {
              const secondChildren = parseTexToMathChildren(secondScriptContent);
              children.push(
                new MathSubSuperScript({
                  children: baseChildren,
                  superScript: isSuper ? scriptChildren : secondChildren,
                  subScript: isSuper ? secondChildren : scriptChildren,
                }),
              );
              i = secondNextIndex;
              continue;
            }
          }

          // Script đơn
          if (isSuper) {
            children.push(
              new MathSuperScript({
                children: baseChildren,
                superScript: scriptChildren,
              }),
            );
          } else {
            children.push(
              new MathSubScript({
                children: baseChildren,
                subScript: scriptChildren,
              }),
            );
          }
          i = nextIndex;
          continue;
        }
      }
    }

    textBuffer += s[i];
    i++;
  }

  flushText();
  return children.length > 0 ? children : [new MathRun(s)];
}

/**
 * Chuyển đổi mã TeX sang đối tượng DocxMath bản địa Word Equation (<m:oMath>)
 */
export function convertTexToDocxMath(rawTex: string): DocxMath | null {
  try {
    const clean = rawTex.replace(/^\$\$|\$\$$/g, "").replace(/^\$|\$$/g, "").trim();
    if (!clean) return null;
    const children = parseTexToMathChildren(clean);
    if (!children || children.length === 0) return null;
    return new DocxMath({ children });
  } catch {
    return null;
  }
}

/**
 * Chuyển đổi văn bản chứa Markdown (**in đậm**, *in nghiêng*) và LaTeX Math ($...$, $$...$$) thành mảng TextRun hoặc DocxMath chuẩn của Word.
 * - Mặc định hỗ trợ Word Equation (<m:oMath>) bản địa của Microsoft Word: Mở file hiển thị ngay lập tức, sửa trực tiếp được bằng bàn phím.
 * - Tùy chọn mathtype: Giữ nguyên chuỗi TeX thô với font Cambria Math.
 * - Tùy chọn unicode: Chỉ băm sang Unicode khi được chỉ định riêng biệt.
 */
export function parseMarkdownRuns(
  text: string,
  baseFont = "Times New Roman",
  baseSize = 26,
  options?: { mathMode?: "omml" | "mathtype" | "unicode" },
): (TextRun | DocxMath)[] {
  if (!text) return [];

  // 1. Chế độ Unicode thuần (chỉ khi yêu cầu riêng biệt)
  if (options?.mathMode === "unicode") {
    const clean = cleanLatexMathToUnicode(text);
    const runs: (TextRun | DocxMath)[] = [];
    const tokenRegex = /(\*\*.*?\*\*|\*.*?\*)/g;
    const parts = clean.split(tokenRegex);
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
    return runs.length > 0 ? runs : [new TextRun({ text: clean, font: baseFont, size: baseSize })];
  }

  // 2. Chế độ Mặc định (OMML Word Equation bản địa) hoặc Chế độ MathType thuần
  const runs: (TextRun | DocxMath)[] = [];
  const tokenRegex = /(\$\$[\s\S]+?\$\$|\$(?:\\\$|[^\$\n])+?\$|\*\*.*?\*\*|\*.*?\*)/g;
  const parts = text.split(tokenRegex);

  for (const part of parts) {
    if (!part) continue;

    const isMathBlock = part.startsWith("$$") && part.endsWith("$$") && part.length >= 4;
    const isMathInline =
      part.startsWith("$") &&
      part.endsWith("$") &&
      part.length >= 2;

    if (isMathBlock || isMathInline) {
      if (options?.mathMode === "mathtype") {
        runs.push(new TextRun({ text: part, font: "Cambria Math", size: baseSize }));
      } else {
        const docxMath = convertTexToDocxMath(part);
        if (docxMath) {
          runs.push(docxMath);
        } else {
          // Fallback nếu không parse được sang OMML: loại bỏ ký tự $ bọc ngoài để không lộ cú pháp thô
          const cleanText = part.replace(/^\$\$|\$\$$/g, "").replace(/^\$|\$$/g, "").trim();
          runs.push(new TextRun({ text: cleanText || part, font: baseFont, size: baseSize }));
        }
      }
    } else if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      const inner = part.slice(2, -2);
      if (inner.includes("$")) {
        const subRuns = parseMarkdownRuns(inner, baseFont, baseSize, options);
        for (const sub of subRuns) {
          if (sub instanceof TextRun) {
            runs.push(new TextRun({ text: (sub as any).text || "", font: baseFont, size: baseSize, bold: true }));
          } else {
            runs.push(sub);
          }
        }
      } else {
        runs.push(new TextRun({ text: inner, font: baseFont, size: baseSize, bold: true }));
      }
    } else if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      const inner = part.slice(1, -1);
      if (inner.includes("$")) {
        const subRuns = parseMarkdownRuns(inner, baseFont, baseSize, options);
        for (const sub of subRuns) {
          if (sub instanceof TextRun) {
            runs.push(new TextRun({ text: (sub as any).text || "", font: baseFont, size: baseSize, italics: true }));
          } else {
            runs.push(sub);
          }
        }
      } else {
        runs.push(new TextRun({ text: inner, font: baseFont, size: baseSize, italics: true }));
      }
    } else {
      // Làm sạch ký hiệu LaTeX bị sót ngoài khối math (ví dụ \cdot, \Delta, ...)
      const cleanPlain = cleanTexSymbols(part);
      runs.push(new TextRun({ text: cleanPlain, font: baseFont, size: baseSize }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text, font: baseFont, size: baseSize })];
}

/**
 * Chuyển đổi văn bản Markdown tự do thành mảng WordBlock chuẩn để sinh file Word (.docx) chuyên nghiệp:
 * - Tự động nhận diện Bảng Markdown (| Cột 1 | Cột 2 |) thành WordBlock kiểu 'table'
 * - Tiêu đề cấp 1 (#), cấp 2 (##), cấp 3 (###) thành WordBlock kiểu 'heading'
 * - Danh sách gạch đầu dòng (- / * / •) thành WordBlock kiểu 'bullets'
 * - Văn bản thông thường thành WordBlock kiểu 'paragraph'
 */
/**
 * Nhận diện và chuẩn hóa phần đầu thể thức văn bản hành chính Việt Nam (Nghị định 30/2020/NĐ-CP):
 * - Bảng 2 cột ẩn viền:
 *   + Cột trái: Tên cơ quan ban hành (in hoa, đứng), Số hiệu văn bản
 *   + Cột phải: Quốc hiệu (in hoa đậm), Tiêu ngữ (đậm), Địa danh - ngày tháng năm (nghiêng)
 */
function tryExtractAdminHeader(lines: string[]): { headerBlock: WordBlock; nextIndex: number } | null {
  const checkLimit = Math.min(lines.length, 15);
  let nationIdx = -1;
  let mottoIdx = -1;
  let dateIdx = -1;
  let mergedIdx = -1;

  for (let idx = 0; idx < checkLimit; idx++) {
    const l = lines[idx]!.replace(/^[#*]+\s*|\s*[*#]+$/g, "").trim();
    if (/CỘNG\s*HÒA\s*XÃ\s*HỘI\s*CHỦ\s*NGHĨA\s*VIỆT\s*NAM/i.test(l)) {
      nationIdx = idx;
    }
    if (/Độc\s*lập\s*[-–—]\s*Tự\s*do\s*[-–—]\s*Hạnh\s*phúc/i.test(l)) {
      mottoIdx = idx;
    }
    if (/(?:ngày\s+\d+\s+tháng\s+\d+\s+năm\s+\d+|\d{1,2}\/\d{1,2}\/\d{4})/i.test(l)) {
      dateIdx = idx;
    }
    if (/CỘNG\s*HÒA/i.test(l) && /(?:Số:\s*|Số\s*\d+)/i.test(l)) {
      mergedIdx = idx;
    }
  }

  if (nationIdx === -1 && mottoIdx === -1 && mergedIdx === -1) {
    return null;
  }

  const leftLines: string[] = [];
  const rightLines: string[] = [];
  let maxIdx = 0;

  if (mergedIdx !== -1) {
    // Trường hợp dòng dính chùm: "Số: 317/2026/NĐ-CP * CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM Độc lập - Tự do - Hạnh phúc Hà Nội, ngày 11 tháng 8 năm 2026*"
    for (let idx = 0; idx < mergedIdx; idx++) {
      const l = lines[idx]!.replace(/^[#*]+\s*|\s*[*#]+$/g, "").trim();
      if (l) leftLines.push(l);
    }
    const mergedLine = lines[mergedIdx]!;
    const match = mergedLine.match(/^(.*?)(?:[*•]|\s{2,})?(CỘNG\s*HÒA[\s\S]*)$/i);
    const leftText = (match?.[1] || "").replace(/^[#*]+\s*|\s*[*#]+$/g, "").trim();
    const rightText = (match?.[2] || "").replace(/^[#*]+\s*|\s*[*#]+$/g, "").trim();

    if (leftText) leftLines.push(leftText);
    rightLines.push("**CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM**");
    rightLines.push("**Độc lập - Tự do - Hạnh phúc**");

    const foundDate =
      rightText.match(/([a-zA-ZÀ-ỹ\s]+,\s*ngày\s+\d+\s+tháng\s+\d+\s+năm\s+\d+)/i) ||
      rightText.match(/(ngày\s+\d+\s+tháng\s+\d+\s+năm\s+\d+)/i);
    if (foundDate) {
      rightLines.push(`*${foundDate[0].trim()}*`);
    }
    maxIdx = mergedIdx;
  } else {
    // Các dòng tách rời bình thường
    const upperLimit = Math.max(nationIdx, mottoIdx, dateIdx);
    maxIdx = upperLimit;
    for (let idx = 0; idx <= upperLimit; idx++) {
      const l = lines[idx]!.replace(/^[#*]+\s*|\s*[*#]+$/g, "").trim();
      if (!l) continue;
      if (idx === nationIdx) {
        rightLines.push("**CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM**");
      } else if (idx === mottoIdx) {
        rightLines.push("**Độc lập - Tự do - Hạnh phúc**");
      } else if (idx === dateIdx) {
        rightLines.push(`*${l}*`);
      } else if (/^(?:Số:\s*|Số\s*\d+|CHÍNH PHỦ|BỘ\s+|SỞ\s+|TRƯỜNG\s+|ỦY BAN|UBND|PHÒNG\s+)/i.test(l)) {
        leftLines.push(l);
      } else if (leftLines.length < 3) {
        leftLines.push(l);
      }
    }
  }

  if (leftLines.length === 0 || rightLines.length === 0) {
    return null;
  }

  return {
    headerBlock: {
      type: "two_columns",
      leftCol: leftLines,
      rightCol: rightLines,
      leftAlign: "center",
      rightAlign: "center",
      borderless: true,
    },
    nextIndex: maxIdx + 1,
  };
}

export function parseMarkdownToWordBlocks(content: string, defaultTitle?: string): WordBlock[] {
  if (!content || !content.trim()) {
    return [
      { type: "heading", level: 1, text: defaultTitle || "Tài liệu", align: "center" },
      { type: "paragraph", text: "Chưa có nội dung chi tiết." },
    ];
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: WordBlock[] = [];

  // Kiểm tra trước thể thức văn bản hành chính Việt Nam (Nghị định 30)
  const adminHeader = tryExtractAdminHeader(lines);
  let startIndex = 0;

  if (adminHeader) {
    blocks.push(adminHeader.headerBlock);
    startIndex = adminHeader.nextIndex;
  } else if (defaultTitle && defaultTitle.trim()) {
    // Nếu có defaultTitle mà trong dòng đầu của content chưa có heading 1
    const trimmedFirstLine = lines.find((l) => l.trim().length > 0) || "";
    if (!trimmedFirstLine.startsWith("# ")) {
      blocks.push({
        type: "heading",
        level: 1,
        text: defaultTitle.trim(),
        align: "center",
      });
    }
  }

  let i = startIndex;
  while (i < lines.length) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();

    // 1. Dòng trống
    if (!line) {
      i++;
      continue;
    }

    // 2. Kiểm tra Bảng Markdown (bắt đầu bằng '|' hoặc chứa ít nhất 2 dấu '|')
    const isTableRow = (line.startsWith("|") && line.endsWith("|")) || (line.match(/\|/g) || []).length >= 2;
    if (isTableRow) {
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        lines[i]!.trim() &&
        ((lines[i]!.trim().startsWith("|") && lines[i]!.trim().endsWith("|")) || (lines[i]!.trim().match(/\|/g) || []).length >= 2)
      ) {
        tableLines.push(lines[i]!.trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const parseRowCells = (rowStr: string): string[] => {
          let parts = rowStr.split("|").map((c) => c.trim());
          if (rowStr.startsWith("|") && parts.length > 0) {
            parts.shift();
          }
          if (rowStr.endsWith("|") && parts.length > 0) {
            parts.pop();
          }
          return parts;
        };

        const headers = parseRowCells(tableLines[0]!);
        const isSeparatorRow = /^\|?(?:\s*:?-+:?\s*\|?)+$/.test(tableLines[1]!) || tableLines[1]!.includes("---");
        const sepIndex = isSeparatorRow ? 2 : 1;

        const dataRows: string[][] = [];
        for (let r = sepIndex; r < tableLines.length; r++) {
          const cells = parseRowCells(tableLines[r]!);
          while (cells.length < headers.length) {
            cells.push("");
          }
          dataRows.push(cells);
        }

        // Tự động nhận diện bảng trắc nghiệm hoặc bảng ma trận đáp án không viền
        const isChoiceTable =
          headers.some((h) => /^[A-D][\.:]|^[a-d]\)/i.test(h)) ||
          dataRows.some((row) => row.some((c) => /^[A-D][\.:]|^[a-d]\)/i.test(String(c))));
        const isAnswerKeyTable = headers.some((h) => /(?:câu|đáp án|mã đề|part|key)/i.test(h));
        const hasBorderlessHint = /(?:khong_khung|borderless|b[oỏ]\s*khung|kh[oô]ng\s*vi[eề]n)/i.test(
          content + " " + (defaultTitle || ""),
        );

        blocks.push({
          type: "table",
          tableHeaders: headers,
          tableRows: dataRows,
          borderless: isChoiceTable || (isAnswerKeyTable && hasBorderlessHint) || hasBorderlessHint,
        });
        continue;
      } else {
        blocks.push({ type: "paragraph", text: tableLines[0]! });
        continue;
      }
    }

    // 3. Tiêu đề Markdown (#, ##, ###, ####, #####)
    if (/^#{1,6}\s+/.test(line)) {
      const hashMatch = line.match(/^#+/);
      const hashCount = hashMatch ? hashMatch[0].length : 1;
      const cleanText = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();

      // Nếu là cấp 4 trở lên hoặc dạng "Điều 1...", "Khoản 1...": chuyển thành paragraph in đậm sạch sẽ
      if (hashCount >= 4 || /^Điều\s+\d+/i.test(cleanText)) {
        blocks.push({
          type: "paragraph",
          text: `**${cleanText}**`,
          align: "left",
        });
      } else {
        const level = hashCount === 3 ? 3 : hashCount === 2 ? 2 : 1;
        blocks.push({
          type: "heading",
          level,
          text: cleanText,
          align: level === 1 && blocks.length <= 1 ? "center" : "left",
        });
      }
      i++;
      continue;
    }

    // 3.5. Kiểm tra Câu hỏi Trắc nghiệm hoặc Câu hỏi Đúng/Sai trong đề thi
    const isQuestionHeading = /^(?:#{1,6}\s*)?(?:\*\*)?(?:Câu|Bài)\s+\d+[\.:]/i.test(line);
    if (isQuestionHeading) {
      // Trường hợp A: Phương án A, B, C, D nằm ngay trong cùng 1 dòng (viết liền dính chùm)
      const inlineOptMatch = line.match(
        /^(.*?)(?:[\s,;]+|^)(A[\.:]\s*[\s\S]+?)(?:[\s,;]+)(B[\.:]\s*[\s\S]+?)(?:[\s,;]+)(C[\.:]\s*[\s\S]+?)(?:[\s,;]+)(D[\.:]\s*[\s\S]+)$/i,
      );
      if (inlineOptMatch) {
        const qText = inlineOptMatch[1]!.replace(/^#{1,6}\s*/, "").trim();
        const optA = inlineOptMatch[2]!.trim();
        const optB = inlineOptMatch[3]!.trim();
        const optC = inlineOptMatch[4]!.trim();
        const optD = inlineOptMatch[5]!.trim();

        blocks.push({
          type: "paragraph",
          text: qText,
          align: "left",
        });

        const maxLen = Math.max(optA.length, optB.length, optC.length, optD.length);
        if (maxLen <= 45) {
          blocks.push({
            type: "two_columns",
            leftCol: [optA, optC],
            rightCol: [optB, optD],
            align: "left",
            borderless: true,
          });
        } else {
          blocks.push({ type: "paragraph", text: `   ${optA}`, align: "left" });
          blocks.push({ type: "paragraph", text: `   ${optB}`, align: "left" });
          blocks.push({ type: "paragraph", text: `   ${optC}`, align: "left" });
          blocks.push({ type: "paragraph", text: `   ${optD}`, align: "left" });
        }
        i++;
        continue;
      }

      // Trường hợp B: Phương án Đúng/Sai a), b), c), d) nằm ngay trong cùng 1 dòng
      const inlineTfMatch = line.match(
        /^(.*?)(?:[\s,;]+|^)(a\)\s*[\s\S]+?)(?:[\s,;]+)(b\)\s*[\s\S]+?)(?:[\s,;]+)(c\)\s*[\s\S]+?)(?:[\s,;]+)(d\)\s*[\s\S]+)$/i,
      );
      if (inlineTfMatch) {
        const qText = inlineTfMatch[1]!.replace(/^#{1,6}\s*/, "").trim();
        blocks.push({
          type: "paragraph",
          text: qText,
          align: "left",
        });
        blocks.push({ type: "paragraph", text: `   ${inlineTfMatch[2]!.trim()}`, align: "left" });
        blocks.push({ type: "paragraph", text: `   ${inlineTfMatch[3]!.trim()}`, align: "left" });
        blocks.push({ type: "paragraph", text: `   ${inlineTfMatch[4]!.trim()}`, align: "left" });
        blocks.push({ type: "paragraph", text: `   ${inlineTfMatch[5]!.trim()}`, align: "left" });
        i++;
        continue;
      }

      // Trường hợp C: Các phương án A, B, C, D nằm ở các dòng tiếp theo
      if (
        i + 4 < lines.length &&
        /^A[\.:]\s*/i.test(lines[i + 1]!.trim()) &&
        /^B[\.:]\s*/i.test(lines[i + 2]!.trim()) &&
        /^C[\.:]\s*/i.test(lines[i + 3]!.trim()) &&
        /^D[\.:]\s*/i.test(lines[i + 4]!.trim())
      ) {
        const qText = line.replace(/^#{1,6}\s*/, "").trim();
        const optA = lines[i + 1]!.trim();
        const optB = lines[i + 2]!.trim();
        const optC = lines[i + 3]!.trim();
        const optD = lines[i + 4]!.trim();

        blocks.push({
          type: "paragraph",
          text: qText,
          align: "left",
        });

        const maxLen = Math.max(optA.length, optB.length, optC.length, optD.length);
        if (maxLen <= 45) {
          blocks.push({
            type: "two_columns",
            leftCol: [optA, optC],
            rightCol: [optB, optD],
            align: "left",
            borderless: true,
          });
        } else {
          blocks.push({ type: "paragraph", text: `   ${optA}`, align: "left" });
          blocks.push({ type: "paragraph", text: `   ${optB}`, align: "left" });
          blocks.push({ type: "paragraph", text: `   ${optC}`, align: "left" });
          blocks.push({ type: "paragraph", text: `   ${optD}`, align: "left" });
        }
        i += 5;
        continue;
      }

      // Trường hợp D: Các ý Đúng/Sai a), b), c), d) nằm ở các dòng tiếp theo
      if (
        i + 4 < lines.length &&
        /^a\)\s*/i.test(lines[i + 1]!.trim()) &&
        /^b\)\s*/i.test(lines[i + 2]!.trim()) &&
        /^c\)\s*/i.test(lines[i + 3]!.trim()) &&
        /^d\)\s*/i.test(lines[i + 4]!.trim())
      ) {
        const qText = line.replace(/^#{1,6}\s*/, "").trim();
        blocks.push({
          type: "paragraph",
          text: qText,
          align: "left",
        });
        blocks.push({ type: "paragraph", text: `   ${lines[i + 1]!.trim()}`, align: "left" });
        blocks.push({ type: "paragraph", text: `   ${lines[i + 2]!.trim()}`, align: "left" });
        blocks.push({ type: "paragraph", text: `   ${lines[i + 3]!.trim()}`, align: "left" });
        blocks.push({ type: "paragraph", text: `   ${lines[i + 4]!.trim()}`, align: "left" });
        i += 5;
        continue;
      }
    }

    // 4. Danh sách gạch đầu dòng (- / * / •) hoặc số (1. / 2.)
    if (/^(?:[-*•]\s+|\d+[\.)]\s+)/.test(line)) {
      const bullets: string[] = [];
      while (i < lines.length && /^(?:[-*•]\s+|\d+[\.)]\s+)/.test(lines[i]!.trim())) {
        bullets.push(lines[i]!.trim());
        i++;
      }
      blocks.push({
        type: "bullets",
        paragraphs: bullets,
      });
      continue;
    }

    // 5. Phân cách trang (=== TRANG X ===) hoặc đường kẻ ngang (---)
    if (/^===+\s*TRANG\s*\d+\s*===+/i.test(line)) {
      blocks.push({
        type: "heading",
        level: 2,
        text: line.replace(/^[= -]+|[= -]+$/g, "").trim(),
        align: "left",
      });
      i++;
      continue;
    }

    if (/^---+$/.test(line) || /^===+$/.test(line)) {
      i++;
      continue;
    }

    // 5.5. Nhận diện phần Footer hành chính (Nơi nhận & Chữ ký / Ban hành)
    if (/^(?:\*\*|\*|#+)?\s*Nơi nhận\s*:/i.test(line)) {
      const leftRecipientLines: string[] = ["**Nơi nhận:**"];
      const rightSignatureLines: string[] = [];
      let collectingRecipients = true;

      while (i + 1 < lines.length) {
        const nextRaw = lines[i + 1]!.trim();
        if (!nextRaw) {
          i++;
          continue;
        }
        if (/^===+\s*TRANG/i.test(nextRaw) || /^---+$/.test(nextRaw)) {
          break;
        }

        const isSignatureKeyword =
          /^(?:HIỆU\s*TRƯỞNG|THỦ\s*TƯỚNG|BỘ\s*TRƯỞNG|GIÁM\s*ĐỐC|CHỦ\s*TỊCH|TRƯỞNG\s*KHOA|KT\.\s*|TL\.\s*|TM\.\s*|\(Đã\s*ký\))/i.test(
            nextRaw.replace(/[*#]/g, "").trim(),
          );
        if (isSignatureKeyword) {
          collectingRecipients = false;
        }

        if (collectingRecipients) {
          leftRecipientLines.push(nextRaw.replace(/^[-*•]\s*/, "- "));
        } else {
          rightSignatureLines.push(nextRaw);
        }
        i++;
      }

      if (rightSignatureLines.length > 0) {
        blocks.push({
          type: "two_columns",
          leftCol: leftRecipientLines,
          rightCol: rightSignatureLines,
          leftAlign: "left",
          rightAlign: "center",
          borderless: true,
        });
      } else {
        for (const r of leftRecipientLines) {
          blocks.push({ type: "paragraph", text: r, align: "left" });
        }
      }
      i++;
      continue;
    }

    // 5.9. Khối code block markdown (``` ... ```) hoặc sơ đồ ASCII
    if (line.startsWith("```")) {
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        i++;
      }
      if (i < lines.length) i++;
      continue;
    }

    // 6. Đoạn văn bản thông thường (Paragraph)
    const cleanCurrentLine = line.replace(/^#+\s*/, "");
    const paraLines: string[] = [cleanCurrentLine];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i]!.trim();
      if (!nextLine) break;
      const isNextTable = (nextLine.startsWith("|") && nextLine.endsWith("|")) || ((nextLine.match(/\|/g) || []).length >= 2);
      if (
        isNextTable ||
        nextLine.startsWith("```") ||
        /^#{1,6}\s+/.test(nextLine) ||
        /^(?:[-*•]\s+|\d+[\.)]\s+)/.test(nextLine) ||
        /^===+\s*TRANG\s*\d+\s*===+/i.test(nextLine) ||
        /^---+$/.test(nextLine) ||
        /^(?:\*\*|\*|#+)?\s*Nơi nhận\s*:/i.test(nextLine)
      ) {
        break;
      }
      paraLines.push(nextLine.replace(/^#+\s*/, ""));
      i++;
    }

    const fullParaText = paraLines.join(" ");
    blocks.push({
      type: "paragraph",
      text: fullParaText,
      align: "justify",
    });
  }

  return blocks;
}

/**
 * Trích xuất toàn bộ các bảng Markdown từ văn bản hoặc WordBlocks
 * thành headers và rows tương thích cho bảng tính Excel hoặc file CSV
 */
export function extractAllMarkdownTables(
  contentOrBlocks: string | WordBlock[],
  title = "Tài liệu",
): { headers: string[]; rows: Array<Array<string | number>> } | null {
  if (!contentOrBlocks) return null;

  const blocks: WordBlock[] = Array.isArray(contentOrBlocks)
    ? contentOrBlocks
    : parseMarkdownToWordBlocks(contentOrBlocks, title);

  const tableBlocks = blocks.filter(
    (b): b is WordBlock & { type: "table"; tableHeaders: string[]; tableRows: string[][] } =>
      b.type === "table" && Array.isArray(b.tableHeaders) && b.tableHeaders.length > 0 && Array.isArray(b.tableRows),
  );

  if (tableBlocks.length === 0) return null;

  let mainHeaders: string[] = [];
  const allRows: Array<Array<string | number>> = [];

  for (const tb of tableBlocks) {
    if (mainHeaders.length === 0) {
      mainHeaders = tb.tableHeaders.map((h) => h.replace(/\*\*/g, "").trim());
    }

    for (const row of tb.tableRows) {
      // Bỏ qua dòng nếu là dòng lặp lại của tiêu đề giữa các trang
      const isHeaderRepeat =
        row.length === mainHeaders.length &&
        row.every((cell, idx) => String(cell ?? "").replace(/\*\*/g, "").trim().toLowerCase() === mainHeaders[idx]?.toLowerCase());
      if (isHeaderRepeat) continue;

      const cleanedRow: string[] = row.map((cell) => String(cell ?? "").replace(/\*\*/g, "").trim());
      while (cleanedRow.length < mainHeaders.length) {
        cleanedRow.push("");
      }
      allRows.push(cleanedRow.slice(0, mainHeaders.length));
    }
  }

  return mainHeaders.length > 0 && allRows.length > 0 ? { headers: mainHeaders, rows: allRows } : null;
}

export async function generateWordDoc(
  fileName: string,
  title: string,
  sections: Array<{ heading?: string; paragraphs: string[] }> | WordBlock[],
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    cleanOldGeneratedFiles(24);

    const safeName = sanitizeSafeFileName(fileName, "tai_lieu");
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
          // Bảng 2 cột không viền cho thể thức hành chính hoặc phương án trắc nghiệm
          const isLeftCol = block.align === "left" || (block.leftCol || []).some((t) => /^[A-D][\.:]|^[a-d]\)/i.test(t.trim()));
          const defaultAlign = isLeftCol ? AlignmentType.LEFT : AlignmentType.CENTER;
          const leftAlign =
            block.leftAlign === "left"
              ? AlignmentType.LEFT
              : block.leftAlign === "center"
                ? AlignmentType.CENTER
                : block.leftAlign === "right"
                  ? AlignmentType.RIGHT
                  : defaultAlign;
          const rightAlign =
            block.rightAlign === "left"
              ? AlignmentType.LEFT
              : block.rightAlign === "center"
                ? AlignmentType.CENTER
                : block.rightAlign === "right"
                  ? AlignmentType.RIGHT
                  : defaultAlign;
          const colSize = isLeftCol ? 26 : 24;

          const leftParas = (block.leftCol || []).map(
            (t) =>
              new Paragraph({
                children: parseMarkdownRuns(t, "Times New Roman", colSize),
                alignment: leftAlign,
                spacing: { after: isLeftCol ? 40 : 60 },
              }),
          );
          const rightParas = (block.rightCol || []).map(
            (t) =>
              new Paragraph({
                children: parseMarkdownRuns(t, "Times New Roman", colSize),
                alignment: rightAlign,
                spacing: { after: isLeftCol ? 40 : 60 },
              }),
          );

          const noneBorder = { style: BorderStyle.NONE, size: 0, color: "auto" };
          const borders = { top: noneBorder, bottom: noneBorder, left: noneBorder, right: noneBorder };
          const borderlessTableBorders = {
            top: noneBorder,
            bottom: noneBorder,
            left: noneBorder,
            right: noneBorder,
            insideHorizontal: noneBorder,
            insideVertical: noneBorder,
          };

          const twoColTable = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: borderlessTableBorders,
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
          docChildren.push(new Paragraph({ spacing: { after: isLeftCol ? 80 : 200 } }));
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
              children: parseMarkdownRuns(block.text || "", "Times New Roman", 26),
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
          const isBorderless = Boolean(block.borderless);
          const borderConfig = isBorderless
            ? { style: BorderStyle.NONE, size: 0, color: "auto" }
            : { style: BorderStyle.SINGLE, size: 1, color: "888888" };
          const cellBorders = { top: borderConfig, bottom: borderConfig, left: borderConfig, right: borderConfig };
          const colCount = Math.max(block.tableHeaders.length, ...block.tableRows.map((r) => r.length), 1);
          const colWidthPct = Math.floor(100 / colCount);

          const headerRow = new TableRow({
            tableHeader: true,
            children: block.tableHeaders.map(
              (h) =>
                new TableCell({
                  width: { size: colWidthPct, type: WidthType.PERCENTAGE },
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: h.replace(/\*\*/g, ""), bold: true, font: "Times New Roman", size: 22 })],
                      alignment: AlignmentType.CENTER,
                    }),
                  ],
                  shading: isBorderless ? undefined : { fill: "D9E1F2" },
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
                      width: { size: colWidthPct, type: WidthType.PERCENTAGE },
                      children: [
                        new Paragraph({
                          children: parseMarkdownRuns(String(c ?? "").trim(), "Times New Roman", 22),
                        }),
                      ],
                      borders: cellBorders,
                    }),
                ),
              }),
          );

          const noneBorder = { style: BorderStyle.NONE, size: 0, color: "auto" };
          const borderlessTableBorders = {
            top: noneBorder,
            bottom: noneBorder,
            left: noneBorder,
            right: noneBorder,
            insideHorizontal: noneBorder,
            insideVertical: noneBorder,
          };
          const tableBorders = isBorderless ? borderlessTableBorders : undefined;

          docChildren.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: tableBorders,
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

    const safeName = sanitizeSafeFileName(fileName, "bang_tinh");
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

    const safeName = sanitizeSafeFileName(fileName, "du_lieu");
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

    const safeName = sanitizeSafeFileName(fileName, "trang_web");
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
    const rawBase = fileName.replace(/\.[a-zA-Z0-9]+$/, "");
    const baseName = sanitizeSafeFileName(rawBase, "tai_lieu");
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

// ==========================================
// 7. TẠO FILE MARKDOWN (.md) CHUẨN HOÁ
// ==========================================

export async function generateMarkdownFile(
  fileName: string,
  title: string,
  content: string,
): Promise<GeneratedFileResult> {
  try {
    ensureOutputDir();
    cleanOldGeneratedFiles(24);

    const rawBase = fileName.replace(/\.[a-zA-Z0-9]+$/, "");
    const baseName = sanitizeSafeFileName(rawBase, "tai_lieu_markdown");
    const fullFileName = `${baseName}.md`;
    const targetPath = path.join(GENERATED_FILES_DIR, fullFileName);

    let cleanContent = content.trim();
    // Gỡ bỏ bọc code block markdown ngoài cùng nếu có
    if (cleanContent.startsWith("```markdown") && cleanContent.endsWith("```")) {
      cleanContent = cleanContent.slice(11, -3).trim();
    } else if (cleanContent.startsWith("```md") && cleanContent.endsWith("```")) {
      cleanContent = cleanContent.slice(5, -3).trim();
    }

    // Đảm bảo có tiêu đề H1 ở đầu nếu nội dung chưa có
    if (title && !cleanContent.startsWith("# ")) {
      cleanContent = `# ${title.trim()}\n\n${cleanContent}`;
    }

    // Thêm footer ghi chú ngày tạo
    const nowStr = new Date().toLocaleDateString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const finalContent = `${cleanContent}\n\n---\n*Tài liệu được xuất tự động vào lúc ${nowStr}*`;

    fs.writeFileSync(targetPath, finalContent, "utf8");
    const stats = fs.statSync(targetPath);

    return {
      success: true,
      filePath: targetPath,
      fileName: fullFileName,
      fileSize: stats.size,
      caption: `📄 Đã xuất xong file Markdown [${fullFileName}]!`,
    };
  } catch (err: any) {
    console.error("[file-generator] Lỗi tạo file markdown:", err);
    return {
      success: false,
      filePath: "",
      fileName: `${fileName}.md`,
      fileSize: 0,
      message: String(err?.message || err),
    };
  }
}


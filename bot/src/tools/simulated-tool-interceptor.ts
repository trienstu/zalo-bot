/**
 * Module Phòng Thủ Chiều Sâu (Defense-in-Depth Safety Net)
 * Bắt và thực thi tự động các cuộc gọi tool giả lập (Simulated Tool Calls)
 * như `[generate_file(...)]` nếu LLM vô tình in text thô thay vì gọi Function Calling native.
 */

import { executeAgentTool } from "../gemini.js";
import type { GeneratedFileResult } from "./file-generator.js";

export interface ExtractedToolCall {
  toolName: "generate_file";
  args: {
    fileType?: string;
    content?: string;
    title?: string;
    fileName?: string;
    [key: string]: any;
  };
  rawMatch: string;
}

/**
 * Bóc tách lệnh generate_file từ text thô
 */
export function extractSimulatedGenerateFile(text: string): ExtractedToolCall | null {
  if (!text) return null;

  // Khớp cả cú pháp tag: [generate_file ... /] hoặc <generate_file ... /> lẫn cú pháp hàm: generate_file(...)
  const tagMatch = text.match(/\[\s*generate_file\b([\s\S]*?)\/\s*\]/i) ||
                   text.match(/<\s*generate_file\b([\s\S]*?)\/\s*>/i) ||
                   text.match(/\[\s*generate_file\b([\s\S]*?)\]/i) ||
                   text.match(/<\s*generate_file\b([\s\S]*?)>/i);
  const funcMatch = text.match(/\[?\bgenerate_file\s*\(([\s\S]*?)\)\]?/i);

  const match = tagMatch || funcMatch;
  if (!match) return null;

  const inner = match[1] || "";
  const args: Record<string, string> = {};

  // Trích xuất fileType
  const fileTypeMatch = inner.match(/fileType\s*=\s*['"]([a-zA-Z0-9]+)['"]/i);
  if (fileTypeMatch && fileTypeMatch[1]) {
    args.fileType = fileTypeMatch[1];
  }

  // Trích xuất content (hỗ trợ cả triple quotes ''' hoặc """ và single/double quotes)
  const contentTripleMatch = inner.match(/content\s*=\s*(?:'''|""")([\s\S]*?)(?:'''|""")/i);
  if (contentTripleMatch && contentTripleMatch[1]) {
    args.content = contentTripleMatch[1].trim();
  } else {
    // Fallback nếu không dùng triple quotes, ưu tiên quote trước attribute khác hoặc cuối tag
    const contentQuoteMatch = inner.match(/content\s*=\s*(['"])([\s\S]*?)\1(?=\s*(?:[a-zA-Z_]+\s*=|(?:\/\]|\]|>|$)))/i) ||
                              inner.match(/content\s*=\s*(['"])([\s\S]*?)\1/i);
    if (contentQuoteMatch && contentQuoteMatch[2]) {
      args.content = contentQuoteMatch[2].trim();
    }
  }

  // Trích xuất title
  const titleMatch = inner.match(/title\s*=\s*(?:'''|""")(.*?)(?:'''|""")|title\s*=\s*(['"])(.*?)\2/i);
  if (titleMatch) {
    const titleVal = titleMatch[1] || titleMatch[3] || "";
    if (titleVal.trim()) args.title = titleVal.trim();
  }

  // Trích xuất fileName
  const fileNameMatch = inner.match(/fileName\s*=\s*(?:'''|""")(.*?)(?:'''|""")|fileName\s*=\s*(['"])(.*?)\2/i);
  if (fileNameMatch) {
    const fileNameVal = fileNameMatch[1] || fileNameMatch[3] || "";
    if (fileNameVal.trim()) args.fileName = fileNameVal.trim();
  }

  // Nếu không có nội dung và không có fileType thì không phải lệnh hợp lệ
  if (!args.fileType && !args.content) return null;

  return {
    toolName: "generate_file",
    args,
    rawMatch: match[0],
  };
}

export interface ExtractedVoiceCall {
  toolName: "create_voice";
  args: {
    text: string;
    voice?: string;
    caption?: string;
    [key: string]: any;
  };
  rawMatch: string;
}

/**
 * Bóc tách lệnh create_voice từ text thô
 */
export function extractSimulatedCreateVoice(text: string): ExtractedVoiceCall | null {
  if (!text) return null;

  // Khớp cả cú pháp tag: [create_voice ... /] hoặc <create_voice ... /> lẫn cú pháp hàm: create_voice(...)
  const tagMatch = text.match(/\[\s*create_voice\b([\s\S]*?)\/\s*\]/i) ||
                   text.match(/<\s*create_voice\b([\s\S]*?)\/\s*>/i) ||
                   text.match(/\[\s*create_voice\b([\s\S]*?)\]/i) ||
                   text.match(/<\s*create_voice\b([\s\S]*?)>/i);
  const funcMatch = text.match(/\[?\bcreate_voice\s*\(([\s\S]*?)\)\]?/i);

  const match = tagMatch || funcMatch;
  if (!match) return null;

  const inner = match[1] || "";
  const args: Record<string, string> = {};

  // Trích xuất text (hỗ trợ cả triple quotes ''' hoặc """ và single/double quotes)
  const textTripleMatch = inner.match(/text\s*=\s*(?:'''|""")([\s\S]*?)(?:'''|""")/i);
  if (textTripleMatch && textTripleMatch[1]) {
    args.text = textTripleMatch[1].trim();
  } else {
    // Ưu tiên quote trước attribute khác hoặc cuối tag
    const textQuoteMatch = inner.match(/text\s*=\s*(['"])([\s\S]*?)\1(?=\s*(?:[a-zA-Z_]+\s*=|(?:\/\]|\]|>|$)))/i) ||
                           inner.match(/text\s*=\s*(['"])([\s\S]*?)\1/i);
    if (textQuoteMatch && textQuoteMatch[2]) {
      args.text = textQuoteMatch[2].trim();
    }
  }

  // Trích xuất voice
  const voiceMatch = inner.match(/\bvoice\s*=\s*(['"])(.*?)\1/i);
  if (voiceMatch && voiceMatch[2]) {
    args.voice = voiceMatch[2].trim();
  }

  // Trích xuất voice_style hoặc style
  const styleMatch = inner.match(/\b(?:voice_style|style)\s*=\s*(['"])(.*?)\1/i);
  if (styleMatch && styleMatch[2]) {
    args.voice_style = styleMatch[2].trim();
  }

  // Trích xuất caption
  const captionMatch = inner.match(/caption\s*=\s*(?:'''|""")(.*?)(?:'''|""")|caption\s*=\s*(['"])(.*?)\2/i);
  if (captionMatch) {
    const captionVal = captionMatch[1] || captionMatch[3] || "";
    if (captionVal.trim()) args.caption = captionVal.trim();
  }

  if (!args.text) return null;

  return {
    toolName: "create_voice",
    args: args as any,
    rawMatch: match[0],
  };
}

/**
 * Chặn và thực thi tool giả lập ngầm, gửi file/voice và làm sạch văn bản chat
 */
export async function interceptAndExecuteSimulatedTool(
  text: string,
  onFileGenerated?: (file: GeneratedFileResult | any) => Promise<void>,
): Promise<string> {
  // 1. Kiểm tra create_voice giả lập trước
  const voiceExtracted = extractSimulatedCreateVoice(text);
  if (voiceExtracted && voiceExtracted.args.text) {
    try {
      console.log(
        `[simulated-tool-interceptor] 🛡️ Phát hiện [create_voice] thô trong output text! ` +
        `Kích hoạt tạo voice ngầm: text=${voiceExtracted.args.text.length} chars, voice=${voiceExtracted.args.voice || "auto"}, style=${voiceExtracted.args.voice_style || "natural"}`,
      );

      const result = await executeAgentTool("create_voice", {
        text: voiceExtracted.args.text,
        voice: voiceExtracted.args.voice,
        voice_style: voiceExtracted.args.voice_style,
        caption: voiceExtracted.args.caption,
      });

      if (result?.success && onFileGenerated) {
        try {
          await onFileGenerated(result);
        } catch (sendErr) {
          console.warn("[simulated-tool-interceptor] Lỗi gửi voice qua onFileGenerated:", sendErr);
        }
      }

      let cleanedText = text.replace(voiceExtracted.rawMatch, "").trim();
      if (
        !cleanedText ||
        /^(?:anh|chị|bác|sếp|bạn)?\s*(?:đã\s+)?(?:nghe|nhận|thấy)\s*(?:được\s+)?(?:voice|bản\s*thu)\s*(?:chưa|chưa\s*ạ)?\s*[?]?$/i.test(cleanedText)
      ) {
        cleanedText = "🎙️ Em đã thu âm và gửi bản đọc truyền cảm vào nhóm rồi nhé!";
      }
      return cleanedText;
    } catch (err) {
      console.warn("[simulated-tool-interceptor] Lỗi thực thi simulated create_voice:", err);
    }
  }

  // 2. Kiểm tra generate_file giả lập
  const extracted = extractSimulatedGenerateFile(text);
  if (!extracted || !extracted.args.content) {
    return text;
  }

  try {
    const fileType = extracted.args.fileType || "docx";
    const content = extracted.args.content;
    const title = extracted.args.title || "Tài liệu";
    const fileName = extracted.args.fileName || (fileType === "docx" ? "tai_lieu.docx" : `tai_lieu.${fileType}`);

    console.log(
      `[simulated-tool-interceptor] 🛡️ Phát hiện [generate_file] thô trong output text! ` +
      `Kích hoạt thực thi ngầm: fileType=${fileType}, fileName=${fileName}, content=${content.length} chars`,
    );

    const result = await executeAgentTool("generate_file", {
      fileType,
      content,
      title,
      fileName,
    });

    if (result?.success && onFileGenerated) {
      try {
        await onFileGenerated(result);
      } catch (sendErr) {
        console.warn("[simulated-tool-interceptor] Lỗi gửi file qua onFileGenerated:", sendErr);
      }
    }

    // Xóa đoạn gọi tool thô khỏi tin nhắn chat
    let cleanedText = text.replace(extracted.rawMatch, "").trim();

    // Nếu sau khi xóa, tin nhắn chỉ còn câu hỏi dạng "Anh đã tải được file chưa?",
    // thay bằng câu xác nhận hoàn tất lịch sự, rõ ràng:
    if (
      !cleanedText ||
      /^(?:anh|chị|bác|sếp|bạn)?\s*(?:đã\s+)?(?:tải|nhận|thấy)\s*(?:được\s+)?file\s*(?:chưa|chưa\s*ạ)?\s*[?]?$/i.test(cleanedText)
    ) {
      cleanedText = `📄 Em đã đóng gói toàn bộ nội dung chi tiết vào file [${result?.fileName || fileName}] và gửi lên nhóm rồi nhé!`;
    }

    return cleanedText;
  } catch (err) {
    console.warn("[simulated-tool-interceptor] Lỗi thực thi simulated tool:", err);
    return text;
  }
}

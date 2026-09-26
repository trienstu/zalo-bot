/**
 * Module Phòng Thủ Chiều Sâu (Defense-in-Depth Safety Net)
 * Bắt và thực thi tự động các cuộc gọi tool giả lập (Simulated Tool Calls)
 * như `[generate_file(...)]` nếu LLM vô tình in text thô thay vì gọi Function Calling native.
 */

import fs from "node:fs";
import path from "node:path";
import { executeAgentTool } from "../gemini.js";
import type { GeneratedFileResult } from "./file-generator.js";
import { cleanCoreSpeechText } from "./voice-generator.js";
import { isMusicConfigured } from "./music-generator.js";

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

export interface ExtractedPythonCall {
  toolName: "python_interpreter";
  code: string;
  rawMatch: string;
}

/**
 * Bóc tách mã Python giả lập từ text thô (khi LLM in [python_interpreter]...)
 */
export function extractSimulatedPythonInterpreter(text: string): ExtractedPythonCall | null {
  if (!text) return null;

  // 1. Tag đóng mở hoàn chỉnh: [python_interpreter]...[/python_interpreter] hoặc <python_interpreter>...</python_interpreter>
  const fullTagMatch =
    text.match(/\[\s*python_interpreter\b([\s\S]*?)\]([\s\S]*?)\[\/\s*python_interpreter\s*\]/i) ||
    text.match(/<\s*python_interpreter\b([\s\S]*?)>([\s\S]*?)<\/\s*python_interpreter\s*>/i);

  if (fullTagMatch && fullTagMatch[2]) {
    let code = fullTagMatch[2].trim();
    const fenceMatch = code.match(/```(?:python)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
      code = fenceMatch[1].trim();
    }
    if (code) {
      return {
        toolName: "python_interpreter",
        code,
        rawMatch: fullTagMatch[0],
      };
    }
  }

  // 2. Cú pháp hàm: [python_interpreter(code="...")] hoặc python_interpreter(code="...")
  const funcTripleMatch = text.match(/\[?\bpython_interpreter\s*\(\s*code\s*=\s*(?:'''|""")([\s\S]*?)(?:'''|""")\s*\)\]?/i);
  if (funcTripleMatch && funcTripleMatch[1]) {
    return {
      toolName: "python_interpreter",
      code: funcTripleMatch[1].trim(),
      rawMatch: funcTripleMatch[0],
    };
  }

  const funcQuoteMatch = text.match(/\[?\bpython_interpreter\s*\(\s*code\s*=\s*(['"])([\s\S]*?)\1\s*\)\]?/i);
  if (funcQuoteMatch && funcQuoteMatch[2]) {
    return {
      toolName: "python_interpreter",
      code: funcQuoteMatch[2].trim(),
      rawMatch: funcQuoteMatch[0],
    };
  }

  // 3. Cú pháp tag mở [python_interpreter] kèm khối markdown hoặc code trực tiếp
  const openTagMatch = text.match(/\[\s*python_interpreter\s*\]([\s\S]*)/i) ||
                       text.match(/<\s*python_interpreter\s*>([\s\S]*)/i);
  if (openTagMatch && openTagMatch.index !== undefined) {
    const remainder = openTagMatch[1] || "";
    const fenceMatch = remainder.match(/```(?:python)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
      const code = fenceMatch[1].trim();
      const rawMatch = text.slice(openTagMatch.index, openTagMatch.index + openTagMatch[0].length + remainder.indexOf(fenceMatch[0]) + fenceMatch[0].length);
      return {
        toolName: "python_interpreter",
        code,
        rawMatch,
      };
    }

    // Không có markdown fence, trích xuất các dòng mã python liên tục
    const lines = remainder.split("\n");
    const codeLines: string[] = [];
    let isCode = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed && !isCode) continue;
      if (
        /^(?:import\s+|from\s+|def\s+|class\s+|plt\.|fig|ax|img|draw|Image|font|#)/.test(trimmed) ||
        (isCode && (line.startsWith(" ") || line.startsWith("\t") || trimmed === "" || /^[a-zA-Z_0-9]+(?:\.[a-zA-Z_0-9]+)?\s*=\s*/.test(trimmed) || trimmed.startsWith("plt.") || trimmed.startsWith("img.") || trimmed.startsWith("draw.") || trimmed.startsWith("print(")))
      ) {
        isCode = true;
        codeLines.push(line);
      } else if (isCode && trimmed.length > 0) {
        break;
      }
    }
    const code = codeLines.join("\n").trim();
    if (code && (code.includes("plt.") || code.includes("matplotlib") || code.includes("PIL") || code.includes("Image"))) {
      const rawMatch = text.slice(openTagMatch.index, openTagMatch.index + openTagMatch[0].length + code.length);
      return {
        toolName: "python_interpreter",
        code,
        rawMatch,
      };
    }
  }

  return null;
}

export interface ExtractedImageCall {
  toolName: "generate_image";
  args: {
    prompt: string;
    aspectRatio?: string;
    imageUrl?: string;
    isEdit?: boolean;
    [key: string]: any;
  };
  rawMatch: string;
}

/**
 * Bóc tách lệnh generate_image từ text thô nếu model in ra thay vì gọi Function Calling
 */
export function extractSimulatedGenerateImage(text: string): ExtractedImageCall | null {
  if (!text) return null;

  const tagMatch =
    text.match(/\[\s*generate_image\b([\s\S]*?)\/\s*\]/i) ||
    text.match(/<\s*generate_image\b([\s\S]*?)\/\s*>/i) ||
    text.match(/\[\s*generate_image\b([\s\S]*?)\]/i) ||
    text.match(/<\s*generate_image\b([\s\S]*?)>/i);
  const funcMatch = text.match(/\[?\bgenerate_image\s*\(([\s\S]*?)\)\]?/i);

  const match = tagMatch || funcMatch;
  if (!match) return null;

  const inner = match[1] || "";
  const args: Record<string, any> = {};

  const promptTripleMatch = inner.match(/prompt\s*=\s*(?:'''|""")([\s\S]*?)(?:'''|""")/i);
  if (promptTripleMatch && promptTripleMatch[1]) {
    args.prompt = promptTripleMatch[1].trim();
  } else {
    const promptQuoteMatch =
      inner.match(/prompt\s*=\s*(['"])([\s\S]*?)\1(?=\s*(?:[a-zA-Z_]+\s*=|(?:\/\]|\]|>|$)))/i) ||
      inner.match(/prompt\s*=\s*(['"])([\s\S]*?)\1/i);
    if (promptQuoteMatch && promptQuoteMatch[2]) {
      args.prompt = promptQuoteMatch[2].trim();
    }
  }

  const ratioMatch = inner.match(/aspectRatio\s*=\s*['"]([0-9:]+)['"]/i);
  if (ratioMatch && ratioMatch[1]) {
    args.aspectRatio = ratioMatch[1];
  }

  const isEditMatch = inner.match(/isEdit\s*=\s*(true|false)/i);
  if (isEditMatch && isEditMatch[1]) {
    args.isEdit = isEditMatch[1].toLowerCase() === "true";
  }

  const imageUrlMatch = inner.match(/imageUrl\s*=\s*['"]([^'"]+)['"]/i);
  if (imageUrlMatch && imageUrlMatch[1]) {
    args.imageUrl = imageUrlMatch[1].trim();
  }

  if (!args.prompt) return null;

  return {
    toolName: "generate_image",
    args: {
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      imageUrl: args.imageUrl,
      isEdit: args.isEdit,
    },
    rawMatch: match[0],
  };
}

/**
 * Bóc tách lệnh generate_music từ text thô
 */
export function extractSimulatedGenerateMusic(text: string): {
  toolName: "generate_music";
  args: {
    prompt: string;
    lyrics?: string;
    style?: string;
    title?: string;
    instrumental?: boolean;
  };
  rawMatch: string;
} | null {
  if (!text) return null;

  const tagMatch =
    text.match(/\[\s*generate_music\b([\s\S]*?)\/\s*\]/i) ||
    text.match(/<\s*generate_music\b([\s\S]*?)\/\s*>/i) ||
    text.match(/\[\s*generate_music\b([\s\S]*?)\]/i) ||
    text.match(/<\s*generate_music\b([\s\S]*?)>/i);
  const funcMatch = text.match(/\[?\bgenerate_music\s*\(([\s\S]*?)\)\]?/i);

  const match = tagMatch || funcMatch;
  if (!match) return null;

  const inner = match[1] || "";
  const args: Record<string, any> = {};

  const promptTripleMatch = inner.match(/prompt\s*=\s*(?:'''|""")([\s\S]*?)(?:'''|""")/i);
  if (promptTripleMatch && promptTripleMatch[1]) {
    args.prompt = promptTripleMatch[1].trim();
  } else {
    const promptQuoteMatch =
      inner.match(/prompt\s*=\s*(['"])([\s\S]*?)\1(?=\s*(?:[a-zA-Z_]+\s*=|(?:\/\]|\]|>|$)))/i) ||
      inner.match(/prompt\s*=\s*(['"])([\s\S]*?)\1/i);
    if (promptQuoteMatch && promptQuoteMatch[2]) {
      args.prompt = promptQuoteMatch[2].trim();
    }
  }

  const lyricsTripleMatch = inner.match(/lyrics\s*=\s*(?:'''|""")([\s\S]*?)(?:'''|""")/i);
  if (lyricsTripleMatch && lyricsTripleMatch[1]) {
    args.lyrics = lyricsTripleMatch[1].trim();
  } else {
    const lyricsQuoteMatch =
      inner.match(/lyrics\s*=\s*(['"])([\s\S]*?)\1(?=\s*(?:[a-zA-Z_]+\s*=|(?:\/\]|\]|>|$)))/i) ||
      inner.match(/lyrics\s*=\s*(['"])([\s\S]*?)\1/i);
    if (lyricsQuoteMatch && lyricsQuoteMatch[2]) {
      args.lyrics = lyricsQuoteMatch[2].trim();
    }
  }

  const styleMatch = inner.match(/style\s*=\s*['"]([^'"]+)['"]/i);
  if (styleMatch && styleMatch[1]) {
    args.style = styleMatch[1].trim();
  }

  const titleMatch = inner.match(/title\s*=\s*['"]([^'"]+)['"]/i);
  if (titleMatch && titleMatch[1]) {
    args.title = titleMatch[1].trim();
  }

  const instrumentalMatch = inner.match(/instrumental\s*=\s*(true|false)/i);
  if (instrumentalMatch && instrumentalMatch[1]) {
    args.instrumental = instrumentalMatch[1].toLowerCase() === "true";
  }

  if (!args.prompt && !args.lyrics) return null;

  return {
    toolName: "generate_music",
    args: {
      prompt: args.prompt || args.lyrics || "Bài hát AI",
      lyrics: args.lyrics,
      style: args.style,
      title: args.title,
      instrumental: args.instrumental,
    },
    rawMatch: match[0],
  };
}

/**
 * Chặn và thực thi tool giả lập ngầm, gửi file/voice/nhạc và làm sạch văn bản chat
 */
export async function interceptAndExecuteSimulatedTool(
  text: string,
  onFileGenerated?: (file: GeneratedFileResult | any) => Promise<void>,
): Promise<string> {
  // 0.5. Kiểm tra generate_music giả lập
  const musicExtracted = extractSimulatedGenerateMusic(text);
  if (musicExtracted && (musicExtracted.args.prompt || musicExtracted.args.lyrics)) {
    try {
      console.log(
        `[simulated-tool-interceptor] 🛡️ Phát hiện [generate_music] thô trong output text! ` +
        `Kích hoạt tạo nhạc ngầm: prompt="${(musicExtracted.args.prompt || "").slice(0, 45)}...", style=${musicExtracted.args.style || "pop"}`,
      );

      const result = await executeAgentTool("generate_music", musicExtracted.args);
      if (result?.success && onFileGenerated) {
        try {
          await onFileGenerated({
            ...result,
            isMusic: true,
          });
        } catch (fileErr) {
          console.warn("[simulated-tool-interceptor] Lỗi gửi nhạc qua onFileGenerated:", fileErr);
        }
      }

      let cleanedText = text.replace(musicExtracted.rawMatch, "").trim();
      if (
        !cleanedText ||
        /^(?:anh|chị|bác|sếp|bạn)?\s*(?:đã\s+)?(?:nghe|nhận|thấy)\s*(?:được\s+)?(?:nhạc|bài hát|track)\s*(?:chưa|chưa\s*ạ)?\s*[?]?$/i.test(cleanedText)
      ) {
        cleanedText = `🎵 Em đã sáng tác bài hát [${result?.title || "Suno AI"}] và gửi vào nhóm rồi nhé! ✨`;
      }
      return cleanedText;
    } catch (err) {
      console.warn("[simulated-tool-interceptor] Lỗi thực thi simulated generate_music:", err);
    }
  }

  // 1. Kiểm tra create_voice giả lập trước
  const voiceExtracted = extractSimulatedCreateVoice(text);
  if (voiceExtracted && voiceExtracted.args.text) {
    try {
      const isSongScript =
        /(?:bài\s*hát\s*:|sáng\s*tác\s*:|nhạc\s*dạo|\[điệp\s*khúc\]|\[khổ\s*\d|\[verse|\[chorus)/i.test(voiceExtracted.args.text);

      if (isSongScript && isMusicConfigured()) {
        console.log(
          `[simulated-tool-interceptor] 🎵 Phát hiện kịch bản bài hát/giai điệu trong [create_voice] giả lập! ` +
          `Tự động chuyển tiếp sang công cụ Suno AI generate_music...`,
        );

        const titleMatch = voiceExtracted.args.text.match(/(?:bài\s*hát\s*:\s*|title\s*=\s*['"]?)([^.\n\r]+)/i);
        const songTitle = (titleMatch?.[1] || "Bài hát AI").replace(/[^\p{L}\p{N}\s_-]/gu, "").trim();

        const musicResult = await executeAgentTool("generate_music", {
          prompt: songTitle || "Bài hát AI",
          lyrics: voiceExtracted.args.text,
          title: songTitle || "Bài hát AI",
          style: "vietnamese, pop, ballad",
        });

        if (musicResult?.success && onFileGenerated) {
          try {
            await onFileGenerated({
              ...musicResult,
              isMusic: true,
            });
          } catch (fileErr) {
            console.warn("[simulated-tool-interceptor] Lỗi gửi nhạc qua onFileGenerated:", fileErr);
          }
        }

        let cleanedText = text.replace(voiceExtracted.rawMatch, "").trim();
        if (
          !cleanedText ||
          /^(?:anh|chị|bác|sếp|bạn)?\s*(?:đã\s+)?(?:nghe|nhận|thấy)\s*(?:được\s+)?(?:nhạc|bài hát|track|voice)\s*(?:chưa|chưa\s*ạ)?\s*[?]?$/i.test(cleanedText)
        ) {
          cleanedText = `🎵 Em đã sáng tác bài hát [${musicResult?.title || songTitle}] và gửi vào nhóm rồi nhé! ✨`;
        }
        return cleanedText;
      }

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

  // 2. Kiểm tra python_interpreter giả lập (vẽ biểu đồ, infographic, poster...)
  const pythonExtracted = extractSimulatedPythonInterpreter(text);
  if (pythonExtracted && pythonExtracted.code) {
    try {
      console.log(
        `[simulated-tool-interceptor] 🛡️ Phát hiện [python_interpreter] thô trong output text! ` +
        `Kích hoạt thực thi ngầm: code=${pythonExtracted.code.length} chars`,
      );

      const result = await executeAgentTool("python_interpreter", {
        code: pythonExtracted.code,
      });

      if (result?.success && onFileGenerated) {
        const allFiles = [...(result.generatedImages || []), ...(result.generatedFiles || [])];
        for (const itemPath of allFiles) {
          try {
            await onFileGenerated({
              success: true,
              filePath: itemPath,
              fileName: path.basename(itemPath),
              fileSize: fs.existsSync(itemPath) ? fs.statSync(itemPath).size : 0,
            });
          } catch (fileErr) {
            console.warn("[simulated-tool-interceptor] Lỗi gửi file python qua onFileGenerated:", fileErr);
          }
        }
      }

      let cleanedText = text.replace(pythonExtracted.rawMatch, "").trim();
      if (
        !cleanedText ||
        /^(?:anh|chị|bác|sếp|bạn)?\s*(?:đã\s+)?(?:nhận|thấy)\s*(?:được\s+)?(?:ảnh|poster|biểu đồ|hình)\s*(?:chưa|chưa\s*ạ)?\s*[?]?$/i.test(cleanedText)
      ) {
        cleanedText = "🎨 Em đã thiết kế hình ảnh/poster theo yêu cầu và gửi lên nhóm rồi nhé! ✨";
      }
      return cleanedText;
    } catch (err) {
      console.warn("[simulated-tool-interceptor] Lỗi thực thi simulated python_interpreter:", err);
    }
  }

  // 3. Kiểm tra generate_image giả lập
  const imgExtracted = extractSimulatedGenerateImage(text);
  if (imgExtracted && imgExtracted.args.prompt) {
    try {
      console.log(
        `[simulated-tool-interceptor] 🛡️ Phát hiện [generate_image] thô trong output text! ` +
        `Kích hoạt tạo ảnh ngầm: prompt="${imgExtracted.args.prompt.slice(0, 45)}...", ratio=${imgExtracted.args.aspectRatio || "1:1"}`,
      );

      const result = await executeAgentTool("generate_image", imgExtracted.args);
      if (result?.success && onFileGenerated) {
        try {
          await onFileGenerated(result);
        } catch (fileErr) {
          console.warn("[simulated-tool-interceptor] Lỗi gửi ảnh qua onFileGenerated:", fileErr);
        }
      }

      let cleanedText = text.replace(imgExtracted.rawMatch, "").trim();
      if (
        !cleanedText ||
        /^(?:anh|chị|bác|sếp|bạn)?\s*(?:đã\s+)?(?:nhận|thấy)\s*(?:được\s+)?(?:ảnh|bức ảnh|tấm ảnh|hình)\s*(?:chưa|chưa\s*ạ)?\s*[?]?$/i.test(cleanedText)
      ) {
        cleanedText = "🎨 Em đã tạo ảnh theo yêu cầu và gửi lên rồi nhé! ✨";
      }
      return cleanedText;
    } catch (err) {
      console.warn("[simulated-tool-interceptor] Lỗi thực thi simulated generate_image:", err);
    }
  }

  // 4. Kiểm tra generate_file giả lập
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

/**
 * Trích xuất phần nội dung văn bản cốt lõi (bài thơ, tác giả, kịch bản đối thoại, truyện, bản tin)
 * từ câu trả lời của AI để tạo voice tự động dự phòng nếu AI quên gọi tool create_voice
 */
export function extractSpeechFallbackText(answer: string): string {
  return cleanCoreSpeechText(answer);
}

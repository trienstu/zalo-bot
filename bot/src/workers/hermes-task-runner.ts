import fs from "node:fs";
import path from "node:path";
import { sendDirectFile, sendDirectText, sendGroupFile, sendGroupText } from "../zalo/client.js";

export interface HermesTaskOptions {
  api: any;
  sender: string;
  isGroup: boolean;
  threadId?: string;
  displayName: string;
  userGreeting: string;
  userPrompt: string;
  quoteText?: string;
}

/**
 * Kiểm tra xem tin nhắn có phải lệnh /tasks hoặc /task hay không
 */
export function parseHermesTaskCommand(text: string): { isTask: boolean; taskPrompt: string } {
  const trimmed = (text || "").trim();
  const match = trimmed.match(/^[\/!](?:tasks?)\b\s*([\s\S]*)$/i);
  if (match) {
    return {
      isTask: true,
      taskPrompt: match[1]?.trim() || "",
    };
  }
  return { isTask: false, taskPrompt: "" };
}

/**
 * Điều phối thực thi tác vụ đa bước tự chủ qua Hermes Agent Gateway
 */
export async function runHermesTaskJob(options: HermesTaskOptions): Promise<void> {
  const targetId = options.isGroup ? String(options.threadId || "").trim() : options.sender;
  if (!targetId) return;

  const shortPrompt = options.userPrompt.length > 100
    ? `${options.userPrompt.slice(0, 100)}...`
    : options.userPrompt;

  // 1. Gửi phản hồi xác nhận ngay lập tức cho người dùng
  const ackMessage =
    `🚀 [Hermes Task Engine]: Đã nhận tác vụ từ ${options.userGreeting}!\n` +
    `📋 Nhiệm vụ: "${shortPrompt}"\n` +
    `⏳ Hệ thống đang lập kế hoạch ReAct và điều phối các công cụ thực thi ngầm trong sandbox (có thể mất từ 30s - 120s). Sau khi hoàn thành, bot sẽ gửi file và báo cáo kết quả ngay nhé!`;

  try {
    if (options.isGroup) {
      await sendGroupText(options.api, targetId, ackMessage);
    } else {
      await sendDirectText(options.api, targetId, ackMessage);
    }
  } catch (err) {
    console.warn(`[hermes-task] Không thể gửi tin nhắn xác nhận:`, err);
  }

  // 2. Chuẩn bị thư mục chia sẻ file
  const sharedDir = "/home/ubuntu/shared-assets";
  try {
    if (!fs.existsSync(sharedDir)) {
      fs.mkdirSync(sharedDir, { recursive: true });
    }
  } catch {}

  // 3. Chuẩn bị prompt hoàn chỉnh cho Hermes
  let combinedPrompt = options.userPrompt;
  if (options.quoteText) {
    combinedPrompt += `\n\n[DỮ LIỆU ĐÍNH KÈM / TRÍCH DẪN TỪ TIN NHẮN TRƯỚC]:\n${options.quoteText}`;
  }

  const systemPrompt =
    `Bạn là Hermes Autonomous Agent - Hệ thống Trợ lý Tác nhân Tự chủ Cấp cao kết nối với Zalo Bot.\n` +
    `NHIỆM VỤ: Phân tích yêu cầu của người dùng, tự lập kế hoạch đa bước và tự động sử dụng các công cụ có sẵn (terminal, execute_code, web_search, read_file, write_file, browser_exec, vision_analyze...) để giải quyết trọn vẹn bài toán.\n\n` +
    `QUY TẮC XUẤT FILE & TÀI NGUYÊN:\n` +
    `1. Nếu tác vụ yêu cầu tạo ra file thành phẩm (PowerPoint .pptx, Excel .xlsx, Word .docx, PDF, Video .mp4, Hình ảnh .png/.jpg, File nén .zip):\n` +
    `   - Hãy lưu file trực tiếp vào thư mục: ${sharedDir} hoặc /tmp/\n` +
    `   - Tên file viết không dấu, dùng gạch dưới rõ ràng (ví dụ: ${sharedDir}/phong_chong_ma_tuy_18_slide.pptx)\n` +
    `   - Trong câu trả lời cuối cùng, BẮT BUỘC ghi rõ dòng: [FILE: /đường_dẫn_tuyệt_đối_đến_file] để Zalo Bot tự động phát hiện và gửi file cho người dùng!\n` +
    `2. Môi trường Python đã cài sẵn: python-pptx, Pillow, pandas, openpyxl, requests, xlsxwriter... Hãy tận dụng tối đa công cụ execute_code / terminal để viết script Python tạo tài liệu, đồ thị hoặc xử lý dữ liệu.\n` +
    `3. Trả lời bằng tiếng Việt tự nhiên, súc tích, tóm tắt rõ những việc bạn đã thực hiện và kết quả đạt được.`;

  // 4. Gọi Hermes Gateway HTTP API
  const baseUrl = process.env.HERMES_BASE_URL || "http://127.0.0.1:8642/v1";
  const apiKey = process.env.HERMES_API_KEY || "cd83cd617559609546f5ae9f5bc436030c161538f1cd29b83d3e28573e9e69ba";
  const model = process.env.HERMES_MODEL || "hermes-agent";
  const timeoutMs = 240_000; // 4 phút cho các tác vụ đa bước

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    console.log(`[hermes-task] 🔄 Đang gửi tác vụ sang Hermes Gateway (${endpoint})...`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: combinedPrompt },
        ],
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Hermes Gateway trả về HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data: any = await res.json();
    let replyContent: string = data.choices?.[0]?.message?.content || "";
    console.log(`[hermes-task] ✅ Hermes đã phản hồi (${replyContent.length} ký tự)`);

    // 5. Quét tìm file thành phẩm được xuất ra
    const fileMatches: string[] = [];
    const explicitTagMatch = replyContent.match(/\[FILE:\s*([^\s\]]+)\]/i);
    if (explicitTagMatch && explicitTagMatch[1]) {
      fileMatches.push(explicitTagMatch[1].trim());
    }

    // Quét bổ sung các đường dẫn file phổ biến trong sharedDir hoặc /tmp
    const pathRegex = /(?:\/home\/ubuntu\/shared-assets\/[^\s"'`]+|\/tmp\/[^\s"'`]+?\.(?:pptx|xlsx|docx|pdf|mp4|png|jpe?g|zip))/gi;
    let m: RegExpExecArray | null;
    while ((m = pathRegex.exec(replyContent)) !== null) {
      const p = m[0].replace(/[.,;:!?]+$/, "").trim();
      if (!fileMatches.includes(p)) {
        fileMatches.push(p);
      }
    }

    // Loại bỏ tag [FILE: ...] khỏi văn bản phản hồi người dùng cho đẹp mắt
    const cleanContent = replyContent.replace(/\[FILE:\s*[^\s\]]+\]/gi, "").trim();

    // 6. Gửi file đính kèm nếu có
    let sentFileCount = 0;
    for (const filePath of fileMatches) {
      if (fs.existsSync(filePath)) {
        const fileName = path.basename(filePath);
        console.log(`[hermes-task] 📤 Phát hiện file thành phẩm [${fileName}], đang gửi vào Zalo...`);
        try {
          if (options.isGroup) {
            await sendGroupFile(options.api, targetId, filePath, `Tài liệu thành phẩm: ${fileName}`);
          } else {
            await sendDirectFile(options.api, targetId, filePath, `Tài liệu thành phẩm: ${fileName}`);
          }
          sentFileCount++;
        } catch (fileSendErr) {
          console.error(`[hermes-task] Lỗi khi gửi file [${fileName}]:`, fileSendErr);
        }
      }
    }

    // 7. Gửi tin nhắn tổng kết cho người dùng
    const header = sentFileCount > 0
      ? `✅ [Hermes Task Engine]: Đã hoàn thành tác vụ và gửi ${sentFileCount} file đính kèm cho ${options.userGreeting}!\n\n`
      : `✅ [Hermes Task Engine]: Đã hoàn thành tác vụ cho ${options.userGreeting}!\n\n`;

    const finalReport = `${header}${cleanContent || "Tác vụ đã được thực hiện thành công."}`;

    if (options.isGroup) {
      await sendGroupText(options.api, targetId, finalReport);
    } else {
      await sendDirectText(options.api, targetId, finalReport);
    }
  } catch (err: any) {
    clearTimeout(timer);
    console.error(`[hermes-task] Lỗi thực thi tác vụ Hermes:`, err);

    const isTimeout = err.name === "AbortError" || String(err).includes("aborted");
    const errMsg = isTimeout
      ? `⚠️ [Hermes Task Engine]: Tác vụ bị timeout sau ${Math.round(timeoutMs / 1000)} giây. Sếp có thể thử chia nhỏ yêu cầu hoặc ra lệnh ngắn hơn nhé.`
      : `⚠️ [Hermes Task Engine]: Đã xảy ra lỗi trong quá trình xử lý: ${String(err?.message || err)}`;

    try {
      if (options.isGroup) {
        await sendGroupText(options.api, targetId, errMsg);
      } else {
        await sendDirectText(options.api, targetId, errMsg);
      }
    } catch {}
  }
}

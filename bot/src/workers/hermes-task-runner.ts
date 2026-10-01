import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Agent } from "undici";
import { sendDirectFile, sendDirectText, sendGroupFile, sendGroupText } from "../zalo/client.js";

const hermesDispatcher = new Agent({
  headersTimeout: 900_000, // 15 phút chống rớt socket ngầm khi render video
  bodyTimeout: 900_000,    // 15 phút
  connectTimeout: 30_000,
});

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

export interface HermesTaskCommand {
  isTask: boolean;
  subCommand?: "status" | "list";
  taskPrompt: string;
}

const HERMES_DB_PATH = process.env.HERMES_DB_PATH || "/home/ubuntu/.hermes/state.db";
const HERMES_STATE_JSON = process.env.HERMES_STATE_JSON || "/home/ubuntu/.hermes/gateway_state.json";
const SHARED_DIR = "/home/ubuntu/shared-assets";

/**
 * Nhận diện câu hỏi ngôn ngữ tự nhiên về trạng thái hoặc lịch sử tác vụ Hermes
 */
export function parseNaturalTaskStatusQuery(text: string): "status" | "list" | null {
  const clean = (text || "").trim().toLowerCase();
  if (!clean) return null;

  // Lịch sử / danh sách tác vụ
  if (
    /(?:danh sách|lịch sử|history)\s*(?:các\s*)?(?:tác vụ|task)/i.test(clean) ||
    /(?:tác vụ|task)\s*(?:gần đây|vừa làm|đã làm|hôm nay)/i.test(clean)
  ) {
    return "list";
  }

  // Trạng thái / tiến độ tác vụ đang chạy
  if (
    /(?:tiến độ|trạng thái|status)\s*(?:của\s*)?(?:các\s*)?(?:tác vụ|task|hermes)/i.test(clean) ||
    /(?:đang|có)\s*(?:chạy|làm|thực hiện)\s*(?:tác vụ|task|việc|cái gì)/i.test(clean) ||
    /(?:tác vụ|task)\s*(?:nãy giờ|hiện tại|đang chạy|vừa rồi)?\s*(?:tới đâu|thế nào|xong chưa|chạy xong chưa)/i.test(clean)
  ) {
    return "status";
  }

  return null;
}

/**
 * Kiểm tra xem tin nhắn có phải lệnh /tasks, /task hoặc câu hỏi trạng thái tự nhiên hay không
 */
export function parseHermesTaskCommand(text: string): HermesTaskCommand {
  const trimmed = (text || "").trim();
  const match = trimmed.match(/^[\/!](?:tasks?)\b\s*([\s\S]*)$/i);
  if (!match) {
    const natural = parseNaturalTaskStatusQuery(trimmed);
    if (natural) {
      return { isTask: true, subCommand: natural, taskPrompt: "" };
    }
    return { isTask: false, taskPrompt: "" };
  }

  const rawArg = (match[1] || "").trim();
  if (/^(?:status|check|info)$/i.test(rawArg)) {
    return { isTask: true, subCommand: "status", taskPrompt: "" };
  }
  if (/^(?:list|recent|history)$/i.test(rawArg)) {
    return { isTask: true, subCommand: "list", taskPrompt: "" };
  }

  return {
    isTask: true,
    taskPrompt: rawArg,
  };
}

export interface HermesCurrentTaskInfo {
  isRunning: boolean;
  activeAgents: number;
  currentTask?: {
    sessionId: string;
    prompt: string;
    startedAt: number;
    elapsedSeconds: number;
    toolCallCount: number;
  };
  lastTask?: {
    sessionId: string;
    title: string;
    prompt: string;
    endedAt?: number;
    elapsedSeconds?: number;
    files: string[];
  };
}

/**
 * Đọc trạng thái tác vụ hiện tại từ SQLite state.db và gateway_state.json
 */
export function getHermesTaskStatus(): HermesCurrentTaskInfo {
  let activeAgents = 0;
  if (fs.existsSync(HERMES_STATE_JSON)) {
    try {
      const gs = JSON.parse(fs.readFileSync(HERMES_STATE_JSON, "utf8"));
      activeAgents = Number(gs.active_agents) || 0;
    } catch {}
  }

  if (!fs.existsSync(HERMES_DB_PATH)) {
    return { isRunning: activeAgents > 0, activeAgents };
  }

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(HERMES_DB_PATH, { readonly: true, fileMustExist: true });
    const leases = db.prepare("SELECT * FROM session_turn_leases").all() as any[];
    const isRunning = leases.length > 0 || activeAgents > 0;

    let currentTask: HermesCurrentTaskInfo["currentTask"];
    if (isRunning && leases.length > 0) {
      const lease = leases[0];
      const sid = lease.session_id;
      const startedAt = Number(lease.acquired_at) || Date.now() / 1000;
      const elapsedSeconds = Math.max(1, Math.round(Date.now() / 1000 - startedAt));

      const firstMsg = db
        .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id ASC LIMIT 1")
        .get(sid) as { content?: string } | undefined;

      const toolCountRow = db
        .prepare("SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND role = 'tool'")
        .get(sid) as { c?: number } | undefined;

      currentTask = {
        sessionId: sid,
        prompt: firstMsg?.content || "(Không có prompt)",
        startedAt,
        elapsedSeconds,
        toolCallCount: toolCountRow?.c || 0,
      };
    }

    // Lấy tác vụ gần nhất
    let lastTask: HermesCurrentTaskInfo["lastTask"];
    const lastSession = db
      .prepare("SELECT id, started_at, ended_at, title FROM sessions ORDER BY started_at DESC LIMIT 1")
      .get() as { id: string; started_at: number; ended_at?: number; title?: string } | undefined;

    if (lastSession) {
      const firstMsg = db
        .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id ASC LIMIT 1")
        .get(lastSession.id) as { content?: string } | undefined;

      // Quét các file thành phẩm gần nhất trong shared-assets
      const files: string[] = [];
      if (fs.existsSync(SHARED_DIR)) {
        try {
          const allFiles = fs.readdirSync(SHARED_DIR)
            .filter((f) => /\.(pptx|mp4|xlsx|docx|pdf|zip|png|jpe?g)$/i.test(f))
            .map((f) => ({
              name: f,
              time: fs.statSync(path.join(SHARED_DIR, f)).mtimeMs,
            }))
            .sort((a, b) => b.time - a.time);

          for (const af of allFiles.slice(0, 3)) {
            files.push(af.name);
          }
        } catch {}
      }

      lastTask = {
        sessionId: lastSession.id,
        title: lastSession.title || "",
        prompt: firstMsg?.content || "",
        endedAt: lastSession.ended_at,
        files,
      };
    }

    return {
      isRunning,
      activeAgents,
      currentTask,
      lastTask,
    };
  } catch (err) {
    console.warn("[hermes-task] Không thể đọc state.db:", err);
    return { isRunning: activeAgents > 0, activeAgents };
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

export interface HermesRecentTaskItem {
  id: string;
  title: string;
  prompt: string;
  startedAt: number;
  timeStr: string;
  toolCallCount: number;
}

/**
 * Lấy danh sách 5 tác vụ gần nhất từ state.db
 */
export function getRecentHermesTasks(limit = 5): HermesRecentTaskItem[] {
  if (!fs.existsSync(HERMES_DB_PATH)) return [];

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(HERMES_DB_PATH, { readonly: true, fileMustExist: true });
    const sessions = db
      .prepare(
        "SELECT id, started_at, title, tool_call_count FROM sessions ORDER BY started_at DESC LIMIT ?",
      )
      .all(limit) as { id: string; started_at: number; title?: string; tool_call_count?: number }[];

    const result: HermesRecentTaskItem[] = [];
    for (const s of sessions) {
      const firstMsg = db
        .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id ASC LIMIT 1")
        .get(s.id) as { content?: string } | undefined;

      const dt = new Date(s.started_at * 1000 + 7 * 3600 * 1000);
      const timeStr = `${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")} ${String(dt.getUTCDate()).padStart(2, "0")}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;

      result.push({
        id: s.id,
        title: s.title || "(Chưa có tiêu đề)",
        prompt: firstMsg?.content || "",
        startedAt: s.started_at,
        timeStr,
        toolCallCount: s.tool_call_count || 0,
      });
    }
    return result;
  } catch (err) {
    console.warn("[hermes-task] Lỗi lấy recent tasks:", err);
    return [];
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

/**
 * Xử lý lệnh tra cứu trạng thái /tasks status
 */
export async function handleHermesTaskStatusQuery(api: any, targetId: string, isGroup: boolean): Promise<void> {
  const status = getHermesTaskStatus();
  let msg = "";

  if (status.isRunning && status.currentTask) {
    const shortPrompt = status.currentTask.prompt.length > 120
      ? `${status.currentTask.prompt.slice(0, 120)}...`
      : status.currentTask.prompt;
    msg =
      `⚡ [Hermes Task Engine - Trạng Thái Hiện Tại]\n` +
      `🔄 Đang xử lý 1 tác vụ tự chủ ngầm:\n` +
      `• Nhiệm vụ: "${shortPrompt}"\n` +
      `• Thời gian đã xử lý: ${status.currentTask.elapsedSeconds} giây\n` +
      `• Số vòng gọi công cụ: ${status.currentTask.toolCallCount} tools\n\n` +
      `⏳ Hệ thống đang lập kế hoạch và render trong sandbox, vui lòng đợi trong giây lát nhé!`;
  } else {
    const lastTitle = status.lastTask?.title || status.lastTask?.prompt || "Không có dữ liệu";
    const shortTitle = lastTitle.length > 80 ? `${lastTitle.slice(0, 80)}...` : lastTitle;
    const fileList = status.lastTask?.files?.length
      ? `\n• Thành phẩm gần nhất:\n${status.lastTask.files.map((f) => `  - 📎 ${f}`).join("\n")}`
      : "";

    msg =
      `⚡ [Hermes Task Engine - Trạng Thái Hiện Tại]\n` +
      `🟢 Cổng Hermes hiện đang rảnh rỗi (Không có tác vụ nào đang chạy ngầm).\n\n` +
      `📋 Tác vụ gần nhất vừa thực hiện:\n` +
      `• Nhiệm vụ: "${shortTitle}"${fileList}\n\n` +
      `💡 Sếp có thể ra lệnh mới bất kỳ lúc nào bằng cú pháp:\n/tasks <nội dung nhiệm vụ>`;
  }

  try {
    if (isGroup) {
      await sendGroupText(api, targetId, msg);
    } else {
      await sendDirectText(api, targetId, msg);
    }
  } catch (err) {
    console.warn("[hermes-task] Không thể gửi status message:", err);
  }
}

/**
 * Xử lý lệnh xem lịch sử /tasks list
 */
export async function handleHermesTaskListQuery(api: any, targetId: string, isGroup: boolean): Promise<void> {
  const tasks = getRecentHermesTasks(5);
  let msg = `📋 [Hermes Task Engine - Lịch Sử 5 Tác Vụ Gần Nhất]:\n\n`;

  if (tasks.length === 0) {
    msg += `Chưa ghi nhận tác vụ nào trong lịch sử.`;
  } else {
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i]!;
      const cleanPrompt = (t.prompt || t.title).replace(/\n+/g, " ");
      const shortPrompt = cleanPrompt.length > 70 ? `${cleanPrompt.slice(0, 70)}...` : cleanPrompt;
      msg += `${i + 1}. [${t.timeStr}] "${shortPrompt}" (${t.toolCallCount} tools)\n`;
    }
    msg += `\n💡 Dùng /tasks status để kiểm tra tiến trình hiện tại.`;
  }

  try {
    if (isGroup) {
      await sendGroupText(api, targetId, msg);
    } else {
      await sendDirectText(api, targetId, msg);
    }
  } catch (err) {
    console.warn("[hermes-task] Không thể gửi list message:", err);
  }
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
  const sharedDir = SHARED_DIR;
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
    `NHIỆM VỤ: Phân tích yêu cầu chuyên sâu của người dùng ở MỌI lĩnh vực (bất động sản, tài chính, công nghệ, pháp luật, y tế, đời sống...), tự lập kế hoạch đa bước và tự do sử dụng toàn bộ công cụ có sẵn (terminal, web_search, web_extract_tool, read_file, write_file, browser_exec, vision_analyze...) để giải quyết trọn vẹn bài toán.\n\n` +
    `QUY TRÌNH THỰC THI 3 PHA CHUẨN MỰC (DEEP RESEARCH PIPELINE):\n` +
    `1. PHA 1: DEEP RESEARCH & XÁC MINH ĐA CHIỀU (BẮT BUỘC):\n` +
    `   - Không đưa ra kết luận hời hợt hoặc võ đoán. Chủ động tìm kiếm từ 2-4 nguồn tin cậy bằng web_search.\n` +
    `   - Dùng web_extract_tool hoặc curl/python requests để đọc sâu nội dung trang, trích xuất dữ liệu thực tế, số liệu thống kê, biểu giá, thông số kỹ thuật, quy hoạch, căn cứ pháp lý.\n` +
    `   - Nếu cần hình ảnh thực tế hoặc tư liệu biểu đồ, hãy tải ảnh về thư mục /tmp/ để nhúng vào slide hoặc báo cáo.\n` +
    `2. PHA 2: PHÂN TÍCH ĐỊNH LƯỢNG & LẬP LUẬN CHẶT CHẼ:\n` +
    `   - Tự do sử dụng Python (pandas, numpy, openpyxl, matplotlib, seaborn) để tính toán, tổng hợp số liệu, lập bảng so sánh đa chiều hoặc vẽ biểu đồ trực quan (lưu ảnh biểu đồ tại /tmp/chart.png).\n` +
    `   - Phân tích khách quan: chỉ rõ ưu thế, hạn chế, rủi ro tiềm ẩn và khuyến nghị hành động cụ thể.\n` +
    `3. PHA 3: ĐÓNG GÓI THÀNH PHẨM DOANH NGHIỆP (ENTERPRISE-GRADE DELIVERABLES):\n` +
    `   - NẾU YÊU CẦU TẠO SLIDE / BÀI THUYẾT TRÌNH (PowerPoint .pptx):\n` +
    `     * Khuyên dùng công cụ PPTMaster có sẵn để có định dạng vector DrawingML sắc nét, chuẩn tiếng Việt:\n` +
    `       Xuất file JSON (dùng tên riêng như /tmp/slides_duan.json hoặc xóa file cũ trước khi write_file) hỗ trợ các layout phong phú: title, bullets, two_content (tự động cân 2 cột), stats (thẻ KPI lớn), split_image (cột ảnh + cột phân tích), image (hero image), timeline, table.\n` +
    `       Chạy lệnh terminal: node /home/ubuntu/zalo-bot-2/bot/scripts/render-pptmaster-cli.mjs --input <duong_dan_file_json> --output ${sharedDir}/ten_file.pptx --theme auto (hoặc tự chọn theme phù hợp: luxury, navy, emerald, teal, slate, burgundy, ruby, amber...)\n` +
    `     * Bạn cũng hoàn toàn có quyền viết script Python với python-pptx nếu cần layout tùy biến đặc thù hoặc nhúng ảnh bespoke.\n` +
    `   - NẾU YÊU CẦU BẢNG TÍNH EXCEL (.xlsx) HOẶC BÁO CÁO WORD (.docx):\n` +
    `     * Viết script Python dùng openpyxl hoặc docx để định dạng đẹp, chuyên nghiệp, có màu sắc header, viền bảng và lưu vào ${sharedDir}/\n` +
    `   - NẾU YÊU CẦU VIDEO (.mp4):\n` +
    `     * Tự do chọn engine phù hợp (Remotion render_vox_video.py cho video tin tức/phân tích chuyên nghiệp, hoặc stickman_generator.py kèm thuyết minh tiếng Việt Google AI Studio TTS qua tts_aistudio.py).\n\n` +
    `QUY TẮC MÔI TRƯỜNG & ĐỊNH DẠNG TRẢ VỀ:\n` +
    `1. Môi trường Linux đã cài đặt sẵn 100%: python-pptx, openpyxl, Pillow, edge-tts, requests, pandas, ffmpeg, ffprobe và các font tiếng Việt Noto/DejaVu chuẩn. KHÔNG CHẠY lệnh kiểm tra version thư viện hoặc dò font (fc-list) để tránh mất thời gian.\n` +
    `2. Mọi file thành phẩm lưu tại: ${sharedDir} hoặc /tmp/\n` +
    `3. Tên file viết không dấu, dùng gạch dưới rõ ràng (ví dụ: ${sharedDir}/ten_file.pptx)\n` +
    `4. Trong câu trả lời cuối cùng, BẮT BUỘC ghi rõ dòng: [FILE: /đường_dẫn_tuyệt_đối_đến_file] để Zalo Bot tự động phát hiện và gửi file cho người dùng!\n` +
    `5. Trả lời bằng tiếng Việt tự nhiên, súc tích, tóm tắt rõ những thông tin cốt lõi bạn đã phát hiện và kết quả đạt được.`;

  // 4. Gọi Hermes Gateway HTTP API
  const baseUrl = process.env.HERMES_BASE_URL || "http://127.0.0.1:8642/v1";
  const apiKey = process.env.HERMES_API_KEY || "cd83cd617559609546f5ae9f5bc436030c161538f1cd29b83d3e28573e9e69ba";
  const model = process.env.HERMES_MODEL || "hermes-agent";
  const timeoutMs = 900_000; // 15 phút cho các tác vụ đa bước và render video

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
      dispatcher: hermesDispatcher,
    } as any);

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

    const errStr = String(err?.message || err);

    // Xử lý lỗi 429 Concurrency Limit một cách thân thiện
    if (errStr.includes("429") || errStr.includes("Too many concurrent runs") || errStr.includes("rate_limit")) {
      const currentStatus = getHermesTaskStatus();
      let concurrencyMsg = `⚠️ [Hermes Task Engine]: Cổng Hermes hiện đang bận xử lý 1 tác vụ khác:\n`;
      if (currentStatus.isRunning && currentStatus.currentTask) {
        const runningPrompt = currentStatus.currentTask.prompt.length > 80
          ? `${currentStatus.currentTask.prompt.slice(0, 80)}...`
          : currentStatus.currentTask.prompt;
        concurrencyMsg +=
          `• Tác vụ đang chạy: "${runningPrompt}"\n` +
          `• Thời gian đã xử lý: ${currentStatus.currentTask.elapsedSeconds} giây\n\n`;
      }
      concurrencyMsg += `⏳ Do giới hạn 1 tác vụ tự chủ tại một thời điểm, Sếp vui lòng đợi tác vụ trên hoàn thành rồi thử lại hoặc gõ /tasks status để kiểm tra tiến trình nhé!`;

      try {
        if (options.isGroup) {
          await sendGroupText(options.api, targetId, concurrencyMsg);
        } else {
          await sendDirectText(options.api, targetId, concurrencyMsg);
        }
      } catch {}
      return;
    }

    const isTimeout = err.name === "AbortError" || errStr.includes("aborted");
    const errMsg = isTimeout
      ? `⚠️ [Hermes Task Engine]: Tác vụ bị timeout sau ${Math.round(timeoutMs / 1000)} giây. Sếp có thể thử chia nhỏ yêu cầu hoặc ra lệnh ngắn hơn nhé.`
      : `⚠️ [Hermes Task Engine]: Đã xảy ra lỗi trong quá trình xử lý: ${errStr}`;

    try {
      if (options.isGroup) {
        await sendGroupText(options.api, targetId, errMsg);
      } else {
        await sendDirectText(options.api, targetId, errMsg);
      }
    } catch {}
  }
}


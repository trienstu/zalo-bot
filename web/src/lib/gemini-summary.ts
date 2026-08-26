import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function getBotDbPath(): string {
  const possiblePaths = [
    process.env.SQLITE_DB_PATH,
    path.resolve(process.cwd(), "data", "bot.db"),
    path.resolve(process.cwd(), "..", "bot", "data", "bot.db"),
    path.resolve(process.cwd(), "bot", "data", "bot.db"),
    path.resolve(process.cwd(), "..", "data", "bot.db"),
  ].filter(Boolean) as string[];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(process.cwd(), "..", "bot", "data", "bot.db");
}

function getBotEnvPath(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), "..", "bot", ".env"),
    path.resolve(process.cwd(), "bot", ".env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(process.cwd(), "..", "bot", ".env");
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      result[key] = val;
    }
  }
  return result;
}

// Đọc env từ bot/.env
function getEnvConfig() {
  let env: Record<string, string> = {};
  const envPath = getBotEnvPath();
  if (fs.existsSync(envPath)) {
    env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  }
  return {
    geminiApiKey: process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || env.GEMINI_MODEL || "gemini-3.6-flash",
    groupId: process.env.GROUP_ID || env.GROUP_ID || "",
    summaryGroupId: process.env.SUMMARY_GROUP_ID || env.SUMMARY_GROUP_ID || env.GROUP_ID || "",
  };
}

const VN_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface DayRange {
  startTs: number;
  endTs: number;
  label: string;
  dayDate: string; // 'YYYY-MM-DD'
}

export function parseDayRange(targetDateStr?: string): DayRange {
  const vnDayMs = 24 * 60 * 60 * 1000;
  let targetTs = Date.now();

  if (targetDateStr && /^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) {
    const [y, m, d] = targetDateStr.split("-").map(Number);
    targetTs = Date.UTC(y, m - 1, d) - VN_UTC_OFFSET_MS + 12 * 3600 * 1000;
  }

  const startTs = Math.floor((targetTs + VN_UTC_OFFSET_MS) / vnDayMs) * vnDayMs - VN_UTC_OFFSET_MS;
  const endTs = startTs + vnDayMs;
  const d = new Date(startTs + VN_UTC_OFFSET_MS);
  const label = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  const dayDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

  return { startTs, endTs, label, dayDate };
}

let currentKeyOffset = 0;

export async function callGeminiDirect(
  systemPrompt: string,
  userPrompt: string,
  rawApiKey: string,
  model = "gemini-3.6-flash",
): Promise<string> {
  const apiKeys = (rawApiKey || process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (apiKeys.length === 0) {
    throw new Error("Chưa cấu hình GEMINI_API_KEY trong .env");
  }

  let lastError: unknown;
  const numKeys = apiKeys.length;

  // Xoay vòng luân phiên qua các Key để chia đều tải và tránh Rate Limit/Timeout
  for (let attempt = 0; attempt < numKeys; attempt += 1) {
    const keyIdx = (currentKeyOffset + attempt) % numKeys;
    const apiKey = apiKeys[keyIdx];
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody: Record<string, unknown> = {
      system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    };

    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(60_000), // 60s timeout để AI có đủ thời gian sinh bản tóm tắt dài chi tiết
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        const err = new Error(`Gemini API HTTP ${resp.status}: ${errText.slice(0, 500)}`);
        
        // 429: Hết quota Free Tier -> Thử key tiếp theo ngay lập tức
        if (resp.status === 429) {
          console.warn(`[web-gemini] Key #${keyIdx + 1} hết quota (HTTP 429). Đang chuyển sang key tiếp theo...`);
          lastError = err;
          continue;
        }
        throw err;
      }

      const data = (await resp.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const candidate = data.candidates?.[0];
      const content = candidate?.content?.parts?.map((p: { text?: string }) => p.text || "").join("").trim();
      if (!content) {
        throw new Error("Response Gemini API không có nội dung (content rỗng)");
      }
      currentKeyOffset = (keyIdx + 1) % numKeys; // Lưu lại key tiếp theo cho lượt sau
      return content;
    } catch (error) {
      lastError = error;
      console.warn(`[web-gemini] Lỗi với Key #${keyIdx + 1}: ${String(error)}`);
    }
  }

  // Fallback sang DeepSeek nếu có cấu hình DEEPSEEK_API_KEY
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY || "";
  if (deepseekApiKey) {
    try {
      console.log("[web-gemini] Gemini quá tải, đang chuyển hướng sang DeepSeek AI...");
      const dsResp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 4096,
        }),
      });
      if (dsResp.ok) {
        const dsData = (await dsResp.json()) as { choices?: { message?: { content?: string } }[] };
        const dsContent = dsData.choices?.[0]?.message?.content?.trim();
        if (dsContent) return dsContent;
      }
    } catch (dsErr) {
      console.warn("[web-gemini] DeepSeek fallback cũng lỗi:", dsErr);
    }
  }

  throw lastError || new Error("Không thể gọi Gemini API qua tất cả các key");
}

export async function generateChatSummary(options: {
  targetDate?: string;
  sendToGroup?: boolean;
  groupId?: string;
}) {
  const config = getEnvConfig();
  const dbPath = getBotDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error("Cơ sở dữ liệu bot.db chưa tồn tại. Hãy để bot chạy một lát trước.");
  }

  const db = new Database(dbPath);
  const dayRange = parseDayRange(options.targetDate);
  const targetGroupId = (options.groupId || config.groupId || "").trim();
  const primaryGroupId = "1913869945242410752";

  let groupClause = "";
  let queryParams: (string | number)[] = [dayRange.startTs, dayRange.endTs];

  if (targetGroupId && targetGroupId !== "all") {
    if (targetGroupId === primaryGroupId) {
      groupClause = "AND (thread_id = ? OR thread_id = '' OR thread_id IS NULL)";
      queryParams.push(targetGroupId);
    } else {
      groupClause = "AND thread_id = ?";
      queryParams.push(targetGroupId);
    }
  }

  // Lấy tin nhắn trong ngày theo nhóm đã chọn
  const messages = db
    .prepare(
      `SELECT message_id, thread_id, zalo_user_id, display_name, text, ts
       FROM group_messages
       WHERE ts >= ? AND ts < ? AND deleted_at IS NULL ${groupClause}
       ORDER BY ts ASC`,
    )
    .all(...queryParams) as {
      message_id: string;
      thread_id: string;
      zalo_user_id: string;
      display_name: string;
      text: string;
      ts: number;
    }[];

  if (messages.length === 0) {
    const latestMsg = db
      .prepare(
        `SELECT ts FROM group_messages WHERE deleted_at IS NULL ${targetGroupId && targetGroupId !== "all" ? (targetGroupId === primaryGroupId ? "AND (thread_id = ? OR thread_id = '' OR thread_id IS NULL)" : "AND thread_id = ?") : ""} ORDER BY ts DESC LIMIT 1`,
      )
      .get(...(targetGroupId && targetGroupId !== "all" ? [targetGroupId] : [])) as
      | { ts: number }
      | undefined;
    db.close();

    let suggestion = "";
    if (latestMsg?.ts) {
      const d = new Date(latestMsg.ts + VN_UTC_OFFSET_MS);
      const latestDateStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
      suggestion = ` (Ngày gần nhất có dữ liệu thảo luận là ${latestDateStr})`;
    }

    return {
      ok: false,
      message: `Ngày ${dayRange.label} chưa có tin nhắn nào trong nhóm.${suggestion} Hãy chọn ngày có thảo luận để tóm tắt nhé!`,
      dayLabel: dayRange.label,
      dayDate: dayRange.dayDate,
      totalMessages: 0,
    };
  }

  // Đếm top senders
  const sendersMap = new Map<string, { name: string; count: number }>();
  for (const m of messages) {
    const cur = sendersMap.get(m.zalo_user_id) || { name: m.display_name || m.zalo_user_id, count: 0 };
    cur.count += 1;
    if (m.display_name) cur.name = m.display_name;
    sendersMap.set(m.zalo_user_id, cur);
  }

  const topSenders = [...sendersMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([_, s]) => `${s.name} (${s.count})`);

  // Trích xuất toàn bộ đường link được chia sẻ trong ngày
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const extractedLinks: { sender: string; url: string; context: string }[] = [];
  for (const m of messages) {
    const matches = m.text.match(urlRegex);
    if (matches) {
      for (const u of matches) {
        const cleanUrl = u.replace(/[.,;!?)]+$/, "");
        if (!extractedLinks.some((l) => l.url === cleanUrl)) {
          extractedLinks.push({
            sender: m.display_name || m.zalo_user_id,
            url: cleanUrl,
            context: m.text.replace(/\s*\n\s*/g, " ").slice(0, 150),
          });
        }
      }
    }
  }

  // Dựng transcript (tăng sức chứa lên đến 3000 tin nhắn để không bỏ sót nội dung quan trọng)
  const transcriptLines = messages.map((m) => {
    const d = new Date(m.ts + VN_UTC_OFFSET_MS);
    const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    const name = (m.display_name || m.zalo_user_id).replace(/\s+/g, " ").trim();
    const cleanText = m.text.replace(/\s*\n\s*/g, " ").slice(0, 500);
    return `${time} | ${name}: ${cleanText}`;
  });

  const transcript = transcriptLines.slice(-3000).join("\n");

  const systemPrompt =
    "Bạn là trợ lý AI chuyên viết bản tóm tắt hội thoại nhóm Zalo tiếng Việt súc tích, đầy đủ và hữu ích cho người vắng mặt. " +
    "Người dùng cung cấp log tin nhắn một ngày đặt giữa <log> và </log>, và danh sách các link được chia sẻ đặt giữa <links> và </links>. " +
    "NGUYÊN TẮC: tóm tắt NỘI DUNG THỰC CHẤT của từng thảo luận — luận điểm, giải pháp, kinh nghiệm, kết luận, con số và công cụ cụ thể. " +
    "Bố cục: Phân nhóm nội dung thành các mục có nội dung thực tế (bỏ mục rỗng): " +
    "(1) '📢 THÔNG BÁO & QUYẾT ĐỊNH' " +
    "(2) '💼 CHỦ ĐỀ CHUYÊN MÔN & THẢO LUẬN' " +
    "(3) '🤖 AI & CÔNG NGHỆ' " +
    "(4) '🎓 HỌC HÀNH & KINH NGHIỆM' " +
    "(5) '🔗 LINK ĐÃ CHIA SẺ' (YÊU CẦU ĐẶC BIỆT: Phải liệt kê ĐẦY ĐỦ TẤT CẢ các link xuất hiện trong <links> hoặc <log>, kèm mô tả ngắn và ai gửi, tuyệt đối không được bỏ sót) " +
    "(6) '❓ CÂU HỎI CHƯA CÓ TRẢ LỜI' " +
    "(7) '☕ NGOÀI LỀ' (tán gẫu, chuyện vui cuối ngày). " +
    "Trình bày bằng gạch đầu dòng '- ', mỗi ý một dòng, KHÔNG dùng markdown in đậm ** vì Zalo không render.";

  const linksBlock =
    extractedLinks.length > 0
      ? `\n\n<links>\n${extractedLinks.map((l) => `- ${l.url} (Người gửi: ${l.sender} | Đoạn chat: ${l.context})`).join("\n")}\n</links>`
      : "";

  const userPrompt = `Tóm tắt log tin nhắn ngày ${dayRange.label} sau:\n<log>\n${transcript}\n</log>${linksBlock}`;

  const summary = await callGeminiDirect(systemPrompt, userPrompt, config.geminiApiKey, config.geminiModel);

  const fullMessage =
    `📋 Tóm tắt nhóm ngày ${dayRange.label}\n\n` +
    `${summary}\n\n` +
    `📊 ${messages.length} tin nhắn · ${sendersMap.size} người tham gia\n` +
    `🔥 Sôi nổi nhất: ${topSenders.join(", ")}`;

  // Lưu vào SQLite daily_summaries
  try {
    db.prepare(
      `INSERT OR REPLACE INTO daily_summaries (
        day_date, day_label, day_start_ts, thread_id, summary_text, parts_json,
        total_messages, included_messages, unique_senders, images, videos,
        top_senders_json, model, transcript_chars, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      dayRange.dayDate,
      dayRange.label,
      dayRange.startTs,
      targetGroupId || config.groupId,
      summary,
      JSON.stringify([fullMessage]),
      messages.length,
      transcriptLines.length,
      sendersMap.size,
      0,
      0,
      JSON.stringify(topSenders),
      config.geminiModel,
      transcript.length,
      "web_admin",
      Date.now(),
    );
  } catch (e) {
    console.warn("Lỗi lưu daily_summaries:", e);
  }

  let sent = false;
  if (options.sendToGroup) {
    const dataDir = path.dirname(dbPath);
    const requestId = `web_req_${Date.now()}`;
    const sendReqPath = path.join(dataDir, "summary-send-request.json");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      sendReqPath,
      JSON.stringify({
        requestId,
        parts: [fullMessage],
        groupId: targetGroupId || config.summaryGroupId || config.groupId,
        requestedAt: Date.now(),
        requestedBy: "web_admin",
      }),
      "utf8",
    );
    sent = true;
  }

  db.close();

  return {
    ok: true,
    dayLabel: dayRange.label,
    dayDate: dayRange.dayDate,
    summary,
    fullMessage,
    stats: {
      totalMessages: messages.length,
      uniqueSenders: sendersMap.size,
      topSenders,
    },
    sent,
  };
}

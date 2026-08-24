import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const BOT_DIR = path.resolve(process.cwd(), "..", "bot");
const BOT_ENV_PATH = path.join(BOT_DIR, ".env");
const DATA_DIR = path.join(BOT_DIR, "data");
const DB_PATH = path.join(DATA_DIR, "bot.db");

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
  if (fs.existsSync(BOT_ENV_PATH)) {
    env = parseEnvFile(fs.readFileSync(BOT_ENV_PATH, "utf8"));
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

export async function callGeminiDirect(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  model = "gemini-3.6-flash",
): Promise<string> {
  if (!apiKey) throw new Error("Chưa cấu hình GEMINI_API_KEY trong .env");

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
      stream: false,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Gemini API HTTP ${resp.status}: ${body.slice(0, 500)}`);
  }

  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Gemini API không trả về nội dung");
  return content;
}

export async function generateChatSummary(options: {
  targetDate?: string;
  sendToGroup?: boolean;
}) {
  const config = getEnvConfig();
  if (!fs.existsSync(DB_PATH)) {
    throw new Error("Cơ sở dữ liệu bot.db chưa tồn tại. Hãy để bot chạy một lát trước.");
  }

  const db = new Database(DB_PATH);
  const dayRange = parseDayRange(options.targetDate);

  // Lấy tin nhắn trong ngày
  const messages = db
    .prepare(
      `SELECT message_id, thread_id, zalo_user_id, display_name, text, ts
       FROM group_messages
       WHERE ts >= ? AND ts < ? AND deleted_at IS NULL
       ORDER BY ts ASC`,
    )
    .all(dayRange.startTs, dayRange.endTs) as {
      message_id: string;
      thread_id: string;
      zalo_user_id: string;
      display_name: string;
      text: string;
      ts: number;
    }[];

  if (messages.length === 0) {
    db.close();
    return {
      ok: false,
      message: `Ngày ${dayRange.label} chưa có tin nhắn nào được lưu trong database. Hãy chat thêm trong nhóm để bot thu thập dữ liệu nhé!`,
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

  // Dựng transcript
  const transcriptLines = messages.map((m) => {
    const d = new Date(m.ts + VN_UTC_OFFSET_MS);
    const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    const name = (m.display_name || m.zalo_user_id).replace(/\s+/g, " ").trim();
    const cleanText = m.text.replace(/\s*\n\s*/g, " ").slice(0, 500);
    return `${time} | ${name}: ${cleanText}`;
  });

  const transcript = transcriptLines.slice(-300).join("\n");

  const systemPrompt =
    "Bạn viết bản tóm tắt hội thoại nhóm Zalo tiếng Việt cho NGƯỜI KHÔNG CÓ MẶT TRONG NHÓM. " +
    "Người dùng cung cấp log tin nhắn một ngày đặt giữa <log> và </log>, mỗi dòng dạng 'HH:MM | Tên: nội dung'. " +
    "NGUYÊN TẮC: tóm tắt NỘI DUNG THỰC CHẤT của từng thảo luận — luận điểm, cách làm, kinh nghiệm, kết luận, con số cụ thể. " +
    "Bố cục: Phân nhóm nội dung thành các mục có nội dung thực tế (bỏ mục rỗng): " +
    "(1) '📢 THÔNG BÁO & QUYẾT ĐỊNH' " +
    "(2) '💼 CHỦ ĐỀ CHUYÊN MÔN & THẢO LUẬN' " +
    "(3) '🤖 AI & CÔNG NGHỆ' " +
    "(4) '🎓 HỌC HÀNH & KINH NGHIỆM' " +
    "(5) '🔗 LINK ĐÃ CHIA SẺ' (kèm mô tả) " +
    "(6) '❓ CÂU HỎI CHƯA CÓ TRẢ LỜI' " +
    "(7) '☕ NGOÀI LỀ' (tán gẫu, chuyện vui cuối ngày). " +
    "Trình bày bằng gạch đầu dòng '- ', mỗi ý một dòng, KHÔNG dùng markdown in đậm ** vì Zalo không render.";

  const userPrompt = `Tóm tắt log tin nhắn ngày ${dayRange.label} sau:\n<log>\n${transcript}\n</log>`;

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
      config.groupId,
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
    const requestId = `web_req_${Date.now()}`;
    const sendReqPath = path.join(DATA_DIR, "summary-send-request.json");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      sendReqPath,
      JSON.stringify({
        requestId,
        parts: [fullMessage],
        groupId: config.summaryGroupId || config.groupId,
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

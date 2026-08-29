import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { cookies } from "next/headers";
import { getBotInfo } from "@/lib/bot-registry";

export const dynamic = "force-dynamic";

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

async function getActiveBotDbPath(): Promise<string> {
  let botId = "bot-1";
  try {
    const cookieStore = await cookies();
    botId = cookieStore.get("active_bot_id")?.value || "bot-1";
  } catch {}

  const botInfo = getBotInfo(botId);
  if (botInfo && botInfo.dbPath) {
    return botInfo.dbPath;
  }
  return getBotDbPath();
}

export async function GET() {
  try {
    const dbPath = await getActiveBotDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ groups: [] });
    }

    const db = new Database(dbPath);

    // Tạo bảng bot_groups nếu chưa có
    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_groups (
        group_id       TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        total_members  INTEGER NOT NULL DEFAULT 0,
        mode           TEXT NOT NULL DEFAULT 'interactive',
        is_active      INTEGER NOT NULL DEFAULT 0,
        creator_id     TEXT,
        updated_at     INTEGER NOT NULL
      );
    `);

    // Migration thêm các cột mới nếu bảng đã có từ trước
    try {
      const cols = db.prepare(`PRAGMA table_info(bot_groups)`).all() as { name: string }[];
      if (!cols.some((c) => c.name === "mode")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN mode TEXT NOT NULL DEFAULT 'interactive'`);
      }
      if (!cols.some((c) => c.name === "persona")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN persona TEXT NOT NULL DEFAULT 'humorous'`);
      }
      if (!cols.some((c) => c.name === "custom_prompt")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN custom_prompt TEXT NOT NULL DEFAULT ''`);
      }
      if (!cols.some((c) => c.name === "bot_name")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN bot_name TEXT NOT NULL DEFAULT 'Sen Chúa'`);
      }
      if (!cols.some((c) => c.name === "welcome_msg")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN welcome_msg TEXT NOT NULL DEFAULT ''`);
      }
      if (!cols.some((c) => c.name === "weather_auto")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN weather_auto INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.some((c) => c.name === "weather_time")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN weather_time TEXT NOT NULL DEFAULT '07:00'`);
      }
      if (!cols.some((c) => c.name === "weather_city")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN weather_city TEXT NOT NULL DEFAULT 'Hồ Chí Minh'`);
      }
    } catch {}

    // 1. Đọc danh sách group đã lưu trong bot_groups
    let savedGroups = db.prepare("SELECT * FROM bot_groups ORDER BY total_members DESC").all() as {
      group_id: string;
      name: string;
      total_members: number;
      mode: string;
      persona?: string;
      custom_prompt?: string;
      bot_name?: string;
      welcome_msg?: string;
      weather_auto?: number;
      weather_time?: string;
      weather_city?: string;
      is_active: number;
    }[];

    // 2. Nếu bot_groups chưa có, trích xuất các group từ lịch sử sync hoặc tin nhắn
    if (savedGroups.length === 0) {
      const syncRuns = db
        .prepare(
          `SELECT group_id, group_name as name, member_count as total_members
           FROM member_sync_runs
           WHERE group_id IS NOT NULL AND group_id != ''
           GROUP BY group_id
           ORDER BY started_at DESC`,
        )
        .all() as { group_id: string; name: string; total_members: number }[];

      if (syncRuns.length > 0) {
        for (const sr of syncRuns) {
          db.prepare(
            `INSERT OR REPLACE INTO bot_groups (group_id, name, total_members, mode, persona, custom_prompt, bot_name, welcome_msg, weather_auto, weather_time, weather_city, is_active, updated_at)
             VALUES (?, ?, ?, 'interactive', 'humorous', '', 'Sen Chúa', '', 0, '07:00', 'Hồ Chí Minh', 0, ?)`,
          ).run(sr.group_id, sr.name || `Nhóm ${sr.group_id.slice(-4)}`, sr.total_members || 0, Date.now());
        }
        savedGroups = db.prepare("SELECT * FROM bot_groups ORDER BY total_members DESC").all() as any[];
      }
    }

    // 3. Nếu vẫn rỗng, tìm các thread_id trong group_messages
    if (savedGroups.length === 0) {
      const msgThreads = db
        .prepare(
          `SELECT DISTINCT thread_id as group_id
           FROM group_messages
           WHERE thread_id IS NOT NULL AND thread_id != ''`,
        )
        .all() as { group_id: string }[];

      for (const mt of msgThreads) {
        db.prepare(
          `INSERT OR IGNORE INTO bot_groups (group_id, name, total_members, mode, persona, custom_prompt, bot_name, welcome_msg, weather_auto, weather_time, weather_city, is_active, updated_at)
           VALUES (?, ?, 0, 'interactive', 'humorous', '', 'Sen Chúa', '', 0, '07:00', 'Hồ Chí Minh', 0, ?)`,
        ).run(mt.group_id, `Nhóm Zalo ${mt.group_id.slice(-6)}`, Date.now());
      }
      savedGroups = db.prepare("SELECT * FROM bot_groups ORDER BY total_members DESC").all() as any[];
    }

    db.close();

    const formatted = savedGroups.map((g) => ({
      id: g.group_id,
      name: g.name,
      fullName: g.name,
      icon: g.mode === "silent" ? "🟡" : g.mode === "disabled" ? "🔴" : "🟢",
      count: `${g.total_members || 0} TV`,
      mode: (g.mode as "interactive" | "silent" | "disabled") || "interactive",
      persona: (g.persona as "humorous" | "professional" | "friendly" | "strict" | "custom") || "humorous",
      customPrompt: g.custom_prompt || "",
      botName: g.bot_name || "Sen Chúa",
      welcomeMsg: g.welcome_msg || "",
      weatherAuto: Boolean(g.weather_auto),
      weatherTime: g.weather_time || "07:00",
      weatherCity: g.weather_city || "Hồ Chí Minh",
      isActive: g.is_active === 1,
    }));

    return NextResponse.json({ groups: formatted });
  } catch (error) {
    console.error("[api/groups]", error);
    return NextResponse.json({ groups: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: "scan" | "select" | "set_mode" | "update_persona" | "test_weather";
      groupId?: string;
      groupName?: string;
      mode?: "interactive" | "silent" | "disabled";
      persona?: "humorous" | "professional" | "friendly" | "strict" | "custom";
      customPrompt?: string;
      botName?: string;
      welcomeMsg?: string;
      weatherAuto?: boolean;
      weatherTime?: string;
      weatherCity?: string;
    };

    const dbPath = getBotDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ ok: false, error: "Chưa có database bot" }, { status: 400 });
    }

    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_groups (
        group_id       TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        total_members  INTEGER NOT NULL DEFAULT 0,
        mode           TEXT NOT NULL DEFAULT 'interactive',
        persona        TEXT NOT NULL DEFAULT 'humorous',
        custom_prompt  TEXT NOT NULL DEFAULT '',
        bot_name       TEXT NOT NULL DEFAULT 'Sen Chúa',
        welcome_msg    TEXT NOT NULL DEFAULT '',
        is_active      INTEGER NOT NULL DEFAULT 0,
        creator_id     TEXT,
        updated_at     INTEGER NOT NULL
      );
    `);

    // Migration thêm cột
    try {
      const cols = db.prepare(`PRAGMA table_info(bot_groups)`).all() as { name: string }[];
      if (!cols.some((c) => c.name === "persona")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN persona TEXT NOT NULL DEFAULT 'humorous'`);
      }
      if (!cols.some((c) => c.name === "custom_prompt")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN custom_prompt TEXT NOT NULL DEFAULT ''`);
      }
      if (!cols.some((c) => c.name === "bot_name")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN bot_name TEXT NOT NULL DEFAULT 'Sen Chúa'`);
      }
      if (!cols.some((c) => c.name === "welcome_msg")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN welcome_msg TEXT NOT NULL DEFAULT ''`);
      }
      if (!cols.some((c) => c.name === "weather_auto")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN weather_auto INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.some((c) => c.name === "weather_time")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN weather_time TEXT NOT NULL DEFAULT '07:00'`);
      }
      if (!cols.some((c) => c.name === "weather_city")) {
        db.exec(`ALTER TABLE bot_groups ADD COLUMN weather_city TEXT NOT NULL DEFAULT 'Hồ Chí Minh'`);
      }
    } catch {}

    if (body.action === "update_persona" && body.groupId) {
      db.prepare(
        `UPDATE bot_groups
         SET persona = COALESCE(?, persona),
             custom_prompt = COALESCE(?, custom_prompt),
             bot_name = COALESCE(?, bot_name),
             welcome_msg = COALESCE(?, welcome_msg),
             weather_auto = COALESCE(?, weather_auto),
             weather_time = COALESCE(?, weather_time),
             weather_city = COALESCE(?, weather_city),
             mode = COALESCE(?, mode),
             updated_at = ?
         WHERE group_id = ?`,
      ).run(
        body.persona ?? null,
        body.customPrompt ?? null,
        body.botName ?? null,
        body.welcomeMsg ?? null,
        body.weatherAuto !== undefined ? (body.weatherAuto ? 1 : 0) : null,
        body.weatherTime ?? null,
        body.weatherCity ?? null,
        body.mode ?? null,
        Date.now(),
        body.groupId,
      );
      db.close();
      return NextResponse.json({
        ok: true,
        message: `Đã lưu cài đặt cá tính AI & bản tin thời tiết cho nhóm thành công!`,
      });
    }

    if (body.action === "test_weather" && body.groupId) {
      const cityInput = body.weatherCity || "Hồ Chí Minh";
      const targetGroup = db.prepare("SELECT name FROM bot_groups WHERE group_id = ?").get(body.groupId) as { name?: string } | undefined;
      const groupName = targetGroup?.name || body.groupName || `Nhóm ${body.groupId.slice(-4)}`;
      db.close();

      try {
        const cities = cityInput.split(/[,;\n+]/).map((s) => s.trim()).filter(Boolean);
        const targetCities = cities.length > 0 ? cities.slice(0, 5) : ["Hồ Chí Minh"];
        const now = new Date();
        const dateStr = now.toLocaleDateString("vi-VN", {
          weekday: "long",
          day: "numeric",
          month: "numeric",
          year: "numeric",
          timeZone: "Asia/Bangkok",
        });

        const weatherResults: any[] = [];
        for (const c of targetCities) {
          try {
            const locRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(c)}&count=1&language=vi&format=json`).then((r) => r.json()).catch(() => null);
            const lat = locRes?.results?.[0]?.latitude ?? (c.toLowerCase().includes("hà nội") ? 21.0285 : 10.8231);
            const lon = locRes?.results?.[0]?.longitude ?? (c.toLowerCase().includes("hà nội") ? 105.8542 : 106.6297);
            const cityName = locRes?.results?.[0]?.name || c;

            const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&timezone=Asia%2FBangkok`).then((r) => r.json()).catch(() => null);
            const aqiRes = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5&timezone=Asia%2FBangkok`).then((r) => r.json()).catch(() => null);

            const temp = Math.round(wRes?.current?.temperature_2m ?? 28);
            const tempMin = Math.round(wRes?.daily?.temperature_2m_min?.[0] ?? temp - 3);
            const tempMax = Math.round(wRes?.daily?.temperature_2m_max?.[0] ?? temp + 3);
            const rainProb = Math.round(wRes?.daily?.precipitation_probability_max?.[0] ?? 20);
            const pm25 = Math.round(aqiRes?.current?.pm2_5 ?? 25);
            const uvIndex = Math.round(wRes?.daily?.uv_index_max?.[0] ?? 6);
            const aqiIcon = pm25 <= 35 ? "🟢" : pm25 <= 75 ? "🟡" : "🟠";
            const aqiDesc = pm25 <= 35 ? "Tốt" : pm25 <= 75 ? "Trung bình" : "Kém";

            weatherResults.push({
              city: cityName,
              temp,
              tempMin,
              tempMax,
              rainProb,
              pm25,
              uvIndex,
              aqiIcon,
              aqiDesc,
            });
          } catch {}
        }

        let testBriefing = "";
        if (weatherResults.length <= 1) {
          const w = weatherResults[0] || { city: cityInput, temp: 29, tempMin: 26, tempMax: 32, rainProb: 30, pm25: 25, aqiIcon: "🟢", aqiDesc: "Tốt", uvIndex: 6 };
          testBriefing = [
            `🌅 [TEST PREVIEW] CHÀO BUỔI SÁNG CẢ NHÀ [${groupName.toUpperCase()}]! ☀️`,
            `📅 ${dateStr}`,
            ``,
            `📍 Dự báo thời tiết tại ${w.city}:`,
            `🌤️ Trời nắng dịu | 🌡️ ${w.temp}°C (${w.tempMin}°C - ${w.tempMax}°C)`,
            `🌧️ Xác suất mưa: ${w.rainProb}% | 🍃 Bụi mịn PM2.5: ${w.pm25} µg/m³ (${w.aqiIcon} ${w.aqiDesc})`,
            ``,
            `💡 Nhắc nhở ngày mới:`,
            w.rainProb >= 50 ? `• ☔ Khả năng có mưa cao (${w.rainProb}%), nhớ mang theo ô/áo mưa khi ra ngoài!` : `• ✨ Thời tiết thuận lợi cho các hoạt động và công việc.`,
            w.uvIndex >= 7 ? `• 🕶️ Chỉ số UV cao (${w.uvIndex}), nên che chắn cẩn thận khi ra đường vào buổi trưa.` : `• ☕ Chúc bạn một ngày mới nhiều may mắn và năng lượng!`,
            ``,
            `✨ Chúc anh em một ngày làm việc hiệu quả và tràn đầy năng lượng! 💪`,
          ].join("\n");
        } else {
          testBriefing = [
            `🌅 [TEST PREVIEW] CHÀO BUỔI SÁNG CẢ NHÀ [${groupName.toUpperCase()}]! ☀️`,
            `📅 ${dateStr}`,
            ``,
            `📍 Dự báo thời tiết các khu vực hôm nay:`,
            ...weatherResults.map(
              (w) =>
                `• 📍 ${w.city}: 🌤️ ${w.temp}°C (${w.tempMin}°C - ${w.tempMax}°C) | 🌧️ Mưa: ${w.rainProb}% | 🍃 Bụi mịn: ${w.aqiIcon} ${w.aqiDesc}`
            ),
            ``,
            `💡 Nhắc nhở ngày mới:`,
            weatherResults.some((w) => w.rainProb >= 50)
              ? `• ☔ Một số khu vực có khả năng mưa cao, anh em nhớ mang theo ô hoặc áo mưa khi ra ngoài!`
              : `• ✨ Thời tiết tại các khu vực khá thuận lợi cho các hoạt động và công việc.`,
            `\n✨ Chúc anh em một ngày làm việc hiệu quả và tràn đầy năng lượng! 💪`,
          ].join("\n");
        }

        const payload = JSON.stringify({
          requestId: `weather_test_${Date.now()}`,
          parts: [testBriefing],
          groupId: body.groupId,
          requestedAt: Date.now(),
          requestedBy: "web_test_weather",
        });

        const reqPath = path.resolve(path.dirname(dbPath), "session", "summary-send-request.json");
        fs.mkdirSync(path.dirname(reqPath), { recursive: true });
        fs.writeFileSync(reqPath, payload, "utf8");

        return NextResponse.json({
          ok: true,
          message: `Đã gửi bản tin thử nghiệm vào nhóm [${groupName}]!`,
        });
      } catch (e) {
        return NextResponse.json({
          ok: false,
          error: `Lỗi khi gửi bản tin thử nghiệm: ${String(e)}`,
        });
      }
    }

    if (body.action === "scan") {
      try {
        const payload = JSON.stringify({ requestedAt: Date.now(), requestedBy: "dashboard" });
        const reqPaths = [
          path.resolve(path.dirname(dbPath), "group-scan-request.json"),
          path.resolve(path.dirname(dbPath), "session", "group-scan-request.json"),
        ];
        for (const p of reqPaths) {
          try {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, payload, "utf8");
          } catch {}
        }
      } catch (e) {
        console.warn("[api/groups] Không ghi được file group-scan-request:", e);
      }
      // Đợi bot quét xong trong 1.5s
      await new Promise((r) => setTimeout(r, 1500));

      const updated = db.prepare("SELECT * FROM bot_groups ORDER BY total_members DESC").all() as any[];
      db.close();
      const formatted = updated.map((g) => ({
        id: g.group_id,
        name: g.name,
        fullName: g.name,
        icon: g.mode === "silent" ? "🟡" : g.mode === "disabled" ? "🔴" : "🟢",
        count: `${g.total_members || 0} TV`,
        mode: g.mode || "interactive",
        persona: g.persona || "humorous",
        customPrompt: g.custom_prompt || "",
        botName: g.bot_name || "Sen Chúa",
        welcomeMsg: g.welcome_msg || "",
        isActive: g.is_active === 1,
      }));
      return NextResponse.json({ ok: true, groups: formatted });
    }

    if (body.action === "set_mode" && body.groupId && body.mode) {
      db.prepare(
        `INSERT INTO bot_groups (group_id, name, total_members, mode, is_active, updated_at)
         VALUES (@groupId, @name, 0, @mode, 0, @now)
         ON CONFLICT(group_id) DO UPDATE SET
           mode = @mode,
           updated_at = @now`
      ).run({
        groupId: body.groupId,
        name: `Nhóm ${body.groupId.slice(-4)}`,
        mode: body.mode,
        now: Date.now(),
      });
      try {
        db.prepare(
          `INSERT INTO group_settings (group_id, mode, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(group_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`
        ).run(body.groupId, body.mode, Date.now());
      } catch {}
      db.close();
      return NextResponse.json({ ok: true, message: `Đã cập nhật chế độ cho nhóm: ${body.mode}` });
    }

    if (body.action === "select" && body.groupId) {
      db.prepare("UPDATE bot_groups SET is_active = 0").run();
      db.prepare("UPDATE bot_groups SET is_active = 1 WHERE group_id = ?").run(body.groupId);
      db.close();
      return NextResponse.json({ ok: true, message: `Đã chọn nhóm hoạt động chính: ${body.groupId}` });
    }

    if (body.groupId && body.groupName) {
      db.prepare(
        `INSERT OR REPLACE INTO bot_groups (group_id, name, total_members, mode, persona, custom_prompt, bot_name, welcome_msg, is_active, updated_at)
         VALUES (?, ?, ?, 'interactive', 'humorous', '', 'Sen Chúa', '', 1, ?)`,
      ).run(body.groupId, body.groupName, 0, Date.now());
    }

    db.close();
    return NextResponse.json({ ok: true, message: "Đã cập nhật danh sách nhóm" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Lỗi cập nhật nhóm" }, { status: 500 });
  }
}

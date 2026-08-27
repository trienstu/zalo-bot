import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

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

export async function GET() {
  try {
    const dbPath = getBotDbPath();
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
        is_active      INTEGER NOT NULL DEFAULT 0,
        creator_id     TEXT,
        updated_at     INTEGER NOT NULL
      );
    `);

    // 1. Đọc danh sách group đã lưu trong bot_groups
    let savedGroups = db.prepare("SELECT * FROM bot_groups ORDER BY total_members DESC").all() as {
      group_id: string;
      name: string;
      total_members: number;
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
            `INSERT OR REPLACE INTO bot_groups (group_id, name, total_members, is_active, updated_at)
             VALUES (?, ?, ?, 0, ?)`,
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
          `INSERT OR IGNORE INTO bot_groups (group_id, name, total_members, is_active, updated_at)
           VALUES (?, ?, 0, 0, ?)`,
        ).run(mt.group_id, `Nhóm Zalo ${mt.group_id.slice(-6)}`, Date.now());
      }
      savedGroups = db.prepare("SELECT * FROM bot_groups ORDER BY total_members DESC").all() as any[];
    }

    db.close();

    const formatted = savedGroups.map((g) => ({
      id: g.group_id,
      name: g.name,
      fullName: g.name,
      icon: "👥",
      count: `${g.total_members || 0} TV`,
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
      action?: "scan" | "select";
      groupId?: string;
      groupName?: string;
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
        is_active      INTEGER NOT NULL DEFAULT 0,
        creator_id     TEXT,
        updated_at     INTEGER NOT NULL
      );
    `);

    if (body.action === "select" && body.groupId) {
      db.prepare("UPDATE bot_groups SET is_active = 0").run();
      db.prepare("UPDATE bot_groups SET is_active = 1 WHERE group_id = ?").run(body.groupId);
      db.close();
      return NextResponse.json({ ok: true, message: `Đã chọn nhóm hoạt động chính: ${body.groupId}` });
    }

    if (body.groupId && body.groupName) {
      db.prepare(
        `INSERT OR REPLACE INTO bot_groups (group_id, name, total_members, is_active, updated_at)
         VALUES (?, ?, ?, 1, ?)`,
      ).run(body.groupId, body.groupName, 0, Date.now());
    }

    db.close();
    return NextResponse.json({ ok: true, message: "Đã cập nhật danh sách nhóm" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Lỗi cập nhật nhóm" }, { status: 500 });
  }
}

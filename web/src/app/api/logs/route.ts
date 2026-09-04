import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import {
  detectCurrentBotId,
  fetchLogs,
  getPm2LogsDir,
  listAvailableLogStreams,
} from "@/lib/logs";
import { dbExists, listBotErrors, listManagedGroups, type ManagedGroup } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const hostHeader = req.headers.get("host") || "";
    const cookieBotId = req.cookies.get("active_bot_id")?.value;
    const queryBotId = url.searchParams.get("botId");

    // Ưu tiên botId được chỉ định, nếu không thì tự động nhận diện từ Host / Port
    let botId: "bot-1" | "bot-2" = "bot-1";
    if (queryBotId === "bot-2" || cookieBotId === "bot-2") {
      botId = "bot-2";
    } else {
      botId = detectCurrentBotId(hostHeader || url.host);
    }

    const stream = url.searchParams.get("stream") || "bot-all";
    const linesParam = parseInt(url.searchParams.get("lines") || "150", 10);
    const maxLines = Math.min(Math.max(linesParam || 150, 20), 1000);
    const keyword = url.searchParams.get("keyword") || "";
    const groupId = url.searchParams.get("groupId") || "";

    const { lines, sourceName, sourceFound, totalSize } = fetchLogs(
      botId,
      stream,
      maxLines,
      keyword,
      groupId
    );

    const availableStreams = listAvailableLogStreams(botId);

    // Lấy danh sách nhóm của bot này để người dùng có thể lọc theo từng nhóm
    let groups: ManagedGroup[] = [];
    if (dbExists(botId)) {
      try {
        groups = listManagedGroups(botId);
      } catch {
        // Ignore
      }
    }

    // Lấy thêm số lượng lỗi trong SQLite nếu có
    let dbErrorsCount = 0;
    if (dbExists(botId)) {
      try {
        const errs = listBotErrors(10, botId);
        dbErrorsCount = errs.length;
      } catch {
        // Ignore
      }
    }

    const botName = botId === "bot-2" ? "Mộc Miên" : "Sen Chúa";

    return NextResponse.json({
      ok: true,
      botId,
      botName,
      stream,
      sourceName,
      sourceFound,
      totalSize,
      lines,
      streams: availableStreams,
      groups,
      dbErrorsCount,
      serverTime: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Lỗi API /api/logs:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Lỗi đọc log hệ thống",
      },
      { status: 500 }
    );
  }
}

/**
 * Xoá sạch (truncate) file log trên VPS khi người dùng bấm reset log
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { streamId, botId: requestedBotId } = body;

    const hostHeader = req.headers.get("host") || "";
    const botId = requestedBotId === "bot-2" ? "bot-2" : detectCurrentBotId(hostHeader);
    const botNum = botId === "bot-2" ? "2" : "1";
    const pm2Dir = getPm2LogsDir();

    const filesToTruncate: string[] = [];

    if (streamId === "bot-all") {
      filesToTruncate.push(
        path.join(pm2Dir, `zalo-bot-${botNum}-out.log`),
        path.join(pm2Dir, `zalo-bot-${botNum}-error.log`)
      );
    } else if (streamId === "bot-out") {
      filesToTruncate.push(path.join(pm2Dir, `zalo-bot-${botNum}-out.log`));
    } else if (streamId === "bot-error") {
      filesToTruncate.push(path.join(pm2Dir, `zalo-bot-${botNum}-error.log`));
    } else if (streamId === "web-out") {
      filesToTruncate.push(path.join(pm2Dir, `zalo-web-${botNum}-out.log`));
    } else if (streamId === "web-error") {
      filesToTruncate.push(path.join(pm2Dir, `zalo-web-${botNum}-error.log`));
    } else if (typeof streamId === "string" && streamId.endsWith(".log")) {
      // Tên file cụ thể
      const safeName = path.basename(streamId);
      filesToTruncate.push(path.join(pm2Dir, safeName));
    }

    let truncatedCount = 0;
    for (const f of filesToTruncate) {
      if (fs.existsSync(f)) {
        fs.writeFileSync(f, "");
        truncatedCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Đã xoá trắng ${truncatedCount} file log.`,
      truncatedCount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Không thể xoá log" },
      { status: 500 }
    );
  }
}

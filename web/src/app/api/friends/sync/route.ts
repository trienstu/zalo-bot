import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { friendSyncRequestPath } from "@/lib/login-status";
import { isOriginAllowed } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { botId?: string };
  const botId = body.botId || "bot-1";
  const requestPath = friendSyncRequestPath(botId);
  const dir = path.dirname(requestPath);
  const tempPath = `${requestPath}.${process.pid}.tmp`;
  const requestedAt = Date.now();

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      tempPath,
      JSON.stringify({ requestedAt, requestedBy: "dashboard", botId }, null, 2),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    fs.renameSync(tempPath, requestPath);
    return NextResponse.json({
      ok: true,
      requestedAt,
      pending: true,
    });
  } catch (e) {
    fs.rmSync(tempPath, { force: true });
    console.error("[api/friends/sync]", e);
    return NextResponse.json(
      { error: "Không ghi được yêu cầu đồng bộ bạn bè. Kiểm tra quyền thư mục data." },
      { status: 500 },
    );
  }
}

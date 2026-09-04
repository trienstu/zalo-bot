import { NextResponse } from "next/server";
import fs from "node:fs";
import { DbNotReadyError, listBotFriends, setFriendAllowDirect, getFriendSyncStatus } from "@/lib/db";
import { friendSyncRequestPath } from "@/lib/login-status";
import { isOriginAllowed } from "@/lib/http";

export const dynamic = "force-dynamic";

function handleDbError(e: unknown): NextResponse | never {
  if (e instanceof DbNotReadyError) {
    return NextResponse.json({ error: "Bot chưa chạy lần nào — chưa có cơ sở dữ liệu." }, { status: 503 });
  }
  throw e;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const botId = url.searchParams.get("botId") || "bot-1";

    const friends = listBotFriends(botId);
    const syncStatus = getFriendSyncStatus(botId);
    const requestPath = friendSyncRequestPath(botId);
    const isPending = fs.existsSync(requestPath);

    return NextResponse.json({
      ok: true,
      friends,
      sync: {
        ...syncStatus,
        pending: isPending,
      },
    });
  } catch (e) {
    return handleDbError(e);
  }
}

export async function PATCH(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      userId?: string;
      allowDirect?: boolean;
      botId?: string;
    };

    if (!body.userId) {
      return NextResponse.json({ error: "Thiếu userId" }, { status: 400 });
    }

    const botId = body.botId || "bot-1";
    const allow = Boolean(body.allowDirect);
    const success = setFriendAllowDirect(body.userId, allow, botId);

    return NextResponse.json({
      ok: success,
      userId: body.userId,
      allowDirect: allow,
    });
  } catch (e) {
    return handleDbError(e);
  }
}

import { NextResponse } from "next/server";
import { resolveBotIdFromRequest } from "@/lib/bot-id";
import { isOriginAllowed } from "@/lib/http";
import {
  createVerifyTask,
  getLatestVerifyTask,
  updateVerifyTask,
  countUnverifiedContacts,
} from "@/lib/zalomkt-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const botId = resolveBotIdFromRequest(request);
    const groupId = searchParams.get("groupId") || "";

    const latestTask = getLatestVerifyTask(botId);
    const unverifiedCount = countUnverifiedContacts(groupId, botId);

    return NextResponse.json({
      ok: true,
      task: latestTask,
      unverifiedCount,
    });
  } catch (err: any) {
    console.error("[api/zalomkt/contacts/verify] GET error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: "start" | "stop";
      groupId?: string;
      taskId?: string;
      botId?: string;
    };

    const botId = resolveBotIdFromRequest(request, body.botId);

    if (body.action === "stop") {
      if (body.taskId) {
        updateVerifyTask(body.taskId, { status: "stopped" }, botId);
      } else {
        const current = getLatestVerifyTask(botId);
        if (current && current.status === "running") {
          updateVerifyTask(current.id, { status: "stopped" }, botId);
        }
      }
      return NextResponse.json({ ok: true, message: "Đã dừng tác vụ xác minh" });
    }

    // Khởi chạy tác vụ quét mới
    const groupId = body.groupId || "";
    const total = countUnverifiedContacts(groupId, botId);

    if (total === 0) {
      return NextResponse.json(
        { ok: false, error: "Tất cả các số điện thoại trong danh sách đã được xác minh trước đó." },
        { status: 400 },
      );
    }

    const task = createVerifyTask(total, groupId, botId);

    return NextResponse.json({
      ok: true,
      task,
      message: `Đã khởi chạy tác vụ quét kiểm tra Zalo cho ${total} số điện thoại.`,
    });
  } catch (err: any) {
    console.error("[api/zalomkt/contacts/verify] POST error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

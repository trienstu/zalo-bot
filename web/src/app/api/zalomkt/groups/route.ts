import { NextResponse } from "next/server";
import { resolveBotIdFromRequest } from "@/lib/bot-id";
import { isOriginAllowed } from "@/lib/http";
import {
  listContactGroups,
  createContactGroup,
  deleteContactGroup,
} from "@/lib/zalomkt-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const botId = resolveBotIdFromRequest(request);
    const groups = listContactGroups(botId);

    return NextResponse.json({
      ok: true,
      groups,
    });
  } catch (err: any) {
    console.error("[api/zalomkt/groups] GET error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      color?: string;
      botId?: string;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ ok: false, error: "Tên nhóm không được để trống" }, { status: 400 });
    }

    const botId = resolveBotIdFromRequest(request, body.botId);
    const newGroup = createContactGroup(
      body.name.trim(),
      body.description?.trim() || "",
      body.color?.trim() || "sky",
      botId,
    );

    return NextResponse.json({
      ok: true,
      group: newGroup,
    });
  } catch (err: any) {
    console.error("[api/zalomkt/groups] POST error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");
    let botIdReq: string | undefined;

    if (!id) {
      const body = (await request.json().catch(() => ({}))) as { id?: string; botId?: string };
      id = body.id || null;
      botIdReq = body.botId;
    }

    if (!id) {
      return NextResponse.json({ ok: false, error: "Thiếu ID nhóm cần xóa" }, { status: 400 });
    }

    const botId = resolveBotIdFromRequest(request, botIdReq);
    deleteContactGroup(id, botId);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[api/zalomkt/groups] DELETE error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

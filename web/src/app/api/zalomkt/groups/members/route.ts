import { NextResponse } from "next/server";
import { resolveBotIdFromRequest } from "@/lib/bot-id";
import { isOriginAllowed } from "@/lib/http";
import { addPhonesToGroup, removePhonesFromGroup } from "@/lib/zalomkt-db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      groupId?: string;
      rawPhones?: string;
      phones?: string[];
      botId?: string;
    };

    if (!body.groupId?.trim()) {
      return NextResponse.json({ ok: false, error: "Thiếu ID nhóm" }, { status: 400 });
    }

    let phoneList: string[] = [];
    if (Array.isArray(body.phones)) {
      phoneList = body.phones;
    } else if (body.rawPhones?.trim()) {
      phoneList = body.rawPhones.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
    }

    if (phoneList.length === 0) {
      return NextResponse.json({ ok: false, error: "Thiếu danh sách số điện thoại" }, { status: 400 });
    }

    const botId = resolveBotIdFromRequest(request, body.botId);
    const result = addPhonesToGroup(body.groupId, phoneList, botId);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("[api/zalomkt/groups/members] POST error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      groupId?: string;
      phones?: string[];
      botId?: string;
    };

    if (!body.groupId?.trim() || !Array.isArray(body.phones) || body.phones.length === 0) {
      return NextResponse.json({ ok: false, error: "Thiếu ID nhóm hoặc danh sách số điện thoại" }, { status: 400 });
    }

    const botId = resolveBotIdFromRequest(request, body.botId);
    const removedCount = removePhonesFromGroup(body.groupId, body.phones, botId);

    return NextResponse.json({
      ok: true,
      removed: removedCount,
    });
  } catch (err: any) {
    console.error("[api/zalomkt/groups/members] DELETE error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

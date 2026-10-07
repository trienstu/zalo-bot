import { NextResponse } from "next/server";
import { resolveBotIdFromRequest } from "@/lib/bot-id";
import { isOriginAllowed } from "@/lib/http";
import {
  listMktContacts,
  importMktContacts,
  getMktStats,
} from "@/lib/zalomkt-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const botId = resolveBotIdFromRequest(request);

    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "all";
    const groupId = searchParams.get("groupId") || "all";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const { contacts, total } = listMktContacts({ search, status, groupId, page, limit }, botId);
    const stats = getMktStats(botId);

    return NextResponse.json({
      ok: true,
      contacts,
      stats,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("[api/zalomkt/contacts] GET error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      rawPhones?: string;
      botId?: string;
    };

    if (!body.rawPhones?.trim()) {
      return NextResponse.json({ ok: false, error: "Thiếu danh sách số điện thoại" }, { status: 400 });
    }

    const botId = resolveBotIdFromRequest(request, body.botId);
    const result = importMktContacts(body.rawPhones, botId);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("[api/zalomkt/contacts] POST error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

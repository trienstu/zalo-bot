import { NextResponse } from "next/server";
import { resolveBotIdFromRequest } from "@/lib/bot-id";
import { isOriginAllowed } from "@/lib/http";
import {
  listMktCampaigns,
  createMktCampaign,
  getMktStats,
} from "@/lib/zalomkt-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const botId = resolveBotIdFromRequest(request);
    const campaigns = listMktCampaigns(botId);
    const stats = getMktStats(botId);

    return NextResponse.json({
      ok: true,
      campaigns,
      stats,
    });
  } catch (err: any) {
    console.error("[api/zalomkt/campaigns] GET error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      rawContent?: string;
      images?: string[];
      config?: Record<string, any>;
      rawPhones?: string;
      botId?: string;
    };

    if (!body.title?.trim()) {
      return NextResponse.json({ ok: false, error: "Thiếu tiêu đề chiến dịch" }, { status: 400 });
    }
    if (!body.rawContent?.trim()) {
      return NextResponse.json({ ok: false, error: "Thiếu nội dung tin nhắn" }, { status: 400 });
    }
    if (!body.rawPhones?.trim()) {
      return NextResponse.json({ ok: false, error: "Thiếu danh sách số điện thoại" }, { status: 400 });
    }

    const botId = resolveBotIdFromRequest(request, body.botId);
    const result = createMktCampaign(
      {
        title: body.title,
        rawContent: body.rawContent,
        images: body.images || [],
        config: body.config || {},
        rawPhones: body.rawPhones,
      },
      botId,
    );

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("[api/zalomkt/campaigns] POST error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

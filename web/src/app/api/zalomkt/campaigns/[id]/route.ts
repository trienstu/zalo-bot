import { NextResponse } from "next/server";
import { resolveBotIdFromRequest } from "@/lib/bot-id";
import { isOriginAllowed } from "@/lib/http";
import {
  getMktCampaign,
  getCampaignLeads,
  deleteMktCampaign,
} from "@/lib/zalomkt-db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const botId = resolveBotIdFromRequest(request);

    const campaign = getMktCampaign(id, botId);
    if (!campaign) {
      return NextResponse.json({ ok: false, error: "Không tìm thấy chiến dịch" }, { status: 404 });
    }

    const status = searchParams.get("status") || "all";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const { leads, total } = getCampaignLeads(id, { status, page, limit }, botId);

    return NextResponse.json({
      ok: true,
      campaign,
      leads,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("[api/zalomkt/campaigns/[id]] GET error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const botId = resolveBotIdFromRequest(request);
    const success = deleteMktCampaign(id, botId);

    return NextResponse.json({ ok: success });
  } catch (err: any) {
    console.error("[api/zalomkt/campaigns/[id]] DELETE error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

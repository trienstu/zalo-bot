import { NextResponse } from "next/server";
import { resolveBotIdFromRequest } from "@/lib/bot-id";
import { isOriginAllowed } from "@/lib/http";
import { controlMktCampaign, getMktCampaign } from "@/lib/zalomkt-db";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: "start" | "pause" | "resume" | "stop";
      botId?: string;
    };

    if (!body.action || !["start", "pause", "resume", "stop"].includes(body.action)) {
      return NextResponse.json({ ok: false, error: "Hành động không hợp lệ" }, { status: 400 });
    }

    const botId = resolveBotIdFromRequest(request, body.botId);
    const campaign = getMktCampaign(id, botId);
    if (!campaign) {
      return NextResponse.json({ ok: false, error: "Không tìm thấy chiến dịch" }, { status: 404 });
    }

    const ok = controlMktCampaign(id, body.action, botId);
    const updated = getMktCampaign(id, botId);

    return NextResponse.json({
      ok,
      campaign: updated,
    });
  } catch (err) {
    console.error("[api/zalomkt/campaigns/[id]/control] POST error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

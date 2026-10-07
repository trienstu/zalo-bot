import { NextResponse } from "next/server";
import { resolveBotIdFromRequest } from "@/lib/bot-id";
import { isOriginAllowed } from "@/lib/http";
import {
  listMktCampaigns,
  createMktCampaign,
  copyMktCampaign,
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
      action?: "create" | "copy";
      sourceCampaignId?: string;
      copyLeads?: boolean;
      title?: string;
      rawContent?: string;
      images?: string[];
      config?: Record<string, any>;
      rawPhones?: string;
      groupIds?: string[];
      groupFilterMode?: "all" | "uncontacted" | "valid_only";
      scheduledAt?: number | null;
      isDraft?: boolean;
      botId?: string;
    };

    const botId = resolveBotIdFromRequest(request, body.botId);

    // 1. Thao tác Sao Chép / Nhân Bản Chiến Dịch
    if (body.action === "copy") {
      if (!body.sourceCampaignId) {
        return NextResponse.json({ ok: false, error: "Thiếu ID chiến dịch gốc để nhân bản" }, { status: 400 });
      }
      const copied = copyMktCampaign(
        body.sourceCampaignId,
        {
          newTitle: body.title,
          copyLeads: Boolean(body.copyLeads),
        },
        botId,
      );
      return NextResponse.json({
        ok: true,
        ...copied,
        message: "Sao chép chiến dịch thành công",
      });
    }

    // 2. Thao tác Tạo Chiến Dịch Mới
    if (!body.title?.trim()) {
      return NextResponse.json({ ok: false, error: "Thiếu tiêu đề chiến dịch" }, { status: 400 });
    }
    if (!body.rawContent?.trim()) {
      return NextResponse.json({ ok: false, error: "Thiếu nội dung tin nhắn" }, { status: 400 });
    }
    const hasPhones = Boolean(body.rawPhones?.trim());
    const hasGroups = Array.isArray(body.groupIds) && body.groupIds.length > 0;
    if (!hasPhones && !hasGroups) {
      return NextResponse.json(
        { ok: false, error: "Vui lòng nhập danh sách số điện thoại hoặc chọn ít nhất 1 nhóm khách hàng" },
        { status: 400 },
      );
    }

    const result = createMktCampaign(
      {
        title: body.title,
        rawContent: body.rawContent,
        images: body.images || [],
        config: body.config || {},
        rawPhones: body.rawPhones || "",
        groupIds: body.groupIds || [],
        groupFilterMode: body.groupFilterMode || "all",
        scheduledAt: body.scheduledAt || null,
        isDraft: Boolean(body.isDraft),
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


import { NextResponse } from "next/server";
import { resolveBotIdFromRequest } from "@/lib/bot-id";
import { getMktCampaign, getCampaignLeads } from "@/lib/zalomkt-db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const botId = resolveBotIdFromRequest(request);

    const campaign = getMktCampaign(id, botId);
    if (!campaign) {
      return new Response("Không tìm thấy chiến dịch", { status: 404 });
    }

    const { leads } = getCampaignLeads(id, { limit: 10000 }, botId);

    // Chuẩn bị CSV với UTF-8 BOM (\uFEFF) để Excel hiển thị tiếng Việt hoàn hảo
    const headers = [
      "ID",
      "Số điện thoại",
      "Tên người nhận",
      "UID Zalo",
      "Giới tính",
      "Trạng thái",
      "Lý do bỏ qua / Lỗi",
      "Nội dung đã gửi",
      "Đã đổi tên (Alias)",
      "Đã gửi kết bạn",
      "Thời gian gửi",
    ];

    const escapeCsv = (val: any) => {
      const str = String(val ?? "").replace(/"/g, '""');
      return `"${str}"`;
    };

    const csvRows = [headers.map(escapeCsv).join(",")];

    for (const lead of leads) {
      let genderStr = "Chưa rõ";
      if (lead.gender === 1) genderStr = "Nam";
      else if (lead.gender === 0) genderStr = "Nữ";

      let statusStr: string = lead.status;
      if (lead.status === "sent") statusStr = "Đã gửi thành công";
      else if (lead.status === "failed") statusStr = "Thất bại";
      else if (lead.status === "skipped") statusStr = "Tự động bỏ qua";
      else if (lead.status === "pending") statusStr = "Chờ gửi";
      else if (lead.status === "searching") statusStr = "Đang tìm Zalo";

      const sentTimeStr = lead.sent_at ? new Date(lead.sent_at).toLocaleString("vi-VN") : "";

      csvRows.push(
        [
          lead.id,
          lead.phone,
          lead.custom_name || lead.display_name,
          lead.zalo_uid || "",
          genderStr,
          statusStr,
          lead.skip_reason || lead.error_message || "",
          lead.personalized_text || "",
          lead.alias_updated ? lead.alias_name || "Có" : "Không",
          lead.friend_requested ? "Có" : "Không",
          sentTimeStr,
        ]
          .map(escapeCsv)
          .join(","),
      );
    }

    const csvContent = "\uFEFF" + csvRows.join("\r\n");

    const safeFilename = `zalomkt_${campaign.title.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, "_")}_${id}.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeFilename)}"`,
      },
    });
  } catch (err) {
    console.error("[api/zalomkt/campaigns/[id]/export] GET error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response("Lỗi xuất file: " + message, { status: 500 });
  }
}

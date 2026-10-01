import { NextRequest, NextResponse } from "next/server";
import {
  listTrackedChatsWeb,
  setChatTrackingStatusWeb,
  createCrawlRequestWeb,
  getCrawlRequestStatusWeb,
} from "@/lib/telegram-db";

export async function GET() {
  try {
    const chats = listTrackedChatsWeb();
    return NextResponse.json({ ok: true, chats });
  } catch (err: any) {
    console.error("[api/telegram/chats] Lỗi GET:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { chatId, isTracked, action, limit, requestId } = body;

    // 1. Kiểm tra trạng thái yêu cầu đang chạy
    if (action === "check_status" && requestId) {
      const status = getCrawlRequestStatusWeb(Number(requestId));
      return NextResponse.json({ ok: true, status });
    }

    if (!chatId) {
      return NextResponse.json({ ok: false, error: "Thiếu chatId" }, { status: 400 });
    }

    // 2. Yêu cầu quét tin nhắn cũ, quét file hoặc quét toàn bộ lịch sử
    if (action === "scan_history" || action === "scan_files" || action === "scan_all_history") {
      const parsedLimit = limit !== undefined && limit !== null && limit !== "" ? Number(limit) : undefined;
      const effectiveLimit =
        parsedLimit !== undefined
          ? parsedLimit
          : action === "scan_all_history"
          ? 0
          : action === "scan_files"
          ? 50
          : 100;

      const newReqId = createCrawlRequestWeb({
        chatId,
        action,
        limit: effectiveLimit,
      });

      const actionText =
        action === "scan_all_history"
          ? "quét toàn bộ lịch sử nhóm"
          : action === "scan_files"
          ? "quét file tài liệu"
          : `quét ${effectiveLimit} tin nhắn cũ`;

      return NextResponse.json({
        ok: true,
        requestId: newReqId,
        message: `Đã xếp hàng yêu cầu ${actionText}.`,
      });
    }

    // 3. Đổi trạng thái theo dõi
    setChatTrackingStatusWeb(chatId, Boolean(isTracked));
    return NextResponse.json({ ok: true, message: "Đã cập nhật trạng thái theo dõi." });
  } catch (err: any) {
    console.error("[api/telegram/chats] Lỗi POST:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

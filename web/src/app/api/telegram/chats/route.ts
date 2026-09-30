import { NextRequest, NextResponse } from "next/server";
import { listTrackedChatsWeb, setChatTrackingStatusWeb } from "@/lib/telegram-db";

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
    const { chatId, isTracked } = body;
    if (!chatId) {
      return NextResponse.json({ ok: false, error: "Thiếu chatId" }, { status: 400 });
    }

    setChatTrackingStatusWeb(chatId, Boolean(isTracked));
    return NextResponse.json({ ok: true, message: "Đã cập nhật trạng thái theo dõi." });
  } catch (err: any) {
    console.error("[api/telegram/chats] Lỗi POST:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

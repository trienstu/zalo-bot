import { NextRequest, NextResponse } from "next/server";
import { listRawMessagesWeb } from "@/lib/telegram-db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId") || undefined;
    const limitStr = searchParams.get("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const offsetStr = searchParams.get("offset");
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    const data = listRawMessagesWeb({
      chatId,
      limit,
      offset,
    });

    return NextResponse.json({ ok: true, ...data });
  } catch (err: any) {
    console.error("[api/telegram/messages] Lỗi:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

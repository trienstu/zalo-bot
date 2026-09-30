import { NextRequest, NextResponse } from "next/server";
import { listKnowledgeItemsWeb } from "@/lib/telegram-db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId") || undefined;
    const category = searchParams.get("category") || undefined;
    const daysStr = searchParams.get("days");
    const days = daysStr ? parseInt(daysStr, 10) : undefined;
    const search = searchParams.get("search") || undefined;
    const limitStr = searchParams.get("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const offsetStr = searchParams.get("offset");
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    const data = listKnowledgeItemsWeb({
      chatId,
      category,
      days,
      search,
      limit,
      offset,
    });

    return NextResponse.json({ ok: true, ...data });
  } catch (err: any) {
    console.error("[api/telegram/knowledge] Lỗi:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

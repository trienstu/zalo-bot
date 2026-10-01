import { NextRequest, NextResponse } from "next/server";
import { getTrackedChatByIdWeb, listKnowledgeItemsWeb } from "@/lib/telegram-db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");
    if (!chatId) {
      return NextResponse.json(
        { ok: false, error: "Thiếu tham số chatId." },
        { status: 400 },
      );
    }

    const chat = getTrackedChatByIdWeb(chatId);
    if (!chat) {
      return NextResponse.json(
        { ok: false, error: "Không tìm thấy nhóm Telegram này." },
        { status: 404 },
      );
    }

    const category = searchParams.get("category") || undefined;
    const search = searchParams.get("search") || undefined;
    const daysStr = searchParams.get("days");
    const days = daysStr ? parseInt(daysStr, 10) : undefined;

    const { items, total } = listKnowledgeItemsWeb({
      chatId,
      category,
      days,
      search,
      limit: 200,
    });

    return NextResponse.json({
      ok: true,
      chat: {
        chat_id: chat.chat_id,
        title: chat.title,
        username: chat.username,
        chat_type: chat.chat_type,
        message_count: chat.message_count || 0,
        knowledge_count: chat.knowledge_count || 0,
      },
      items,
      total,
    });
  } catch (err: any) {
    console.error("[api/telegram/share] Lỗi:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

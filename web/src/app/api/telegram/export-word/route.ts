import { NextRequest, NextResponse } from "next/server";
import {
  listKnowledgeItemsWeb,
  getKnowledgeItemByIdWeb,
  recordTelegramExportWeb,
} from "@/lib/telegram-db";
import {
  generateTelegramKnowledgeDocxBuffer,
  generateSingleTelegramKnowledgeDocxBuffer,
} from "@/lib/telegram-word";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const itemIdStr = searchParams.get("itemId");

    // Trường hợp 1: Xuất 1 bài viết riêng biệt
    if (itemIdStr) {
      const itemId = parseInt(itemIdStr, 10);
      if (isNaN(itemId)) {
        return NextResponse.json(
          { ok: false, error: "Tham số itemId không hợp lệ." },
          { status: 400 },
        );
      }
      const item = getKnowledgeItemByIdWeb(itemId);
      if (!item) {
        return NextResponse.json(
          { ok: false, error: "Không tìm thấy bài viết này trong kho tri thức." },
          { status: 404 },
        );
      }

      const docxBuffer = await generateSingleTelegramKnowledgeDocxBuffer(item);
      const safeTitle = item.title
        .replace(/[\\/:*?"<>|]/g, "_")
        .slice(0, 80)
        .trim();
      const fileName = `${safeTitle || "Bai_Viet_Tri_Thuc"}.docx`;

      // Ghi nhận vào DB
      recordTelegramExportWeb({
        title: `Bài viết: ${item.title.slice(0, 60)}`,
        file_name: fileName,
        file_path: fileName,
        file_size: docxBuffer.length,
        item_count: 1,
        filter_category: item.category || "all",
        filter_days: 0,
      });

      return new Response(new Uint8Array(docxBuffer), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "Content-Length": String(docxBuffer.length),
        },
      });
    }

    // Trường hợp 2: Xuất toàn bộ hoặc lọc theo nhóm / chủ đề
    const chatId = searchParams.get("chatId") || undefined;
    const category = searchParams.get("category") || undefined;
    const daysStr = searchParams.get("days");
    const days = daysStr ? parseInt(daysStr, 10) : undefined;
    const search = searchParams.get("search") || undefined;

    const { items } = listKnowledgeItemsWeb({
      chatId,
      category,
      days,
      search,
      limit: 500, // Lấy tối đa 500 mục tri thức cho 1 file Word
    });

    if (items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Không có mục tri thức nào phù hợp với bộ lọc để xuất file Word." },
        { status: 400 },
      );
    }

    const timestamp = Date.now();
    const dateStr = new Date().toISOString().slice(0, 10);
    const catLabel = category && category !== "all" ? `_${category}` : "";
    let chatName = "";
    if (chatId && chatId !== "all" && items[0]?.chat_title) {
      chatName = `_${items[0].chat_title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 30).trim()}`;
    }
    const fileName = `Telegram_Tri_Thuc${chatName}${catLabel}_${dateStr}_${timestamp}.docx`;

    const docTitle = chatName
      ? `TỔNG HỢP TRI THỨC - ${items[0]?.chat_title?.toUpperCase()} (${items.length} MỤC)`
      : `TỔNG HỢP TRI THỨC TELEGRAM (${items.length} MỤC)`;

    const docxBuffer = await generateTelegramKnowledgeDocxBuffer(
      items,
      docTitle,
    );

    // Ghi nhận vào DB
    recordTelegramExportWeb({
      title: chatName
        ? `Tổng hợp ${items.length} bài nhóm ${items[0]?.chat_title}`
        : `Tổng hợp ${items.length} mục tri thức Telegram`,
      file_name: fileName,
      file_path: fileName,
      file_size: docxBuffer.length,
      item_count: items.length,
      filter_category: category || "all",
      filter_days: days || 0,
    });

    return new Response(new Uint8Array(docxBuffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Length": String(docxBuffer.length),
      },
    });
  } catch (err: any) {
    console.error("[api/telegram/export-word] Lỗi:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

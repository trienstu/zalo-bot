import { NextRequest, NextResponse } from "next/server";
import { listKnowledgeItemsWeb, recordTelegramExportWeb } from "@/lib/telegram-db";
import { generateTelegramKnowledgeDocxBuffer } from "@/lib/telegram-word";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
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
    const fileName = `Telegram_Tri_Thuc${catLabel}_${dateStr}_${timestamp}.docx`;

    const docxBuffer = await generateTelegramKnowledgeDocxBuffer(
      items,
      `TỔNG HỢP TRI THỨC TELEGRAM (${items.length} MỤC)`,
    );

    // Ghi nhận vào DB
    recordTelegramExportWeb({
      title: `Tổng hợp ${items.length} mục tri thức Telegram`,
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
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(docxBuffer.length),
      },
    });
  } catch (err: any) {
    console.error("[api/telegram/export-word] Lỗi:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

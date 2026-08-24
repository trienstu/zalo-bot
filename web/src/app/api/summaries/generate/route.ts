import { NextResponse } from "next/server";
import { generateChatSummary } from "@/lib/gemini-summary";
import { isOriginAllowed } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      targetDate?: string;
      sendToGroup?: boolean;
    };

    const result = await generateChatSummary({
      targetDate: body.targetDate,
      sendToGroup: body.sendToGroup === true,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/summaries/generate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lỗi khi tạo tóm tắt tin nhắn" },
      { status: 500 },
    );
  }
}

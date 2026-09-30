import { NextResponse } from "next/server";
import { getTelegramStats } from "@/lib/telegram-db";

export async function GET() {
  try {
    const stats = getTelegramStats();
    return NextResponse.json({ ok: true, stats });
  } catch (err: any) {
    console.error("[api/telegram/stats] Lỗi:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

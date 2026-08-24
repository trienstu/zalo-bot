import { NextResponse } from "next/server";
import { getState, setState } from "@/lib/db";
import { isOriginAllowed } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const enabledRaw = getState("cfg:auto_summary_enabled");
  const timeRaw = getState("cfg:auto_summary_time");

  return NextResponse.json({
    enabled: enabledRaw === null ? true : enabledRaw === "1" || enabledRaw === "true",
    time: timeRaw && /^\d{2}:\d{2}$/.test(timeRaw.trim()) ? timeRaw.trim() : "23:00",
  });
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      enabled?: boolean;
      time?: string;
    };

    if (typeof body.enabled === "boolean") {
      setState("cfg:auto_summary_enabled", body.enabled ? "1" : "0");
    }

    if (typeof body.time === "string" && /^\d{2}:\d{2}$/.test(body.time.trim())) {
      setState("cfg:auto_summary_time", body.time.trim());
    }

    return NextResponse.json({ ok: true, message: "Đã lưu cài đặt hẹn giờ tóm tắt" });
  } catch (e) {
    console.error("[api/summaries/schedule]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lỗi khi lưu cài đặt" },
      { status: 500 },
    );
  }
}

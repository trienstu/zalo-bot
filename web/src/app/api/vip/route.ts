import { NextResponse } from "next/server";
import { readVip, writeVip } from "@/lib/vip";
import { isOriginAllowed } from "@/lib/http";
import { isAuthenticatedAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ entries: readVip() });
}

/** POST { entries: [{id, note?}] } → ghi lại toàn bộ VIP list. */
export async function POST(request: Request) {
  if (!isOriginAllowed(request) || !(await isAuthenticatedAdmin(request))) {
    return NextResponse.json({ error: "Không được phép hoặc thiếu quyền Quản trị viên" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
  }
  const entries = (body as { entries?: unknown })?.entries;
  // writeVip tự validate từng entry (chịu được input bậy như [null]).
  const err = writeVip(entries);
  if (err) {
    return NextResponse.json({ error: err }, { status: 400 });
  }
  return NextResponse.json({ ok: true, entries: readVip() });
}

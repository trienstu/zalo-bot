import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ADMIN_COOKIE_NAME,
  createAdminSessionToken,
  isAuthenticatedAdmin,
  verifyAdminPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { password?: string };
    const password = (body.password || "").trim();

    if (verifyAdminPassword(password)) {
      const proto = request.headers.get("x-forwarded-proto") || "";
      const isHttps = proto === "https" || request.url.startsWith("https:");

      const token = createAdminSessionToken();
      const cookieStore = await cookies();
      cookieStore.set(ADMIN_COOKIE_NAME, token, {
        path: "/",
        httpOnly: true, // Bảo vệ chống XSS/Script trích xuất
        secure: isHttps,
        maxAge: 60 * 60 * 24 * 30, // 30 ngày
        sameSite: "lax",
      });

      return NextResponse.json({ ok: true, message: "Đăng nhập Admin thành công" });
    }

    return NextResponse.json({ ok: false, error: "Mật khẩu Admin không chính xác" }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false, error: "Lỗi xử lý xác thực" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const authenticated = await isAuthenticatedAdmin(request);
  return NextResponse.json({ authenticated });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE_NAME);
  return NextResponse.json({ ok: true, message: "Đã đăng xuất Admin" });
}

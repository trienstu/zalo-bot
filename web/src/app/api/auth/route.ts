import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@!#321";
const COOKIE_NAME = "admin_auth_session";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { password?: string };
    const password = body.password || "";

    if (password === ADMIN_PASSWORD) {
      const cookieStore = await cookies();
      cookieStore.set(COOKIE_NAME, "authenticated_admin", {
        path: "/",
        httpOnly: false, // Cho phép client đọc trạng thái
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 30, // 30 ngày
        sameSite: "lax",
      });

      return NextResponse.json({ ok: true, message: "Đăng nhập Admin thành công" });
    }

    return NextResponse.json({ ok: false, error: "Mật khẩu Admin không chính xác" }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Lỗi xử lý xác thực" }, { status: 500 });
  }
}

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  const isAuthenticated = session?.value === "authenticated_admin";

  return NextResponse.json({ authenticated: isAuthenticated });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  return NextResponse.json({ ok: true, message: "Đã đăng xuất Admin" });
}

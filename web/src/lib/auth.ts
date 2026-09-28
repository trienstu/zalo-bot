import crypto from "node:crypto";
import { cookies } from "next/headers";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@!#321";
const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  crypto.createHash("sha256").update(ADMIN_PASSWORD + "-session-salt-987654321").digest("hex");

export const ADMIN_COOKIE_NAME = "admin_auth_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 ngày

export interface AdminSessionPayload {
  role: "admin";
  iat: number;
  exp: number;
}

/**
 * Tạo token phiên đăng nhập Admin được ký mật mã HMAC-SHA256
 */
export function createAdminSessionToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    role: "admin",
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${signature}`;
}

/**
 * Xác minh tính hợp lệ của token phiên Admin
 */
export function verifyAdminSessionToken(token: string | null | undefined): boolean {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return false;
  }
  const [data, signature] = token.split(".");
  if (!data || !signature) return false;

  try {
    const expectedSignature = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
    const sigBuf = Buffer.from(signature);
    const expSigBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(sigBuf, expSigBuf)) {
      return false;
    }

    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as AdminSessionPayload;
    if (payload.role !== "admin") return false;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Kiểm tra xem request hiện tại có phiên Admin hợp lệ hay không (đọc từ Cookie Next.js)
 */
export async function isAuthenticatedAdmin(request?: Request): Promise<boolean> {
  // 1. Kiểm tra từ Next.js cookies()
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
    if (verifyAdminSessionToken(sessionCookie)) {
      return true;
    }
  } catch {}

  // 2. Kiểm tra từ header Cookie nếu truyền request
  if (request) {
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE_NAME}=([^;]+)`));
    if (match && match[1]) {
      const token = decodeURIComponent(match[1]);
      if (verifyAdminSessionToken(token)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Kiểm tra mật khẩu Admin bảo mật chống Timing Attack
 */
export function verifyAdminPassword(password: string): boolean {
  if (!password || typeof password !== "string") return false;
  const passBuf = Buffer.from(password.trim());
  const expectedBuf = Buffer.from(ADMIN_PASSWORD.trim());
  if (passBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(passBuf, expectedBuf);
}

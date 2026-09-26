import { headers, cookies } from "next/headers";

/**
 * Phân tích hostname/port/env để xác định botId ("bot-1" hoặc "bot-2").
 * Trả về null nếu không thể xác định được từ host/port/env.
 */
function detectBotIdFromHostOrEnv(
  hostHeader?: string | null,
  envPort?: string | null
): "bot-1" | "bot-2" | null {
  const host = (hostHeader || "").toLowerCase();
  if (
    host.includes("b2.") ||
    host.includes("3001") ||
    host.includes("3002") ||
    host.includes("bot2.")
  ) {
    return "bot-2";
  }
  if (
    host.includes("b1.") ||
    host.includes("3000") ||
    host.includes("bot1.")
  ) {
    return "bot-1";
  }

  const port = String(envPort || process.env.PORT || process.env.WEB_PORT || "");
  if (port === "3001" || port === "3002" || process.env.BOT_ID === "bot-2") {
    return "bot-2";
  }
  if (port === "3000" || process.env.BOT_ID === "bot-1") {
    return "bot-1";
  }

  return null;
}

/**
 * Nhận diện Bot ID (bot-1 hoặc bot-2) cho Server Components một cách an toàn và chuẩn xác.
 * Thứ tự ưu tiên nghiêm ngặt:
 * 1. Query parameter chỉ định rõ (?botId=bot-1 hoặc ?botId=bot-2)
 * 2. Hostname thực tế của request (b1.triennguyen.com -> bot-1, b2.triennguyen.com -> bot-2)
 * 3. Cổng port hoặc biến môi trường của tiến trình Next.js (PORT=3000 -> bot-1, PORT=3001 -> bot-2)
 * 4. Fallback cookie active_bot_id (CHỈ khi host/port hoàn toàn không xác định được)
 */
export async function resolveRequestBotId(explicitBotId?: string | null): Promise<string> {
  const cleanExplicit = (explicitBotId || "").trim().toLowerCase();
  if (cleanExplicit === "bot-1" || cleanExplicit === "bot-2") {
    return cleanExplicit;
  }

  // 1. Kiểm tra Hostname của request
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host") || "";
    const detected = detectBotIdFromHostOrEnv(host);
    if (detected) return detected;
  } catch {}

  // 2. Kiểm tra Env Port
  const detectedEnv = detectBotIdFromHostOrEnv();
  if (detectedEnv) return detectedEnv;

  // 3. Fallback cookie active_bot_id nếu không phân định được từ Host/Port
  try {
    const c = await cookies();
    const cookieVal = c.get("active_bot_id")?.value;
    if (cookieVal === "bot-1" || cookieVal === "bot-2") {
      return cookieVal;
    }
  } catch {}

  return "bot-1";
}

/**
 * Nhận diện Bot ID đồng bộ (Synchronous) khi đã có hostHeader hoặc env
 */
export function resolveRequestBotIdSync(
  explicitBotId?: string | null,
  hostHeader?: string | null,
  cookieVal?: string | null
): string {
  const cleanExplicit = (explicitBotId || "").trim().toLowerCase();
  if (cleanExplicit === "bot-1" || cleanExplicit === "bot-2") {
    return cleanExplicit;
  }

  const detected = detectBotIdFromHostOrEnv(hostHeader);
  if (detected) return detected;

  if (cookieVal === "bot-1" || cookieVal === "bot-2") {
    return cookieVal;
  }

  return "bot-1";
}

/**
 * Nhận diện Bot ID từ Request (sử dụng trong các Next.js Route Handlers: GET, POST, PATCH, ...)
 */
export function resolveBotIdFromRequest(
  request: Request,
  explicitBotId?: string | null
): string {
  let targetExplicit = (explicitBotId || "").trim().toLowerCase();

  // 1. Nếu không có explicit từ body, kiểm tra searchParams (?botId=)
  if (!targetExplicit) {
    try {
      const url = new URL(request.url);
      targetExplicit = (url.searchParams.get("botId") || "").trim().toLowerCase();
    } catch {}
  }

  if (targetExplicit === "bot-1" || targetExplicit === "bot-2") {
    return targetExplicit;
  }

  // 2. Kiểm tra Hostname / Port từ request headers
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "";
  const detected = detectBotIdFromHostOrEnv(host);
  if (detected) return detected;

  // 3. Cookie fallback
  let cookieVal: string | null = null;
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)active_bot_id=([^;]+)/);
  if (match) {
    cookieVal = decodeURIComponent(match[1]);
  }

  if (cookieVal === "bot-1" || cookieVal === "bot-2") {
    return cookieVal;
  }

  return "bot-1";
}

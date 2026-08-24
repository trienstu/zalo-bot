/**
 * Check origin cho API route ghi (POST) — chặn CSRF cơ bản từ trình duyệt khác domain.
 *
 * KHÔNG dùng request.url làm chuẩn: sau reverse proxy (nginx/Cloudflare...), Host mà
 * Next.js thấy có thể không khớp domain public thật browser gửi trong Origin (tuỳ cấu
 * hình proxy thực tế trên VPS, khó đảm bảo đúng 100% dù template có set Host đúng).
 * Thay vào đó whitelist qua env PUBLIC_ORIGIN (phân tách bởi dấu phẩy nếu nhiều domain,
 * vd "https://bot.example.com,https://bot2.example.com").
 *
 * Nếu PUBLIC_ORIGIN chưa cấu hình: fallback so sánh với request.url như cũ (không chặn
 * cứng toàn bộ dashboard chỉ vì quên set env sau deploy).
 */
function allowedOrigins(): string[] | null {
  const raw = process.env.PUBLIC_ORIGIN?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** true nếu origin header hợp lệ (hoặc không có origin — request không phải từ browser fetch/form). */
export function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const allowed = allowedOrigins();
  if (allowed) {
    return allowed.includes(origin);
  }

  try {
    const originUrl = new URL(origin);
    const reqUrl = new URL(request.url);
    const hostHeader = request.headers.get("host")?.split(":")[0]?.toLowerCase();
    const originHostname = originUrl.hostname.toLowerCase();
    const reqHostname = reqUrl.hostname.toLowerCase();

    // Khớp hostname (bỏ qua port mismatch do iptables/proxy) hoặc khớp Host header
    if (originHostname === reqHostname || (hostHeader && originHostname === hostHeader)) {
      return true;
    }

    // Chấp nhận local loopback
    if (
      (originHostname === "localhost" || originHostname === "127.0.0.1") &&
      (reqHostname === "localhost" || reqHostname === "127.0.0.1")
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

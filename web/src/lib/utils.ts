import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format epoch ms → chuỗi ngày giờ VN dễ đọc. */
export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

/** Format "x ngày trước" gọn. */
export function fmtAgo(ts: number | null | undefined): string {
  if (!ts) return "chưa có";
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "hôm nay";
  if (days === 1) return "hôm qua";
  return `${days} ngày trước`;
}

/**
 * Sao chép văn bản vào clipboard tương thích đa nền tảng (cả HTTPS, Localhost và HTTP không có SSL trên VPS IP)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Trình duyệt hỗ trợ navigator.clipboard trong Secure Context (HTTPS hoặc Localhost)
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  // 2. Dự phòng dùng textarea ảo và execCommand cho HTTP (VPS IP không có SSL như http://140.245.107.184:3000)
  try {
    if (typeof document !== "undefined") {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, 99999);
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (successful) return true;
    }
  } catch (err) {
    console.error("Lỗi execCommand copy:", err);
  }

  // 3. Dự phòng hộp thoại prompt nếu trình duyệt chặn hoàn toàn quyền can thiệp clipboard
  try {
    if (typeof window !== "undefined") {
      window.prompt("Sao chép đường link bên dưới (Ctrl+C hoặc Cmd+C):", text);
      return true;
    }
  } catch {}

  return false;
}

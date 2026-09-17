import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getGroupHubToken, verifyGroupHubToken } from "@/lib/hub-token";

export const dynamic = "force-dynamic";

function getBotDbPath(): string {
  const possiblePaths = [
    process.env.SQLITE_DB_PATH,
    path.resolve(process.cwd(), "data", "bot.db"),
    path.resolve(process.cwd(), "..", "bot", "data", "bot.db"),
    path.resolve(process.cwd(), "bot", "data", "bot.db"),
    path.resolve(process.cwd(), "..", "data", "bot.db"),
  ].filter(Boolean) as string[];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(process.cwd(), "..", "bot", "data", "bot.db");
}

export interface KnowledgeItem {
  id: string;
  title: string;
  category: "ai" | "mmo" | "learning" | "links" | "announcement" | "general";
  categoryLabel: string;
  summary: string;
  keyPoints: string[];
  links: { url: string; label?: string; isFile?: boolean }[];
  author: string;
  date: string;
  timestamp: number;
  source: "summary" | "message";
  groupId?: string;
  groupName?: string;
}

// Domain báo chí / tin tức cần loại bỏ hoàn toàn
const NEWS_DOMAINS = [
  "vnexpress.net",
  "dantri.com.vn",
  "tuoitre.vn",
  "thanhnien.vn",
  "kenh14.vn",
  "24h.com.vn",
  "docbao.vn",
  "zingnews.vn",
  "znews.vn",
  "cafef.vn",
  "cafebiz.vn",
  "soha.vn",
  "eva.vn",
  "vietnamnet.vn",
  "genk.vn",
  "thethao247.vn",
  "tienphong.vn",
  "vtv.vn",
  "plo.vn",
  "baomoi.com",
];

// Domain File / Drive / Kho lưu trữ
const FILE_DOMAINS = [
  "drive.google.com",
  "docs.google.com",
  "dropbox.com",
  "mega.nz",
  "mediafire.com",
  "1drv.ms",
  "onedrive.live.com",
  "github.com",
  "gitlab.com",
  "notion.so",
  "notion.site",
  "figma.com",
  "canva.com",
];

function isNewsUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return NEWS_DOMAINS.some((d) => lower.includes(d));
}

function isFileOrDriveUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    FILE_DOMAINS.some((d) => lower.includes(d)) ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".zip") ||
    lower.endsWith(".rar") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".pptx") ||
    lower.endsWith(".apk") ||
    lower.endsWith(".psd") ||
    lower.endsWith(".json") ||
    lower.includes("/file/d/") ||
    lower.includes("/document/d/") ||
    lower.includes("/spreadsheets/d/") ||
    lower.includes("/drive/folders/")
  );
}

// Bỏ qua tất cả các đoạn chat rác, bot joke, lệnh rank
function isSpamOrBotMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.startsWith("/rank") ||
    lower.startsWith("/top") ||
    lower.startsWith("/diem") ||
    lower.startsWith("/help") ||
    lower.startsWith("/hoi") ||
    lower.startsWith("/taungam") ||
    lower.includes("thông tin tương tác") ||
    lower.includes("thứ hạng:") ||
    lower.includes("tổng điểm:") ||
    lower.includes("lượt thả reaction") ||
    lower.includes("lượt bình chọn") ||
    lower.includes("lần tương tác cuối") ||
    lower.includes("sen chúa trả lời") ||
    lower.includes("e guộc") ||
    lower.includes("cà khịa") ||
    lower.includes("ngoan như cún") ||
    lower.includes("bị thu hồi")
  );
}

/**
 * Kiểm tra xem một chuỗi có phải là ID ngẫu nhiên, mã hash, Base64 vô nghĩa hay không
 * Ví dụ: 1LRairoS14LXAIkhQUm5nZS6o7GM-4GDb, 8FQ23qrg9Blh2EJGsO6LHVT63gCHK5udl, 1202585366262580
 */
function isRandomIdOrHash(str: string): boolean {
  if (!str) return true;
  const s = str.trim();
  if (s.length < 3) return true;
  // Toàn chữ số (ví dụ ID Zalo, ID FB Reel, ID bài viết)
  if (/^\d+$/.test(s) || /^[\d_-]+$/.test(s)) return true;
  // UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  // Chuỗi ID Base64/Alphanumeric dài không có dấu cách: ví dụ 1LRairoS14LXAIkhQUm5nZS6o7GM-4GDb
  if (s.length >= 14 && !s.includes(" ") && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s)) {
    return true;
  }
  // Chuỗi hex dài > 14 ký tự
  if (s.length >= 14 && !s.includes(" ") && /^[0-9a-f_-]+$/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * Trích xuất tiêu đề có nghĩa từ URL, loại bỏ triệt để chuỗi ID ngẫu nhiên
 */
function extractTitleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = decodeURIComponent(u.pathname);

    // 1. Nhận diện các dịch vụ cụ thể
    if (host.includes("drive.google.com")) {
      if (pathname.includes("/folders")) {
        return "Thư mục tài liệu Google Drive";
      }
      if (pathname.includes("/file/d/")) {
        return "Tài liệu chia sẻ Google Drive";
      }
      return "Tài liệu Google Drive";
    }

    if (host.includes("docs.google.com")) {
      if (pathname.includes("/spreadsheets")) return "Bảng tính Google Sheets";
      if (pathname.includes("/document")) return "Tài liệu văn bản Google Docs";
      if (pathname.includes("/forms")) return "Biểu mẫu Google Forms";
      if (pathname.includes("/presentation")) return "Bản thuyết trình Google Slides";
      return "Tài liệu Google Docs";
    }

    if (host.includes("canva.com")) {
      return "Template thiết kế Canva";
    }

    if (host.includes("notion.")) {
      return "Trang tài liệu Notion";
    }

    if (host.includes("figma.com")) {
      return "Bản thiết kế Figma";
    }

    if (host.includes("github.com")) {
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length >= 2) {
        return `GitHub: ${segments[0]}/${segments[1].replace(/\.git$/, "")}`;
      }
      return "Mã nguồn mở GitHub";
    }

    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      return "Video hướng dẫn YouTube";
    }

    if (host.includes("facebook.com") && (pathname.includes("/reel") || pathname.includes("/watch") || pathname.includes("/videos"))) {
      return "Video chia sẻ trên Facebook";
    }

    if (host.includes("tiktok.com")) {
      return "Video chia sẻ trên TikTok";
    }

    // 2. Nếu có tên file thực sự ở cuối pathname
    const segments = pathname.split("/").filter(Boolean);
    const lastSeg = segments[segments.length - 1] || "";
    if (lastSeg.length >= 4) {
      // Bỏ phần extension
      const extMatch = lastSeg.match(/\.([a-z0-9]{2,5})$/i);
      const cleanSlug = lastSeg
        .replace(/\.[a-z0-9]{2,5}$/i, "")
        .replace(/^(p|d|file|document)\//i, "")
        .replace(/[_-]+/g, " ")
        .trim();

      // Chỉ lấy nếu không phải ID ngẫu nhiên và có độ dài hợp lý
      if (cleanSlug.length >= 4 && cleanSlug.length <= 65 && !isRandomIdOrHash(cleanSlug)) {
        return cleanSlug.charAt(0).toUpperCase() + cleanSlug.slice(1);
      }
    }

    // Gợi ý từ tên miền
    const domainName = host.split(".")[0];
    if (domainName && domainName.length >= 3 && domainName !== "com" && domainName !== "vn") {
      return `Tài nguyên từ ${domainName.charAt(0).toUpperCase() + domainName.slice(1)}`;
    }
  } catch {}
  return null;
}

/**
 * Làm sạch tiêu đề theo thứ tự ưu tiên:
 * Ưu tiên 1: Mô tả của thành viên viết trong tin nhắn (làm sạch tiền tố, chặn ID rác)
 * Ưu tiên 2: Tiêu đề chuẩn hóa từ URL (không để lộ chuỗi ID vô nghĩa)
 * Ưu tiên 3: Fallback an toàn
 */
function cleanTitle(rawCandidate: string, fallback: string, url?: string): string {
  // 🥇 ƯU TIÊN 1: Mô tả của thành viên
  if (rawCandidate) {
    let t = rawCandidate
      .replace(/^[-—•*0-9.)\s]+/, "")
      .replace(/^(bước|buoc)\s*\d+[\s.:-]*\s*/i, "")
      .replace(/\s*\([^)]*\)$/, "")
      .replace(/^(hướng dẫn|chia sẻ|kinh nghiệm|tút|tut|bí quyết|tool|cách|link)\s*:\s*/i, "")
      .trim();

    // Chỉ nhận khi có độ dài >= 4 và không phải ID/hash ngẫu nhiên
    if (t.length >= 4 && !isRandomIdOrHash(t)) {
      if (t.length > 75) {
        t = t.slice(0, 73) + "...";
      }
      return t;
    }
  }

  // 🥈 ƯU TIÊN 2: Tiêu đề chuẩn hóa từ URL
  if (url) {
    const fromUrl = extractTitleFromUrl(url);
    if (fromUrl) return fromUrl;
  }

  // 🥉 ƯU TIÊN 3: Fallback an toàn
  return fallback;
}

function detectCategoryFromContext(text: string, isFile: boolean): { category: KnowledgeItem["category"]; label: string } {
  const lower = text.toLowerCase();
  if (
    lower.includes("ai") ||
    lower.includes("gpt") ||
    lower.includes("prompt") ||
    lower.includes("video") ||
    lower.includes("voice") ||
    lower.includes("flux") ||
    lower.includes("midjourney") ||
    lower.includes("comfyui") ||
    lower.includes("colab") ||
    lower.includes("codex") ||
    lower.includes("vox") ||
    lower.includes("veo") ||
    lower.includes("sora") ||
    lower.includes("capcut")
  ) {
    return { category: "ai", label: isFile ? "📂 File AI & Video" : "🤖 AI & Video" };
  }
  if (
    lower.includes("mmo") ||
    lower.includes("ga") ||
    lower.includes("adsense") ||
    lower.includes("tiktok") ||
    lower.includes("kênh") ||
    lower.includes("view") ||
    lower.includes("traffic") ||
    lower.includes("bkt") ||
    lower.includes("kiếm tiền") ||
    lower.includes("affiliate")
  ) {
    return { category: "mmo", label: isFile ? "📂 File MMO & Tut" : "💼 MMO & Tut Mẹo" };
  }
  if (isFile) {
    return { category: "links", label: "📂 File & Tài liệu" };
  }
  return { category: "links", label: "🔗 Link & Công cụ" };
}

// Bộ nhớ đệm thông tin GitHub (Lưu 24 giờ)
const GITHUB_CACHE = new Map<string, { summary: string; expires: number }>();

async function getGitHubSummary(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("github.com")) return "";
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return "";
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    const key = `${owner}/${repo}`.toLowerCase();

    const cached = GITHUB_CACHE.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.summary;
    }

    let summary = "";
    // 1. Fetch README.md raw (siêu nhanh, không cần auth, không bị rate limit)
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`, {
        headers: { "User-Agent": "ZaloBot-Hub" },
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const text = await res.text();
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#") && !l.startsWith("!") && !l.startsWith("[!") && !l.startsWith("<") && l.length > 20);
        if (lines.length > 0) {
          summary = lines[0].slice(0, 160);
        }
      }
    } catch {}

    // 2. Fetch repo API nếu chưa lấy được từ README
    if (!summary) {
      try {
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: { "User-Agent": "ZaloBot-Hub" },
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.description) {
            summary = data.description.slice(0, 160);
          }
        }
      } catch {}
    }

    const finalSummary = summary || `Mã nguồn dự án ${owner}/${repo} trên GitHub.`;
    GITHUB_CACHE.set(key, { summary: finalSummary, expires: Date.now() + 24 * 3600 * 1000 });
    return finalSummary;
  } catch {
    return "";
  }
}

// ⚡ IN-MEMORY CACHE TỔNG CHO SERVER (Lưu 60 giây, giúp tìm kiếm và phân trang dưới 10ms)
interface HubCacheStore {
  items: KnowledgeItem[];
  uniqueLinks: Set<string>;
  uniqueFiles: Set<string>;
  contributors: Set<string>;
  allGroups: { id: string; name: string; totalMembers: number; token: string }[];
  groupNameMap: Map<string, string>;
  timestamp: number;
}

let HUB_MEMORY_CACHE: HubCacheStore | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 giây

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") || "").toLowerCase().trim();
    const category = searchParams.get("category") || "all";
    const requestedGroupId = searchParams.get("groupId") || "";
    const token = searchParams.get("token") || "";
    const sort = searchParams.get("sort") || "newest";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.max(1, Math.min(60, parseInt(searchParams.get("limit") || "18", 10)));

    const dbPath = getBotDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({
        items: [],
        pagination: { page: 1, limit, totalItems: 0, totalPages: 0 },
        stats: { totalItems: 0, totalLinks: 0, totalFiles: 0, totalContributors: 0 },
        groups: [],
        isLockedGroup: false,
      });
    }

    // Kiểm tra bảo mật:
    // - Nếu có token: Cho phép thành viên vào nhóm riêng
    // - Nếu không có token: Bắt buộc phải là Admin (đã đăng nhập)
    const cookieHeader = request.headers.get("cookie") || "";
    const isAdminAuthenticated = cookieHeader.includes("admin_auth_session=authenticated_admin");

    if (!token && !isAdminAuthenticated) {
      return NextResponse.json(
        {
          error: "unauthorized",
          message: "Kho tài nguyên tổng hợp chỉ dành cho Quản trị viên. Thành viên vui lòng dùng link chia sẻ riêng của nhóm.",
          items: [],
          pagination: { page: 1, limit, totalItems: 0, totalPages: 0 },
          isLockedGroup: true,
          needAdminAuth: true,
        },
        { status: 401 }
      );
    }

    // 1. Kiểm tra In-Memory Cache (Nếu cache còn hiệu lực thì lấy ngay lập tức trong 1ms)
    const now = Date.now();
    let cacheStore = HUB_MEMORY_CACHE;

    if (!cacheStore || now - cacheStore.timestamp > CACHE_TTL_MS) {
      const db = new Database(dbPath, { readonly: true });

      const groupNameMap = new Map<string, string>();
      const allGroups: { id: string; name: string; totalMembers: number; token: string }[] = [];
      try {
        const rows = db.prepare("SELECT group_id, name, total_members FROM bot_groups ORDER BY total_members DESC").all() as any[];
        for (const r of rows) {
          const gid = String(r.group_id);
          const gname = r.name || `Nhóm ${gid}`;
          groupNameMap.set(gid, gname);
          allGroups.push({
            id: gid,
            name: gname,
            totalMembers: r.total_members || 0,
            token: getGroupHubToken(gid),
          });
        }
      } catch {}

      const items: KnowledgeItem[] = [];
      const uniqueLinks = new Set<string>();
      const uniqueFiles = new Set<string>();
      const contributors = new Set<string>();

      // 2. Trích xuất từ bảng daily_summaries
      const summaries = db.prepare("SELECT * FROM daily_summaries ORDER BY day_date DESC").all() as any[];

      for (const s of summaries) {
        const summaryText = s.summary_text || "";
        const dayLabel = s.day_label || s.day_date || "";
        const ts = s.day_start_ts || s.created_at || Date.now();
        const gId = s.thread_id || "";
        const gName = groupNameMap.get(gId) || (gId ? `Nhóm ${gId}` : "Cộng đồng Zalo");

        let author = "Cộng đồng AI & MMO";
        try {
          const topSenders = JSON.parse(s.top_senders_json || "[]");
          if (Array.isArray(topSenders) && topSenders.length > 0) {
            author = topSenders[0].replace(/\s*\(\d+\)$/, "");
            contributors.add(author);
          }
        } catch {}

        const sections = summaryText.split(/(?=\([1-7]\)|\b(?:📢|💼|🤖|🎓|🔗|❓|☕)\b)/);

        for (let secIdx = 0; secIdx < sections.length; secIdx++) {
          const rawSec = sections[secIdx].trim();
          if (!rawSec) continue;

          let cat: KnowledgeItem["category"] = "general";
          let catLabel = "Kiến thức chung";
          let defaultTitle = "";

          if (rawSec.includes("AI & CÔNG NGHỆ") || rawSec.includes("🤖")) {
            cat = "ai";
            catLabel = "AI & Video";
            defaultTitle = "Kỹ thuật & Công cụ AI";
          } else if (rawSec.includes("CHỦ ĐỀ CHUYÊN MÔN") || rawSec.includes("💼")) {
            cat = "mmo";
            catLabel = "MMO & Tut";
            defaultTitle = "Kinh nghiệm & Tut kiếm tiền";
          } else if (rawSec.includes("HỌC HÀNH & KINH NGHIỆM") || rawSec.includes("🎓")) {
            cat = "learning";
            catLabel = "Học tập & Chia sẻ";
            defaultTitle = "Bài học & Quy trình thực tế";
          } else if (rawSec.includes("LINK ĐÃ CHIA SẺ") || rawSec.includes("🔗")) {
            cat = "links";
            catLabel = "Tài nguyên & File";
            defaultTitle = "Tổng hợp Tài nguyên & Link";
          } else {
            continue;
          }

          const lines = rawSec
            .split("\n")
            .map((l: string) => l.trim())
            .filter((l: string) => l.startsWith("-") || l.startsWith("•") || l.startsWith("*"));

          const keyPoints: string[] = [];
          const urlRegex = /(https?:\/\/[^\s]+)/gi;
          const secLinks: { url: string; label?: string; isFile?: boolean }[] = [];

          for (const line of lines) {
            const cleanLine = line.replace(/^[-•*]\s*/, "");
            if (!cleanLine || isSpamOrBotMessage(cleanLine)) continue;

            const matches = cleanLine.match(urlRegex);
            let hasIgnoredNews = false;

            if (matches) {
              for (const u of matches) {
                const cleanUrl = u.replace(/[.,;!?)]+$/, "");
                if (isNewsUrl(cleanUrl)) {
                  hasIgnoredNews = true;
                  continue;
                }
                const isFile = isFileOrDriveUrl(cleanUrl);
                if (isFile) uniqueFiles.add(cleanUrl);
                uniqueLinks.add(cleanUrl);
                secLinks.push({ url: cleanUrl, isFile });
              }
            }

            if (hasIgnoredNews && !cleanLine.replace(urlRegex, "").trim()) {
              continue;
            }

            keyPoints.push(cleanLine);
          }

          if (keyPoints.length === 0) continue;

          const firstPoint = keyPoints[0];
          const displayTitle = cleanTitle(firstPoint.split(":")[0] || firstPoint, defaultTitle, secLinks[0]?.url);

          items.push({
            id: `sum_${s.id || s.day_date}_${secIdx}`,
            title: displayTitle,
            category: cat,
            categoryLabel: catLabel,
            summary: keyPoints.slice(0, 2).join(". ") + (keyPoints.length > 2 ? "..." : ""),
            keyPoints,
            links: secLinks,
            author,
            date: dayLabel,
            timestamp: ts,
            source: "summary",
            groupId: gId,
            groupName: gName,
          });
        }
      }

      // 3. Trích xuất các tin nhắn chứa file / link từ group_messages với thuật toán đa link
      const linkMessages = db
        .prepare(
          `SELECT message_id, display_name, text, ts, thread_id
           FROM group_messages
           WHERE (text LIKE '%http://%' OR text LIKE '%https://%' OR text LIKE '%.pdf%' OR text LIKE '%.zip%' OR text LIKE '%.rar%' OR text LIKE '%.docx%' OR text LIKE '%.apk%')
             AND deleted_at IS NULL
             AND is_self = 0
             AND LOWER(display_name) NOT LIKE '%sen chúa%'
           ORDER BY ts DESC
           LIMIT 1000`
        )
        .all() as any[];

      const urlRegex = /(https?:\/\/[^\s]+)/gi;

      for (const msg of linkMessages) {
        if (!msg.text || isSpamOrBotMessage(msg.text)) continue;

        const matches = msg.text.match(urlRegex);
        if (!matches || matches.length === 0) continue;

        // Lọc các URL hợp lệ (loại bỏ báo chí / tin tức)
        const cleanUrls: { url: string; isFile: boolean }[] = [];
        for (const u of matches) {
          const clean = u.replace(/[.,;!?)]+$/, "");
          if (isNewsUrl(clean)) continue;
          const isFile = isFileOrDriveUrl(clean);
          if (isFile) uniqueFiles.add(clean);
          uniqueLinks.add(clean);
          cleanUrls.push({ url: clean, isFile });
        }

        if (cleanUrls.length === 0) continue;

        const authorName = msg.display_name || "Thành viên";
        contributors.add(authorName);

        const d = new Date(msg.ts + 7 * 3600 * 1000);
        const dateStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
        const msgGroupId = msg.thread_id || "";
        const msgGroupName = groupNameMap.get(msgGroupId) || (msgGroupId ? `Nhóm ${msgGroupId}` : "Nhóm Zalo");

        // Tách các dòng trong tin nhắn để phân tích ngữ cảnh từng link
        const textLines = msg.text
          .split("\n")
          .map((l: string) => l.trim())
          .filter((l: string) => l.length > 0 && !isSpamOrBotMessage(l));

        for (let linkIdx = 0; linkIdx < cleanUrls.length; linkIdx++) {
          const currentLink = cleanUrls[linkIdx];

          // Tránh trùng lặp link đã có trong danh sách
          if (items.some((it) => it.links.some((l) => l.url === currentLink.url))) {
            continue;
          }

          const lineIdxWithUrl = textLines.findIndex((line: string) => line.includes(currentLink.url));

          let titleCandidate = "";
          let specificDescriptionLines: string[] = [];

          if (lineIdxWithUrl !== -1) {
            const currentLine = textLines[lineIdxWithUrl];
            const inlineText = currentLine
              .replace(urlRegex, "")
              .replace(/^[-—•*0-9.)\s]+/, "")
              .trim();

            if (inlineText.length >= 4 && !isRandomIdOrHash(inlineText)) {
              titleCandidate = inlineText;
            } else if (lineIdxWithUrl > 0) {
              const prevLine = textLines[lineIdxWithUrl - 1];
              if (!urlRegex.test(prevLine)) {
                const prevText = prevLine.replace(/^[-—•*0-9.)\s]+/, "").trim();
                if (prevText.length >= 4 && !isRandomIdOrHash(prevText)) {
                  titleCandidate = prevText;
                }
              }
            }

            // Thu thập các dòng mô tả tiếp theo
            const nextUrl = cleanUrls[linkIdx + 1]?.url;
            for (let k = lineIdxWithUrl + 1; k < textLines.length; k++) {
              const nextL = textLines[k];
              if (nextUrl && nextL.includes(nextUrl)) break;
              if (!urlRegex.test(nextL) && nextL.length >= 3 && !isRandomIdOrHash(nextL)) {
                specificDescriptionLines.push(nextL);
              }
            }
          }

          const fallbackTitle = currentLink.isFile
            ? `Tài liệu chia sẻ từ ${authorName}`
            : `Tài nguyên từ ${authorName}`;

          const displayTitle = cleanTitle(titleCandidate, fallbackTitle, currentLink.url);

          // Phát hiện danh mục dựa trên ngữ cảnh
          const contextText = `${displayTitle} ${specificDescriptionLines.join(" ")} ${textLines.join(" ")}`;
          const { category: detectedCat, label: detectedLabel } = detectCategoryFromContext(contextText, currentLink.isFile);

          // Xây dựng Key Points (ĐÃ BỎ HOÀN TOÀN dòng "Chia sẻ bởi Trungkd (GROUP...)")
          const keyPoints: string[] = [];
          if (specificDescriptionLines.length > 0) {
            for (const dLine of specificDescriptionLines) {
              keyPoints.push(dLine);
            }
          } else if (titleCandidate && titleCandidate !== displayTitle) {
            keyPoints.push(titleCandidate);
          } else {
            // Mô tả chuẩn theo từng loại dịch vụ
            if (currentLink.url.includes("drive.google.com")) {
              keyPoints.push("Thư mục tài liệu / file chia sẻ trên Google Drive.");
            } else if (currentLink.url.includes("canva.com")) {
              keyPoints.push("Mẫu thiết kế template trực tuyến trên Canva.");
            } else if (currentLink.url.includes("github.com")) {
              keyPoints.push("Mã nguồn dự án trên GitHub.");
            } else {
              keyPoints.push(displayTitle);
            }
          }

          const titlePrefix = currentLink.isFile ? "📂 " : "";

          items.push({
            id: `msg_${msg.message_id || msg.ts}_${linkIdx}`,
            title: titlePrefix + displayTitle,
            category: detectedCat,
            categoryLabel: detectedLabel,
            summary: keyPoints.slice(0, 2).join(". ") || "Tài nguyên & liên kết chia sẻ từ cộng đồng.",
            keyPoints,
            links: [currentLink],
            author: authorName,
            date: dateStr,
            timestamp: msg.ts,
            source: "message",
            groupId: msgGroupId,
            groupName: msgGroupName,
          });
        }
      }

      db.close();

      cacheStore = {
        items,
        uniqueLinks,
        uniqueFiles,
        contributors,
        allGroups,
        groupNameMap,
        timestamp: now,
      };
      HUB_MEMORY_CACHE = cacheStore;
    }

    // 4. Lọc bảo mật theo Token hoặc Admin
    let isLockedGroup = false;
    let targetGroupId = requestedGroupId;
    let currentGroup: { id: string; name: string; token: string } | null = null;

    if (token) {
      if (!requestedGroupId || !verifyGroupHubToken(requestedGroupId, token)) {
        return NextResponse.json(
          {
            error: "Đường link không hợp lệ hoặc bạn không có quyền truy cập nhóm này.",
            items: [],
            pagination: { page: 1, limit, totalItems: 0, totalPages: 0 },
            isLockedGroup: true,
          },
          { status: 403 }
        );
      }
      isLockedGroup = true;
      targetGroupId = requestedGroupId;
      const found = cacheStore.allGroups.find((g) => g.id === targetGroupId);
      currentGroup = found || {
        id: targetGroupId,
        name: cacheStore.groupNameMap.get(targetGroupId) || `Nhóm ${targetGroupId}`,
        token,
      };
    } else if (targetGroupId && targetGroupId !== "all") {
      const found = cacheStore.allGroups.find((g) => g.id === targetGroupId);
      if (found) {
        currentGroup = found;
      } else {
        currentGroup = {
          id: targetGroupId,
          name: cacheStore.groupNameMap.get(targetGroupId) || `Nhóm ${targetGroupId}`,
          token: getGroupHubToken(targetGroupId),
        };
      }
    }

    // 5. Áp dụng các bộ lọc: Category, Group, Search Query từ Cache trong RAM (Tốc độ < 5ms)
    let filtered = cacheStore.items;

    // Lọc theo Category
    if (category !== "all") {
      if (category === "files") {
        filtered = filtered.filter((it) => it.links.some((l) => l.isFile) || it.categoryLabel.includes("File"));
      } else {
        filtered = filtered.filter((it) => it.category === category);
      }
    }

    // Lọc theo Nhóm
    if (targetGroupId && targetGroupId !== "all") {
      filtered = filtered.filter(
        (it) => !it.groupId || it.groupId === targetGroupId || (targetGroupId === "1913869945242410752" && !it.groupId)
      );
    }

    // Lọc theo Từ khóa Search (bắt tên người gửi, link url, tiêu đề, tóm tắt và keypoints)
    if (query) {
      filtered = filtered.filter(
        (it) =>
          it.author.toLowerCase().includes(query) ||
          it.links.some((l) => l.url.toLowerCase().includes(query)) ||
          it.title.toLowerCase().includes(query) ||
          it.summary.toLowerCase().includes(query) ||
          it.keyPoints.some((kp) => kp.toLowerCase().includes(query)) ||
          (it.groupName && it.groupName.toLowerCase().includes(query))
      );
    }

    // 6. Sắp xếp (Sort)
    if (sort === "oldest") {
      filtered.sort((a, b) => a.timestamp - b.timestamp);
    } else if (sort === "author_asc") {
      filtered.sort((a, b) => a.author.localeCompare(b.author, "vi"));
    } else if (sort === "author_desc") {
      filtered.sort((a, b) => b.author.localeCompare(a.author, "vi"));
    } else if (sort === "title_asc") {
      filtered.sort((a, b) => a.title.localeCompare(b.title, "vi"));
    } else {
      // Mặc định: newest (mới nhất)
      filtered.sort((a, b) => b.timestamp - a.timestamp);
    }

    // 7. Phân trang dữ liệu (Pagination)
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const clampedPage = Math.min(page, totalPages);
    const startIndex = (clampedPage - 1) * limit;
    const pagedItems = filtered.slice(startIndex, startIndex + limit);

    // Tự động bổ sung GitHub README summary cho các link GitHub trên trang hiện tại
    for (const item of pagedItems) {
      const ghLink = item.links.find((l) => l.url.includes("github.com"));
      if (ghLink && item.keyPoints.length <= 1) {
        const ghDesc = await getGitHubSummary(ghLink.url);
        if (ghDesc) {
          item.summary = ghDesc;
          item.keyPoints = [ghDesc];
        }
      }
    }

    const returnedGroups = isLockedGroup
      ? currentGroup
        ? [currentGroup]
        : []
      : cacheStore.allGroups;

    return NextResponse.json({
      items: pagedItems,
      pagination: {
        page: clampedPage,
        limit,
        totalItems,
        totalPages,
      },
      stats: {
        totalItems: cacheStore.items.length,
        totalLinks: cacheStore.uniqueLinks.size,
        totalFiles: cacheStore.uniqueFiles.size,
        totalContributors: cacheStore.contributors.size,
      },
      groups: returnedGroups,
      isLockedGroup,
      currentGroup,
    });
  } catch (error) {
    console.error("[api/hub]", error);
    return NextResponse.json(
      {
        error: "Lỗi tải kho kiến thức",
        items: [],
        pagination: { page: 1, limit: 18, totalItems: 0, totalPages: 0 },
      },
      { status: 500 }
    );
  }
}

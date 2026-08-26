import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

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

function extractTitleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const pathname = decodeURIComponent(u.pathname);
    const segments = pathname.split("/").filter(Boolean);
    const lastSeg = segments[segments.length - 1] || "";

    if (lastSeg.length >= 4) {
      const cleanSlug = lastSeg
        .replace(/-[a-f0-9]{20,}/i, "")
        .replace(/^(p|d|file|document)\//i, "")
        .replace(/[_-]+/g, " ")
        .trim();

      if (cleanSlug.length >= 5 && !/^[0-9a-f]+$/i.test(cleanSlug)) {
        return cleanSlug.charAt(0).toUpperCase() + cleanSlug.slice(1);
      }
    }
  } catch {}
  return null;
}

function cleanTitle(raw: string, fallback: string, url?: string): string {
  if (url) {
    const fromUrl = extractTitleFromUrl(url);
    if (fromUrl && fromUrl.length >= 6) return fromUrl;
  }

  let t = raw
    .replace(/^[-—•*0-9.)\s]+/, "")
    .replace(/^(bước|buoc)\s*\d+[\s.:-]*\s*/i, "")
    .replace(/\s*\([^)]*\)$/, "")
    .replace(/^(hướng dẫn|chia sẻ|kinh nghiệm|tút|tut|bí quyết|tool|cách)\s*:\s*/i, "")
    .trim();

  if (t.length > 70) {
    t = t.slice(0, 68) + "...";
  }
  return t || fallback;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") || "").toLowerCase().trim();
    const category = searchParams.get("category") || "all";
    const groupId = searchParams.get("groupId") || "";

    const dbPath = getBotDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ items: [], stats: { totalItems: 0, totalLinks: 0, totalFiles: 0, totalContributors: 0 } });
    }

    const db = new Database(dbPath, { readonly: true });
    const items: KnowledgeItem[] = [];
    const uniqueLinks = new Set<string>();
    const uniqueFiles = new Set<string>();
    const contributors = new Set<string>();

    // 1. Trích xuất từ bảng daily_summaries
    const summaryQuery = "SELECT * FROM daily_summaries ORDER BY day_date DESC";
    const summaries = db.prepare(summaryQuery).all() as any[];

    for (const s of summaries) {
      const summaryText = s.summary_text || "";
      const dayLabel = s.day_label || s.day_date || "";
      const ts = s.day_start_ts || s.created_at || Date.now();

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
          groupId: s.thread_id,
        });
      }
    }

    // 2. Trích xuất các tin nhắn chứa file / link từ group_messages
    const linkMessages = db
      .prepare(
        `SELECT message_id, display_name, text, ts, thread_id
         FROM group_messages
         WHERE (text LIKE '%http://%' OR text LIKE '%https://%' OR text LIKE '%.pdf%' OR text LIKE '%.zip%' OR text LIKE '%.rar%' OR text LIKE '%.docx%' OR text LIKE '%.apk%')
           AND deleted_at IS NULL
           AND is_self = 0
           AND LOWER(display_name) NOT LIKE '%sen chúa%'
         ORDER BY ts DESC
         LIMIT 500`,
      )
      .all() as any[];

    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    for (const msg of linkMessages) {
      if (isSpamOrBotMessage(msg.text)) continue;

      const matches = msg.text.match(urlRegex);
      if (!matches) continue;

      const cleanLinks: { url: string; isFile?: boolean }[] = [];
      for (const u of matches) {
        const clean = u.replace(/[.,;!?)]+$/, "");
        if (isNewsUrl(clean)) continue;
        const isFile = isFileOrDriveUrl(clean);
        if (isFile) uniqueFiles.add(clean);
        uniqueLinks.add(clean);
        cleanLinks.push({ url: clean, isFile });
      }

      if (cleanLinks.length === 0) continue;

      const firstLink = cleanLinks[0]?.url;
      if (firstLink && items.some((it) => it.links.some((l) => l.url === firstLink))) {
        continue;
      }

      const authorName = msg.display_name || "Thành viên";
      contributors.add(authorName);

      const d = new Date(msg.ts + 7 * 3600 * 1000);
      const dateStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

      // Tách các dòng CHÍNH XÁC trong tin nhắn của người gửi
      const rawLines = msg.text
        .split("\n")
        .map((l: string) => l.replace(urlRegex, "").trim())
        .filter((l: string) => l.length >= 3 && !isSpamOrBotMessage(l));

      const hasFile = cleanLinks.some((l) => l.isFile);
      const titlePrefix = hasFile ? "📂 " : "";

      // Xác định tiêu đề súc tích
      let titleCandidate = "";
      if (firstLink) {
        titleCandidate = extractTitleFromUrl(firstLink) || "";
      }
      if (!titleCandidate && rawLines.length > 0) {
        titleCandidate = rawLines[0];
      }

      const displayTitle = cleanTitle(
        titleCandidate,
        hasFile ? `Tài liệu chia sẻ từ ${authorName}` : `Tài nguyên & Tool từ ${authorName}`,
        firstLink,
      );

      // Phân loại danh mục
      const lowerContext = (displayTitle + " " + rawLines.join(" ")).toLowerCase();
      let msgCat: KnowledgeItem["category"] = "links";
      let msgCatLabel = "Tài nguyên";

      if (
        lowerContext.includes("ai") ||
        lowerContext.includes("gpt") ||
        lowerContext.includes("prompt") ||
        lowerContext.includes("video") ||
        lowerContext.includes("voice") ||
        lowerContext.includes("flux") ||
        lowerContext.includes("midjourney") ||
        lowerContext.includes("comfyui") ||
        lowerContext.includes("colab") ||
        lowerContext.includes("codex") ||
        lowerContext.includes("vox")
      ) {
        msgCat = "ai";
        msgCatLabel = "AI & Video";
      } else if (
        lowerContext.includes("mmo") ||
        lowerContext.includes("ga") ||
        lowerContext.includes("adsense") ||
        lowerContext.includes("tiktok") ||
        lowerContext.includes("kênh") ||
        lowerContext.includes("view") ||
        lowerContext.includes("traffic") ||
        lowerContext.includes("bkt")
      ) {
        msgCat = "mmo";
        msgCatLabel = "MMO & Tut";
      }

      // Xây dựng Key Points súc tích
      const keyPoints: string[] = [];
      if (rawLines.length > 0) {
        for (const line of rawLines) {
          keyPoints.push(line);
        }
      } else {
        keyPoints.push(displayTitle);
      }
      keyPoints.push(`Đóng góp & chia sẻ bởi ${authorName}`);

      items.push({
        id: `msg_${msg.message_id || msg.ts}`,
        title: titlePrefix + displayTitle,
        category: msgCat,
        categoryLabel: hasFile ? "📂 File & Tài liệu" : msgCatLabel,
        summary: keyPoints.slice(0, 2).join(". ") || "Tài nguyên & liên kết chia sẻ từ cộng đồng.",
        keyPoints,
        links: cleanLinks,
        author: authorName,
        date: dateStr,
        timestamp: msg.ts,
        source: "message",
        groupId: msg.thread_id,
      });
    }

    db.close();

    items.sort((a, b) => b.timestamp - a.timestamp);

    let filtered = items;
    if (category !== "all") {
      if (category === "files") {
        filtered = filtered.filter((it) => it.links.some((l: any) => l.isFile) || it.categoryLabel.includes("File"));
      } else {
        filtered = filtered.filter((it) => it.category === category);
      }
    }
    if (groupId && groupId !== "all") {
      filtered = filtered.filter((it) => !it.groupId || it.groupId === groupId || (groupId === "1913869945242410752" && (!it.groupId || it.groupId === "1913869945242410752")));
    }
    if (query) {
      filtered = filtered.filter(
        (it) =>
          it.title.toLowerCase().includes(query) ||
          it.summary.toLowerCase().includes(query) ||
          it.author.toLowerCase().includes(query) ||
          it.keyPoints.some((kp) => kp.toLowerCase().includes(query)) ||
          it.links.some((l) => l.url.toLowerCase().includes(query)),
      );
    }

    return NextResponse.json({
      items: filtered,
      stats: {
        totalItems: items.length,
        totalLinks: uniqueLinks.size,
        totalFiles: uniqueFiles.size,
        totalContributors: contributors.size,
      },
    });
  } catch (error) {
    console.error("[api/hub]", error);
    return NextResponse.json({ error: "Lỗi tải kho kiến thức", items: [] }, { status: 500 });
  }
}

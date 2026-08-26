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
  links: { url: string; label?: string }[];
  author: string;
  date: string;
  timestamp: number;
  source: "summary" | "message";
  groupId?: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") || "").toLowerCase().trim();
    const category = searchParams.get("category") || "all";
    const groupId = searchParams.get("groupId") || "";

    const dbPath = getBotDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ items: [], stats: { totalItems: 0, totalLinks: 0, totalContributors: 0 } });
    }

    const db = new Database(dbPath, { readonly: true });
    const items: KnowledgeItem[] = [];
    const uniqueLinks = new Set<string>();
    const contributors = new Set<string>();

    // 1. Trích xuất từ bảng daily_summaries
    let summaryQuery = "SELECT * FROM daily_summaries ORDER BY day_date DESC LIMIT 30";
    const summaries = db.prepare(summaryQuery).all() as any[];

    for (const s of summaries) {
      const summaryText = s.summary_text || "";
      const dayLabel = s.day_label || s.day_date || "";
      const ts = s.day_start_ts || s.created_at || Date.now();

      // Phân tách các mục theo định dạng tóm tắt
      const sections = summaryText.split(/(?=\([1-7]\)|\b(?:📢|💼|🤖|🎓|🔗|❓|☕)\b)/);

      for (let secIdx = 0; secIdx < sections.length; secIdx++) {
        const rawSec = sections[secIdx].trim();
        if (!rawSec) continue;

        let cat: KnowledgeItem["category"] = "general";
        let catLabel = "Tổng quan";
        let secTitle = "";

        if (rawSec.includes("AI & CÔNG NGHỆ") || rawSec.includes("🤖")) {
          cat = "ai";
          catLabel = "AI & Công nghệ";
          secTitle = `Kiến thức & Xu hướng AI (${dayLabel})`;
        } else if (rawSec.includes("CHỦ ĐỀ CHUYÊN MÔN") || rawSec.includes("💼")) {
          cat = "mmo";
          catLabel = "MMO & Kinh nghiệm";
          secTitle = `Tút & Thảo luận chuyên môn (${dayLabel})`;
        } else if (rawSec.includes("HỌC HÀNH & KINH NGHIỆM") || rawSec.includes("🎓")) {
          cat = "learning";
          catLabel = "Học tập & Chia sẻ";
          secTitle = `Bài học & Kinh nghiệm (${dayLabel})`;
        } else if (rawSec.includes("LINK ĐÃ CHIA SẺ") || rawSec.includes("🔗")) {
          cat = "links";
          catLabel = "Kho Link & Tài nguyên";
          secTitle = `Danh sách Link & Tài liệu (${dayLabel})`;
        } else if (rawSec.includes("THÔNG BÁO") || rawSec.includes("📢")) {
          cat = "announcement";
          catLabel = "Thông báo";
          secTitle = `Thông báo cộng đồng (${dayLabel})`;
        } else {
          continue; // Bỏ qua mục chuyện ngoài lề hoặc rỗng
        }

        // Tách các dòng gạch đầu dòng
        const lines = rawSec
          .split("\n")
          .map((l: string) => l.trim())
          .filter((l: string) => l.startsWith("-") || l.startsWith("•") || l.startsWith("*"));

        const keyPoints = lines.map((l: string) => l.replace(/^[-•*]\s*/, ""));
        if (keyPoints.length === 0) continue;

        // Trích xuất links
        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        const secLinks: { url: string; label?: string }[] = [];
        for (const kp of keyPoints) {
          const matches = kp.match(urlRegex);
          if (matches) {
            for (const u of matches) {
              const cleanUrl = u.replace(/[.,;!?)]+$/, "");
              uniqueLinks.add(cleanUrl);
              secLinks.push({ url: cleanUrl });
            }
          }
        }

        // Lấy tác giả từ top senders nếu có
        let author = "Cộng đồng Zalo";
        try {
          const topSenders = JSON.parse(s.top_senders_json || "[]");
          if (Array.isArray(topSenders) && topSenders.length > 0) {
            author = topSenders[0].replace(/\s*\(\d+\)$/, "");
            contributors.add(author);
          }
        } catch {}

        items.push({
          id: `sum_${s.id || s.day_date}_${secIdx}`,
          title: secTitle,
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

    // 2. Trích xuất các tin nhắn chứa đường link quan trọng từ group_messages
    const linkMessages = db
      .prepare(
        `SELECT message_id, display_name, text, ts, thread_id
         FROM group_messages
         WHERE (text LIKE '%http://%' OR text LIKE '%https://%')
           AND deleted_at IS NULL
         ORDER BY ts DESC
         LIMIT 40`,
      )
      .all() as any[];

    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    for (const msg of linkMessages) {
      const matches = msg.text.match(urlRegex);
      if (!matches) continue;

      const authorName = msg.display_name || "Thành viên";
      contributors.add(authorName);

      const d = new Date(msg.ts + 7 * 3600 * 1000);
      const dateStr = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

      const cleanLinks = matches.map((u: string) => {
        const clean = u.replace(/[.,;!?)]+$/, "");
        uniqueLinks.add(clean);
        return { url: clean };
      });

      const cleanText = msg.text.replace(urlRegex, "").replace(/\s+/g, " ").trim();
      let msgCat: KnowledgeItem["category"] = "links";
      let msgCatLabel = "Kho Link";

      const lowerText = msg.text.toLowerCase();
      if (lowerText.includes("ai") || lowerText.includes("gpt") || lowerText.includes("prompt") || lowerText.includes("video")) {
        msgCat = "ai";
        msgCatLabel = "AI & Video";
      } else if (lowerText.includes("mmo") || lowerText.includes("ga") || lowerText.includes("adsense") || lowerText.includes("tiktok") || lowerText.includes("kênh")) {
        msgCat = "mmo";
        msgCatLabel = "MMO & Tut";
      }

      // Tránh trùng lặp nếu link đã có trong item gần nhất
      const firstLink = cleanLinks[0]?.url;
      if (firstLink && items.some((it) => it.links.some((l) => l.url === firstLink))) {
        continue;
      }

      items.push({
        id: `msg_${msg.message_id || msg.ts}`,
        title: cleanText ? (cleanText.length > 60 ? cleanText.slice(0, 60) + "..." : cleanText) : `Tài liệu chia sẻ từ ${authorName}`,
        category: msgCat,
        categoryLabel: msgCatLabel,
        summary: cleanText || "Đường link và tài nguyên được thành viên chia sẻ trong nhóm thảo luận.",
        keyPoints: [cleanText || "Đường link tài nguyên hữu ích", `Chia sẻ bởi ${authorName} vào lúc ${dateStr}`],
        links: cleanLinks,
        author: authorName,
        date: dateStr,
        timestamp: msg.ts,
        source: "message",
        groupId: msg.thread_id,
      });
    }

    db.close();

    // Sắp xếp bài mới nhất lên đầu
    items.sort((a, b) => b.timestamp - a.timestamp);

    // Lọc theo query tìm kiếm và category
    let filtered = items;
    if (category !== "all") {
      filtered = filtered.filter((it) => it.category === category);
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
        totalContributors: contributors.size,
      },
    });
  } catch (error) {
    console.error("[api/hub]", error);
    return NextResponse.json({ error: "Lỗi tải kho kiến thức", items: [] }, { status: 500 });
  }
}

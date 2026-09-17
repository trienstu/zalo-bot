import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

import { getGroupHubToken, verifyGroupHubToken } from "@/lib/hub-token";

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

// Domain báo chí / tin tức cần loại bỏ hoàn toàn khỏi kho tài nguyên học tập & công cụ
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
        .replace(/\.[a-z0-9]{2,5}$/i, "")
        .trim();

      if (cleanSlug.length >= 4 && !/^[0-9a-f]+$/i.test(cleanSlug)) {
        return cleanSlug.charAt(0).toUpperCase() + cleanSlug.slice(1);
      }
    }
    // Lấy domain làm gợi ý nếu có
    const host = u.hostname.replace(/^www\./, "");
    if (host.includes("github.com") && segments.length >= 2) {
      return `Github: ${segments[0]}/${segments[1]}`;
    }
    if (host.includes("drive.google.com") || host.includes("docs.google.com")) {
      return "Tài liệu Google Drive";
    }
    if (host.includes("notion.")) {
      return "Tài liệu Notion";
    }
    if (host.includes("canva.com")) {
      return "Template Canva";
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

  if (t.length > 80) {
    t = t.slice(0, 78) + "...";
  }
  return t || fallback;
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

    const db = new Database(dbPath, { readonly: true });

    // 1. Thu thập danh sách các nhóm hợp lệ từ bot_groups & group_messages
    const groupNameMap = new Map<string, string>();
    let allGroups: { id: string; name: string; totalMembers: number; token: string }[] = [];
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

    // Kiểm tra bảo mật:
    // - Nếu có token: Kiểm tra token nhóm cho thành viên
    // - Nếu không có token: Bắt buộc phải là Admin (đã đăng nhập). Thành viên không thể tự vào /hub để xem mọi nhóm
    const cookieHeader = request.headers.get("cookie") || "";
    const isAdminAuthenticated = cookieHeader.includes("admin_auth_session=authenticated_admin");

    let isLockedGroup = false;
    let targetGroupId = requestedGroupId;
    let currentGroup: { id: string; name: string; token: string } | null = null;

    if (!token && !isAdminAuthenticated) {
      db.close();
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

    if (token) {
      if (!requestedGroupId || !verifyGroupHubToken(requestedGroupId, token)) {
        db.close();
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
      const found = allGroups.find((g) => g.id === targetGroupId);
      currentGroup = found || {
        id: targetGroupId,
        name: groupNameMap.get(targetGroupId) || `Nhóm ${targetGroupId}`,
        token,
      };
    } else if (targetGroupId && targetGroupId !== "all") {
      const found = allGroups.find((g) => g.id === targetGroupId);
      if (found) {
        currentGroup = found;
      } else {
        currentGroup = {
          id: targetGroupId,
          name: groupNameMap.get(targetGroupId) || `Nhóm ${targetGroupId}`,
          token: getGroupHubToken(targetGroupId),
        };
      }
    }

    const items: KnowledgeItem[] = [];
    const uniqueLinks = new Set<string>();
    const uniqueFiles = new Set<string>();
    const contributors = new Set<string>();

    // 2. Trích xuất từ bảng daily_summaries
    let summarySql = "SELECT * FROM daily_summaries";
    const summaryParams: any[] = [];
    if (targetGroupId && targetGroupId !== "all") {
      summarySql += " WHERE thread_id = ? OR thread_id IS NULL";
      summaryParams.push(targetGroupId);
    }
    summarySql += " ORDER BY day_date DESC";

    const summaries = db.prepare(summarySql).all(...summaryParams) as any[];

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
    let msgSql = `SELECT message_id, display_name, text, ts, thread_id
                  FROM group_messages
                  WHERE (text LIKE '%http://%' OR text LIKE '%https://%' OR text LIKE '%.pdf%' OR text LIKE '%.zip%' OR text LIKE '%.rar%' OR text LIKE '%.docx%' OR text LIKE '%.apk%')
                    AND deleted_at IS NULL
                    AND is_self = 0
                    AND LOWER(display_name) NOT LIKE '%sen chúa%'`;
    const msgParams: any[] = [];
    if (targetGroupId && targetGroupId !== "all") {
      msgSql += " AND thread_id = ?";
      msgParams.push(targetGroupId);
    }
    msgSql += " ORDER BY ts DESC LIMIT 1000";

    const linkMessages = db.prepare(msgSql).all(...msgParams) as any[];

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

      // BÓC TÁCH ĐA LINK TRONG 1 TIN NHẮN:
      // Duyệt qua từng URL và tìm ngữ cảnh / mô tả tương ứng cho từng link
      for (let linkIdx = 0; linkIdx < cleanUrls.length; linkIdx++) {
        const currentLink = cleanUrls[linkIdx];

        // Tránh trùng lặp link đã có trong danh sách items
        if (items.some((it) => it.links.some((l) => l.url === currentLink.url))) {
          continue;
        }

        // Tìm dòng chứa URL này
        const lineIdxWithUrl = textLines.findIndex((line: string) => line.includes(currentLink.url));

        let titleCandidate = "";
        let specificDescriptionLines: string[] = [];

        if (lineIdxWithUrl !== -1) {
          const currentLine = textLines[lineIdxWithUrl];
          // Trích xuất phần text cùng dòng sau khi loại bỏ URL
          const inlineText = currentLine
            .replace(urlRegex, "")
            .replace(/^[-—•*0-9.)\s]+/, "")
            .trim();

          if (inlineText.length >= 4) {
            titleCandidate = inlineText;
          } else if (lineIdxWithUrl > 0) {
            // Nếu trên dòng chỉ có URL đơn lẻ, nhìn lên dòng liền kề phía trước
            const prevLine = textLines[lineIdxWithUrl - 1];
            if (!urlRegex.test(prevLine)) {
              titleCandidate = prevLine.replace(/^[-—•*0-9.)\s]+/, "").trim();
            }
          }

          // Thu thập các dòng mô tả tiếp theo (nằm trước link kế tiếp)
          const nextUrl = cleanUrls[linkIdx + 1]?.url;
          for (let k = lineIdxWithUrl + 1; k < textLines.length; k++) {
            const nextL = textLines[k];
            if (nextUrl && nextL.includes(nextUrl)) break;
            if (!urlRegex.test(nextL) && nextL.length >= 3) {
              specificDescriptionLines.push(nextL);
            }
          }
        }

        // Nếu chưa có tiêu đề, trích xuất từ URL hoặc fallback
        const urlSlugTitle = extractTitleFromUrl(currentLink.url);
        if (!titleCandidate && urlSlugTitle) {
          titleCandidate = urlSlugTitle;
        }

        const fallbackTitle = currentLink.isFile
          ? `Tài liệu chia sẻ từ ${authorName}`
          : `Tài nguyên & Tool từ ${authorName}`;

        const displayTitle = cleanTitle(titleCandidate, fallbackTitle, currentLink.url);

        // Phát hiện danh mục dựa trên ngữ cảnh của link này
        const contextText = `${displayTitle} ${specificDescriptionLines.join(" ")} ${textLines.join(" ")}`;
        const { category: detectedCat, label: detectedLabel } = detectCategoryFromContext(contextText, currentLink.isFile);

        // Xây dựng Key Points
        const keyPoints: string[] = [];
        if (specificDescriptionLines.length > 0) {
          for (const dLine of specificDescriptionLines) {
            keyPoints.push(dLine);
          }
        } else if (titleCandidate && titleCandidate !== displayTitle) {
          keyPoints.push(titleCandidate);
        } else {
          keyPoints.push(displayTitle);
        }
        keyPoints.push(`Chia sẻ bởi ${authorName} (${msgGroupName})`);

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

    // 4. Áp dụng các bộ lọc: Category, Group, Search Query
    let filtered = items;

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

    // 5. Sắp xếp (Sort)
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

    // 6. Phân trang dữ liệu (Pagination)
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const clampedPage = Math.min(page, totalPages);
    const startIndex = (clampedPage - 1) * limit;
    const pagedItems = filtered.slice(startIndex, startIndex + limit);

    // Danh sách nhóm trả về cho client:
    // Nếu là chế độ khóa nhóm (member truy cập qua token link), KHÔNG trả về các nhóm khác
    const returnedGroups = isLockedGroup
      ? currentGroup
        ? [currentGroup]
        : []
      : allGroups;

    return NextResponse.json({
      items: pagedItems,
      pagination: {
        page: clampedPage,
        limit,
        totalItems,
        totalPages,
      },
      stats: {
        totalItems: items.length,
        totalLinks: uniqueLinks.size,
        totalFiles: uniqueFiles.size,
        totalContributors: contributors.size,
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

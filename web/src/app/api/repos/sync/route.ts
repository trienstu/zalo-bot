import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { callGeminiDirect } from "@/lib/gemini-summary";

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

function getBotEnvPath(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), "..", "bot", ".env"),
    path.resolve(process.cwd(), "bot", ".env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(process.cwd(), "..", "bot", ".env");
}

function getGeminiApiKey(): string {
  if (process.env.GEMINI_API_KEY?.trim()) return process.env.GEMINI_API_KEY.trim();
  const envPath = getBotEnvPath();
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0 && trimmed.slice(0, idx).trim() === "GEMINI_API_KEY") {
        return trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return "";
}

const RESERVED_GITHUB_NAMES = new Set([
  "features", "topics", "trending", "collections", "events", "sponsors",
  "settings", "organizations", "explore", "pricing", "about", "login",
  "signup", "marketplace", "security", "customer-stories", "enterprise",
  "readme", "site", "contact", "support", "blog", "pulls", "issues",
  "actions", "projects", "wiki", "discussions",
]);

interface ExtractedRepo {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
}

function extractRepos(text: string): ExtractedRepo[] {
  if (!text || !text.includes("github.com")) return [];
  const regex = /https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)(?:\/)?(?:$|[?#\s])/gi;
  const results: ExtractedRepo[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const owner = match[1]?.trim() || "";
    let repo = match[2]?.trim() || "";
    if (repo.endsWith(".git")) repo = repo.slice(0, -4);

    if (!owner || !repo) continue;
    if (RESERVED_GITHUB_NAMES.has(owner.toLowerCase()) || RESERVED_GITHUB_NAMES.has(repo.toLowerCase())) continue;

    const fullName = `${owner}/${repo}`;
    if (!seen.has(fullName.toLowerCase())) {
      seen.add(fullName.toLowerCase());
      results.push({ owner, repo, fullName, url: `https://github.com/${fullName}` });
    }
  }
  return results;
}

/**
 * Cào trực tiếp thông tin từ trang HTML GitHub khi API bị rate-limit hoặc chặn
 */
async function scrapeGithubHtml(owner: string, repo: string) {
  const url = `https://github.com/${owner}/${repo}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 404) return { is404: true } as any;
    if (!res.ok) return null;
    const html = await res.text();

    // 1. Canonical full name
    let canonicalFullName = `${owner}/${repo}`;
    const ogUrlMatch = html.match(/<meta\s+property="og:url"\s+content="https:\/\/github\.com\/([^"?#]+)"/i);
    if (ogUrlMatch && ogUrlMatch[1].includes("/")) {
      canonicalFullName = ogUrlMatch[1].trim();
    } else {
      const ogTitleMatch =
        html.match(/<meta\s+property="og:title"\s+content="GitHub\s*-\s*([^:]+):/i) ||
        html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
      if (ogTitleMatch && ogTitleMatch[1].includes("/")) {
        canonicalFullName = ogTitleMatch[1].replace(/^GitHub\s*-\s*/i, "").trim();
      }
    }

    const parts = canonicalFullName.split("/");
    const canonicalOwner = parts[0] || owner;
    const canonicalRepo = parts[1] || repo;

    // 2. Description
    let description = "";
    const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    if (ogDescMatch) {
      description = ogDescMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
    }

    // 3. Stars
    let stars = 0;
    const starExactMatch =
      html.match(/id="repo-stars-counter-star"[^>]*title="([\d,]+)"/i) ||
      html.match(/id="repo-stars-counter-star"[^>]*aria-label="(\d+)\s+users?\s+starred/i);
    if (starExactMatch) {
      stars = parseInt(starExactMatch[1].replace(/,/g, ""), 10);
    } else {
      const starInnerMatch = html.match(/id="repo-stars-counter-star"[^>]*>([^<]+)<\/span>/i);
      if (starInnerMatch && starInnerMatch[1]) {
        const valStr = starInnerMatch[1].toLowerCase().trim();
        if (valStr.endsWith("k")) stars = Math.round(parseFloat(valStr) * 1000);
        else if (valStr.endsWith("m")) stars = Math.round(parseFloat(valStr) * 1000000);
        else stars = parseInt(valStr.replace(/,/g, ""), 10) || 0;
      } else {
        const starSideMatch = html.match(/octicon-star[^>]*>.*?<strong>([\d.kmb]+)<\/strong>\s*stars/is);
        if (starSideMatch) {
          const valStr = starSideMatch[1].toLowerCase().trim();
          if (valStr.endsWith("k")) stars = Math.round(parseFloat(valStr) * 1000);
          else if (valStr.endsWith("m")) stars = Math.round(parseFloat(valStr) * 1000000);
          else stars = parseInt(valStr.replace(/,/g, ""), 10) || 0;
        }
      }
    }

    // 4. Forks
    let forks = 0;
    const forkExactMatch = html.match(/id="repo-network-counter"[^>]*title="([\d,]+)"/i);
    if (forkExactMatch) {
      forks = parseInt(forkExactMatch[1].replace(/,/g, ""), 10);
    } else {
      const forkSideMatch = html.match(/octicon-repo-forked[^>]*>.*?<strong>([\d.kmb]+)<\/strong>\s*forks/is);
      if (forkSideMatch) {
        const valStr = forkSideMatch[1].toLowerCase().trim();
        if (valStr.endsWith("k")) forks = Math.round(parseFloat(valStr) * 1000);
        else if (valStr.endsWith("m")) forks = Math.round(parseFloat(valStr) * 1000000);
        else forks = parseInt(valStr.replace(/,/g, ""), 10) || 0;
      }
    }

    // 5. Topics
    const topics: string[] = [];
    const topicRegex = /\/topics\/([a-zA-Z0-9_-]+)/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = topicRegex.exec(html)) !== null) {
      if (!topics.includes(tMatch[1])) topics.push(tMatch[1]);
    }

    // 6. Language
    let language = "";
    const langMatch =
      html.match(/itemprop="programmingLanguage">([^<]+)<\/span>/i) ||
      html.match(/<span\s+class="color-fg-default\s+text-bold\s+mr-1">([^<]+)<\/span>/i);
    if (langMatch) language = langMatch[1].trim();

    return {
      owner: canonicalOwner,
      repo: canonicalRepo,
      fullName: canonicalFullName,
      description,
      stars,
      forks,
      language,
      topics: topics.slice(0, 8),
      htmlUrl: `https://github.com/${canonicalFullName}`,
    };
  } catch {
    return null;
  }
}

/**
 * Lấy metadata repo: Thử GitHub REST API trước, tự động fallback HTML scraper khi 403 hoặc lỗi
 */
async function fetchGithubMeta(owner: string, repo: string) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const token = process.env.GITHUB_TOKEN?.trim();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "ZaloBot-RepoSync/1.0",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 404) return { is404: true } as any;

    if (res.ok) {
      const data: any = await res.json();
      return {
        owner: data.owner?.login || owner,
        repo: data.name || repo,
        fullName: data.full_name || `${owner}/${repo}`,
        description: String(data.description || "").trim(),
        stars: Number(data.stargazers_count) || 0,
        forks: Number(data.forks_count) || 0,
        language: String(data.language || "").trim(),
        topics: Array.isArray(data.topics) ? data.topics : [],
        htmlUrl: data.html_url || `https://github.com/${owner}/${repo}`,
      };
    }
  } catch {
    // ignore API error, fallback to HTML scraping
  }

  // Fallback sang HTML scraping
  return scrapeGithubHtml(owner, repo);
}

function hasVietnameseDiacritics(str: string): boolean {
  return /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(str);
}

function quickClassify(fullName: string, description: string, topics: string[], language: string) {
  const combined = `${description} ${topics.join(" ")} ${language}`.toLowerCase();
  let category = "🛠️ Dev Tools & CLI";
  let target_audience = "Lập trình viên & Kỹ sư phần mềm";
  let summary_vi = `Công cụ mã nguồn mở ${fullName} hỗ trợ phát triển phần mềm và tối ưu hóa hiệu suất.`;

  if (combined.includes("mcp") || combined.includes("model-context-protocol")) {
    category = "🔌 MCP & Skills";
    target_audience = "AI Engineers & Claude/Cursor Users";
    summary_vi = `Bộ giao thức Model Context Protocol (MCP) server và công cụ mở rộng năng lực cho AI Assistant.`;
  } else if (
    combined.includes("agent") ||
    combined.includes("llm") ||
    combined.includes("gpt") ||
    combined.includes("rag") ||
    combined.includes("prompt") ||
    combined.includes("claude")
  ) {
    category = "🤖 AI & Agents";
    target_audience = "AI Developers & Người làm AI Automation";
    summary_vi = `Nền tảng trí tuệ nhân tạo (AI) và mô hình ngôn ngữ lớn (LLM), hỗ trợ phát triển Agent tự hành.`;
  } else if (
    combined.includes("crawler") ||
    combined.includes("scrap") ||
    combined.includes("bot") ||
    combined.includes("selenium") ||
    combined.includes("puppeteer")
  ) {
    category = "🕷️ Automation & Scraping";
    target_audience = "Dân MMO & Auto Data Collector";
    summary_vi = `Công cụ tự động hóa, cào dữ liệu và bóc tách nội dung website tốc độ cao.`;
  } else if (
    combined.includes("docker") ||
    combined.includes("self-hosted") ||
    combined.includes("kubernetes") ||
    combined.includes("server")
  ) {
    category = "🏠 Self-Hosted & Infra";
    target_audience = "DevOps & Sysadmin & Homelab";
    summary_vi = `Giải pháp triển khai hạ tầng tự host, tối ưu quản trị container và máy chủ nội bộ.`;
  } else if (
    combined.includes("react") ||
    combined.includes("nextjs") ||
    combined.includes("vue") ||
    combined.includes("frontend") ||
    combined.includes("web")
  ) {
    category = "🌐 Web & Fullstack";
    target_audience = "Fullstack & Web Developers";
    summary_vi = `Khung ứng dụng web và giải pháp fullstack hiện đại, hỗ trợ xây dựng giao diện mượt mà.`;
  }

  return { category, summary_vi, target_audience };
}

async function translateWithGtx(text: string): Promise<string> {
  if (!text || text.trim() === "No description" || hasVietnameseDiacritics(text)) return text;
  try {
    const q = encodeURIComponent(text.slice(0, 500));
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${q}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (res.ok) {
      const data: any = await res.json();
      return data[0]?.map((x: any) => x[0]).join("").trim() || text;
    }
  } catch {}
  return text;
}

async function classifyAndSummarizeWithAi(meta: {
  fullName: string;
  description: string;
  language: string;
  topics: string[];
}): Promise<{ category: string; summary_vi: string; target_audience: string }> {
  const fallback = quickClassify(meta.fullName, meta.description, meta.topics, meta.language);
  const apiKey = getGeminiApiKey();

  if (apiKey) {
    const system = `Bạn là Chuyên gia Tuyển chọn Mã Nguồn Mở (GitHub Curator) của FindARepo.
NHIỆM VỤ:
1. Phân loại repo vào ĐÚNG 1 TRONG CÁC DANH MỤC:
   - "🤖 AI & Agents"
   - "🔌 MCP & Skills"
   - "🛠️ Dev Tools & CLI"
   - "🕷️ Automation & Scraping"
   - "🌐 Web & Fullstack"
   - "🏠 Self-Hosted & Infra"
   - "📦 Libraries & Core"
2. Viết TÓM TẮT CÔNG NĂNG BẰNG TIẾNG VIỆT 100% (1-2 câu ngắn gọn, rõ ràng, nêu bật repo này làm được gì).
   BẮT BUỘC 100% TIẾNG VIỆT TỰ NHIÊN, LƯU LOÁT.
   TUYỆT ĐỐI CẤM ĐỂ NGUYÊN TIẾNG ANH. Dù mô tả gốc là tiếng Anh hay tiếng khác, PHẢI DỊCH VÀ ĐÚC KẾT SANG TIẾNG VIỆT.
   Không viết câu chung chung như "Mã nguồn mở được chia sẻ...".
3. Nêu ĐỐI TƯỢNG PHÙ HỢP (ví dụ: "AI Developers & Kỹ sư phần mềm", "Dân MMO & Auto", "Fullstack Dev", "DevOps & Sysadmin").

Trả về đúng JSON:
{"category": "string", "summary_vi": "string", "target_audience": "string"}`;

    const user = `Repo: ${meta.fullName}
Ngôn ngữ: ${meta.language || "Không rõ"}
Topics: ${meta.topics.join(", ") || "Không có"}
Mô tả gốc: "${meta.description || "No description"}"`;

    try {
      const raw = await callGeminiDirect(system, user, apiKey, "gemini-3.6-flash");
      const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(jsonStr);
      let summary_vi = String(parsed.summary_vi || "").trim();
      if (summary_vi && hasVietnameseDiacritics(summary_vi)) {
        return {
          category: parsed.category || fallback.category,
          summary_vi,
          target_audience: parsed.target_audience || fallback.target_audience,
        };
      }
    } catch {}
  }

  // Fallback sang Google Translate GTX nếu Gemini bận
  if (meta.description && meta.description !== "No description") {
    const translatedDesc = await translateWithGtx(meta.description);
    if (translatedDesc && hasVietnameseDiacritics(translatedDesc)) {
      return {
        category: fallback.category,
        summary_vi: translatedDesc,
        target_audience: fallback.target_audience,
      };
    }
  }

  return fallback;
}

export async function POST(request: Request) {
  try {
    // Kiểm tra quyền Admin trước khi cho phép quét / đồng bộ
    const cookieHeader = request.headers.get("cookie") || "";
    const xAdminAuth = request.headers.get("x-admin-auth") || "";
    const isAdminAuthenticated =
      cookieHeader.includes("admin_auth_session=authenticated_admin") ||
      xAdminAuth === "authenticated_admin";
    const host = request.headers.get("host") || "";
    const isDevLocalhost =
      process.env.NODE_ENV === "development" &&
      (host.startsWith("localhost") || host.startsWith("127.0.0.1"));

    if (!isAdminAuthenticated && !isDevLocalhost) {
      return NextResponse.json(
        { error: "unauthorized", message: "Chức năng đồng bộ repo chỉ dành riêng cho Quản trị viên." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const groupId = searchParams.get("groupId") || "all";

    const dbPath = getBotDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ error: "Không tìm thấy database bot.db" }, { status: 404 });
    }

    const db = new Database(dbPath);

    // 1. TỰ ĐỘNG SỬA CHỮA (AUTO-HEALING):
    // Quét tìm repo bị 0 sao, thiếu mô tả, còn tiếng Anh, hoặc có câu mô tả mặc định chung chung
    const allExistingRepos = db.prepare(`
      SELECT id, thread_id, full_name, owner, repo_name, description, stars, forks, language, category, summary_vi 
      FROM group_repos
    `).all() as any[];

    let healedCount = 0;
    let translatedCount = 0;

    const updateRepoStmt = db.prepare(`
      UPDATE group_repos 
      SET full_name = ?, owner = ?, repo_name = ?, repo_url = ?, description = ?, 
          stars = ?, forks = ?, language = ?, category = ?, summary_vi = ?, 
          target_audience = ?, updated_at = ? 
      WHERE id = ?
    `);

    const reposToHeal = allExistingRepos.filter((repo) => {
      const isZeroStars = Number(repo.stars) === 0;
      const isMissingDesc = !repo.description || repo.description === "No description";
      const isEnglishSummary = !hasVietnameseDiacritics(repo.summary_vi || "") || repo.summary_vi === repo.description;
      const isGenericPlaceholder = (repo.summary_vi || "").includes("Mã nguồn mở được thành viên chia sẻ trên nhóm Zalo");
      return (isZeroStars || isMissingDesc || isEnglishSummary || isGenericPlaceholder) && repo.category !== "📦 Lưu trữ / Riêng tư";
    });

    // Xử lý song song theo cụm 5 repo để tránh timeout
    const BATCH_SIZE = 5;
    for (let i = 0; i < reposToHeal.length; i += BATCH_SIZE) {
      const batch = reposToHeal.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (repo) => {
        try {
          const meta = await fetchGithubMeta(repo.owner, repo.repo_name);

          if (!meta || (meta as any).is404) {
            updateRepoStmt.run(
              repo.full_name,
              repo.owner,
              repo.repo_name,
              `https://github.com/${repo.full_name}`,
              "Kho lưu trữ đã bị tác giả xóa hoặc đặt ở chế độ riêng tư trên GitHub.",
              0,
              0,
              repo.language || "",
              "📦 Lưu trữ / Riêng tư",
              "Mã nguồn riêng tư hoặc kho lưu trữ đã được tác giả gỡ bỏ/đổi tên trên GitHub.",
              "Cộng đồng lập trình",
              Date.now(),
              repo.id
            );
            return;
          }

          const ai = await classifyAndSummarizeWithAi({
            fullName: meta.fullName,
            description: meta.description,
            language: meta.language || repo.language,
            topics: meta.topics,
          });

          updateRepoStmt.run(
            meta.fullName,
            meta.owner,
            meta.repo,
            meta.htmlUrl,
            meta.description,
            meta.stars,
            meta.forks,
            meta.language || repo.language,
            ai.category,
            ai.summary_vi,
            ai.target_audience,
            Date.now(),
            repo.id
          );

          if (Number(repo.stars) === 0 && meta.stars > 0) healedCount++;
          translatedCount++;
        } catch {}
      });

      await Promise.allSettled(promises);
    }

    // 1.5. HỢP NHẤT TRÙNG LẶP DO CHỮ HOA/THƯỜNG (Case-insensitive deduplication)
    const duplicates = db.prepare(`
      SELECT LOWER(full_name) as lower_name, thread_id, COUNT(*) as cnt
      FROM group_repos
      GROUP BY LOWER(full_name), thread_id
      HAVING cnt > 1
    `).all() as any[];

    let mergedDuplicates = 0;
    for (const dup of duplicates) {
      const dupRows = db.prepare(`
        SELECT id, stars, forks, summary_vi, description
        FROM group_repos
        WHERE LOWER(full_name) = ? AND thread_id = ?
        ORDER BY stars DESC, LENGTH(summary_vi) DESC
      `).all(dup.lower_name, dup.thread_id) as any[];

      if (dupRows.length > 1) {
        // Giữ lại row đầu tiên (nhiều stars nhất, summary dài nhất), xóa các row thừa
        const deleteIds = dupRows.slice(1).map((r: any) => r.id);
        const placeholders = deleteIds.map(() => "?").join(",");
        db.prepare(`DELETE FROM group_repos WHERE id IN (${placeholders})`).run(...deleteIds);
        mergedDuplicates += deleteIds.length;
      }
    }

    // 2. Quét thêm repo mới từ tin nhắn
    let sql = `
      SELECT thread_id, zalo_user_id, display_name, text, ts 
      FROM group_messages 
      WHERE text LIKE '%github.com%' AND deleted_at IS NULL
    `;
    const params: any[] = [];
    if (groupId && groupId !== "all") {
      sql += " AND thread_id = ?";
      params.push(groupId);
    }
    sql += " ORDER BY ts DESC LIMIT 300";

    const rows: any[] = db.prepare(sql).all(...params);

    // Chống trùng lặp tuyệt đối không phân biệt hoa thường
    const checkInGroupStmt = db.prepare("SELECT id FROM group_repos WHERE thread_id = ? AND LOWER(full_name) = LOWER(?)");
    const findCachedMetaStmt = db.prepare("SELECT * FROM group_repos WHERE LOWER(full_name) = LOWER(?) AND stars > 0 LIMIT 1");

    const insertStmt = db.prepare(`
      INSERT INTO group_repos (
        thread_id, repo_url, owner, repo_name, full_name,
        description, stars, forks, language, category,
        summary_vi, target_audience, shared_by_uid, shared_by_name,
        created_at, updated_at
      ) VALUES (
        @thread_id, @repo_url, @owner, @repo_name, @full_name,
        @description, @stars, @forks, @language, @category,
        @summary_vi, @target_audience, @shared_by_uid, @shared_by_name,
        @created_at, @updated_at
      )
    `);

    let newReposFound = 0;
    const addedList: string[] = [];

    for (const msg of rows) {
      const candidates = extractRepos(msg.text);
      for (const item of candidates) {
        const existingInThisGroup = checkInGroupStmt.get(msg.thread_id, item.fullName);
        if (existingInThisGroup) {
          continue;
        }

        const cached: any = findCachedMetaStmt.get(item.fullName);
        let repoUrl = item.url;
        let owner = item.owner;
        let repoName = item.repo;
        let fullName = item.fullName;
        let description = "";
        let stars = 0;
        let forks = 0;
        let language = "";
        let classification: { category: string; summary_vi: string; target_audience: string };

        if (cached && hasVietnameseDiacritics(cached.summary_vi || "")) {
          repoUrl = cached.repo_url;
          owner = cached.owner;
          repoName = cached.repo_name;
          fullName = cached.full_name;
          description = cached.description || "";
          stars = cached.stars || 0;
          forks = cached.forks || 0;
          language = cached.language || "";
          classification = {
            category: cached.category,
            summary_vi: cached.summary_vi,
            target_audience: cached.target_audience,
          };
        } else {
          const meta = await fetchGithubMeta(item.owner, item.repo);
          if (meta) {
            repoUrl = meta.htmlUrl;
            owner = meta.owner;
            repoName = meta.repo;
            fullName = meta.fullName;
            description = meta.description;
            stars = meta.stars;
            forks = meta.forks;
            language = meta.language;
            classification = await classifyAndSummarizeWithAi({
              fullName: meta.fullName,
              description: meta.description,
              language: meta.language,
              topics: meta.topics,
            });
          } else {
            classification = quickClassify(item.fullName, "", [], "");
          }
        }

        try {
          insertStmt.run({
            thread_id: msg.thread_id,
            repo_url: repoUrl,
            owner: owner,
            repo_name: repoName,
            full_name: fullName,
            description: description,
            stars: stars,
            forks: forks,
            language: language,
            category: classification.category,
            summary_vi: classification.summary_vi,
            target_audience: classification.target_audience,
            shared_by_uid: msg.zalo_user_id,
            shared_by_name: msg.display_name || "Thành viên",
            created_at: msg.ts || Date.now(),
            updated_at: Date.now(),
          });
          newReposFound++;
          addedList.push(fullName);
        } catch {
          // Bỏ qua nếu lỗi unique constraint
        }
      }
    }

    db.close();

    const parts: string[] = [];
    if (healedCount > 0) parts.push(`khắc phục số sao cho ${healedCount} repo`);
    if (translatedCount > 0) parts.push(`chuyển thể ${translatedCount} tóm tắt sang tiếng Việt`);
    if (mergedDuplicates > 0) parts.push(`gộp ${mergedDuplicates} bản ghi trùng hoa/thường`);
    if (newReposFound > 0) parts.push(`đồng bộ ${newReposFound} repo mới`);

    const actionText = parts.length > 0 ? parts.join(", ") : "tất cả repo đã đầy đủ metadata và chuẩn tiếng Việt";

    return NextResponse.json({
      success: true,
      scannedMessages: rows.length,
      healedCount,
      translatedCount,
      mergedDuplicates,
      newReposFound,
      addedList,
      message: `Hoàn tất: Đã quét ${rows.length} tin nhắn — ${actionText}!`,
    });
  } catch (err: any) {
    console.error("[api/repos/sync] Error:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}

import { callGemini } from "./gemini.js";
import { saveGroupRepo, isRepoRecentlyShared, type GroupRepoItem } from "./db/index.js";

const RESERVED_GITHUB_NAMES = new Set([
  "features",
  "topics",
  "trending",
  "collections",
  "events",
  "sponsors",
  "settings",
  "organizations",
  "explore",
  "pricing",
  "about",
  "login",
  "signup",
  "marketplace",
  "security",
  "customer-stories",
  "enterprise",
  "readme",
  "site",
  "contact",
  "support",
  "blog",
  "pulls",
  "issues",
  "actions",
  "projects",
  "wiki",
  "discussions",
]);

export interface ExtractedGithubRepo {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
}

export interface GithubRepoMetadata {
  owner: string;
  repo: string;
  fullName: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  topics: string[];
  htmlUrl: string;
}

/**
 * Trích xuất danh sách các URL GitHub Repository hợp lệ từ văn bản tin nhắn
 */
export function extractGithubRepoUrls(text: string): ExtractedGithubRepo[] {
  if (!text || !text.includes("github.com")) return [];

  const GITHUB_REPO_REGEX = /https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)(?:\/)?(?:$|[?#\s])/gi;
  const results: ExtractedGithubRepo[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = GITHUB_REPO_REGEX.exec(text)) !== null) {
    const owner = match[1]?.trim() || "";
    let repo = match[2]?.trim() || "";
    // Bỏ đuôi .git nếu có
    if (repo.endsWith(".git")) repo = repo.slice(0, -4);

    if (!owner || !repo) continue;
    if (RESERVED_GITHUB_NAMES.has(owner.toLowerCase()) || RESERVED_GITHUB_NAMES.has(repo.toLowerCase())) continue;

    const fullName = `${owner}/${repo}`;
    const cleanUrl = `https://github.com/${fullName}`;

    if (!seen.has(fullName.toLowerCase())) {
      seen.add(fullName.toLowerCase());
      results.push({ owner, repo, fullName, url: cleanUrl });
    }
  }

  return results;
}

/**
 * Kiểm tra chuỗi có dấu tiếng Việt hay không
 */
export function hasVietnameseDiacritics(str: string): boolean {
  return /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(str);
}

/**
 * Cào trực tiếp thông tin từ trang HTML GitHub khi API bị rate-limit hoặc chặn
 */
export async function scrapeGithubRepoHtml(owner: string, repo: string): Promise<GithubRepoMetadata | null> {
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

    if (!res.ok) {
      console.warn(`[github-enricher] HTML Scrape HTTP ${res.status} cho ${owner}/${repo}`);
      return null;
    }

    const html = await res.text();

    // 1. Tên repo chuẩn (Canonical case từ og:url hoặc og:title)
    let canonicalFullName = `${owner}/${repo}`;
    const ogUrlMatch = html.match(/<meta\s+property="og:url"\s+content="https:\/\/github\.com\/([^"?#]+)"/i);
    if (ogUrlMatch && ogUrlMatch[1] && ogUrlMatch[1].includes("/")) {
      canonicalFullName = ogUrlMatch[1].trim();
    } else {
      const ogTitleMatch =
        html.match(/<meta\s+property="og:title"\s+content="GitHub\s*-\s*([^:]+):/i) ||
        html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
      if (ogTitleMatch && ogTitleMatch[1] && ogTitleMatch[1].includes("/")) {
        canonicalFullName = ogTitleMatch[1].replace(/^GitHub\s*-\s*/i, "").trim();
      }
    }

    const parts = canonicalFullName.split("/");
    const canonicalOwner = parts[0] || owner;
    const canonicalRepo = parts[1] || repo;

    // 2. Mô tả (og:description)
    let description = "";
    const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    if (ogDescMatch && ogDescMatch[1]) {
      description = ogDescMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
    }

    // 3. Số sao (Stars)
    let stars = 0;
    const starExactMatch =
      html.match(/id="repo-stars-counter-star"[^>]*title="([\d,]+)"/i) ||
      html.match(/id="repo-stars-counter-star"[^>]*aria-label="(\d+)\s+users?\s+starred/i);
    if (starExactMatch && starExactMatch[1]) {
      stars = parseInt(starExactMatch[1].replace(/,/g, ""), 10);
    } else {
      const starSideMatch = html.match(/octicon-star[^>]*>.*?<strong>([\d.kmb]+)<\/strong>\s*stars/is);
      if (starSideMatch && starSideMatch[1]) {
        const valStr = starSideMatch[1].toLowerCase().trim();
        if (valStr.endsWith("k")) stars = Math.round(parseFloat(valStr) * 1000);
        else if (valStr.endsWith("m")) stars = Math.round(parseFloat(valStr) * 1000000);
        else stars = parseInt(valStr.replace(/,/g, ""), 10) || 0;
      }
    }

    // 4. Số forks
    let forks = 0;
    const forkExactMatch = html.match(/id="repo-network-counter"[^>]*title="([\d,]+)"/i);
    if (forkExactMatch && forkExactMatch[1]) {
      forks = parseInt(forkExactMatch[1].replace(/,/g, ""), 10);
    } else {
      const forkSideMatch = html.match(/octicon-repo-forked[^>]*>.*?<strong>([\d.kmb]+)<\/strong>\s*forks/is);
      if (forkSideMatch && forkSideMatch[1]) {
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
      const topicTag = tMatch[1];
      if (topicTag && !topics.includes(topicTag)) topics.push(topicTag);
    }

    // 6. Language
    let language = "";
    const langMatch =
      html.match(/itemprop="programmingLanguage">([^<]+)<\/span>/i) ||
      html.match(/<span\s+class="color-fg-default\s+text-bold\s+mr-1">([^<]+)<\/span>/i);
    if (langMatch && langMatch[1]) language = langMatch[1].trim();

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
  } catch (err: any) {
    console.warn(`[github-enricher] Lỗi cào HTML GitHub (${owner}/${repo}):`, err?.message || err);
    return null;
  }
}

/**
 * Lấy thông tin metadata của repo từ GitHub REST API công khai (tự động fallback HTML Scraper nếu bị rate limit 403)
 */
export async function fetchGithubRepoMetadata(owner: string, repo: string): Promise<GithubRepoMetadata | null> {
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ZaloBot-RepoDiscovery/1.0",
  };

  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(apiUrl, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

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

    console.warn(`[github-enricher] GitHub API HTTP ${res.status} cho ${owner}/${repo} -> Kích hoạt HTML Scraper fallback...`);
  } catch (err: any) {
    console.warn(`[github-enricher] Lỗi kết nối GitHub API (${owner}/${repo}) -> Kích hoạt HTML Scraper fallback:`, err?.message || err);
  }

  // Fallback sang HTML Scraper khi API bị rate limit (HTTP 403) hoặc lỗi
  return scrapeGithubRepoHtml(owner, repo);
}

/**
 * Sử dụng Gemini Flash-Lite phân loại danh mục theo chuẩn FindARepo và tóm tắt tiếng Việt súc tích
 */
export async function classifyAndSummarizeRepo(
  metadata: GithubRepoMetadata,
): Promise<{ category: string; summary_vi: string; target_audience: string }> {
  const system = `Bạn là Chuyên gia Đánh giá & Tuyển chọn Mã Nguồn Mở (GitHub Open-Source Curator) theo tiêu chuẩn của FindARepo.
NHIỆM VỤ:
1. Đọc kỹ thông tin repo (Tên, Mô tả gốc, Ngôn ngữ lập trình, Topics gắn thẻ).
2. Phân loại repo vào ĐÚNG 1 TRONG CÁC DANH MỤC SAU ĐÂY:
   - "🤖 AI & Agents" (LLM, Autonomous Agents, Prompting, Multi-Agent, RAG, AI Chatbots)
   - "🔌 MCP & Skills" (Model Context Protocol servers, Claude skills, Agent tools/plugins)
   - "🛠️ Dev Tools & CLI" (Terminal tools, IDE extensions, Git, Linters, Compilers, Debuggers)
   - "🕷️ Automation & Scraping" (Web crawlers, Bots, Headless browser, Data extraction)
   - "🌐 Web & Fullstack" (React, Next.js, Vue, Node.js backend, REST APIs, Mobile apps)
   - "🏠 Self-Hosted & Infra" (Docker, Kubernetes, Databases, Self-hosted SaaS alternatives, Homelab)
   - "📦 Libraries & Core" (Algorithms, Data structures, Security, Cryptography, Math)

3. Soạn TÓM TẮT CÔNG NĂNG TIẾNG VIỆT SIÊU TINH GỌN (1-2 CÂU):
   - BẮT BUỘC 100% TIẾNG VIỆT TỰ NHIÊN, LƯU LOÁT.
   - Nêu rõ: Repo này là gì, giải quyết bài toán gì, tính năng nổi bật nhất.
   - TUYỆT ĐỐI CẤM GIỮ NGUYÊN TIẾNG ANH. Dù mô tả gốc là tiếng Anh hay ngôn ngữ khác, PHẢI DỊCH và TÓM LƯỢC sang tiếng Việt.
   - Không dùng câu chung chung như "Mã nguồn mở được chia sẻ...".

4. Nêu ĐỐI TƯỢNG PHÙ HỢP (1 cụm từ tiếng Việt ngắn gọn, ví dụ: "AI Developers & Kỹ sư phần mềm", "Dân MMO & Auto", "Frontend Dev", "DevOps & Sysadmin", "Người dùng cá nhân").

BẮT BUỘC trả về đúng định dạng JSON:
{
  "category": "string",
  "summary_vi": "string",
  "target_audience": "string"
}`;

  const user = `REPO: ${metadata.fullName}
Ngôn ngữ: ${metadata.language || "Không xác định"}
Stars: ${metadata.stars} | Forks: ${metadata.forks}
Topics: ${metadata.topics.join(", ") || "Không có"}
Mô tả gốc: "${metadata.description || "No description provided."}"

HÃY XUẤT ĐÁNH GIÁ BẰNG TIẾNG VIỆT (JSON):`;

  try {
    const rawJson = await callGemini(system, user, {
      model: "gemini-3.1-flash-lite-preview",
      maxTokens: 300,
      json: true,
    });

    const parsed = JSON.parse(rawJson);
    const validCategories = [
      "🤖 AI & Agents",
      "🔌 MCP & Skills",
      "🛠️ Dev Tools & CLI",
      "🕷️ Automation & Scraping",
      "🌐 Web & Fullstack",
      "🏠 Self-Hosted & Infra",
      "📦 Libraries & Core",
    ];

    const category = validCategories.find((c) => c.includes(parsed.category)) || parsed.category || "🛠️ Dev Tools & CLI";
    let summary_vi = String(parsed.summary_vi || "").trim();
    if (!summary_vi || !hasVietnameseDiacritics(summary_vi)) {
      summary_vi = `Công cụ mã nguồn mở ${metadata.fullName} hỗ trợ phát triển phần mềm và tự động hóa.`;
    }
    const target_audience = String(parsed.target_audience || "Lập trình viên & Cộng đồng công nghệ").trim();

    return { category, summary_vi, target_audience };
  } catch (err) {
    console.warn(`[github-enricher] Gemini phân loại fallback cho ${metadata.fullName}:`, err);
    const isMcp = metadata.topics.some((t) => /mcp|model-context-protocol/i.test(t));
    const isAi = metadata.topics.some((t) => /ai|llm|agent|rag|prompt/i.test(t));
    const isAuto = metadata.topics.some((t) => /scrap|crawler|bot|auto/i.test(t));
    const isInfra = metadata.topics.some((t) => /docker|k8s|infra|self-hosted/i.test(t));

    const category = isMcp
      ? "🔌 MCP & Skills"
      : isAi
        ? "🤖 AI & Agents"
        : isAuto
          ? "🕷️ Automation & Scraping"
          : isInfra
            ? "🏠 Self-Hosted & Infra"
            : "🛠️ Dev Tools & CLI";

    let summary_vi = `Dự án mã nguồn mở ${metadata.fullName} hỗ trợ lập trình và tối ưu hóa quy trình làm việc.`;
    if (category === "🤖 AI & Agents") {
      summary_vi = `Nền tảng phát triển AI & mô hình ngôn ngữ lớn (LLM), hỗ trợ tạo trợ lý ảo thông minh.`;
    } else if (category === "🔌 MCP & Skills") {
      summary_vi = `Bộ công cụ Model Context Protocol (MCP) server & kỹ năng mở rộng cho AI Assistant.`;
    } else if (category === "🕷️ Automation & Scraping") {
      summary_vi = `Công cụ tự động hóa, cào dữ liệu và trích xuất nội dung website hiệu năng cao.`;
    } else if (category === "🏠 Self-Hosted & Infra") {
      summary_vi = `Giải pháp triển khai hạ tầng tự host, quản trị container và tối ưu hóa hệ thống.`;
    }

    return {
      category,
      summary_vi,
      target_audience: isAi ? "AI Developers & Kỹ sư phần mềm" : "Lập trình viên & Cộng đồng công nghệ",
    };
  }
}

/**
 * Định dạng thẻ Zalo Micro-Card tinh gọn gửi vào nhóm
 */
export function formatZaloRepoCard(item: GroupRepoItem): string {
  const starText =
    item.stars !== undefined
      ? item.stars >= 1000
        ? `${(item.stars / 1000).toFixed(1)}k`
        : `${item.stars}`
      : "0";
  const langText = item.language ? ` • ${item.language}` : "";

  return (
    `📦 **${item.full_name}** (★ ${starText}${langText})\n` +
    `🏷️ Phân loại: [${item.category}]\n` +
    `💡 Tóm tắt: ${item.summary_vi}\n` +
    (item.target_audience ? `👥 Phù hợp: ${item.target_audience}\n` : "") +
    `🌐 Đã lưu vào Kho Repo của nhóm!`
  );
}

/**
 * Xử lý toàn diện: Bóc tách link GitHub, cào metadata, phân loại AI, lưu Database và trả về danh sách thẻ
 */
export async function processGithubReposInMessage(params: {
  threadId: string;
  text: string;
  senderUid: string;
  senderName: string;
}): Promise<{ cards: string[]; repos: GroupRepoItem[] }> {
  const { threadId, text, senderUid, senderName } = params;
  const extracted = extractGithubRepoUrls(text);
  if (extracted.length === 0) {
    return { cards: [], repos: [] };
  }

  const cards: string[] = [];
  const repos: GroupRepoItem[] = [];

  // Tối đa 2 repo mỗi tin nhắn để tránh spam
  for (const item of extracted.slice(0, 2)) {
    // Chống spam: Nếu repo này vừa được lưu/share trong 10 phút gần đây thì bỏ qua không gửi thẻ lặp lại
    if (isRepoRecentlyShared(threadId, item.fullName, 10 * 60 * 1000)) {
      console.log(`[github-enricher] ⏭️ Bỏ qua repo ${item.fullName} vì vừa được chia sẻ trong nhóm gần đây.`);
      continue;
    }

    const meta = await fetchGithubRepoMetadata(item.owner, item.repo);
    if (!meta) continue;

    const aiAnalysis = await classifyAndSummarizeRepo(meta);

    const repoItem: GroupRepoItem = {
      thread_id: threadId,
      repo_url: meta.htmlUrl,
      owner: meta.owner,
      repo_name: meta.repo,
      full_name: meta.fullName,
      description: meta.description,
      stars: meta.stars,
      forks: meta.forks,
      language: meta.language,
      category: aiAnalysis.category,
      summary_vi: aiAnalysis.summary_vi,
      target_audience: aiAnalysis.target_audience,
      shared_by_uid: senderUid,
      shared_by_name: senderName,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    saveGroupRepo(repoItem);
    repos.push(repoItem);
    cards.push(formatZaloRepoCard(repoItem));
  }

  return { cards, repos };
}

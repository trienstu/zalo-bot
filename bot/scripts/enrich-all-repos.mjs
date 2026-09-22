import "dotenv/config";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// Cấu hình Cloudflare AI & Gemini từ biến môi trường
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CF_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function hasVietnameseDiacritics(str) {
  return /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(str || "");
}

/**
 * Dịch nhanh qua Google Translate GTX (50ms, không cần API Key)
 */
async function translateWithGtx(text) {
  if (!text || text.trim() === "No description" || hasVietnameseDiacritics(text)) return text;
  try {
    const q = encodeURIComponent(text.slice(0, 500));
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${q}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (res.ok) {
      const data = await res.json();
      return data[0]?.map((x) => x[0]).join("").trim() || text;
    }
  } catch {}
  return text;
}

/**
 * Tóm tắt và phân loại qua Cloudflare Workers AI (Llama-3.3-70B)
 */
async function summarizeWithCloudflareAi(meta) {
  const systemPrompt = `Bạn là Chuyên gia Tuyển chọn Mã Nguồn Mở (GitHub Curator) của FindARepo.
NHIỆM VỤ:
1. Phân loại repo vào ĐÚNG 1 TRONG CÁC DANH MỤC:
   - "🤖 AI & Agents"
   - "🔌 MCP & Skills"
   - "🛠️ Dev Tools & CLI"
   - "🕷️ Automation & Scraping"
   - "🌐 Web & Fullstack"
   - "🏠 Self-Hosted & Infra"
   - "📦 Libraries & Core"
2. Viết TÓM TẮT CÔNG NĂNG BẰNG TIẾNG VIỆT 100% (1 câu ngắn gọn 20-30 từ, nêu bật repo này làm được gì).
   BẮT BUỘC 100% TIẾNG VIỆT TỰ NHIÊN. TUYỆT ĐỐI KHÔNG DÙNG CÂU CHUNG CHUNG "Mã nguồn mở được chia sẻ...".
3. Nêu ĐỐI TƯỢNG PHÙ HỢP (ví dụ: "AI Developers & Kỹ sư phần mềm", "Dân MMO & Auto", "Fullstack Dev", "DevOps & Sysadmin").

Trả về ĐÚNG JSON:
{"category": "string", "summary_vi": "string", "target_audience": "string"}`;

  const userPrompt = `Repo: ${meta.fullName}
Mô tả gốc: "${meta.description || "No description"}"
Topics: ${meta.topics?.join(", ") || "Không có"}
Ngôn ngữ: ${meta.language || "Không rõ"}`;

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const raw = data.result?.response || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.summary_vi && hasVietnameseDiacritics(parsed.summary_vi)) {
          return {
            category: parsed.category || "🛠️ Dev Tools & CLI",
            summary_vi: parsed.summary_vi.trim(),
            target_audience: parsed.target_audience || "Lập trình viên & Kỹ sư phần mềm",
          };
        }
      }
    }
  } catch {}

  // Fallback sang Google Translate GTX
  const viDesc = await translateWithGtx(meta.description);
  let category = "🛠️ Dev Tools & CLI";
  let target_audience = "Lập trình viên & Kỹ sư phần mềm";

  const combined = `${meta.fullName} ${meta.description} ${meta.topics?.join(" ")}`.toLowerCase();
  if (combined.includes("mcp") || combined.includes("model-context-protocol")) {
    category = "🔌 MCP & Skills";
    target_audience = "AI Engineers & Cursor/Claude Users";
  } else if (combined.includes("agent") || combined.includes("llm") || combined.includes("gpt") || combined.includes("chatgpt")) {
    category = "🤖 AI & Agents";
    target_audience = "AI Developers & Kỹ sư AI";
  } else if (combined.includes("download") || combined.includes("scrap") || combined.includes("crawl") || combined.includes("bot")) {
    category = "🕷️ Automation & Scraping";
    target_audience = "Dân MMO & Auto Data Collector";
  } else if (combined.includes("docker") || combined.includes("server") || combined.includes("infra")) {
    category = "🏠 Self-Hosted & Infra";
    target_audience = "DevOps & Sysadmin & Homelab";
  } else if (combined.includes("web") || combined.includes("react") || combined.includes("ui") || combined.includes("css")) {
    category = "🌐 Web & Fullstack";
    target_audience = "Frontend & Fullstack Developers";
  }

  const summary_vi = viDesc && viDesc !== "No description"
    ? viDesc
    : `Công cụ mã nguồn mở ${meta.fullName} hỗ trợ tối ưu hóa quy trình làm việc và phát triển phần mềm.`;

  return { category, summary_vi, target_audience };
}

/**
 * Cào HTML GitHub với parser đa năng (Title + innerText + Stargazers)
 */
async function scrapeGithubHtml(owner, repo) {
  const url = `https://github.com/${owner}/${repo}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 404) return { is404: true };
    if (!res.ok) return null;

    const html = await res.text();

    // 1. Tên repo chuẩn
    let canonicalFullName = `${owner}/${repo}`;
    const ogUrlMatch = html.match(/<meta\s+property="og:url"\s+content="https:\/\/github\.com\/([^"?#]+)"/i);
    if (ogUrlMatch && ogUrlMatch[1]?.includes("/")) {
      canonicalFullName = ogUrlMatch[1].trim();
    }

    // 2. Mô tả
    let description = "";
    const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    if (ogDescMatch && ogDescMatch[1]) {
      description = ogDescMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/^GitHub\s*-\s*[^:]+:\s*/i, "")
        .replace(/\s*-\s*GitHub$/i, "")
        .trim();
    }

    // 3. Số sao
    let stars = 0;
    const starExactMatch =
      html.match(/id="repo-stars-counter-star"[^>]*title="([\d,]+)"/i) ||
      html.match(/id="repo-stars-counter-star"[^>]*aria-label="(\d+)\s+users?\s+starred/i);

    if (starExactMatch && starExactMatch[1]) {
      stars = parseInt(starExactMatch[1].replace(/,/g, ""), 10);
    } else {
      const starInnerMatch = html.match(/id="repo-stars-counter-star"[^>]*>([^<]+)<\/span>/i);
      if (starInnerMatch && starInnerMatch[1]) {
        const valStr = starInnerMatch[1].toLowerCase().trim();
        if (valStr.endsWith("k")) stars = Math.round(parseFloat(valStr) * 1000);
        else if (valStr.endsWith("m")) stars = Math.round(parseFloat(valStr) * 1000000);
        else stars = parseInt(valStr.replace(/,/g, ""), 10) || 0;
      }
    }

    // 4. Forks
    let forks = 0;
    const forkExactMatch = html.match(/id="repo-network-counter"[^>]*title="([\d,]+)"/i);
    if (forkExactMatch && forkExactMatch[1]) {
      forks = parseInt(forkExactMatch[1].replace(/,/g, ""), 10);
    }

    // 5. Topics
    const topics = [];
    const topicRegex = /\/topics\/([a-zA-Z0-9_-]+)/g;
    let tMatch;
    while ((tMatch = topicRegex.exec(html)) !== null) {
      if (!topics.includes(tMatch[1])) topics.push(tMatch[1]);
    }

    // 6. Language
    let language = "";
    const langMatch =
      html.match(/itemprop="programmingLanguage">([^<]+)<\/span>/i) ||
      html.match(/<span\s+class="color-fg-default\s+text-bold\s+mr-1">([^<]+)<\/span>/i);
    if (langMatch && langMatch[1]) language = langMatch[1].trim();

    return {
      owner: canonicalFullName.split("/")[0] || owner,
      repo: canonicalFullName.split("/")[1] || repo,
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
 * Lấy metadata từ GitHub API trước, tự động fallback HTML scraper
 */
async function fetchGithubMetadata(owner, repo) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "ZaloBot-Enricher/1.0",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 404) {
      return { is404: true };
    }

    if (res.ok) {
      const d = await res.json();
      return {
        owner: d.owner?.login || owner,
        repo: d.name || repo,
        fullName: d.full_name || `${owner}/${repo}`,
        description: String(d.description || "").trim(),
        stars: Number(d.stargazers_count) || 0,
        forks: Number(d.forks_count) || 0,
        language: String(d.language || "").trim(),
        topics: Array.isArray(d.topics) ? d.topics : [],
        htmlUrl: d.html_url || `https://github.com/${owner}/${repo}`,
      };
    }
  } catch {}

  // Fallback sang HTML scraping
  return scrapeGithubHtml(owner, repo);
}

export async function enrichDatabaseRepos(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log("❌ Không tìm thấy database tại:", dbPath);
    return;
  }

  const db = new Database(dbPath);
  console.log(`\n🚀 Bắt đầu làm giàu dữ liệu GitHub cho: ${dbPath}`);

  const repos = db.prepare(`
    SELECT id, thread_id, full_name, owner, repo_name, description, stars, forks, language, category, summary_vi 
    FROM group_repos
    WHERE stars = 0 
       OR summary_vi LIKE '%Mã nguồn mở được thành viên chia sẻ%'
       OR description IS NULL 
       OR description = ''
    ORDER BY id ASC
  `).all();

  console.log(`📊 Tìm thấy ${repos.length} repo cần được xử lý / cập nhật sao & tóm tắt.`);

  const updateStmt = db.prepare(`
    UPDATE group_repos 
    SET full_name = ?, owner = ?, repo_name = ?, repo_url = ?, description = ?, 
        stars = ?, forks = ?, language = ?, category = ?, summary_vi = ?, 
        target_audience = ?, updated_at = ? 
    WHERE id = ?
  `);

  let successCount = 0;
  let deadCount = 0;

  // Xử lý song song theo cụm (Batch of 5)
  const BATCH_SIZE = 5;
  for (let i = 0; i < repos.length; i += BATCH_SIZE) {
    const batch = repos.slice(i, i + BATCH_SIZE);
    console.log(`\n⏳ Đang xử lý nhóm [${i + 1} - ${Math.min(i + BATCH_SIZE, repos.length)} / ${repos.length}]...`);

    const promises = batch.map(async (repo) => {
      try {
        const meta = await fetchGithubMetadata(repo.owner, repo.repo_name);

        if (!meta || meta.is404) {
          // Repo 404 (đã bị xóa, đổi tên hoặc riêng tư)
          updateStmt.run(
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
          console.log(`   ⚠️ [404 DEAD/PRIVATE] ${repo.full_name} -> Đã đánh dấu "📦 Lưu trữ / Riêng tư"`);
          deadCount++;
          return;
        }

        // Tạo tóm tắt và phân loại tiếng Việt
        const ai = await summarizeWithCloudflareAi(meta);

        updateStmt.run(
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

        console.log(`   ✅ [THÀNH CÔNG] ${meta.fullName} -> ★ ${meta.stars.toLocaleString()} | ${ai.category} | "${ai.summary_vi.slice(0, 50)}..."`);
        successCount++;
      } catch (err) {
        console.error(`   ❌ Lỗi xử lý ${repo.full_name}:`, err.message);
      }
    });

    await Promise.allSettled(promises);
    // Nghỉ nhẹ 300ms giữa các batch
    await new Promise((r) => setTimeout(r, 300));
  }

  db.close();
  console.log(`\n🎉 HOÀN TẤT: Đã cập nhật thành công ${successCount} repo hợp lệ, đánh dấu ${deadCount} repo 404/riêng tư!`);
}

// Nếu gọi trực tiếp từ CLI
if (process.argv[1]?.endsWith("enrich-all-repos.mjs")) {
  const targetDb = process.argv[2] || "/home/ubuntu/zalo-bot-2/bot/data/bot.db";
  enrichDatabaseRepos(targetDb).catch(console.error);
}

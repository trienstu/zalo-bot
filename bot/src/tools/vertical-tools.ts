/**
 * Vertical Tools for Zalo Bot Agent Loop.
 * Pure Node.js standard library (fetch, regex) - zero new npm dependencies.
 * Specialized vertical search: DuckDuckGo, Web Fetcher, Wikipedia, Hacker News, arXiv, GitHub.
 */

export interface SearchResultItem {
  title: string;
  snippet: string;
  url: string;
  date?: string;
}

/**
 * 1. Web Search siêu tốc kết hợp Wikipedia Search API + Google News RSS.
 * Hoàn toàn loại bỏ cào DuckDuckGo HTML để tránh nghẽn timeout 6 giây và lỗi Captcha Status 202 trên VPS.
 */
export async function webSearch(query: string, maxResults = 5): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];

  const isRealtimeOrSports = /(?:hôm nay|tối nay|sáng nay|chiều nay|mới nhất|vừa xong|24h|lịch thi đấu|tỉ số|kết quả|giá|trực tiếp|bóng đá|thể thao|đá banh|v-league|ngoại hạng anh|c1|champions league|la liga|serie a)/i.test(query);

  // 1.1. Tầng Google News RSS Search (Ưu tiên hàng đầu cho tin tức mới nhất, thể thao, lịch thi đấu, sự kiện thực tế - < 300ms)
  const fetchGoogleNews = async () => {
    try {
      const gUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=vi&gl=VN&ceid=VN:vi`;
      const gRes = await fetch(gUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
        },
        signal: AbortSignal.timeout(3000),
      });
      if (gRes.ok) {
        const xml = await gRes.text();
        const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
        for (const it of items.slice(0, 8)) {
          if (results.length >= maxResults) break;
          const block = it[1] || "";
          const tMatch = block.match(/<title>(.*?)<\/title>/i);
          const lMatch = block.match(/<link>(.*?)<\/link>/i);
          const rawTitle = tMatch && tMatch[1] ? tMatch[1].trim() : "";
          const rawUrl = lMatch && lMatch[1] ? lMatch[1].trim() : "";
          if (rawTitle && !results.some((r) => r.title === rawTitle)) {
            results.push({
              title: rawTitle,
              snippet: rawTitle,
              url: rawUrl,
            });
          }
        }
      }
    } catch {}
  };

  const fetchWikipedia = async () => {
    try {
      let cleanWikiQ = query
        .replace(/@\S+/g, "")
        .replace(/\b(?:check|kiểm tra|xem|tra cứu|hỏi|nhờ|cho anh|cho em|nay|hiện nay|ở|tại|có|bao nhiêu|những|các|là gì|như thế nào|thế nào|sen chúa|sen chua|mộc miên|moc mien|kevin|bot)\b/gi, " ")
        .replace(/[?.,!/\\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (/(?:tỉnh thành|tỉnh|thành phố).*?(?:việt nam|nước ta)|(?:việt nam|nước ta).*?(?:tỉnh thành|tỉnh|thành phố)/i.test(query)) {
        cleanWikiQ = "tỉnh thành Việt Nam";
      }

      const wikiUrl = `https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanWikiQ || query)}&utf8=&format=json`;
      const wRes = await fetch(wikiUrl, {
        headers: { "User-Agent": "ZaloBot/2.0 (contact@bahub.vn)" },
        signal: AbortSignal.timeout(2500),
      });
      if (wRes.ok) {
        const wData = (await wRes.json()) as any;
        const searchItems = wData?.query?.search || [];
        for (const it of searchItems.slice(0, 3)) {
          if (results.length >= maxResults) break;
          const rawSnippet = String(it.snippet || "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, "&")
            .replace(/\s+/g, " ")
            .trim();
          if (rawSnippet && !results.some((r) => r.title === it.title)) {
            results.push({
              title: it.title,
              snippet: rawSnippet,
              url: `https://vi.wikipedia.org/wiki/${encodeURIComponent(it.title)}`,
            });
          }
        }
      }
    } catch {}
  };

  if (isRealtimeOrSports) {
    // Với câu hỏi tin tức/thời gian thực/thể thao: Quét Google News RSS trước, không để Wikipedia lấn át lịch đấu
    await fetchGoogleNews();
    if (results.length < maxResults) {
      await fetchWikipedia();
    }
  } else {
    // Với câu hỏi khái niệm/bách khoa/định nghĩa: Tra cứu Wikipedia trước
    await fetchWikipedia();
    if (results.length < maxResults) {
      await fetchGoogleNews();
    }
  }

  if (results.length >= maxResults) {
    return results.slice(0, maxResults);
  }

  // 1.3. Fallback: VnExpress RSS (Cung cấp tóm tắt bài báo thực tế trong ngày, loại bỏ hoàn toàn Bing vì Bing bị lỗi tin cũ)
  try {
    let vnExpressFeed = "https://vnexpress.net/rss/tin-moi-nhat.rss";
    if (/(?:bất động sản|nhà đất|chung cư|dự án|đất đai|căn hộ|quy hoạch)/i.test(query)) {
      vnExpressFeed = "https://vnexpress.net/rss/bat-dong-san.rss";
    } else if (/(?:kinh doanh|kinh tế|chứng khoán|cổ phiếu|ngân hàng|doanh nghiệp|tài chính)/i.test(query)) {
      vnExpressFeed = "https://vnexpress.net/rss/kinh-doanh.rss";
    } else if (/(?:công nghệ|ai\b|mô hình|gpt|gemini|số hóa|chip|bán dẫn)/i.test(query)) {
      vnExpressFeed = "https://vnexpress.net/rss/so-hoa.rss";
    } else if (/(?:thế giới|quốc tế|chiến sự|nga|ukraine|mỹ|trung quốc)/i.test(query)) {
      vnExpressFeed = "https://vnexpress.net/rss/the-gioi.rss";
    } else if (/(?:thời sự|chính phủ|thủ tướng|bộ|luật|nghị định|giao thông)/i.test(query)) {
      vnExpressFeed = "https://vnexpress.net/rss/thoi-su.rss";
    }

    const vnRes = await fetch(vnExpressFeed, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)" },
    });

    if (vnRes.ok) {
      const xml = await vnRes.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
      const queryTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
      const STOP_WORDS = new Set([
        "các", "tại", "cho", "với", "trong", "của", "này", "việt", "nam",
        "những", "được", "người", "theo", "nhiều", "ngày", "năm", "tháng",
        "thông", "tin", "xem", "kiểm", "tra", "tổng", "dự", "án", "giúp",
        "nhé", "nha", "ạ", "em", "anh", "chị", "bác", "về", "lại", "đến",
        "mình", "hỏi", "đang", "cũng", "như", "nào"
      ]);
      const meaningfulTokens = queryTokens.filter((t) => !STOP_WORDS.has(t));
      const requiredTokens = meaningfulTokens.length > 0 ? meaningfulTokens : queryTokens;

      for (const it of items) {
        if (results.length >= maxResults) break;
        const block = it[1] || "";
        const tMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
        const dMatch = block.match(/<description>([\s\S]*?)<\/description>/i);
        const lMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
        const pMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

        const cleanStr = (s: string) =>
          s
            .replace(/<!\[CDATA\[/gi, "")
            .replace(/\]\]>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&amp;/g, "&")
            .replace(/\s+/g, " ")
            .trim();

        const title = tMatch && tMatch[1] ? cleanStr(tMatch[1]) : "";
        let snippet = dMatch && dMatch[1] ? cleanStr(dMatch[1]) : "";
        const url = lMatch && lMatch[1] ? lMatch[1].trim() : "";

        const isGeneral = /^(?:bất động sản|nhà đất|kinh tế|thời sự|tin tức|tin mới|công nghệ|thế giới)/i.test(query.trim());
        if (!isGeneral && requiredTokens.length > 0) {
          const combined = (title + " " + snippet).toLowerCase();
          const matchCount = requiredTokens.filter((tok) => combined.includes(tok)).length;
          const minMatches = requiredTokens.length >= 3 ? 2 : 1;
          if (matchCount < minMatches) continue;
        }

        let dateStr = "";
        if (pMatch && pMatch[1]) {
          const dt = new Date(pMatch[1]);
          if (!isNaN(dt.getTime())) {
            dateStr = dt.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
          }
        }

        if (title && !results.some((r) => r.title === title)) {
          results.push({
            title,
            snippet: snippet || (dateStr ? `[Tin ngày ${dateStr}] ${title}` : title),
            url,
            date: dateStr,
          });
        }
      }
    }
  } catch (vnErr) {
    // VnExpress error fallback
  }

  // 1.4. Fallback phụ: Google News RSS
  if (results.length < maxResults) {
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=vi&gl=VN&ceid=VN:vi`;
      const res = await fetch(rssUrl, {
        signal: AbortSignal.timeout(5000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
        },
      });

      if (res.ok) {
        const xml = await res.text();
        const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
        for (const it of items) {
          if (results.length >= maxResults) break;
          const block = it[1] || "";
          const tMatch = block.match(/<title>(.*?)<\/title>/i);
          const lMatch = block.match(/<link>(.*?)<\/link>/i) || block.match(/<link\/>(.*?)&/);
          const dMatch = block.match(/<pubDate>(.*?)<\/pubDate>/i);

          const title = (tMatch && tMatch[1] ? tMatch[1] : "")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, "&")
            .replace(/&#39;/g, "'")
            .trim();

          if (title && !results.some((r) => r.title === title)) {
            let dateStr = "";
            if (dMatch && dMatch[1]) {
              const dt = new Date(dMatch[1]);
              if (!isNaN(dt.getTime())) {
                dateStr = dt.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
              }
            }

            results.push({
              title,
              snippet: dateStr ? `[Tin ngày ${dateStr}] ${title}` : title,
              url: lMatch && lMatch[1] ? lMatch[1].trim() : "",
              date: dateStr,
            });
          }
        }
      }
    } catch (rssErr) {
      console.warn(`[vertical-tools] Fallback Google News RSS error for "${query}":`, rssErr);
    }
  }

  return results.slice(0, maxResults);
}

/**
 * 2. Fetch URL content and strip HTML
 * Cleans tags, scripts, styles, and extracts readable text up to maxChars.
 */
export async function fetchUrl(url: string, maxChars = 3000): Promise<{ title: string; content: string; url: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { title: "", content: `Không thể tải trang (HTTP ${res.status})`, url };
    }

    const html = await res.text();

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const rawTitle = titleMatch && titleMatch[1] ? titleMatch[1].trim() : "";

    // Loại bỏ scripts, styles, nav, header, footer, svg, noscript
    const cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      title: rawTitle,
      content: cleaned.slice(0, maxChars),
      url,
    };
  } catch (err: any) {
    return { title: "", content: `Lỗi đọc nội dung: ${err?.message || String(err)}`, url };
  }
}

/**
 * 3. Wikipedia REST API Lookup
 * Tra cứu tóm tắt bách khoa chuẩn xác, không spam SEO blog.
 */
export async function wikiLookup(query: string): Promise<{ title: string; extract: string; url: string; date?: string } | null> {
  const tryWiki = async (lang: "vi" | "en") => {
    try {
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json`;
      const res = await fetch(searchUrl, {
        headers: { "User-Agent": "ZaloBotAgent/2.0 (contact@bahub.vn)" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as any;
      if (data && Array.isArray(data[1]) && data[1][0]) {
        const pageTitle = String(data[1][0]);
        const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
        const sRes = await fetch(summaryUrl, {
          headers: { "User-Agent": "ZaloBotAgent/2.0 (contact@bahub.vn)" },
          signal: AbortSignal.timeout(5000),
        });
        if (!sRes.ok) return null;
        const sData = (await sRes.json()) as any;
        if (sData?.extract) {
          return {
            title: sData.title || pageTitle,
            extract: sData.extract,
            url: sData.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`,
            date: sData.timestamp ? new Date(sData.timestamp).toLocaleDateString("vi-VN") : undefined,
          };
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  // Thử tiếng Việt trước, nếu không thấy thì thử tiếng Anh
  const viRes = await tryWiki("vi");
  if (viRes && viRes.extract && viRes.extract.length > 50) return viRes;

  const enRes = await tryWiki("en");
  if (enRes) return enRes;

  return viRes;
}

/**
 * 4. Hacker News Algolia Search
 * Tìm kiếm tin tức công nghệ, AI, releases và thảo luận kỹ thuật từ Hacker News.
 */
export async function hnSearch(query: string, maxResults = 5): Promise<SearchResultItem[]> {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${maxResults}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "ZaloBotAgent/2.0" },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as any;
    const hits = data?.hits || [];

    return hits.map((hit: any) => {
      const title = hit.title || hit.story_title || "Hacker News Story";
      const storyUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const date = hit.created_at ? new Date(hit.created_at).toLocaleDateString("vi-VN") : "";
      const points = hit.points ? `${hit.points} pts` : "";
      const comments = hit.num_comments ? `${hit.num_comments} cmt` : "";
      const meta = [points, comments].filter(Boolean).join(", ");

      return {
        title,
        snippet: `${meta ? `[${meta}] ` : ""}${hit._highlightResult?.story_text?.value || title}`,
        url: storyUrl,
        date,
      };
    });
  } catch (err) {
    console.warn(`[vertical-tools] hnSearch error for "${query}":`, err);
    return [];
  }
}

/**
 * 5. arXiv Atom Search
 * Tra cứu bài báo khoa học, nghiên cứu AI/ML mới nhất.
 */
export async function arxivSearch(query: string, maxResults = 3): Promise<SearchResultItem[]> {
  try {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3500),
      headers: { "User-Agent": "ZaloBotAgent/2.0 (contact@bahub.vn)" },
    });
    if (res.ok) {
      const xml = await res.text();
      const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];

      const results: SearchResultItem[] = [];
      for (const entry of entries) {
        const content = entry[1] || "";
        const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/i);
        const summaryMatch = content.match(/<summary>([\s\S]*?)<\/summary>/i);
        const idMatch = content.match(/<id>([\s\S]*?)<\/id>/i);
        const publishedMatch = content.match(/<published>([\s\S]*?)<\/published>/i);

        const title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
        const summary = summaryMatch && summaryMatch[1] ? summaryMatch[1].replace(/\s+/g, " ").trim() : "";
        const paperUrl = idMatch && idMatch[1] ? idMatch[1].trim() : "";
        const published = publishedMatch && publishedMatch[1] ? publishedMatch[1].trim().slice(0, 10) : "";

        if (title) {
          results.push({
            title,
            snippet: summary.slice(0, 300) + (summary.length > 300 ? "..." : ""),
            url: paperUrl,
            date: published,
          });
        }
      }
      if (results.length > 0) return results;
    }
  } catch (err) {
    // Graceful fallback to web search on arXiv
  }

  // Fallback: Tìm bài báo arXiv qua DuckDuckGo
  return webSearch(`site:arxiv.org ${query}`, maxResults);
}

/**
 * 6. GitHub Search API
 * Tra cứu repo mã nguồn mở, releases, thư viện mới nhất.
 */
export async function githubSearch(query: string, maxResults = 3): Promise<SearchResultItem[]> {
  try {
    const headers: Record<string, string> = {
      "User-Agent": "ZaloBotAgent/2.0",
      "Accept": "application/vnd.github.v3+json",
    };
    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${maxResults}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers,
    });
    if (!res.ok) return [];

    const data = (await res.json()) as any;
    const items = data?.items || [];

    return items.map((repo: any) => {
      const updated = repo.updated_at ? repo.updated_at.slice(0, 10) : "";
      const stars = repo.stargazers_count ? `⭐ ${repo.stargazers_count.toLocaleString()}` : "";
      const lang = repo.language ? `[${repo.language}]` : "";

      return {
        title: repo.full_name || repo.name,
        snippet: `${[stars, lang].filter(Boolean).join(" ")}: ${repo.description || "No description provided."}`,
        url: repo.html_url,
        date: updated,
      };
    });
  } catch (err) {
    console.warn(`[vertical-tools] githubSearch error for "${query}":`, err);
    return [];
  }
}

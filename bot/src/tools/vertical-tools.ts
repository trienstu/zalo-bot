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
 * 1. Web Search via DuckDuckGo HTML endpoint
 * Returns rich 200-300 character snippets per result.
 */
export async function webSearch(query: string, maxResults = 5): Promise<SearchResultItem[]> {
  try {
    const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return [];
    const html = await res.text();

    const results: SearchResultItem[] = [];
    const blocks = html.split('<div class="result results_links');

    for (const block of blocks.slice(1)) {
      if (results.length >= maxResults) break;

      const urlMatch = block.match(/href="([^"]+uddg=([^"&]+)[^"]*)"/i) || block.match(/<a class="result__url"[^>]*href="([^"]+)"/i);
      const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

      let rawUrl = "";
      if (urlMatch) {
        if (urlMatch[2]) {
          try {
            rawUrl = decodeURIComponent(urlMatch[2]);
          } catch {
            rawUrl = urlMatch[2] || "";
          }
        } else {
          rawUrl = urlMatch[1] || "";
        }
      }

      const cleanText = (str: string) =>
        str
          .replace(/<[^>]+>/g, " ")
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&apos;/g, "'")
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const snippet = snippetMatch && snippetMatch[1] ? cleanText(snippetMatch[1]) : "";
      const titleMatch2 = block.match(/<a class="result__snippet"[^>]*title="([^"]+)"/i) ||
                          block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
      const title = titleMatch2 && titleMatch2[1] ? cleanText(titleMatch2[1]) : cleanText(snippet.slice(0, 60));

      if (snippet && rawUrl && !rawUrl.includes("duckduckgo.com")) {
        results.push({
          title: title || rawUrl,
          snippet,
          url: rawUrl,
        });
      }
    }

    return results;
  } catch (err) {
    console.warn(`[vertical-tools] webSearch error for "${query}":`, err);
    return [];
  }
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

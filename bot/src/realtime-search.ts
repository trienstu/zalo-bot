/**
 * Tra cứu tin tức & sự kiện thời gian thực từ Google News RSS.
 * Hoạt động 100% miễn phí, tốc độ cao (~200-300ms), không bị giới hạn quota hay lỗi 429 của Google AI Studio.
 */

function decodeXml(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export async function searchRealtimeNews(query: string): Promise<string> {
  try {
    // Làm sạch từ khóa (loại bỏ các từ giao tiếp, kính ngữ, đại từ)
    const cleanQ = query
      .replace(
        /(?:cập nhật|tình hình|mới nhất|tin tức|hôm nay|cho tôi|giúp tôi|với|nha|nhé|ạ|ơi|hỏi về|xem|tin nóng|vừa ra mắt|thời sự|bản tin|vừa công bố|thế nào rồi|có gì mới|cho biết)/gi,
        " "
      )
      .replace(/[?!,.:;"'()\[\]{}–—\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanQ || cleanQ.length < 2) return "";

    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQ)}&hl=vi&gl=VN&ceid=VN:vi`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
      },
    });

    if (!res.ok) return "";
    const xml = await res.text();
    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

    if (itemBlocks.length === 0) return "";

    const items = itemBlocks
      .map((block) => {
        const content = block[1] || "";
        const titleMatch = content.match(/<title>(.*?)<\/title>/i);
        const pubDateMatch = content.match(/<pubDate>(.*?)<\/pubDate>/i);
        const title = titleMatch && titleMatch[1] ? decodeXml(titleMatch[1].trim()) : "";
        const pubDate = pubDateMatch && pubDateMatch[1] ? pubDateMatch[1].trim() : "";
        return { title, pubDate };
      })
      .filter((it) => it.title.length > 0);

    if (items.length === 0) return "";

    return items
      .slice(0, 8)
      .map((item, idx) => `${idx + 1}. [${item.pubDate}] ${item.title}`)
      .join("\n");
  } catch (e) {
    console.warn("[realtime-search] Lỗi tra cứu tin tức:", e);
    return "";
  }
}

/**
 * Tra cứu tin tức & sự kiện thời gian thực từ Google News RSS.
 * Hoạt động 100% miễn phí, tốc độ cao (~200-300ms), không bị giới hạn quota hay lỗi 429 của Google AI Studio.
 * Hỗ trợ ép lọc chuẩn xác trong 24h qua (when:1d), lọc theo timestamp thực tế, và đa nguồn Việt Nam - Quốc tế.
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

interface ParsedNewsItem {
  title: string;
  timeLabel: string;
  timestamp: number;
  ageHours: number;
}

async function fetchGoogleNewsRss(keyword: string, lang: "vi" | "en" = "vi"): Promise<ParsedNewsItem[]> {
  try {
    const isEn = lang === "en";
    const hl = isEn ? "en-US" : "vi";
    const gl = isEn ? "US" : "VN";
    const ceid = isEn ? "US:en" : "VN:vi";
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
      },
    });

    if (!res.ok) return [];
    const xml = await res.text();
    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
    const now = Date.now();

    return itemBlocks
      .map((block) => {
        const content = block[1] || "";
        const titleMatch = content.match(/<title>(.*?)<\/title>/i);
        const pubDateMatch = content.match(/<pubDate>(.*?)<\/pubDate>/i);
        const title = titleMatch && titleMatch[1] ? decodeXml(titleMatch[1].trim()) : "";
        const rawDate = pubDateMatch && pubDateMatch[1] ? pubDateMatch[1].trim() : "";
        const dateObj = new Date(rawDate);
        const timestamp = !isNaN(dateObj.getTime()) ? dateObj.getTime() : 0;
        const ageHours = timestamp > 0 ? (now - timestamp) / (1000 * 60 * 60) : 999;

        let timeLabel = "";
        if (timestamp > 0) {
          const dStr = dateObj.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
          const tStr = dateObj.toLocaleTimeString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
            hour: "2-digit",
            minute: "2-digit",
          });
          if (ageHours < 1) {
            timeLabel = `Vừa xong (< 1 giờ trước - ${tStr} ngày ${dStr})`;
          } else if (ageHours < 24) {
            timeLabel = `${Math.round(ageHours)} giờ trước - ${tStr} ngày ${dStr}`;
          } else {
            timeLabel = `${Math.round(ageHours / 24)} ngày trước - ngày ${dStr}`;
          }
        } else {
          timeLabel = rawDate;
        }

        return { title, timeLabel, timestamp, ageHours };
      })
      .filter((it) => it.title.length > 0);
  } catch {
    return [];
  }
}

export async function searchRealtimeNews(query: string): Promise<string> {
  try {
    // Nhận biết yêu cầu khắt khe về tin tức trong ngày / 24h qua
    const is24hStrict = /(?:hôm nay|24h|24 giờ|vừa xong|mới nhất|tin nóng|vừa ra mắt|vừa công bố|gần đây|ngay lúc này|hiện tại|trong ngày)/i.test(
      query
    );

    // 1. Làm sạch từ khóa tìm kiếm (loại bỏ từ nối, kính ngữ nhưng không làm méo nghĩa)
    let cleanQ = query
      .replace(
        /(?:cập nhật|tình hình|mới nhất|tin tức|tin mới|hôm nay|24h qua|24h|24 giờ|cho tôi|giúp tôi|với|nha|nhé|ạ|ơi|hỏi về|xem|tin nóng|vừa ra mắt|thời sự|bản tin|vừa công bố|thế nào rồi|có gì mới|cho biết|đi|về|nào|coi|nói về|hãy)/gi,
        " "
      )
      .replace(/[?!,.:;"'()\[\]{}–—\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanQ || cleanQ.length < 2) return "";

    // 2. Nhận diện các nền tảng mạng xã hội hoặc nhân vật công nghệ
    const isSocialX =
      /\b(?:trên x|mạng xã hội x|trên twitter|x\.com|twitter)\b/i.test(query) ||
      /\bx\b/i.test(cleanQ);

    if (isSocialX) {
      cleanQ = cleanQ.replace(/\b(?:trên x|x)\b/gi, "").trim();
      cleanQ = `(Twitter OR X OR Grok OR xAI OR Elon Musk) ${cleanQ}`.trim();
    }

    const isTechAI = /(?:ai|mô hình|gpt|gemini|deepseek|claude|grok|openai|anthropic|công nghệ|twitter|elon musk)/i.test(
      cleanQ
    );

    // Sử dụng toán tử thời gian của Google: when:1d (trong 24h) hoặc when:2d
    const timeFilter = is24hStrict ? "when:1d" : "when:2d";

    // 3. Tạo truy vấn góc nhìn số 2 (hướng đích tìm số liệu, biến động)
    let secondaryQ = "";
    if (/(?:lũ|bão|sạt lở|thiên tai|tai nạn|cháy|nổ|động đất|thảm họa|dịch bệnh)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} người chết mất tích thiệt hại`;
    } else if (/(?:giá|vàng|chứng khoán|usd|ngoại tệ|xăng|dầu|bitcoin|crypto)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} giá biến động`;
    }

    // 4. Chạy truy vấn song song (Việt Nam + Quốc tế nếu là chủ đề Tech/AI)
    const fetchPromises: Promise<ParsedNewsItem[]>[] = [
      fetchGoogleNewsRss(`${cleanQ} ${timeFilter}`, "vi"),
    ];

    if (secondaryQ) {
      fetchPromises.push(fetchGoogleNewsRss(`${secondaryQ} ${timeFilter}`, "vi"));
    }

    if (isTechAI) {
      fetchPromises.push(fetchGoogleNewsRss(`${cleanQ} ${timeFilter}`, "en"));
    }

    const allResults = (await Promise.all(fetchPromises)).flat();

    // 5. Lọc chuẩn xác theo thời gian thực (pubDate timestamp)
    // Nếu yêu cầu 24h, chỉ giữ bài có ageHours <= 26 giờ (cho phép sai số lệch múi giờ 2h)
    let filtered = is24hStrict
      ? allResults.filter((r) => r.ageHours <= 26)
      : allResults.filter((r) => r.ageHours <= 72);

    // Nếu bộ lọc 24h bị rỗng vì từ khóa quá ngách, nới lỏng an toàn sang 48h
    if (filtered.length === 0) {
      filtered = allResults.filter((r) => r.ageHours <= 48);
    }

    if (filtered.length === 0) return "";

    // 6. Sắp xếp bài mới nhất lên đầu (timestamp giảm dần)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    // 7. Khử trùng lặp tiêu đề
    const seenTitles = new Set<string>();
    const mergedItems: ParsedNewsItem[] = [];

    for (const item of filtered) {
      const coreTitle = (item.title.split(/\s*-\s*[^-]+$/)[0] || item.title).trim().toLowerCase();
      if (!seenTitles.has(coreTitle)) {
        seenTitles.add(coreTitle);
        mergedItems.push(item);
      }
    }

    // 8. Trả về tối đa 25 bản tin phong phú và mới nhất
    return mergedItems
      .slice(0, 25)
      .map((item, idx) => `${idx + 1}. [${item.timeLabel}] ${item.title}`)
      .join("\n");
  } catch (e) {
    console.warn("[realtime-search] Lỗi tra cứu tin tức:", e);
    return "";
  }
}

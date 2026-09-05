/**
 * Tra cứu tin tức & sự kiện thời gian thực từ Google News RSS với kiến trúc 3 tầng thời gian:
 * - Tầng 1: Tin nóng trong ngày (24 giờ qua - when:1d)
 * - Tầng 2: Diễn biến gần đây (7 ngày qua - when:7d)
 * - Tầng 3: Toàn bộ kho lưu trữ lịch sử (Không giới hạn thời gian - All-time Relevance)
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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const isEn = lang === "en";
      const hl = isEn ? "en-US" : "vi";
      const gl = isEn ? "US" : "VN";
      const ceid = isEn ? "US:en" : "VN:vi";
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
        },
      });

      if (!res.ok) {
        if (attempt === 0) continue;
        return [];
      }
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
            } else if (ageHours < 24 * 7) {
              timeLabel = `${Math.round(ageHours / 24)} ngày trước - ngày ${dStr}`;
            } else {
              timeLabel = `Bài báo ngày ${dStr}`;
            }
          } else {
            timeLabel = rawDate;
          }

          return { title, timeLabel, timestamp, ageHours };
        })
        .filter((it) => it.title.length > 0);
    } catch {
      if (attempt === 0) continue;
      return [];
    }
  }
  return [];
}

/**
 * Thực hiện tìm kiếm Google News theo từ khóa và bộ lọc thời gian chỉ định (hoặc không giới hạn thời gian).
 */
async function queryNewsPipeline(
  cleanQ: string,
  timeFilter: string,
  isTechAI: boolean,
  secondaryQ = ""
): Promise<ParsedNewsItem[]> {
  const queryStr = timeFilter ? `${cleanQ} ${timeFilter}` : cleanQ;
  const fetchPromises: Promise<ParsedNewsItem[]>[] = [
    fetchGoogleNewsRss(queryStr, "vi"),
  ];

  if (secondaryQ) {
    const secStr = timeFilter ? `${secondaryQ} ${timeFilter}` : secondaryQ;
    fetchPromises.push(fetchGoogleNewsRss(secStr, "vi"));
  }

  if (isTechAI) {
    fetchPromises.push(fetchGoogleNewsRss(queryStr, "en"));
  }

  const allResults = (await Promise.all(fetchPromises)).flat();
  return allResults;
}

export async function searchRealtimeNews(query: string): Promise<string> {
  try {
    // 1. Phân loại nhu cầu thời gian từ câu hỏi
    const is24hStrict = /(?:hôm nay|24h|24 giờ|vừa xong|vừa ra mắt|vừa công bố|tin nóng|ngay lúc này|trong ngày|sáng nay|trưa nay|chiều nay|tối nay)/i.test(
      query
    );
    const is7dRecent = /(?:gần đây|mới nhất|tuần qua|tuần này|mới đây|dạo này|tiến độ|diễn biến|hiện tại|thế nào rồi)/i.test(
      query
    );

    // 2. Làm sạch từ khóa tìm kiếm
    let cleanQ = query
      .replace(/@[^\s,!?]+/g, " ")
      .replace(/(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot ơi|bot oi|bot|admin|ad ơi|ad oi|ad|trợ lý|tro ly)/gi, " ")
      .replace(/(?:là gì thế|là gì vậy|là gì nè|là gì|là cái gì|là con gì|là ai|thế nào|như thế nào|ra sao|nghĩa là gì|là sao)/gi, " ")
      .replace(
        /(?:cập nhật|tình hình|mới nhất|tin tức|tin mới|hôm nay|24h qua|24h|24 giờ|cho tôi|giúp tôi|với|nha|nhé|ạ|ơi|hỏi về|xem|tin nóng|vừa ra mắt|thời sự|bản tin|vừa công bố|thế nào rồi|có gì mới|cho biết|đi|về|nào|coi|nói về|hãy|tìm kiếm thêm thông tin về|tìm kiếm thêm thông tin|tìm kiếm thêm|tra cứu|xem có nội dung cụ thể|nội dung cụ thể|cái gì bị)/gi,
        " "
      )
      .replace(/[?!,.:;"'()\[\]{}–—\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanQ || cleanQ.length < 2) return "";

    // 3. Nhận diện nền tảng mạng xã hội hoặc nhân vật công nghệ
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

    // 4. Tạo truy vấn góc nhìn số 2 (hướng đích tìm số liệu, biến động)
    let secondaryQ = "";
    if (/(?:lũ|bão|sạt lở|thiên tai|tai nạn|cháy|nổ|động đất|thảm họa|dịch bệnh)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} người chết mất tích thiệt hại`;
    } else if (/(?:giá|vàng|chứng khoán|usd|ngoại tệ|xăng|dầu|bitcoin|crypto)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} giá biến động`;
    }

    // 5. KIẾN TRÚC PHÂN TẦNG THỜI GIAN (CASCADING 3-TIER SEARCH):
    let candidates: ParsedNewsItem[] = [];

    if (is24hStrict) {
      // TẦNG 1: Ép cứng 24h qua (when:1d)
      const res24h = await queryNewsPipeline(cleanQ, "when:1d", isTechAI, secondaryQ);
      candidates = res24h.filter((r) => r.ageHours <= 26);

      // Nếu tầng 24h không có tin nào, tự động thác đổ xuống Tầng 2 (7 ngày)
      if (candidates.length === 0) {
        const res7d = await queryNewsPipeline(cleanQ, "when:7d", isTechAI, secondaryQ);
        candidates = res7d.filter((r) => r.ageHours <= 7 * 24 + 6);
      }
    } else if (is7dRecent) {
      // TẦNG 2: Trong 7 ngày qua (when:7d)
      const res7d = await queryNewsPipeline(cleanQ, "when:7d", isTechAI, secondaryQ);
      candidates = res7d.filter((r) => r.ageHours <= 7 * 24 + 6);

      // Nếu tầng 7 ngày không có tin nào, thác đổ xuống Tầng 3 (Không giới hạn)
      if (candidates.length === 0) {
        candidates = await queryNewsPipeline(cleanQ, "", isTechAI, secondaryQ);
      }
    } else {
      // TẦNG 3: KHÔNG GIỚI HẠN THỜI GIAN (Mặc định cho các câu hỏi tra cứu thông tin/hồ sơ/sự việc)
      // Bỏ hoàn toàn tham số when: để Google News tìm trên toàn bộ kho lưu trữ lịch sử
      candidates = await queryNewsPipeline(cleanQ, "", isTechAI, secondaryQ);
    }

    if (candidates.length === 0) return "";

    // 6. Sắp xếp kết quả:
    // Nếu là câu hỏi thời sự 24h hoặc 7d: ưu tiên xếp bài mới nhất lên đầu
    // Nếu là Tầng 3 (Không giới hạn): giữ nguyên thứ tự Relevance của Google kết hợp độ mới
    if (is24hStrict || is7dRecent) {
      candidates.sort((a, b) => b.timestamp - a.timestamp);
    }

    // 7. Khử trùng lặp tiêu đề
    const seenTitles = new Set<string>();
    const mergedItems: ParsedNewsItem[] = [];

    for (const item of candidates) {
      const coreTitle = (item.title.split(/\s*-\s*[^-]+$/)[0] || item.title).trim().toLowerCase();
      if (!seenTitles.has(coreTitle)) {
        seenTitles.add(coreTitle);
        mergedItems.push(item);
      }
    }

    // 8. Trả về tối đa 25 bản tin kèm mốc thời gian xuất bản chi tiết
    return mergedItems
      .slice(0, 25)
      .map((item, idx) => `${idx + 1}. [${item.timeLabel}] ${item.title}`)
      .join("\n");
  } catch (e) {
    console.warn("[realtime-search] Lỗi tra cứu tin tức:", e);
    return "";
  }
}

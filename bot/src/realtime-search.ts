/**
 * Tra cứu tin tức & sự kiện thời gian thực từ Google News RSS.
 * Hoạt động 100% miễn phí, tốc độ cao (~200-300ms), không bị giới hạn quota hay lỗi 429 của Google AI Studio.
 * Tích hợp cơ chế tìm kiếm đa chiều (Multi-angle Search) để bắt trọn số liệu thương vong, thiệt hại, giá cả chính xác nhất.
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

interface NewsItem {
  title: string;
  pubDate: string;
}

async function fetchGoogleNewsRss(keyword: string): Promise<NewsItem[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=vi&gl=VN&ceid=VN:vi`;
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

    return itemBlocks
      .map((block) => {
        const content = block[1] || "";
        const titleMatch = content.match(/<title>(.*?)<\/title>/i);
        const pubDateMatch = content.match(/<pubDate>(.*?)<\/pubDate>/i);
        const title = titleMatch && titleMatch[1] ? decodeXml(titleMatch[1].trim()) : "";
        const rawDate = pubDateMatch && pubDateMatch[1] ? pubDateMatch[1].trim() : "";
        // Cắt bớt phần giờ GMT dài dòng để tiết kiệm token, chỉ giữ lại ngày tháng năm
        const pubDate = rawDate ? rawDate.replace(/\s+\d{2}:\d{2}:\d{2}\s+GMT$/i, "") : "";
        return { title, pubDate };
      })
      .filter((it) => it.title.length > 0);
  } catch {
    return [];
  }
}

export async function searchRealtimeNews(query: string): Promise<string> {
  try {
    // 1. Làm sạch từ khóa tìm kiếm (loại bỏ từ nối, kính ngữ)
    const cleanQ = query
      .replace(
        /(?:cập nhật|tình hình|mới nhất|tin tức|hôm nay|cho tôi|giúp tôi|với|nha|nhé|ạ|ơi|hỏi về|xem|tin nóng|vừa ra mắt|thời sự|bản tin|vừa công bố|thế nào rồi|có gì mới|cho biết)/gi,
        " "
      )
      .replace(/[?!,.:;"'()\[\]{}–—\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanQ || cleanQ.length < 2) return "";

    // 2. Tạo truy vấn góc nhìn số 2 (hướng đích tìm số liệu, thiệt hại, biến động)
    let secondaryQ = "";
    if (/(?:lũ|bão|sạt lở|thiên tai|tai nạn|cháy|nổ|động đất|thảm họa|dịch bệnh)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} người chết mất tích thiệt hại`;
    } else if (/(?:giá|vàng|chứng khoán|usd|ngoại tệ|xăng|dầu|bitcoin|crypto)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} giá hôm nay biến động`;
    } else if (/(?:ai|mô hình|gpt|gemini|deepseek|claude|công nghệ)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} công bố tính năng mới nhất`;
    } else {
      secondaryQ = `${cleanQ} mới nhất chi tiết`;
    }

    // 3. Thực thi song song cả 2 luồng tìm kiếm để có bức tranh toàn cảnh
    const [broadResults, deepResults] = await Promise.all([
      fetchGoogleNewsRss(cleanQ),
      secondaryQ ? fetchGoogleNewsRss(secondaryQ) : Promise.resolve([]),
    ]);

    // 4. Hợp nhất kết quả, ưu tiên các bài báo có số liệu cụ thể lên đầu, loại bỏ trùng lặp
    const seenTitles = new Set<string>();
    const mergedItems: NewsItem[] = [];

    // Đưa các bài báo chi tiết số liệu (deepResults) và bài báo tổng quan (broadResults) vào danh sách
    for (const item of [...deepResults, ...broadResults]) {
      // Chuẩn hóa tiêu đề để so trùng (bỏ tên báo phía sau gạch nối)
      const coreTitle = (item.title.split(/\s*-\s*[^-]+$/)[0] || item.title).trim().toLowerCase();
      if (!seenTitles.has(coreTitle)) {
        seenTitles.add(coreTitle);
        mergedItems.push(item);
      }
    }

    if (mergedItems.length === 0) return "";

    // 5. Trả về tối đa 25 bản tin phong phú nhất để Gemini nắm trọn số liệu thống kê
    return mergedItems
      .slice(0, 25)
      .map((item, idx) => `${idx + 1}. [${item.pubDate}] ${item.title}`)
      .join("\n");
  } catch (e) {
    console.warn("[realtime-search] Lỗi tra cứu tin tức:", e);
    return "";
  }
}

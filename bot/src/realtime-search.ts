/**
 * Tra cứu tin tức & sự kiện thời gian thực từ Google News RSS với kiến trúc 3 tầng thời gian:
 * - Tầng 1: Tin nóng trong ngày (24 giờ qua - when:1d)
 * - Tầng 2: Diễn biến gần đây (7 ngày qua - when:7d)
 * - Tầng 3: Toàn bộ kho lưu trữ lịch sử (Không giới hạn thời gian - All-time Relevance)
 * Kết hợp DuckDuckGo Web Search Snippets để bóc tách phát ngôn nguyên văn trong ngoặc kép và bối cảnh sự kiện.
 */

import { webSearch, SearchResultItem } from "./tools/vertical-tools.js";
import { getFinancialMarketSummary } from "./tools/finance-tools.js";

function decodeXmlAndHtml(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&agrave;/gi, "à")
    .replace(/&aacute;/gi, "á")
    .replace(/&atilde;/gi, "ã")
    .replace(/&acirc;/gi, "â")
    .replace(/&egrave;/gi, "è")
    .replace(/&eacute;/gi, "é")
    .replace(/&ecirc;/gi, "ê")
    .replace(/&igrave;/gi, "ì")
    .replace(/&iacute;/gi, "í")
    .replace(/&ograve;/gi, "ò")
    .replace(/&oacute;/gi, "ó")
    .replace(/&ocirc;/gi, "ô")
    .replace(/&otilde;/gi, "õ")
    .replace(/&ugrave;/gi, "ù")
    .replace(/&uacute;/gi, "ú")
    .replace(/&yacute;/gi, "ý")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

interface ParsedNewsItem {
  title: string;
  snippet?: string;
  timeLabel: string;
  timestamp: number;
  ageHours: number;
  url?: string;
}

export interface FeedSource {
  sourceName: string;
  url: string;
  lang: "vi" | "en";
}

const CATEGORY_FEEDS_REGISTRY: Record<string, FeedSource[]> = {
  "bat-dong-san": [
    { sourceName: "VnExpress", url: "https://vnexpress.net/rss/bat-dong-san.rss", lang: "vi" },
    { sourceName: "CafeF", url: "https://cafef.vn/bat-dong-san.rss", lang: "vi" },
    { sourceName: "VietnamNet", url: "https://vietnamnet.vn/rss/bat-dong-san.rss", lang: "vi" },
  ],
  "kinh-doanh": [
    { sourceName: "VnExpress", url: "https://vnexpress.net/rss/kinh-doanh.rss", lang: "vi" },
    { sourceName: "CafeF", url: "https://cafef.vn/thi-truong-chung-khoan.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ", url: "https://tuoitre.vn/rss/kinh-doanh.rss", lang: "vi" },
    { sourceName: "Thanh Niên", url: "https://thanhnien.vn/rss/kinh-te.rss", lang: "vi" },
    { sourceName: "VietnamNet", url: "https://vietnamnet.vn/rss/kinh-doanh.rss", lang: "vi" },
    { sourceName: "New York Times Business", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", lang: "en" },
  ],
  "so-hoa": [
    { sourceName: "VnExpress Số Hóa", url: "https://vnexpress.net/rss/so-hoa.rss", lang: "vi" },
    { sourceName: "The Verge", url: "https://theverge.com/rss/index.xml", lang: "en" },
    { sourceName: "TechCrunch", url: "https://techcrunch.com/feed/", lang: "en" },
    { sourceName: "BBC Tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", lang: "en" },
    { sourceName: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", lang: "en" },
  ],
  "the-gioi": [
    { sourceName: "VnExpress Thế Giới", url: "https://vnexpress.net/rss/the-gioi.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ Thế Giới", url: "https://tuoitre.vn/rss/the-gioi.rss", lang: "vi" },
    { sourceName: "Thanh Niên Thế Giới", url: "https://thanhnien.vn/rss/the-gioi.rss", lang: "vi" },
    { sourceName: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", lang: "en" },
    { sourceName: "The Guardian World", url: "https://www.theguardian.com/world/rss", lang: "en" },
    { sourceName: "New York Times World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", lang: "en" },
    { sourceName: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", lang: "en" },
  ],
  "thoi-su": [
    { sourceName: "VnExpress Thời Sự", url: "https://vnexpress.net/rss/thoi-su.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ Thời Sự", url: "https://tuoitre.vn/rss/thoi-su.rss", lang: "vi" },
    { sourceName: "Thanh Niên Thời Sự", url: "https://thanhnien.vn/rss/thoi-su.rss", lang: "vi" },
    { sourceName: "VietnamNet Thời Sự", url: "https://vietnamnet.vn/rss/thoi-su.rss", lang: "vi" },
  ],
  "crypto": [
    { sourceName: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", lang: "en" },
  ],
  "the-thao": [
    { sourceName: "VietnamNet Thể Thao", url: "https://vietnamnet.vn/rss/the-thao.rss", lang: "vi" },
    { sourceName: "VOV Thể Thao", url: "https://vov.vn/rss/the-thao.rss", lang: "vi" },
    { sourceName: "VnExpress Thể Thao", url: "https://vnexpress.net/rss/the-thao.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ Thể Thao", url: "https://tuoitre.vn/rss/the-thao.rss", lang: "vi" },
    { sourceName: "Thanh Niên Thể Thao", url: "https://thanhnien.vn/rss/the-thao.rss", lang: "vi" },
    { sourceName: "24h Bóng Đá", url: "https://www.24h.com.vn/upload/rss/bongda.rss", lang: "vi" },
    { sourceName: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml", lang: "en" },
  ],
  "xe-co": [
    { sourceName: "VnExpress Xe", url: "https://vnexpress.net/rss/oto-xe-may.rss", lang: "vi" },
    { sourceName: "Thanh Niên Xe", url: "https://thanhnien.vn/rss/xe.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ Xe", url: "https://tuoitre.vn/rss/xe.rss", lang: "vi" },
    { sourceName: "Motor1", url: "https://www.motor1.com/rss/news/all/", lang: "en" },
  ],
  "giai-tri": [
    { sourceName: "VnExpress Giải Trí", url: "https://vnexpress.net/rss/giai-tri.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ Giải Trí", url: "https://tuoitre.vn/rss/giai-tri.rss", lang: "vi" },
    { sourceName: "Thanh Niên Giải Trí", url: "https://thanhnien.vn/rss/giai-tri.rss", lang: "vi" },
    { sourceName: "BBC Entertainment", url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", lang: "en" },
  ],
  "suc-khoe": [
    { sourceName: "VnExpress Sức Khỏe", url: "https://vnexpress.net/rss/suc-khoe.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ Sức Khỏe", url: "https://tuoitre.vn/rss/suc-khoe.rss", lang: "vi" },
    { sourceName: "Thanh Niên Sức Khỏe", url: "https://thanhnien.vn/rss/suc-khoe.rss", lang: "vi" },
    { sourceName: "BBC Health", url: "https://feeds.bbci.co.uk/news/health/rss.xml", lang: "en" },
  ],
  "khoa-hoc": [
    { sourceName: "VnExpress Khoa Học", url: "https://vnexpress.net/rss/khoa-hoc.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ Khoa Học", url: "https://tuoitre.vn/rss/khoa-hoc.rss", lang: "vi" },
    { sourceName: "BBC Science", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", lang: "en" },
    { sourceName: "ScienceDaily", url: "https://www.sciencedaily.com/rss/all.xml", lang: "en" },
  ],
  "phap-luat": [
    { sourceName: "VnExpress Pháp Luật", url: "https://vnexpress.net/rss/phap-luat.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ Pháp Luật", url: "https://tuoitre.vn/rss/phap-luat.rss", lang: "vi" },
  ],
  "giao-duc": [
    { sourceName: "VnExpress Giáo Dục", url: "https://vnexpress.net/rss/giao-duc.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ Giáo Dục", url: "https://tuoitre.vn/rss/giao-duc.rss", lang: "vi" },
    { sourceName: "BBC Education", url: "https://feeds.bbci.co.uk/news/education/rss.xml", lang: "en" },
  ],
  "du-lich": [
    { sourceName: "VnExpress Du Lịch", url: "https://vnexpress.net/rss/du-lich.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ Du Lịch", url: "https://tuoitre.vn/rss/du-lich.rss", lang: "vi" },
  ],
  "tin-moi-nhat": [
    { sourceName: "VnExpress", url: "https://vnexpress.net/rss/tin-moi-nhat.rss", lang: "vi" },
    { sourceName: "Tuổi Trẻ", url: "https://tuoitre.vn/rss/tin-moi-nhat.rss", lang: "vi" },
  ],
};

export function detectNewsCategories(query: string): string[] {
  const cats: string[] = [];
  if (/(?:bất động sản|nhà đất|chung cư|dự án|đất đai|căn hộ|quy hoạch|mặt bằng|bds|shophouse|biệt thự|đất nền|khu đô thị|chủ đầu tư|mở bán|tiến độ|vinhomes|novaland|masterise|gamuda|eaton park|keppel|sun group|ecopark|nam long|đất xanh|hưng thịnh|khang điền)/i.test(query)) {
    cats.push("bat-dong-san");
  }
  if (/(?:kinh doanh|kinh tế|chứng khoán|cổ phiếu|ngân hàng|doanh nghiệp|tài chính|giá vàng|giá xăng|lãi suất|vn-index|thị trường tài chính|fed\b)/i.test(query)) {
    cats.push("kinh-doanh");
  }
  if (/(?:công nghệ|ai\b|mô hình|gpt|gemini|bán dẫn|chip|apple|iphone|macbook|số hóa|deepseek|claude|nintendo|switch|phần mềm|sora|openai|nvidia)/i.test(query)) {
    cats.push("so-hoa");
  }
  if (/(?:thể thao|bóng đá|đá banh|trận banh|lịch thi đấu|kết quả bóng đá|tỉ số|ngoại hạng anh|cúp c1|champions league|la liga|serie a|bundesliga|v-league|u23|world cup|cầu thủ|trận đấu|bảng xếp hạng bóng đá|trận cầu|derby)/i.test(query)) {
    cats.push("the-thao");
  }
  if (/(?:ô tô|xe máy|xe hơi|xe điện|vinfast|toyota|honda|hyundai|kia\b|mazda|ford|mercedes|bmw|audi|porsche|tesla|byd|bằng lái|đăng kiểm|giá xe|phạt nguội|môtô|xe tải)/i.test(query)) {
    cats.push("xe-co");
  }
  if (/(?:giải trí|showbiz|sao việt|nghệ sĩ|diễn viên|ca sĩ|phim\b|phim ảnh|rạp chiếu|oscar|grammy|cannes|venice|hoa hậu|blackpink|bts\b|taylor swift|concert|bài hát|mv\b|album|vpop|kpop)/i.test(query)) {
    cats.push("giai-tri");
  }
  if (/(?:sức khỏe|y tế|bệnh viện|bác sĩ|thuốc\b|dược phẩm|dịch bệnh|cúm|sốt xuất huyết|tiêm chủng|vắc xin|ung thư|dinh dưỡng|bảo hiểm y tế|bhyt|ngộ độc|triệu chứng)/i.test(query)) {
    cats.push("suc-khoe");
  }
  if (/(?:khoa học|vũ trụ|thiên văn|nasa|hố đen|sao hỏa|mặt trăng|trái đất|nhật thực|nguyệt thực|bão mặt trời|sinh vật|khảo cổ|hóa thạch|phát minh|biến đổi khí hậu)/i.test(query)) {
    cats.push("khoa-hoc");
  }
  if (/(?:pháp luật|hình sự|dân sự|án mạng|bắt giữ|khởi tố|điều tra|viện kiểm sát|tòa án|xét xử|lừa đảo|chiếm đoạt|đánh bạc|ma túy|tham nhũng|vụ án|công an)/i.test(query)) {
    cats.push("phap-luat");
  }
  if (/(?:giáo dục|tuyển sinh|điểm chuẩn|thi tốt nghiệp|thpt|đại học|học sinh|sinh viên|giáo viên|học phí|học bổng|du học|bộ giáo dục|trường học)/i.test(query)) {
    cats.push("giao-duc");
  }
  if (/(?:du lịch|điểm đến|khách sạn|resort|tour\b|vé máy bay|hộ chiếu|visa\b|đà lạt|phú quốc|nha trang|sa pa|vịnh hạ long|ẩm thực|món ăn|check-in)/i.test(query)) {
    cats.push("du-lich");
  }
  const isVnQuery = /(?:việt nam|tỉnh thành|hành chính|thành phố|thừa thiên|huế|hà nội|đà nẵng|tp\.?\s*hcm|hồ chí minh|sài gòn|cần thơ|hải phòng|bắc ninh|quảng ninh|đồng nai)/i.test(query);
  if (!isVnQuery && /\b(?:thế giới|quốc tế|chiến sự|nước nga|ukraine|nước mỹ|hoa kỳ|trung quốc|israel|iran|bầu cử|trump|putin|zelensky|nước đức|nước pháp|nhật bản|hàn quốc|triều tiên|trung đông|centcom)\b/i.test(query)) {
    cats.push("the-gioi");
  }
  if (/(?:thời sự|chính phủ|thủ tướng|quốc hội|bộ|ban hành|nghị quyết|nghị định|luật|giao thông|bão|lũ|sạt lở|thiên tai|tỉnh thành|hành chính)/i.test(query)) {
    cats.push("thoi-su");
  }
  if (/(?:crypto|bitcoin|btc|eth|solana|binance|tiền ảo|tiền điện tử|blockchain|web3)/i.test(query)) {
    cats.push("crypto");
  }
  if (cats.length === 0 && /(?:tin tức|tin mới|hôm nay|24h|nóng|thời sự)/i.test(query)) {
    cats.push("tin-moi-nhat");
  }
  return cats;
}

interface CachedFeed {
  fetchedAt: number;
  items: ParsedNewsItem[];
}

const RSS_MEMORY_CACHE = new Map<string, CachedFeed>();
const RSS_CACHE_TTL_MS = 8 * 60 * 1000; // 8 phút TTL trong RAM

async function fetchSingleRssFeed(source: FeedSource, timeoutMs = 2500): Promise<ParsedNewsItem[]> {
  const now = Date.now();
  const cached = RSS_MEMORY_CACHE.get(source.url);
  if (cached && now - cached.fetchedAt < RSS_CACHE_TTL_MS) {
    return cached.items;
  }

  try {
    const res = await fetch(source.url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const itemBlocks = [...xml.matchAll(/<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi)].slice(0, 30);

    const cleanStr = (s: string) =>
      decodeXmlAndHtml(
        s
          .replace(/<!\[CDATA\[/gi, "")
          .replace(/\]\]>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      );

    const items: ParsedNewsItem[] = [];

    for (const block of itemBlocks) {
      const content = block[1] || "";
      const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const descMatch =
        content.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
        content.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
        content.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
      const pubDateMatch =
        content.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
        content.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ||
        content.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);

      let title = titleMatch && titleMatch[1] ? cleanStr(titleMatch[1]) : "";
      let snippet = descMatch && descMatch[1] ? cleanStr(descMatch[1]) : "";

      if (title && !title.includes(source.sourceName)) {
        title = `${title} - ${source.sourceName}`;
      }

      const rawDate = pubDateMatch && pubDateMatch[1] ? pubDateMatch[1].trim() : "";
      let dateObj = new Date(rawDate);
      if (isNaN(dateObj.getTime()) || dateObj.getFullYear() < 100) {
        const fixed = rawDate.replace(/\b([0-9]{2})\b(?=\s+[0-9]{2}:)/, "20$1");
        dateObj = new Date(fixed);
      }

      const timestamp = !isNaN(dateObj.getTime()) ? dateObj.getTime() : now;
      const ageHours = (now - timestamp) / (1000 * 60 * 60);

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
      }

      const linkMatch =
        content.match(/<link[^>]*>([\s\S]*?)<\/link>/i) ||
        content.match(/<link[^>]*href=["']([^"']+)["']/i);
      const rawLink = linkMatch ? (linkMatch[1] || linkMatch[2] || "") : "";
      const url = rawLink ? cleanStr(rawLink) : "";

      if (title) {
        items.push({ title, snippet, timeLabel, timestamp, ageHours, url });
      }
    }

    RSS_MEMORY_CACHE.set(source.url, { fetchedAt: now, items });
    return items;
  } catch {
    return [];
  }
}

async function fetchMultiSourceRss(category: string, filterKeyword = ""): Promise<ParsedNewsItem[]> {
  const sources = CATEGORY_FEEDS_REGISTRY[category] || CATEGORY_FEEDS_REGISTRY["tin-moi-nhat"] || [];
  if (sources.length === 0) return [];

  const feedPromises = sources.map((src) => fetchSingleRssFeed(src, 2500));
  const settled = await Promise.allSettled(feedPromises);
  const allItems: ParsedNewsItem[] = [];

  for (const s of settled) {
    if (s.status === "fulfilled" && Array.isArray(s.value)) {
      allItems.push(...s.value);
    }
  }

  const STOP_WORDS = new Set([
    "các", "tại", "cho", "với", "trong", "của", "này", "việt", "nam",
    "những", "được", "người", "theo", "nhiều", "ngày", "năm", "tháng",
    "thông", "tin", "xem", "kiểm", "tra", "tổng", "dự", "án", "giúp",
    "nhé", "nha", "ạ", "em", "anh", "chị", "bác", "về", "lại", "đến",
    "cho", "mình", "hỏi", "đang", "cũng", "như", "nào"
  ]);

  const rawTokens = filterKeyword
    ? filterKeyword.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
    : [];
  const meaningfulTokens = rawTokens.filter((t) => !STOP_WORDS.has(t));
  if (category === "the-thao" && /(?:banh|bóng đá|lịch thi đấu|trận|kết quả)/i.test(filterKeyword)) {
    meaningfulTokens.push("bóng đá", "lịch thi đấu", "v-league", "ngoại hạng", "trực tiếp");
  }
  const filterTokens = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;

  if (filterTokens.length === 0) {
    return allItems;
  }

  return allItems.filter((item) => {
    const full = (item.title + " " + (item.snippet || "")).toLowerCase();
    return filterTokens.some((tok) => full.includes(tok));
  });
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

      const STOP_WORDS = new Set([
        "các", "tại", "cho", "với", "trong", "của", "này", "việt", "nam",
        "những", "được", "người", "theo", "nhiều", "ngày", "năm", "tháng",
        "thông", "tin", "xem", "kiểm", "tra", "tổng", "dự", "án", "giúp",
        "nhé", "nha", "ạ", "em", "anh", "chị", "bác", "về", "lại", "đến",
        "cho", "mình", "hỏi", "đang", "cũng", "như", "nào", "hôm", "nay", "mới", "nhất"
      ]);
      const rawTokens = keyword.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
      const meaningfulTokens = rawTokens.filter((t) => !STOP_WORDS.has(t));
      const filterTokens = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;

      return itemBlocks
        .map((block) => {
          const content = block[1] || "";
          const titleMatch = content.match(/<title>(.*?)<\/title>/i);
          const pubDateMatch = content.match(/<pubDate>(.*?)<\/pubDate>/i);
          const title = titleMatch && titleMatch[1] ? decodeXmlAndHtml(titleMatch[1].trim()) : "";
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

          const linkMatch = content.match(/<link>(.*?)<\/link>/i);
          const url = linkMatch && linkMatch[1] ? linkMatch[1].trim() : "";

          return { title, timeLabel, timestamp, ageHours, url };
        })
        .filter((it) => {
          if (it.title.length === 0) return false;
          if (filterTokens.length === 0) return true;
          const full = it.title.toLowerCase();
          return filterTokens.some((tok) => full.includes(tok));
        });
    } catch {
      if (attempt === 0) continue;
      return [];
    }
  }
  return [];
}

/**
 * Tra cứu tóm tắt bách khoa toàn thư từ Wikipedia API tiếng Việt (miễn phí, siêu tốc < 300ms)
 */
async function fetchWikipediaSummary(query: string): Promise<string> {
  try {
    let cleanWikiQ = query
      .replace(/@\S+/g, "")
      .replace(/\b(?:check|kiểm tra|xem|tra cứu|hỏi|nhờ|cho anh|cho em|nay|hiện nay|ở|tại|có|bao nhiêu|những|các|là gì|như thế nào|thế nào|sen chúa|sen chua|mộc miên|moc mien|kevin|bot)\b/gi, " ")
      .replace(/[?.,!/\\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Tối ưu hóa từ khóa thực thể bách khoa toàn thư
    if (/(?:tỉnh thành|tỉnh|thành phố).*?(?:việt nam|nước ta)|(?:việt nam|nước ta).*?(?:tỉnh thành|tỉnh|thành phố)/i.test(query)) {
      cleanWikiQ = "tỉnh thành Việt Nam";
    }

    const searchUrl = `https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanWikiQ || query)}&utf8=&format=json`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "ZaloBotEncyclopedia/1.0 (contact@bahub.vn)" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as any;
    const searchItems = (data?.query?.search || []) as Array<{ title: string; snippet: string }>;
    if (searchItems.length > 0) {
      // Ưu tiên bài viết mang tính tổng quan / danh sách / phân cấp hành chính
      const preferred =
        searchItems.find((it) =>
          it.title.startsWith("Đơn vị hành chính") ||
          it.title.startsWith("Phân cấp hành chính") ||
          it.title.startsWith("Tỉnh (Việt Nam)") ||
          it.title.includes("Sáp nhập") ||
          it.title.startsWith("Danh sách")
        ) || searchItems[0];

      if (!preferred) return "";
      const topTitle = String(preferred.title);
      const summaryUrl = `https://vi.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(topTitle)}&format=json`;
      const sRes = await fetch(summaryUrl, {
        headers: { "User-Agent": "ZaloBotEncyclopedia/1.0 (contact@bahub.vn)" },
        signal: AbortSignal.timeout(3000),
      });
      if (!sRes.ok) return "";
      const sData = (await sRes.json()) as any;
      const pages = sData?.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0] as any;
        if (page?.extract) {
          return `📖 DỮ LIỆU TỪ BÁCH KHOA TOÀN THƯ WIKIPEDIA (${page.title}):\n"${page.extract.slice(0, 1000)}"\n`;
        }
      }
    }
  } catch {}
  return "";
}

/**
 * Trích xuất bảng lịch thi đấu & kết quả bóng đá trực tiếp từ bài báo (VietNamNet, 24h, VOV...)
 */
async function fetchArticleScheduleTable(url: string): Promise<string> {
  if (!url || !url.startsWith("http")) return "";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
    if (tables.length > 0) {
      let out = "";
      for (const t of tables) {
        if (!/(?:trận đấu|v-league|ngoại hạng|la liga|serie a|bundesliga|vs\b|kênh trực tiếp|cúp|bóng đá)/i.test(t[0])) {
          continue;
        }
        const text = t[0]
          .replace(/<tr[^>]*>/gi, "\n")
          .replace(/<t[dh][^>]*>/gi, " | ")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/\n\s*\|\s*\n/g, "\n")
          .replace(/[ \t]+/g, " ")
          .trim();
        if (text.length > 30) {
          out += text + "\n\n";
          if (out.length > 1500) break;
        }
      }
      return out.trim();
    }
  } catch {}
  return "";
}

/**
 * Thực hiện tìm kiếm tin tức qua RSS đa nguồn (VnExpress, Tuổi Trẻ, CafeF, Thanh Niên, VietnamNet, The Verge, BBC...) + Google News RSS
 */
async function queryNewsPipeline(
  cleanQ: string,
  timeFilter: string,
  needEnglishSearch: boolean,
  secondaryQ = "",
  enQueryStr = "",
  categories: string[] = []
): Promise<ParsedNewsItem[]> {
  const queryStr = timeFilter ? `${cleanQ} ${timeFilter}` : cleanQ;
  const fetchPromises: Promise<ParsedNewsItem[]>[] = [
    fetchGoogleNewsRss(queryStr, "vi"),
  ];

  const hasSpecificEntity = /(?:vinhomes|novaland|masterise|keppel|sun group|flc|ecopark|vinfast|vietcombank|fpt|viettel|binance|btc|eth|apple|nvidia|trump|putin|biden|zelensky)/i.test(cleanQ);
  const isGeneralCategory = !hasSpecificEntity && (
    cleanQ.trim().length <= 4 ||
    /(?:bất động sản|nhà đất|chung cư|kinh tế|kinh doanh|tài chính|thời sự|tin tức|công nghệ|thế giới|thị trường)/i.test(cleanQ)
  );

  for (const cat of categories) {
    if (isGeneralCategory) {
      // Với câu hỏi tổng quan thị trường, lấy toàn bộ tin nóng mới nhất của chuyên mục từ các báo lớn (chứa tóm tắt nội dung 2-3 câu hoàn chỉnh)
      fetchPromises.push(fetchMultiSourceRss(cat));
    } else {
      // Với câu hỏi có từ khóa cụ thể, lọc tin RSS đa nguồn theo từ khóa
      fetchPromises.push(fetchMultiSourceRss(cat, cleanQ));
    }
  }

  if (secondaryQ) {
    const secStr = timeFilter ? `${secondaryQ} ${timeFilter}` : secondaryQ;
    fetchPromises.push(fetchGoogleNewsRss(secStr, "vi"));
  }

  // Quét thêm nguồn tiếng Anh nếu là chủ đề Công nghệ / AI hoặc Chính trị / Địa chính trị quốc tế
  if (needEnglishSearch && enQueryStr) {
    const enStr = timeFilter ? `${enQueryStr} ${timeFilter}` : enQueryStr;
    fetchPromises.push(fetchGoogleNewsRss(enStr, "en"));
  }

  const allResults = (await Promise.all(fetchPromises)).flat();
  return allResults;
}

export async function searchRealtimeNews(query: string): Promise<string> {
  try {
    // 1. Phân loại nhu cầu thời gian từ câu hỏi
    const is24hStrict = /(?:hôm nay|24h|24 giờ|vừa xong|vừa ra mắt|vừa công bố|vừa phát ngôn|vừa tuyên bố|tin nóng|ngay lúc này|trong ngày|sáng nay|trưa nay|chiều nay|tối nay|tỉ số đêm qua|kết quả đêm qua)/i.test(
      query
    );
    const is7dRecent = /(?:gần đây|mới nhất|tuần qua|tuần này|mới đây|dạo này|mới có|mới|tiến độ|diễn biến|hiện tại|thế nào rồi|khi nào ra|bao giờ ra|sắp ra|lộ trình|phát ngôn|phát biểu|tuyên bố|nói gì)/i.test(
      query
    );

    // 2. Làm sạch từ khóa tìm kiếm (bảo vệ ranh giới từ để không cắt xén các từ như bitcoin, coin)
    let cleanQ = (" " + query + " ")
      .replace(/@[^\s,!?]+/g, " ")
      .replace(/(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot ơi|bot oi|bot|admin|ad ơi|ad oi|ad|trợ lý|tro ly)/gi, " ")
      .replace(/(?:là gì thế|là gì vậy|là gì nè|là gì|là cái gì|là con gì|thế nào|như thế nào|ra sao|nghĩa là gì|là sao)/gi, " ");

    const conversationalStopWords = [
      "cho tôi", "giúp tôi", "với", "nha", "nhé", "ạ", "ơi", "hỏi về",
      "cho biết", "đi", "về", "nào", "coi", "nói về", "hãy",
      "tìm kiếm thêm thông tin về", "tìm kiếm thêm thông tin", "tìm kiếm thêm", "tra cứu",
      "xem có nội dung cụ thể", "nội dung cụ thể", "giùm", "dùm", "cho mình", "xem nào", "phân tích thêm"
    ];

    for (const w of conversationalStopWords) {
      const regex = new RegExp(`(^|\\s|[,.?!;:])${w.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?=\\s|[,.?!;:]|$)`, "gi");
      cleanQ = cleanQ.replace(regex, "$1 ");
    }

    cleanQ = cleanQ
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

    // 4. Nhận diện các lĩnh vực đa ngành (AI/Công nghệ, Chính trị/Địa chính trị thế giới, Tài chính, Thể thao, Xe cộ, Khoa học, Pháp lý...)
    const categories = detectNewsCategories(query);

    const isTechAI = /(?:ai\b|mô hình|gpt|gemini|deepseek|claude|grok|llama|mistral|sora|qwen|openai|anthropic|công nghệ|nvidia|apple|iphone|macbook|chip|bán dẫn|elon musk)/i.test(
      query
    );

    const isWorldPolitics = /(?:trump\b|biden\b|putin\b|harris\b|tập cận bình\b|xi jinping\b|zelensky\b|netanyahu\b|macron\b|scholz\b|kim jong un\b|chính trị\b|địa chính trị\b|thế giới\b|quốc tế\b|nhà trắng\b|white house\b|kremlin\b|lầu năm góc\b|pentagon\b|quốc hội mỹ\b|thượng đỉnh\b|bầu cử\b|tranh cử\b|tổng thống\b|thủ tướng\b|ngoại trưởng\b|chiến sự\b|xung đột\b|chiến tranh\b|đình chiến\b|ngừng bắn\b|thuế quan\b|áp thuế\b|trừng phạt\b|cấm vận\b|ukraine\b|nga\b|israel\b|gaza\b|hamas\b|hezbollah\b|iran\b|biển đỏ\b|houthi\b|nato\b|brics\b|liên hợp quốc\b|un\b|g7\b|g20\b|phát ngôn\b|tuyên bố\b|phát biểu\b)/i.test(
      query
    );

    const needEnglishSearch =
      isTechAI ||
      isWorldPolitics ||
      categories.includes("the-thao") ||
      categories.includes("xe-co") ||
      categories.includes("khoa-hoc") ||
      categories.includes("crypto");

    // Dịch ngữ nghĩa từ khóa sang tiếng Anh để quét song song nguồn Google News quốc tế (US/Global)
    let enQueryStr = "";
    if (isTechAI) {
      enQueryStr = cleanQ
        .replace(/(?:khi nào ra|bao giờ ra|khi nào có|bao giờ có|sắp ra|thời điểm phát hành|ngày ra mắt|lộ trình)/gi, "release date launch roadmap")
        .replace(/(?:so sánh|đối chiếu)/gi, "comparison vs")
        .replace(/(?:mới nhất|tin mới|cập nhật)/gi, "latest news update")
        .replace(/(?:đánh giá|review)/gi, "review benchmark")
        .replace(/(?:rò rỉ|tin đồn)/gi, "leaks rumors")
        .replace(/(?:mô hình|mo hinh)/gi, "model")
        .replace(/\s+/g, " ")
        .trim();
    } else if (isWorldPolitics) {
      enQueryStr = cleanQ
        .replace(/(?:ông|bà|ngài|tổng thống|chủ tịch|thủ tướng|ngoại trưởng)/gi, " ")
        .replace(/\btrump\b/gi, "Donald Trump")
        .replace(/\bbiden\b/gi, "Joe Biden")
        .replace(/\bputin\b/gi, "Vladimir Putin")
        .replace(/\bharris\b/gi, "Kamala Harris")
        .replace(/\bzelensky\b/gi, "Zelenskyy")
        .replace(/\bnetanyahu\b/gi, "Netanyahu")
        .replace(/(?:tập cận bình|xi jinping)/gi, "Xi Jinping")
        .replace(/(?:phát ngôn|tuyên bố|phát biểu|nói gì|tuyên bố gì|phát ngôn gì)/gi, "statement speech comments")
        .replace(/(?:áp thuế|thuế quan|đánh thuế)/gi, "tariffs")
        .replace(/(?:bầu cử|tranh cử)/gi, "election campaign")
        .replace(/(?:chiến sự|xung đột|chiến tranh)/gi, "war conflict")
        .replace(/(?:ngừng bắn|đình chiến)/gi, "ceasefire")
        .replace(/(?:trừng phạt|cấm vận)/gi, "sanctions")
        .replace(/(?:thượng đỉnh|hội đàm)/gi, "summit talks")
        .replace(/(?:nhà trắng)/gi, "White House")
        .replace(/(?:lầu năm góc)/gi, "Pentagon")
        .replace(/(?:mới nhất|tin mới|hôm nay|gần đây|vừa xong|mới có|mới)/gi, "latest news")
        .replace(/(?:cho biết|cho hay|thế nào|như thế nào|ra sao|là gì|cái gì)/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (enQueryStr && !/(?:news|statement|speech|latest|war|election|tariffs)/i.test(enQueryStr)) {
        enQueryStr = `${enQueryStr} latest statement news`;
      }
    }

    // 5. Tạo truy vấn bổ trợ theo từng mảng chuyên sâu
    let secondaryQ = "";
    if (/(?:lũ|bão|sạt lở|thiên tai|tai nạn|cháy|nổ|động đất|thảm họa|dịch bệnh)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} người chết mất tích thiệt hại`;
    } else if (/(?:giá|vàng|chứng khoán|usd|ngoại tệ|xăng|dầu|bitcoin|crypto|lãi suất|vn-index)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} giá biến động mới nhất`;
    } else if (/(?:bóng đá|đá banh|trận banh|trận đấu|tỉ số|kết quả|lịch thi đấu|lịch đấu|bảng xếp hạng|ngoại hạng anh|c1|champions league|v-league|la liga|serie a|bundesliga|ligue 1)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} lịch thi đấu kết quả bóng đá trực tiếp hôm nay`;
    } else if (/(?:ô tô|xe máy|xe hơi|xe điện|vinfast|toyota|honda|giá xe|đăng kiểm)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} giá bán thông số đánh giá`;
    } else if (/(?:sức khỏe|y tế|bệnh|thuốc|dịch bệnh|cúm|sốt xuất huyết)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} triệu chứng phòng ngừa điều trị`;
    } else if (/(?:khoa học|vũ trụ|thiên văn|nasa|sao hỏa)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} khám phá phát hiện mới nhất`;
    } else if (/(?:pháp luật|hình sự|khởi tố|điều tra|bắt giữ|vụ án|lừa đảo)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} khởi tố điều tra kết luận`;
    } else if (/(?:giáo dục|tuyển sinh|điểm chuẩn|thi tốt nghiệp|học phí)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} thông tin tuyển sinh mới nhất`;
    } else if (/(?:luật|thủ tục|nghị định|thông tư|sổ đỏ|vneid|cccd|thuế|phạt nguội)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} quy định mới nhất`;
    } else if (isWorldPolitics) {
      secondaryQ = `${cleanQ} phát ngôn tuyên bố mới nhất`;
    }

    // 6. KIẾN TRÚC PHÂN TẦNG THỜI GIAN (CASCADING 3-TIER SEARCH):
    let candidates: ParsedNewsItem[] = [];

    if (is24hStrict) {
      // TẦNG 1: Ép cứng 24h qua (when:1d)
      const res24h = await queryNewsPipeline(cleanQ, "when:1d", needEnglishSearch, secondaryQ, enQueryStr, categories);
      candidates = res24h.filter((r) => r.ageHours <= 26);

      // Nếu tầng 24h không có tin nào, tự động thác đổ xuống Tầng 2 (7 ngày)
      if (candidates.length === 0) {
        const res7d = await queryNewsPipeline(cleanQ, "when:7d", needEnglishSearch, secondaryQ, enQueryStr, categories);
        candidates = res7d.filter((r) => r.ageHours <= 7 * 24 + 6);
      }
    } else if (is7dRecent) {
      // TẦNG 2: Trong 7 ngày qua (when:7d)
      const res7d = await queryNewsPipeline(cleanQ, "when:7d", needEnglishSearch, secondaryQ, enQueryStr, categories);
      candidates = res7d.filter((r) => r.ageHours <= 7 * 24 + 6);

      // Nếu tầng 7 ngày không có tin nào, thác đổ xuống Tầng 3 (Không giới hạn)
      if (candidates.length === 0) {
        candidates = await queryNewsPipeline(cleanQ, "", needEnglishSearch, secondaryQ, enQueryStr, categories);
      }
    } else {
      // TẦNG 3: KHÔNG GIỚI HẠN THỜI GIAN (Mặc định cho các câu hỏi tra cứu thông tin/hồ sơ/sự việc)
      candidates = await queryNewsPipeline(cleanQ, "", needEnglishSearch, secondaryQ, enQueryStr, categories);
    }

    // 7. Tra cứu song song Bách khoa toàn thư Wikipedia nếu là câu hỏi khái niệm / danh nhân / lịch sử / địa danh / hành chính
    let wikiText = "";
    try {
      const isEncyclopedia = /(?:ai là|là ai|tiểu sử|nguồn gốc|lịch sử|năm nào|định nghĩa|khái niệm|nguyên lý|hiện tượng|tại sao lại|ý nghĩa của|chiến dịch|nhà văn|tác giả|diễn viên|tỉnh thành|thành phố|trung ương|đơn vị hành chính)/i.test(
        query
      );
      if (isEncyclopedia) {
        wikiText = await fetchWikipediaSummary(cleanQ);
      }
    } catch {}

    // 7.5. Lọc bỏ các tin lạc đề hoàn toàn không liên quan đến chủ đề đang hỏi (nếu có chuyên mục cụ thể)
    if (categories.includes("bat-dong-san")) {
      const bdsRegex = /(?:bất động sản|địa ốc|nhà đất|chung cư|đất đai|dự án|đô thị|căn hộ|vinhomes|novaland|mặt bằng|quy hoạch|xây dựng|nhà phố|biệt thự|thuê đất|bds)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return bdsRegex.test(it.title);
      });
    } else if (categories.includes("kinh-doanh")) {
      const kdRegex = /(?:kinh doanh|kinh tế|chứng khoán|cổ phiếu|ngân hàng|doanh nghiệp|tài chính|giá vàng|giá xăng|lãi suất|vn-index|thương mại|xuất khẩu|nhập khẩu|lợi nhuận|doanh thu)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return kdRegex.test(it.title);
      });
    } else if (categories.includes("so-hoa")) {
      const techRegex = /(?:công nghệ|ai\b|mô hình|gpt|gemini|bán dẫn|chip|apple|iphone|macbook|số hóa|deepseek|claude|phần mềm|smartphone|điện thoại|máy tính)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return techRegex.test(it.title);
      });
    } else if (categories.includes("the-thao")) {
      const sportRegex = /(?:thể thao|bóng đá|đá banh|lịch thi đấu|kết quả|tỉ số|trận|v-league|ngoại hạng anh|cúp|champions league|la liga|serie a|bundesliga|clb|đội tuyển|huấn luyện viên|cầu thủ)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return sportRegex.test(it.title);
      });
    } else if (categories.includes("xe-co")) {
      const carRegex = /(?:ô tô|xe máy|xe hơi|xe điện|vinfast|toyota|honda|hyundai|kia|mazda|ford|mercedes|bmw|audi|tesla|byd|bằng lái|đăng kiểm|giá xe|phạt nguội|xe)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return carRegex.test(it.title);
      });
    } else if (categories.includes("giai-tri")) {
      const entRegex = /(?:giải trí|showbiz|sao|nghệ sĩ|diễn viên|ca sĩ|phim|rạp|oscar|grammy|hoa hậu|blackpink|bts|taylor|concert|bài hát|mv|album|vpop|kpop|show)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return entRegex.test(it.title);
      });
    } else if (categories.includes("suc-khoe")) {
      const healthRegex = /(?:sức khỏe|y tế|bệnh viện|bác sĩ|thuốc|dược|dịch|cúm|sốt|tiêm|vắc xin|ung thư|dinh dưỡng|bhyt|ngộ độc|bệnh)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return healthRegex.test(it.title);
      });
    } else if (categories.includes("khoa-hoc")) {
      const sciRegex = /(?:khoa học|vũ trụ|thiên văn|nasa|sao hỏa|mặt trăng|nhật thực|nguyệt thực|sinh vật|khảo cổ|phát minh|khí hậu|môi trường|nghiên cứu)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return sciRegex.test(it.title);
      });
    } else if (categories.includes("phap-luat")) {
      const lawRegex = /(?:pháp luật|hình sự|án|bắt|khởi tố|điều tra|kiểm sát|tòa|xét xử|lừa đảo|chiếm đoạt|đánh bạc|ma túy|tham nhũng|công an|vi phạm)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return lawRegex.test(it.title);
      });
    } else if (categories.includes("giao-duc")) {
      const eduRegex = /(?:giáo dục|tuyển sinh|điểm chuẩn|thi|thpt|đại học|học sinh|sinh viên|giáo viên|học phí|học bổng|du học|trường)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return eduRegex.test(it.title);
      });
    } else if (categories.includes("du-lich")) {
      const tourRegex = /(?:du lịch|điểm đến|khách sạn|resort|tour|vé máy bay|hộ chiếu|visa|đà lạt|phú quốc|nha trang|sa pa|vịnh hạ long|ẩm thực|món|check-in)/i;
      candidates = candidates.filter((it) => {
        if (it.snippet && it.snippet.length > 25) return true;
        return tourRegex.test(it.title);
      });
    }

    // 8. Sắp xếp kết quả: ưu tiên các bản tin có tóm tắt chi tiết (snippet), sau đó đến độ mới (timestamp)
    candidates.sort((a, b) => {
      const aHasSnippet = a.snippet && a.snippet.length > 25 ? 1 : 0;
      const bHasSnippet = b.snippet && b.snippet.length > 25 ? 1 : 0;
      if (bHasSnippet !== aHasSnippet) return bHasSnippet - aHasSnippet;
      return b.timestamp - a.timestamp;
    });

    // 9. Khử trùng lặp tiêu đề, ưu tiên giữ lại bản ghi có tóm tắt snippet
    const titleMap = new Map<string, ParsedNewsItem>();
    for (const item of candidates) {
      const coreTitle = (item.title.split(/\s*-\s*[^-]+$/)[0] || item.title).trim().toLowerCase();
      const existing = titleMap.get(coreTitle);
      if (!existing) {
        titleMap.set(coreTitle, item);
      } else if (!existing.snippet && item.snippet) {
        titleMap.set(coreTitle, item);
      }
    }
    const mergedItems = Array.from(titleMap.values());

    // 10. Luôn luôn trích xuất dữ liệu web chuyên sâu & bách khoa qua DuckDuckGo Web Search Snippets
    let richSnippetsText = "";
    try {
      const snippetQueries: string[] = [cleanQ];

      if (isWorldPolitics) {
        snippetQueries.push(`${cleanQ} phát ngôn tuyên bố mới nhất 2026`);
      }

      // Query tiếng Anh nếu cần thiết cho mảng thế giới / AI công nghệ
      if (needEnglishSearch && enQueryStr) {
        snippetQueries.push(enQueryStr);
      }

      // Chỉ lấy thêm tiêu đề từ mergedItems nếu là câu hỏi tin tức thế giới/chính trị
      if (isWorldPolitics) {
        for (const item of mergedItems.slice(0, 3)) {
          const rawTitle = item.title.split(/\s*-\s*[^-]+$/)[0]?.trim();
          if (rawTitle && rawTitle.length > 10 && !snippetQueries.some((q) => q.includes(rawTitle.slice(0, 20)))) {
            snippetQueries.push(rawTitle);
            if (snippetQueries.length >= 4) break;
          }
        }
      }

      const snippetResults = await Promise.allSettled(
        snippetQueries.map((q) => webSearch(q, 4))
      );

      const collectedSnippets: SearchResultItem[] = [];
      const seenSnippets = new Set<string>();

      for (const res of snippetResults) {
        if (res.status === "fulfilled" && Array.isArray(res.value)) {
          for (const item of res.value) {
            const snippetClean = item.snippet.replace(/\s+/g, " ").trim();
            if (snippetClean.length > 25 && !seenSnippets.has(snippetClean.slice(0, 50))) {
              seenSnippets.add(snippetClean.slice(0, 50));
              collectedSnippets.push({
                ...item,
                snippet: snippetClean,
              });
              if (collectedSnippets.length >= 8) break;
            }
          }
        }
        if (collectedSnippets.length >= 8) break;
      }

      if (collectedSnippets.length > 0) {
        const snippetLines = collectedSnippets
          .map((item, idx) => {
            let domain = "";
            try {
              domain = new URL(item.url).hostname.replace(/^www\./, "");
            } catch {
              domain = item.url;
            }
            return `${idx + 1}. [Nguồn: ${domain} | Tiêu đề: ${item.title}]\n   "${item.snippet}"`;
          })
          .join("\n\n");

        richSnippetsText = `🔥 TRÍCH DẪN & DỮ LIỆU THỰC TẾ TỪ BÁO CHÍ VÀ VĂN BẢN CHÍNH THỨC:\n${snippetLines}`;
      }
    } catch (err) {
      console.warn("[realtime-search] Lỗi bóc tách snippet:", err);
    }

    // Nếu cả Wikipedia, DuckDuckGo snippets và tin tức đều không có gì: trả về rỗng
    if (!wikiText && !richSnippetsText && mergedItems.length === 0) return "";

    const sections: string[] = [];

    // 10.4. Nếu hỏi về bóng đá / lịch thi đấu, tự động trích xuất bảng lịch thi đấu chi tiết từ bài báo thể thao
    const isAskingSportsSchedule =
      categories.includes("the-thao") ||
      /(?:lịch thi đấu|lịch đấu|trận banh|đá banh|bóng đá|trận đấu|kết quả bóng đá|tỉ số|ngoại hạng anh|v-league|cúp c1|la liga|serie a|bundesliga)/i.test(query);

    if (isAskingSportsSchedule) {
      const scheduleCandidates = mergedItems.filter(
        (it) => it.url && /lịch thi đấu|lich-thi-dau|bóng đá hôm nay/i.test(it.title + " " + (it.url || ""))
      );

      scheduleCandidates.sort((a, b) => {
        const aToday = /hôm nay|bóng đá hôm nay/i.test(a.title) ? 1 : 0;
        const bToday = /hôm nay|bóng đá hôm nay/i.test(b.title) ? 1 : 0;
        return bToday - aToday;
      });

      let scheduleTable = "";
      for (const cand of scheduleCandidates) {
        if (cand.url) {
          scheduleTable = await fetchArticleScheduleTable(cand.url);
          if (scheduleTable) {
            sections.unshift(`⚽ LỊCH THI ĐẤU & CÁC CẶP ĐẤU BÓNG ĐÁ CHI TIẾT (Trích xuất từ ${cand.title}):\n${scheduleTable}`);
            break;
          }
        }
      }

      if (!scheduleTable) {
        try {
          const vnNetFeed = await fetchSingleRssFeed({
            sourceName: "VietnamNet Thể Thao",
            url: "https://vietnamnet.vn/rss/the-thao.rss",
            lang: "vi",
          });
          const vnNetSchedule = vnNetFeed.find((it) => /lịch thi đấu/i.test(it.title));
          if (vnNetSchedule?.url) {
            scheduleTable = await fetchArticleScheduleTable(vnNetSchedule.url);
            if (scheduleTable) {
              sections.unshift(`⚽ LỊCH THI ĐẤU & CÁC CẶP ĐẤU BÓNG ĐÁ CHI TIẾT (Trích xuất từ Báo Thể Thao):\n${scheduleTable}`);
            }
          }
        } catch {}
      }
    }

    // 10.5. Nếu liên quan đến crypto / tài chính / tỷ giá, tiêm bảng giá trực tiếp Binance
    try {
      const marketSummary = await getFinancialMarketSummary(query);
      if (marketSummary) {
        sections.push(marketSummary);
      }
    } catch (mErr) {
      console.warn("[realtime-search] Lỗi lấy market summary:", mErr);
    }

    if (wikiText) sections.push(wikiText);
    if (richSnippetsText) sections.push(richSnippetsText);

    const isAskingNews = /(?:tin tức|tin mới|hôm nay|24h|nóng|thời sự|vừa xảy ra|diễn biến mới|trận banh|đá banh|bóng đá|thể thao)/i.test(query);
    if (mergedItems.length > 0 && (isAskingNews || categories.length > 0 || !richSnippetsText)) {
      const newsLines = mergedItems
        .slice(0, 10)
        .map((item, idx) => {
          const snippetPart =
            item.snippet && item.snippet !== item.title
              ? `\n   - Tóm tắt diễn biến: ${item.snippet}`
              : "";
          return `${idx + 1}. [${item.timeLabel}] ${item.title}${snippetPart}`;
        })
        .join("\n\n");
      sections.push(`📰 DANH SÁCH BẢN TIN THỜI SỰ LIÊN QUAN:\n${newsLines}`);
    }

    return sections.join("\n\n");
  } catch (e) {
    console.warn("[realtime-search] Lỗi tra cứu tin tức:", e);
    return "";
  }
}

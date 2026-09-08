/**
 * Tra cứu tin tức & sự kiện thời gian thực từ Google News RSS với kiến trúc 3 tầng thời gian:
 * - Tầng 1: Tin nóng trong ngày (24 giờ qua - when:1d)
 * - Tầng 2: Diễn biến gần đây (7 ngày qua - when:7d)
 * - Tầng 3: Toàn bộ kho lưu trữ lịch sử (Không giới hạn thời gian - All-time Relevance)
 * Kết hợp DuckDuckGo Web Search Snippets để bóc tách phát ngôn nguyên văn trong ngoặc kép và bối cảnh sự kiện.
 */

import { webSearch, SearchResultItem } from "./tools/vertical-tools.js";

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
 * Tra cứu tóm tắt bách khoa toàn thư từ Wikipedia API tiếng Việt (miễn phí, siêu tốc < 300ms)
 */
async function fetchWikipediaSummary(query: string): Promise<string> {
  try {
    const searchUrl = `https://vi.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "ZaloBotEncyclopedia/1.0 (contact@bahub.vn)" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as any;
    if (data && Array.isArray(data[1]) && data[1][0]) {
      const pageTitle = String(data[1][0]);
      const summaryUrl = `https://vi.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
      const sRes = await fetch(summaryUrl, {
        headers: { "User-Agent": "ZaloBotEncyclopedia/1.0 (contact@bahub.vn)" },
        signal: AbortSignal.timeout(3000),
      });
      if (!sRes.ok) return "";
      const sData = (await sRes.json()) as any;
      if (sData?.extract) {
        return `📖 DỮ LIỆU TỪ BÁCH KHOA TOÀN THƯ WIKIPEDIA (${sData.title}):\n"${sData.extract.slice(0, 700)}"\n`;
      }
    }
  } catch {}
  return "";
}

/**
 * Thực hiện tìm kiếm Google News theo từ khóa và bộ lọc thời gian chỉ định (hoặc không giới hạn thời gian).
 */
async function queryNewsPipeline(
  cleanQ: string,
  timeFilter: string,
  needEnglishSearch: boolean,
  secondaryQ = "",
  enQueryStr = ""
): Promise<ParsedNewsItem[]> {
  const queryStr = timeFilter ? `${cleanQ} ${timeFilter}` : cleanQ;
  const fetchPromises: Promise<ParsedNewsItem[]>[] = [
    fetchGoogleNewsRss(queryStr, "vi"),
  ];

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

    // 2. Làm sạch từ khóa tìm kiếm
    let cleanQ = query
      .replace(/@[^\s,!?]+/g, " ")
      .replace(/(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot ơi|bot oi|bot|admin|ad ơi|ad oi|ad|trợ lý|tro ly)/gi, " ")
      .replace(/(?:là gì thế|là gì vậy|là gì nè|là gì|là cái gì|là con gì|thế nào|như thế nào|ra sao|nghĩa là gì|là sao)/gi, " ")
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

    // 4. Nhận diện các lĩnh vực đa ngành (AI/Công nghệ, Chính trị/Địa chính trị thế giới, Tài chính, Thể thao, Pháp lý, Bách khoa)
    const isTechAI = /(?:ai\b|mô hình|gpt|gemini|deepseek|claude|grok|llama|mistral|sora|qwen|openai|anthropic|công nghệ|nvidia|apple|iphone|macbook|chip|bán dẫn|elon musk)/i.test(
      query
    );

    const isWorldPolitics = /(?:trump\b|biden\b|putin\b|harris\b|tập cận bình\b|xi jinping\b|zelensky\b|netanyahu\b|macron\b|scholz\b|kim jong un\b|chính trị\b|địa chính trị\b|thế giới\b|quốc tế\b|nhà trắng\b|white house\b|kremlin\b|lầu năm góc\b|pentagon\b|quốc hội mỹ\b|thượng đỉnh\b|bầu cử\b|tranh cử\b|tổng thống\b|thủ tướng\b|ngoại trưởng\b|chiến sự\b|xung đột\b|chiến tranh\b|đình chiến\b|ngừng bắn\b|thuế quan\b|áp thuế\b|trừng phạt\b|cấm vận\b|ukraine\b|nga\b|israel\b|gaza\b|hamas\b|hezbollah\b|iran\b|biển đỏ\b|houthi\b|nato\b|brics\b|liên hợp quốc\b|un\b|g7\b|g20\b|phát ngôn\b|tuyên bố\b|phát biểu\b)/i.test(
      query
    );

    const needEnglishSearch = isTechAI || isWorldPolitics;

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
    } else if (/(?:bóng đá|tỉ số|kết quả|lịch thi đấu|bảng xếp hạng|ngoại hạng anh|c1|champions league|v-league)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} kết quả tỉ số bảng xếp hạng`;
    } else if (/(?:luật|thủ tục|nghị định|thông tư|sổ đỏ|vneid|cccd|thuế|phạt nguội)/i.test(cleanQ)) {
      secondaryQ = `${cleanQ} quy định mới nhất`;
    } else if (isWorldPolitics) {
      secondaryQ = `${cleanQ} phát ngôn tuyên bố mới nhất`;
    }

    // 6. KIẾN TRÚC PHÂN TẦNG THỜI GIAN (CASCADING 3-TIER SEARCH):
    let candidates: ParsedNewsItem[] = [];

    if (is24hStrict) {
      // TẦNG 1: Ép cứng 24h qua (when:1d)
      const res24h = await queryNewsPipeline(cleanQ, "when:1d", needEnglishSearch, secondaryQ, enQueryStr);
      candidates = res24h.filter((r) => r.ageHours <= 26);

      // Nếu tầng 24h không có tin nào, tự động thác đổ xuống Tầng 2 (7 ngày)
      if (candidates.length === 0) {
        const res7d = await queryNewsPipeline(cleanQ, "when:7d", needEnglishSearch, secondaryQ, enQueryStr);
        candidates = res7d.filter((r) => r.ageHours <= 7 * 24 + 6);
      }
    } else if (is7dRecent) {
      // TẦNG 2: Trong 7 ngày qua (when:7d)
      const res7d = await queryNewsPipeline(cleanQ, "when:7d", needEnglishSearch, secondaryQ, enQueryStr);
      candidates = res7d.filter((r) => r.ageHours <= 7 * 24 + 6);

      // Nếu tầng 7 ngày không có tin nào, thác đổ xuống Tầng 3 (Không giới hạn)
      if (candidates.length === 0) {
        candidates = await queryNewsPipeline(cleanQ, "", needEnglishSearch, secondaryQ, enQueryStr);
      }
    } else {
      // TẦNG 3: KHÔNG GIỚI HẠN THỜI GIAN (Mặc định cho các câu hỏi tra cứu thông tin/hồ sơ/sự việc)
      candidates = await queryNewsPipeline(cleanQ, "", needEnglishSearch, secondaryQ, enQueryStr);
    }

    // 7. Tra cứu song song Bách khoa toàn thư Wikipedia nếu là câu hỏi khái niệm / danh nhân / lịch sử
    const isEncyclopedia = /(?:ai là|là ai|tiểu sử|nguồn gốc|lịch sử|năm nào|định nghĩa|khái niệm|nguyên lý|hiện tượng|tại sao lại|ý nghĩa của|chiến dịch|nhà văn|tác giả|diễn viên)/i.test(
      query
    );
    let wikiText = "";
    if (isEncyclopedia) {
      wikiText = await fetchWikipediaSummary(cleanQ);
    }

    if (candidates.length === 0 && !wikiText) return "";

    // 8. Sắp xếp kết quả:
    if (is24hStrict || is7dRecent) {
      candidates.sort((a, b) => b.timestamp - a.timestamp);
    }

    // 9. Khử trùng lặp tiêu đề
    const seenTitles = new Set<string>();
    const mergedItems: ParsedNewsItem[] = [];

    for (const item of candidates) {
      const coreTitle = (item.title.split(/\s*-\s*[^-]+$/)[0] || item.title).trim().toLowerCase();
      if (!seenTitles.has(coreTitle)) {
        seenTitles.add(coreTitle);
        mergedItems.push(item);
      }
    }

    // 10. Trích xuất trích dẫn nguyên văn & bối cảnh chuyên sâu qua DuckDuckGo Web Search Snippets
    let richSnippetsText = "";
    const needsDeepSnippets =
      isWorldPolitics ||
      isTechAI ||
      /(?:phát ngôn|phát biểu|tuyên bố|nói gì|đánh giá|nhận định|chi tiết|nguyên văn|lý do|tại sao|vụ việc|bê bối|scandal|hôm nay|24h|mới nhất|tình hình|diễn biến)/i.test(
        query
      );

    if (needsDeepSnippets) {
      try {
        const snippetQueries: string[] = [];

        // Query 1: Từ khóa chính hoặc phát ngôn mới nhất
        if (isWorldPolitics) {
          snippetQueries.push(`${cleanQ} phát ngôn tuyên bố mới nhất 2026`);
        } else {
          snippetQueries.push(cleanQ);
        }

        // Query 2 & 3: Lấy từ các tiêu đề nổi bật nhất trong danh sách bản tin (bỏ tên báo phía sau)
        for (const item of mergedItems.slice(0, 5)) {
          const rawTitle = item.title.split(/\s*-\s*[^-]+$/)[0]?.trim();
          if (rawTitle && rawTitle.length > 10 && !snippetQueries.some((q) => q.includes(rawTitle.slice(0, 20)))) {
            snippetQueries.push(rawTitle);
            if (snippetQueries.length >= 3) break;
          }
        }

        const snippetResults = await Promise.allSettled(
          snippetQueries.map((q) => webSearch(q, 3))
        );

        const collectedSnippets: SearchResultItem[] = [];
        const seenSnippets = new Set<string>();

        for (const res of snippetResults) {
          if (res.status === "fulfilled" && Array.isArray(res.value)) {
            for (const item of res.value) {
              const snippetClean = item.snippet.replace(/\s+/g, " ").trim();
              if (snippetClean.length > 40 && !seenSnippets.has(snippetClean.slice(0, 50))) {
                seenSnippets.add(snippetClean.slice(0, 50));
                collectedSnippets.push({
                  ...item,
                  snippet: snippetClean,
                });
                if (collectedSnippets.length >= 6) break;
              }
            }
          }
          if (collectedSnippets.length >= 6) break;
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

          richSnippetsText = `🔥 TRÍCH DẪN & DIỄN BIẾN CHI TIẾT TỪ BÁO CHÍ (CHỨA PHÁT NGÔN NGUYÊN VĂN, BỐI CẢNH & NỀN TẢNG):\n${snippetLines}`;
        }
      } catch (err) {
        console.warn("[realtime-search] Lỗi bóc tách snippet:", err);
      }
    }

    // 11. Trả về tổng hợp bao gồm Wikipedia (nếu có), Snippets trích dẫn và danh sách bản tin thời gian thực
    const newsLines = mergedItems
      .slice(0, 25)
      .map((item, idx) => `${idx + 1}. [${item.timeLabel}] ${item.title}`)
      .join("\n");

    const sections: string[] = [];
    if (wikiText) sections.push(wikiText);
    if (richSnippetsText) sections.push(richSnippetsText);
    if (newsLines) sections.push(`📰 DANH SÁCH BẢN TIN THỜI SỰ LIÊN QUAN:\n${newsLines}`);

    return sections.join("\n\n");
  } catch (e) {
    console.warn("[realtime-search] Lỗi tra cứu tin tức:", e);
    return "";
  }
}

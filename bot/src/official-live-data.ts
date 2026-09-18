type FetchLike = typeof fetch;

export interface OfficialLiveDataOptions {
  fetch?: FetchLike;
  sportsApiKey?: string;
  now?: Date;
}

const CACHE_TTL_MS = 3 * 60 * 1000;
const responseCache = new Map<string, { expiresAt: number; value: string }>();

function decodeHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string, fetcher: FetchLike): Promise<string> {
  const cached = responseCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const response = await fetcher(url, {
      headers: { Accept: "text/html,application/json", "User-Agent": "ZaloBot-OfficialData/1.0" },
      signal: AbortSignal.timeout(2800),
    });
    if (!response.ok) return "";
    const value = await response.text();
    if (value) responseCache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch {
    return "";
  }
}

function sourceBlock(title: string, lines: string[], sourceName: string, sourceUrl: string, now: Date): string {
  if (lines.length === 0) return "";
  return [
    `=== ${title} ===`,
    ...lines.slice(0, 12),
    `- Nguồn chính thức: ${sourceName}`,
    `- URL nguồn: ${sourceUrl}`,
    `- Thời điểm lấy dữ liệu: ${now.toISOString()}`,
  ].join("\n");
}

export function parseSjcGoldHtml(html: string): string[] {
  const text = decodeHtml(html);
  const lines: string[] = [];
  const pattern = /((?:vàng|SJC|nhẫn)[^|]{0,70}?)\s+(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?)\s+(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?)/gi;
  for (const match of text.matchAll(pattern)) {
    const label = match[1]?.trim();
    if (label && match[2] && match[3]) lines.push(`- ${label}: mua ${match[2]}, bán ${match[3]} (nghìn đồng/lượng)`);
    if (lines.length >= 8) break;
  }
  return [...new Set(lines)];
}

export function parseFuelHtml(html: string): string[] {
  const text = decodeHtml(html);
  const productLines: string[] = [];
  const date = text.match(/(?:ngày|từ)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i)?.[1];
  const products = ["E5RON92", "RON95-III", "E10RON95-III", "dầu điêzen 0.05S", "dầu hỏa", "dầu madút 180CST 3.5S"];
  for (const product of products) {
    const escaped = product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}[^0-9]{0,100}(\\d{1,3}(?:[.]\\d{3})+)\\s*đồng\\/(?:lít|kg)`, "i"));
    if (match?.[1]) productLines.push(`- ${product}: không cao hơn ${match[1]} đồng`);
  }
  return productLines.length > 0
    ? [...(date ? [`- Kỳ điều hành/ngày áp dụng: ${date}`] : []), ...productLines]
    : [];
}

export function extractLatestFuelNoticeUrl(html: string): string {
  const match = html.match(/href=["']([^"']+)["'][^>]*(?:title=["'][^"']*(?:điều hành giá|giá bán xăng dầu)[^"']*["'])/i);
  if (!match?.[1]) return "";
  try {
    return new URL(match[1], "https://moit.gov.vn").toString();
  } catch {
    return "";
  }
}

export function parseLegalHtml(html: string): string[] {
  const text = decodeHtml(html);
  const lines: string[] = [];
  const documentPattern = /((?:Luật|Nghị định|Thông tư|Quyết định)\s+(?:số\s+)?[0-9A-Z./-]+)[^.!?]{0,180}/gi;
  for (const match of text.matchAll(documentPattern)) {
    const value = match[0]?.trim();
    if (value && value.length >= 20) lines.push(`- ${value}`);
    if (lines.length >= 6) break;
  }
  const status = text.match(/(?:Hiệu lực|Trạng thái)\s*:?\s*(Còn hiệu lực|Hết hiệu lực(?: một phần)?|Chưa có hiệu lực)/i)?.[1];
  if (status) lines.unshift(`- Tình trạng hiệu lực: ${status}`);
  return [...new Set(lines)];
}

export function parseHnxHtml(html: string, symbol?: string): string[] {
  const text = decodeHtml(html);
  const target = symbol?.toUpperCase();
  const rowPattern = /\b([A-Z][A-Z0-9]{2,5})\b\s+[A-Z0-9]{8,15}\s+(\d[\d.]*)\s+(\d[\d.]*)\s+(\d[\d.]*)\s+(\d[\d.]*)\s+(\d[\d.]*)\s+(\d[\d.]*)\s+(\d[\d.]*)\s+(\d[\d.]*)/g;
  const lines: string[] = [];
  for (const match of text.matchAll(rowPattern)) {
    if (target && match[1] !== target) continue;
    lines.push(`- ${match[1]}: tham chiếu ${match[2]}, trần ${match[3]}, sàn ${match[4]}, mở cửa ${match[5]}, đóng cửa ${match[6]}, bình quân ${match[7]}, cao nhất ${match[8]}, thấp nhất ${match[9]} (đồng)`);
    if (lines.length >= 5) break;
  }
  return lines;
}

export function parseLotteryHtml(html: string): string[] {
  const block = html.match(/Kết quả QSMT kỳ\s*(?:<[^>]+>)*\s*#?([0-9A-Z-]+)[\s\S]{0,100}?ngày\s*(?:<[^>]+>)*\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})[\s\S]{0,3000}?<div[^>]*class=["'][^"']*day_so_ket_qua_v2[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (block?.[1] && block[2] && block[3]) {
    const numbers = [...block[3].matchAll(/<span[^>]*>\s*([0-9]{1,3})\s*<\/span>/gi)].map((match) => match[1]);
    if (numbers.length >= 5) return [`- Kỳ quay: ${block[1]} ngày ${block[2]}`, `- Bộ số: ${numbers.join(" ")}`];
  }
  return [];
}

async function fetchSportsFixtures(query: string, fetcher: FetchLike, apiKey: string, now: Date): Promise<string> {
  if (!apiKey) return "";
  const date = now.toISOString().slice(0, 10);
  try {
    const response = await fetcher(`https://v3.football.api-sports.io/fixtures?date=${date}&timezone=Asia%2FHo_Chi_Minh`, {
      headers: { Accept: "application/json", "x-apisports-key": apiKey },
      signal: AbortSignal.timeout(2800),
    });
    if (!response.ok) return "";
    const data = await response.json() as any;
    const queryTokens = query.toLowerCase().split(/\s+/).filter((token) => token.length >= 3);
    const fixtures = Array.isArray(data?.response) ? data.response : [];
    const lines = fixtures
      .filter((item: any) => {
        const haystack = `${item?.teams?.home?.name || ""} ${item?.teams?.away?.name || ""} ${item?.league?.name || ""}`.toLowerCase();
        return queryTokens.some((token) => haystack.includes(token)) || /(?:hôm nay|lịch thi đấu|tỷ số)/i.test(query);
      })
      .slice(0, 8)
      .map((item: any) => {
        const home = item?.teams?.home?.name || "Đội nhà";
        const away = item?.teams?.away?.name || "Đội khách";
        const status = item?.fixture?.status?.short || "NS";
        const homeScore = item?.goals?.home;
        const awayScore = item?.goals?.away;
        const score = Number.isFinite(homeScore) && Number.isFinite(awayScore) ? `${homeScore}-${awayScore}` : "chưa diễn ra";
        return `- ${home} vs ${away}: ${score}, trạng thái ${status}, lúc ${item?.fixture?.date || "chưa rõ"}`;
      });
    return sourceBlock("LỊCH/TỶ SỐ BÓNG ĐÁ TỪ API-FOOTBALL", lines, "API-Football", "https://www.api-football.com/", now);
  } catch {
    return "";
  }
}

export async function getOfficialLiveDataContext(query: string, options: OfficialLiveDataOptions = {}): Promise<string> {
  const fetcher = options.fetch || fetch;
  const now = options.now || new Date();
  const tasks: Promise<string>[] = [];

  if (/(?:giá vàng|vàng sjc|vàng miếng|nhẫn trơn)/i.test(query)) {
    const url = "https://www.sjc.com.vn/bieu-do-gia-vang";
    tasks.push(fetchText(url, fetcher).then((html) => sourceBlock("GIÁ VÀNG SJC", parseSjcGoldHtml(html), "SJC", url, now)));
  }
  if (/(?:giá xăng|giá dầu|xăng dầu|E5RON|RON95|diesel|điêzen)/i.test(query)) {
    const listUrl = "https://moit.gov.vn/van-ban-phap-luat/van-ban-dieu-hanh";
    tasks.push(fetchText(listUrl, fetcher).then(async (html) => {
      const detailUrl = extractLatestFuelNoticeUrl(html);
      if (!detailUrl) return "";
      const detailHtml = await fetchText(detailUrl, fetcher);
      return sourceBlock("ĐIỀU HÀNH GIÁ XĂNG DẦU", parseFuelHtml(detailHtml), "Bộ Công Thương", detailUrl, now);
    }));
  }
  if (/(?:văn bản pháp luật|nghị định|thông tư|luật mới|quyết định.*hiệu lực)/i.test(query)) {
    const url = `https://vbpl.vn/Pages/vanbanmoi.aspx`;
    tasks.push(fetchText(url, fetcher).then((html) => sourceBlock("VĂN BẢN PHÁP LUẬT CHÍNH THỨC", parseLegalHtml(html), "CSDL Quốc gia về văn bản pháp luật", url, now)));
  }
  const stockMatch = query.match(/(?:mã|cổ phiếu|chứng khoán)\s+([A-Z]{3,5})\b/);
  if (stockMatch || /(?:chứng khoán việt nam|hnx|upcom)/i.test(query)) {
    const url = "https://www.gov.hnx.vn/vi-vn/co-phieu-etfs/du-lieu-thi-truong-uc.html";
    tasks.push(fetchText(url, fetcher).then((html) => sourceBlock("DỮ LIỆU GIAO DỊCH HNX/UPCOM", parseHnxHtml(html, stockMatch?.[1]), "Sở GDCK Hà Nội", url, now)));
  }
  if (/(?:vietlott|xổ số|kết quả xổ số|mega 6\/45|power 6\/55|keno)/i.test(query)) {
    const url = "https://vietlott.vn/vi/home";
    tasks.push(fetchText(url, fetcher).then((html) => sourceBlock("KẾT QUẢ VIETLOTT", parseLotteryHtml(html), "Vietlott", url, now)));
  }
  if (/(?:lịch thi đấu|tỷ số|kết quả bóng đá|trận đấu hôm nay|livescore)/i.test(query)) {
    tasks.push(fetchSportsFixtures(query, fetcher, options.sportsApiKey || process.env.API_FOOTBALL_KEY || "", now));
  }

  const settled = await Promise.allSettled(tasks);
  return settled
    .filter((item): item is PromiseFulfilledResult<string> => item.status === "fulfilled")
    .map((item) => item.value)
    .filter(Boolean)
    .join("\n\n");
}

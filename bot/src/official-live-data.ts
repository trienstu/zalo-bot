type FetchLike = typeof fetch;

export interface OfficialLiveDataOptions {
  fetch?: FetchLike;
  sportsApiKey?: string;
  now?: Date;
}

const CACHE_TTL_MS = 3 * 60 * 1000;
const responseCache = new Map<string, { expiresAt: number; value: string }>();
const sportsResponseCaches = new WeakMap<FetchLike, Map<string, { expiresAt: number; promise: Promise<any> }>>();
let warnedMissingSportsKey = false;

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
    "EVIDENCE_STATUS: SUFFICIENT (structured-official-source)",
    `=== ${title} ===`,
    ...lines.slice(0, 12),
    `- Nguồn chính thức: ${sourceName}`,
    `- URL nguồn: ${sourceUrl}`,
    `- Thời điểm lấy dữ liệu: ${now.toISOString()}`,
  ].join("\n");
}

function normalize(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SPORTS_QUERY_NOISE = new Set([
  "lich", "thi", "dau", "bong", "da", "hom", "nay", "ngay", "tran", "ket", "qua", "ty", "so",
  "moi", "nhat", "cap", "nhat", "gio", "viet", "nam", "league", "fixture", "fixtures", "match", "today",
]);

const SPORTS_COMPETITION_ALIASES: Array<[RegExp, string[]]> = [
  [/\b(?:la\s*liga|laliga)\b/i, ["la liga", "laliga"]],
  [/\b(?:premier league|epl)\b/i, ["premier league"]],
  [/\b(?:champions league|c1)\b/i, ["champions league"]],
  [/\b(?:europa league|c2)\b/i, ["europa league"]],
  [/\bserie\s*a\b/i, ["serie a"]],
  [/\bbundesliga\b/i, ["bundesliga"]],
  [/\bligue\s*1\b/i, ["ligue 1"]],
  [/\b(?:v[ .-]?league|vleague)\b/i, ["v league", "v-league", "vleague"]],
  [/\bworld cup\b/i, ["world cup"]],
  [/\basian cup\b/i, ["asian cup"]],
];

export function selectSportsFixtures(query: string, fixtures: any[]): any[] {
  const normalizedQuery = normalize(query);
  const competition = SPORTS_COMPETITION_ALIASES.find(([pattern]) => pattern.test(normalizedQuery));
  const competitionAliases = competition?.[1];
  const competitionTokens = new Set((competition ? normalizedQuery.match(competition[0])?.[0] : "")?.split(" ").filter(Boolean));
  const anchors = [...new Set(normalizedQuery.split(" ").filter((token) => (
    token.length >= 2 && !/^\d{1,4}$/.test(token) && !SPORTS_QUERY_NOISE.has(token) && !competitionTokens.has(token)
  )))];
  if (anchors.length === 0 && !competitionAliases) return fixtures;

  return fixtures.filter((item: any) => {
    const haystack = normalize(`${item?.teams?.home?.name || ""} ${item?.teams?.away?.name || ""} ${item?.league?.name || ""} ${item?.league?.country || ""}`);
    const compactHaystack = haystack.replace(/\s+/g, "");
    if (competitionAliases && !competitionAliases.some((alias) => {
      const normalizedAlias = normalize(alias);
      return haystack.includes(normalizedAlias) || compactHaystack.includes(normalizedAlias.replace(/\s+/g, ""));
    })) return false;
    return anchors.every((anchor) => haystack.includes(anchor) || compactHaystack.includes(anchor));
  });
}

function vietnamDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
  if (!apiKey) {
    if (!warnedMissingSportsKey) {
      console.warn("[official-live-data] API-Football chưa hoạt động: thiếu API_FOOTBALL_KEY trong tiến trình bot.");
      warnedMissingSportsKey = true;
    }
    return "";
  }
  const date = vietnamDate(now);
  const url = `https://v3.football.api-sports.io/fixtures?date=${date}&timezone=Asia%2FHo_Chi_Minh`;
  try {
    let cache = sportsResponseCaches.get(fetcher);
    if (!cache) {
      cache = new Map();
      sportsResponseCaches.set(fetcher, cache);
    }
    const cacheKey = `${date}:${apiKey}`;
    const cached = cache.get(cacheKey);
    let dataPromise: Promise<any>;
    if (cached && cached.expiresAt > Date.now()) {
      dataPromise = cached.promise;
    } else {
      dataPromise = (async () => {
        const response = await fetcher(url, {
          headers: { Accept: "application/json", "x-apisports-key": apiKey },
          signal: AbortSignal.timeout(4500),
        });
        const data = await response.json() as any;
        if (!response.ok || (data?.errors && Object.keys(data.errors).length > 0)) {
          const reason = !response.ok ? `HTTP ${response.status}` : JSON.stringify(data.errors);
          throw new Error(reason);
        }
        return data;
      })();
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, promise: dataPromise });
      dataPromise.catch(() => cache?.delete(cacheKey));
    }
    const data = await dataPromise;
    const fixtures = Array.isArray(data?.response) ? data.response : [];
    const lines = selectSportsFixtures(query, fixtures)
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
  } catch (error) {
    console.warn(`[official-live-data] API-Football thất bại cho ngày ${date}: ${error instanceof Error ? error.message : String(error)}`);
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

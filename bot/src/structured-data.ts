import { getWeatherReport } from "./weather.js";
import { getFinancialMarketSummary } from "./tools/finance-tools.js";

type FetchLike = typeof fetch;

export interface StructuredDataDependencies {
  fetch?: FetchLike;
  weather?: (location: string, targetDate?: string | number) => Promise<string>;
  finance?: (query: string) => Promise<string>;
}

function extractWeatherLocation(query: string): string {
  const match = query.match(/(?:thời tiết|nhiệt độ|mưa|chất lượng không khí|aqi)(?:\s+(?:ở|tại))?\s+([^,?.!]+?)(?=\s+(?:hôm nay|ngày mai|mai|tuần này)\b|[,.?!]|$)/i);
  return match?.[1]?.trim() || "Hồ Chí Minh";
}

function jsonText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function fetchJson(url: string, fetcher: FetchLike): Promise<any | null> {
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json", "User-Agent": "ZaloBot-Realtime/1.0" },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function lookupNpm(query: string, fetcher: FetchLike): Promise<string> {
  const match = query.match(/(?:npm(?:\s+package|\s+gói)?|package\s+npm)\s+(@?[a-z0-9._~-]+(?:\/[a-z0-9._~-]+)?)/i);
  const name = match?.[1];
  if (!name) return "";
  const data = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, fetcher);
  if (!data?.name || !data?.version) return "";
  return [
    "=== DỮ LIỆU CÓ CẤU TRÚC TỪ NPM REGISTRY ===",
    `- Gói: ${data.name}`,
    `- Phiên bản mới nhất: ${data.version}`,
    jsonText(data.description) ? `- Mô tả: ${jsonText(data.description)}` : "",
    `- Nguồn chính thức: npm Registry`,
  ].filter(Boolean).join("\n");
}

async function lookupPypi(query: string, fetcher: FetchLike): Promise<string> {
  const match = query.match(/(?:pypi(?:\s+package|\s+gói)?|package\s+python|thư viện\s+python)\s+([a-z0-9._-]+)/i);
  const name = match?.[1];
  if (!name) return "";
  const data = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, fetcher);
  const info = data?.info;
  if (!info?.name || !info?.version) return "";
  return [
    "=== DỮ LIỆU CÓ CẤU TRÚC TỪ PYPI ===",
    `- Gói: ${info.name}`,
    `- Phiên bản mới nhất: ${info.version}`,
    jsonText(info.summary) ? `- Mô tả: ${jsonText(info.summary)}` : "",
    `- Nguồn chính thức: PyPI`,
  ].filter(Boolean).join("\n");
}

async function lookupGithubRelease(query: string, fetcher: FetchLike): Promise<string> {
  const match = query.match(/(?:github\.com\/|github(?:\s+repo|\s+repository)?\s+)([a-z0-9_.-]+)\/([a-z0-9_.-]+)/i);
  if (!match?.[1] || !match[2]) return "";
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  const data = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`, fetcher);
  if (!data?.tag_name) return "";
  return [
    "=== DỮ LIỆU PHÁT HÀNH TỪ GITHUB API ===",
    `- Repository: ${owner}/${repo}`,
    `- Bản phát hành mới nhất: ${data.name || data.tag_name} (${data.tag_name})`,
    data.published_at ? `- Công bố: ${data.published_at}` : "",
    `- Nguồn chính thức: GitHub Releases`,
  ].filter(Boolean).join("\n");
}

export async function getStructuredRealtimeContext(
  query: string,
  dependencies: StructuredDataDependencies = {},
): Promise<string> {
  const fetcher = dependencies.fetch || fetch;
  const weather = dependencies.weather || getWeatherReport;
  const finance = dependencies.finance || getFinancialMarketSummary;
  const tasks: Promise<string>[] = [];

  if (/(?:thời tiết|nhiệt độ|dự báo mưa|chất lượng không khí|\baqi\b)/i.test(query)) {
    const targetDate = /(?:ngày mai|\bmai\b)/i.test(query) ? "tomorrow" : "today";
    tasks.push(weather(extractWeatherLocation(query), targetDate));
  }
  if (/(?:crypto|bitcoin|\bbtc\b|ethereum|\beth\b|solana|\bsol\b|tỷ giá|ngoại tệ|\busd\b|\bvnd\b)/i.test(query)) {
    tasks.push(finance(query));
  }
  tasks.push(lookupNpm(query, fetcher), lookupPypi(query, fetcher), lookupGithubRelease(query, fetcher));

  const results = await Promise.allSettled(tasks);
  const sections = results
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
    .map((result) => result.value.trim())
    .filter(Boolean);

  return sections.length > 0
    ? `📊 DỮ LIỆU CÓ CẤU TRÚC TỪ API CÔNG KHAI (ƯU TIÊN SỐ LIỆU NÀY):\n${sections.join("\n\n")}`
    : "";
}

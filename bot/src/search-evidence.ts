export type SearchIntent = "fact_check" | "realtime_news" | "project_qa" | "knowledge" | "chat";

export type EvidenceSourceType = "official" | "primary" | "market" | "news" | "encyclopedia" | "web";

export interface SearchEvidence {
  title: string;
  snippet: string;
  url: string;
  sourceName?: string;
  sourceType?: EvidenceSourceType;
  publishedAt?: number | null;
  retrievedAt?: number;
  relevanceScore?: number;
  authorityScore?: number;
  totalScore?: number;
  disambiguationPenalty?: boolean;
}

export interface EvidenceSufficiency {
  sufficient: boolean;
  reason: "not-required" | "strong-official-source" | "independent-corroboration" | "insufficient-relevant-evidence";
}

const RELEVANCE_STOP_WORDS = new Set([
  "a", "ai", "anh", "ba", "ban", "bay", "biet", "can", "cau", "cho", "co", "cua", "duoc", "em",
  "giup", "hay", "hoi", "hien", "la", "moi", "mot", "nao", "nay", "nhe", "nhat", "nhung", "o", "ra",
  "tai", "the", "thi", "thong", "tin", "toi", "trong", "ve", "voi", "vay", "va", "vua", "current",
  "latest", "news", "now", "please", "today", "what", "who",
]);

const BROAD_QUERY_WORDS = new Set([
  "news", "tin", "tuc", "thoi", "su", "today", "hom", "nay", "latest", "moi", "nhat", "update", "cap", "nhat",
]);

const ENTITY_ANCHOR_STOP_WORDS = new Set([
  ...RELEVANCE_STOP_WORDS,
  "2024", "2025", "2026", "2027", "2028",
  "an", "ban", "bang", "bat", "biet", "block", "bo", "bong", "can", "cao", "cap", "cdt", "chu",
  "chung", "cong", "cu", "cung", "danh", "dat", "dau", "dia", "dien", "dong", "doi", "du",
  "gia", "giam", "giao", "giai", "giay", "goi", "group", "hang", "hau", "hinh", "hoi", "huan",
  "huyen", "khu", "kiem", "khai", "khi", "khoi", "lich", "linh", "luat", "luyen", "mat", "muc",
  "nguoi", "nha", "nhan", "phap", "pho", "phong", "phuong", "quan", "quy", "san", "so", "tai",
  "tap", "thanh", "thao", "thi", "thong", "thu", "tich", "tien", "tong", "tinh", "trien", "truong",
  "tu", "van", "vien", "xay", "xac",
  "apartment", "breaking", "chair", "chairman", "chief", "city", "coach", "company", "current",
  "developer", "estate", "football", "latest", "legal", "market", "minister", "new", "official",
  "president", "price", "project", "real", "review", "team", "tower",
]);

export function normalizeSearchText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, (char) => (char === "Đ" ? "D" : "d"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTokens(query: string): string[] {
  const tokens = normalizeSearchText(query)
    .split(" ")
    .filter((token) => token.length >= 2 && !RELEVANCE_STOP_WORDS.has(token));
  return [...new Set(tokens)];
}

function normalizedTokenSet(value: string): Set<string> {
  return new Set(normalizeSearchText(value).split(" ").filter(Boolean));
}

function normalizedContainsPhrase(normalizedText: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  return ` ${normalizedText} `.includes(` ${tokens.join(" ")} `);
}

function entityAnchorTokens(query: string): string[] {
  const tokens = queryTokens(query)
    .filter((token) =>
      token.length >= 3 &&
      !ENTITY_ANCHOR_STOP_WORDS.has(token) &&
      !/^\d{4}$/.test(token)
    );
  return [...new Set(tokens)].slice(0, 6);
}

function countEntityAnchorHits(item: SearchEvidence, query: string): number {
  const anchors = entityAnchorTokens(query);
  if (anchors.length === 0) return 0;
  const normalized = normalizeSearchText(`${item.title} ${item.snippet} ${item.sourceName || ""} ${hostnameOf(item.url)} ${item.url}`);
  const tokens = new Set(normalized.split(" ").filter(Boolean));
  return anchors.filter((anchor) => tokens.has(anchor) || (anchor.length >= 5 && normalized.includes(anchor))).length;
}

function meetsEntityAnchorRequirement(item: SearchEvidence, query: string, intent: SearchIntent): boolean {
  if (intent !== "fact_check") return true;
  const anchors = entityAnchorTokens(query);
  if (anchors.length === 0) return true;
  const requiredHits = anchors.length >= 2 ? 2 : 1;
  return countEntityAnchorHits(item, query) >= requiredHits;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourceHostOf(sourceName: string | undefined): string {
  const normalized = String(sourceName || "").trim().toLowerCase().replace(/^www\./, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized) ? normalized : "";
}

function inferAuthority(item: SearchEvidence): number {
  const host = hostnameOf(item.url);
  const sourceHost = sourceHostOf(item.sourceName);
  const authorityHosts = [host, sourceHost].filter(Boolean);
  const isGovernment = authorityHosts.some((value) =>
    /(?:^|\.)(?:gov|gouv|gob|go|gc)\.[a-z.]+$/i.test(value) || /(?:^|\.)gov$/i.test(value)
  );
  const isEducation = authorityHosts.some((value) => /(?:^|\.)edu(?:\.[a-z]{2})?$/i.test(value));
  const type = isGovernment ? "official" : item.sourceType || "web";

  switch (type) {
    case "official": return 1;
    case "primary": return 0.9;
    case "market": return 0.88;
    case "news": return 0.72;
    case "encyclopedia": return 0.58;
    default: return isEducation ? 0.82 : 0.45;
  }
}

function freshnessScore(publishedAt: number | null | undefined, now: number): number {
  if (!publishedAt || publishedAt <= 0 || publishedAt > now + 24 * 60 * 60 * 1000) return 0;
  const ageDays = (now - publishedAt) / (24 * 60 * 60 * 1000);
  return Math.max(0.08, Math.exp(-ageDays / 180));
}

function isBroadQuery(query: string, tokens: string[]): boolean {
  const normalized = normalizeSearchText(query);
  return tokens.length <= 1 || normalized.split(" ").every((token) => BROAD_QUERY_WORDS.has(token));
}

function isIdentityQuery(query: string): boolean {
  return /\b(?:ai|who|whom)\b/i.test(normalizeSearchText(query));
}

function hasCurrentLanguage(item: SearchEvidence): boolean {
  return /\b(?:current|currently|latest|now|hien tai|hien nay|moi nhat)\b/i.test(
    normalizeSearchText(`${item.title} ${item.snippet}`)
  );
}

function hasIdentityAnswerSignal(title: string, query: string): boolean {
  const mainTitle = String(title || "").split(/\s+-\s+/)[0] || "";
  const queryTokenSet = new Set(queryTokens(query));
  const capitalizedPhrases = [...mainTitle.matchAll(/\p{Lu}[\p{L}\p{M}'-]*(?:\s+\p{Lu}[\p{L}\p{M}'-]*)+/gu)]
    .map((match) => normalizeSearchText(match[0]).split(" ").filter(Boolean));

  return capitalizedPhrases.some((tokens) => tokens.some((token) => !queryTokenSet.has(token)));
}

export function scoreEvidence(
  item: SearchEvidence,
  query: string,
  intent: SearchIntent = "knowledge",
  now = Date.now(),
): SearchEvidence & Required<Pick<SearchEvidence, "relevanceScore" | "authorityScore" | "totalScore">> {
  const tokens = queryTokens(query);
  const haystack = normalizeSearchText(`${item.title} ${item.snippet}`);
  const title = normalizeSearchText(item.title);
  const haystackTokens = normalizedTokenSet(`${item.title} ${item.snippet}`);
  const titleTokens = normalizedTokenSet(item.title);
  const matched = tokens.filter((token) => haystackTokens.has(token));
  const titleMatched = tokens.filter((token) => titleTokens.has(token));
  const coverage = tokens.length > 0 ? matched.length / tokens.length : 0;
  const titleCoverage = tokens.length > 0 ? titleMatched.length / tokens.length : 0;
  const phrase = tokens.length >= 2 && normalizedContainsPhrase(haystack, tokens) ? 1 : 0;
  const queryText = normalizeSearchText(query);
  const disambiguatingModifiers = ["pho", "deputy", "vice", "acting", "interim", "former", "cuu"];
  const hasUnrequestedModifier = disambiguatingModifiers.some((modifier) =>
    new RegExp(`(?:^| )${modifier}(?: |$)`).test(haystack) &&
    !new RegExp(`(?:^| )${modifier}(?: |$)`).test(queryText)
  );
  const baseRelevance = Math.min(1, coverage * 0.68 + titleCoverage * 0.22 + phrase * 0.1);
  const relevanceScore = baseRelevance * (hasUnrequestedModifier ? 0.72 : 1);
  const authorityScore = inferAuthority(item);
  const freshness = intent === "fact_check" || intent === "realtime_news"
    ? freshnessScore(item.publishedAt, now)
    : 0;
  const snippetQuality = item.snippet && normalizeSearchText(item.snippet) !== title && item.snippet.length > 25 ? 1 : 0;
  const identityAnswerSignal = intent === "fact_check" && isIdentityQuery(query) && hasIdentityAnswerSignal(item.title, query) ? 1 : 0;
  const totalScore = relevanceScore * 100 + authorityScore * 20 + freshness * 14 + identityAnswerSignal * 14 + snippetQuality * 2;

  return {
    ...item,
    publishedAt: item.publishedAt || null,
    disambiguationPenalty: hasUnrequestedModifier,
    relevanceScore,
    authorityScore,
    totalScore,
  };
}

function meetsRelevanceThreshold(item: SearchEvidence, query: string): boolean {
  const tokens = queryTokens(query);
  const score = item.relevanceScore || 0;
  if (isBroadQuery(query, tokens)) return score >= 0.35;
  if (tokens.length === 2) return score >= 0.5;
  return score >= 0.46;
}

export function rankEvidence(
  items: SearchEvidence[],
  query: string,
  intent: SearchIntent = "knowledge",
  now = Date.now(),
): Array<SearchEvidence & Required<Pick<SearchEvidence, "relevanceScore" | "authorityScore" | "totalScore">>> {
  const deduped = new Map<string, SearchEvidence>();
  const ordered = items
    .filter((item) => item && item.title?.trim() && item.url?.trim())
    .map((item) => ({ ...item, title: item.title.trim(), snippet: (item.snippet || item.title).trim(), url: item.url.trim() }))
    .sort((a, b) => `${normalizeSearchText(a.title)}\u0000${a.url}`.localeCompare(`${normalizeSearchText(b.title)}\u0000${b.url}`, "en"));

  for (const item of ordered) {
    const key = `${normalizeSearchText(item.title).slice(0, 120)}\u0000${hostnameOf(item.url)}`;
    const previous = deduped.get(key);
    if (!previous || (item.snippet?.length || 0) > (previous.snippet?.length || 0)) deduped.set(key, item);
  }

  return [...deduped.values()]
    .map((item) => scoreEvidence(item, query, intent, now))
    .filter((item) => meetsEntityAnchorRequirement(item, query, intent))
    .filter((item) => meetsRelevanceThreshold(item, query))
    .sort((a, b) =>
      b.totalScore - a.totalScore ||
      (b.publishedAt || 0) - (a.publishedAt || 0) ||
      normalizeSearchText(a.title).localeCompare(normalizeSearchText(b.title), "en") ||
      a.url.localeCompare(b.url, "en")
    );
}

export function assessEvidenceSufficiency(
  evidence: SearchEvidence[],
  intent: SearchIntent,
): EvidenceSufficiency {
  if (intent !== "fact_check") return { sufficient: true, reason: "not-required" };

  const relevant = evidence.filter((item) => (item.relevanceScore || 0) >= 0.55 && Boolean(item.url));
  const strongOfficial = relevant.some((item) =>
    (item.authorityScore || inferAuthority(item)) >= 0.9 &&
    (Boolean(item.publishedAt) || hasCurrentLanguage(item))
  );
  if (strongOfficial) return { sufficient: true, reason: "strong-official-source" };

  const independentSources = new Set(relevant.map((item) => {
    if (item.sourceType === "news" && item.sourceName) return normalizeSearchText(item.sourceName);
    return hostnameOf(item.url);
  }).filter(Boolean));
  if (independentSources.size >= 2) return { sufficient: true, reason: "independent-corroboration" };

  return { sufficient: false, reason: "insufficient-relevant-evidence" };
}

function selectEvidenceForContext(evidence: SearchEvidence[], intent: SearchIntent): SearchEvidence[] {
  if (intent !== "fact_check") return evidence.slice(0, 8);
  const hasDatedRelevantEvidence = evidence.some((item) => (item.relevanceScore || 0) >= 0.55 && Boolean(item.publishedAt));
  if (!hasDatedRelevantEvidence) return evidence.slice(0, 8);
  const hasUnpenalizedDatedEvidence = evidence.some((item) =>
    (item.relevanceScore || 0) >= 0.55 && Boolean(item.publishedAt) && !item.disambiguationPenalty
  );

  return evidence
    .filter((item) => Boolean(item.publishedAt) || ((item.authorityScore || inferAuthority(item)) >= 0.9 && hasCurrentLanguage(item)))
    .filter((item) => !hasUnpenalizedDatedEvidence || !item.disambiguationPenalty)
    .slice(0, 8);
}

function formatPublishedAt(timestamp: number | null | undefined): string {
  if (!timestamp || timestamp <= 0) return "Không rõ ngày công bố";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp));
}

export function formatEvidenceContext(evidence: SearchEvidence[], intent: SearchIntent): string {
  const sufficiency = assessEvidenceSufficiency(evidence, intent);
  if (!sufficiency.sufficient) {
    return "EVIDENCE_STATUS: INSUFFICIENT\nKhông có đủ nguồn liên quan, có thể kiểm chứng và độc lập để khẳng định dữ kiện hiện tại.";
  }

  const lines = selectEvidenceForContext(evidence, intent).map((item, index) => {
    const source = item.sourceName || hostnameOf(item.url) || item.sourceType || "web";
    const date = formatPublishedAt(item.publishedAt);
    return `[E${index + 1}] ${item.title}\nNguồn: ${source}\nURL: ${item.url}\nNgày công bố: ${date}\nTrích đoạn: ${item.snippet}`;
  });
  return `EVIDENCE_STATUS: SUFFICIENT (${sufficiency.reason})\n${lines.join("\n\n")}`;
}

export function extractEvidenceUrls(context: string): string[] {
  const urls = [...String(context || "").matchAll(/^URL:\s*(https?:\/\/\S+)\s*$/gim)].map((match) => match[1]!);
  return [...new Set(urls)];
}

export function extractEvidenceSources(context: string): string[] {
  const sources = [...String(context || "").matchAll(/^Nguồn:\s*(.+?)\s*$/gim)]
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean);
  return [...new Set(sources)].slice(0, 3);
}

function stripTrailingSourceBlock(answer: string): string {
  const lines = String(answer || "").split("\n");
  const sourceHeaderIndex = lines.findIndex((line) =>
    /^\s*[(*_]*\s*(?:nguồn(?:\s+kiểm\s+chứng|\s+tổng\s+hợp)?|source)\s*:/i.test(line)
  );
  if (sourceHeaderIndex < 0) return lines.join("\n").trim();
  return lines.slice(0, sourceHeaderIndex).join("\n").trim();
}

export function finalizeGroundedAnswer(answer: string, evidenceContext: string, evidenceRequired: boolean): string {
  if (!evidenceRequired) return answer;
  const hasSufficientEvidence = /^EVIDENCE_STATUS:\s*SUFFICIENT/im.test(evidenceContext);
  if (!hasSufficientEvidence) {
    return "Em chưa đủ bằng chứng đáng tin cậy và cập nhật để khẳng định câu trả lời này. Anh/chị vui lòng cho em kiểm tra lại khi có thêm nguồn chính thức hoặc nguồn độc lập xác nhận.";
  }

  const allowedSources = extractEvidenceSources(evidenceContext);
  if (allowedSources.length === 0) {
    return "Em chưa đủ bằng chứng có thể dẫn nguồn để khẳng định câu trả lời này.";
  }

  const cleaned = stripTrailingSourceBlock(answer);
  return `${cleaned}\n\nNguồn kiểm chứng: ${allowedSources.join(", ")}.`.trim();
}

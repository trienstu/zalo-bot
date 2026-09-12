import { fetchUrl, webSearch } from "./tools/vertical-tools.js";

interface RealEstateSourceCandidate {
  title: string;
  snippet?: string;
  url?: string;
  sourceName?: string;
}

interface RealEstateSource {
  name: string;
  url: string;
  title: string;
  text: string;
  tier: "primary" | "news" | "market" | "web";
}

export interface RealEstateFact {
  key: string;
  label: string;
  value: string;
  sources: string[];
  tier: RealEstateSource["tier"];
}

const FIELD_LABELS: Record<string, string> = {
  developer: "Chủ đầu tư / đơn vị phát triển",
  location: "Vị trí",
  landArea: "Quy mô đất",
  towers: "Số block/tháp",
  floors: "Số tầng",
  basement: "Tầng hầm / khối đế",
  productCount: "Số lượng sản phẩm",
  unitTypes: "Loại sản phẩm",
  unitArea: "Diện tích căn",
  amenities: "Tiện ích nổi bật",
  legalStatus: "Pháp lý",
  progress: "Tiến độ / thời điểm bàn giao",
  price: "Giá tham khảo",
};

const REAL_ESTATE_PROFILE_CACHE = new Map<string, { createdAt: number; context: string }>();
const REAL_ESTATE_PROFILE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function normalizeVi(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, (char) => (char === "Đ" ? "D" : "d"))
    .toLowerCase();
}

function compactText(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function cleanFactValue(value: string): string {
  return compactText(value)
    .replace(/^[\s:：,;\-–—|]+/, "")
    .replace(/\s*(?:xem thêm|chi tiết|liên hệ|hotline|website).*$/i, "")
    .replace(/\s*(?:CHÍNH SÁCH|Chính sách|SIÊU HẤP DẪN|Họ tên|Điện thoại).*$/i, "")
    .replace(/\s+[–—-]?\s*(?:Chủ đầu tư|Chu dau tu|Vị trí|Vi tri|Quy mô|Quy mo|Số lượng|So luong|Tiện ích|Tien ich|Pháp lý|Phap ly|Tiến độ|Tien do|Bảng giá|Bang gia)\s*[:：].*$/i, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 220)
    .trim();
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function sourceNameOf(candidate: RealEstateSourceCandidate): string {
  if (candidate.url) return hostnameOf(candidate.url);
  const explicit = compactText(candidate.sourceName || "");
  if (explicit && !/^google news$/i.test(explicit)) return explicit;
  return compactText(candidate.title || "Nguồn web");
}

function projectTokens(query: string): string[] {
  const normalized = normalizeVi(query)
    .replace(/\b(?:tong quan|gioi thieu|thong tin|review|danh gia|du an|chung cu|can ho|khu do thi|bat dong san|nha dat|gia ban|bang gia|phap ly|tien do|chu dau tu|vi tri|mat bang|ban giao|mo ban|sen chua|bot|cho anh|giup anh|giup toi)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.split(/\s+/).filter((token) => token.length >= 3).slice(0, 6);
}

function inferSourceTier(source: RealEstateSourceCandidate, query: string): RealEstateSource["tier"] {
  const host = normalizeVi(hostnameOf(source.url || ""));
  const title = normalizeVi(source.title || "");
  const sourceName = normalizeVi(source.sourceName || "");
  const haystack = `${host} ${title} ${sourceName}`;
  const tokens = projectTokens(query);

  if (tokens.length > 0 && tokens.some((token) => host.includes(token))) return "primary";
  if (/(?:chu dau tu|official|chinh thuc|website du an|tap doan|corp|jsc|land|group)/i.test(haystack)) return "primary";
  if (/(?:vnexpress|cafef|cafeland|vneconomy|baodautu|reatimes|vietnamnet|tuoitre|thanhnien|dantri|nguoi lao dong|batdongsan\.com\.vn)/i.test(haystack)) return "news";
  if (/(?:batdongsan|nhadat|property|land|realty|realestate|investment|canho|chungcu|apartment|residence|riverside|heights)/i.test(haystack)) return "market";
  return "web";
}

function tierRank(tier: RealEstateSource["tier"]): number {
  if (tier === "primary") return 4;
  if (tier === "news") return 3;
  if (tier === "market") return 2;
  return 1;
}

function isMenuOrCtaNoise(value: string): boolean {
  const normalized = normalizeVi(value);
  if (/(?:dang ky|lien he|hotline|nhan bang gia|tai day|xem them|tin tuc|menu|trang chu)/i.test(normalized)) return true;
  const letters = value.replace(/[^A-Za-zÀ-ỹ]/g, "");
  const upper = value.replace(/[^A-ZÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/g, "");
  return letters.length >= 16 && upper.length / Math.max(letters.length, 1) > 0.75;
}

function isValidFactValue(key: string, value: string): boolean {
  const normalized = normalizeVi(value);
  if (!value || isMenuOrCtaNoise(value)) return false;
  if (key === "developer") {
    if (/\b(?:du an|toa lac|nam tai|vi tri|dia chi|tong quan)\b/i.test(normalized)) return false;
    return /\b(?:cong ty|ctcp|tnhh|tap doan|group|land|jsc|corp|corporation|dau tu|phat trien|developer|keppel|khang dien|nam long|dat phuoc|vingroup|vinhomes|masterise|novaland|gamuda|ecopark)\b/i.test(normalized);
  }
  if (key === "location") {
    if (/^(?:và|va)\s+(?:quy hoạch|quy hoach)/i.test(normalized)) return false;
    return /\b(?:duong|mat tien|phuong|quan|tp|thanh pho|tinh|huyen|khu|xa|vo chi cong|vinh phu|lai thieu|thu duc|binh trung|binh duong|dong nai|ha noi|ho chi minh|sai gon)\b/i.test(normalized);
  }
  if (key === "landArea") return /\d/.test(value) && /(?:m2|m²|ha|hecta)/i.test(value);
  if (key === "towers") return /\d/.test(value) && /(?:block|thap|tháp|toa|tòa|tower)/i.test(value) && value.length <= 80 && !/[A-ZÀ-Ỹ]{3,}\s+\d/i.test(value);
  if (key === "floors") return /\d/.test(value) && /tầng/i.test(value) && value.length <= 90;
  if (key === "basement") return /\d/.test(value) && /(?:hầm|ham|khối đế|khoi de|thương mại|thuong mai)/i.test(value) && value.length <= 90;
  if (key === "productCount") return /\d/.test(value) && /(?:sản phẩm|san pham|căn hộ|can ho|căn|can|unit|shophouse|officetel)/i.test(value) && value.length <= 130;
  if (key === "unitArea") return /\d/.test(value) && /(?:m2|m²)/i.test(value) && value.length <= 130;
  if (key === "legalStatus") return /(?:pháp lý|phap ly|sổ|so |giấy phép|giay phep|quy hoạch|quy hoach|sở hữu|so huu|lâu dài|lau dai|quyết định|quyet dinh)/i.test(value) && !/(?:thanh toán|thanh toan|ưu đãi|uu dai|đặt cọc|dat coc)/i.test(normalized) && value.length <= 120;
  if (key === "progress") return /(?:bàn giao|ban giao|cất nóc|cat noc|khởi công|khoi cong|mở bán|mo ban|kickoff|quý|quy|q[1-4]|tháng|thang|20\d{2})/i.test(value) && !/(?:quà tặng|qua tang|chiết khấu|chiet khau|họ tên|ho ten|điện thoại|dien thoai)/i.test(normalized) && value.length <= 130;
  if (key === "price") return /\d/.test(value) && /(?:triệu|trieu|tỷ|ty|tỉ|\/m2|\/m²)/i.test(value) && !/(?:phút|phut|quà tặng|qua tang|chiết khấu|chiet khau|họ tên|ho ten)/i.test(normalized);
  if (key === "amenities") {
    if (/^\s*dự án/i.test(value)) return false;
    return value.length >= 20 && /(?:hồ bơi|ho boi|công viên|cong vien|gym|spa|trường|truong|mảng xanh|mang xanh|tiện ích|tien ich|clubhouse|thương mại|thuong mai|ven sông|ven song)/i.test(value);
  }
  return value.length <= 180;
}

export function isRealEstateProjectProfileQuery(query: string): boolean {
  const text = normalizeVi(query);
  const asksRealEstate = /\b(?:du an|bat dong san|bds|nha dat|chung cu|can ho|khu do thi|shophouse|biet thu|condotel|officetel|residence|riverside|heights|urban|apartment|tower|block)\b/i.test(text);
  if (!asksRealEstate) return false;

  const asksProfile = /\b(?:tong quan|gioi thieu|thong tin|review|danh gia|ho so|chu dau tu|vi tri|quy mo|mat bang|so can|san pham|phap ly|tien do|mo ban|ban giao|bang gia|gia ban|gia tham khao)\b/i.test(text);
  const isGeneralMarket = /\b(?:thi truong|tin tuc|tin moi|hom nay|xu huong|nhan dinh thi truong|toan canh)\b/i.test(text) && !/\b(?:du an|chung cu|can ho|khu do thi)\b/i.test(text);
  const hasEntityToken = projectTokens(query).length >= 1;

  return asksProfile && hasEntityToken && !isGeneralMarket;
}

export function buildRealEstateProjectSearchQueries(query: string): string[] {
  const base = compactText(query)
    .replace(/@[^\s,!?]+/g, " ")
    .replace(/\b(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot ơi|bot oi|bot|admin|ad ơi|ad oi)\b/gi, " ")
    .replace(/\b(?:tổng quan|giới thiệu|thông tin|review|đánh giá|check|kiểm tra|cho anh|giúp anh|giúp tôi|với|nhé|nha|ạ)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedBase = base || compactText(query);

  return Array.from(new Set([
    `${normalizedBase} tổng quan chủ đầu tư quy mô`,
    `${normalizedBase} vị trí pháp lý tiến độ bàn giao`,
    `${normalizedBase} bảng giá số căn diện tích mặt bằng`,
  ].map((item) => compactText(item).slice(0, 140))));
}

function addFact(facts: RealEstateFact[], key: string, value: string, source: RealEstateSource): void {
  const cleaned = cleanFactValue(value);
  if (!cleaned || cleaned.length < 3) return;
  if (!isValidFactValue(key, cleaned)) return;
  const normalized = normalizeVi(cleaned).replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return;

  const sameKey = facts.filter((fact) => fact.key === key);
  const existing = sameKey.find((fact) => {
    const n = normalizeVi(fact.value).replace(/[^a-z0-9]+/g, " ").trim();
    return n === normalized || n.includes(normalized) || normalized.includes(n);
  });

  if (existing) {
    if (!existing.sources.includes(source.name)) existing.sources.push(source.name);
    if (tierRank(source.tier) > tierRank(existing.tier)) existing.tier = source.tier;
    return;
  }

  if (sameKey.length >= 3) return;
  facts.push({
    key,
    label: FIELD_LABELS[key] || key,
    value: cleaned,
    sources: [source.name],
    tier: source.tier,
  });
}

function extractLabelFacts(text: string, source: RealEstateSource): RealEstateFact[] {
  const facts: RealEstateFact[] = [];
  const normalizedText = compactText(text);
  const labelPatterns: Array<[string, RegExp]> = [
    ["developer", /(?:chủ đầu tư|chu dau tu|cđt|cdt|đơn vị phát triển|don vi phat trien|nhà phát triển|nha phat trien)\s*[:：\-–—]?\s*([^.;|\n]{3,150})/gi],
    ["location", /(?:vị trí|vi tri|địa chỉ|dia chi|tọa lạc|toa lac|nằm tại|nam tai)\s*[:：\-–—]?\s*((?:TP\.HCM|Tp\.HCM|tp\.hcm|TP\. Hồ Chí Minh|[^.;|\n]){3,180})/gi],
    ["landArea", /(?:quy mô đất|quy mo dat|diện tích đất|dien tich dat|tổng diện tích|tong dien tich|diện tích khu đất|dien tich khu dat)\s*[:：\-–—]?\s*([^.;|\n]{3,120})/gi],
    ["towers", /(?:số block|so block|block|tháp|thap|tower)\s*[:：\-–—]?\s*([^.;|\n]{3,120})/gi],
    ["floors", /(?:số tầng|so tang|cao)\s*[:：\-–—]?\s*([^.;|\n]{3,120})/gi],
    ["productCount", /(?:số lượng sản phẩm|so luong san pham|sản phẩm|san pham|số căn|so can|căn hộ|can ho)\s*[:：\-–—]?\s*([^.;|\n]{3,140})/gi],
    ["unitArea", /(?:diện tích căn|dien tich can|diện tích|dien tich)\s*[:：\-–—]?\s*([^.;|\n]{3,120})/gi],
    ["legalStatus", /(?:pháp lý|phap ly|sổ hồng|so hong|giấy phép|giay phep|quy hoạch|quy hoach)\s*[:：\-–—]?\s*([^.;|\n]{3,160})/gi],
    ["progress", /(?:tiến độ|tien do|bàn giao|ban giao|cất nóc|cat noc|khởi công|khoi cong|mở bán|mo ban|kickoff)\s*[:：\-–—]?\s*([^.;|\n]{3,160})/gi],
    ["price", /(?:giá bán|gia ban|bảng giá|bang gia|mức giá|muc gia|giá tham khảo|gia tham khao)\s*[:：\-–—]?\s*([^.;|\n]{3,140})/gi],
    ["amenities", /(?:tiện ích|tien ich)\s*[:：\-–—]?\s*([^.;|\n]{3,180})/gi],
  ];

  for (const [key, regex] of labelPatterns) {
    for (const match of normalizedText.matchAll(regex)) {
      if (match[1]) addFact(facts, key, match[1], source);
    }
  }

  const compact = normalizedText;
  const areaMatches = compact.match(/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*(?:m2|m²|ha|hecta)/gi) || [];
  for (const value of areaMatches.slice(0, 4)) {
    const position = compact.indexOf(value);
    const around = compact.slice(Math.max(0, position - 70), position + value.length + 70);
    const closeAround = compact.slice(Math.max(0, position - 35), position + value.length + 35);
    if (/(?:can ho|căn hộ|dien tich can|diện tích căn|phòng ngủ|phong ngu)/i.test(around)) {
      addFact(facts, "unitArea", value, source);
      continue;
    }
    if (/(?:quy mô|quy mo|dien tich dat|diện tích đất|khu đất|khu dat|dat|đất)/i.test(closeAround)) addFact(facts, "landArea", value, source);
  }

  const unitRangeMatches = compact.match(/\b\d{1,3}(?:[.,]\d+)?\s*[-–]\s*\d{1,3}(?:[.,]\d+)?\s*(?:m2|m²)\b/gi) || [];
  for (const value of unitRangeMatches.slice(0, 3)) addFact(facts, "unitArea", value, source);

  const productMatches = compact.match(/\b\d{2,5}\s*(?:sản phẩm|san pham|căn hộ|can ho|căn|can|unit|shophouse|officetel)\b/gi) || [];
  for (const value of productMatches.slice(0, 5)) addFact(facts, "productCount", value, source);

  const towerMatches = compact.match(/\b\d{1,2}\s*(?:block|tháp|thap|tòa|toa|tower)\b/gi) || [];
  for (const value of towerMatches.slice(0, 3)) addFact(facts, "towers", value, source);

  const floorMatches = compact.match(/\b(?:cao\s*)?\d{1,2}\s*tầng\b/gi) || [];
  for (const value of floorMatches.slice(0, 5)) addFact(facts, "floors", value, source);

  const basementMatches = compact.match(/\b\d{1,2}\s*tầng\s*(?:hầm|khối đế|khoi de|thương mại|thuong mai)\b/gi) || [];
  for (const value of basementMatches.slice(0, 3)) addFact(facts, "basement", value, source);

  const priceMatches = compact.match(/\b\d{1,4}(?:[.,]\d+)?(?:\s*[-–]\s*\d{1,4}(?:[.,]\d+)?)?\s*(?:triệu|trieu|tỷ|ty|tỉ)\s*(?:đồng|dong)?(?:\s*\/\s*m2|\s*\/\s*m²|\/m2|\/m²)?\b/gi) || [];
  for (const value of priceMatches.slice(0, 4)) {
    const around = compact.slice(Math.max(0, compact.indexOf(value) - 60), compact.indexOf(value) + value.length + 60);
    if (/(?:giá|gia|bảng giá|bang gia|mức giá|muc gia|triệu\/m|trieu\/m|tỷ|ty|tỉ)/i.test(around)) addFact(facts, "price", value, source);
  }

  const unitTypes = ["căn hộ", "officetel", "shophouse", "penthouse", "duplex", "studio", "biệt thự", "nhà phố"].filter((term) =>
    new RegExp(term, "i").test(compact)
  );
  if (unitTypes.length > 0) addFact(facts, "unitTypes", Array.from(new Set(unitTypes)).join(", "), source);

  return facts;
}

export function extractRealEstateProjectFactsFromText(text: string, sourceName = "Nguồn thử nghiệm"): RealEstateFact[] {
  return extractLabelFacts(text, {
    name: sourceName,
    url: "",
    title: sourceName,
    text,
    tier: "web",
  });
}

function mergeFacts(sources: RealEstateSource[]): RealEstateFact[] {
  const allFacts: RealEstateFact[] = [];
  for (const source of sources) {
    for (const fact of extractLabelFacts(source.text, source)) {
      addFact(allFacts, fact.key, fact.value, source);
    }
  }
  return allFacts.sort((a, b) => {
    const order = Object.keys(FIELD_LABELS);
    const keyOrder = order.indexOf(a.key) - order.indexOf(b.key);
    if (keyOrder !== 0) return keyOrder;
    return tierRank(b.tier) - tierRank(a.tier);
  });
}

function factQualityScore(fact: RealEstateFact): number {
  const value = fact.value;
  const normalized = normalizeVi(value);
  let score = tierRank(fact.tier) * 3 + fact.sources.length;

  if (fact.key === "developer" && /\b(?:cong ty|ctcp|tnhh|tap doan|group|land|jsc|corp|dau tu|phat trien)\b/i.test(normalized)) score += 5;
  if (fact.key === "location") {
    if (/\b(?:duong|mat tien|phuong|quan|tp|thanh pho|vo chi cong|vinh phu|lai thieu|thu duc|binh trung)\b/i.test(normalized)) score += 5;
    if (/\b(?:dac dia|gan song|ket noi|truc dai lo)\b/i.test(normalized)) score -= 2;
  }
  if (fact.key === "landArea" && /(?:m2|m²|ha)/i.test(value)) score += 3;
  if (fact.key === "towers") {
    if (/^\d{1,2}\s*(?:block|tháp|thap|tòa|toa|tower)\b/i.test(value)) score += 5;
    if (/^\d{1,2}\s+[A-ZÀ-Ỹ]{3,}$/u.test(value)) score -= 6;
  }
  if (fact.key === "floors") {
    if (/(?:[-–]|cao|block|tháp|thap)/i.test(value)) score += 4;
    if (/^\d{1,2}\s*tầng$/i.test(value)) score -= 2;
  }
  if (fact.key === "productCount") {
    const numeric = Number((value.match(/\d{2,5}/)?.[0] || "0").replace(/[^\d]/g, ""));
    score += Math.min(Math.floor(numeric / 150), 5);
    if (/\b(?:sản phẩm|san pham)\b/i.test(value)) score += 4;
    if (/^\d{2,5}\s*(?:căn|can)\b/i.test(value)) score += 2;
    if (/^bao gồm/i.test(value)) score -= 2;
    if (/^0+\s*căn/i.test(value)) score -= 8;
  }
  if (fact.key === "unitArea" && /[-–]/.test(value)) score += 4;
  if (fact.key === "legalStatus" && /(?:sổ|so |sở hữu|so huu|lâu dài|lau dai)/i.test(value)) score += 4;
  if (fact.key === "progress") {
    if (/(?:q[1-4]|quý|quy|20\d{2}|bàn giao|ban giao)/i.test(value)) score += 3;
    if (/(?:đặt cọc|dat coc|hđmb|hdmb|thanh toán|thanh toan)/i.test(normalized)) score -= 3;
  }
  if (fact.key === "amenities" && /(?:hồ bơi|ho boi|công viên|cong vien|mảng xanh|mang xanh|clubhouse|ven sông|ven song)/i.test(value)) score += 3;

  return score;
}

function candidateScore(candidate: RealEstateSourceCandidate, query: string): number {
  const haystack = normalizeVi(`${candidate.title} ${candidate.snippet || ""} ${hostnameOf(candidate.url || "")}`);
  const tokens = projectTokens(query);
  const tokenScore = tokens.reduce((score, token) => score + (haystack.includes(token) ? 2 : 0), 0);
  const tierScore = tierRank(inferSourceTier(candidate, query));
  const detailScore = /\b(?:chu dau tu|vi tri|quy mo|phap ly|tien do|bang gia|gia ban|so can|mat bang|ban giao|can ho|block|tower)\b/i.test(haystack) ? 2 : 0;
  return tokenScore + tierScore + detailScore;
}

function dedupeCandidates(candidates: RealEstateSourceCandidate[], query: string): RealEstateSourceCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => candidate.url && /^https?:\/\//i.test(candidate.url))
    .sort((a, b) => candidateScore(b, query) - candidateScore(a, query))
    .filter((candidate) => {
      const url = candidate.url || "";
      let key = url;
      try {
        const parsed = new URL(url);
        key = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`;
      } catch {
        key = url;
      }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function sourceMatchesProject(source: RealEstateSource, query: string): boolean {
  const tokens = projectTokens(query);
  if (tokens.length === 0) return true;
  const haystack = normalizeVi(`${source.url} ${source.title} ${source.text}`);
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits >= Math.min(2, tokens.length);
}

function formatProfileContext(facts: RealEstateFact[], sources: RealEstateSource[]): string {
  if (facts.length === 0) return "";

  const grouped = new Map<string, RealEstateFact[]>();
  for (const fact of facts) {
    const list = grouped.get(fact.key) || [];
    list.push(fact);
    grouped.set(fact.key, list);
  }

  const factLines: string[] = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    const list = grouped.get(key);
    if (!list || list.length === 0) continue;
    const maxValues = key === "unitTypes" ? 2 : 1;
    const primary = list
      .sort((a, b) => factQualityScore(b) - factQualityScore(a))
      .slice(0, maxValues)
      .map((fact) => `${fact.value} (Nguồn: ${fact.sources.slice(0, 2).join(", ")})`)
      .join(" / ");
    factLines.push(`- ${FIELD_LABELS[key]}: ${primary}`);
  }

  const sourceNames = Array.from(new Set(sources.map((source) => source.name))).slice(0, 6);

  return [
    "🏗️ HỒ SƠ DỰ ÁN BẤT ĐỘNG SẢN ĐÃ MỞ TRANG VÀ TRÍCH XUẤT THEO SCHEMA:",
    ...factLines,
    `Nguồn đã mở: ${sourceNames.join(", ")}`,
    "Quy tắc trả lời: ưu tiên dữ liệu trong hồ sơ này; không tự điền trường còn thiếu; giá/chính sách/pháp lý nếu lấy từ landing page hoặc sàn môi giới thì nói là tham khảo và nên xác nhận lại từ chủ đầu tư/tài liệu chính thức.",
  ].join("\n");
}

function extractProjectNameFromQuery(query: string): string {
  const cleaned = compactText(query)
    .replace(/@[^\s,!?]+/g, " ")
    .replace(/\b(?:sen chúa|sen chua|mộc miên|moc mien|kevin|bot ơi|bot oi|bot|admin|ad ơi|ad oi)\b/gi, " ")
    .replace(/\b(?:cho\s+(?:anh|a|tôi|toi|mình|minh)|giúp\s+(?:anh|a|tôi|toi|mình|minh)|với|nhé|nha|ạ)\b/gi, " ")
    .replace(/\b(?:tổng quan|tong quan|giới thiệu|gioi thieu|thông tin|thong tin|review|đánh giá|danh gia|dự án|du an|chung cư|chung cu|căn hộ|can ho)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "dự án";
}

function simplifyProfileValue(value: string): string {
  return compactText(value)
    .replace(/\s*\(Nguồn:\s*[^)]+\)/gi, "")
    .replace(/\s*\/\s*/g, " / ")
    .trim();
}

function sourceLineFromProfile(profileContext: string): string {
  const match = profileContext.match(/^Nguồn đã mở:\s*(.+)$/im);
  if (!match?.[1]) return "";
  const sources = match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
  return sources.length > 0 ? `Nguồn tham khảo: ${sources.join(", ")}.` : "";
}

export function formatRealEstateProjectProfileAnswer(profileContext: string, query: string): string {
  if (!/HỒ SƠ DỰ ÁN BẤT ĐỘNG SẢN ĐÃ MỞ TRANG VÀ TRÍCH XUẤT THEO SCHEMA/i.test(profileContext || "")) {
    return "";
  }

  const block = String(profileContext).split(/\n\n🔥|\n🔥/)[0] || "";
  const factLines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s+[^:]+:\s+.+/.test(line));

  if (factLines.length < 3) return "";

  const labelMap: Record<string, string> = {
    "Chủ đầu tư / đơn vị phát triển": "Chủ đầu tư",
    "Số block/tháp": "Quy mô xây dựng",
    "Số tầng": "Chiều cao",
    "Tầng hầm / khối đế": "Tầng hầm/khối đế",
    "Số lượng sản phẩm": "Sản phẩm",
    "Loại sản phẩm": "Loại hình",
    "Diện tích căn": "Diện tích căn",
    "Tiến độ / thời điểm bàn giao": "Tiến độ/bàn giao",
  };

  const renderedFacts = factLines
    .map((line) => {
      const match = line.match(/^-\s+([^:]+):\s+(.+)$/);
      if (!match?.[1] || !match?.[2]) return "";
      const label = labelMap[match[1].trim()] || match[1].trim();
      const value = simplifyProfileValue(match[2]);
      if (!value) return "";
      return `- ${label}: ${value}`;
    })
    .filter(Boolean)
    .slice(0, 12);

  if (renderedFacts.length < 3) return "";

  const projectName = extractProjectNameFromQuery(query);
  const sourceLine = sourceLineFromProfile(profileContext);
  return [
    `TỔNG QUAN DỰ ÁN ${projectName.toUpperCase()}`,
    "",
    ...renderedFacts,
    "",
    sourceLine,
    "Lưu ý: Những mục chưa có trong hồ sơ nguồn thì em không tự điền thêm; giá/pháp lý/chính sách bán hàng nên xác nhận lại từ chủ đầu tư hoặc tài liệu chính thức.",
  ].filter((line) => line !== "").join("\n");
}

export async function buildRealEstateProjectProfileContext(
  query: string,
  seedCandidates: RealEstateSourceCandidate[] = []
): Promise<string> {
  if (!isRealEstateProjectProfileQuery(query)) return "";

  const cacheKey = normalizeVi(query).replace(/\s+/g, " ").trim();
  const cached = REAL_ESTATE_PROFILE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < REAL_ESTATE_PROFILE_CACHE_TTL_MS) {
    return cached.context;
  }

  const queries = buildRealEstateProjectSearchQueries(query);
  const searchSettled = await Promise.allSettled(queries.map((q) => webSearch(q, 5)));
  const searchCandidates = searchSettled.flatMap((res) => (res.status === "fulfilled" ? res.value : []));
  const candidates = dedupeCandidates([...seedCandidates, ...searchCandidates], query);
  if (candidates.length === 0) return "";

  const fetchedSettled = await Promise.allSettled(
    candidates.slice(0, 4).map(async (candidate) => {
      const url = candidate.url || "";
      const article = await fetchUrl(url, 9000);
      const tier = inferSourceTier(candidate, query);
      const title = compactText(article.title || candidate.title || sourceNameOf(candidate));
      const snippet = compactText(candidate.snippet || "");
      const content = compactText(article.content || "");
      return {
        name: sourceNameOf(candidate),
        url,
        title,
        text: compactText(`${title}. ${snippet}. ${content}`),
        tier,
      } satisfies RealEstateSource;
    })
  );

  const sources = fetchedSettled
    .flatMap((res) => (res.status === "fulfilled" ? [res.value] : []))
    .filter((source) =>
      source.text.length > 120 &&
      !/^lỗi đọc nội dung|không thể tải trang/i.test(source.text) &&
      sourceMatchesProject(source, query)
    );

  const context = formatProfileContext(mergeFacts(sources), sources);
  if (context) {
    REAL_ESTATE_PROFILE_CACHE.set(cacheKey, { createdAt: Date.now(), context });
  }
  return context;
}

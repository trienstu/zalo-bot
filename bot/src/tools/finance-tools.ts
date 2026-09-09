/**
 * Công cụ tra cứu dữ liệu thị trường tài chính & tiền số thời gian thực.
 * Kiến trúc Multi-Exchange Fallback: Binance Spot -> OKX Spot -> Bybit Spot -> CoinGecko.
 * Hoàn toàn miễn phí, không cần API Key, hoạt động bền bỉ trên mọi máy chủ VPS kể cả khi Binance bị chặn IP (HTTP 451).
 */

export interface CryptoTickerResult {
  symbol: string;
  pair: string;
  price: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24hUsd: number;
  source: string;
  updatedAt: string;
}

export interface FearAndGreedResult {
  score: number;
  classification: string;
  updatedAt: string;
}

export interface ForexResult {
  base: string;
  rates: Record<string, number>;
  updatedAt: string;
}

const COMMON_CRYPTO_SYMBOLS: Record<string, string> = {
  btc: "BTC",
  bitcoin: "BTC",
  eth: "ETH",
  ethereum: "ETH",
  sol: "SOL",
  solana: "SOL",
  bnb: "BNB",
  binance: "BNB",
  xrp: "XRP",
  ripple: "XRP",
  doge: "DOGE",
  dogecoin: "DOGE",
  ada: "ADA",
  cardano: "ADA",
  sui: "SUI",
  near: "NEAR",
  pepe: "PEPE",
  link: "LINK",
  avax: "AVAX",
  dot: "DOT",
};

const COINGECKO_MAP: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  bnb: "binancecoin",
  sol: "solana",
  xrp: "ripple",
  doge: "dogecoin",
  ada: "cardano",
  sui: "sui",
  near: "near",
  pepe: "pepe",
  link: "chainlink",
  avax: "avalanche-2",
  dot: "polkadot",
};

/**
 * Tra cứu bảng giá 24h của đồng tiền số với cơ chế Đa sàn dự phòng (Binance -> OKX -> Bybit -> CoinGecko)
 */
export async function getCryptoTicker(querySymbol = "BTC"): Promise<CryptoTickerResult | null> {
  const cleanSym = querySymbol.toLowerCase().replace(/[^a-z0-9]/g, "");
  const baseSym = COMMON_CRYPTO_SYMBOLS[cleanSym] || cleanSym.toUpperCase();
  const pair = `${baseSym}USDT`;

  const nowStr = new Date().toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // TẦNG 1: Thử Binance Public API
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, {
      signal: AbortSignal.timeout(4000),
      headers: {
        "User-Agent": "ZaloBot-Agent/1.0",
        "Accept": "application/json",
      },
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      if (data && data.lastPrice) {
        return {
          symbol: baseSym,
          pair,
          price: parseFloat(data.lastPrice) || 0,
          change24hPercent: parseFloat(data.priceChangePercent) || 0,
          high24h: parseFloat(data.highPrice) || 0,
          low24h: parseFloat(data.lowPrice) || 0,
          volume24h: parseFloat(data.volume) || 0,
          quoteVolume24hUsd: parseFloat(data.quoteVolume) || 0,
          source: "Binance Spot",
          updatedAt: `${nowStr} (Giờ VN)`,
        };
      }
    }
  } catch {
    // Binance có thể bị lỗi mạng hoặc chặn IP (HTTP 451)
  }

  // TẦNG 2: Fallback sang OKX Spot API (Không chặn IP Cloud VPS)
  try {
    const okxRes = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${baseSym}-USDT`, {
      signal: AbortSignal.timeout(4000),
      headers: { "Accept": "application/json" },
    });
    if (okxRes.ok) {
      const data = (await okxRes.json()) as any;
      const it = data?.data?.[0];
      if (it && it.last) {
        const last = parseFloat(it.last) || 0;
        const open = parseFloat(it.open24h) || last;
        const change = open > 0 ? ((last - open) / open) * 100 : 0;
        return {
          symbol: baseSym,
          pair,
          price: last,
          change24hPercent: change,
          high24h: parseFloat(it.high24h) || last,
          low24h: parseFloat(it.low24h) || last,
          volume24h: parseFloat(it.vol24h) || 0,
          quoteVolume24hUsd: parseFloat(it.volCcy24h) || 0,
          source: "OKX Spot",
          updatedAt: `${nowStr} (Giờ VN)`,
        };
      }
    }
  } catch {
    // OKX timeout
  }

  // TẦNG 3: Fallback sang Bybit Spot API (Không chặn IP Cloud VPS)
  try {
    const bybitRes = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${baseSym}USDT`, {
      signal: AbortSignal.timeout(4000),
      headers: { "Accept": "application/json" },
    });
    if (bybitRes.ok) {
      const data = (await bybitRes.json()) as any;
      const it = data?.result?.list?.[0];
      if (it && it.lastPrice) {
        return {
          symbol: baseSym,
          pair,
          price: parseFloat(it.lastPrice) || 0,
          change24hPercent: (parseFloat(it.price24hPcnt) || 0) * 100,
          high24h: parseFloat(it.highPrice24h) || 0,
          low24h: parseFloat(it.lowPrice24h) || 0,
          volume24h: parseFloat(it.volume24h) || 0,
          quoteVolume24hUsd: parseFloat(it.turnover24h) || 0,
          source: "Bybit Spot",
          updatedAt: `${nowStr} (Giờ VN)`,
        };
      }
    }
  } catch {
    // Bybit timeout
  }

  // TẦNG 4: Fallback sang CoinGecko Simple Price API
  try {
    const cgId = COINGECKO_MAP[cleanSym] || cleanSym;
    const cgRes = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`,
      {
        signal: AbortSignal.timeout(4000),
        headers: { "Accept": "application/json" },
      },
    );
    if (cgRes.ok) {
      const data = (await cgRes.json()) as any;
      if (data && data[cgId]) {
        const item = data[cgId];
        const price = parseFloat(item.usd) || 0;
        return {
          symbol: baseSym,
          pair,
          price,
          change24hPercent: parseFloat(item.usd_24h_change) || 0,
          high24h: price,
          low24h: price,
          volume24h: 0,
          quoteVolume24hUsd: 0,
          source: "CoinGecko",
          updatedAt: `${nowStr} (Giờ VN)`,
        };
      }
    }
  } catch (cgErr) {
    console.warn(`[finance-tools] Fallback CoinGecko error for ${querySymbol}:`, cgErr);
  }

  return null;
}

/**
 * Tra cứu Chỉ số Tham lam & Sợ hãi (Crypto Fear & Greed Index) từ Alternative.me
 */
export async function getFearAndGreedIndex(): Promise<FearAndGreedResult | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      signal: AbortSignal.timeout(5000),
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const item = data?.data?.[0];
    if (!item) return null;

    return {
      score: parseInt(item.value, 10) || 50,
      classification: item.value_classification || "Neutral",
      updatedAt: new Date(parseInt(item.timestamp, 10) * 1000).toLocaleDateString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      }),
    };
  } catch (err) {
    console.warn("[finance-tools] getFearAndGreedIndex error:", err);
    return null;
  }
}

/**
 * Tra cứu tỷ giá ngoại tệ thực tế (USD, EUR, JPY -> VND)
 */
export async function getForexRates(): Promise<ForexResult | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(5000),
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return {
      base: data.base_code || "USD",
      rates: data.rates || {},
      updatedAt: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    };
  } catch (err) {
    console.warn("[finance-tools] getForexRates error:", err);
    return null;
  }
}

/**
 * Tự động bóc tách các đồng coin được nhắc tới trong câu hỏi người dùng
 */
function extractMentionedCoins(query: string): string[] {
  const lower = query.toLowerCase();
  const coins: string[] = [];

  const coinPatterns: Array<{ key: string; regex: RegExp }> = [
    { key: "BTC", regex: /\b(?:btc|bitcoin)\b/i },
    { key: "ETH", regex: /\b(?:eth|ethereum|ether)\b/i },
    { key: "BNB", regex: /\b(?:bnb|binance\s*coin)\b/i },
    { key: "SOL", regex: /\b(?:sol|solana)\b/i },
    { key: "XRP", regex: /\b(?:xrp|ripple)\b/i },
    { key: "DOGE", regex: /\b(?:doge|dogecoin)\b/i },
    { key: "ADA", regex: /\b(?:ada|cardano)\b/i },
    { key: "SUI", regex: /\b(?:sui)\b/i },
    { key: "NEAR", regex: /\b(?:near)\b/i },
    { key: "PEPE", regex: /\b(?:pepe)\b/i },
    { key: "AVAX", regex: /\b(?:avax|avalanche)\b/i },
  ];

  for (const cp of coinPatterns) {
    if (cp.regex.test(lower)) {
      coins.push(cp.key);
    }
  }

  // Nếu không chỉ định cụ thể đồng nào, mặc định gom các đồng đầu ngành (BTC, ETH, BNB, SOL)
  if (coins.length === 0) {
    return ["BTC", "ETH", "BNB", "SOL"];
  }

  // Nếu người dùng hỏi 1-2 coin nhưng không có BTC, vẫn nên bổ sung BTC làm mốc tham chiếu thị trường
  if (!coins.includes("BTC")) {
    coins.unshift("BTC");
  }

  return coins;
}

/**
 * Tạo bản tóm tắt dữ liệu thị trường tài chính / crypto định dạng chuẩn
 */
export async function getFinancialMarketSummary(query = ""): Promise<string> {
  const lower = query.toLowerCase();
  const sections: string[] = [];

  const isCryptoQuery =
    /(?:crypto|tiền số|tiền ảo|bitcoin|btc|eth|ethereum|sol|solana|bnb|altcoin|coin|token|thị trường số|thị trường tiền|giá coin)/i.test(
      lower,
    );

  if (isCryptoQuery || !lower) {
    const targetCoins = extractMentionedCoins(query);
    const [tickerResults, fng] = await Promise.all([
      Promise.all(targetCoins.map((coin) => getCryptoTicker(coin))),
      getFearAndGreedIndex(),
    ]);

    const cryptoLines: string[] = [];
    for (const t of tickerResults) {
      if (!t) continue;
      const sign = t.change24hPercent >= 0 ? "+" : "";
      const rangeStr =
        t.low24h > 0 && t.high24h > 0 && t.low24h !== t.high24h
          ? ` | Đáy-Đỉnh 24h: $${t.low24h.toLocaleString("en-US")} - $${t.high24h.toLocaleString("en-US")}`
          : "";
      cryptoLines.push(
        `- ${t.symbol} (${t.pair}): $${t.price.toLocaleString("en-US")} USD ` +
          `(${sign}${t.change24hPercent.toFixed(2)}% trong 24h${rangeStr} | Nguồn: ${t.source} lúc ${t.updatedAt})`,
      );
    }

    if (fng) {
      cryptoLines.push(
        `- Chỉ số Sợ hãi & Tham lam (Crypto Fear & Greed Index): ${fng.score}/100 (${fng.classification}) - Nguồn: Alternative.me`,
      );
    }

    if (cryptoLines.length > 0) {
      sections.push(
        `=== BẢNG GIÁ VÀ CHỈ SỐ THỊ TRƯỜNG CRYPTO THỰC TẾ (LIVE DATA TỪ SÀN) ===\n` +
          cryptoLines.join("\n") +
          `\n* BẮT BUỘC: Khi trả lời về giá cả hoặc phân tích kỹ thuật, bạn PHẢI lấy đúng các con số trên, TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ BỊA ĐẶT MỨC GIÁ KHÁC!`,
      );
    }
  }

  const isForexQuery = /(?:tỷ giá|ngoại tệ|đô la|usd|vnd|tiền đô|tỷ giá hôm nay)/i.test(lower);
  if (isForexQuery) {
    const forex = await getForexRates();
    if (forex?.rates?.VND) {
      sections.push(
        `=== TỶ GIÁ NGOẠI TỆ THỜI GIAN THỰC ===\n` +
          `- 1 USD = ${Math.round(forex.rates.VND).toLocaleString("vi-VN")} VND\n` +
          `- Cập nhật: ${forex.updatedAt}`,
      );
    }
  }

  return sections.join("\n\n");
}

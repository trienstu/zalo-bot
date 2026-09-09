/**
 * Công cụ tra cứu dữ liệu thị trường tài chính & tiền số thời gian thực (Binance, Alternative.me, Open Forex).
 * Hoàn toàn miễn phí, không cần API Key, dữ liệu sàn thực tế 100% từng giây, chống triệt để ảo giác AI.
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
  btc: "BTCUSDT",
  bitcoin: "BTCUSDT",
  eth: "ETHUSDT",
  ethereum: "ETHUSDT",
  sol: "SOLUSDT",
  solana: "SOLUSDT",
  bnb: "BNBUSDT",
  binance: "BNBUSDT",
  xrp: "XRPUSDT",
  ripple: "XRPUSDT",
  doge: "DOGEUSDT",
  dogecoin: "DOGEUSDT",
  ada: "ADAUSDT",
  cardano: "ADAUSDT",
  sui: "SUIUSDT",
  near: "NEARUSDT",
  pepe: "PEPEUSDT",
  link: "LINKUSDT",
  avax: "AVAXUSDT",
  dot: "DOTUSDT",
};

/**
 * Tra cứu bảng giá 24h của đồng tiền số từ sàn Binance Public API
 */
export async function getCryptoTicker(querySymbol = "BTC"): Promise<CryptoTickerResult | null> {
  try {
    const cleanSym = querySymbol.toLowerCase().replace(/[^a-z0-9]/g, "");
    const pair = COMMON_CRYPTO_SYMBOLS[cleanSym] || `${cleanSym.toUpperCase()}USDT`;

    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`, {
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent": "ZaloBot-Agent/1.0",
        "Accept": "application/json",
      },
    });

    if (!res.ok) return null;
    const data = (await res.json()) as any;

    const nowStr = new Date().toLocaleTimeString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    return {
      symbol: querySymbol.toUpperCase(),
      pair,
      price: parseFloat(data.lastPrice) || 0,
      change24hPercent: parseFloat(data.priceChangePercent) || 0,
      high24h: parseFloat(data.highPrice) || 0,
      low24h: parseFloat(data.lowPrice) || 0,
      volume24h: parseFloat(data.volume) || 0,
      quoteVolume24hUsd: parseFloat(data.quoteVolume) || 0,
      source: "Binance Spot Ticker",
      updatedAt: `${nowStr} (Giờ VN)`,
    };
  } catch (err) {
    console.warn(`[finance-tools] getCryptoTicker error for ${querySymbol}:`, err);
    return null;
  }
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
 * Tạo bản tóm tắt dữ liệu thị trường tài chính / crypto định dạng chuẩn
 * Tự động gom nhiều đồng tiền số phổ biến nếu câu hỏi chung chung về "thị trường tiền số / crypto"
 */
export async function getFinancialMarketSummary(query = ""): Promise<string> {
  const lower = query.toLowerCase();
  const sections: string[] = [];

  const isCryptoQuery =
    /(?:crypto|tiền số|tiền ảo|bitcoin|btc|eth|ethereum|sol|solana|bnb|altcoin|coin|thị trường số|thị trường tiền)/i.test(
      lower,
    );

  if (isCryptoQuery || !lower) {
    const [btcInfo, ethInfo, solInfo, fng] = await Promise.all([
      getCryptoTicker("BTC"),
      getCryptoTicker("ETH"),
      getCryptoTicker("SOL"),
      getFearAndGreedIndex(),
    ]);

    const cryptoLines: string[] = [];
    if (btcInfo) {
      const sign = btcInfo.change24hPercent >= 0 ? "+" : "";
      cryptoLines.push(
        `- Bitcoin (BTC/USDT): $${btcInfo.price.toLocaleString("en-US")} USD ` +
          `(${sign}${btcInfo.change24hPercent.toFixed(2)}% trong 24h | ` +
          `Đáy-Đỉnh 24h: $${btcInfo.low24h.toLocaleString("en-US")} - $${btcInfo.high24h.toLocaleString("en-US")} | ` +
          `Nguồn: Binance Spot lúc ${btcInfo.updatedAt})`,
      );
    }

    if (ethInfo) {
      const sign = ethInfo.change24hPercent >= 0 ? "+" : "";
      cryptoLines.push(
        `- Ethereum (ETH/USDT): $${ethInfo.price.toLocaleString("en-US")} USD ` +
          `(${sign}${ethInfo.change24hPercent.toFixed(2)}% trong 24h | ` +
          `Đáy-Đỉnh 24h: $${ethInfo.low24h.toLocaleString("en-US")} - $${ethInfo.high24h.toLocaleString("en-US")})`,
      );
    }

    if (solInfo) {
      const sign = solInfo.change24hPercent >= 0 ? "+" : "";
      cryptoLines.push(
        `- Solana (SOL/USDT): $${solInfo.price.toLocaleString("en-US")} USD ` +
          `(${sign}${solInfo.change24hPercent.toFixed(2)}% trong 24h)`,
      );
    }

    if (fng) {
      cryptoLines.push(
        `- Chỉ số Sợ hãi & Tham lam (Crypto Fear & Greed Index): ${fng.score}/100 (${fng.classification}) - Nguồn: Alternative.me`,
      );
    }

    if (cryptoLines.length > 0) {
      sections.push(
        `=== BẢNG GIÁ VÀ CHỈ SỐ THỊ TRƯỜNG CRYPTO THỰC TẾ (NGUỒN BINANCE SPOT LIVE) ===\n` +
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

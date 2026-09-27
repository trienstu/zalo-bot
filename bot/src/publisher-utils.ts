/**
 * Utility functions for domain classification and publisher name extraction.
 * Extracted into a dedicated leaf module to prevent circular dependencies.
 */

export function isJunkOrBettingDomain(domainOrTitle: string): boolean {
  if (!domainOrTitle) return true;
  const lower = domainOrTitle.toLowerCase().trim();
  const junkPatterns = [
    /(?:keo\d+|keonhacai|tylekeo|soikeo|nhacai|cacuoc|cadobongda|nhacaiuytin)/i,
    /(?:xoilac|tiengruoi|mitom|vebo|thapcam|banhkhuc|cakhia|rakhoi|xoivo|suongtv|khangtv|shutli)/i,
    /(?:bet88|bong88|w88|fb88|fun88|bk8|kubet|thabet|shbet|new88|789bet|jun88|hi88|okvip|f8bet|12bet|dafabis|m88|188bet|k8cc|mu88)/i,
    /(?:keo90phut|xoilacvl|xoilacz|cakhiatv|vebotv)/i,
    /(?:mebongda|ketquanhanh|bongdawap|bongdalu|7m\.cn|nowgoal|flashscore|tysobongda)/i,
  ];
  return junkPatterns.some((re) => re.test(lower));
}

/** Bóc tách tên nhà xuất bản / tòa soạn báo chí từ uri và title để trích dẫn ngắn gọn (không in link URL) */
export function extractPublisherName(title?: string, uri?: string): string {
  if ((title && isJunkOrBettingDomain(title)) || (uri && isJunkOrBettingDomain(uri))) {
    return "";
  }
  const domainMap: Record<string, string> = {
    "vnexpress.net": "VnExpress",
    "cafef.vn": "CafeF",
    "cafebiz.vn": "CafeBiz",
    "vietstock.vn": "Vietstock",
    "thanhnien.vn": "Thanh Niên",
    "tuoitre.vn": "Tuổi Trẻ",
    "vietnamnet.vn": "VietNamNet",
    "dantri.com.vn": "Dân Trí",
    "vtv.vn": "VTV",
    "vov.vn": "VOV",
    "vneconomy.vn": "VnEconomy",
    "laodong.vn": "Lao Động",
    "tienphong.vn": "Tiền Phong",
    "plo.vn": "Pháp Luật TP.HCM",
    "baochinhphu.vn": "Báo Chính Phủ",
    "nhandan.vn": "Báo Nhân Dân",
    "tinnhanhchungkhoan.vn": "Đầu Tư Chứng Khoán",
    "baodautu.vn": "Báo Đầu Tư",
    "znews.vn": "Znews",
    "zingnews.vn": "Znews",
    "genk.vn": "GenK",
    "tinhte.vn": "Tinh tế",
    "bongda.com.vn": "Bóng Đá",
    "bongdaplus.vn": "Bóng Đá Plus",
    "bongda24h.vn": "Bóng Đá 24h",
    "goal.com": "Goal.com",
    "fotmob.com": "FotMob",
    "onefootball.com": "OneFootball",
    "baomoi.com": "Báo Mới",
    "24h.com.vn": "24h",
    "foxsports.com": "Fox Sports",
    "laliga.com": "LaLiga",
    "bloomberg.com": "Bloomberg",
    "reuters.com": "Reuters",
    "cnbc.com": "CNBC",
    "wsj.com": "Wall Street Journal",
    "ft.com": "Financial Times",
    "forbes.com": "Forbes",
    "investing.com": "Investing.com",
    "marketwatch.com": "MarketWatch",
    "finance.yahoo.com": "Yahoo Finance",
    "wikipedia.org": "Wikipedia",
  };

  const rawTitle = (title || "").trim().toLowerCase();

  // 1. Kiểm tra nếu title chính là tên miền (Google Search Grounding thường trả title = "bongda.com.vn", "goal.com", v.v.)
  for (const [d, name] of Object.entries(domainMap)) {
    if (rawTitle === d || rawTitle.includes(d)) {
      return name;
    }
  }

  // 2. Nếu URI không phải là link redirect nội bộ của Vertex AI thì kiểm tra domain từ URI
  if (uri && !uri.includes("vertexaisearch.cloud.google.com")) {
    try {
      const hostname = new URL(uri).hostname.toLowerCase().replace(/^www\./, "");
      if (isJunkOrBettingDomain(hostname)) return "";
      for (const [d, name] of Object.entries(domainMap)) {
        if (hostname === d || hostname.endsWith("." + d)) {
          return name;
        }
      }
    } catch {}
  }

  // 3. Nếu title có cấu trúc "Tiêu đề bài viết - Tên Báo"
  if (title) {
    const parts = title.split(/\s*[-–—|]\s*/);
    if (parts.length > 1) {
      const lastPart = parts[parts.length - 1]?.trim() || "";
      if (lastPart.length > 1 && lastPart.length < 30 && !isJunkOrBettingDomain(lastPart)) {
        return lastPart.replace(/^báo\s+/i, "");
      }
    }
    // Nếu title là một domain bất kỳ (e.g. somesite.com)
    if (/^[a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?$/i.test(title.trim())) {
      const host = title.trim().replace(/^www\./i, "");
      if (isJunkOrBettingDomain(host)) return "";
      const base = host.split(".")[0];
      return base ? base.charAt(0).toUpperCase() + base.slice(1) : host;
    }
    if (isJunkOrBettingDomain(title)) return "";
    return title.length > 25 ? title.slice(0, 25) + "..." : title;
  }

  return "";
}

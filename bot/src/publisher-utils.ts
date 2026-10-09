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
    // Báo chí chính thống & Tin tức
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
    "chinhphu.vn": "Cổng TTĐT Chính Phủ",
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

    // Giáo dục & Học thuật & Khảo thí
    "moet.gov.vn": "Bộ GD&ĐT",
    "hanoi.edu.vn": "Sở GD&ĐT Hà Nội",
    "hcm.edu.vn": "Sở GD&ĐT TP.HCM",
    "vietjack.com": "VietJack",
    "loigiaihay.com": "Lời Giải Hay",
    "vnteach.com": "VnTeach",
    "hoc247.net": "Học 247",
    "tuyensinh247.com": "Tuyển Sinh 247",
    "onluyen.vn": "Ôn Luyện",
    "azota.vn": "Azota",
    "substudy.vn": "SubStudy",

    // Pháp luật & Cơ quan Nhà nước
    "thuvienphapluat.vn": "Thư viện Pháp luật",
    "luatvietnam.vn": "Luật Việt Nam",
    "moh.gov.vn": "Bộ Y Tế",
    "molisa.gov.vn": "Bộ LĐ-TB&XH",
    "mof.gov.vn": "Bộ Tài Chính",
    "sbv.gov.vn": "Ngân hàng Nhà nước",
    "gdt.gov.vn": "Tổng cục Thuế",
    "nchmf.gov.vn": "TTKTTV Quốc Gia",

    // Công nghệ & Mã nguồn mở
    "github.com": "GitHub",
    "gitlab.com": "GitLab",
    "arxiv.org": "arXiv",
    "nature.com": "Nature",
    "sciencedirect.com": "ScienceDirect",
    "who.int": "WHO",
    "cdc.gov": "CDC",
  };

  /** Làm sạch ký tự HTML entity và dấu ngoặc đơn thừa */
  const sanitizeName = (raw: string): string => {
    let s = raw.trim();
    s = s.replaceAll("&amp;", "&")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
    // Khử dấu ngoặc đóng dư thừa ở cuối nếu không có dấu ngoặc mở
    if (s.endsWith(")") && !s.includes("(")) {
      s = s.slice(0, -1).trim();
    }
    return s;
  };

  // 1. Phân tích URI (Kể cả URI redirect của Vertex AI Search / Google Search)
  if (uri) {
    try {
      const parsed = new URL(uri);
      let targetHost = parsed.hostname.toLowerCase().replace(/^www\./, "");

      // Nếu là link redirect của Vertex hoặc Google, cố gắng bóc tách URL đích thực từ query parameter
      if (targetHost.includes("vertexaisearch") || targetHost.includes("google.")) {
        const destParam = parsed.searchParams.get("url") ||
          parsed.searchParams.get("q") ||
          parsed.searchParams.get("dest") ||
          parsed.searchParams.get("target");
        if (destParam && (destParam.startsWith("http://") || destParam.startsWith("https://"))) {
          try {
            targetHost = new URL(destParam).hostname.toLowerCase().replace(/^www\./, "");
          } catch {}
        }
      }

      if (!isJunkOrBettingDomain(targetHost) && !targetHost.includes("vertexaisearch") && !targetHost.includes("google.")) {
        for (const [d, name] of Object.entries(domainMap)) {
          if (targetHost === d || targetHost.endsWith("." + d)) {
            return sanitizeName(name);
          }
        }
        // Nếu là domain cấp 1 hợp lệ của cơ quan/tổ chức (.gov.vn, .edu.vn, .org, v.v.)
        if (targetHost.endsWith(".gov.vn")) {
          return sanitizeName(targetHost.replace(".gov.vn", "").toUpperCase() + " (Gov)");
        }
        if (targetHost.endsWith(".edu.vn")) {
          return sanitizeName(targetHost.replace(".edu.vn", "") + ".edu.vn");
        }
      }
    } catch {}
  }

  // 2. Kiểm tra nếu title chính là tên miền hoặc chứa tên tòa soạn đã xác thực
  const rawTitle = (title || "").trim();
  if (rawTitle) {
    const lowerTitle = rawTitle.toLowerCase();
    for (const [d, name] of Object.entries(domainMap)) {
      if (lowerTitle === d || lowerTitle.endsWith(" - " + d) || lowerTitle.endsWith(" | " + d)) {
        return sanitizeName(name);
      }
      if (lowerTitle.endsWith(" - " + name.toLowerCase()) || lowerTitle.endsWith(" | " + name.toLowerCase())) {
        return sanitizeName(name);
      }
    }

    // Nếu title kết thúc bằng " - Tên Tòa Soạn" hoặc " | Tên Tòa Soạn"
    const parts = rawTitle.split(/\s*[-–—|]\s*/);
    if (parts.length > 1) {
      const lastPart = parts[parts.length - 1]?.trim() || "";
      const lowerLast = lastPart.toLowerCase().replace(/^báo\s+/i, "");
      for (const name of Object.values(domainMap)) {
        if (lowerLast === name.toLowerCase()) {
          return sanitizeName(name);
        }
      }
    }

    // Nếu title chính là một domain sạch hợp lệ có đuôi tên miền
    if (/^[a-z0-9-]+\.(?:vn|com|org|edu|gov|net)(?:\.[a-z]{2,})?$/i.test(rawTitle)) {
      const host = rawTitle.replace(/^www\./i, "").toLowerCase();
      if (!isJunkOrBettingDomain(host)) {
        for (const [d, name] of Object.entries(domainMap)) {
          if (host === d || host.endsWith("." + d)) {
            return sanitizeName(name);
          }
        }
        return sanitizeName(host);
      }
    }
  }

  // Tuyệt đối không cắt chuỗi thô thiển title.slice(0, 25) để tránh tạo nguồn rác ("có đáp án...", "Đại lý", "2026...")
  return "";
}

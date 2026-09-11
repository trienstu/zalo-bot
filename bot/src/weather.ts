/**
 * Weather & Air Quality (AQI) Assistant Module
 * Powered by Open-Meteo Free APIs (No API key required, reliable global data)
 */

export interface WeatherData {
  city: string;
  date?: string;
  dateLabel?: string;
  temp: number;
  feelsLike: number;
  tempMin: number;
  tempMax: number;
  humidity: number;
  windSpeed: number;
  rainProb: number;
  uvIndex: number;
  weatherDesc: string;
  weatherIcon: string;
  aqiDesc: string;
  aqiIcon: string;
  pm25: number;
  advisories: string[];
}

// Tọa độ các tỉnh thành phổ biến tại Việt Nam
const VIETNAM_CITIES_COORDS: Record<string, { name: string; lat: number; lon: number }> = {
  hcm: { name: "TP. Hồ Chí Minh", lat: 10.8231, lon: 106.6297 },
  saigon: { name: "TP. Hồ Chí Minh", lat: 10.8231, lon: 106.6297 },
  "ho chi minh": { name: "TP. Hồ Chí Minh", lat: 10.8231, lon: 106.6297 },
  "tp. ho chi minh": { name: "TP. Hồ Chí Minh", lat: 10.8231, lon: 106.6297 },
  "tp ho chi minh": { name: "TP. Hồ Chí Minh", lat: 10.8231, lon: 106.6297 },
  "tphcm": { name: "TP. Hồ Chí Minh", lat: 10.8231, lon: 106.6297 },
  hanoi: { name: "Hà Nội", lat: 21.0285, lon: 105.8542 },
  "ha noi": { name: "Hà Nội", lat: 21.0285, lon: 105.8542 },
  danang: { name: "Đà Nẵng", lat: 16.0544, lon: 108.2022 },
  "da nang": { name: "Đà Nẵng", lat: 16.0544, lon: 108.2022 },
  dalat: { name: "Đà Lạt", lat: 11.9404, lon: 108.4583 },
  "da lat": { name: "Đà Lạt", lat: 11.9404, lon: 108.4583 },
  haiphong: { name: "Hải Phòng", lat: 20.8449, lon: 106.6881 },
  "hai phong": { name: "Hải Phòng", lat: 20.8449, lon: 106.6881 },
  cantho: { name: "Cần Thơ", lat: 10.0452, lon: 105.7469 },
  "can tho": { name: "Cần Thơ", lat: 10.0452, lon: 105.7469 },
  nhatrang: { name: "Nha Trang", lat: 12.2388, lon: 109.1967 },
  "nha trang": { name: "Nha Trang", lat: 12.2388, lon: 109.1967 },
  binhduong: { name: "Bình Dương", lat: 11.0858, lon: 106.6876 },
  "binh duong": { name: "Bình Dương", lat: 11.0858, lon: 106.6876 },
  dongnai: { name: "Đồng Nai", lat: 11.0504, lon: 107.0396 },
  "dong nai": { name: "Đồng Nai", lat: 11.0504, lon: 107.0396 },
  vungtau: { name: "Vũng Tàu", lat: 10.346, lon: 107.0843 },
  "vung tau": { name: "Vũng Tàu", lat: 10.346, lon: 107.0843 },
  hue: { name: "Huế", lat: 16.4637, lon: 107.5909 },
  quynhon: { name: "Quy Nhơn", lat: 13.783, lon: 109.2197 },
  "quy nhon": { name: "Quy Nhơn", lat: 13.783, lon: 109.2197 },
  quangninh: { name: "Quảng Ninh", lat: 21.0064, lon: 107.2925 },
  "quang ninh": { name: "Quảng Ninh", lat: 21.0064, lon: 107.2925 },
  thanhhoa: { name: "Thanh Hóa", lat: 19.8067, lon: 105.7852 },
  "thanh hoa": { name: "Thanh Hóa", lat: 19.8067, lon: 105.7852 },
  nghean: { name: "Nghệ An", lat: 18.6734, lon: 105.6813 },
  "nghe an": { name: "Nghệ An", lat: 18.6734, lon: 105.6813 },
  buonmathuot: { name: "Buôn Ma Thuột", lat: 12.6667, lon: 108.05 },
  "buon ma thuot": { name: "Buôn Ma Thuột", lat: 12.6667, lon: 108.05 },
};

function normalizeCityQuery(query: string): string {
  return query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

const DEFAULT_LOCATION = { name: "TP. Hồ Chí Minh", lat: 10.8231, lon: 106.6297 };

/**
 * Tra cứu tọa độ theo tên thành phố
 */
async function resolveLocation(cityInput: string): Promise<{ name: string; lat: number; lon: number }> {
  const norm = normalizeCityQuery(cityInput);
  if (!norm || norm === "viet nam" || norm === "vn") {
    return DEFAULT_LOCATION;
  }

  // Tra cứu bảng địa danh dựng sẵn
  for (const [key, loc] of Object.entries(VIETNAM_CITIES_COORDS)) {
    if (norm === key || norm.includes(key) || key.includes(norm)) {
      return loc;
    }
  }

  // Fallback: Gọi Open-Meteo Geocoding API
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityInput)}&count=1&language=vi&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = (await res.json()) as any;
      if (Array.isArray(data?.results) && data.results.length > 0) {
        const item = data.results[0];
        return {
          name: item.name || cityInput,
          lat: item.latitude,
          lon: item.longitude,
        };
      }
    }
  } catch {}

  // Mặc định trả về TP. Hồ Chí Minh
  return DEFAULT_LOCATION;
}

function getWeatherCodeInfo(code: number): { desc: string; icon: string } {
  switch (code) {
    case 0:
      return { desc: "Trời quang, nắng đẹp", icon: "☀️" };
    case 1:
    case 2:
      return { desc: "Trời có mây, nắng dịu", icon: "⛅" };
    case 3:
      return { desc: "Nhiều mây, âm u", icon: "☁️" };
    case 45:
    case 48:
      return { desc: "Có sương mù", icon: "🌫️" };
    case 51:
    case 53:
    case 55:
      return { desc: "Mưa phùn nhẹ rải rác", icon: "🌦️" };
    case 61:
    case 63:
    case 65:
      return { desc: "Mưa rào", icon: "🌧️" };
    case 80:
    case 81:
    case 82:
      return { desc: "Mưa rào nặng hạt", icon: "⛈️" };
    case 95:
    case 96:
    case 99:
      return { desc: "Dông bão, có sấm sét", icon: "⚡" };
    default:
      return { desc: "Trời có mây rải rác", icon: "🌤️" };
  }
}

function getAirQualityInfo(pm25: number): { desc: string; icon: string } {
  if (pm25 <= 12) {
    return { desc: "Rất Tốt (Không khí trong lành)", icon: "🟢" };
  } else if (pm25 <= 35.4) {
    return { desc: "Trung Bình (Khá dễ chịu)", icon: "🟡" };
  } else if (pm25 <= 55.4) {
    return { desc: "Kém (Nhạy cảm nên đeo khẩu trang)", icon: "🟠" };
  } else if (pm25 <= 150.4) {
    return { desc: "Xấu (Nên đeo khẩu trang chống bụi)", icon: "🔴" };
  } else {
    return { desc: "Rất Nguy Hại (Hạn chế ra ngoài)", icon: "🟣" };
  }
}

/**
 * Xử lý xác định chỉ mục ngày dự báo từ tham số ngày
 */
function parseForecastTargetIndex(
  targetDate?: string | number,
  dailyTimes: string[] = []
): { index: number; label: string; dateStr: string } {
  if (targetDate === undefined || targetDate === null || targetDate === "" || targetDate === 0) {
    const dStr = dailyTimes[0] || new Date().toISOString().slice(0, 10);
    return { index: 0, label: "Hôm nay", dateStr: dStr };
  }

  if (typeof targetDate === "number") {
    const idx = Math.max(0, Math.min(targetDate, dailyTimes.length - 1));
    const dStr = dailyTimes[idx] || "";
    const lbl = idx === 0 ? "Hôm nay" : idx === 1 ? "Ngày mai" : idx === 2 ? "Ngày mốt" : `Ngày ${dStr}`;
    return { index: idx, label: lbl, dateStr: dStr };
  }

  const str = String(targetDate).trim().toLowerCase();
  if (str === "today" || str === "hôm nay" || str === "hom nay" || str === "hiện tại" || str === "hien tai") {
    return { index: 0, label: "Hôm nay", dateStr: dailyTimes[0] || "" };
  }

  if (str === "tomorrow" || str === "ngày mai" || str === "ngay mai" || str === "mai") {
    return { index: 1, label: "Ngày mai", dateStr: dailyTimes[1] || "" };
  }

  if (str === "ngày mốt" || str === "ngay mot" || str === "ngày kia" || str === "ngay kia") {
    return { index: 2, label: "Ngày mốt", dateStr: dailyTimes[2] || "" };
  }

  // Khớp chuỗi ngày DD/MM/YYYY hoặc YYYY-MM-DD
  const dmyMatch = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch && dmyMatch[1] && dmyMatch[2] && dmyMatch[3]) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    const targetIso = `${year}-${month}-${day}`;
    const foundIdx = dailyTimes.findIndex((t) => t === targetIso);
    if (foundIdx !== -1) {
      const lbl = foundIdx === 0 ? "Hôm nay" : foundIdx === 1 ? "Ngày mai" : `Ngày ${day}/${month}/${year}`;
      return { index: foundIdx, label: lbl, dateStr: targetIso };
    }
  }

  const ymdMatch = str.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch && ymdMatch[1] && ymdMatch[2] && ymdMatch[3]) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    const targetIso = `${year}-${month}-${day}`;
    const foundIdx = dailyTimes.findIndex((t) => t === targetIso);
    if (foundIdx !== -1) {
      const lbl = foundIdx === 0 ? "Hôm nay" : foundIdx === 1 ? "Ngày mai" : `Ngày ${day}/${month}/${year}`;
      return { index: foundIdx, label: lbl, dateStr: targetIso };
    }
  }

  // Nếu trong chuỗi có chữ "mai"
  if (str.includes("mai")) {
    return { index: 1, label: "Ngày mai", dateStr: dailyTimes[1] || "" };
  }

  return { index: 0, label: "Hôm nay", dateStr: dailyTimes[0] || "" };
}

/**
 * Lấy dữ liệu thời tiết và chất lượng không khí chi tiết
 * Hỗ trợ tra cứu hôm nay, ngày mai hoặc bất kỳ ngày nào trong phạm vi 7 ngày
 */
export async function fetchWeatherData(
  cityInput = "Hồ Chí Minh",
  targetDate?: string | number
): Promise<WeatherData | null> {
  try {
    const loc = await resolveLocation(cityInput);

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,uv_index_max,wind_speed_10m_max&timezone=Asia%2FBangkok`;
    const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&current=pm2_5,european_aqi&timezone=Asia%2FBangkok`;

    const [weatherRes, aqiRes] = await Promise.all([
      fetch(weatherUrl, { signal: AbortSignal.timeout(6000) }),
      fetch(aqiUrl, { signal: AbortSignal.timeout(6000) }).catch(() => null),
    ]);

    if (!weatherRes.ok) return null;
    const wData = (await weatherRes.json()) as any;
    let aqiData: any = null;
    if (aqiRes && aqiRes.ok) {
      aqiData = (await aqiRes.json()) as any;
    }

    const current = wData.current || {};
    const daily = wData.daily || {};
    const dailyTimes: string[] = Array.isArray(daily.time) ? daily.time : [];

    const { index: dayIdx, label: dateLabel, dateStr } = parseForecastTargetIndex(targetDate, dailyTimes);

    let temp = 28;
    let feelsLike = 28;
    let tempMin = 24;
    let tempMax = 32;
    let humidity = 75;
    let windSpeed = 10;
    let rainProb = 20;
    let uvIndex = 6;
    let weatherCode = 1;

    if (dayIdx === 0) {
      // Thời tiết hôm nay & hiện tại
      temp = Math.round(current.temperature_2m ?? 28);
      feelsLike = Math.round(current.apparent_temperature ?? temp);
      tempMin = Math.round(daily.temperature_2m_min?.[0] ?? temp - 4);
      tempMax = Math.round(daily.temperature_2m_max?.[0] ?? temp + 4);
      humidity = Math.round(current.relative_humidity_2m ?? 75);
      windSpeed = Math.round(current.wind_speed_10m ?? 10);
      rainProb = Math.round(daily.precipitation_probability_max?.[0] ?? 20);
      uvIndex = Math.round(daily.uv_index_max?.[0] ?? 6);
      weatherCode = current.weather_code ?? 1;
    } else {
      // Dự báo cho ngày tương lai (ngày mai, ngày mốt...)
      tempMin = Math.round(daily.temperature_2m_min?.[dayIdx] ?? 24);
      tempMax = Math.round(daily.temperature_2m_max?.[dayIdx] ?? 32);
      temp = Math.round((tempMin + tempMax) / 2);
      feelsLike = Math.round(daily.apparent_temperature_max?.[dayIdx] ?? tempMax);
      humidity = 78;
      windSpeed = Math.round(daily.wind_speed_10m_max?.[dayIdx] ?? 12);
      rainProb = Math.round(daily.precipitation_probability_max?.[dayIdx] ?? 30);
      uvIndex = Math.round(daily.uv_index_max?.[dayIdx] ?? 6);
      weatherCode = daily.weather_code?.[dayIdx] ?? 1;
    }

    const { desc: weatherDesc, icon: weatherIcon } = getWeatherCodeInfo(weatherCode);

    const pm25 = Math.round(aqiData?.current?.pm2_5 ?? 25);
    const { desc: aqiDesc, icon: aqiIcon } = getAirQualityInfo(pm25);

    // Lời khuyên thiết thực theo từng ngày
    const advisories: string[] = [];
    const prefixTarget = dayIdx === 1 ? "Ngày mai " : dayIdx > 1 ? `Vào ${dateLabel} ` : "";

    if (rainProb >= 70) {
      advisories.push(`☔ ${prefixTarget}Khả năng có mưa rất cao (${rainProb}%), nhớ chuẩn bị ô hoặc áo mưa khi ra ngoài!`);
    } else if (rainProb >= 40) {
      advisories.push(`🌦️ ${prefixTarget}Có thể xuất hiện mưa rào rải rác (${rainProb}%), nên mang theo áo mưa dự phòng.`);
    }

    if (uvIndex >= 7) {
      advisories.push(`🕶️ Chỉ số UV cao (${uvIndex}/10), nên bôi kem chống nắng và mặc áo khoác khi ra đường buổi trưa.`);
    }

    if (pm25 >= 35) {
      advisories.push("😷 Chỉ số bụi mịn PM2.5 ở mức cao, nhớ đeo khẩu trang bảo vệ đường hô hấp.");
    }

    if (tempMax >= 35) {
      advisories.push("🧊 Thời tiết nắng gắt, nhớ uống nhiều nước để tránh sốc nhiệt.");
    } else if (tempMin <= 20) {
      advisories.push("🧣 Trời se lạnh về đêm và sáng sớm, bạn nhớ giữ ấm cơ thể nhé.");
    }

    if (advisories.length === 0) {
      advisories.push(`✨ ${prefixTarget}Thời tiết khá lý tưởng cho các hoạt động di chuyển, làm việc và gặp gỡ bạn bè!`);
    }

    return {
      city: loc.name,
      date: dateStr,
      dateLabel,
      temp,
      feelsLike,
      tempMin,
      tempMax,
      humidity,
      windSpeed,
      rainProb,
      uvIndex,
      weatherDesc,
      weatherIcon,
      aqiDesc,
      aqiIcon,
      pm25,
      advisories,
    };
  } catch (e) {
    console.error("[weather] fetchWeatherData error:", e);
    return null;
  }
}

/**
 * Tạo bản tin tra cứu thời tiết tức thì (hỗ trợ cả hôm nay và ngày mai / ngày cụ thể)
 */
export async function getWeatherReport(cityInput = "Hồ Chí Minh", targetDate?: string | number): Promise<string> {
  const cleanInput = cityInput.replace(/\b(?:ngày mai|ngay mai|mai|hôm nay|hom nay)\b/gi, "").trim();
  const effectiveCity = cleanInput || "Hồ Chí Minh";

  const effectiveDate = targetDate !== undefined
    ? targetDate
    : cityInput.toLowerCase().includes("mai") ? "tomorrow" : "today";

  const cities = effectiveCity
    .split(/[,;\n+]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const targetCities = cities.length > 0 ? cities.slice(0, 4) : ["Hồ Chí Minh"];

  if (targetCities.length === 1) {
    const data = await fetchWeatherData(targetCities[0], effectiveDate);
    if (!data) {
      return `⚠️ Dạ hiện tại em chưa lấy được dữ liệu thời tiết cho khu vực "${targetCities[0]}". Bác thử lại với tên thành phố khác (ví dụ: Hà Nội, TP.HCM, Đà Lạt, Đà Nẵng...) nhé!`;
    }

    const dateHeader = data.dateLabel ? `${data.dateLabel} (${data.date})` : data.date;

    const lines = [
      `☀️ BẢN TIN THỜI TIẾT & CHẤT LƯỢNG KHÔNG KHÍ 🌤️`,
      `📍 Khu vực: ${data.city} | 📅 Dự báo: ${dateHeader}`,
      ``,
      `🌡️ Nhiệt độ: ${data.temp}°C (Cảm nhận như ${data.feelsLike}°C, dao động ${data.tempMin}°C - ${data.tempMax}°C)`,
      `${data.weatherIcon} Trạng thái: ${data.weatherDesc}`,
      `💧 Độ ẩm: ${data.humidity}% | 💨 Gió: ${data.windSpeed} km/h`,
      `🌧️ Khả năng mưa: ${data.rainProb}% | ☀️ Chỉ số UV: ${data.uvIndex}/10`,
      `🍃 Bụi mịn PM2.5: ${data.pm25} µg/m³ (${data.aqiIcon} ${data.aqiDesc})`,
      ``,
      `💡 Lời khuyên cho bạn:`,
      ...data.advisories.map((a) => `• ${a}`),
    ];

    return lines.join("\n");
  }

  // Nhiều địa điểm
  const weatherResults = (await Promise.all(targetCities.map((c) => fetchWeatherData(c, effectiveDate)))).filter(Boolean) as NonNullable<
    Awaited<ReturnType<typeof fetchWeatherData>>
  >[];

  if (weatherResults.length === 0) {
    return `⚠️ Dạ hiện tại em chưa lấy được dữ liệu thời tiết cho các khu vực này. Bác vui lòng thử lại nhé!`;
  }

  const firstDate = weatherResults[0]?.dateLabel || "Hôm nay";

  const lines = [
    `☀️ BẢN TIN THỜI TIẾT CÁC KHU VỰC (${firstDate.toUpperCase()}) 🌤️`,
    ``,
    ...weatherResults.map(
      (w) =>
        `📍 ${w.city}: ${w.weatherIcon} ${w.temp}°C (${w.tempMin}°C - ${w.tempMax}°C) | 🌧️ Mưa: ${w.rainProb}% | 🍃 Bụi mịn: ${w.aqiIcon} ${w.aqiDesc}`
    ),
    ``,
    `💡 Nhắc nhở:`,
    weatherResults.some((w) => w.rainProb >= 50)
      ? `• ☔ Một số khu vực có khả năng mưa cao, anh em nhớ mang theo ô hoặc áo mưa khi ra ngoài nhé!`
      : `• ✨ Thời tiết tại các khu vực khá thuận lợi cho các hoạt động và công việc.`,
  ];

  return lines.join("\n");
}

/**
 * Tạo bản tin chào buổi sáng tự động gửi vào nhóm Zalo hoặc tin nhắn 1:1
 */
export async function getMorningWeatherBriefing(cityInput = "Hồ Chí Minh", groupName?: string): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });

  const greetingTarget = groupName ? `CẢ NHÀ [${groupName.toUpperCase()}]` : "BẠN";

  const cities = (cityInput || "Hồ Chí Minh")
    .split(/[,;\n+]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const targetCities = cities.length > 0 ? cities.slice(0, 5) : ["Hồ Chí Minh"];

  // 1 địa điểm
  if (targetCities.length === 1) {
    const data = await fetchWeatherData(targetCities[0]);
    if (!data) {
      return `🌅 CHÀO BUỔI SÁNG ${greetingTarget}! ☀️\n📅 ${dateStr}\n\nChúc anh em một ngày mới tràn đầy năng lượng, công việc hanh thông và gặt hái nhiều thành công! 💪`;
    }

    const lines = [
      `🌅 CHÀO BUỔI SÁNG ${greetingTarget}! ☀️`,
      `📅 ${dateStr}`,
      ``,
      `📍 Dự báo thời tiết tại ${data.city}:`,
      `${data.weatherIcon} ${data.weatherDesc} | 🌡️ ${data.temp}°C (${data.tempMin}°C - ${data.tempMax}°C)`,
      `🌧️ Xác suất mưa: ${data.rainProb}% | 🍃 Bụi mịn PM2.5: ${data.pm25} µg/m³ (${data.aqiIcon} ${data.aqiDesc})`,
      ``,
      `💡 Nhắc nhở ngày mới:`,
      ...data.advisories.map((a) => `• ${a}`),
      ``,
      `✨ Chúc anh em một ngày làm việc hiệu quả và tràn đầy năng lượng! 💪`,
    ];

    return lines.join("\n");
  }

  // Nhiều địa điểm
  const weatherResults = (await Promise.all(targetCities.map((c) => fetchWeatherData(c)))).filter(Boolean) as NonNullable<
    Awaited<ReturnType<typeof fetchWeatherData>>
  >[];

  if (weatherResults.length === 0) {
    return `🌅 CHÀO BUỔI SÁNG ${greetingTarget}! ☀️\n📅 ${dateStr}\n\n✨ Chúc anh em một ngày làm việc hiệu quả và tràn đầy năng lượng! 💪`;
  }

  const lines = [
    `🌅 CHÀO BUỔI SÁNG ${greetingTarget}! ☀️`,
    `📅 ${dateStr}`,
    ``,
    `📍 Dự báo thời tiết các khu vực hôm nay:`,
    ...weatherResults.map(
      (w) =>
        `• 📍 ${w.city}: ${w.weatherIcon} ${w.temp}°C (${w.tempMin}°C - ${w.tempMax}°C) | 🌧️ Mưa: ${w.rainProb}% | 🍃 ${w.aqiIcon} ${w.aqiDesc}`
    ),
    ``,
    `💡 Nhắc nhở ngày mới:`,
    weatherResults.some((w) => w.rainProb >= 50)
      ? `• ☔ Có khu vực mưa cao, nhớ mang theo ô hoặc áo mưa khi ra ngoài!`
      : `• ✨ Thời tiết các khu vực khá thuận lợi cho các hoạt động và công việc.`,
    weatherResults.some((w) => w.uvIndex >= 7)
      ? `• 🕶️ Chỉ số UV trưa khá cao, bạn nên che chắn cẩn thận khi ra đường.`
      : `• ☕ Chúc bạn có những giờ phút làm việc thật sảng khoái và may mắn!`,
    ``,
    `✨ Chúc anh em một ngày làm việc hiệu quả và tràn đầy năng lượng! 💪`,
  ];

  return lines.join("\n");
}

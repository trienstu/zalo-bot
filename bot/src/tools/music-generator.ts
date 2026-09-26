import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";

const MUSIC_CACHE_DIR = path.resolve(process.cwd(), "data", "music-cache");

export interface MusicGenerateOptions {
  /** Mô tả ý tưởng bài hát, chủ đề hoặc nội dung cần sáng tác */
  prompt: string;
  /** Lời bài hát chi tiết (nếu có, hoặc để AI tự viết) */
  lyrics?: string;
  /** Thể loại / phong cách nhạc (Pop, Rap, Ballad, Rock, EDM, Bolero, Lofi, Acoustic...) */
  style?: string;
  /** Tên bài hát */
  title?: string;
  /** True nếu chỉ muốn nhạc nền / beat không lời */
  instrumental?: boolean;
  /** Phiên bản model Suno (mặc định chirp-v3-5 hoặc chirp-v4) */
  model?: string;
}

export interface GeneratedMusicTrack {
  id: string;
  title: string;
  audioUrl: string;
  videoUrl?: string;
  imageUrl?: string;
  duration?: number;
  tags?: string;
  prompt?: string;
  localAudioPath?: string;
  localImagePath?: string;
  listenUrl?: string;
}

export interface MusicGenerateResult {
  success: boolean;
  message?: string;
  tracks?: GeneratedMusicTrack[];
  allTracks?: GeneratedMusicTrack[];
  primaryTrack?: GeneratedMusicTrack;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  coverPath?: string;
  caption?: string;
  title?: string;
  lyrics?: string;
  style?: string;
  listenUrl?: string;
}

function ensureMusicDir(): string {
  if (!fs.existsSync(MUSIC_CACHE_DIR)) {
    fs.mkdirSync(MUSIC_CACHE_DIR, { recursive: true });
  }
  return MUSIC_CACHE_DIR;
}

/**
 * Kiểm tra xem bot đã được cấu hình tạo nhạc (Cookie hoặc API Proxy) chưa
 */
export function isMusicConfigured(): boolean {
  const cookie = (process.env.SUNO_COOKIE || config.sunoCookie || "").trim();
  const apiUrl = (process.env.SUNO_API_URL || config.sunoApiUrl || "").trim();
  return Boolean(cookie || apiUrl);
}

/** Cache JWT token từ Clerk session để tránh gọi Clerk liên tục */
let cachedJwtToken: { token: string; expiresAt: number } | null = null;

/**
 * Lấy Bearer JWT token từ Clerk auth của Suno bằng Cookie tài khoản
 */
async function getSunoJwtToken(cookieString: string): Promise<string> {
  const now = Date.now();
  if (cachedJwtToken && cachedJwtToken.expiresAt > now + 10_000) {
    return cachedJwtToken.token;
  }

  let cleanCookie = cookieString.trim();
  if (!cleanCookie) {
    throw new Error("SUNO_COOKIE rỗng");
  }

  // Nếu người dùng cung cấp raw token JWT (bắt đầu bằng ey) chưa có __client= thì tự động thêm
  if (!cleanCookie.includes("=") && cleanCookie.startsWith("ey")) {
    cleanCookie = `__client=${cleanCookie}`;
  }

  const headers = {
    Cookie: cleanCookie,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    Origin: "https://suno.com",
    Referer: "https://suno.com/",
    Accept: "application/json",
  };

  // 1. Lấy session hiện tại từ Clerk
  const clientRes = await fetch("https://clerk.suno.com/v1/client?_clerk_js_version=5.15.0", {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15_000),
  });

  if (!clientRes.ok) {
    const errText = await clientRes.text().catch(() => "");
    throw new Error(`Lỗi xác thực Clerk Suno (HTTP ${clientRes.status}): ${errText.slice(0, 150)}`);
  }

  const clientData = (await clientRes.json()) as any;
  const sessionId =
    clientData?.response?.last_active_session_id ||
    clientData?.response?.sessions?.[0]?.id;

  if (!sessionId) {
    throw new Error("Không tìm thấy session ID từ Clerk Suno. Vui lòng kiểm tra lại Cookie đăng nhập.");
  }

  // 2. Đổi session ID lấy JWT Bearer token
  const tokenRes = await fetch(
    `https://clerk.suno.com/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=5.15.0`,
    {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => "");
    throw new Error(`Lỗi cấp JWT Suno (HTTP ${tokenRes.status}): ${errText.slice(0, 150)}`);
  }

  const tokenData = (await tokenRes.json()) as any;
  const jwt = tokenData?.jwt;

  if (!jwt) {
    throw new Error("Clerk không trả về JWT token hợp lệ");
  }

  // Token của Clerk thường có hiệu lực ~60 giây, cache 45 giây an toàn
  cachedJwtToken = {
    token: jwt,
    expiresAt: now + 45_000,
  };

  return jwt;
}

/**
 * Tải file âm thanh (.mp3) hoặc hình ảnh (.jpg) về ổ đĩa cục bộ
 */
async function downloadMediaFile(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(60_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return false;

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (err) {
    console.warn(`[music-generator] Lỗi tải media [${url}]:`, err);
    return false;
  }
}

/**
 * Tạo nhạc bằng Cookie Suno Free (trực tiếp gọi Suno Studio API)
 */
async function generateViaSunoCookie(
  cookie: string,
  options: MusicGenerateOptions
): Promise<MusicGenerateResult> {
  const jwt = await getSunoJwtToken(cookie);
  const cacheDir = ensureMusicDir();

  const studioApiUrls = [
    "https://studio-api.prod.suno.com/api/generate/v2/",
    "https://studio-api.suno.ai/api/generate/v2/",
  ];

  const payload = {
    prompt: options.lyrics || options.prompt,
    tags: options.style || "pop, vietnamese",
    title: options.title || "Bài hát AI",
    make_instrumental: Boolean(options.instrumental),
    mv: options.model || config.sunoModel || "chirp-v3-5",
    continue_clip_id: null,
    continue_at: null,
  };

  let submitRes: Response | null = null;
  let lastErr = "";

  for (const url of studioApiUrls) {
    try {
      submitRes = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          Origin: "https://suno.com",
          Referer: "https://suno.com/",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });

      if (submitRes.ok) break;
      lastErr = await submitRes.text().catch(() => "");
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
  }

  if (!submitRes || !submitRes.ok) {
    return {
      success: false,
      message: `Không thể gửi yêu cầu tạo nhạc lên Suno (HTTP ${submitRes?.status || "Error"}): ${lastErr.slice(0, 200)}`,
    };
  }

  const submitData = (await submitRes.json()) as any;
  const clips = Array.isArray(submitData?.clips)
    ? submitData.clips
    : Array.isArray(submitData)
      ? submitData
      : [];

  const clipIds: string[] = clips.map((c: any) => c.id).filter(Boolean);

  if (clipIds.length === 0) {
    return {
      success: false,
      message: "Suno không trả về clip ID nào để theo dõi tiến trình.",
    };
  }

  console.log(`[music-generator] 🎵 Đã gửi task tạo nhạc lên Suno thành công! Clip IDs: [${clipIds.join(", ")}]. Đang chờ AI hòa âm phối khí...`);

  // Polling lấy kết quả hoàn chỉnh (tối đa 120 giây)
  const startTime = Date.now();
  const maxWaitMs = 120_000;
  let completedClips: any[] = [];

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 5000));

    try {
      const currentJwt = await getSunoJwtToken(cookie);
      const feedUrl = `https://studio-api.prod.suno.com/api/feed/?ids=${encodeURIComponent(clipIds.join(","))}`;
      const feedRes = await fetch(feedUrl, {
        headers: {
          Authorization: `Bearer ${currentJwt}`,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (feedRes.ok) {
        const feedData = (await feedRes.json()) as any[];
        if (Array.isArray(feedData) && feedData.length > 0) {
          const ready = feedData.filter(
            (c) => (c.status === "complete" || c.status === "streaming") && c.audio_url
          );
          if (ready.length > 0) {
            completedClips = ready;
            if (feedData.some((c) => c.status === "complete")) {
              break;
            }
          }
        }
      }
    } catch (pollErr) {
      console.warn("[music-generator] Lỗi polling Suno feed:", pollErr);
    }
  }

  if (completedClips.length === 0) {
    return {
      success: false,
      message: "Quá thời gian chờ (120s) nhưng Suno chưa hoàn thành bài hát. Vui lòng thử lại sau giây lát.",
    };
  }

  // Lấy clip hoàn thiện nhất và clip phụ (Suno tạo ra 2 bản cùng lúc)
  const bestClip = completedClips[0];
  const secondClip = completedClips.length > 1 ? completedClips[1] : undefined;

  const songTitle = bestClip.title || options.title || "Bài hát AI";
  const songStyle = bestClip.metadata?.tags || options.style || "Pop";
  const songLyrics = bestClip.metadata?.prompt || options.lyrics || options.prompt;
  const durationSec = Math.round(Number(bestClip.duration || 0));

  const listenUrl1 = `https://suno.com/song/${bestClip.id}`;
  const listenUrl2 = secondClip ? `https://suno.com/song/${secondClip.id}` : undefined;

  // 1. Tải ảnh bìa cover art (nếu có)
  let localImagePath: string | undefined;
  const coverUrl = bestClip.image_large_url || bestClip.image_url;
  if (coverUrl) {
    const imgFileName = `suno_${bestClip.id}.jpg`;
    const destImg = path.join(cacheDir, imgFileName);
    if (await downloadMediaFile(coverUrl, destImg)) {
      localImagePath = destImg;
    }
  }

  // 2. Thử tải file âm thanh (.mp3) nếu có URL download hợp lệ và không dính forbidden
  let localAudioPathResult: string | undefined;
  let audioFileName: string | undefined;
  let fileSize = 0;
  if (bestClip.audio_url && !bestClip.audio_url.includes("forbidden")) {
    const targetAudioFile = `suno_${bestClip.id}.mp3`;
    const targetAudioPath = path.join(cacheDir, targetAudioFile);
    if (await downloadMediaFile(bestClip.audio_url, targetAudioPath)) {
      localAudioPathResult = targetAudioPath;
      audioFileName = targetAudioFile;
      fileSize = fs.existsSync(targetAudioPath) ? fs.statSync(targetAudioPath).size : 0;
    }
  }

  // 3. Xây dựng Card bài hát chuẩn mực, đầy đủ link nghe trực tiếp và lời ca khúc
  let caption = `🎵 [Sáng Tác Ca Khúc AI] ${songTitle}\n` +
    `🎸 Thể loại: ${songStyle}${durationSec ? ` (${durationSec}s)` : ""}\n` +
    `🎧 Link nghe bài hát trực tiếp trên Suno:\n` +
    `👉 Bản 1: ${listenUrl1}\n`;
  if (listenUrl2) {
    caption += `👉 Bản 2: ${listenUrl2}\n`;
  }
  if (songLyrics) {
    caption += `\n📝 Lời bài hát:\n${songLyrics.trim()}`;
  }

  // Nếu tải được file âm thanh (.mp3) thì ưu tiên gửi file âm thanh, nếu không thì gửi ảnh bìa đại diện
  const primaryFile = localAudioPathResult || localImagePath;
  const finalFileName = primaryFile ? path.basename(primaryFile) : audioFileName;
  const finalFileSize = primaryFile && fs.existsSync(primaryFile) ? fs.statSync(primaryFile).size : fileSize;

  const primaryTrack: GeneratedMusicTrack = {
    id: bestClip.id,
    title: songTitle,
    audioUrl: bestClip.audio_url,
    videoUrl: bestClip.video_url,
    imageUrl: coverUrl,
    duration: durationSec,
    tags: songStyle,
    prompt: songLyrics,
    localAudioPath: localAudioPathResult,
    localImagePath,
    listenUrl: listenUrl1,
  };

  const allTracks: GeneratedMusicTrack[] = completedClips.map((c) => ({
    id: c.id,
    title: c.title || songTitle,
    audioUrl: c.audio_url,
    videoUrl: c.video_url,
    imageUrl: c.image_large_url || c.image_url,
    duration: Math.round(Number(c.duration || 0)),
    tags: c.metadata?.tags || songStyle,
    prompt: c.metadata?.prompt || songLyrics,
    listenUrl: `https://suno.com/song/${c.id}`,
  }));

  return {
    success: true,
    primaryTrack,
    allTracks,
    filePath: primaryFile,
    fileName: finalFileName,
    fileSize: finalFileSize,
    coverPath: localImagePath,
    caption,
    title: songTitle,
    lyrics: songLyrics,
    style: songStyle,
    listenUrl: listenUrl1,
  };
}

/**
 * Tạo nhạc bằng Proxy API (gcui-art/suno-api hoặc third-party Kie.ai / Apiframe)
 */
async function generateViaSunoProxy(
  apiUrl: string,
  apiKey: string,
  options: MusicGenerateOptions
): Promise<MusicGenerateResult> {
  const cacheDir = ensureMusicDir();
  const baseUrl = apiUrl.replace(/\/+$/, "");

  const endpoint = options.lyrics
    ? `${baseUrl}/api/custom_generate`
    : `${baseUrl}/api/generate`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const payload = options.lyrics
    ? {
        prompt: options.lyrics,
        tags: options.style || "pop, vietnamese",
        title: options.title || "Bài hát AI",
        make_instrumental: Boolean(options.instrumental),
        wait_audio: true,
      }
    : {
        prompt: options.prompt,
        make_instrumental: Boolean(options.instrumental),
        wait_audio: true,
      };

  console.log(`[music-generator] 🎵 Gọi Proxy API [${endpoint}]...`);
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      success: false,
      message: `Lỗi gọi Proxy Suno API (HTTP ${res.status}): ${errText.slice(0, 200)}`,
    };
  }

  const data = (await res.json()) as any;
  const items = Array.isArray(data) ? data : data?.data || [data];
  const clip = items.find((c: any) => c?.audio_url) || items[0];

  if (!clip || !clip.audio_url) {
    return {
      success: false,
      message: "Proxy Suno API không trả về audio URL hợp lệ.",
    };
  }

  const clipId = clip.id || crypto.randomUUID().slice(0, 8);
  const audioFileName = `suno_${clipId}.mp3`;
  const localAudioPath = path.join(cacheDir, audioFileName);

  const downloaded = await downloadMediaFile(clip.audio_url, localAudioPath);
  if (!downloaded || !fs.existsSync(localAudioPath)) {
    return {
      success: false,
      message: `Không tải được file âm thanh từ Proxy: ${clip.audio_url}`,
    };
  }

  let localImagePath: string | undefined;
  if (clip.image_url) {
    const imgPath = path.join(cacheDir, `suno_${clipId}.jpg`);
    if (await downloadMediaFile(clip.image_url, imgPath)) {
      localImagePath = imgPath;
    }
  }

  const fileSize = fs.statSync(localAudioPath).size;
  const songTitle = clip.title || options.title || "Bài hát AI";
  const songStyle = clip.tags || options.style || "Pop";
  const songLyrics = clip.prompt || options.lyrics || options.prompt;
  const durationSec = Math.round(Number(clip.duration || 0));

  const caption = `🎵 [Sen Chúa AI Music] ${songTitle}\n🎸 Phong cách: ${songStyle}${durationSec ? ` (${durationSec}s)` : ""}\n📝 Lời bài hát:\n${songLyrics.slice(0, 300)}${songLyrics.length > 300 ? "..." : ""}`;

  return {
    success: true,
    primaryTrack: {
      id: clipId,
      title: songTitle,
      audioUrl: clip.audio_url,
      videoUrl: clip.video_url,
      imageUrl: clip.image_url,
      duration: durationSec,
      tags: songStyle,
      prompt: songLyrics,
      localAudioPath,
      localImagePath,
    },
    filePath: localAudioPath,
    fileName: audioFileName,
    fileSize,
    coverPath: localImagePath,
    caption,
    title: songTitle,
    lyrics: songLyrics,
    style: songStyle,
  };
}

/**
 * Hàm điều phối chính: Tự động chọn phương thức tạo nhạc phù hợp dựa trên cấu hình (.env)
 */
export async function generateMusic(options: MusicGenerateOptions): Promise<MusicGenerateResult> {
  const cookie = (process.env.SUNO_COOKIE || config.sunoCookie || "").trim();
  const apiUrl = (process.env.SUNO_API_URL || config.sunoApiUrl || "").trim();
  const apiKey = (process.env.SUNO_API_KEY || config.sunoApiKey || "").trim();

  if (cookie) {
    try {
      console.log(`[music-generator] 🎵 Bắt đầu sáng tác nhạc bằng Suno Cookie... Style: "${options.style || "pop"}"`);
      return await generateViaSunoCookie(cookie, options);
    } catch (cookieErr: any) {
      console.warn("[music-generator] Lỗi tạo nhạc bằng Suno Cookie:", cookieErr);
      if (apiUrl) {
        console.log("[music-generator] 🔄 Thử fallback sang Proxy API...");
        return await generateViaSunoProxy(apiUrl, apiKey, options);
      }
      return {
        success: false,
        message: `Lỗi kết nối Suno AI: ${cookieErr?.message || cookieErr}. Vui lòng kiểm tra lại SUNO_COOKIE trong .env.`,
      };
    }
  }

  if (apiUrl) {
    try {
      return await generateViaSunoProxy(apiUrl, apiKey, options);
    } catch (proxyErr: any) {
      return {
        success: false,
        message: `Lỗi gọi Suno Proxy: ${proxyErr?.message || proxyErr}`,
      };
    }
  }

  return {
    success: false,
    message:
      "⚠️ Bot chưa được kích hoạt tính năng tạo nhạc Suno.\n" +
      "👉 Vui lòng đăng nhập suno.com, copy Cookie tài khoản và điền vào biến SUNO_COOKIE trong file .env để kích hoạt nhé!",
  };
}

/**
 * Nhận diện câu hỏi có phải yêu cầu tạo/sáng tác nhạc không
 */
export function checkIsMusicRequest(text: string): boolean {
  if (!text) return false;
  const q = text.toLowerCase();
  if (/^[!/](?:suno|music|nhac|tao_nhac|phoi_nhac)\b/i.test(q)) {
    return true;
  }
  if (
    /(?:sáng tác|tạo|làm|viết|phối|hát)\b[\s\S]*?\b(?:bài\s*hát|bài\s*nhạc|ca\s*khúc|bản\s*nhạc|beat|track|nhạc\s*lofi|nhạc\s*rap|nhạc\s*ballad)\b/i.test(q) ||
    /(?:sáng tác|tạo|làm|viết|phối)\s*(?:giúp|cho)?\s*(?:một|1)?\s*(?:bài\s*)?(?:hát|nhạc|beat|ca khúc|bài ca|track)/i.test(q) ||
    /(?:tạo nhạc|làm nhạc|sáng tác bài hát|viết bài hát|phối bài hát|làm bài hát)/i.test(q)
  ) {
    return true;
  }
  return false;
}


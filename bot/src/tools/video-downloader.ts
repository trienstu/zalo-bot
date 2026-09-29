import fs from "node:fs";
import path from "node:path";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import { sanitizeSafeFileName } from "./file-generator.js";

const execFileAsync = promisify(execFile);

export const DOWNLOADS_VIDEO_DIR = path.resolve(process.cwd(), "data", "downloads", "videos");

export interface VideoDownloadOptions {
  format?: "video" | "audio";
  maxFilesizeMb?: number;
  timeoutMs?: number;
}

export interface VideoDownloadResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  title?: string;
  duration?: number;
  author?: string;
  fileType?: "mp4" | "mp3";
  isMediaDownload?: boolean;
  caption?: string;
  summary?: string;
  error?: string;
}

/**
 * Đảm bảo thư mục lưu trữ video tải về tồn tại
 */
export function ensureVideoOutputDir(): string {
  if (!fs.existsSync(DOWNLOADS_VIDEO_DIR)) {
    fs.mkdirSync(DOWNLOADS_VIDEO_DIR, { recursive: true });
  }
  return DOWNLOADS_VIDEO_DIR;
}

/**
 * Quét dọn dẹp các file video tải về cũ hơn maxAgeMinutes (mặc định 30 phút)
 * để giải phóng dung lượng ổ cứng VPS tự động.
 */
export function cleanOldDownloadedVideos(maxAgeMinutes = 30): number {
  try {
    if (!fs.existsSync(DOWNLOADS_VIDEO_DIR)) return 0;
    const now = Date.now();
    const thresholdMs = maxAgeMinutes * 60 * 1000;
    const files = fs.readdirSync(DOWNLOADS_VIDEO_DIR);
    let removed = 0;

    for (const file of files) {
      const fullPath = path.join(DOWNLOADS_VIDEO_DIR, file);
      try {
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > thresholdMs) {
          fs.unlinkSync(fullPath);
          removed++;
        }
      } catch {}
    }
    return removed;
  } catch (err) {
    console.warn("[video-downloader] Lỗi dọn dẹp file video cũ:", err);
    return 0;
  }
}

/**
 * Hẹn giờ tự động xoá file sau delayMs (mặc định 120s = 2 phút)
 * để đảm bảo Zalo CDN hoàn tất upload stream dữ liệu trước khi xoá.
 */
export function scheduleFileCleanup(filePath: string, delayMs = 120_000): void {
  if (!filePath) return;
  setTimeout(() => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[video-downloader] 🧹 Đã tự động dọn dẹp file tạm sau ${Math.round(delayMs / 1000)}s: ${path.basename(filePath)}`);
      }
    } catch (err) {
      console.warn(`[video-downloader] Không thể xoá file tạm ${filePath}:`, err);
    }
  }, delayMs).unref();
}

/**
 * Kiểm tra xem URL có thuộc danh sách các nền tảng video hỗ trợ hay không
 */
export function isSupportedVideoUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  return /https?:\/\/(?:www\.|m\.|vt\.|v\.|vm\.)?(?:tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|fb\.com|instagram\.com|twitter\.com|x\.com|threads\.net|reddit\.com|pinterest\.com|bilibili\.com)\b/i.test(url.trim());
}

/**
 * Tìm đường dẫn file cookies của YouTube cho yt-dlp nếu có
 */
export function getYtDlpCookiesPath(): string | null {
  const customPath = process.env.YTDLP_COOKIES_PATH?.trim();
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }
  const defaultPaths = [
    path.resolve(process.cwd(), "data/cookies/youtube.txt"),
    path.resolve(process.cwd(), "cookies/youtube.txt"),
    "/home/ubuntu/zalo-bot-2/bot/data/cookies/youtube.txt",
    "/home/ubuntu/zalo-bot-2/bot/cookies/youtube.txt",
  ];
  for (const p of defaultPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Tìm đường dẫn thực thi binary yt-dlp trên hệ thống
 */
export function findYtDlpBinary(): string | null {
  const candidates = [
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    "yt-dlp",
  ];
  for (const bin of candidates) {
    try {
      execSync(`${bin} --version`, { stdio: "ignore" });
      return bin;
    } catch {}
  }
  return null;
}

/**
 * Tải trực tiếp video TikTok không dính watermark qua TikWM API
 */
async function downloadTikTokViaTikWm(
  url: string,
  isAudio: boolean,
  outputDir: string,
): Promise<VideoDownloadResult | null> {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url.trim())}`;
    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });

    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (json.code !== 0 || !json.data) return null;

    const data = json.data;
    const mediaDownloadUrl = isAudio ? (data.music || data.play) : (data.play || data.wmplay);
    if (!mediaDownloadUrl) return null;

    const title = String(data.title || "video_tiktok").slice(0, 50);
    const author = String(data.author?.nickname || data.author?.unique_id || "TikTok Creator");
    const duration = Number(data.duration) || undefined;
    const ext = isAudio ? "mp3" : "mp4";
    const safeTitle = sanitizeSafeFileName(title, "tiktok_video");
    const fileName = `${safeTitle}_${Date.now()}.${ext}`;
    const targetFilePath = path.join(outputDir, fileName);

    const mediaRes = await fetch(mediaDownloadUrl, {
      signal: AbortSignal.timeout(60_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Referer: "https://www.tiktok.com/",
      },
    });

    if (!mediaRes.ok) return null;
    const arrayBuf = await mediaRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.length === 0) return null;

    fs.writeFileSync(targetFilePath, buffer);
    const stats = fs.statSync(targetFilePath);

    scheduleFileCleanup(targetFilePath, 120_000);

    return {
      success: true,
      filePath: targetFilePath,
      fileName,
      fileSize: stats.size,
      title,
      author,
      duration,
      fileType: ext as "mp4" | "mp3",
      isMediaDownload: true,
      caption: isAudio
        ? `🎵 Đã tách xong âm thanh MP3 từ clip TikTok của [${author}]!`
        : `🎬 Đã tải xong video TikTok không watermark của [${author}]!`,
      summary: `Đã tải thành công ${ext.toUpperCase()} từ TikTok (${(stats.size / 1024 / 1024).toFixed(1)} MB).`,
    };
  } catch (err) {
    console.warn("[video-downloader] TikWM API error:", err);
    return null;
  }
}

/**
 * Tải video TikTok dự phòng qua Apify clockworks/free-tiktok-scraper
 */
async function downloadTikTokViaApify(
  url: string,
  isAudio: boolean,
  outputDir: string,
): Promise<VideoDownloadResult | null> {
  const token = config.apifyApiToken?.split(",")[0]?.trim();
  if (!token) return null;

  try {
    console.log(`[video-downloader] 🔄 Kích hoạt Apify Fallback cho TikTok: ${url.slice(0, 60)}...`);
    const runRes = await fetch(
      "https://api.apify.com/v2/acts/clockworks~free-tiktok-scraper/run-sync-get-dataset-items?timeout=45",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          postURLs: [url.trim()],
          commentsPerPost: 0,
          maxRepliesPerComment: 0,
        }),
        signal: AbortSignal.timeout(50_000),
      },
    );

    if (!runRes.ok) return null;
    const items = (await runRes.json()) as any[];
    if (!Array.isArray(items) || items.length === 0) return null;

    const item = items[0];
    const mediaDownloadUrl = isAudio
      ? (item.musicMeta?.playUrl || item.videoUrl)
      : (item.videoUrl || item.videoMeta?.downloadAddr);

    if (!mediaDownloadUrl) return null;

    const title = String(item.text || "tiktok_video").slice(0, 50);
    const author = String(item.authorMeta?.name || item.authorMeta?.nickName || "TikTok Creator");
    const duration = Number(item.videoMeta?.duration) || undefined;
    const ext = isAudio ? "mp3" : "mp4";
    const safeTitle = sanitizeSafeFileName(title, "tiktok_video");
    const fileName = `${safeTitle}_${Date.now()}.${ext}`;
    const targetFilePath = path.join(outputDir, fileName);

    const mediaRes = await fetch(mediaDownloadUrl, {
      signal: AbortSignal.timeout(60_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });

    if (!mediaRes.ok) return null;
    const buffer = Buffer.from(await mediaRes.arrayBuffer());
    if (buffer.length === 0) return null;

    fs.writeFileSync(targetFilePath, buffer);
    const stats = fs.statSync(targetFilePath);

    scheduleFileCleanup(targetFilePath, 120_000);

    return {
      success: true,
      filePath: targetFilePath,
      fileName,
      fileSize: stats.size,
      title,
      author,
      duration,
      fileType: ext as "mp4" | "mp3",
      isMediaDownload: true,
      caption: isAudio
        ? `🎵 Đã tách xong âm thanh MP3 từ clip TikTok của [${author}] qua Apify!`
        : `🎬 Đã tải xong video TikTok không watermark của [${author}] qua Apify!`,
      summary: `Đã tải thành công ${ext.toUpperCase()} từ TikTok (${(stats.size / 1024 / 1024).toFixed(1)} MB).`,
    };
  } catch (err) {
    console.warn("[video-downloader] Apify TikTok Scraper error:", err);
    return null;
  }
}

/**
 * Tải video/audio từ YouTube dự phòng qua Apify streamers/youtube-video-downloader
 */
async function downloadYouTubeViaApify(
  url: string,
  isAudio: boolean,
  outputDir: string,
): Promise<VideoDownloadResult | null> {
  const token = config.apifyApiToken?.split(",")[0]?.trim();
  if (!token) return null;

  try {
    console.log(`[video-downloader] 🔄 Kích hoạt Apify Fallback cho YouTube: ${url.slice(0, 60)}...`);
    const runRes = await fetch(
      "https://api.apify.com/v2/acts/streamers~youtube-video-downloader/run-sync-get-dataset-items?timeout=120",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          videos: [{ url: url.trim() }],
          downloadFormat: isAudio ? "mp3" : "mp4",
        }),
        signal: AbortSignal.timeout(130_000),
      },
    );

    if (!runRes.ok) return null;
    const items = (await runRes.json()) as any[];
    if (!Array.isArray(items) || items.length === 0) return null;

    const item = items[0];
    const mediaDownloadUrl = item.downloadedFileUrl || item.audioOnlyUrl || item.videoOnlyUrl || item.downloadUrl || item.url;
    if (!mediaDownloadUrl) return null;

    const rawTitle = String(item.fileKey || item.title || "youtube_media").replace(/\.[^/.]+$/, "");
    const title = rawTitle.slice(0, 50);
    const author = String(item.channelTitle || item.uploader || "YouTube Creator");
    const duration = Number(item.durationSeconds || item.duration) || undefined;
    const ext = isAudio ? "mp3" : "mp4";
    const safeTitle = sanitizeSafeFileName(title, "youtube_media");
    const fileName = `${safeTitle}_${Date.now()}.${ext}`;
    const targetFilePath = path.join(outputDir, fileName);

    const mediaRes = await fetch(mediaDownloadUrl, {
      signal: AbortSignal.timeout(60_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });

    if (!mediaRes.ok) return null;
    const buffer = Buffer.from(await mediaRes.arrayBuffer());
    if (buffer.length === 0) return null;

    fs.writeFileSync(targetFilePath, buffer);
    const stats = fs.statSync(targetFilePath);

    scheduleFileCleanup(targetFilePath, 120_000);

    return {
      success: true,
      filePath: targetFilePath,
      fileName,
      fileSize: stats.size,
      title,
      author,
      duration,
      fileType: ext as "mp4" | "mp3",
      isMediaDownload: true,
      caption: isAudio
        ? `🎵 Đã tải xong file âm thanh MP3 từ YouTube: [${title}]!`
        : `🎬 Đã tải xong video YouTube [${title}]!`,
      summary: `Đã tải thành công ${ext.toUpperCase()} từ YouTube (${(stats.size / 1024 / 1024).toFixed(1)} MB).`,
    };
  } catch (err) {
    console.warn("[video-downloader] Apify YouTube Downloader error:", err);
    return null;
  }
}

/**
 * Tải Video hoặc Audio từ URL (TikTok không watermark, YouTube, Facebook, Instagram, X/Twitter...)
 * Tự động chọn động cơ tải tối ưu và hẹn giờ dọn dẹp file sau 2 phút.
 */
export async function downloadMediaVideo(
  url: string,
  options?: VideoDownloadOptions,
): Promise<VideoDownloadResult> {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl) {
    return { success: false, error: "Đường link video không hợp lệ hoặc để trống." };
  }

  const outputDir = ensureVideoOutputDir();
  cleanOldDownloadedVideos(30);

  const format = options?.format === "audio" ? "audio" : "video";
  const isAudio = format === "audio";
  const maxMb = options?.maxFilesizeMb || (isAudio ? 50 : 150);
  const timeoutMs = options?.timeoutMs || 90_000;

  const isTikTok = /(?:tiktok\.com|vt\.tiktok\.com)\b/i.test(cleanUrl);
  const isYouTube = /(?:youtube\.com|youtu\.be)\b/i.test(cleanUrl);

  // 1. Ưu tiên đặc biệt cho TikTok: TikWM API siêu tốc (không watermark, 0.5s)
  if (isTikTok) {
    const tikWmRes = await downloadTikTokViaTikWm(cleanUrl, isAudio, outputDir);
    if (tikWmRes?.success) return tikWmRes;

    const apifyTikTokRes = await downloadTikTokViaApify(cleanUrl, isAudio, outputDir);
    if (apifyTikTokRes?.success) return apifyTikTokRes;
  }

  // 2. Chạy qua yt-dlp chính thức trên VPS
  const ytDlpBin = findYtDlpBinary();
  if (ytDlpBin) {
    try {
      const timestamp = Date.now();
      const outputTemplate = path.join(outputDir, `media_${timestamp}_%(id)s.%(ext)s`);

      const cookiesPath = getYtDlpCookiesPath();
      const ytArgs: string[] = [
        ...(cookiesPath ? ["--cookies", cookiesPath] : []),
        "--no-warnings",
        "--no-playlist",
        "--max-filesize", `${maxMb}M`,
        ...(isAudio
          ? ["-x", "--audio-format", "mp3", "--audio-quality", "0"]
          : [
              "-f",
              "bestvideo[vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=1080]+bestaudio[acodec^=mp4a]/bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
              "--merge-output-format",
              "mp4",
            ]),
        "--print", "%(title)s\t%(duration)s\t%(uploader)s\t%(filename)s",
        "-o", outputTemplate,
        cleanUrl,
      ];

      const { stdout } = await execFileAsync(ytDlpBin, ytArgs, { timeout: timeoutMs });
      const lines = stdout.trim().split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1] || "";
      const [title = "video", durationStr = "", author = "", outputPath = ""] = lastLine.split("\t");

      let resolvedFilePath = outputPath.trim();
      if (!resolvedFilePath || !fs.existsSync(resolvedFilePath)) {
        // Tìm file sinh ra theo timestamp
        const files = fs.readdirSync(outputDir);
        const matched = files.find((f) => f.includes(`media_${timestamp}`));
        if (matched) {
          resolvedFilePath = path.join(outputDir, matched);
        }
      }

      if (resolvedFilePath && fs.existsSync(resolvedFilePath)) {
        const stats = fs.statSync(resolvedFilePath);
        scheduleFileCleanup(resolvedFilePath, 120_000);

        const ext = isAudio ? "mp3" : "mp4";
        const cleanTitle = title.replace(/\t/g, " ").trim();
        const duration = Number(durationStr) || undefined;

        return {
          success: true,
          filePath: resolvedFilePath,
          fileName: path.basename(resolvedFilePath),
          fileSize: stats.size,
          title: cleanTitle,
          author: author.trim() || undefined,
          duration,
          fileType: ext,
          isMediaDownload: true,
          caption: isAudio
            ? `🎵 Đã tách xong âm thanh MP3 cho [${cleanTitle || "bản nhạc"}]!`
            : `🎬 Đã tải xong video [${cleanTitle || "clip"}] (${(stats.size / 1024 / 1024).toFixed(1)} MB)!`,
          summary: `Đã tải thành công ${ext.toUpperCase()} (${(stats.size / 1024 / 1024).toFixed(1)} MB).`,
        };
      }
    } catch (ytErr: any) {
      console.warn("[video-downloader] yt-dlp execution error:", ytErr?.message || ytErr);
    }
  }

  // 3. Fallback cho YouTube nếu yt-dlp gặp checkpoint anti-bot trên VPS
  if (isYouTube) {
    const apifyYtRes = await downloadYouTubeViaApify(cleanUrl, isAudio, outputDir);
    if (apifyYtRes?.success) return apifyYtRes;
  }

  return {
    success: false,
    error: `Không thể tải video từ đường link này. Nền tảng có thể đang áp dụng cơ chế chặn bot hoặc video ở chế độ riêng tư/bản quyền.`,
  };
}

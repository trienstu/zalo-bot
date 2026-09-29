import path from "node:path";
import ExcelJS from "exceljs";
import { config } from "../config.js";
import { ensureOutputDir, sanitizeSafeFileName, getTheme, type ThemeName } from "./file-generator.js";

export interface FacebookPostData {
  postId?: string;
  url: string;
  authorName?: string;
  authorId?: string;
  authorUrl?: string;
  publishedAt?: string;
  text: string;
  likes?: number;
  commentsCount?: number;
  shares?: number;
  mediaUrls?: string[];
}

export interface FacebookCommentData {
  id?: string;
  commentId?: string;
  text: string;
  authorName?: string;
  authorId?: string;
  authorUrl?: string;
  likesCount?: number | string;
  date?: string;
  commentUrl?: string;
  threadingDepth?: number;
  isAuthor?: boolean;
  hasLink?: boolean;
}

export interface FacebookEnrichedPost {
  post: FacebookPostData;
  authorComments: FacebookCommentData[];
  linkComments: FacebookCommentData[];
  topComments: FacebookCommentData[];
  allComments: FacebookCommentData[];
}

export interface ExportCommentsResult {
  success: boolean;
  filePath: string;
  fileName: string;
  totalComments: number;
  error?: string;
}

/**
 * Kiểm tra xem một URL có phải là link Facebook hay không (hỗ trợ cả web, mobile, share, watch, reel)
 */
export function isFacebookUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  return /(?:https?:\/\/)?(?:www\.|m\.|mobile\.|web\.)?(?:facebook\.com|fb\.com|fb\.watch)\b/i.test(url.trim());
}

/**
 * Trích xuất URL sạch từ link Facebook (bỏ các tham số tracking fbclid, ref, etc.)
 */
export function cleanFacebookUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    // Giữ lại các tham số quan trọng như v hoặc id nếu có
    const importantParams = new Set(["v", "id", "story_fbid"]);
    const keys = Array.from(parsed.searchParams.keys());
    for (const k of keys) {
      if (!importantParams.has(k)) {
        parsed.searchParams.delete(k);
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Kiểm tra comment có chứa URL hay không
 */
export function commentHasLink(text: string): boolean {
  return /https?:\/\/[^\s]+/i.test(text || "");
}

/**
 * Kiểm tra xem một bình luận có phải do chính tác giả bài viết viết hay không
 */
export function isCommentFromAuthor(comment: FacebookCommentData, post: FacebookPostData): boolean {
  if (post.authorId && comment.authorId && post.authorId === comment.authorId) {
    return true;
  }
  if (post.authorName && comment.authorName) {
    const a1 = post.authorName.trim().toLowerCase();
    const a2 = comment.authorName.trim().toLowerCase();
    if (a1 && a1 === a2) return true;
  }
  return false;
}

/**
 * Lấy Apify API Token từ config hoặc environment
 */
function getApifyToken(customToken?: string): string {
  const token = customToken || config.apifyApiToken || process.env.APIFY_API_TOKEN || "";
  return token.trim();
}

interface ApifyPostRawItem {
  postId?: string | number;
  url?: string;
  user?: { id?: string | number; name?: string; profileUrl?: string };
  pageName?: string;
  facebookId?: string | number;
  facebookUrl?: string;
  time?: string;
  timestamp?: number;
  text?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  media?: Array<{ thumbnail?: string; photo_image?: { uri?: string }; url?: string }>;
}

interface ApifyCommentRawItem {
  id?: string;
  commentId?: string;
  text?: string;
  author?: { id?: string | number; name?: string; url?: string };
  profileName?: string;
  profileId?: string | number;
  profileUrl?: string;
  likesCount?: number | string;
  date?: string;
  commentUrl?: string;
  threadingDepth?: number;
}

/**
 * Cào thông tin bài viết Facebook qua Actor apify/facebook-posts-scraper
 */
export async function crawlFacebookPost(
  postUrl: string,
  token?: string,
  timeoutMs = 60000,
): Promise<FacebookPostData | null> {
  const apifyToken = getApifyToken(token);
  if (!apifyToken) {
    console.warn("[facebook-scraper] Thiếu APIFY_API_TOKEN để cào bài viết Facebook.");
    return null;
  }

  const cleanedUrl = cleanFacebookUrl(postUrl);

  try {
    const endpoint = `https://api.apify.com/v2/acts/apify~facebook-posts-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(
      apifyToken,
    )}&memory=512&timeout=${Math.round(timeoutMs / 1000)}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: cleanedUrl }],
        resultsLimit: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      console.warn(`[facebook-scraper] Apify posts scraper HTTP ${res.status}`);
      return null;
    }

    const items = (await res.json()) as ApifyPostRawItem[];
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    const item = items[0];
    if (!item) return null;

    const mediaUrls: string[] = [];
    if (Array.isArray(item.media)) {
      for (const m of item.media) {
        const u = m.thumbnail || m.photo_image?.uri || m.url;
        if (u) mediaUrls.push(u);
      }
    }

    return {
      postId: item.postId ? String(item.postId) : undefined,
      url: item.url || cleanedUrl,
      authorName: item.user?.name || item.pageName || "",
      authorId: item.user?.id ? String(item.user.id) : item.facebookId ? String(item.facebookId) : undefined,
      authorUrl: item.user?.profileUrl || item.facebookUrl || undefined,
      publishedAt: item.time || (item.timestamp ? new Date(item.timestamp * 1000).toISOString() : undefined),
      text: item.text || "",
      likes: typeof item.likes === "number" ? item.likes : undefined,
      commentsCount: typeof item.comments === "number" ? item.comments : undefined,
      shares: typeof item.shares === "number" ? item.shares : undefined,
      mediaUrls,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[facebook-scraper] Lỗi cào bài viết Facebook (${cleanedUrl}):`, message);
    return null;
  }
}

/**
 * Cào danh sách bình luận Facebook qua Actor apify/facebook-comments-scraper
 */
export async function crawlFacebookComments(
  postUrl: string,
  maxComments = 50,
  token?: string,
  timeoutMs = 60000,
): Promise<FacebookCommentData[]> {
  const apifyToken = getApifyToken(token);
  if (!apifyToken) {
    console.warn("[facebook-scraper] Thiếu APIFY_API_TOKEN để cào bình luận Facebook.");
    return [];
  }

  const cleanedUrl = cleanFacebookUrl(postUrl);

  try {
    const endpoint = `https://api.apify.com/v2/acts/apify~facebook-comments-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(
      apifyToken,
    )}&memory=512&timeout=${Math.round(timeoutMs / 1000)}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: cleanedUrl }],
        resultsLimit: maxComments,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      console.warn(`[facebook-scraper] Apify comments scraper HTTP ${res.status}`);
      return [];
    }

    const items = (await res.json()) as ApifyCommentRawItem[];
    if (!Array.isArray(items)) return [];

    return items.map((it) => ({
      id: it.id ? String(it.id) : undefined,
      commentId: it.commentId ? String(it.commentId) : undefined,
      text: it.text || "",
      authorName: it.author?.name || it.profileName || "Ẩn danh",
      authorId: it.author?.id ? String(it.author.id) : it.profileId ? String(it.profileId) : undefined,
      authorUrl: it.author?.url || it.profileUrl || undefined,
      likesCount: it.likesCount || 0,
      date: it.date || undefined,
      commentUrl: it.commentUrl || undefined,
      threadingDepth: typeof it.threadingDepth === "number" ? it.threadingDepth : 0,
      hasLink: commentHasLink(it.text || ""),
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[facebook-scraper] Lỗi cào bình luận Facebook (${cleanedUrl}):`, message);
    return [];
  }
}

/**
 * Cào trọn vẹn cả bài viết và bình luận (chạy song song 2 Actor để tối ưu thời gian),
 * phân loại thông minh: bình luận chính chủ của tác giả, bình luận chứa link tài nguyên, top bình luận.
 */
export async function crawlFacebookEnrichedPost(
  postUrl: string,
  options: {
    maxComments?: number;
    token?: string;
    timeoutMs?: number;
  } = {},
): Promise<FacebookEnrichedPost | null> {
  const maxComments = options.maxComments ?? 25;
  const token = options.token;
  const timeoutMs = options.timeoutMs ?? 60000;

  const [postResult, commentsResult] = await Promise.allSettled([
    crawlFacebookPost(postUrl, token, timeoutMs),
    crawlFacebookComments(postUrl, maxComments, token, timeoutMs),
  ]);

  let post: FacebookPostData | null = null;
  if (postResult.status === "fulfilled" && postResult.value) {
    post = postResult.value;
  }

  let allComments: FacebookCommentData[] = [];
  if (commentsResult.status === "fulfilled" && Array.isArray(commentsResult.value)) {
    allComments = commentsResult.value;
  }

  // Nếu cả bài viết và comment đều không lấy được thì return null
  if (!post && allComments.length === 0) {
    return null;
  }

  // Nếu cào bài viết lỗi nhưng lấy được comment, tạo post giả lập từ URL
  if (!post) {
    post = {
      url: cleanFacebookUrl(postUrl),
      text: "(Không thể tải nội dung văn bản bài viết gốc - có thể là bài viết hạn chế hoặc video)",
      commentsCount: allComments.length,
    };
  }

  // Gán nhãn isAuthor cho từng comment
  const authorComments: FacebookCommentData[] = [];
  const linkComments: FacebookCommentData[] = [];
  const otherComments: FacebookCommentData[] = [];

  for (const c of allComments) {
    const isAuthor = isCommentFromAuthor(c, post);
    c.isAuthor = isAuthor;
    c.hasLink = commentHasLink(c.text);

    if (isAuthor) {
      authorComments.push(c);
    } else if (c.hasLink) {
      linkComments.push(c);
    } else {
      otherComments.push(c);
    }
  }

  // Top comments lấy từ author comments + link comments + các comment còn lại
  const topComments = [...authorComments, ...linkComments, ...otherComments].slice(0, 15);

  return {
    post,
    authorComments,
    linkComments,
    topComments,
    allComments,
  };
}

/**
 * Định dạng bài viết Facebook và các bình luận thành văn bản Markdown chuẩn mực cho LLM phân tích
 */
export function formatFacebookEnrichedPost(enriched: FacebookEnrichedPost): string {
  const { post, authorComments, linkComments, topComments } = enriched;
  const lines: string[] = [];

  lines.push(`# 📘 NỘI DUNG BÀI VIẾT FACEBOOK`);
  if (post.authorName) lines.push(`- **Tác giả:** ${post.authorName}`);
  if (post.publishedAt) lines.push(`- **Thời gian đăng:** ${post.publishedAt}`);
  lines.push(`- **Link bài viết:** ${post.url}`);

  const metrics: string[] = [];
  if (typeof post.likes === "number") metrics.push(`👍 ${post.likes.toLocaleString()} lượt thích`);
  if (typeof post.commentsCount === "number") metrics.push(`💬 ${post.commentsCount.toLocaleString()} bình luận`);
  if (typeof post.shares === "number") metrics.push(`🔄 ${post.shares.toLocaleString()} chia sẻ`);
  if (metrics.length > 0) lines.push(`- **Tương tác:** ${metrics.join(" | ")}`);

  lines.push(`\n### 📝 NỘI DUNG BÀI GỐC:\n${post.text || "(Bài viết không có nội dung chữ)"}\n`);

  if (post.mediaUrls && post.mediaUrls.length > 0) {
    lines.push(`### 🖼️ HÌNH ẢNH / MEDIA ĐÍNH KÈM:`);
    post.mediaUrls.forEach((u, i) => lines.push(`- Ảnh ${i + 1}: ${u}`));
    lines.push("");
  }

  // Khối 1: Bình luận của chính tác giả (Nơi thường để link, chia sẻ chi tiết)
  if (authorComments.length > 0) {
    lines.push(`## 📌 BÌNH LUẬN CỦA CHÍNH TÁC GIẢ (CHỨA LINK / THÔNG TIN BỔ SUNG QUAN TRỌNG):`);
    authorComments.forEach((c, idx) => {
      lines.push(`${idx + 1}. **[${c.authorName}]** (❤️ ${c.likesCount || 0}): ${c.text}`);
    });
    lines.push("");
  }

  // Khối 2: Các bình luận có chứa link tài liệu/nguồn
  if (linkComments.length > 0) {
    lines.push(`## 🔗 CÁC BÌNH LUẬN CÓ CHỨA ĐƯỜNG LINK / TÀI NGUYÊN:`);
    linkComments.forEach((c, idx) => {
      lines.push(`${idx + 1}. **[${c.authorName}]** (❤️ ${c.likesCount || 0}): ${c.text}`);
    });
    lines.push("");
  }

  // Khối 3: Top bình luận thảo luận tiêu biểu
  if (topComments.length > 0) {
    lines.push(`## 💬 TOP BÌNH LUẬN NỔI BẬT:`);
    topComments.slice(0, 10).forEach((c, idx) => {
      const tag = c.isAuthor ? " (Chính chủ)" : "";
      lines.push(`${idx + 1}. **${c.authorName}**${tag} [${c.likesCount || 0} like]: ${c.text}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Trích xuất toàn bộ danh sách bình luận Facebook ra file Excel (.xlsx) chuyên nghiệp
 */
export async function exportFacebookCommentsToExcel(
  comments: FacebookCommentData[],
  options: {
    postTitle?: string;
    postUrl?: string;
    fileName?: string;
    postAuthor?: string;
    theme?: string;
  } = {},
): Promise<ExportCommentsResult> {
  try {
    ensureOutputDir();

    const safeBase = sanitizeSafeFileName(options.fileName || options.postTitle || "binh_luan_facebook", "fb_comments");
    const fullFileName = safeBase.endsWith(".xlsx") ? safeBase : `${safeBase}.xlsx`;
    const targetPath = path.join(ensureOutputDir(), fullFileName);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Zalo Bot AI Assistant";
    workbook.created = new Date();

    const theme = getTheme((options.theme || "navy") as ThemeName);

    // Sheet 1: Danh Sách Bình Luận
    const sheet = workbook.addWorksheet("Bình Luận Facebook", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "STT", key: "stt", width: 8 },
      { header: "Người bình luận", key: "author", width: 26 },
      { header: "Vai trò", key: "role", width: 14 },
      { header: "Nội dung bình luận", key: "text", width: 65 },
      { header: "Lượt thích", key: "likes", width: 12 },
      { header: "Thời gian", key: "date", width: 22 },
      { header: "Link bình luận", key: "url", width: 38 },
    ];

    // Format Header
    const headerRow = sheet.getRow(1);
    headerRow.height = 28;
    headerRow.font = { bold: true, color: { argb: theme.headerText }, size: 11 };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: theme.primary },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };

    // Thêm các dòng bình luận
    comments.forEach((c, index) => {
      const isAuthor = Boolean(c.isAuthor);
      const roleText = isAuthor ? "🌟 Tác giả" : (c.hasLink ? "🔗 Có link" : "Thành viên");
      const formattedDate = c.date && !Number.isNaN(Date.parse(c.date))
        ? new Date(c.date).toLocaleString("vi-VN")
        : "";
      
      const row = sheet.addRow({
        stt: index + 1,
        author: c.authorName || "Ẩn danh",
        role: roleText,
        text: c.text || "",
        likes: c.likesCount || 0,
        date: formattedDate,
        url: c.commentUrl || "",
      });

      row.height = 24;
      row.alignment = { vertical: "middle" };

      // Định dạng ô nội dung wrap text
      const textCell = row.getCell("text");
      textCell.alignment = { vertical: "middle", wrapText: true };

      // Định dạng ô STT và Lượt thích căn giữa
      row.getCell("stt").alignment = { vertical: "middle", horizontal: "center" };
      row.getCell("role").alignment = { vertical: "middle", horizontal: "center" };
      row.getCell("likes").alignment = { vertical: "middle", horizontal: "center" };
      row.getCell("date").alignment = { vertical: "middle", horizontal: "center" };

      // Highlight dòng tác giả
      if (isAuthor) {
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF0F7FF" }, // Xanh lam nhạt
        };
        row.getCell("role").font = { bold: true, color: { argb: "FF0A58CA" } };
      }
    });

    // Sheet 2: Thông Tin Bài Viết (Nếu có thông tin post)
    if (options.postTitle || options.postUrl || options.postAuthor) {
      const infoSheet = workbook.addWorksheet("Thông Tin Bài Viết");
      infoSheet.columns = [
        { header: "Thuộc tính", key: "prop", width: 22 },
        { header: "Chi tiết", key: "val", width: 70 },
      ];

      const infoHeader = infoSheet.getRow(1);
      infoHeader.height = 26;
      infoHeader.font = { bold: true, color: { argb: theme.headerText } };
      infoHeader.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: theme.primary },
      };

      infoSheet.addRow({ prop: "Tác giả bài viết", val: options.postAuthor || "N/A" });
      infoSheet.addRow({ prop: "Đường link", val: options.postUrl || "N/A" });
      infoSheet.addRow({ prop: "Nội dung bài viết", val: options.postTitle || "N/A" });
      infoSheet.addRow({ prop: "Tổng số bình luận cào được", val: comments.length });
      infoSheet.addRow({ prop: "Thời gian trích xuất", val: new Date().toLocaleString("vi-VN") });

      infoSheet.eachRow((r, rowNumber) => {
        if (rowNumber > 1) {
          r.height = 22;
          r.alignment = { vertical: "middle" };
          r.getCell("prop").font = { bold: true };
          r.getCell("val").alignment = { vertical: "middle", wrapText: true };
        }
      });
    }

    await workbook.xlsx.writeFile(targetPath);

    return {
      success: true,
      filePath: targetPath,
      fileName: fullFileName,
      totalComments: comments.length,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[facebook-scraper] Lỗi xuất file Excel:", errorMsg);
    return {
      success: false,
      filePath: "",
      fileName: "",
      totalComments: 0,
      error: errorMsg,
    };
  }
}

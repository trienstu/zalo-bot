import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { callGeminiJson } from "../gemini.js";
import { synthesizeSingleAudio } from "../tools/voice-generator.js";
import { sendDirectFile, sendDirectText, sendGroupFile, sendGroupText } from "../zalo/client.js";

const execFileAsync = promisify(execFile);

const GENERATED_FILES_DIR = path.resolve(process.cwd(), "data", "generated-files");

function ensureOutputDir(): string {
  if (!fs.existsSync(GENERATED_FILES_DIR)) {
    fs.mkdirSync(GENERATED_FILES_DIR, { recursive: true });
  }
  return GENERATED_FILES_DIR;
}

function getRemotionDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "remotion-engine"),
    path.resolve(process.cwd(), "..", "remotion-engine"),
    path.resolve(process.cwd(), "bot", "remotion-engine"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), "..", "remotion-engine");
}

export type MotionVideoGenre =
  | "tiktok_story"
  | "versus"
  | "breaking_news"
  | "landscape"
  | "spotlight";

export interface MotionVideoJobOptions {
  api: any;
  sender: string;
  isGroup: boolean;
  threadId?: string;
  userGreeting: string;
  displayName?: string;
  userPrompt: string;
  quoteText?: string;
  genre?: MotionVideoGenre;
}

export interface MotionPlan {
  genre: MotionVideoGenre;
  badge: string;
  title: string;
  subtitle: string;
  narrationScript: string;
  primaryColor?: string;
  secondaryColor?: string;
  // Dynamic props depending on genre
  points?: string[];
  scenes?: Array<{
    hookEmoji: string;
    badge: string;
    words: string[];
    subtext: string;
    accentColor: string;
  }>;
  optionA?: {
    name: string;
    badge: string;
    color: string;
    points: string[];
  };
  optionB?: {
    name: string;
    badge: string;
    color: string;
    points: string[];
  };
  headline?: string;
  sourceText?: string;
  keyPoints?: string[];
  tickerItems?: string[];
  bulletPoints?: string[];
  metrics?: Array<{
    label: string;
    value: string;
    subtext: string;
  }>;
}

/**
 * Kiểm tra xem người dùng có yêu cầu tạo Video Motion Graphics / Shorts / TikTok / So sánh / Tin tức hay không.
 */
export function isMotionVideoRequest(text: string, quoteText = ""): boolean {
  const qLower = (text || "").trim().toLowerCase();
  const quoteLower = (quoteText || "").trim().toLowerCase();
  const combined = `${qLower} ${quoteLower}`.trim();

  if (!qLower) return false;

  // 1. Phủ định phản hồi, khiếu nại, góp ý
  const isFeedback =
    /^(?:sao|sao\s+lại|sao\s+thế|sao\s+vậy|sao\s+tự|tại\s+sao|sao\s+nó)\s+(?:gửi|tạo|làm|ra|xuất|bắn)\s+(?:video|clip)/iu.test(
      qLower,
    ) ||
    /(?:bị\s+lỗi|lỗi\s+rồi|nhận\s+nhầm|sai\s+rồi|đừng\s+làm\s+video|ai\s+mượn\s+làm\s+video)/iu.test(
      qLower,
    );
  if (isFeedback) return false;

  // 2. Phủ định nếu là yêu cầu tải video từ link
  const isVideoDownloadReq =
    /(?:tải|download|lấy|get|rip|down)\s+(?:video|clip|link|mp4)/i.test(qLower) ||
    /https?:\/\/(?:www\.)?(?:tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|douyin\.com|kuaishou\.com)/i.test(
      combined,
    );
  if (isVideoDownloadReq) return false;

  // 3. Phủ định tóm tắt video
  const isVideoSummaryReq =
    /(?:tóm\s*tắt|xem|hiểu|phân\s*tích|review)\s+(?:video|clip|link)\s+(?:này|đó|trên|dưới)/iu.test(
      qLower,
    );
  if (isVideoSummaryReq) return false;

  // 4. Phủ định câu hỏi hoài nghi / thăm dò năng lực
  const isHypotheticalOrInquiry =
    /^(?:em|bot|mày|bác)?\s*(?:có\s+)?(?:biết|làm|tạo|xuất)?\s*(?:được|đc|duoc)?(?:\s+(?:tạo|làm|soạn|xuất))?\s+(?:video|clip)\s*(?:không|ko)?\s*(?:hả|nhỉ|hở|ạ|không|ko)\s*[?]?$/iu.test(
      qLower,
    ) ||
    /(?:có\s+(?:thật|thiệt)\s+.*?(?:được\s+không|được\s+ko|ko\s*đó|không\s*đó|hả|nhỉ|chăng)|tự\s+làm\s+(?:được|đc)\s+(?:không|ko|hả|sao)|chắc\s+làm\s+được|làm\s+sao\s+mà\s+làm\s+được)/iu.test(
      qLower,
    ) ||
    /(?:^|[^\p{L}\p{N}])(?:làm|tạo|dựng|quay|xuất)\s+(?:video|clip).*?(?:có\s+khó|như\s+thế\s+nào|kiếm\s+tiền|phần\s+mềm|bằng\s+app|app\s+gì|dễ\s+không|sao\s+nhỉ|ở\s+đâu|bằng\s+cách\s+nào)/iu.test(
      qLower,
    );
  if (isHypotheticalOrInquiry) return false;

  // 5. Cụm từ nhận diện trực tiếp
  const directTerms =
    /\b(?:video|clip)\s+(?:tiktok|shorts|reels|chuyển\s*động|motion|so\s*sánh|tin\s*nóng|thời\s*sự|remotion|karaoke|nhảy\s*chữ)\b/iu.test(
      qLower,
    ) ||
    /\b(?:tiktok|shorts|reels|motion|remotion)\s+(?:video|clip)\b/iu.test(qLower);
  if (directTerms) return true;

  // 6. Mệnh lệnh tạo video kết hợp với từ khóa thể loại
  const hasDirectVideoCommand =
    /(?:(?:hãy|giúp|nhờ|em)?\s*(?:làm|tạo|dựng|xuất|quay|sản\s*xuất)\s+(?:cho\s*(?:anh|em|tôi|sếp|mình|nhóm)\s*)?(?:(?:1|một)?\s*(?:bản|file|bộ)?\s*)?(?:video|clip|mp4|thước\s*phim))/iu.test(
      qLower,
    );

  const mentionsMotionGenre =
    /\b(?:tiktok|shorts|reels|chuyển\s*động|motion|so\s*sánh|versus|vs|đối\s*đầu|tin\s*nóng|thời\s*sự|breaking\s*news|remotion|karaoke|nhảy\s*chữ|bản\s*tin)\b/iu.test(
      combined,
    );

  if (hasDirectVideoCommand && mentionsMotionGenre) {
    return true;
  }

  // 7. Nhận diện từ tin nhắn trích dẫn nếu bot vừa đề xuất
  if (quoteLower) {
    const isQuotingProposal =
      /(?:video\s+tiktok|video\s+shorts|remotion|video\s+chuyển\s*động|video\s+so\s*sánh)/iu.test(
        quoteLower,
      );
    const isAffirmation =
      /(?:ok|oke|ừ|uh|u|dạ|vâng|được|triển|làm\s*đi|xuất\s*đi|làm\s*luôn)/iu.test(qLower);
    if (isQuotingProposal && isAffirmation) return true;
  }

  return false;
}

/**
 * Phân tích thể loại video phù hợp nhất từ câu hỏi người dùng.
 */
export function determineMotionVideoGenre(text: string, quoteText = ""): MotionVideoGenre {
  const combined = `${text || ""} ${quoteText || ""}`.toLowerCase();

  if (/(?:^|[^\p{L}\p{N}])(?:so\s*sánh|versus|vs|đối\s*đầu|chọn\s*(?:cái|con|kênh)\s*nào|khác\s*nhau)(?=[^\p{L}\p{N}]|$)/iu.test(combined)) {
    return "versus";
  }
  if (/(?:^|[^\p{L}\p{N}])(?:tin\s*nóng|thời\s*sự|breaking\s*news|bản\s*tin|sáng\s*nay|hôm\s*nay|thị\s*trường)(?=[^\p{L}\p{N}]|$)/iu.test(combined)) {
    return "breaking_news";
  }
  if (/(?:^|[^\p{L}\p{N}])(?:thuyết\s*trình|16:9|ngang|keynote|báo\s*cáo\s*dự\s*án|kiến\s*trúc)(?=[^\p{L}\p{N}]|$)/iu.test(combined)) {
    return "landscape";
  }
  if (/(?:^|[^\p{L}\p{N}])(?:tiktok|shorts|reels|kể\s*chuyện|story|karaoke|nhảy\s*chữ|sai\s*lầm|bí\s*mật|viral)(?=[^\p{L}\p{N}]|$)/iu.test(combined)) {
    return "tiktok_story";
  }

  return "spotlight";
}

/**
 * Lập kế hoạch kịch bản chi tiết qua Gemini.
 */
export async function planMotionVideoWithGemini(
  prompt: string,
  quoteText = "",
  forcedGenre?: MotionVideoGenre,
): Promise<MotionPlan> {
  const detectedGenre = forcedGenre || determineMotionVideoGenre(prompt, quoteText);

  const systemInstruction =
    `Bạn là Chuyên gia Đạo diễn & Biên kịch Video Đồ Họa Chuyển Động (Motion Graphics Director) cho mạng xã hội và doanh nghiệp.\n` +
    `Nhiệm vụ: Chuyển đổi yêu cầu hoặc thông tin người dùng thành kịch bản video chuẩn mực với 1 trong 5 thể loại:\n` +
    `1. "tiktok_story": Video dọc 9:16 phong cách TikTok/Shorts nhiều cảnh (3 scenes: Hook gây sốc 🚨 -> Nguyên nhân 🧠 -> Giải pháp 🚀), phụ đề nhảy chữ karaoke từng từ.\n` +
    `2. "versus": Video so sánh 2 phương án đối đầu A vs B (ví dụ: Vàng vs BĐS, iPhone vs Android, Cổ phiếu A vs B).\n` +
    `3. "breaking_news": Video bản tin thời sự khẩn cấp với headline giật gân, 3 ý chính và 5 tin vắn chạy chân ticker.\n` +
    `4. "landscape": Video ngang 16:9 thuyết trình dự án/báo cáo công nghệ với 3 ý checklist và 3 thẻ chỉ số KPI.\n` +
    `5. "spotlight": Video dọc 9:16 điểm tin kiến thức tổng hợp (3-4 điểm nhấn súc tích, hiện đại).\n\n` +
    `YÊU CẦU ĐẶC BIỆT:\n` +
    `- "genre": Chọn chính xác thể loại phù hợp (thể loại đề xuất: "${detectedGenre}").\n` +
    `- "narrationScript": Kịch bản đọc thuyết minh bằng tiếng Việt truyền cảm hứng, tự nhiên, nhịp nhàng (khoảng 35-70 từ, đọc trong 12-25 giây).\n` +
    `- Tùy theo genre, hãy điền đầy đủ các trường dữ liệu tương ứng.\n` +
    `- Màu sắc ("primaryColor", "secondaryColor"): Chọn mã Hex hài hòa, hiện đại, rực rỡ (ví dụ #4f46e5, #ec4899, #10b981, #f59e0b, #3b82f6).\n` +
    `Cấu trúc JSON bắt buộc:\n` +
    `{\n` +
    `  "genre": "tiktok_story" | "versus" | "breaking_news" | "landscape" | "spotlight",\n` +
    `  "badge": "...", "title": "...", "subtitle": "...", "narrationScript": "...",\n` +
    `  "primaryColor": "#...", "secondaryColor": "#...",\n` +
    `  "points": ["..."],\n` +
    `  "scenes": [{"hookEmoji": "🚨", "badge": "...", "words": ["..."], "subtext": "...", "accentColor": "#..."}],\n` +
    `  "optionA": {"name": "...", "badge": "...", "color": "#...", "points": ["..."]},\n` +
    `  "optionB": {"name": "...", "badge": "...", "color": "#...", "points": ["..."]},\n` +
    `  "headline": "...", "sourceText": "...", "keyPoints": ["..."], "tickerItems": ["..."],\n` +
    `  "bulletPoints": ["..."], "metrics": [{"label": "...", "value": "...", "subtext": "..."}]\n` +
    `}`;

  const userContent =
    `YÊU CẦU NGƯỜI DÙNG: "${prompt}"\n` +
    (quoteText ? `THÔNG TIN TRÍCH DẪN ĐÍNH KÈM:\n"""\n${quoteText.slice(0, 3000)}\n"""\n` : "");

  try {
    const rawJson = await callGeminiJson(systemInstruction, userContent, 4000);
    const plan = JSON.parse(rawJson) as MotionPlan;

    if (!plan || !plan.genre) {
      throw new Error("Gemini không trả về plan hợp lệ");
    }
    return plan;
  } catch (err) {
    console.warn("[motion-video] Gemini plan JSON lỗi, dùng fallback plan:", err);
    return {
      genre: detectedGenre,
      badge: "AI SPOTLIGHT",
      title: "TỔNG HỢP KIẾN THỨC NỔI BẬT",
      subtitle: prompt.slice(0, 60),
      narrationScript: `Chào các bạn, sau đây là tổng hợp nhanh về ${prompt.slice(0, 80)}. Chúc các bạn tiếp thu nhiều kiến thức hữu ích cùng Sen Chúa AI.`,
      primaryColor: "#4f46e5",
      secondaryColor: "#ec4899",
      points: [
        "Nội dung trọng tâm số 1: Tối ưu quy trình vận hành tự động",
        "Nội dung trọng tâm số 2: Tận dụng sức mạnh trí tuệ nhân tạo",
        "Nội dung trọng tâm số 3: Tăng trưởng hiệu quả bền vững",
      ],
    };
  }
}

/**
 * Điều phối toàn bộ quy trình: Lập kịch bản -> TTS Voice -> Remotion Render -> Gửi Zalo.
 */
export async function runMotionVideoJob(options: MotionVideoJobOptions): Promise<void> {
  const { api, sender, isGroup, threadId, userGreeting, userPrompt, quoteText, genre } = options;
  const remotionDir = getRemotionDir();
  const outputDir = ensureOutputDir();

  console.log(`[motion-video] 🎬 Bắt đầu job render Remotion cho: "${userPrompt.slice(0, 60)}"...`);

  // Phản hồi tin nhắn chờ
  const initialGenre = genre || determineMotionVideoGenre(userPrompt, quoteText);
  const genreNames: Record<MotionVideoGenre, string> = {
    tiktok_story: "TikTok Viral Story (Phụ đề Karaoke CapCut)",
    versus: "So Sánh Đối Đầu (A vs B)",
    breaking_news: "Bản Tin Nóng (Thời sự Ticker Tape)",
    landscape: "Thuyết Trình Dự Án (16:9 Keynote)",
    spotlight: "Điểm Tin Kiến Thức Dọc (Shorts Spotlight)",
  };

  const waitMsg =
    `🎬 ${userGreeting} chờ em một chút nhé! Em đang lên kịch bản và dựng video thể loại **${genreNames[initialGenre]}** với đồ họa chuyển động Remotion Full HD, dự kiến khoảng 20-30 giây xong ạ... ✨`;

  if (isGroup && threadId) {
    await sendGroupText(api, threadId, waitMsg);
  } else {
    await sendDirectText(api, sender, waitMsg);
  }

  try {
    // 1. Sinh kịch bản qua Gemini
    const plan = await planMotionVideoWithGemini(userPrompt, quoteText, genre);

    // 2. Tạo giọng đọc thuyết minh qua Google AI Studio TTS
    const remotionPublicDir = path.resolve(remotionDir, "public");
    if (!fs.existsSync(remotionPublicDir)) {
      fs.mkdirSync(remotionPublicDir, { recursive: true });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const audioFileName = `${jobId}.mp3`;
    const targetAudioPath = path.resolve(remotionPublicDir, audioFileName);

    console.log(`[motion-video] 🎙️ Đang sinh voice thuyết minh AI Studio: "${plan.narrationScript.slice(0, 60)}..."`);
    await synthesizeSingleAudio(plan.narrationScript, targetAudioPath, "Aoede", {
      stylePrompt: "Giọng đọc truyền cảm, hiện đại, năng động, chuẩn âm thanh phòng thu",
    });

    if (!fs.existsSync(targetAudioPath)) {
      throw new Error("Không tìm thấy file audio đã sinh");
    }

    // Đo độ dài thực tế của file âm thanh
    let durationSec = 5;
    try {
      const { stdout: probeOut } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        targetAudioPath,
      ]);
      const parsedDuration = parseFloat(probeOut.trim());
      if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
        durationSec = parsedDuration;
      }
    } catch (e) {
      console.warn("[motion-video] ffprobe không đọc được thời lượng, dùng giá trị ước tính:", e);
    }

    const durationInFrames = Math.max(90, Math.ceil(durationSec * 30) + 15); // +0.5s pause
    console.log(`[motion-video] ⏱️ Thời lượng audio: ${durationSec.toFixed(2)}s -> ${durationInFrames} frames`);

    // 3. Chuẩn bị props và composition ID
    let compositionId = "VerticalShorts";
    let inputProps: any = {
      audioFile: audioFileName,
      speakerName: "Sen Chúa AI",
      primaryColor: plan.primaryColor || "#4f46e5",
      secondaryColor: plan.secondaryColor || "#ec4899",
      badge: plan.badge,
      title: plan.title,
      subtitle: plan.subtitle,
    };

    if (plan.genre === "tiktok_story" && plan.scenes && plan.scenes.length > 0) {
      compositionId = "TikTokViralStory";
      inputProps = {
        audioFile: audioFileName,
        scenes: plan.scenes,
      };
    } else if (plan.genre === "versus" && plan.optionA && plan.optionB) {
      compositionId = "VersusComparison";
      inputProps = {
        audioFile: audioFileName,
        title: plan.title,
        subtitle: plan.subtitle,
        optionA: plan.optionA,
        optionB: plan.optionB,
      };
    } else if (plan.genre === "breaking_news") {
      compositionId = "BreakingNews";
      inputProps = {
        audioFile: audioFileName,
        headline: plan.headline || plan.title,
        sourceText: plan.sourceText || `BẢN TIN 24H • ${userGreeting.toUpperCase()}`,
        keyPoints: plan.keyPoints || plan.points || [
          "Cập nhật diễn biến quan trọng nhất vừa ghi nhận.",
          "Tác động trực tiếp đến xu hướng thị trường sắp tới.",
          "Khuyến nghị theo dõi sát sao các chỉ số kế tiếp.",
        ],
        tickerItems: plan.tickerItems || [
          "THỜI SỰ 24/7",
          "CẬP NHẬT TỨC THÌ",
          "SEN CHÚA AI ASSISTANT",
        ],
      };
    } else if (plan.genre === "landscape") {
      compositionId = "LandscapeExplainer";
      inputProps = {
        audioFile: audioFileName,
        badge: plan.badge,
        title: plan.title,
        subtitle: plan.subtitle,
        bulletPoints: plan.bulletPoints || plan.points || [
          "Mục tiêu triển khai đồng bộ hóa quy trình.",
          "Hiệu năng vận hành vượt trội.",
          "Bảo đảm an toàn dữ liệu và tối ưu chi phí.",
        ],
        metrics: plan.metrics || [
          { label: "HIỆU SUẤT", value: "99.9%", subtext: "Thời gian thực" },
          { label: "TIẾT KIỆM", value: "80%", subtext: "So với thủ công" },
          { label: "TỐC ĐỘ", value: "12 FPS", subtext: "Chuẩn Full HD" },
        ],
        primaryColor: plan.primaryColor || "#3b82f6",
        secondaryColor: plan.secondaryColor || "#8b5cf6",
      };
    } else {
      // spotlight
      compositionId = "VerticalShorts";
      inputProps = {
        audioFile: audioFileName,
        speakerName: "Sen Chúa AI",
        badge: plan.badge,
        title: plan.title,
        subtitle: plan.subtitle,
        points: plan.points || [
          "Điểm nhấn công nghệ tự động hóa",
          "Đồng bộ hóa dữ liệu thời gian thực",
          "Trải nghiệm người dùng thông minh",
        ],
        primaryColor: plan.primaryColor || "#059669",
        secondaryColor: plan.secondaryColor || "#10b981",
      };
    }

    // Ghi props ra file tạm
    const propsFilePath = path.resolve(remotionDir, `props-${jobId}.json`);
    fs.writeFileSync(propsFilePath, JSON.stringify(inputProps, null, 2), "utf8");

    // 4. Render Video bằng Remotion
    const cleanFileName = `Video_${plan.genre}_${Date.now()}.mp4`;
    const finalMp4Path = path.resolve(outputDir, cleanFileName);
    const renderScriptPath = path.resolve(remotionDir, "render.mjs");

    console.log(`[motion-video] 🚀 Đang render composition '${compositionId}' ra ${finalMp4Path}...`);

    // Thực thi subprocess với độ ưu tiên CPU thấp để không ảnh hưởng bot chính
    const renderArgs = [
      "-n", "10",
      "node", renderScriptPath,
      `--comp=${compositionId}`,
      `--props=${propsFilePath}`,
      `--duration=${durationInFrames}`,
      `--out=${finalMp4Path}`,
      `--concurrency=1`,
    ];

    await execFileAsync("nice", renderArgs, {
      cwd: remotionDir,
      timeout: 240000, // 4 phút tối đa cho VPS 1-core
    });

    // Xóa file tạm
    try {
      if (fs.existsSync(propsFilePath)) fs.unlinkSync(propsFilePath);
      if (fs.existsSync(targetAudioPath)) fs.unlinkSync(targetAudioPath);
    } catch {}

    if (!fs.existsSync(finalMp4Path)) {
      throw new Error("File video đầu ra không được tạo thành công");
    }

    const stats = fs.statSync(finalMp4Path);
    console.log(`[motion-video] ✅ Render thành công! File: ${finalMp4Path} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);

    // 5. Gửi file vào Zalo
    const caption =
      `🎬 **VIDEO ĐỒ HỌA CHUYỂN ĐỘNG REMOTION**\n` +
      `🏷️ **Thể loại**: ${genreNames[plan.genre]}\n` +
      `📌 **Chủ đề**: ${plan.title}\n` +
      `⏱️ **Thời lượng**: ${durationSec.toFixed(1)}s (Full HD 30fps)\n` +
      `🎙️ **Thuyết minh**: AI Studio Voice\n\n` +
      `Chúc ${userGreeting} xem video vui vẻ ạ! ✨`;

    if (isGroup && threadId) {
      await sendGroupFile(api, threadId, finalMp4Path, cleanFileName);
      await sendGroupText(api, threadId, caption);
    } else {
      await sendDirectFile(api, sender, finalMp4Path, cleanFileName);
      await sendDirectText(api, sender, caption);
    }
  } catch (err: any) {
    console.error("[motion-video] ❌ Lỗi xử lý runMotionVideoJob:", err);
    const errMsg = `Dạ ${userGreeting}, quá trình dựng video gặp sự cố: ${err.message || "Lỗi không xác định"}. Em sẽ ghi nhận để khắc phục ạ!`;
    if (isGroup && threadId) {
      await sendGroupText(api, threadId, errMsg);
    } else {
      await sendDirectText(api, sender, errMsg);
    }
  }
}

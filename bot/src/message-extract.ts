/**
 * Rút nội dung từ payload message của zca-js để ghi vào DB.
 *
 * zca-js định nghĩa content: string | TAttachmentContent | TOtherContent.
 * - Text thuần → content là string.
 * - Link/recommend (chat.link, chat.recommended) → content là object { title, description, href, ... }.
 * - Ảnh/video (chat.photo, chat.video.msg) → content cũng là object (có href/thumb) + msgType đặc thù.
 *
 * Tách khỏi listener.ts để test độc lập, không kéo theo env/config lúc load.
 */

export function parseObjectMaybe(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function positiveInt(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.trunc(n));
}

export function extractMediaSummary(payload: any): { type: "image" | "video"; count: number } | null {
  const data = payload?.data ?? {};
  const msgType = String(data?.msgType ?? "").toLowerCase();
  const content = parseObjectMaybe(data?.content);
  const params = parseObjectMaybe(content?.params);
  const contentType = String(content?.type ?? params?.type ?? "").toLowerCase();
  const rawCount =
    positiveInt(content?.childnumber) ??
    positiveInt(content?.childNumber) ??
    positiveInt(params?.childnumber) ??
    positiveInt(params?.childNumber) ??
    positiveInt(params?.count);

  if (msgType.includes("video") || contentType.includes("video")) {
    return { type: "video", count: rawCount ?? 1 };
  }
  if (
    msgType.includes("photo") ||
    msgType.includes("image") ||
    contentType.includes("photo") ||
    contentType.includes("image")
  ) {
    return { type: "image", count: rawCount ?? 1 };
  }
  return null;
}

/** URL media tạm do Zalo trả về; Telegram có thể dùng URL này để tải ảnh/video. */
export function extractMediaUrl(payload: any): string | null {
  if (extractMediaSummary(payload) === null) return null;
  const content = parseObjectMaybe(payload?.data?.content);
  const params = parseObjectMaybe(content?.params);
  const candidates = [
    content?.href,
    content?.hdUrl,
    content?.url,
    params?.href,
    params?.hdUrl,
    params?.url,
    content?.thumb,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (/^https?:\/\//i.test(value)) return value;
  }
  return null;
}

/**
 * Id của tin BỊ THU HỒI trong payload sự kiện `undo` của zca-js.
 *
 * Payload undo mang id của CHÍNH thông báo thu hồi ở data.msgId/cliMsgId — không
 * phải tin bị xoá. Tin bị xoá nằm trong data.content: { globalMsgId, cliMsgId,
 * deleteMsg, ... }. Lúc nhận tin, listener lưu message_id theo thứ tự ưu tiên
 * msgId → cliMsgId (msgId chính là globalMsgId ở dạng chuỗi), nên trả về CẢ HAI
 * ứng viên rồi để tầng DB khớp cái nào có trong kho.
 */
export function extractUndoTargetIds(payload: any): string[] {
  const content = parseObjectMaybe(payload?.data?.content);
  if (!content) return [];
  const ids = [content.globalMsgId, content.cliMsgId, content.msgId]
    .map((v) => (v === null || v === undefined ? "" : String(v).trim()))
    // "0" là giá trị rỗng của Zalo cho id không có — khớp "0" sẽ đánh dấu nhầm.
    .filter((v) => v !== "" && v !== "0");
  return [...new Set(ids)];
}

export function extractText(payload: any): string | null {
  const content = payload?.data?.content;
  if (typeof content === "string") {
    const text = content.trim();
    // Nếu chuỗi là JSON serialized object (ví dụ quote message):
    if (text.startsWith("{") && text.endsWith("}")) {
      const obj = parseObjectMaybe(text);
      if (obj) {
        const userMsg =
          typeof obj.message === "string" && obj.message.trim() !== ""
            ? obj.message.trim()
            : typeof obj.msg === "string" && obj.msg.trim() !== ""
              ? obj.msg.trim()
              : typeof obj.text === "string" && obj.text.trim() !== ""
                ? obj.text.trim()
                : null;
        if (userMsg) return userMsg;

        const title = typeof obj.title === "string" ? obj.title.trim() : "";
        const desc = typeof obj.description === "string" ? obj.description.trim() : "";
        if (title || desc) return [title, desc].filter(Boolean).join(" ");
      }
    }
    return text ? text : null;
  }

  const obj = parseObjectMaybe(content);
  if (obj) {
    // Nếu có trường message/msg (tin reply người dùng gõ vào khi quote)
    const userMsg =
      typeof obj.message === "string" && obj.message.trim() !== ""
        ? obj.message.trim()
        : typeof obj.msg === "string" && obj.msg.trim() !== ""
          ? obj.msg.trim()
          : typeof obj.text === "string" && obj.text.trim() !== ""
            ? obj.text.trim()
            : null;

    if (userMsg) return userMsg;

    const isMedia = extractMediaSummary(payload) != null;
    const fields = isMedia ? [obj.title, obj.description] : [obj.title, obj.description, obj.href];
    const parts = fields
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .map((v) => v.trim());
    if (parts.length > 0) {
      return [...new Set(parts)].join(" — ");
    }
  }

  // Fallback từ các trường khác của payload
  const directMsg = payload?.data?.msg ?? payload?.data?.text ?? payload?.text;
  if (typeof directMsg === "string" && directMsg.trim() !== "") {
    return directMsg.trim();
  }

  return null;
}

export interface QuotedMessage {
  text: string;
  senderName?: string;
  senderId?: string;
  mediaUrl?: string;
  mediaType?: "image" | "video";
}

/**
 * Trích xuất nội dung tin nhắn được trích dẫn (Quote / Reply) trong Zalo.
 */
export function extractQuote(payload: any): QuotedMessage | null {
  const data = payload?.data;
  let quoteObj = data?.quote || payload?.quote;

  if (!quoteObj && typeof data?.content === "string" && data.content.startsWith("{")) {
    const parsed = parseObjectMaybe(data.content);
    if (parsed?.quote) quoteObj = parsed.quote;
  } else if (!quoteObj && data?.content && typeof data.content === "object") {
    if (data.content.quote) quoteObj = data.content.quote;
  }

  if (!quoteObj) return null;

  const quote = (parseObjectMaybe(quoteObj) || (typeof quoteObj === "object" ? quoteObj : null)) as Record<string, any> | null;
  if (!quote) return null;

  const text =
    typeof quote.msg === "string" && quote.msg.trim() !== ""
      ? quote.msg.trim()
      : typeof quote.text === "string" && quote.text.trim() !== ""
        ? quote.text.trim()
        : typeof quote.content === "string" && quote.content.trim() !== ""
          ? quote.content.trim()
          : typeof quote.title === "string" && quote.title.trim() !== ""
            ? quote.title.trim()
            : "";

  const senderName = typeof quote.dName === "string" ? quote.dName : typeof quote.displayName === "string" ? quote.displayName : "";
  const senderId = typeof quote.ownerId === "string" ? String(quote.ownerId) : typeof quote.from === "string" ? String(quote.from) : "";

  let mediaUrl: string | undefined;
  let mediaType: "image" | "video" | undefined;

  const attach = parseObjectMaybe(quote.attach);
  const params = parseObjectMaybe(quote.params);
  const propertyExt = parseObjectMaybe(quote.propertyExt);
  const contentObj = parseObjectMaybe(quote.content);

  const candidateUrls = [
    quote.href,
    quote.hdUrl,
    quote.url,
    quote.thumb,
    quote.thumbUrl,
    attach?.href,
    attach?.hdUrl,
    attach?.url,
    attach?.thumb,
    attach?.thumbUrl,
    params?.href,
    params?.hdUrl,
    params?.url,
    params?.thumb,
    params?.thumbUrl,
    propertyExt?.href,
    propertyExt?.hdUrl,
    propertyExt?.url,
    propertyExt?.thumb,
    contentObj?.href,
    contentObj?.hdUrl,
    contentObj?.url,
    contentObj?.thumb,
  ];

  for (const c of candidateUrls) {
    if (typeof c === "string" && /^https?:\/\//i.test(c.trim())) {
      mediaUrl = c.trim();
      break;
    }
  }

  if (mediaUrl) {
    const msgType = String(quote.msgType || quote.type || attach?.type || params?.type || "").toLowerCase();
    mediaType = msgType.includes("video") ? "video" : "image";
  }

  if (!text && !mediaUrl) return null;

  return {
    text,
    senderName: senderName || undefined,
    senderId: senderId || undefined,
    mediaUrl,
    mediaType,
  };
}

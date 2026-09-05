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

/**
 * Quét sâu gom tất cả các candidate URL hợp lệ từ các object, array hoặc chuỗi JSON.
 */
export function collectCandidateUrls(sources: unknown[]): string[] {
  const urls: string[] = [];
  const visited = new Set<unknown>();

  function walk(node: unknown): void {
    if (!node || visited.has(node)) return;
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (/^https?:\/\//i.test(trimmed)) {
        urls.push(trimmed);
        return;
      }
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          const parsed = JSON.parse(trimmed);
          walk(parsed);
        } catch {}
      }
      return;
    }
    if (Array.isArray(node)) {
      visited.add(node);
      for (const item of node) {
        walk(item);
      }
      return;
    }
    if (typeof node === "object") {
      visited.add(node);
      const record = node as Record<string, unknown>;
      const priorityKeys = [
        "hdUrl",
        "href",
        "url",
        "normalUrl",
        "originUrl",
        "origUrl",
        "sourceUrl",
        "imgUrl",
        "photoUrl",
        "fileUrl",
        "previewUrl",
        "thumb",
        "thumbUrl",
      ];
      for (const key of priorityKeys) {
        const val = record[key];
        if (typeof val === "string" && /^https?:\/\//i.test(val.trim())) {
          urls.push(val.trim());
        }
      }
      for (const [k, v] of Object.entries(record)) {
        if (["attach", "params", "propertyExt", "content", "data"].includes(k) || Array.isArray(v)) {
          walk(v);
        }
      }
    }
  }

  for (const s of sources) {
    walk(s);
  }
  return [...new Set(urls)];
}

/** URL media tạm do Zalo trả về; Telegram có thể dùng URL này để tải ảnh/video. */
export function extractMediaUrl(payload: any): string | null {
  if (extractMediaSummary(payload) === null) return null;
  const data = payload?.data ?? {};
  const content = parseObjectMaybe(data?.content);
  const params = parseObjectMaybe(content?.params || data?.params);
  const attach = parseObjectMaybe(data?.attach || content?.attach);
  const propertyExt = parseObjectMaybe(data?.propertyExt || content?.propertyExt);

  const urls = collectCandidateUrls([content, params, attach, propertyExt, data, payload]);
  return urls.length > 0 && urls[0] ? urls[0] : null;
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
  msgId?: string;
  cliMsgId?: string;
  globalMsgId?: string;
  fileAttachment?: FileAttachment;
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

  const msgId = String(quote.msgId || quote.messageId || quote.id || "").trim();
  const cliMsgId = String(quote.cliMsgId || "").trim();
  const globalMsgId = String(quote.globalMsgId || "").trim();

  let mediaUrl: string | undefined;
  let mediaType: "image" | "video" | undefined;

  const urls = collectCandidateUrls([
    quote,
    quote.attach,
    quote.params,
    quote.propertyExt,
    quote.content,
  ]);

  if (urls.length > 0) {
    mediaUrl = urls[0];
  }

  const rawType = String(quote.msgType || quote.type || "").toLowerCase();
  const isPhotoOrImage =
    rawType.includes("photo") ||
    rawType.includes("image") ||
    text.includes("[Hình ảnh]") ||
    text.includes("[Ảnh]") ||
    Boolean(mediaUrl && /\.(?:jpg|jpeg|png|webp|gif|bmp)(?:\?|$)/i.test(mediaUrl));

  const isVideo =
    rawType.includes("video") ||
    text.includes("[Video]") ||
    Boolean(mediaUrl && /\.(?:mp4|mov|avi|mkv|webm)(?:\?|$)/i.test(mediaUrl));

  const isDocOrFile =
    rawType.includes("file") ||
    text.startsWith("[File]") ||
    Boolean(mediaUrl && /\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar)(?:\?|$)/i.test(mediaUrl));

  if (isVideo) {
    mediaType = "video";
  } else if (!isDocOrFile && (isPhotoOrImage || (mediaUrl && !/\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar)(?:\?|$)/i.test(mediaUrl)))) {
    mediaType = "image";
  }

  // Trích xuất file đính kèm nếu quote là file tài liệu (PDF, Word, Excel, ZIP, etc.)
  let fileAttachment: FileAttachment | undefined;
  let quoteFileName = String(
    quote.title ||
    quote.fileName ||
    quote.name ||
    quote.attach?.title ||
    quote.attach?.name ||
    quote.params?.title ||
    quote.params?.fileName ||
    ""
  ).trim();

  if (!quoteFileName) {
    const candidate = text || String(quote.msg || quote.text || "");
    const fileMatch = candidate.match(/^(?:\[File\]|File\s*[·:\-–—]?)\s*(.+)$/i);
    if (fileMatch && fileMatch[1]) {
      quoteFileName = fileMatch[1].trim();
    }
  }

  const isFilePayload =
    rawType.includes("file") ||
    /^(?:\[File\]|File\s*[·:\-–—]?)/i.test(text) ||
    Boolean(quoteFileName && /\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar)(?:\?|$)/i.test(quoteFileName));

  if (isFilePayload && mediaUrl) {
    const ext = (quoteFileName.split(".").pop() || "").toLowerCase();
    fileAttachment = {
      name: quoteFileName || "Tài liệu",
      url: mediaUrl,
      size: Number(quote.fileSize || quote.size || quote.attach?.fileSize || quote.params?.fileSize) || undefined,
      extension: ext || undefined,
    };
  }

  if (!text && !mediaUrl && !msgId && !cliMsgId && !fileAttachment) return null;

  return {
    text,
    senderName: senderName || undefined,
    senderId: senderId || undefined,
    mediaUrl,
    mediaType,
    msgId: msgId || undefined,
    cliMsgId: cliMsgId || undefined,
    globalMsgId: globalMsgId || undefined,
    fileAttachment,
  };
}

export interface FileAttachment {
  name: string;
  url: string;
  size?: number;
  extension?: string;
}

/**
 * Trích xuất file đính kèm (PDF, Word, Excel, TXT, Code, Audio...) từ payload Zalo.
 * Hỗ trợ cả file gửi trực tiếp và file trong tin nhắn được trích dẫn (quote/reply).
 */
export function extractFileAttachment(payload: any): FileAttachment | null {
  const data = payload?.data ?? {};
  const msgType = String(data?.msgType ?? "").toLowerCase();

  // BỎ QUA NẾU LÀ ẢNH HOẶC VIDEO THUẦN TÚY ĐỂ TRÁNH NHẬN DIỆN NHẦM ẢNH THÀNH FILE TÀI LIỆU
  if (msgType.includes("photo") || msgType.includes("image") || msgType.includes("video")) {
    return null;
  }

  const content = parseObjectMaybe(data?.content);
  const params = parseObjectMaybe(content?.params);
  const attach = parseObjectMaybe(data?.attach || content?.attach);

  // 1. Tìm file gửi trực tiếp trong tin nhắn
  const urls = collectCandidateUrls([content, params, attach, data]);
  const url = urls.length > 0 ? urls[0] : undefined;

  let name = String(
    content?.title ||
    content?.fileName ||
    content?.name ||
    params?.title ||
    params?.fileName ||
    attach?.title ||
    attach?.name ||
    ""
  ).trim();

  if (url) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    return {
      name: name || "Tài liệu",
      url,
      size: Number(content?.fileSize || params?.fileSize || attach?.fileSize) || undefined,
      extension: ext || undefined,
    };
  }

  // 2. Fallback: Nếu tin nhắn hiện tại là Reply / Quote đến một File tài liệu
  let quoteObj = data?.quote || payload?.quote;
  if (!quoteObj && content?.quote) quoteObj = content.quote;
  if (quoteObj) {
    const quote = (parseObjectMaybe(quoteObj) || (typeof quoteObj === "object" ? quoteObj : null)) as Record<string, any> | null;
    if (quote) {
      const quoteUrls = collectCandidateUrls([quote, quote.attach, quote.params, quote.propertyExt, quote.content]);
      const quoteUrl = quoteUrls.length > 0 ? quoteUrls[0] : undefined;
      let quoteFileName = String(
        quote.title ||
        quote.fileName ||
        quote.name ||
        quote.attach?.title ||
        quote.attach?.name ||
        quote.params?.title ||
        quote.params?.fileName ||
        ""
      ).trim();

      if (!quoteFileName) {
        const quoteMsg = String(quote.msg || quote.text || "").trim();
        const fileMatch = quoteMsg.match(/^(?:\[File\]|File\s*[·:\-–—]?)\s*(.+)$/i);
        if (fileMatch && fileMatch[1]) {
          quoteFileName = fileMatch[1].trim();
        }
      }

      if (quoteUrl) {
        const ext = (quoteFileName.split(".").pop() || "").toLowerCase();
        return {
          name: quoteFileName || "Tài liệu",
          url: quoteUrl,
          size: Number(quote.fileSize || quote.size || quote.attach?.fileSize || quote.params?.fileSize) || undefined,
          extension: ext || undefined,
        };
      }
    }
  }

  return null;
}


import { TextStyle, Reactions } from "zca-js";

/**
 * Bảng màu Zalo hỗ trợ.
 */
const COLORS: Record<string, string> = {
  red: (TextStyle as any).Red || "c_db342e",
  green: (TextStyle as any).Green || "c_15a85f",
  orange: (TextStyle as any).Orange || "c_f27806",
  yellow: (TextStyle as any).Yellow || "c_f7b503",
};

const BOLD = (TextStyle as any).Bold || "b";
const BIG = (TextStyle as any).Big || "f_18";
const ITALIC = (TextStyle as any).Italic || "i";
const STRIKE = (TextStyle as any).StrikeThrough || "s";

const ALIASES: [RegExp, string][] = [
  [/\[do\]/gi, "[red]"], [/\[\/do\]/gi, "[/red]"],
  [/\[xanh\]/gi, "[green]"], [/\[\/xanh\]/gi, "[/green]"],
  [/\[cam\]/gi, "[orange]"], [/\[\/cam\]/gi, "[/orange]"],
  [/\[vang\]/gi, "[yellow]"], [/\[\/vang\]/gi, "[/yellow]"],
];

export interface ZaloStyleItem {
  start: number;
  len: number;
  st: string;
}

export interface FormattedZaloMessage {
  msg: string;
  styles: ZaloStyleItem[];
}

const MAX_STYLES = 40;
const MAX_CHARS = 2000;

function isWordBoundary(line: string, i: number): boolean {
  if (i === 0) return true;
  return /[\s(["'—–-]/.test(line[i - 1]!);
}

function matchColorTag(rest: string): { name: string; inner: string; consumed: number } | null {
  for (const name of Object.keys(COLORS)) {
    const open = `[${name}]`;
    if (rest.slice(0, open.length).toLowerCase() !== open) continue;
    const closeIdx = rest.toLowerCase().indexOf(`[/${name}]`, open.length);
    if (closeIdx === -1) continue;
    return {
      name,
      inner: rest.slice(open.length, closeIdx),
      consumed: closeIdx + name.length + 3,
    };
  }
  return null;
}

function renderInline(line: string, base: number): { text: string; styles: ZaloStyleItem[] } {
  const styles: ZaloStyleItem[] = [];
  let out = "";
  let i = 0;

  const push = (start: number, len: number, st: string) => {
    if (len > 0) styles.push({ start: base + start, len, st });
  };

  while (i < line.length) {
    const rest = line.slice(i);

    // [color]…[/color]
    const color = matchColorTag(rest);
    if (color) {
      const inner = renderInline(color.inner, base + out.length);
      const start = out.length;
      out += inner.text;
      styles.push(...inner.styles);
      push(start, inner.text.length, COLORS[color.name]!);
      i += color.consumed;
      continue;
    }

    // [chữ](liên kết)
    const link = rest.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
    if (link) {
      const label = link[1]!;
      const url = link[2]!;
      const start = out.length;
      out += label;
      push(start, label.length, BOLD);
      out += ` (${url})`;
      i += link[0].length;
      continue;
    }

    // ~~gạch ngang~~
    const strike = rest.match(/^~~([\s\S]+?)~~/);
    if (strike) {
      const inner = renderInline(strike[1]!, base + out.length);
      const start = out.length;
      out += inner.text;
      styles.push(...inner.styles);
      push(start, inner.text.length, STRIKE);
      i += strike[0].length;
      continue;
    }

    // **đậm** hoặc __đậm__
    const bold = rest.match(/^(\*\*|__)([\s\S]+?)\1/);
    if (bold) {
      const inner = renderInline(bold[2]!, base + out.length);
      const start = out.length;
      out += inner.text;
      styles.push(...inner.styles);
      push(start, inner.text.length, BOLD);
      i += bold[0].length;
      continue;
    }

    // `mã` → in đậm cho nổi
    const code = rest.match(/^`([^`\n]+)`/);
    if (code) {
      const start = out.length;
      out += code[1]!;
      push(start, code[1]!.length, BOLD);
      i += code[0].length;
      continue;
    }

    // *nghiêng* hoặc _nghiêng_
    const italic = rest.match(/^([*_])([^\s*_][^*_\n]*?)\1/);
    if (italic && isWordBoundary(line, i)) {
      const start = out.length;
      out += italic[2]!;
      push(start, italic[2]!.length, ITALIC);
      i += italic[0].length;
      continue;
    }

    out += line[i]!;
    i += 1;
  }

  return { text: out, styles };
}

/**
 * Chuyển Markdown sang định dạng chữ gốc của Zalo (msg + styles array).
 */
export function formatZaloMarkdown(input: string): FormattedZaloMessage {
  if (!input) return { msg: "", styles: [] };

  let raw = String(input);
  for (const [pattern, replacement] of ALIASES) {
    raw = raw.replace(pattern, replacement);
  }

  const styles: ZaloStyleItem[] = [];
  const outLines: string[] = [];
  let offset = 0;

  const lines = raw.split(/\r?\n/);
  let inCodeBlock = false;
  let prevBlank = false;

  for (let line of lines) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      outLines.push(line);
      offset += line.length + 1;
      prevBlank = false;
      continue;
    }

    // Bỏ đường kẻ ngang ---
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      continue;
    }

    // Gộp dòng trống liên tiếp
    const isBlank = line.trim() === "";
    if (isBlank && prevBlank) continue;
    prevBlank = isBlank;

    let lineStyles: ZaloStyleItem[] = [];
    const wholeLineStyles: string[] = [];

    // Tiêu đề: In Đậm + Phóng to dòng tiêu đề
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      line = heading[2]!;
      wholeLineStyles.push(BOLD, BIG);
    }

    // Trích dẫn: > … → nghiêng cả dòng
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (!heading && quote) {
      line = quote[1]!;
      wholeLineStyles.push(ITALIC);
    }

    // Phân cấp danh sách đầu dòng:
    // - Cấp 1: gạch đầu dòng '- '
    // - Cấp 2 trở đi: chấm tròn '• '
    line = line.replace(/^(\s*)([-*•])\s+/, (_match, indent) => {
      return indent.length >= 2 ? `${indent}• ` : `${indent}- `;
    });

    // Đầu chỉ mục số thứ tự ('1. ', '2. '): In Đậm phần số thứ tự
    let listNumStart = 0;
    let listNumLen = 0;
    if (!heading) {
      const numMatch = line.match(/^(\s*)(\d+[\.)]\s+)/);
      if (numMatch) {
        listNumStart = numMatch[1]!.length;
        listNumLen = numMatch[2]!.length;
      }
    }

    const { text, styles: inline } = renderInline(line, offset);
    lineStyles = inline;

    if (wholeLineStyles.length && text.length) {
      for (const st of wholeLineStyles) {
        lineStyles.push({ start: offset, len: text.length, st });
      }
    }

    if (listNumLen > 0) {
      lineStyles.push({ start: offset + listNumStart, len: listNumLen, st: BOLD });
      lineStyles.push({ start: offset + listNumStart, len: listNumLen, st: BIG });
    }

    styles.push(...lineStyles);
    outLines.push(text);
    offset += text.length + 1;
  }

  return { msg: outLines.join("\n"), styles };
}

function preferReadableBoundary(msg: string, start: number, end: number): number {
  if (end >= msg.length) return msg.length;
  const window = msg.slice(start, end);
  for (const marker of ["\n\n", "\n", ". ", "; ", ", ", " "]) {
    const idx = window.lastIndexOf(marker);
    if (idx > 0 && idx >= window.length * 0.6) {
      return start + idx + marker.length;
    }
  }
  return end;
}

function styleCountInRange(styles: ZaloStyleItem[], start: number, end: number): number {
  return styles.filter((style) => style.start < end && style.start + style.len > start).length;
}

function lastStyleBoundaryBefore(styles: ZaloStyleItem[], start: number, end: number): number | null {
  const boundaries = styles
    .flatMap((style) => [style.start, style.start + style.len])
    .filter((pos) => pos > start && pos < end)
    .sort((a, b) => b - a);
  return boundaries.find((pos) => styleCountInRange(styles, start, pos) <= MAX_STYLES) || null;
}

function findChunkEnd(formatted: FormattedZaloMessage, start: number): number {
  let end = Math.min(start + MAX_CHARS, formatted.msg.length);
  end = preferReadableBoundary(formatted.msg, start, end);

  while (styleCountInRange(formatted.styles, start, end) > MAX_STYLES && end > start + 1) {
    end = lastStyleBoundaryBefore(formatted.styles, start, end) || Math.floor((start + end) / 2);
    end = Math.max(start + 1, Math.min(end, start + MAX_CHARS));
  }

  return end;
}

function sliceFormattedMessage(formatted: FormattedZaloMessage, start: number, end: number): FormattedZaloMessage {
  const styles: ZaloStyleItem[] = [];
  for (const style of formatted.styles) {
    const styleStart = style.start;
    const styleEnd = style.start + style.len;
    if (styleStart >= end || styleEnd <= start) continue;

    const clippedStart = Math.max(styleStart, start);
    const clippedEnd = Math.min(styleEnd, end);
    styles.push({
      start: clippedStart - start,
      len: clippedEnd - clippedStart,
      st: style.st,
    });
  }

  return { msg: formatted.msg.slice(start, end), styles };
}

/**
 * Tự động chia Markdown thành các tin nhắn Zalo độc lập có kèm styles đầy đủ.
 */
export function formatAndChunkZaloMarkdown(input: string): FormattedZaloMessage[] {
  if (!input) return [];

  const formatted = formatZaloMarkdown(String(input).trim());
  if (!formatted.msg.trim()) return [];

  const exceedsBudget = formatted.msg.length > MAX_CHARS || formatted.styles.length > MAX_STYLES;
  if (!exceedsBudget) return [formatted];

  const chunks: FormattedZaloMessage[] = [];
  let start = 0;

  while (start < formatted.msg.length) {
    const end = findChunkEnd(formatted, start);
    chunks.push(sliceFormattedMessage(formatted, start, end));
    start = end;
  }

  return chunks.filter((chunk) => chunk.msg.trim());
}

/**
 * Phân tích cảm xúc & ngữ cảnh câu nói để chọn Reaction Zalo phù hợp nhất:
 * - Vui vẻ/hài hước: HAHA, TEARS_OF_JOY, BIG_SMILE
 * - Cảm ơn/kính cẩn: PRAY, THANKS, ROSE, PEACE
 * - Khen ngợi/đỉnh/ngầu: COOL, HANDCLAP, SUNGLASSES, WOW
 * - Ngạc nhiên: WOW
 * - Thắc mắc/hỏi bài/tại sao/nghiên cứu: CONFUSED (🤔), NERD (🤓), OK
 * - Buồn bã/tiếc nuối: CRY, SAD, BROKEN_HEART
 * - Chúc mừng: BIRTHDAY, ROSE, LOVE
 * - Quyết tâm/lệnh/đồng ý/ok/triển: OK (👌), PUNCH (👊), SUN
 * - Chào hỏi: PEACE, WINK, BIG_SMILE
 */
export function pickSmartReaction(content: string): Reactions | string {
  if (!content) return Reactions.OK || 23;
  const text = content.toLowerCase();

  // 1. Hài hước / Cười đùa / Vui vẻ
  if (
    text.includes("haha") || text.includes("hihi") || text.includes("hehe") ||
    text.includes("lol") || text.includes("kiki") || text.includes("vui") ||
    text.includes("hài") || text.includes("buồn cười")
  ) {
    const list = [Reactions.HAHA, Reactions.TEARS_OF_JOY, Reactions.BIG_SMILE];
    return list[Math.floor(Math.random() * list.length)]!;
  }

  // 2. Cảm ơn / Biết ơn / Cầu chúc
  if (
    text.includes("cảm ơn") || text.includes("cam on") || text.includes("tks") ||
    text.includes("thanks") || text.includes("cám ơn") || text.includes("biết ơn") || text.includes("giúp")
  ) {
    const list = [Reactions.PRAY, Reactions.THANKS, Reactions.ROSE, Reactions.PEACE];
    return list[Math.floor(Math.random() * list.length)]!;
  }

  // 3. Khen ngợi / Đỉnh / Ngầu / Tuyệt vời / Vỗ tay
  if (
    text.includes("đỉnh") || text.includes("quá đỉnh") || text.includes("xịn") ||
    text.includes("pro") || text.includes("giỏi") || text.includes("tuyệt") ||
    text.includes("vip") || text.includes("hay")
  ) {
    const list = [Reactions.COOL, Reactions.HANDCLAP, Reactions.SUNGLASSES, Reactions.WOW];
    return list[Math.floor(Math.random() * list.length)]!;
  }

  // 4. Ngạc nhiên / Bất ngờ / Kỳ diệu
  if (
    text.includes("thật á") || text.includes("ghê thật") || text.includes("ghê quá") ||
    text.includes("uầy") || text.includes("oa") || text.includes("wow") || text.includes("bất ngờ") || text.includes("ảo")
  ) {
    return Reactions.WOW;
  }

  // 5. Thắc mắc / Hỏi đáp / Nghiên cứu / Soi xét / Tại sao
  if (
    text.includes("sao lại") || text.includes("tại sao") || text.includes("nghĩa là gì") ||
    text.includes("như thế nào") || text.includes("thế nào") || text.includes("check") ||
    text.includes("kiểm tra") || text.includes("đối soát") || text.includes("chính xác") ||
    text.includes("đúng không") || text.includes("?")
  ) {
    const list = [Reactions.CONFUSED, Reactions.NERD, Reactions.OK];
    return list[Math.floor(Math.random() * list.length)]!;
  }

  // 6. Buồn / Tiếc nuối / Thất vọng / Mệt mỏi
  if (
    text.includes("buồn") || text.includes("tiếc") || text.includes("huhu") || text.includes("toang") ||
    text.includes("chán") || text.includes("mệt") || text.includes("khóc") ||
    text.includes("khó quá") || text.includes("fail")
  ) {
    const list = [Reactions.CRY, Reactions.SAD, Reactions.BROKEN_HEART];
    return list[Math.floor(Math.random() * list.length)]!;
  }

  // 7. Chúc mừng sinh nhật / Sự kiện
  if (
    text.includes("sinh nhật") || text.includes("chúc mừng") || text.includes("năm mới") ||
    text.includes("tết") || text.includes("kỷ niệm")
  ) {
    const list = [Reactions.BIRTHDAY, Reactions.ROSE, Reactions.LOVE];
    return list[Math.floor(Math.random() * list.length)]!;
  }

  // 8. Quyết tâm / Đồng ý / Giao việc / Ok / Lệnh / Triển
  if (
    text.includes("ok") || text.includes("nhất trí") || text.includes("triển") ||
    text.includes("làm đi") || text.includes("lệnh") || text.includes("giúp anh") ||
    text.includes("soạn") || text.includes("tìm") || text.includes("xem")
  ) {
    const list = [Reactions.OK, Reactions.PUNCH, Reactions.SUN];
    return list[Math.floor(Math.random() * list.length)]!;
  }

  // 9. Chào hỏi ban đầu
  if (
    text.includes("chào") || text.includes("hello") || text.includes("hi") || text.includes("alo")
  ) {
    const list = [Reactions.PEACE, Reactions.WINK, Reactions.BIG_SMILE, Reactions.SUN];
    return list[Math.floor(Math.random() * list.length)]!;
  }

  // Mặc định đa sắc thái nhẹ nhàng
  const defaultList = [Reactions.OK, Reactions.PEACE, Reactions.BIG_SMILE, Reactions.WINK, Reactions.SUN];
  return defaultList[Math.floor(Math.random() * defaultList.length)]!;
}

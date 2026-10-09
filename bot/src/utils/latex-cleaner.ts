/**
 * Bộ làm sạch và chuyển đổi công thức Toán - Lý - Hóa từ LaTeX sang Unicode thuần
 * Đảm bảo hiển thị hoàn hảo trên các nền tảng tin nhắn không hỗ trợ render LaTeX (như Zalo).
 */

const GREEK_MAP: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  Gamma: "Γ",
  delta: "δ",
  Delta: "Δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  Theta: "Θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  Lambda: "Λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  Xi: "Ξ",
  pi: "π",
  Pi: "Π",
  rho: "ρ",
  sigma: "σ",
  Sigma: "Σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  Phi: "Φ",
  chi: "χ",
  psi: "ψ",
  Psi: "Ψ",
  omega: "ω",
  Omega: "Ω",
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
  x: "ˣ",
};

const SUBSCRIPT_MAP: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
};

function toSuperscript(str: string): string {
  return str
    .split("")
    .map((c) => SUPERSCRIPT_MAP[c] || c)
    .join("");
}

function toSubscript(str: string): string {
  return str
    .split("")
    .map((c) => SUBSCRIPT_MAP[c] || c)
    .join("");
}

/**
 * Chuyển đổi một đoạn biểu thức toán học LaTeX thành văn bản Unicode thuần.
 */
export function convertMathExpressionToUnicode(math: string): string {
  if (!math) return "";
  let res = math.trim();

  // 1. Vector: \vec{x} -> vectơ x, \overrightarrow{AB} -> vectơ AB
  res = res.replace(/\\(?:vec|overrightarrow)\{([^}]+)\}/g, "vectơ $1");

  // 2. \text{...}, \mathrm{...}, \mathbf{...}, \mathit{...}
  res = res.replace(/\\(?:text|mathrm|mathbf|mathit|textbf)\{([^}]+)\}/g, "$1");

  // 3. Phân số: \frac{a}{b}, \dfrac{a}{b}
  // Lặp để xử lý phân số lồng nhau
  let maxIter = 5;
  while ((res.includes("\\frac") || res.includes("\\dfrac")) && maxIter-- > 0) {
    res = res.replace(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, num, den) => {
      const cleanNum = num.trim();
      const cleanDen = den.trim();
      const numWrap = /[\s+\-*/=]/.test(cleanNum) ? `(${cleanNum})` : cleanNum;
      const denWrap = /[\s+\-*/=]/.test(cleanDen) ? `(${cleanDen})` : cleanDen;
      return `${numWrap}/${denWrap}`;
    });
  }

  // 4. Căn thức: \sqrt[n]{x} -> ⁿ√x, \sqrt{x} -> √x
  res = res.replace(/\\sqrt\[([^\]]+)\]\{([^}]+)\}/g, (_, n, inner) => `${toSuperscript(n)}√(${inner})`);
  res = res.replace(/\\sqrt\{([^}]+)\}/g, (_, inner) => {
    return inner.length === 1 ? `√${inner}` : `√(${inner})`;
  });

  // 5. Mũ / Luỹ thừa: ^{...} hoặc ^x
  res = res.replace(/\^\{([^}]+)\}/g, (_, exp) => toSuperscript(exp));
  res = res.replace(/\^([0-9+\-nix])/g, (_, exp) => toSuperscript(exp));
  res = res.replace(/\^\\circ/g, "°");

  // 6. Chỉ số dưới: _{...} hoặc _x
  // Đặc biệt: các từ viết tắt tiếng Việt/Vật lý phổ biến (giữ nguyên gạch dưới rõ nghĩa)
  res = res.replace(/_\{(?:text\{)?(max|min|mst|msn|ms|tb|cd|đ|tt|dh|cb)\b\}?/gi, "_$1");
  res = res.replace(/_\{([0-9+\-]+)\}/g, (_, sub) => toSubscript(sub));
  res = res.replace(/_\{([^}]+)\}/g, (_, sub) => `_${sub}`);
  res = res.replace(/_([0-9])/g, (_, sub) => toSubscript(sub));

  // 7. Ký tự Hy Lạp
  res = res.replace(/\\([a-zA-Z]+)/g, (match, name) => {
    if (GREEK_MAP[name]) {
      return GREEK_MAP[name];
    }
    return match;
  });

  // 8. Toán tử & Quan hệ logic
  res = res.replace(/\\cdot/g, " · ");
  res = res.replace(/\\times/g, " × ");
  res = res.replace(/\\div/g, " ÷ ");
  res = res.replace(/\\pm/g, "±");
  res = res.replace(/\\mp/g, "∓");
  res = res.replace(/\\(?:le|leq)\b/g, "≤");
  res = res.replace(/\\(?:ge|geq)\b/g, "≥");
  res = res.replace(/\\(?:ne|neq)\b/g, "≠");
  res = res.replace(/\\approx/g, "≈");
  res = res.replace(/\\sim/g, "∼");
  res = res.replace(/\\equiv/g, "≡");
  res = res.replace(/\\propto/g, "∝");
  res = res.replace(/\\infty/g, "∞");
  res = res.replace(/\\degree/g, "°");
  res = res.replace(/\\(?:to|rightarrow)\b/g, "→");
  res = res.replace(/\\Rightarrow\b/g, "⇒");
  res = res.replace(/\\Leftrightarrow\b/g, "⇔");
  res = res.replace(/\\leftarrow\b/g, "←");
  res = res.replace(/\\Leftarrow\b/g, "⇐");
  res = res.replace(/\\parallel\b/g, "∥");
  res = res.replace(/\\perp\b/g, "⊥");
  res = res.replace(/\\angle\b/g, "∠");
  res = res.replace(/\\in\b/g, "∈");
  res = res.replace(/\\notin\b/g, "∉");
  res = res.replace(/\\subset\b/g, "⊂");
  res = res.replace(/\\cup\b/g, "∪");
  res = res.replace(/\\cap\b/g, "∩");
  res = res.replace(/\\forall\b/g, "∀");
  res = res.replace(/\\exists\b/g, "∃");
  res = res.replace(/\\int\b/g, "∫");
  res = res.replace(/\\sum\b/g, "∑");

  // 9. Khoảng trắng LaTeX: \, \: \; \! \quad \qquad
  res = res.replace(/\\(?:quad|qquad)/g, "  ");
  res = res.replace(/\\(?:[,;:!])/g, " ");

  // 10. Dấu ngoặc mở rộng: \left( \right) \left[ \right]
  res = res.replace(/\\(?:left|right)\s*([()[\]{}|])/g, "$1");

  // 11. Các hàm toán học cơ bản: \sin, \cos, \tan, \cot, \ln, \log, \lim
  res = res.replace(/\\(sin|cos|tan|cot|ln|log|lim|max|min)\b/g, "$1");

  // 12. Làm sạch khoảng trắng thừa
  res = res.replace(/\s{2,}/g, " ").trim();

  return res;
}

/**
 * Quét toàn bộ văn bản và thay thế các khối công thức LaTeX ($...$ hoặc $$...$$) thành Unicode sạch.
 */
export function cleanLatexMathToUnicode(text: string): string {
  if (!text) return "";
  let res = text;

  // 1. Khối công thức hiển thị riêng biệt: $$ ... $$
  res = res.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    return convertMathExpressionToUnicode(math);
  });

  // 2. Công thức inline: $math$ (không cho phép khoảng trắng ngay sau $ mở hoặc ngay trước $ đóng)
  res = res.replace(/(^|[^\\])\$([^\s$](?:[^\n$]*?[^\s$])?)\$/g, (match, prefix, math) => {
    // Nếu chỉ là số tiền (ví dụ $100 hay $1,000) thì giữ nguyên tiền tệ
    if (/^\d+(?:[.,]\d+)?(?:\s*(?:USD|VND|k|tr|đ))?$/i.test(math.trim())) {
      return match;
    }
    return `${prefix}${convertMathExpressionToUnicode(math)}`;
  });

  // 3. Một số cú pháp LaTeX sót lại ngoài dấu $ (ví dụ LLM viết thô \alpha, \vec{B}, \Delta không có dấu $)
  res = res.replace(/\\(?:vec|overrightarrow)\{([^}]+)\}/g, "vectơ $1");
  res = res.replace(/\\([a-zA-Z]+)/g, (match, name) => {
    if (GREEK_MAP[name]) return GREEK_MAP[name];
    if (name === "cdot") return " · ";
    if (name === "times") return " × ";
    if (name === "approx") return " ≈ ";
    if (name === "Rightarrow") return " ⇒ ";
    if (name === "Leftrightarrow") return " ⇔ ";
    if (name === "degree") return "°";
    return match;
  });

  return res;
}


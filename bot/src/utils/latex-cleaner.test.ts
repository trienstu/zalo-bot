import test from "node:test";
import assert from "node:assert/strict";
import { cleanLatexMathToUnicode } from "./latex-cleaner.js";

test("cleanLatexMathToUnicode: Xử lý công thức từ trường của cô Pham Thi Hoai Thu", () => {
  const input = "Độ lớn lực từ: $F = \\frac{I \\cdot B \\cdot L}{\\sin\\alpha}$, với cảm ứng từ $\\vec{B}$. Chiều dài $0,2\\text{ m}$.";
  const output = cleanLatexMathToUnicode(input);

  assert.ok(!output.includes("\\frac"), "Không được còn \\frac");
  assert.ok(!output.includes("\\vec"), "Không được còn \\vec");
  assert.ok(!output.includes("\\alpha"), "Không được còn \\alpha");
  assert.ok(!output.includes("$"), "Không được còn ký hiệu $");
  assert.ok(output.includes("α"), "Phải có ký tự α");
  assert.ok(output.includes("vectơ B"), "Phải có vectơ B");
  assert.ok(output.includes("0,2 m"), "Phải giữ số đo 0,2 m");
});

test("cleanLatexMathToUnicode: Xử lý công thức nhiều bước của cô Hoài Thu", () => {
  const input = "$$F = P \\Leftrightarrow B \\cdot I \\cdot L = m \\cdot g$$\n$$\\Rightarrow I = \\frac{m \\cdot g}{B \\cdot L} = \\frac{0,01 \\times 10}{0,2 \\times 0,1} = 5\\text{ A}$$";
  const output = cleanLatexMathToUnicode(input);

  assert.ok(!output.includes("$$"), "Không được còn $$");
  assert.ok(!output.includes("\\Leftrightarrow"), "Không được còn \\Leftrightarrow");
  assert.ok(!output.includes("\\Rightarrow"), "Không được còn \\Rightarrow");
  assert.ok(!output.includes("\\frac"), "Không được còn \\frac");
  assert.ok(output.includes("⇔"), "Phải có dấu ⇔");
  assert.ok(output.includes("⇒"), "Phải có dấu ⇒");
  assert.ok(output.includes("5 A"), "Phải có 5 A");
});

test("cleanLatexMathToUnicode: Xử lý căn thức và dao động của cô Minh Thu", () => {
  const input = "Tần số góc: $\\omega = \\sqrt{\\dfrac{k}{M + m}} = \\sqrt{\\dfrac{100}{0,4}} = 5\\sqrt{10} \\approx 15,81\\text{ rad/s}$. Phương trình: $x = 10\\cos\\left(20t - \\dfrac{\\pi}{2}\\right)\\text{ (cm)}$.";
  const output = cleanLatexMathToUnicode(input);

  assert.ok(!output.includes("\\omega"), "Không được còn \\omega");
  assert.ok(!output.includes("\\sqrt"), "Không được còn \\sqrt");
  assert.ok(!output.includes("\\dfrac"), "Không được còn \\dfrac");
  assert.ok(!output.includes("\\pi"), "Không được còn \\pi");
  assert.ok(!output.includes("\\approx"), "Không được còn \\approx");
  assert.ok(output.includes("ω"), "Phải có ký tự ω");
  assert.ok(output.includes("√"), "Phải có ký tự √");
  assert.ok(output.includes("π"), "Phải có ký tự π");
  assert.ok(output.includes("≈"), "Phải có ký tự ≈");
});

test("cleanLatexMathToUnicode: Xử lý động học và gia tốc của thầy Văn Giàu", () => {
  const input = "Vận tốc: $v_{tb} = \\frac{s}{t}$, liên hệ: $v^2 - v_0^2 = 2ad$, gia tốc $a = 1\\text{ m/s}^2$, vectơ $\\vec{a}$ và $\\vec{v}$.";
  const output = cleanLatexMathToUnicode(input);

  assert.ok(!output.includes("\\vec"), "Không được còn \\vec");
  assert.ok(!output.includes("\\frac"), "Không được còn \\frac");
  assert.ok(!output.includes("$"), "Không được còn $");
  assert.ok(output.includes("v_tb"), "Phải có v_tb");
  assert.ok(output.includes("v² - v₀² = 2ad"), "Phải có số mũ ² và số dưới ₀");
  assert.ok(output.includes("1 m/s²"), "Phải có 1 m/s²");
  assert.ok(output.includes("vectơ a"), "Phải có vectơ a");
  assert.ok(output.includes("vectơ v"), "Phải có vectơ v");
});

test("cleanLatexMathToUnicode: Giữ nguyên giá tiền USD bình thường", () => {
  const input = "Sản phẩm này có giá $100 hoặc $25.50 tại Mỹ.";
  const output = cleanLatexMathToUnicode(input);
  assert.equal(output, input);
});

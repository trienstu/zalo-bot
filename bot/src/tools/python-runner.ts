import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GENERATED_FILES_DIR = path.resolve(process.cwd(), "data", "generated-files");

export interface PythonRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  generatedImages: string[];
  generatedFiles: string[];
  executionTimeMs: number;
  error?: string;
}

function resolveFontPaths(): { regular: string; bold: string } {
  const candidates = [
    path.resolve(process.cwd(), "bot", "assets", "fonts", "Arial.ttf"),
    path.resolve(process.cwd(), "assets", "fonts", "Arial.ttf"),
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
  ];
  const boldCandidates = [
    path.resolve(process.cwd(), "bot", "assets", "fonts", "Arial-Bold.ttf"),
    path.resolve(process.cwd(), "assets", "fonts", "Arial-Bold.ttf"),
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
  ];
  const regular = candidates.find((p) => fs.existsSync(p)) || "";
  const bold = boldCandidates.find((p) => fs.existsSync(p)) || regular;
  return { regular, bold };
}

/**
 * Kiểm tra tính an toàn của mã nguồn Python (AST / Static Safety Guard).
 * Chặn các module can thiệp hệ thống, shell command, socket mạng và truy cập file nhạy cảm.
 */
export function validatePythonCodeSafety(code: string): { safe: boolean; reason?: string } {
  if (!code || typeof code !== "string") {
    return { safe: false, reason: "Mã nguồn rỗng hoặc không hợp lệ" };
  }

  // 1. Chặn các lệnh thực thi shell, gọi subprocess, thao tác tiến trình nguy hiểm
  const dangerousExecutionPatterns = [
    { pattern: /\b(?:os\.(?:system|popen\w*|spawn\w*|kill|remove|unlink|rmdir))\b/i, label: "Lệnh can thiệp hệ thống os.*" },
    { pattern: /\b(?:subprocess|commands|pty|ptyprocess)\b/i, label: "Module gọi tiến trình con (subprocess/commands)" },
    { pattern: /\b(?:shutil\.(?:rmtree|move|copytree))\b/i, label: "Lệnh xóa/di chuyển thư mục hàng loạt (shutil)" },
    { pattern: /\b(?:socket|ftplib|telnetlib|webbrowser)\b/i, label: "Mở kết nối mạng raw socket/webbrowser" },
    { pattern: /\b(?:eval|exec|__import__|compile)\s*\(/i, label: "Hàm dynamic evaluation (eval/exec/__import__)" },
    { pattern: /__subclasses__|__bases__|__mro__/i, label: "Sandbox escape qua reflection (__subclasses__)" },
  ];

  for (const { pattern, label } of dangerousExecutionPatterns) {
    if (pattern.test(code)) {
      return { safe: false, reason: `Phát hiện lệnh nguy hiểm bị cấm: ${label}` };
    }
  }

  // 2. Chặn truy cập tới file nhạy cảm và thư mục hệ thống
  const sensitivePaths = [
    /\.env/i,
    /bot\.db/i,
    /\/etc\/(?:passwd|shadow)/i,
    /\/proc\//i,
    /id_rsa/i,
    /\.\.\//,
  ];

  for (const p of sensitivePaths) {
    if (p.test(code)) {
      return { safe: false, reason: "Cố gắng truy cập file cấu hình hoặc thư mục hệ thống nhạy cảm" };
    }
  }

  return { safe: true };
}

/**
 * Thực thi mã nguồn Python an toàn trên máy chủ Mac mini.
 * Tự động hỗ trợ matplotlib/seaborn (không cần màn hình GUI), tự lưu biểu đồ thành ảnh PNG,
 * và tự động cung cấp font tiếng Việt chuẩn (Unicode) cho Pillow/PIL và Matplotlib.
 */
export async function runPythonCode(code: string, timeoutMs = 25000): Promise<PythonRunResult> {
  const safety = validatePythonCodeSafety(code);
  if (!safety.safe) {
    console.warn(`[python-runner] 🛡️ Chặn mã nguồn không an toàn: ${safety.reason}`);
    return {
      success: false,
      stdout: "",
      stderr: `Bảo mật bị từ chối: ${safety.reason}`,
      generatedImages: [],
      generatedFiles: [],
      executionTimeMs: 0,
      error: `Chặn mã nguồn không an toàn: ${safety.reason}`,
    };
  }

  if (!fs.existsSync(GENERATED_FILES_DIR)) {
    fs.mkdirSync(GENERATED_FILES_DIR, { recursive: true });
  }

  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const scriptPath = path.join(GENERATED_FILES_DIR, `temp_${runId}.py`);
  const defaultChartPath = path.join(GENERATED_FILES_DIR, `chart_${runId}.png`);
  const fonts = resolveFontPaths();

  const preambles = [
    "import os, sys",
    "os.environ['MPLBACKEND'] = 'Agg'",
    `FONT_PATH = r'${fonts.regular}'`,
    `FONT_BOLD_PATH = r'${fonts.bold}'`,
    "",
    "def get_font(size=16, bold=False):",
    "    from PIL import ImageFont",
    "    p = FONT_BOLD_PATH if bold else FONT_PATH",
    "    if p and os.path.exists(p):",
    "        try:",
    "            return ImageFont.truetype(p, size)",
    "        except Exception:",
    "            pass",
    "    try:",
    "        return ImageFont.load_default()",
    "    except Exception:",
    "        return None",
    "",
    "# Tự động vá Pillow để luôn hỗ trợ đầy đủ Unicode tiếng Việt kể cả khi không truyền font hoặc gọi font không tồn tại",
    "try:",
    "    from PIL import ImageDraw, ImageFont",
    "    _orig_draw_text = ImageDraw.ImageDraw.text",
    "    def _safe_draw_text(self, xy, text, *args, **kwargs):",
    "        if 'font' not in kwargs or kwargs['font'] is None:",
    "            kwargs['font'] = get_font(18)",
    "        return _orig_draw_text(self, xy, text, *args, **kwargs)",
    "    ImageDraw.ImageDraw.text = _safe_draw_text",
    "",
    "    _orig_load_default = ImageFont.load_default",
    "    def _safe_load_default(*args, **kwargs):",
    "        if FONT_PATH and os.path.exists(FONT_PATH):",
    "            try:",
    "                return ImageFont.truetype(FONT_PATH, 16)",
    "            except Exception:",
    "                pass",
    "        return _orig_load_default(*args, **kwargs)",
    "    ImageFont.load_default = _safe_load_default",
    "",
    "    _orig_truetype = ImageFont.truetype",
    "    def _safe_truetype(font=None, size=10, index=0, encoding='', layout_engine=None, **kwargs):",
    "        try:",
    "            return _orig_truetype(font, size, index=index, encoding=encoding, layout_engine=layout_engine, **kwargs)",
    "        except Exception:",
    "            is_bold = bool(font and 'bold' in str(font).lower())",
    "            fallback_p = FONT_BOLD_PATH if is_bold else FONT_PATH",
    "            if fallback_p and os.path.exists(fallback_p):",
    "                try:",
    "                    return _orig_truetype(fallback_p, size, index=index, encoding=encoding, layout_engine=layout_engine, **kwargs)",
    "                except Exception:",
    "                    pass",
    "            return ImageFont.load_default()",
    "    ImageFont.truetype = _safe_truetype",
    "except Exception:",
    "    pass",
    "",
    "# Cấu hình font và backend cho Matplotlib",
    "try:",
    "    import matplotlib",
    "    matplotlib.use('Agg')",
    "    import matplotlib.pyplot as plt",
    "    if FONT_PATH and os.path.exists(FONT_PATH):",
    "        import matplotlib.font_manager as fm",
    "        fm.fontManager.addfont(FONT_PATH)",
    "        prop = fm.FontProperties(fname=FONT_PATH)",
    "        plt.rcParams['font.family'] = prop.get_name()",
    "    plt.rcParams['font.sans-serif'] = ['Arial', 'Helvetica', 'DejaVu Sans']",
    "    plt.rcParams['axes.unicode_minus'] = False",
    "except Exception:",
    "    pass",
  ];

  let preparedCode = code;
  if (preparedCode.includes("plt.") && !preparedCode.includes("savefig")) {
    preparedCode = preparedCode.replace(
      /plt\.show\(\)/g,
      `plt.tight_layout()\nplt.savefig(r'${defaultChartPath}', dpi=150, bbox_inches='tight')`,
    );
    if (!preparedCode.includes("savefig")) {
      preparedCode += `\ntry:\n    plt.tight_layout()\n    plt.savefig(r'${defaultChartPath}', dpi=150, bbox_inches='tight')\nexcept Exception:\n    pass\n`;
    }
  }

  // Tự động lưu file ảnh Pillow nếu code tạo Image mà quên gọi .save()
  if (/(?:Image\.new|Image\.open)\(/i.test(preparedCode) && !/\.save\(/i.test(preparedCode)) {
    preparedCode += `\ntry:\n    for _v in ['img', 'image', 'poster', 'card', 'figure']:\n        if _v in locals() and hasattr(locals()[_v], 'save'):\n            locals()[_v].save(r'${defaultChartPath}')\n            break\nexcept Exception:\n    pass\n`;
  }

  const finalScript = preambles.join("\n") + "\n\n" + preparedCode;
  fs.writeFileSync(scriptPath, finalScript, "utf8");

  const startTime = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("python3", [scriptPath], {
      timeout: timeoutMs,
      cwd: GENERATED_FILES_DIR,
      maxBuffer: 5 * 1024 * 1024,
    });

    const executionTimeMs = Date.now() - startTime;
    const files = fs.readdirSync(GENERATED_FILES_DIR);
    const generatedImages: string[] = [];
    const generatedFiles: string[] = [];

    for (const f of files) {
      if (f.startsWith(`temp_${runId}`)) continue;
      const fullPath = path.join(GENERATED_FILES_DIR, f);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.mtimeMs >= startTime - 1000) {
          if (/\.(png|jpg|jpeg|webp)$/i.test(f)) {
            generatedImages.push(fullPath);
          } else if (!f.endsWith(".py")) {
            generatedFiles.push(fullPath);
          }
        }
      } catch {}
    }

    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      generatedImages,
      generatedFiles,
      executionTimeMs,
    };
  } catch (err: any) {
    const executionTimeMs = Date.now() - startTime;
    return {
      success: false,
      stdout: String(err?.stdout || "").trim(),
      stderr: String(err?.stderr || "").trim(),
      generatedImages: [],
      generatedFiles: [],
      executionTimeMs,
      error: String(err?.message || err),
    };
  } finally {
    try {
      if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    } catch {}
  }
}

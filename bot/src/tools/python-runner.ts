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

/**
 * Thực thi mã nguồn Python an toàn trên máy chủ Mac mini.
 * Tự động hỗ trợ matplotlib/seaborn (không cần màn hình GUI), tự lưu biểu đồ thành ảnh PNG.
 */
export async function runPythonCode(code: string, timeoutMs = 25000): Promise<PythonRunResult> {
  if (!fs.existsSync(GENERATED_FILES_DIR)) {
    fs.mkdirSync(GENERATED_FILES_DIR, { recursive: true });
  }

  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const scriptPath = path.join(GENERATED_FILES_DIR, `temp_${runId}.py`);
  const defaultChartPath = path.join(GENERATED_FILES_DIR, `chart_${runId}.png`);

  const preambles = [
    "import os, sys",
    "os.environ['MPLBACKEND'] = 'Agg'",
    "try:",
    "    import matplotlib",
    "    matplotlib.use('Agg')",
    "    import matplotlib.pyplot as plt",
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

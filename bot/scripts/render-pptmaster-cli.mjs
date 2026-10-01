import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distBridgePath = path.resolve(__dirname, "../dist/tools/pptmaster-bridge.js");

async function main() {
  const args = process.argv.slice(2);
  let inputFile = "";
  let outputFile = "";
  let themeName = "navy";
  let enableNarration = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) inputFile = args[++i];
    else if (args[i] === "--output" && args[i + 1]) outputFile = args[++i];
    else if (args[i] === "--theme" && args[i + 1]) themeName = args[++i];
    else if (args[i] === "--narration") enableNarration = true;
  }

  if (!inputFile || !fs.existsSync(inputFile)) {
    console.error("Error: File --input không tồn tại hoặc chưa được chỉ định");
    process.exit(1);
  }

  let slidesData;
  try {
    const raw = fs.readFileSync(inputFile, "utf8");
    const parsed = JSON.parse(raw);
    slidesData = Array.isArray(parsed) ? parsed : (parsed.slides || []);
  } catch (err) {
    console.error("Error: Không thể parse JSON từ file input:", err.message);
    process.exit(1);
  }

  if (!slidesData || slidesData.length === 0) {
    console.error("Error: Danh sách slides rỗng");
    process.exit(1);
  }

  if (!fs.existsSync(distBridgePath)) {
    console.error(`Error: Không tìm thấy module bridge tại ${distBridgePath}. Cần chạy npm run build trước.`);
    process.exit(1);
  }

  const { renderPPTMasterPresentation } = await import(distBridgePath);
  const baseName = outputFile ? path.basename(outputFile, ".pptx") : `presentation_${Date.now()}`;
  console.log(`[render_pptmaster] 🚀 Đang render ${slidesData.length} slide bằng PPTMaster (theme=${themeName})...`);

  try {
    const result = await renderPPTMasterPresentation({
      slides: slidesData,
      themeName,
      fileName: baseName,
      enableNarration,
    });

    if (result.success && fs.existsSync(result.filePath)) {
      if (outputFile && path.resolve(outputFile) !== path.resolve(result.filePath)) {
        fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
        fs.copyFileSync(result.filePath, outputFile);
        console.log(`[render_pptmaster] ✅ Hoàn tất! File PPTX: ${outputFile} (${fs.statSync(outputFile).size} bytes)`);
        console.log(`[FILE: ${outputFile}]`);
      } else {
        console.log(`[render_pptmaster] ✅ Hoàn tất! File PPTX: ${result.filePath} (${result.fileSize} bytes)`);
        console.log(`[FILE: ${result.filePath}]`);
      }
      process.exit(0);
    } else {
      console.error("[render_pptmaster] ❌ Lỗi: PPTMaster không tạo được file.");
      process.exit(1);
    }
  } catch (e) {
    console.error("[render_pptmaster] ❌ Ngoại lệ khi render:", e);
    process.exit(1);
  }
}

main();

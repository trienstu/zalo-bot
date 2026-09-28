import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

async function main() {
  const start = Date.now();
  console.log("🎬 [Remotion] Bắt đầu thử nghiệm render video...");

  const outDir = path.resolve("./out");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 1. Bundle Remotion project
  console.log("📦 [Remotion] Đang đóng gói bundle Webpack...");
  const bundleStart = Date.now();
  const bundleLocation = await bundle({
    entryPoint: path.resolve("./src/index.ts"),
    // If webpack needs options
  });
  console.log(`✅ [Remotion] Bundle hoàn tất trong ${((Date.now() - bundleStart) / 1000).toFixed(2)}s tại: ${bundleLocation}`);

  // 2. Chọn Composition
  const compositionId = "AiShortsVideo";
  console.log(`🔍 [Remotion] Đang đọc cấu hình composition '${compositionId}'...`);
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: compositionId,
  });

  console.log(`📐 [Remotion] Thông số: ${composition.width}x${composition.height} | ${composition.fps}fps | ${composition.durationInFrames} frames (~${(composition.durationInFrames / composition.fps).toFixed(1)}s)`);

  // 3. Render MP4
  const outputFile = path.resolve(outDir, "ai-shorts-test.mp4");
  console.log(`🚀 [Remotion] Đang render media xuất ra: ${outputFile}...`);
  const renderStart = Date.now();

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputFile,
    concurrency: 2,
    onProgress: ({ renderedFrames, encodedFrames }) => {
      process.stdout.write(`\r   ⏳ Render: ${renderedFrames}/${composition.durationInFrames} frames | Encode: ${encodedFrames}/${composition.durationInFrames} frames`);
    },
  });

  console.log(`\n🎉 [Remotion] Render hoàn tất trong ${((Date.now() - renderStart) / 1000).toFixed(2)}s!`);
  const stats = fs.statSync(outputFile);
  console.log(`📊 File size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`⏱️ Tổng thời gian: ${((Date.now() - start) / 1000).toFixed(2)}s`);
}

main().catch((err) => {
  console.error("❌ Lỗi render Remotion:", err);
  process.exit(1);
});

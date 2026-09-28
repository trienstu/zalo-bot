import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cache bundle location in-memory or in persistent dist folder
let cachedBundleLocation = null;

export async function getOrBuildBundle() {
  if (cachedBundleLocation && fs.existsSync(cachedBundleLocation)) {
    return cachedBundleLocation;
  }
  console.log("📦 [Remotion] Đang đóng gói bundle Webpack...");
  const bundleStart = Date.now();
  cachedBundleLocation = await bundle({
    entryPoint: path.resolve(__dirname, "./src/index.ts"),
    publicDir: path.resolve(__dirname, "./public"),
  });
  console.log(`✅ [Remotion] Bundle hoàn tất trong ${((Date.now() - bundleStart) / 1000).toFixed(2)}s tại: ${cachedBundleLocation}`);
  return cachedBundleLocation;
}

export async function renderRemotionVideo({
  compositionId = "VerticalShorts",
  inputProps = {},
  outputLocation = "./out/video.mp4",
  concurrency = 1,
  durationInFrames,
} = {}) {
  const start = Date.now();
  const bundleLocation = await getOrBuildBundle();

  const resolvedOutput = path.resolve(outputLocation);
  const outDir = path.dirname(resolvedOutput);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`🔍 [Remotion] Đang tải composition '${compositionId}'...`);
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: compositionId,
    inputProps,
  });

  if (durationInFrames && Number.isFinite(durationInFrames)) {
    composition.durationInFrames = Math.max(30, Math.round(durationInFrames));
  }

  const cpuCount = os.cpus().length || 1;
  const safeConcurrency = Math.max(1, Math.min(cpuCount, Number(concurrency) || 1));

  console.log(`📐 [Remotion] Thông số: ${composition.width}x${composition.height} | ${composition.fps}fps | ${composition.durationInFrames} frames (~${(composition.durationInFrames / composition.fps).toFixed(1)}s) | Concurrency: ${safeConcurrency}/${cpuCount} core(s)`);

  console.log(`🚀 [Remotion] Đang render media ra file: ${resolvedOutput}...`);
  const renderStart = Date.now();

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: resolvedOutput,
    inputProps,
    concurrency: safeConcurrency,
    onProgress: ({ renderedFrames, encodedFrames }) => {
      process.stdout.write(`\r   ⏳ Render: ${renderedFrames}/${composition.durationInFrames} frames | Encode: ${encodedFrames}/${composition.durationInFrames} frames`);
    },
  });

  console.log(`\n🎉 [Remotion] Render hoàn tất trong ${((Date.now() - renderStart) / 1000).toFixed(2)}s!`);
  const stats = fs.statSync(resolvedOutput);
  console.log(`📊 File size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`⏱️ Tổng thời gian: ${((Date.now() - start) / 1000).toFixed(2)}s`);

  return {
    success: true,
    filePath: resolvedOutput,
    fileSize: stats.size,
    durationSec: composition.durationInFrames / composition.fps,
    renderDurationSec: (Date.now() - renderStart) / 1000,
  };
}

// CLI execution if run directly
if (process.argv[1]?.endsWith("render.mjs")) {
  const args = process.argv.slice(2);
  const compArg = args.find((a) => a.startsWith("--comp="))?.split("=")[1] || "VerticalShorts";
  const outArg = args.find((a) => a.startsWith("--out="))?.split("=")[1] || `./out/${compArg.toLowerCase()}.mp4`;
  const propsFileArg = args.find((a) => a.startsWith("--props="))?.split("=")[1];
  const durationArg = args.find((a) => a.startsWith("--duration="))?.split("=")[1];
  const concurrencyArg = args.find((a) => a.startsWith("--concurrency="))?.split("=")[1];

  let parsedProps = {};
  if (propsFileArg && fs.existsSync(propsFileArg)) {
    try {
      parsedProps = JSON.parse(fs.readFileSync(propsFileArg, "utf8"));
    } catch (e) {
      console.error("⚠️ Không đọc được props file:", e.message);
    }
  }

  renderRemotionVideo({
    compositionId: compArg,
    outputLocation: outArg,
    inputProps: parsedProps,
    durationInFrames: durationArg ? parseInt(durationArg, 10) : undefined,
    concurrency: concurrencyArg ? parseInt(concurrencyArg, 10) : 2,
  })
    .then((result) => {
      console.log("__RESULT_JSON__" + JSON.stringify(result));
    })
    .catch((err) => {
      console.error("❌ Lỗi render Remotion:", err);
      process.exit(1);
    });
}

import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRemotionDir() {
  const candidateDirs = [
    "/home/ubuntu/zalo-bot-2/remotion-engine",
    path.resolve(__dirname, "../../remotion-engine"),
    path.resolve(__dirname, "../remotion-engine"),
    path.resolve(process.cwd(), "remotion-engine"),
    path.resolve(process.cwd(), "../remotion-engine"),
  ];
  for (const dir of candidateDirs) {
    if (fs.existsSync(path.join(dir, "render.mjs"))) {
      return dir;
    }
  }
  return path.resolve(process.cwd(), "remotion-engine");
}

const remotionDir = findRemotionDir();

async function main() {
  const args = process.argv.slice(2);
  let inputFile = "";
  let outputFile = "";
  let compName = "LandscapeExplainer";
  let customNarration = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) inputFile = args[++i];
    else if (args[i] === "--output" && args[i + 1]) outputFile = args[++i];
    else if (args[i] === "--comp" && args[i + 1]) compName = args[++i];
    else if (args[i] === "--narration" && args[i + 1]) customNarration = args[++i];
  }

  let propsData = {};
  if (inputFile && fs.existsSync(inputFile)) {
    try {
      propsData = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    } catch (e) {
      console.error("⚠️ Không đọc được JSON từ input file:", e.message);
    }
  }

  if (compName === "LandscapeExplainer" && !propsData.bulletPoints && propsData.points) {
    propsData.bulletPoints = propsData.points;
  }
  if (compName === "VerticalShorts" && !propsData.points && propsData.bulletPoints) {
    propsData.points = propsData.bulletPoints;
  }

  const narrationText = customNarration || propsData.narration || propsData.script || "";
  let audioFileName = propsData.audioFile || "";
  let audioDurationSec = 5;

  const publicDir = path.join(remotionDir, "public");
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // Nếu có nội dung lời đọc nhưng chưa có audioFile
  if (narrationText) {
    const audioBasename = `narration_${Date.now()}.mp3`;
    const targetAudioPath = path.join(publicDir, audioBasename);
    console.log(`🎙️ [Vox Engine] Đang sinh giọng đọc thuyết minh (${narrationText.length} ký tự)...`);

    const chunkTtsPath = path.resolve(repoRoot, "scripts", "chunk_tts.py");
    const vpsChunkTts = "/home/ubuntu/shared-assets/templates/chunk_tts.py";
    const ttsScript = fs.existsSync(vpsChunkTts) ? vpsChunkTts : (fs.existsSync(chunkTtsPath) ? chunkTtsPath : null);

    let ttsSuccess = false;
    if (ttsScript) {
      try {
        execFileSync("python3", [ttsScript, "--text", narrationText, "--output", targetAudioPath], { stdio: "inherit" });
        if (fs.existsSync(targetAudioPath) && fs.statSync(targetAudioPath).size > 1000) {
          ttsSuccess = true;
          audioFileName = audioBasename;
        }
      } catch (err) {
        console.error("⚠️ Lỗi khi chạy chunk_tts.py:", err.message);
      }
    }

    if (!ttsSuccess) {
      try {
        execFileSync("edge-tts", ["--text", narrationText, "--write-media", targetAudioPath, "--voice", "vi-VN-HoaiMyNeural"]);
        if (fs.existsSync(targetAudioPath) && fs.statSync(targetAudioPath).size > 1000) {
          audioFileName = audioBasename;
          ttsSuccess = true;
        }
      } catch (err) {
        console.error("⚠️ Lỗi khi gọi edge-tts fallback:", err.message);
      }
    }

    if (ttsSuccess && audioFileName) {
      try {
        const audioPath = path.join(publicDir, audioFileName);
        const durOutput = execFileSync(
          "ffprobe",
          ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath],
          { encoding: "utf8" },
        );
        const parsed = parseFloat(durOutput.trim());
        if (!isNaN(parsed) && parsed > 0) {
          audioDurationSec = parsed;
        }
      } catch {
        audioDurationSec = Math.max(5, Math.ceil(narrationText.length / 15));
      }
    }
  }

  if (audioFileName) {
    propsData.audioFile = audioFileName;
  }

  const fps = 30;
  // Thêm 2 giây padding sau khi đọc xong
  const durationInFrames = Math.max(90, Math.ceil((audioDurationSec + 2) * fps));
  console.log(`🎬 [Vox Engine] Thời lượng video: ${audioDurationSec.toFixed(1)}s (~${durationInFrames} frames @ ${fps}fps)`);

  const tempPropsPath = path.join("/tmp", `remotion_props_${Date.now()}.json`);
  fs.writeFileSync(tempPropsPath, JSON.stringify(propsData, null, 2), "utf8");

  const finalOutput = outputFile || `/home/ubuntu/shared-assets/video_vox_${Date.now()}.mp4`;
  fs.mkdirSync(path.dirname(path.resolve(finalOutput)), { recursive: true });

  console.log(`🚀 [Vox Engine] Đang render Remotion composition '${compName}'...`);
  const renderScript = path.join(remotionDir, "render.mjs");

  try {
    const cmdArgs = [
      renderScript,
      `--comp=${compName}`,
      `--out=${finalOutput}`,
      `--props=${tempPropsPath}`,
      `--duration=${durationInFrames}`,
      `--concurrency=2`,
    ];
    execFileSync("node", cmdArgs, { stdio: "inherit" });

    if (fs.existsSync(finalOutput) && fs.statSync(finalOutput).size > 10000) {
      console.log(`✅ [Vox Engine] Hoàn tất! Video MP4: ${finalOutput} (${fs.statSync(finalOutput).size} bytes)`);
      console.log(`[FILE: ${finalOutput}]`);
      process.exit(0);
    } else {
      console.error("❌ File video không được tạo thành công.");
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ Ngoại lệ khi render Remotion:", err.message);
    process.exit(1);
  } finally {
    try {
      if (fs.existsSync(tempPropsPath)) fs.unlinkSync(tempPropsPath);
    } catch {}
  }
}

main();

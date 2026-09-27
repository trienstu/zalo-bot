import { spawn } from "node:child_process";

export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wma",
  "flac",
  "amr",
  "aiff",
  "m4r",
  "mpga",
]);

/**
 * Kiểm tra xem phần mở rộng file có phải là file âm thanh hay không.
 */
export function isAudioExtension(ext: string): boolean {
  if (!ext) return false;
  return SUPPORTED_AUDIO_EXTENSIONS.has(ext.toLowerCase().trim().replace(/^\./, ""));
}

/**
 * Nhận diện MIME type của file âm thanh từ buffer hoặc tên file.
 */
export function detectAudioMimeType(buffer: Buffer, fileNameOrUrl = ""): string | null {
  if (buffer && buffer.length >= 4) {
    // ASF / WMA header: 30 26 B2 75
    if (
      buffer.length >= 16 &&
      buffer[0] === 0x30 &&
      buffer[1] === 0x26 &&
      buffer[2] === 0xb2 &&
      buffer[3] === 0x75
    ) {
      return "audio/x-ms-wma";
    }

    // FLAC header: 66 4C 61 43 (fLaC)
    if (
      buffer[0] === 0x66 &&
      buffer[1] === 0x4c &&
      buffer[2] === 0x61 &&
      buffer[3] === 0x43
    ) {
      return "audio/flac";
    }

    // OGG header: 4F 67 67 53 (OggS)
    if (
      buffer[0] === 0x4f &&
      buffer[1] === 0x67 &&
      buffer[2] === 0x67 &&
      buffer[3] === 0x53
    ) {
      return "audio/ogg";
    }

    // AMR header: 23 21 41 4D 52 (#!AMR)
    if (
      buffer.length >= 5 &&
      buffer[0] === 0x23 &&
      buffer[1] === 0x21 &&
      buffer[2] === 0x41 &&
      buffer[3] === 0x4d &&
      buffer[4] === 0x52
    ) {
      return "audio/amr";
    }

    // WAV header: RIFF .... WAVE
    if (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WAVE"
    ) {
      return "audio/wav";
    }

    // MP3 ID3 header: 49 44 33 (ID3)
    if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      return "audio/mp3";
    }

    // MP3 frame sync: 0xFF 0xFB, 0xFF 0xF3, 0xFF 0xF2
    if (buffer.length >= 2 && buffer[0] === 0xff && typeof buffer[1] === "number" && (buffer[1] & 0xe0) === 0xe0) {
      return "audio/mp3";
    }
  }

  const cleanName = fileNameOrUrl.split("?")[0] || "";
  const ext = (cleanName.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "wma":
      return "audio/x-ms-wma";
    case "flac":
      return "audio/flac";
    case "ogg":
    case "opus":
      return "audio/ogg";
    case "amr":
      return "audio/amr";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "aiff":
      return "audio/aiff";
    case "mp3":
    case "mpga":
      return "audio/mp3";
    default:
      return null;
  }
}

/**
 * Chuyển đổi định dạng âm thanh bất kỳ sang chuẩn MP3 hoặc WAV (16kHz) bằng ffmpeg.
 */
export async function transcodeAudioWithFfmpeg(
  inputBuffer: Buffer,
  targetFormat: "mp3" | "wav" = "mp3",
  timeoutMs = 45_000,
): Promise<{ buffer: Buffer; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const isWav = targetFormat === "wav";
    const args = isWav
      ? ["-i", "pipe:0", "-f", "wav", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "pipe:1"]
      : ["-i", "pipe:0", "-f", "mp3", "-acodec", "libmp3lame", "-b:a", "128k", "-ar", "44100", "pipe:1"];

    const ffmpegProcess = spawn("ffmpeg", args);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      ffmpegProcess.kill("SIGKILL");
      reject(new Error(`Transcode ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ffmpegProcess.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    ffmpegProcess.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    ffmpegProcess.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        const out = Buffer.concat(stdoutChunks);
        resolve({
          buffer: out,
          mimeType: isWav ? "audio/wav" : "audio/mp3",
        });
      } else {
        const errLog = Buffer.concat(stderrChunks).toString("utf-8").slice(-300);
        reject(new Error(`ffmpeg exited with code ${code}: ${errLog}`));
      }
    });

    ffmpegProcess.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    try {
      ffmpegProcess.stdin.write(inputBuffer);
      ffmpegProcess.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

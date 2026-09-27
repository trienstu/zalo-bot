import { spawn } from "node:child_process";

/**
 * Kiểm tra xem buffer có phải là định dạng JPEG XL (.jxl) hay không
 * dựa trên magic bytes:
 * 1. Naked JXL codestream: 0xFF 0x0A
 * 2. ISO BMFF container: 0x00 0x00 0x00 0x0C 0x4A 0x58 0x4C 0x20 0x0D 0x0A 0x87 0x0A
 */
export function isJxlBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 2) return false;
  if (buffer[0] === 0xff && buffer[1] === 0x0a) {
    return true;
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x00 &&
    buffer[3] === 0x0c &&
    buffer[4] === 0x4a && // 'J'
    buffer[5] === 0x58 && // 'X'
    buffer[6] === 0x4c && // 'L'
    buffer[7] === 0x20 && // ' '
    buffer[8] === 0x0d &&
    buffer[9] === 0x0a &&
    buffer[10] === 0x87 &&
    buffer[11] === 0x0a
  ) {
    return true;
  }
  return false;
}

/**
 * Chuyển đổi định dạng ảnh (đặc biệt là JPEG XL / JXL hoặc các định dạng lạ)
 * sang JPEG hoặc PNG chuẩn bằng ffmpeg thông qua stream pipeline stdin/stdout.
 */
export async function transcodeImageWithFfmpeg(
  inputBuffer: Buffer,
  targetFormat: "jpeg" | "png" = "jpeg",
  timeoutMs = 15_000,
): Promise<{ buffer: Buffer; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const isPng = targetFormat === "png";
    const args = isPng
      ? ["-i", "pipe:0", "-f", "image2", "-c:v", "png", "pipe:1"]
      : ["-i", "pipe:0", "-f", "image2", "-c:v", "mjpeg", "-q:v", "2", "pipe:1"];

    const ffmpegProcess = spawn("ffmpeg", args);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      ffmpegProcess.kill("SIGKILL");
      reject(new Error(`Transcode image ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ffmpegProcess.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    ffmpegProcess.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    ffmpegProcess.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && stdoutChunks.length > 0) {
        const out = Buffer.concat(stdoutChunks);
        resolve({
          buffer: out,
          mimeType: isPng ? "image/png" : "image/jpeg",
        });
      } else {
        const errLog = Buffer.concat(stderrChunks).toString("utf-8").slice(-300);
        reject(new Error(`ffmpeg image conversion failed with code ${code}: ${errLog}`));
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

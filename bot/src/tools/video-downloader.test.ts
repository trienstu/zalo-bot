import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isSupportedVideoUrl,
  ensureVideoOutputDir,
  cleanOldDownloadedVideos,
  downloadMediaVideo,
  DOWNLOADS_VIDEO_DIR,
} from "./video-downloader.js";

test("isSupportedVideoUrl: nhận diện chính xác các nền tảng video", () => {
  assert.equal(isSupportedVideoUrl("https://www.tiktok.com/@user/video/7311749721798364448"), true);
  assert.equal(isSupportedVideoUrl("https://vt.tiktok.com/ZSjRNY3yv/"), true);
  assert.equal(isSupportedVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), true);
  assert.equal(isSupportedVideoUrl("https://youtu.be/dQw4w9WgXcQ"), true);
  assert.equal(isSupportedVideoUrl("https://youtube.com/shorts/abcdef12345"), true);
  assert.equal(isSupportedVideoUrl("https://www.facebook.com/reel/1234567890"), true);
  assert.equal(isSupportedVideoUrl("https://fb.watch/abcdef/"), true);
  assert.equal(isSupportedVideoUrl("https://www.instagram.com/reel/C7abcdef/"), true);
  assert.equal(isSupportedVideoUrl("https://x.com/elonmusk/status/123456789"), true);
  assert.equal(isSupportedVideoUrl("https://twitter.com/user/status/123456"), true);

  // Không phải video web
  assert.equal(isSupportedVideoUrl("https://google.com"), false);
  assert.equal(isSupportedVideoUrl("https://vnexpress.net/thoi-su"), false);
  assert.equal(isSupportedVideoUrl(""), false);
});

test("ensureVideoOutputDir & cleanOldDownloadedVideos: quản lý thư mục và dọn dẹp file tạm", () => {
  const dir = ensureVideoOutputDir();
  assert.ok(fs.existsSync(dir));

  // Tạo một file rác giả lập cũ hơn 35 phút
  const dummyOldFile = path.join(DOWNLOADS_VIDEO_DIR, "dummy_old_video.mp4");
  fs.writeFileSync(dummyOldFile, "dummy video content");

  const oldTime = Date.now() - 35 * 60 * 1000;
  fs.utimesSync(dummyOldFile, new Date(oldTime), new Date(oldTime));

  const removedCount = cleanOldDownloadedVideos(30);
  assert.ok(removedCount >= 1);
  assert.equal(fs.existsSync(dummyOldFile), false);
});

test("downloadMediaVideo: từ chối xử lý khi URL rỗng", async () => {
  const res = await downloadMediaVideo("");
  assert.equal(res.success, false);
  assert.match(res.error || "", /hợp lệ/);
});

test("isYouTubeUrl & extractYouTubeVideoId nhận diện chính xác các định dạng URL YouTube", async () => {
  const { isYouTubeUrl, extractYouTubeVideoId } = await import("./vertical-tools.js");
  assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=hPtpf0rmL5M"), true);
  assert.equal(isYouTubeUrl("https://youtu.be/hPtpf0rmL5M"), true);
  assert.equal(isYouTubeUrl("https://youtube.com/shorts/hPtpf0rmL5M?feature=share"), true);
  assert.equal(isYouTubeUrl("https://www.youtube.com/embed/hPtpf0rmL5M"), true);
  assert.equal(isYouTubeUrl("https://facebook.com/watch?v=123"), false);

  assert.equal(extractYouTubeVideoId("https://www.youtube.com/watch?v=hPtpf0rmL5M"), "hPtpf0rmL5M");
  assert.equal(extractYouTubeVideoId("https://youtu.be/hPtpf0rmL5M"), "hPtpf0rmL5M");
  assert.equal(extractYouTubeVideoId("https://youtube.com/shorts/hPtpf0rmL5M"), "hPtpf0rmL5M");
  assert.equal(extractYouTubeVideoId("https://google.com"), null);
});


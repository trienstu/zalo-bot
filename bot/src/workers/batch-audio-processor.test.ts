import test from "node:test";
import assert from "node:assert/strict";
import { isBatchAudioRequest } from "./batch-audio-processor.js";

test("isBatchAudioRequest nhận diện đúng file zip chứa bài nghe/audio", () => {
  assert.equal(isBatchAudioRequest("", "AUDIO_MOVERS_CD2.zip"), true);
  assert.equal(isBatchAudioRequest("Bóc băng giúp anh file này nhé", "bai_nghe_tieng_anh.zip"), true);
  assert.equal(isBatchAudioRequest("Tổng hợp và xuất file word bộ audio này", "tailieu.zip"), true);
  assert.equal(isBatchAudioRequest("Xuất sang word bộ đề thi listening", "de_thi_ielts.rar"), true);
  assert.equal(isBatchAudioRequest("đây là file tài liệu bình thường", "contract.pdf"), false);
  assert.equal(isBatchAudioRequest("xin chào bot", ""), false);
});

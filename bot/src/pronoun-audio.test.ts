import test from "node:test";
import assert from "node:assert/strict";
import { deriveConversationPronouns } from "./admin-assistant.js";
import {
  isAudioExtension,
  detectAudioMimeType,
  transcodeAudioWithFfmpeg,
} from "./audio-transcoder.js";
import { checkIsFileOrVoiceGeneration } from "./tools/file-generator.js";

test("deriveConversationPronouns - Sửa triệt để lỗi từ đi biến thành Dì", () => {
  const res1 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "锦绒",
    rawText: "Chuyển qua text cho chị đi",
  });
  assert.equal(res1.userTitle, "Chị", "Phải nhận diện xưng hô là Chị, không được nhận nhầm thành Dì");
  assert.equal(res1.botPronoun, "em", "Bot phải xưng em với Chị");

  const res2 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "锦绒",
    rawText: "Chuyển text đi e",
  });
  assert.notEqual(res2.userTitle, "Dì", "Không được nhận 'đi e' thành Dì");

  const res3 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "锦绒",
    rawText: "Dì nào zậy, bị khùng hả",
  });
  assert.notEqual(res3.userTitle, "Dì", "Câu phàn nàn không được tiếp tục nhận là Dì");
});

test("deriveConversationPronouns - Sửa lỗi chú mày và nhận diện từ viết tắt", () => {
  const res1 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Trần Văn Tuyến",
    rawText: "chuyển file này thành dạng chữ cho a nha chú mày",
  });
  assert.equal(res1.userTitle, "Anh", "Gọi bot là 'chú mày' và 'cho a nha' phải nhận diện là Anh");
  assert.equal(res1.botPronoun, "em", "Bot xưng em với Anh");

  const res2 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Người dùng",
    rawText: "chú mày có vẻ hơi yếu nhỉ",
  });
  assert.equal(res2.userTitle, "Anh", "Gọi bot là chú mày thì người dùng là Anh");

  const res3 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Khách nữ",
    rawText: "cho c nha chú mày",
  });
  assert.equal(res3.userTitle, "Chị", "Nếu có 'cho c' kết hợp 'chú mày' thì người dùng là Chị");
});

test("deriveConversationPronouns - Nhận diện đúng vai vế bề trên thật", () => {
  const res1 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Trân Quang Hạ",
    rawText: "Cháu gọi tôi là Chú cho tình cảm nhé",
    memories: [{ memory_key: "addressing_preference", memory_value: "Người dùng muốn được gọi là Chú" }],
  });
  assert.equal(res1.userTitle, "Chú");
  assert.equal(res1.botPronoun, "cháu");

  const res2 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Bác Nam",
    rawText: "Bác nhờ cháu xem hộ cái này với",
  });
  assert.equal(res2.userTitle, "Bác");
  assert.equal(res2.botPronoun, "cháu");

  const resAdmin = deriveConversationPronouns({
    isAdmin: true,
    displayName: "Trien Nguyen",
    rawText: "Chuyển file này sang words được không e",
  });
  assert.equal(resAdmin.userTitle, "Sếp");
  assert.equal(resAdmin.botPronoun, "em");
});

test("audio-transcoder - Nhận diện định dạng âm thanh mở rộng", () => {
  assert.equal(isAudioExtension("wma"), true);
  assert.equal(isAudioExtension("flac"), true);
  assert.equal(isAudioExtension("opus"), true);
  assert.equal(isAudioExtension("amr"), true);
  assert.equal(isAudioExtension("mp3"), true);
  assert.equal(isAudioExtension("wav"), true);
  assert.equal(isAudioExtension("pdf"), false);

  const fakeWmaHeader = Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(detectAudioMimeType(fakeWmaHeader, "01 Дорожка 1.wma"), "audio/x-ms-wma");

  const fakeFlacHeader = Buffer.from([0x66, 0x4c, 0x61, 0x43]);
  assert.equal(detectAudioMimeType(fakeFlacHeader, "music.flac"), "audio/flac");
});

test("checkIsFileOrVoiceGeneration - Nhận diện yêu cầu chuyển file âm thanh sang Word", () => {
  assert.equal(checkIsFileOrVoiceGeneration("Chuyển file này sang words được không e"), true);
  assert.equal(checkIsFileOrVoiceGeneration("Chuyển file này sang word giúp a"), true);
  assert.equal(checkIsFileOrVoiceGeneration("xuất nội dung này ra file docx nhé"), true);
  assert.equal(checkIsFileOrVoiceGeneration("chuyển sang file docx giúp e"), true);
});

test("deriveConversationPronouns - Sửa triệt để lỗi từ Có biến thành Cô và Ảnh biến thành Anh", () => {
  // Case của Chị Hiền: Có gì cần mình sẽ nhắn -> Tuyệt đối không xưng cô cháu
  const resHien = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Thanh Hiền",
    rawText: "Có gì cần mình sẽ nhắn",
  });
  assert.notEqual(resHien.userTitle, "Cô", "Từ 'Có' tuyệt đối không được nhận nhầm thành 'Cô'");
  assert.notEqual(resHien.botPronoun, "cháu", "Bot không được xưng cháu với người dùng chỉ vì có từ 'Có'");
  assert.equal(resHien.userTitle, "Thanh Hiền");

  // Case từ có thông thường
  const resCo1 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Minh",
    rawText: "Em có đó không",
  });
  assert.notEqual(resCo1.userTitle, "Cô");

  // Case từ ảnh thông thường
  const resAnh = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Linh",
    rawText: "Gửi ảnh cho tôi xem",
  });
  assert.notEqual(resAnh.userTitle, "Anh", "Từ 'ảnh' (bức ảnh) không được nhận nhầm thành 'Anh'");

  // Case từ chỉ thông thường
  const resChi = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Nam",
    rawText: "Em chỉ cần tóm tắt thôi",
  });
  assert.notEqual(resChi.userTitle, "Chị", "Từ 'chỉ' (chỉ cần) không được nhận nhầm thành 'Chị'");

  // Nhận diện Cô thật (có dấu)
  const resRealCo1 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Mai",
    rawText: "Cô ơi chỉ cho cháu với",
  });
  assert.equal(resRealCo1.userTitle, "Cô");
  assert.equal(resRealCo1.botPronoun, "cháu");

  // Nhận diện Cô thật (không dấu nhưng có ngữ cảnh chào hỏi/kính trọng)
  const resRealCo2 = deriveConversationPronouns({
    isAdmin: false,
    displayName: "Lan",
    rawText: "chao co a, co khoe khong",
  });
  assert.equal(resRealCo2.userTitle, "Cô");
  assert.equal(resRealCo2.botPronoun, "cháu");
});


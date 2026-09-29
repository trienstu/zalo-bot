import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGoogleUrl } from "./google-sync.js";

test("parseGoogleUrl nhận diện chính xác Google Sheets và Google Docs", () => {
  // 1. Google Sheets
  const sheetUrl = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?gid=123#gid=123";
  const parsedSheet = parseGoogleUrl(sheetUrl);
  assert.ok(parsedSheet);
  assert.equal(parsedSheet.type, "google_sheet");
  assert.equal(parsedSheet.id, "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms");
  assert.equal(parsedSheet.gid, "123");
  assert.equal(
    parsedSheet.exportUrl,
    "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=123",
  );

  // 2. Google Docs
  const docUrl = "https://docs.google.com/document/d/1wZkJ3PZ_Q7oFjE-r9V6M8T_SampleDocId/edit?usp=sharing";
  const parsedDoc = parseGoogleUrl(docUrl);
  assert.ok(parsedDoc);
  assert.equal(parsedDoc.type, "google_doc");
  assert.equal(parsedDoc.id, "1wZkJ3PZ_Q7oFjE-r9V6M8T_SampleDocId");
  assert.equal(
    parsedDoc.exportUrl,
    "https://docs.google.com/document/d/1wZkJ3PZ_Q7oFjE-r9V6M8T_SampleDocId/export?format=txt",
  );
});

test("Nhận diện cú pháp /doc và link doc nghiêm ngặt", () => {
  const isDocCommand = (text: string) => {
    const lower = text.toLowerCase().trim();
    return (
      lower.startsWith("/doc") ||
      lower.startsWith("!doc") ||
      lower.startsWith("/docs") ||
      lower.startsWith("!docs") ||
      lower.startsWith("/tailieu") ||
      lower.startsWith("!tailieu") ||
      lower.startsWith("/strict") ||
      lower.startsWith("!strict") ||
      lower.startsWith("/doc-strict")
    );
  };

  const hasGoogleDocUrl = (text: string) =>
    /https?:\/\/docs\.google\.com\/(?:spreadsheets|document)\/d\/[a-zA-Z0-9-_]+/i.test(text);

  assert.equal(isDocCommand("/doc Palm River kiểm tra phương thức thanh toán"), true);
  assert.equal(isDocCommand("/doc-strict Palm River"), true);
  assert.equal(isDocCommand("/tailieu phương án đặc biệt"), true);
  assert.equal(isDocCommand("!doc xem chiết khấu"), true);
  assert.equal(isDocCommand("/hoi bình thường"), false);

  assert.equal(
    hasGoogleDocUrl("sen chúa xem link https://docs.google.com/document/d/1abc123/edit nha"),
    true,
  );
  assert.equal(
    hasGoogleDocUrl("https://docs.google.com/spreadsheets/d/1xyz789/edit#gid=0"),
    true,
  );
  assert.equal(hasGoogleDocUrl("https://google.com/search"), false);
});

test("checkIsFileOrVoiceGeneration chặn khiếu nại và ngăn quote thụ động cướp quyền", async () => {
  const { checkIsFileOrVoiceGeneration } = await import("./tools/file-generator.js");
  const { buildDynamicSystemPromptModules } = await import("./prompt-modules.js");

  // 1. Chặn phàn nàn / khiếu nại ngược
  assert.equal(checkIsFileOrVoiceGeneration("sao lại gửi file word làm gì thế"), false);
  assert.equal(checkIsFileOrVoiceGeneration("tại sao tự nhiên xuất file excel chi vậy bot"), false);
  assert.equal(checkIsFileOrVoiceGeneration("ai mượn gửi voice"), false);
  assert.equal(checkIsFileOrVoiceGeneration("không yêu cầu tạo file slide nha"), false);
  assert.equal(checkIsFileOrVoiceGeneration("đừng làm file nữa nhé"), false);

  // 2. Quote thụ động có nhắc tới file/nhạc nhưng người dùng chỉ hỏi bình thường
  const passiveQuoteWithFile = "Em đã chuẩn bị sẵn file word và excel báo cáo tài chính cho anh.";
  assert.equal(checkIsFileOrVoiceGeneration("thủ đô của Pháp là gì?", passiveQuoteWithFile), false);
  assert.equal(checkIsFileOrVoiceGeneration("giá vàng hôm nay sao rồi bot", passiveQuoteWithFile), false);

  // 3. Prompt modules không bị nhiễm quote thụ động
  const modules = buildDynamicSystemPromptModules({
    question: "thời tiết hôm nay thế nào?",
    quoteText: passiveQuoteWithFile,
    botName: "Sen Chúa",
    isSuperAdmin: false,
  });
  assert.equal(modules.includes("generate_file"), false);
  assert.equal(modules.includes("generate_music"), false);
  assert.equal(modules.includes("python_interpreter"), false);

  // 4. Khi người dùng xác nhận rõ ràng hoặc ra lệnh trực tiếp thì vẫn kích hoạt chuẩn xác
  assert.equal(checkIsFileOrVoiceGeneration("ok soạn luôn đi e", passiveQuoteWithFile), true);
  assert.equal(checkIsFileOrVoiceGeneration("tạo file word cho mình", ""), true);
  assert.equal(checkIsFileOrVoiceGeneration("xuất slide pptx về dự án này", ""), true);
});


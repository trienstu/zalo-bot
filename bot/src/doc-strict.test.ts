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

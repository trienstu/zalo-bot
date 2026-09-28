import test from "node:test";
import assert from "node:assert/strict";
import { getDocumentOcrCache, saveDocumentOcrCache } from "./db/index.js";

test("Document OCR Cache: lưu và trích xuất cache thành công theo Hash và URL", () => {
  const testHash = "sha256_mock_test_hash_" + Date.now();
  const testUrl = "https://example.com/test_doc_" + Date.now() + ".pdf";
  const testFileName = "bao_cao_tai_chinh.pdf";
  const sampleText = "BÁO CÁO TÀI CHÍNH QUÝ 3/2026\nTổng doanh thu: 100 tỷ đồng\nLợi nhuận ròng: 25 tỷ đồng";

  // 1. Ban đầu chưa có cache
  assert.equal(getDocumentOcrCache(testHash, testUrl), null);

  // 2. Lưu vào cache
  saveDocumentOcrCache(testHash, testUrl, testFileName, sampleText, 3);

  // 3. Trích xuất bằng Hash
  const hitByHash = getDocumentOcrCache(testHash);
  assert.ok(hitByHash);
  assert.equal(hitByHash.textContent, sampleText);
  assert.equal(hitByHash.totalPages, 3);

  // 4. Trích xuất bằng URL
  const hitByUrl = getDocumentOcrCache("", testUrl);
  assert.ok(hitByUrl);
  assert.equal(hitByUrl.textContent, sampleText);
  assert.equal(hitByUrl.totalPages, 3);
});

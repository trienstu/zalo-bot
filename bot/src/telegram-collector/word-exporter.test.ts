import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildTelegramKnowledgeWordBuffer,
  exportTelegramKnowledgeToDocxFile,
} from "./word-exporter.js";
import type { TelegramKnowledgeItem } from "./types.js";

const sampleItems: TelegramKnowledgeItem[] = [
  {
    chat_id: "-100123456789",
    chat_title: "Cộng Đồng AI & Automation Việt Nam",
    category: "ai_prompt",
    title: "Kỹ thuật Chain-of-Density để tóm tắt văn bản không sót ý",
    summary:
      "Phương pháp lặp lại 5 vòng tóm tắt liên tục, mỗi vòng cô đọng thêm các thực thể mà không tăng tổng số từ.",
    key_takeaways: [
      "Bắt đầu bằng một bản tóm tắt thưa thớt (sparse summary).",
      "Xác định 1-3 thực thể quan trọng còn thiếu trong bài gốc.",
      "Viết lại bản tóm tắt giữ nguyên độ dài nhưng nén thêm các thực thể vào.",
    ],
    original_quotes: "Áp dụng kỹ thuật này chất lượng tóm tắt sách tăng gấp 3 lần so với prompt thường.",
    useful_links: ["https://arxiv.org/abs/2309.04269"],
    raw_message_ids: [1001, 1002],
    date_range: "2026-09-30",
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    chat_id: "-100987654321",
    chat_title: "Hội Đầu Tư & Quản Trị Doanh Nghiệp",
    category: "business_real_estate",
    title: "Kinh nghiệm thẩm định pháp lý dự án bất động sản trước khi xuống tiền",
    summary:
      "Checklist 4 bước bắt buộc phải kiểm tra đối với hợp đồng mua bán và giấy phép xây dựng của chủ đầu tư.",
    key_takeaways: [
      "Kiểm tra biên bản nghiệm thu phần móng và bảo lãnh ngân hàng.",
      "Đối chiếu quy hoạch 1/500 tại Sở Xây Dựng địa phương.",
      "Lưu ý điều khoản phạt chậm tiến độ bàn giao trong phụ lục.",
    ],
    original_quotes: "Đừng tin lời hứa của môi giới, chỉ tin con dấu trên văn bản pháp lý.",
    useful_links: ["https://thuvienphapluat.vn"],
    raw_message_ids: [2001],
    date_range: "2026-09-30",
    created_at: Date.now(),
    updated_at: Date.now(),
  },
];

test("buildTelegramKnowledgeWordBuffer tạo buffer Word .docx hợp lệ", async () => {
  const itemsWithUrl: TelegramKnowledgeItem[] = [
    {
      ...sampleItems[0]!,
      telegram_url: "https://t.me/c/123456789/1001",
    },
    sampleItems[1]!,
  ];
  const buffer = await buildTelegramKnowledgeWordBuffer(itemsWithUrl, "TÀI LIỆU TEST TRI THỨC");
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 5000, `Buffer size phải > 5KB, thực tế: ${buffer.length}`);

  // Kiểm tra header zip (PK\x03\x04) của tệp docx
  assert.equal(buffer[0], 0x50); // P
  assert.equal(buffer[1], 0x4b); // K
  assert.equal(buffer[2], 0x03);
  assert.equal(buffer[3], 0x04);
});

test("exportTelegramKnowledgeToDocxFile ghi file Word chuẩn ra đĩa", async () => {
  const res = await exportTelegramKnowledgeToDocxFile(sampleItems, "Test_Export_Job");
  assert.ok(fs.existsSync(res.filePath));
  assert.ok(res.fileSize > 5000);
  assert.ok(res.fileName.endsWith(".docx"));

  // Dọn dẹp file test
  try {
    fs.unlinkSync(res.filePath);
  } catch {}
});

test("buildTelegramMessageUrl sinh link chính xác cho cả nhóm public và private", async () => {
  const { buildTelegramMessageUrl } = await import("./db.js");

  // 1. Nhóm công khai có username
  assert.equal(
    buildTelegramMessageUrl("-1002345304386", "kcracker007", 2150),
    "https://t.me/kcracker007/2150",
  );
  assert.equal(
    buildTelegramMessageUrl("-1002345304386", "@kcracker007", 2150),
    "https://t.me/kcracker007/2150",
  );

  // 2. Nhóm kín / Supergroup không có username (cắt bỏ -100)
  assert.equal(
    buildTelegramMessageUrl("-1002345304386", null, 2150),
    "https://t.me/c/2345304386/2150",
  );
  assert.equal(
    buildTelegramMessageUrl("-1001310275291", undefined, 9316),
    "https://t.me/c/1310275291/9316",
  );

  // 3. ID không hợp lệ hoặc thiếu messageId
  assert.equal(buildTelegramMessageUrl("-1002345304386", null, null), null);
  assert.equal(buildTelegramMessageUrl("-1002345304386", null, 0), null);
  assert.equal(buildTelegramMessageUrl("-1002345304386", null, -5), null);
});

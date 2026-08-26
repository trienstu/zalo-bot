import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { generateChatSummary } from "../../web/src/lib/gemini-summary.js";

async function main() {
  console.log("🚀 Bắt đầu quét lại toàn bộ dữ liệu lịch sử nhóm từ ngày đầu tiên...");

  const dbPath = path.resolve("./data/bot.db");
  if (!fs.existsSync(dbPath)) {
    console.error("❌ Không tìm thấy database tại:", dbPath);
    process.exit(1);
  }

  const db = new Database(dbPath);

  // Lấy tất cả các ngày có tin nhắn trong group_messages
  const rows = db
    .prepare(
      `SELECT DISTINCT date(ts / 1000 + 7 * 3600, 'unixepoch') as day_str,
              COUNT(*) as msg_count
       FROM group_messages
       WHERE deleted_at IS NULL AND text != ''
       GROUP BY day_str
       ORDER BY day_str ASC`,
    )
    .all() as { day_str: string; msg_count: number }[];

  console.log(`📊 Tìm thấy ${rows.length} ngày có dữ liệu tin nhắn:`);
  for (const r of rows) {
    console.log(`   📅 Ngày: ${r.day_str} — ${r.msg_count} tin nhắn`);
  }

  // Quét và tạo tóm tắt cho từng ngày
  for (const r of rows) {
    console.log(`\n⏳ Đang xử lý tóm tắt cho ngày ${r.day_str} (${r.msg_count} tin)...`);
    try {
      const res = await generateChatSummary({
        targetDate: r.day_str,
        sendToGroup: false, // Không spam lại vào group, chỉ lưu vào web và /hub
      });

      if (res.ok) {
        console.log(`✅ Thành công ngày ${r.day_str}! (Độ dài: ${res.summaryLength} ký tự)`);
      } else {
        console.log(`⚠️ Ngày ${r.day_str}: ${res.error || "Không có nội dung tóm tắt"}`);
      }
    } catch (e: any) {
      console.error(`❌ Lỗi ngày ${r.day_str}:`, e.message);
    }
  }

  console.log("\n🎉 HOÀN TẤT QUÉT TOÀN BỘ LỊCH SỬ! Toàn bộ kiến thức đã được cập nhật lên Kho Kiến Thức (/hub).");
}

main().catch(console.error);

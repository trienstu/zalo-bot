import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import { getDb } from "../src/db/index.js";

async function repair() {
  console.log("=== BẮT ĐẦU SỬA CHỮA CƠ SỞ DỮ LIỆU SQLITE ===");
  const dbPath = config.dbPath;
  console.log("Đường dẫn DB:", dbPath);

  if (!fs.existsSync(dbPath)) {
    console.log("File DB chưa tồn tại, khởi tạo mới...");
    getDb();
    console.log("✅ Đã khởi tạo DB mới thành công!");
    return;
  }

  const backupPath = `${dbPath}.bak.${Date.now()}`;
  console.log(`Đang sao lưu file DB cũ sang: ${backupPath}`);
  fs.copyFileSync(dbPath, backupPath);

  try {
    const rawDb = new Database(dbPath);
    console.log("Đang kiểm tra tính toàn vẹn (integrity_check)...");
    const check = rawDb.pragma("integrity_check") as any[];
    console.log("Kết quả kiểm tra:", check);

    // Thử reindex
    try {
      rawDb.exec("REINDEX;");
      console.log("REINDEX thành công.");
    } catch (e) {
      console.warn("REINDEX thất bại:", e);
    }
    rawDb.close();
  } catch (e) {
    console.warn("Mở DB cũ bị lỗi:", e);
  }

  // Phục hồi bằng cách export và tạo mới file sạch
  console.log("Đang tạo file DB mới sạch sẽ và nạp lại schema...");
  const tempCleanPath = `${dbPath}.clean.${Date.now()}`;
  
  try {
    // Xoá file wal và shm nếu có
    if (fs.existsSync(`${dbPath}-wal`)) fs.rmSync(`${dbPath}-wal`, { force: true });
    if (fs.existsSync(`${dbPath}-shm`)) fs.rmSync(`${dbPath}-shm`, { force: true });
    
    // Đổi tên file hỏng
    fs.renameSync(dbPath, tempCleanPath);

    // Khởi tạo DB mới từ schema.sql
    const newDb = getDb();
    console.log("✅ Đã tạo DB sạch thành công.");

    // Cố gắng cứu dữ liệu members từ DB cũ nếu được
    try {
      const oldDb = new Database(tempCleanPath, { readonly: true });
      const oldMembers = oldDb.prepare("SELECT * FROM members").all() as any[];
      if (oldMembers && oldMembers.length > 0) {
        console.log(`Đang phục hồi ${oldMembers.length} thành viên từ DB cũ...`);
        const insert = newDb.prepare(
          `INSERT OR IGNORE INTO members (zalo_user_id, display_name, first_seen_at, is_active)
           VALUES (@zalo_user_id, @display_name, @first_seen_at, @is_active)`
        );
        for (const m of oldMembers) {
          try {
            insert.run(m);
          } catch {}
        }
        console.log("✅ Đã phục hồi danh sách thành viên.");
      }
      oldDb.close();
    } catch (salvageErr) {
      console.warn("Không thể trích xuất dữ liệu cũ (file quá hỏng), bot sẽ tự động sync lại 144 member mới:", salvageErr);
    }

    if (fs.existsSync(tempCleanPath)) fs.rmSync(tempCleanPath, { force: true });
    console.log("🎉 SỬA CHỮA DB HOÀN TẤT!");
  } catch (err) {
    console.error("❌ Lỗi trong quá trình sửa chữa:", err);
  }
}

repair().catch(console.error);

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { extractGithubRepoUrls, fetchGithubRepoMetadata, classifyAndSummarizeRepo } from "../src/github-enricher.js";

async function main() {
  console.log("🚀 Bắt đầu quét & đồng bộ toàn bộ GitHub Repositories trong lịch sử tin nhắn Zalo...");

  const dbPath = path.resolve("./data/bot.db");
  if (!fs.existsSync(dbPath)) {
    console.error("❌ Không tìm thấy database tại:", dbPath);
    process.exit(1);
  }

  const db = new Database(dbPath);

  // Đảm bảo bảng group_repos tồn tại
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      description TEXT,
      stars INTEGER DEFAULT 0,
      forks INTEGER DEFAULT 0,
      language TEXT,
      category TEXT NOT NULL,
      summary_vi TEXT,
      target_audience TEXT,
      shared_by_uid TEXT,
      shared_by_name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(thread_id, full_name)
    );
    CREATE INDEX IF NOT EXISTS idx_group_repos_thread ON group_repos(thread_id);
    CREATE INDEX IF NOT EXISTS idx_group_repos_category ON group_repos(category);
    CREATE INDEX IF NOT EXISTS idx_group_repos_created ON group_repos(created_at DESC);
  `);

  const messages: any[] = db
    .prepare(
      `SELECT thread_id, zalo_user_id, display_name, text, ts 
       FROM group_messages 
       WHERE text LIKE '%github.com%' AND deleted_at IS NULL 
       ORDER BY ts DESC`,
    )
    .all();

  console.log(`📊 Tìm thấy ${messages.length} tin nhắn có chứa liên kết GitHub:`);

  // 1. Tự động khắc phục các repo đã lưu nhưng bị 0 sao hoặc thiếu mô tả
  const existingZeroStarRepos: any[] = db
    .prepare("SELECT id, thread_id, full_name, owner, repo_name, stars, description, summary_vi FROM group_repos WHERE stars = 0 OR description IS NULL OR description = ''")
    .all();

  if (existingZeroStarRepos.length > 0) {
    console.log(`\n🛠️ Phát hiện ${existingZeroStarRepos.length} repo bị 0 sao hoặc thiếu mô tả trong database. Đang tự động sửa chữa...`);
    const updateStmt = db.prepare(`
      UPDATE group_repos 
      SET full_name = ?, owner = ?, repo_name = ?, repo_url = ?, description = ?, 
          stars = ?, forks = ?, language = ?, category = ?, summary_vi = ?, 
          target_audience = ?, updated_at = ? 
      WHERE id = ?
    `);

    for (const repo of existingZeroStarRepos) {
      console.log(`   ⏳ Đang cào lại: ${repo.full_name}...`);
      const meta = await fetchGithubRepoMetadata(repo.owner, repo.repo_name);
      if (meta && meta.stars > 0) {
        const ai = await classifyAndSummarizeRepo(meta);
        updateStmt.run(
          meta.fullName,
          meta.owner,
          meta.repo,
          meta.htmlUrl,
          meta.description,
          meta.stars,
          meta.forks,
          meta.language,
          ai.category,
          ai.summary_vi,
          ai.target_audience,
          Date.now(),
          repo.id
        );
        console.log(`   ✅ Đã sửa thành công: ${meta.fullName} — ★ ${meta.stars}`);
      }
    }
  }

  const checkStmt = db.prepare("SELECT id, stars FROM group_repos WHERE thread_id = ? AND LOWER(full_name) = LOWER(?)");
  const insertStmt = db.prepare(`
    INSERT INTO group_repos (
      thread_id, repo_url, owner, repo_name, full_name,
      description, stars, forks, language, category,
      summary_vi, target_audience, shared_by_uid, shared_by_name,
      created_at, updated_at
    ) VALUES (
      @thread_id, @repo_url, @owner, @repo_name, @full_name,
      @description, @stars, @forks, @language, @category,
      @summary_vi, @target_audience, @shared_by_uid, @shared_by_name,
      @created_at, @updated_at
    )
  `);

  let added = 0;
  let skipped = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const repos = extractGithubRepoUrls(msg.text);
    if (repos.length === 0) continue;

    for (const item of repos) {
      const existing: any = checkStmt.get(msg.thread_id, item.fullName);
      if (existing && existing.stars > 0) {
        skipped++;
        continue;
      }

      console.log(`\n⏳ [${i + 1}/${messages.length}] Đang xử lý repo: ${item.fullName} (Nhóm: ${msg.thread_id})...`);
      const meta = await fetchGithubRepoMetadata(item.owner, item.repo);
      if (!meta) {
        console.warn(`   ⚠️ Không thể cào thông tin GitHub cho ${item.fullName}`);
        continue;
      }

      const ai = await classifyAndSummarizeRepo(meta);

      try {
        if (existing) {
          db.prepare(`
            UPDATE group_repos 
            SET full_name = ?, owner = ?, repo_name = ?, repo_url = ?, description = ?, 
                stars = ?, forks = ?, language = ?, category = ?, summary_vi = ?, 
                target_audience = ?, updated_at = ? 
            WHERE id = ?
          `).run(
            meta.fullName,
            meta.owner,
            meta.repo,
            meta.htmlUrl,
            meta.description,
            meta.stars,
            meta.forks,
            meta.language,
            ai.category,
            ai.summary_vi,
            ai.target_audience,
            Date.now(),
            existing.id
          );
          console.log(`   🔄 Đã cập nhật: ${meta.fullName} (${ai.category}) — ★ ${meta.stars}`);
        } else {
          insertStmt.run({
            thread_id: msg.thread_id,
            repo_url: meta.htmlUrl,
            owner: meta.owner,
            repo_name: meta.repo,
            full_name: meta.fullName,
            description: meta.description,
            stars: meta.stars,
            forks: meta.forks,
            language: meta.language,
            category: ai.category,
            summary_vi: ai.summary_vi,
            target_audience: ai.target_audience,
            shared_by_uid: msg.zalo_user_id,
            shared_by_name: msg.display_name || "Thành viên",
            created_at: msg.ts || Date.now(),
            updated_at: Date.now(),
          });
          added++;
          console.log(`   ✅ Đã lưu: ${meta.fullName} (${ai.category}) — ★ ${meta.stars}`);
        }
      } catch (err: any) {
        console.warn(`   ❌ Lỗi lưu DB:`, err.message);
      }
    }
  }

  console.log(`\n🎉 HOÀN TẤT ĐỒNG BỘ LỊCH SỬ REPO!`);
  console.log(`   ➕ Đã thêm mới: ${added} repos`);
  console.log(`   ⏭️ Đã bỏ qua (đã có và đủ sao): ${skipped} repos`);
  db.close();
}

main().catch(console.error);

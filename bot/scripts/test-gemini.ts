import { callGeminiDirect } from "../../web/src/lib/gemini-summary.js";
import { config } from "../src/config.js";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

async function main() {
  const dbPath = path.resolve("./data/bot.db");
  console.log("DB Path:", dbPath, "Exists:", fs.existsSync(dbPath));
  const db = new Database(dbPath);
  const rows = db.prepare("SELECT * FROM group_messages WHERE ts >= 1787504400000 ORDER BY ts ASC LIMIT 400").all() as any[];
  console.log(`Tìm thấy ${rows.length} tin nhắn.`);

  const transcript = rows.map(r => `${r.display_name}: ${r.text}`).join("\n");
  const systemPrompt = "Bạn là trợ lý AI tóm tắt nội dung hội thoại nhóm Zalo tiếng Việt đầy đủ, súc tích và chính xác.";
  const userPrompt = `Tóm tắt nội dung sau:\n<log>\n${transcript}\n</log>`;

  console.log("Đang gọi callGeminiDirect (gemini-3.6-flash)...");
  const start = Date.now();
  try {
    const res = await callGeminiDirect(systemPrompt, userPrompt, config.geminiApiKey, "gemini-3.6-flash");
    console.log(`✅ THÀNH CÔNG trong ${Date.now() - start}ms! Độ dài: ${res.length} ký tự`);
    console.log("Trích đoạn:\n", res.slice(0, 300));
  } catch (e: any) {
    console.log(`❌ LỖI (${Date.now() - start}ms):`, e.message);
  }
}

main();

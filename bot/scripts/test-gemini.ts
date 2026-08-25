import { config } from "../src/config.js";

async function main() {
  const rawKey = config.geminiApiKey;
  const keys = rawKey.split(",").map((k) => k.trim()).filter(Boolean);
  console.log(`Tìm thấy ${keys.length} API Keys. Đang kiểm tra từng key...`);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const start = Date.now();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${key}`;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Trả lời: OK" }] }] }),
      });
      const duration = Date.now() - start;
      if (res.ok) {
        console.log(`✅ Key #${i + 1} (${key.slice(0, 15)}...): OK (${duration}ms)`);
      } else {
        const txt = await res.text();
        console.log(`⚠️ Key #${i + 1} (${key.slice(0, 15)}...): HTTP ${res.status} (${duration}ms) - ${txt.slice(0, 120)}`);
      }
    } catch (e: any) {
      console.log(`❌ Key #${i + 1} (${key.slice(0, 15)}...): ERROR (${Date.now() - start}ms) - ${e.message}`);
    }
  }
}

main();

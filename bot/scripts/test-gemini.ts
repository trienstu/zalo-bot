import { callGemini } from "../src/gemini.js";
import { config } from "../src/config.js";

async function main() {
  console.log("Đang kiểm tra kết nối Google Gemini API...");
  console.log(`Model: ${config.geminiModel}`);
  console.log(`Key prefix: ${config.geminiApiKey.slice(0, 10)}...`);

  try {
    const response = await callGemini(
      "Bạn là một trợ lý AI hữu ích.",
      "Xin chào Gemini, hãy trả lời 1 câu ngắn bằng tiếng Việt: Bạn đã sẵn sàng hỗ trợ tóm tắt chat Zalo chưa?",
      { temperature: 0.3 }
    );
    console.log("\n✅ KẾT QUẢ TỪ GEMINI:");
    console.log("-------------------");
    console.log(response);
    console.log("-------------------");
    console.log("🎉 Kết nối Gemini API thành công!");
  } catch (error) {
    console.error("\n❌ LỖI KHI GỌI GEMINI API:", error);
  }
}

main();

import { handleMemberInteraction } from "../src/member-assistant.js";

async function main() {
  console.log("=== TEST MEMBER ASSISTANT ===");

  const fakeApi = {
    // mock api
  };

  // Test /help
  console.log("\n1. Test /help:");
  await handleMemberInteraction({
    sendMessage: async (dest: any, text: string) => {
      console.log("[Bot Reply]:", text);
    },
  }, {
    threadId: "1913869945242410752",
    sender: "test_user_1",
    displayName: "Nguyễn Văn A",
    text: "/help",
  });

  // Test /top
  console.log("\n2. Test /top:");
  await handleMemberInteraction({
    sendMessage: async (dest: any, text: string) => {
      console.log("[Bot Reply]:", text);
    },
  }, {
    threadId: "1913869945242410752",
    sender: "test_user_2",
    displayName: "Trần Văn B",
    text: "/top",
  });

  // Test /hoi (Q&A from chat history with Gemini)
  console.log("\n3. Test /hoi (Hỏi về cách làm video AI hoặc mẹo BKT):");
  await handleMemberInteraction({
    sendMessage: async (dest: any, text: string) => {
      console.log("[Bot Reply]:", text);
    },
  }, {
    threadId: "1913869945242410752",
    sender: "test_user_3",
    displayName: "Lê Thị C",
    text: "/hoi Anh em có chia sẻ mẹo gì để bật kiếm tiền GA tránh bị hold không?",
  });

  // Test /hoi with an unknown topic (should politely decline based on strict rule)
  console.log("\n4. Test /hoi với chủ đề chưa từng thảo luận:");
  await handleMemberInteraction({
    sendMessage: async (dest: any, text: string) => {
      console.log("[Bot Reply]:", text);
    },
  }, {
    threadId: "1913869945242410752",
    sender: "test_user_4",
    displayName: "Phạm Văn D",
    text: "/hoi Công thức nấu phở bò gia truyền như thế nào?",
  });

  console.log("\n=== TEST COMPLETED ===");
}

main().catch(console.error);

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

  // Test 5: Hỏi ai nói nhiều nhất / Top tương tác
  // Test 5: Hỏi ai nói nhiều nhất / Top tương tác
  console.log("\n5. Test hỏi ai nói nhiều nhất:");
  await handleMemberInteraction({
    sendMessage: async (msgPayload: any, threadId: string) => {
      console.log("[Bot Reply to " + threadId + "]:\n", msgPayload?.msg ?? msgPayload);
    },
  }, {
    threadId: "1913869945242410752",
    sender: "test_user_5",
    displayName: "Viet Phuoc Tran",
    text: "@Sen Chúa ông nào nói nhiều nhất cái group này 😜",
  });

  // Test 6: Test /hoi chào em
  console.log("\n6. Test /hoi chào em:");
  await handleMemberInteraction({
    sendMessage: async (msgPayload: any, threadId: string) => {
      console.log("[Bot Reply to " + threadId + "]:\n", msgPayload?.msg ?? msgPayload);
    },
  }, {
    threadId: "1913869945242410752",
    sender: "member_tuan",
    displayName: "Tuân",
    text: "/hoi chào em",
  });

  // Test 7: Test @Sen Chúa ngáo
  console.log("\n7. Test @Sen Chúa ngáo:");
  await handleMemberInteraction({
    sendMessage: async (msgPayload: any, threadId: string) => {
      console.log("[Bot Reply to " + threadId + "]:\n", msgPayload?.msg ?? msgPayload);
    },
  }, {
    threadId: "1913869945242410752",
    sender: "member_trien",
    displayName: "Trien Nguyen",
    text: "@Sen Chúa ngáo",
  });

  // Test 8: Test /hoi mute 100 ngày
  console.log("\n8. Test /hoi mute 100 ngày:");
  await handleMemberInteraction({
    sendMessage: async (msgPayload: any, threadId: string) => {
      console.log("[Bot Reply to " + threadId + "]:\n", msgPayload?.msg ?? msgPayload);
    },
  }, {
    threadId: "1913869945242410752",
    sender: "member_tu",
    displayName: "Tu",
    text: "/hoi mute 100 ngày",
  });

  // Test 9: Test /hoi cách tăng 1 triệu view trong 1 đêm
  console.log("\n9. Test /hoi cách tăng 1 triệu view trong 1 đêm:");
  await handleMemberInteraction({
    sendMessage: async (msgPayload: any, threadId: string) => {
      console.log("[Bot Reply to " + threadId + "]:\n", msgPayload?.msg ?? msgPayload);
    },
  }, {
    threadId: "1913869945242410752",
    sender: "member_tu",
    displayName: "Tu",
    text: "/hoi cách tăng 1 triệu view trong 1 đêm",
  });

  // Test 10: Test /hoi làm thế nào để em thành stevejob Việt Nam
  console.log("\n10. Test /hoi làm thế nào để em thành stevejob Việt Nam:");
  await handleMemberInteraction({
    sendMessage: async (msgPayload: any, threadId: string) => {
      console.log("[Bot Reply to " + threadId + "]:\n", msgPayload?.msg ?? msgPayload);
    },
  }, {
    threadId: "1913869945242410752",
    sender: "member_tuan",
    displayName: "Tuân",
    text: "/hoi làm thế nào để em thành stevejob Việt Nam",
  });

  console.log("\n=== TEST COMPLETED ===");
}

main().catch(console.error);

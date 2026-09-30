import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "../config.js";
import { setBotState } from "../db/index.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

async function main() {
  console.log("==================================================================");
  console.log("🔐 HƯỚNG DẪN KẾT NỐI TÀI KHOẢN TELEGRAM (USERBOT / MTPROTO)");
  console.log("==================================================================");
  console.log("Lưu ý: Nếu chưa có API ID & API HASH, anh hãy vào: https://my.telegram.org");
  console.log("Đăng nhập số điện thoại -> Chọn 'API development tools' -> Tạo app để lấy.\n");

  let appId = config.telegramAppId || Number(process.env.TELEGRAM_APP_ID || 0);
  let appHash = config.telegramAppHash || process.env.TELEGRAM_APP_HASH || "";

  if (!appId) {
    const inputAppId = await ask("👉 Nhập TELEGRAM_APP_ID: ");
    appId = Number(inputAppId);
  }
  if (!appHash) {
    appHash = await ask("👉 Nhập TELEGRAM_APP_HASH: ");
  }

  if (!appId || !appHash) {
    console.error("❌ Thiếu App ID hoặc App Hash. Hủy đăng nhập.");
    rl.close();
    process.exit(1);
  }

  const stringSession = new StringSession("");
  const client = new TelegramClient(stringSession, appId, appHash, {
    connectionRetries: 5,
  });

  console.log("\n⏳ Đang kết nối tới máy chủ Telegram...");
  await client.start({
    phoneNumber: async () => await ask("👉 Nhập Số điện thoại Telegram của bạn (VD: +84912345678): "),
    password: async () => await ask("👉 Nhập Mật khẩu 2FA (nếu có đặt, không có thì Enter): "),
    phoneCode: async () => await ask("👉 Nhập Mã xác nhận (OTP) vừa gửi về Telegram: "),
    onError: (err) => console.error("❌ Lỗi Telegram:", err),
  });

  const sessionString = client.session.save() as unknown as string;
  const me = (await client.getMe()) as any;
  const fullName = [me.firstName, me.lastName].filter(Boolean).join(" ") || "Người dùng Telegram";

  console.log("\n==================================================================");
  console.log(`🎉 ĐĂNG NHẬP THÀNH CÔNG!`);
  console.log(`👤 Tài khoản: ${fullName} (@${me.username || "không có username"}) [ID: ${me.id}]`);
  console.log("==================================================================");

  // 1. Lưu vào Database
  setBotState("telegram_userbot_session", sessionString, Date.now());
  setBotState("telegram_userbot_status", "online", Date.now());

  // 2. Ghi tự động vào file .env
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");

    const updateOrAppend = (key: string, val: string) => {
      const reg = new RegExp(`^${key}=.*$`, "m");
      if (reg.test(envContent)) {
        envContent = envContent.replace(reg, `${key}=${val}`);
      } else {
        envContent += `\n${key}=${val}`;
      }
    };

    updateOrAppend("TELEGRAM_USERBOT_ENABLED", "true");
    updateOrAppend("TELEGRAM_APP_ID", String(appId));
    updateOrAppend("TELEGRAM_APP_HASH", appHash);
    updateOrAppend("TELEGRAM_SESSION_STRING", sessionString);

    fs.writeFileSync(envPath, envContent.trim() + "\n");
    console.log(`💾 Đã tự động cập nhật cấu hình và StringSession vào file: ${envPath}`);
  }

  console.log("\n✅ Hoàn tất! Từ nay Userbot sẽ tự động đăng nhập ngầm vĩnh viễn.");
  await client.disconnect();
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Sự cố khi đăng nhập Telegram:", err);
  rl.close();
  process.exit(1);
});

const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

function fromBotDir(value, fallback) {
  return path.resolve(__dirname, value || fallback);
}

const fs = require("node:fs");

const sessionDir = fromBotDir(process.env.SESSION_DIR, "data");
const dbPath = fromBotDir(process.env.SQLITE_DB_PATH, "data/bot.db");
const vipPath = fromBotDir(process.env.VIP_LIST_PATH, "data/vip-list.json");

const home = process.env.HOME || "/home/congtrien125";
const localBot2Dir = path.resolve(__dirname, "../data/bots/bot-2");
const vpsBot2Dir = path.resolve(home, "zalo-bot", "data", "bots", "bot-2");
const bot2Dir = fs.existsSync(localBot2Dir) ? localBot2Dir : vpsBot2Dir;
const bot2DbPath = path.resolve(bot2Dir, "bot.db");
const bot2SessionDir = bot2Dir;
const bot2VipPath = path.resolve(bot2Dir, "vip-list.json");

module.exports = {
  apps: [
    // === BOT 1 (Sen Chúa) - Cổng 3000 ===
    {
      name: "zalo-bot-1",
      script: "dist/index.js",
      args: "start",
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
        BOT_ID: "bot-1",
        PORT: "3000",
        WEB_PORT: "3000",
      },
    },
    {
      name: "zalo-web-1",
      script: "npm",
      args: "start -- -H 127.0.0.1 -p 3000",
      cwd: path.resolve(__dirname, "../web"),
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        WEB_PORT: "3000",
        WEB_QR_DIR: sessionDir,
        WEB_DB_PATH: dbPath,
        WEB_VIP_PATH: vipPath,
        BOT_ID: "bot-1",
        PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN || "",
      },
    },
  ],
};

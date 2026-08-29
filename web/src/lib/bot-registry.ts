import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface BotMetadata {
  id: string;
  name: string;
  avatarUrl?: string;
  zaloName?: string;
  zaloId?: string;
  isOnline: boolean;
  createdAt: number;
  dbPath: string;
  sessionDir: string;
  groupCount?: number;
  memberCount?: number;
}

function getDataRootDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "..", "bot", "data"),
    path.resolve(process.cwd(), "bot", "data"),
    path.resolve(process.cwd(), "..", "data"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), "..", "bot", "data");
}

export function getBotsDir(): string {
  const root = getDataRootDir();
  const botsDir = path.join(root, "bots");
  if (!fs.existsSync(botsDir)) {
    fs.mkdirSync(botsDir, { recursive: true });
  }
  return botsDir;
}

/**
 * Đọc thông tin chi tiết của 1 Bot theo botId
 */
export function getBotInfo(botId: string): BotMetadata | null {
  const root = getDataRootDir();
  const botsDir = getBotsDir();
  const specificBotDir = path.join(botsDir, botId);

  let targetDir = specificBotDir;
  let dbPath = path.join(specificBotDir, "bot.db");
  let sessionDir = path.join(specificBotDir, "session");

  // Nếu là bot-1 và chưa có thư mục riêng trong data/bots/bot-1, fallback về legacy data/
  if (botId === "bot-1" && !fs.existsSync(specificBotDir)) {
    targetDir = root;
    dbPath = path.join(root, "bot.db");
    sessionDir = path.join(root, "session");
  }

  if (!fs.existsSync(dbPath) && !fs.existsSync(targetDir)) {
    return null;
  }

  // Đọc file meta.json nếu có
  const metaPath = path.join(targetDir, "meta.json");
  let meta: Partial<BotMetadata> = {};
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {}
  }

  let zaloName = meta.zaloName || "";
  let zaloId = meta.zaloId || "";
  let avatarUrl = meta.avatarUrl || "";
  let groupCount = 0;
  let memberCount = 0;

  // Đọc thông tin từ SQLite database nếu file tồn tại
  if (fs.existsSync(dbPath)) {
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        const rowBotName = db.prepare("SELECT value FROM bot_state WHERE key = 'bot_display_name'").get() as { value: string } | undefined;
        if (rowBotName?.value && !zaloName) zaloName = rowBotName.value;

        const rowZaloId = db.prepare("SELECT value FROM bot_state WHERE key = 'bot_zalo_id'").get() as { value: string } | undefined;
        if (rowZaloId?.value && !zaloId) zaloId = rowZaloId.value;

        const rowAvatar = db.prepare("SELECT value FROM bot_state WHERE key = 'bot_avatar_url'").get() as { value: string } | undefined;
        if (rowAvatar?.value && !avatarUrl) avatarUrl = rowAvatar.value;

        const rowGroups = db.prepare("SELECT COUNT(*) AS total FROM group_settings").get() as { total: number } | undefined;
        groupCount = rowGroups?.total || 0;

        const rowMembers = db.prepare("SELECT COUNT(*) AS total FROM members WHERE is_active = 1").get() as { total: number } | undefined;
        memberCount = rowMembers?.total || 0;
      } catch {}
      db.close();
    } catch {}
  }

  // Kiểm tra trạng thái online: session.json tồn tại và có cookie
  const sessionFile = path.join(sessionDir, "session.json");
  const isOnline = fs.existsSync(sessionFile) && fs.statSync(sessionFile).size > 10;

  return {
    id: botId,
    name: meta.name || zaloName || (botId === "bot-1" ? "Bot 1 (Sen Chúa)" : `Bot ${botId.replace("bot-", "")}`),
    avatarUrl,
    zaloName: zaloName || meta.name || "Zalo Bot",
    zaloId,
    isOnline,
    createdAt: meta.createdAt || Date.now(),
    dbPath,
    sessionDir,
    groupCount,
    memberCount,
  };
}

/**
 * Lấy danh sách toàn bộ các Bot trong hệ thống
 */
export function listAllBots(): BotMetadata[] {
  const botsDir = getBotsDir();
  const root = getDataRootDir();
  const botMap = new Map<string, BotMetadata>();

  // 1. Luôn thêm bot-1 (Bot mặc định / Legacy)
  const defaultBot = getBotInfo("bot-1");
  if (defaultBot) {
    botMap.set("bot-1", defaultBot);
  } else {
    // Nếu chưa có file nào, tạo placeholder cho bot-1
    botMap.set("bot-1", {
      id: "bot-1",
      name: "Bot 1 (Sen Chúa)",
      isOnline: false,
      createdAt: Date.now(),
      dbPath: path.join(root, "bot.db"),
      sessionDir: path.join(root, "session"),
      groupCount: 0,
      memberCount: 0,
    });
  }

  // 2. Quét các thư mục con trong data/bots/
  if (fs.existsSync(botsDir)) {
    const entries = fs.readdirSync(botsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory() && !ent.name.startsWith(".")) {
        const info = getBotInfo(ent.name);
        if (info) {
          botMap.set(ent.name, info);
        }
      }
    }
  }

  return Array.from(botMap.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Tạo mới một Bot trong hệ thống
 */
export function createNewBot(name: string): BotMetadata {
  const botsDir = getBotsDir();
  const allBots = listAllBots();
  
  // Tạo botId dạng bot-2, bot-3...
  let nextNum = 2;
  while (allBots.some((b) => b.id === `bot-${nextNum}`)) {
    nextNum++;
  }
  const newBotId = `bot-${nextNum}`;
  const newBotDir = path.join(botsDir, newBotId);
  const newSessionDir = path.join(newBotDir, "session");

  fs.mkdirSync(newBotDir, { recursive: true });
  fs.mkdirSync(newSessionDir, { recursive: true });

  const metadata: BotMetadata = {
    id: newBotId,
    name: name.trim() || `Bot ${nextNum}`,
    isOnline: false,
    createdAt: Date.now(),
    dbPath: path.join(newBotDir, "bot.db"),
    sessionDir: newSessionDir,
    groupCount: 0,
    memberCount: 0,
  };

  fs.writeFileSync(path.join(newBotDir, "meta.json"), JSON.stringify(metadata, null, 2), "utf8");
  return metadata;
}

/**
 * Cập nhật tên hoặc metadata của bot
 */
export function updateBotMeta(botId: string, data: Partial<BotMetadata>): BotMetadata | null {
  const info = getBotInfo(botId);
  if (!info) return null;

  const botsDir = getBotsDir();
  const botDir = path.join(botsDir, botId);
  if (!fs.existsSync(botDir)) {
    fs.mkdirSync(botDir, { recursive: true });
  }

  const updated: BotMetadata = {
    ...info,
    ...data,
  };

  fs.writeFileSync(path.join(botDir, "meta.json"), JSON.stringify(updated, null, 2), "utf8");
  return updated;
}

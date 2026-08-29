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

function getAllCandidateRoots(): string[] {
  return [
    path.resolve(process.cwd(), "..", "data"),
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "bot", "data"),
    path.resolve(process.cwd(), "..", "bot", "data"),
  ];
}

function getDataRootDir(): string {
  const candidates = getAllCandidateRoots();
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), "..", "data");
}

export function getBotsDir(): string {
  const candidates = getAllCandidateRoots();
  for (const c of candidates) {
    const b = path.join(c, "bots");
    if (fs.existsSync(b)) return b;
  }
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
  const candidateRoots = getAllCandidateRoots();
  let targetDir = "";
  let dbPath = "";
  let sessionDir = "";

  if (botId !== "bot-1") {
    // 1. Tìm dbPath thật sự tồn tại
    for (const root of candidateRoots) {
      const bDir = path.join(root, "bots", botId);
      const dbCandidates = [
        path.join(bDir, "bot.db"),
        path.join(bDir, "data", "bot.db"),
        path.join(bDir, "bot", "data", "bot.db"),
      ];
      const foundDb =
        dbCandidates.find((p) => fs.existsSync(p) && fs.statSync(p).size > 0) ||
        dbCandidates.find((p) => fs.existsSync(p));
      if (foundDb) {
        dbPath = foundDb;
        targetDir = bDir;
        break;
      }
    }

    // 2. Tìm sessionDir thật sự tồn tại
    for (const root of candidateRoots) {
      const bDir = path.join(root, "bots", botId);
      const sessionCandidates = [
        path.join(bDir, "session"),
        bDir,
        path.join(bDir, "data"),
        path.join(bDir, "bot", "data"),
      ];
      const foundSession = sessionCandidates.find((p) => fs.existsSync(path.join(p, "session.json")));
      if (foundSession) {
        sessionDir = foundSession;
        break;
      }
    }

    if (!targetDir && candidateRoots[0]) {
      targetDir = path.join(candidateRoots[0], "bots", botId);
    }
    if (!dbPath && targetDir) {
      dbPath = path.join(targetDir, "bot.db");
    }
    if (!sessionDir && targetDir) {
      sessionDir = path.join(targetDir, "session");
    }
  } else {
    // bot-1
    for (const root of candidateRoots) {
      const bDir = path.join(root, "bots", "bot-1");
      const dbCandidates = [
        path.join(bDir, "bot.db"),
        path.join(root, "bot.db"),
      ];
      const foundDb = dbCandidates.find((p) => fs.existsSync(p));
      if (foundDb) {
        dbPath = foundDb;
        targetDir = path.dirname(foundDb);
        sessionDir = fs.existsSync(path.join(targetDir, "session")) ? path.join(targetDir, "session") : targetDir;
        break;
      }
    }
  }

  if (!targetDir) {
    targetDir = path.join(getDataRootDir(), "bots", botId);
    dbPath = path.join(targetDir, "bot.db");
    sessionDir = path.join(targetDir, "session");
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

        try {
          const rowGroups = db.prepare("SELECT COUNT(*) AS total FROM bot_groups").get() as { total: number } | undefined;
          if (rowGroups && rowGroups.total > 0) {
            groupCount = rowGroups.total;
          } else {
            const rowLegacy = db.prepare("SELECT COUNT(*) AS total FROM group_settings").get() as { total: number } | undefined;
            groupCount = rowLegacy?.total || 0;
          }
        } catch {
          const rowLegacy = db.prepare("SELECT COUNT(*) AS total FROM group_settings").get() as { total: number } | undefined;
          groupCount = rowLegacy?.total || 0;
        }

        const rowMembers = db.prepare("SELECT COUNT(*) AS total FROM members WHERE is_active = 1").get() as { total: number } | undefined;
        memberCount = rowMembers?.total || 0;
      } catch {}
      db.close();
    } catch {}
  }

  // Kiểm tra trạng thái online: session.json tồn tại và có cookie
  const sessionCandidates = [
    path.join(sessionDir, "session.json"),
    path.join(targetDir, "session.json"),
    path.join(targetDir, "session", "session.json"),
    path.join(targetDir, "data", "session.json"),
  ];
  let isOnline = false;
  for (const sf of sessionCandidates) {
    if (fs.existsSync(sf) && fs.statSync(sf).size > 10) {
      isOnline = true;
      break;
    }
  }

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
  const candidateRoots = getAllCandidateRoots();
  const botMap = new Map<string, BotMetadata>();

  // 1. Luôn thêm bot-1 (Bot mặc định / Legacy)
  const defaultBot = getBotInfo("bot-1");
  if (defaultBot) {
    botMap.set("bot-1", defaultBot);
  }

  // 2. Quét các thư mục con trong data/bots/ ở mọi candidate roots
  for (const root of candidateRoots) {
    const botsDir = path.join(root, "bots");
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
  }

  if (botMap.size === 0) {
    botMap.set("bot-1", {
      id: "bot-1",
      name: "Bot 1 (Sen Chúa)",
      isOnline: false,
      createdAt: Date.now(),
      dbPath: path.join(getDataRootDir(), "bot.db"),
      sessionDir: getDataRootDir(),
      groupCount: 0,
      memberCount: 0,
    });
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

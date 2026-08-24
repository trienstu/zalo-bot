import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isOriginAllowed } from "@/lib/http";

const BOT_DIR = path.resolve(process.cwd(), "..", "bot");
const BOT_ENV_PATH = path.join(BOT_DIR, ".env");
const DATA_DIR = path.join(BOT_DIR, "data");

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      result[key] = val;
    }
  }
  return result;
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      message?: string;
      groupId?: string;
    };

    const text = String(body.message || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Nội dung tin nhắn không được rỗng" }, { status: 400 });
    }

    let env: Record<string, string> = {};
    if (fs.existsSync(BOT_ENV_PATH)) {
      env = parseEnvFile(fs.readFileSync(BOT_ENV_PATH, "utf8"));
    }
    const groupId = body.groupId || env.SUMMARY_GROUP_ID || env.GROUP_ID || "";

    if (!groupId) {
      return NextResponse.json({ error: "Chưa cấu hình GROUP_ID của nhóm nhận tin" }, { status: 400 });
    }

    const requestId = `web_send_${Date.now()}`;
    const sendReqPath = path.join(DATA_DIR, "summary-send-request.json");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      sendReqPath,
      JSON.stringify({
        requestId,
        parts: [text],
        groupId,
        requestedAt: Date.now(),
        requestedBy: "web_admin",
      }),
      "utf8",
    );

    return NextResponse.json({ ok: true, message: "Đã chuyển yêu cầu gửi tin đến Bot Worker" });
  } catch (e) {
    console.error("[api/summaries/send]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lỗi khi gửi tin nhắn" },
      { status: 500 },
    );
  }
}

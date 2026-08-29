import { NextResponse } from "next/server";
import { listAllBots, createNewBot, updateBotMeta, getBotInfo } from "@/lib/bot-registry";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const activeBotId = cookieStore.get("active_bot_id")?.value || "bot-1";
    const bots = listAllBots();

    return NextResponse.json({
      bots,
      activeBotId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Không thể lấy danh sách bot: " + String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = (body.name || "").trim();

    if (!name) {
      return NextResponse.json(
        { error: "Tên bot không được để trống" },
        { status: 400 }
      );
    }

    const newBot = createNewBot(name);
    return NextResponse.json({
      success: true,
      bot: newBot,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Lỗi tạo bot mới: " + String(err) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, name } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Thiếu ID của bot cần cập nhật" },
        { status: 400 }
      );
    }

    const updated = updateBotMeta(id, { name });
    if (!updated) {
      return NextResponse.json(
        { error: "Không tìm thấy bot có ID: " + id },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      bot: updated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Lỗi cập nhật bot: " + String(err) },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { isOriginAllowed } from "@/lib/http";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

function getGeminiApiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.split(",")[0]?.trim() || "";

  const envPaths = [
    path.resolve(process.cwd(), "..", "bot", ".env"),
    path.resolve(process.cwd(), "bot", ".env"),
    path.resolve(process.cwd(), ".env"),
  ];

  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf8");
      const match = content.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)/);
      if (match && match[1]) {
        return match[1].split(",")[0]?.trim() || "";
      }
    }
  }
  return "";
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      rawContent?: string;
      recipientName?: string;
      gender?: number; // 0: Nữ, 1: Nam, -1: Chưa rõ
      phone?: string;
      sdob?: string;
    };

    const rawContent = body.rawContent?.trim() || "";
    if (!rawContent) {
      return NextResponse.json({ ok: false, error: "Thiếu nội dung tin nhắn" }, { status: 400 });
    }

    const recipientName = body.recipientName?.trim() || "Nguyễn Văn A";
    const gender = typeof body.gender === "number" ? body.gender : 1;
    const phone = body.phone?.trim() || "0912345678";
    const sdob = body.sdob?.trim() || "";

    let pronoun = "Anh/Chị";
    if (gender === 1) pronoun = "Anh";
    else if (gender === 0) pronoun = "Chị";

    if (sdob && sdob.includes("/")) {
      const parts = sdob.split("/");
      if (parts.length === 3 && parts[2]) {
        const year = parseInt(parts[2], 10);
        const currentYear = new Date().getFullYear();
        if (!isNaN(year) && year > 1940 && year <= currentYear) {
          const age = currentYear - year;
          if (age >= 55) {
            pronoun = gender === 1 ? "Bác" : "Cô";
          }
        }
      }
    }

    const fallbackText = rawContent
      .replace(/\{name\}/gi, recipientName)
      .replace(/\{gender_call\}/gi, pronoun)
      .replace(/\{phone\}/gi, phone)
      .replace(/\{sdob\}/gi, sdob);

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      return NextResponse.json({
        ok: true,
        personalizedText: fallbackText,
        source: "fallback_no_api_key",
      });
    }

    const systemPrompt = `Bạn là trợ lý marketing chuyên nghiệp, khéo léo và tự nhiên.
Nhiệm vụ: Cá nhân hóa tin nhắn gửi khách hàng qua Zalo dựa trên tin nhắn gốc.

CÁC NGUYÊN TẮC BẮT BUỘC:
1. TUYỆT ĐỐI BẢO TOÀN NGUYÊN VẸN 100%: Mọi đường link (URL), số điện thoại liên hệ, mã ưu đãi, tên dự án/sản phẩm và giá trị cốt lõi từ tin nhắn gốc.
2. XƯNG HÔ CHUẨN XÁC: Gọi người nhận là "${pronoun} ${recipientName}". Giữ thái độ lịch thiệp, tôn trọng, chân thành.
3. BIẾN THỂ TỰ NHIÊN (ANTI-SPAM): Thay đổi linh hoạt lời chào, cách mở đầu hoặc đảo câu nhẹ nhàng, thêm icon/emoji sinh động để mỗi tin nhắn là một phiên bản độc nhất, không bị hệ thống chống spam của Zalo đánh dấu tin rác.
4. ĐỊNH DẠNG: Chỉ trả về nội dung tin nhắn hoàn chỉnh để gửi thẳng cho khách hàng. Không thêm tiêu đề, không thêm ghi chú, không thêm dấu ngoặc kép bọc ngoài.`;

    const userPrompt = `Dữ liệu khách hàng:
- Họ tên: ${recipientName}
- Xưng hô: ${pronoun}
- Số điện thoại: ${phone}
${sdob ? `- Ngày sinh: ${sdob}` : ""}

Tin nhắn gốc cần gửi:
---
${rawContent}
---`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000,
      },
    };

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (resp.ok) {
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text && text.length > 10) {
        return NextResponse.json({
          ok: true,
          personalizedText: text,
          source: "gemini_flash_lite",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      personalizedText: fallbackText,
      source: "fallback",
    });
  } catch (err: any) {
    console.error("[api/zalomkt/preview-ai] error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { isOriginAllowed } from "@/lib/http";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

function getUploadDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "..", "bot", "data", "zalomkt-uploads"),
    path.resolve(process.cwd(), "bot", "data", "zalomkt-uploads"),
    path.resolve(process.cwd(), "data", "zalomkt-uploads"),
  ];

  for (const d of candidates) {
    if (fs.existsSync(path.dirname(d))) {
      fs.mkdirSync(d, { recursive: true });
      return d;
    }
  }

  const fallback = path.resolve(process.cwd(), "..", "bot", "data", "zalomkt-uploads");
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

export async function POST(request: Request) {
  if (!isOriginAllowed(request)) {
    return NextResponse.json({ error: "Origin không hợp lệ" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ ok: false, error: "Không tìm thấy file tải lên" }, { status: 400 });
    }

    const uploadDir = getUploadDir();
    const uploadedPaths: string[] = [];

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = path.extname(file.name) || ".jpg";
      const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
      const filePath = path.join(uploadDir, filename);

      fs.writeFileSync(filePath, buffer);
      uploadedPaths.push(filePath);
    }

    return NextResponse.json({
      ok: true,
      files: uploadedPaths,
    });
  } catch (err: any) {
    console.error("[api/zalomkt/upload] error:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

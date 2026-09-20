#!/usr/bin/env node
/**
 * Dual-Layer Code Review Tool
 * Combines GitNexus (Graph & Architecture Impact) with Alibaba OpenCodeReview (Line-level Defect Inspection)
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1] || "both";
const isPreviewOnly = args.includes("--preview") || args.includes("-p");
const commitArg = args.find((a) => a.startsWith("--commit="))?.split("=")[1];

console.log("\n" + "=".repeat(70));
console.log("🚀 DUAL-LAYER CODE REVIEW PIPELINE (GitNexus + Alibaba OpenCodeReview)");
console.log("=".repeat(70) + "\n");

// ==========================================
// TẦNG 1: GitNexus - Graph & Architecture Impact
// ==========================================
if (modeArg === "both" || modeArg === "graph") {
  console.log("📍 [TẦNG 1] GitNexus — Phân tích đồ thị & Tầm ảnh hưởng kiến trúc...");
  const gitnexusRunner = path.join(rootDir, ".gitnexus", "run.cjs");
  if (fs.existsSync(gitnexusRunner)) {
    const scope = commitArg ? "all" : "all";
    const res = spawnSync("node", [gitnexusRunner, "detect-changes", "--scope", scope, "--repo", rootDir], {
      cwd: rootDir,
      stdio: "inherit",
    });
    if (res.status !== 0) {
      console.warn("⚠️ GitNexus detect-changes cảnh báo hoặc kết thúc với mã:", res.status);
    }
  } else {
    console.log("ℹ️ Không tìm thấy .gitnexus/run.cjs. Bỏ qua bước kiểm tra graph.");
  }
}

// ==========================================
// TẦNG 2: Alibaba OpenCodeReview - Line-Level Defect Inspection
// ==========================================
if (modeArg === "both" || modeArg === "ocr") {
  console.log("\n" + "-".repeat(70));
  console.log("📍 [TẦNG 2] Alibaba OpenCodeReview — Soi lỗi dòng mã & Quy tắc chất lượng...");
  console.log("-".repeat(70));

  // 1. Luôn preview danh sách file thay đổi và phân loại
  console.log("\n📋 Danh sách file thay đổi & phân nhóm review (OCR Delegation Preview):");
  spawnSync("npx", ["-y", "@alibaba-group/open-code-review", "delegate", "preview"], {
    cwd: rootDir,
    stdio: "inherit",
  });

  // 2. Chạy review nếu không phải chế độ preview-only
  if (!isPreviewOnly) {
    const ocrArgs = ["-y", "@alibaba-group/open-code-review", "review"];
    if (commitArg) {
      ocrArgs.push("-c", commitArg);
    }
    // Chạy review với output text
    console.log("\n🔍 Đang kích hoạt OCR Review...");
    const reviewRes = spawnSync("npx", ocrArgs, {
      cwd: rootDir,
      stdio: "inherit",
    });
    if (reviewRes.status !== 0) {
      console.log("\n💡 Mẹo: Nếu OCR review cần cấu hình thêm API key hoặc model, bạn có thể chạy:");
      console.log("   npx @alibaba-group/open-code-review config provider");
      console.log("   hoặc dùng Delegation Mode để AI Agent tự áp dụng bộ rules Alibaba.");
    }
  }
}

console.log("\n" + "=".repeat(70));
console.log("✅ HOÀN TẤT DUAL-LAYER CODE REVIEW");
console.log("=".repeat(70) + "\n");

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **zalo-bot** (4345 symbols, 10609 relationships, 350 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/zalo-bot/context` | Codebase overview, check index freshness |
| `gitnexus://repo/zalo-bot/clusters` | All functional areas |
| `gitnexus://repo/zalo-bot/processes` | All execution flows |
| `gitnexus://repo/zalo-bot/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# Quy Trình Code Review 2 Tầng (Dual-Layer Code Review)

Dự án áp dụng quy trình kiểm tra chất lượng mã nguồn 2 tầng kết hợp:
1. **Tầng 1 - GitNexus (Kiến trúc & Đồ thị)**: Chạy `npm run review:graph` (hoặc MCP `detect_changes`). Phân tích blast radius, phát hiện đứt gãy quan hệ execution flow và cảnh báo rủi ro vĩ mô trước khi commit.
2. **Tầng 2 - Alibaba OpenCodeReview (Dòng mã & Lỗi logic/Bảo mật)**: Chạy `npm run review:ocr` (hoặc script `npm run review`). Áp dụng bộ quy tắc deterministic của Alibaba kết hợp LLM để soi lỗi chi tiết: Null safety, race condition, async leak, security (XSS/SQLi), React/TS standards.
- **Lệnh chạy toàn diện cả 2 tầng**: `npm run review` (hoặc xem trước với `npm run review:preview`).


# Quy Tắc Cập Nhật & Triển Khai (Deployment Rules)

- **LUÔN CẬP NHẬT ĐỒNG THỜI CẢ 2 BOT**: Trên VPS Oracle Cloud (`140.245.107.184`, User `ubuntu`, cấu hình ARM 6GB RAM), hệ thống chạy mô hình 2 bot độc lập cùng gateway:
  - Bot 1 (`zalo-bot-1`, `zalo-web-1`): thư mục `~/zalo-bot`
  - Bot 2 (`zalo-bot-2`, `zalo-web-2`): thư mục `~/zalo-bot-2`
  - Gateway & Router: `hermes-gateway`, `9router`

- **KẾT NỐI & TỰ ĐỘNG TRIỂN KHAI TRỰC TIẾP QUA SSH**:
  - SSH alias `zalo-oracle` đã được cấu hình trong `~/.ssh/config` (dùng key `~/Downloads/ssh-key-2026-09-19.key`, user `ubuntu`).
  - Khi người dùng yêu cầu deploy/cập nhật lên VPS, Agent có thể trực tiếp thực thi lệnh qua SSH (`ssh zalo-oracle "..."`) để cập nhật cả 2 bot tự động.

- **KHI CHỈ CẬP NHẬT BOT BACKEND (Không đổi web)**:
  - Lệnh đồng bộ cả 2 bot:
    ```bash
    (cd ~/zalo-bot && git pull origin main && npm run build --prefix bot) && (cd ~/zalo-bot-2 && git pull origin main && npm run build --prefix bot) && pm2 restart zalo-bot-1 zalo-bot-2
    ```
    *(hoặc `pm2 restart all` nếu cần khởi động lại toàn bộ dịch vụ)*.

- **KHI CẬP NHẬT PHẦN WEB (DASHBOARD & HUB)**:
  - Trên VPS Oracle (6GB RAM dồi dào), có thể build trực tiếp trên VPS hoặc giải nén bản build siêu tốc:
    - **Phương án Siêu tốc (Khuyên dùng)**: Build tại local máy Mac (`npm run build --prefix web`), nén `tar --exclude='.next/cache' -czf web/next-build.tar.gz -C web .next`, commit/push lên GitHub và giải nén trên VPS:
      ```bash
      (cd ~/zalo-bot && git pull origin main && tar -xzf web/next-build.tar.gz -C web) && (cd ~/zalo-bot-2 && git pull origin main && tar -xzf web/next-build.tar.gz -C web) && pm2 restart zalo-web-1 zalo-web-2
      ```
    - **Phương án Build trực tiếp trên VPS**:
      ```bash
      (cd ~/zalo-bot && git pull origin main && npm run build --prefix web) && (cd ~/zalo-bot-2 && git pull origin main && npm run build --prefix web) && pm2 restart zalo-web-1 zalo-web-2
      ```

# Nguyên Tắc Thiết Kế & Sửa Lỗi Đa Lĩnh Vực (Universal Fix & Anti-Overfitting Rules)

- **TỔNG QUÁT HÓA MỌI GIẢI PHÁP (GENERALIZATION OVER OVERFITTING)**:
  - Bot là trợ lý đa năng phục vụ người dùng ở **TẤT CẢ các lĩnh vực** (thể thao, pháp luật, tài chính, chứng khoán, xe cộ, công nghệ, y tế, giáo dục, đời sống, khoa học...).
  - Khi sửa một lỗi (fix bug) hoặc xử lý một tình huống cụ thể (edge case), **BẮT BUỘC** phải phân tích bản chất gốc rễ của vấn đề và tìm giải pháp mang tính hệ thống, trừu tượng hóa để **TẤT CẢ các trường hợp tương tự ở mọi lĩnh vực khác cũng được tự động giải quyết đồng bộ**.
  - **TUYỆT ĐỐI KHÔNG tự tiện thêm một rule chỉ để phục vụ cho 1 câu hỏi cá biệt**:
    - CẤM hardcode điều kiện, từ khóa hay prompt chỉ nhắm tới một trận đấu, một cá nhân, một sự kiện cụ thể.
    - CẤM can thiệp thô bạo (ad-hoc patches) làm phình to hoặc méo mó prompt, gây xung đột logic và làm sai lệch hành vi của bot ở các lĩnh vực khác.
  - **NGUYÊN TẮC THIẾT KẾ CORE**: Mọi logic về tìm kiếm thời gian thực (Search/RSS), trích xuất thông tin, định tuyến công cụ (Tool Routing), lập kế hoạch truy vấn (Query Planner) và cấu trúc câu trả lời (System Prompt) phải luôn là các khuôn mẫu chuẩn (standardized patterns), nhất quán, có thể tái sử dụng và hoạt động chính xác trên toàn bộ phạm vi tri thức.

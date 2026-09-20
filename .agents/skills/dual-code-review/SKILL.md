---
name: dual-code-review
description: Run dual-layer code review combining GitNexus (graph architecture & blast radius impact) and Alibaba OpenCodeReview (line-level quality, security, and logic defects).
---

# Dual-Layer Code Review Skill (GitNexus + Alibaba OpenCodeReview)

Use this skill whenever the user asks to review code, check code quality, analyze pull request/commit diffs, or ensure system safety before deployment.

## Two-Layer Review Concept

1. **Layer 1: GitNexus (Macro Architecture & Call Graph Impact)**
   - Checks blast radius: what functions, classes, and execution flows are affected.
   - Detects graph-level breakage, circular dependencies, and high/critical risk routes.
   - Command: `node .gitnexus/run.cjs detect-changes --scope all --repo .` or MCP `detect_changes({scope: "all"})`.

2. **Layer 2: Alibaba OpenCodeReview (Micro Line-Level Quality & Security)**
   - Uses Alibaba's battle-tested multi-language deterministic rules + LLM reasoning.
   - Inspects for:
     - Null pointer / undefined property access.
     - Unhandled Promise rejection / async loop anti-patterns.
     - Security vulnerabilities (XSS, SQL injection, API key leaks).
     - React Hooks, state management, and memory leaks.
     - TypeScript `any` abuses and typing inconsistencies.
   - Command: `npx -y @alibaba-group/open-code-review review` or preview via `npx -y @alibaba-group/open-code-review delegate preview`.

## Running Dual Review

From project root:
```bash
# Run both layers
npm run review

# Preview changed files & impacted graph without calling LLM
npm run review:preview

# Scan entire codebase (audit mode)
npm run review:scan
```

## Review Output Format

When reporting review results to the user, always structure the report into:
1. **Kiến trúc & Tác động (GitNexus Graph Health)**: Số lượng symbol thay đổi, execution flow bị ảnh hưởng, mức độ rủi ro (LOW / MEDIUM / HIGH / CRITICAL).
2. **Chất lượng mã nguồn & Lỗ hổng (Alibaba OCR Findings)**: Các lỗi chi tiết theo dòng mã, phân loại theo Severity (Blocker / Bug / Warning / Suggestion).
3. **Kết luận & Hành động đề xuất**: Có an toàn để commit/deploy không, và những điểm cần fix ngay.

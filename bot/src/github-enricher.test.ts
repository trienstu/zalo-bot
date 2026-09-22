import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractGithubRepoUrls,
  formatZaloRepoCard,
  hasVietnameseDiacritics,
} from "./github-enricher.js";
import {
  saveGroupRepo,
  getGroupRepos,
  isRepoRecentlyShared,
  type GroupRepoItem,
} from "./db/index.js";

test("extractGithubRepoUrls trích xuất chính xác repo hợp lệ và loại trừ các trang hệ thống", () => {
  const text = `
    Anh em tham khảo repo này nhé https://github.com/astral-sh/uv cực hay!
    Hoặc https://github.com/modelcontextprotocol/servers.git nữa.
    Đừng bấm vào https://github.com/trending hay https://github.com/features nha.
    Trùng lặp: https://github.com/astral-sh/uv/
  `;

  const results = extractGithubRepoUrls(text);
  assert.equal(results.length, 2);
  assert.equal(results[0]?.fullName, "astral-sh/uv");
  assert.equal(results[0]?.url, "https://github.com/astral-sh/uv");
  assert.equal(results[1]?.fullName, "modelcontextprotocol/servers");
});

test("formatZaloRepoCard định dạng thẻ Zalo chuẩn, tinh gọn và rõ ràng", () => {
  const sampleItem: GroupRepoItem = {
    thread_id: "test_thread_123",
    repo_url: "https://github.com/anthropics/anthropic-quickstarts",
    owner: "anthropics",
    repo_name: "anthropic-quickstarts",
    full_name: "anthropics/anthropic-quickstarts",
    description: "A collection of projects designed to help developers build with Claude.",
    stars: 5400,
    forks: 800,
    language: "Python",
    category: "🤖 AI & Agents",
    summary_vi: "Bộ sưu tập dự án mẫu giúp lập trình viên nhanh chóng tích hợp Claude API và AI Agents.",
    target_audience: "AI Developers & Kỹ sư phần mềm",
    shared_by_uid: "uid_456",
    shared_by_name: "Johnny",
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  const card = formatZaloRepoCard(sampleItem);
  assert.ok(card.includes("anthropics/anthropic-quickstarts"));
  assert.ok(card.includes("★ 5.4k • Python"));
  assert.ok(card.includes("🤖 AI & Agents"));
  assert.ok(card.includes("Bộ sưu tập dự án mẫu"));
  assert.ok(card.includes("Kho Repo của nhóm"));
});

test("Database lưu trữ và truy vấn group_repos chuẩn xác", () => {
  const testThread = "test_thread_repo_db";
  const now = Date.now();

  const repoA: GroupRepoItem = {
    thread_id: testThread,
    repo_url: "https://github.com/test-org/repo-ai",
    owner: "test-org",
    repo_name: "repo-ai",
    full_name: "test-org/repo-ai",
    description: "An AI project for testing",
    stars: 1200,
    forks: 150,
    language: "TypeScript",
    category: "🤖 AI & Agents",
    summary_vi: "Dự án AI kiểm thử.",
    target_audience: "Tester",
    shared_by_uid: "tester_1",
    shared_by_name: "Tester One",
    created_at: now,
    updated_at: now,
  };

  const repoB: GroupRepoItem = {
    thread_id: testThread,
    repo_url: "https://github.com/test-org/repo-tools",
    owner: "test-org",
    repo_name: "repo-tools",
    full_name: "test-org/repo-tools",
    description: "A CLI tool",
    stars: 350,
    forks: 20,
    language: "Rust",
    category: "🛠️ Dev Tools & CLI",
    summary_vi: "Công cụ dòng lệnh.",
    target_audience: "DevOps",
    shared_by_uid: "tester_2",
    shared_by_name: "Tester Two",
    created_at: now + 100,
    updated_at: now + 100,
  };

  saveGroupRepo(repoA);
  saveGroupRepo(repoB);

  // Kiểm tra anti-spam
  assert.equal(isRepoRecentlyShared(testThread, "test-org/repo-ai", 60000), true);
  assert.equal(isRepoRecentlyShared(testThread, "non-existent/repo", 60000), false);

  // Lấy tất cả
  const allRepos = getGroupRepos({ threadId: testThread });
  assert.ok(allRepos.length >= 2);

  // Lọc theo category
  const aiRepos = getGroupRepos({ threadId: testThread, category: "🤖 AI & Agents" });
  assert.equal(aiRepos.length, 1);
  assert.equal(aiRepos[0]?.full_name, "test-org/repo-ai");

  // Tìm kiếm theo từ khóa
  const searched = getGroupRepos({ threadId: testThread, query: "CLI" });
  assert.equal(searched.length, 1);
  assert.equal(searched[0]?.full_name, "test-org/repo-tools");
});

test("hasVietnameseDiacritics nhận diện chuẩn xác chuỗi tiếng Việt và tiếng Anh", () => {
  assert.equal(hasVietnameseDiacritics("Công cụ mã nguồn mở hữu ích"), true);
  assert.equal(hasVietnameseDiacritics("Cross-platform local MCP capabilities for ChatGPT"), false);
  assert.equal(hasVietnameseDiacritics("f.k.a. Awesome ChatGPT Prompts"), false);
  assert.equal(hasVietnameseDiacritics("Trợ lý ảo AI thông minh"), true);
});


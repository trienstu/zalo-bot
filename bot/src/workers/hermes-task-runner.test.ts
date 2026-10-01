import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHermesTaskCommand,
  getHermesTaskStatus,
  getRecentHermesTasks,
} from "./hermes-task-runner.js";

test("parseHermesTaskCommand parses standard /tasks prompt", () => {
  const res1 = parseHermesTaskCommand("/tasks tạo 18 ảnh minh họa về an toàn giao thông");
  assert.equal(res1.isTask, true);
  assert.equal(res1.subCommand, undefined);
  assert.equal(res1.taskPrompt, "tạo 18 ảnh minh họa về an toàn giao thông");

  const res2 = parseHermesTaskCommand("!task cào dữ liệu giá vàng");
  assert.equal(res2.isTask, true);
  assert.equal(res2.subCommand, undefined);
  assert.equal(res2.taskPrompt, "cào dữ liệu giá vàng");
});

test("parseHermesTaskCommand recognizes status and check subcommands", () => {
  const res1 = parseHermesTaskCommand("/tasks status");
  assert.equal(res1.isTask, true);
  assert.equal(res1.subCommand, "status");
  assert.equal(res1.taskPrompt, "");

  const res2 = parseHermesTaskCommand("/task check");
  assert.equal(res2.isTask, true);
  assert.equal(res2.subCommand, "status");

  const res3 = parseHermesTaskCommand("/tasks info");
  assert.equal(res3.isTask, true);
  assert.equal(res3.subCommand, "status");
});

test("parseHermesTaskCommand recognizes list and recent subcommands", () => {
  const res1 = parseHermesTaskCommand("/tasks list");
  assert.equal(res1.isTask, true);
  assert.equal(res1.subCommand, "list");
  assert.equal(res1.taskPrompt, "");

  const res2 = parseHermesTaskCommand("/task recent");
  assert.equal(res2.isTask, true);
  assert.equal(res2.subCommand, "list");

  const res3 = parseHermesTaskCommand("/tasks history");
  assert.equal(res3.isTask, true);
  assert.equal(res3.subCommand, "list");
});

test("parseHermesTaskCommand recognizes natural language status queries", () => {
  const res1 = parseHermesTaskCommand("kiểm tra trạng thái tác vụ");
  assert.equal(res1.isTask, true);
  assert.equal(res1.subCommand, "status");

  const res2 = parseHermesTaskCommand("đang chạy tác vụ gì thế");
  assert.equal(res2.isTask, true);
  assert.equal(res2.subCommand, "status");

  const res3 = parseHermesTaskCommand("tiến độ tác vụ nãy giờ tới đâu rồi?");
  assert.equal(res3.isTask, true);
  assert.equal(res3.subCommand, "status");
});

test("parseHermesTaskCommand recognizes natural language list queries", () => {
  const res1 = parseHermesTaskCommand("xem lịch sử tác vụ hôm nay");
  assert.equal(res1.isTask, true);
  assert.equal(res1.subCommand, "list");

  const res2 = parseHermesTaskCommand("danh sách các tác vụ gần đây");
  assert.equal(res2.isTask, true);
  assert.equal(res2.subCommand, "list");
});

test("parseHermesTaskCommand rejects non-task messages", () => {
  const res1 = parseHermesTaskCommand("hôm nay thời tiết thế nào");
  assert.equal(res1.isTask, false);
  assert.equal(res1.taskPrompt, "");

  const res2 = parseHermesTaskCommand("/help");
  assert.equal(res2.isTask, false);
});

test("getHermesTaskStatus returns safe defaults when state.db path is absent", () => {
  const status = getHermesTaskStatus();
  assert.equal(typeof status.isRunning, "boolean");
  assert.equal(typeof status.activeAgents, "number");
});

test("getRecentHermesTasks returns array safely", () => {
  const tasks = getRecentHermesTasks(5);
  assert.equal(Array.isArray(tasks), true);
});

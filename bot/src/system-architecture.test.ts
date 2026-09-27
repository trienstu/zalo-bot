import test from "node:test";
import assert from "node:assert/strict";
import { getSystemArchitectureProfile } from "./system-architecture.js";

test("getSystemArchitectureProfile returns rich technical context", () => {
  const profile = getSystemArchitectureProfile({ botName: "Sen Chúa", isSuperAdmin: true });
  assert.ok(profile.includes("Sen Chúa"));
  assert.ok(profile.includes("Autonomous AI Agent"));
  assert.ok(profile.includes("Linux Ubuntu"));
  assert.ok(profile.includes("9Router Gateway"));
  assert.ok(profile.includes("Gemini 3.8 Flash"));
  assert.ok(profile.includes("generate_file"));
  assert.ok(profile.includes("python_interpreter"));
  assert.ok(profile.includes("ffmpeg"));
  assert.ok(profile.includes("25MB"));
});

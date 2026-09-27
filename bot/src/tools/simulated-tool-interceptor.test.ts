import test from "node:test";
import assert from "node:assert/strict";
import { interceptAndExecuteSimulatedTool } from "./simulated-tool-interceptor.js";

test("interceptAndExecuteSimulatedTool leaves normal text untouched", async () => {
  const normalText = "Xin chào các bạn, đây là tin nhắn bình thường.";
  const res = await interceptAndExecuteSimulatedTool(normalText);
  assert.equal(res, normalText);
});

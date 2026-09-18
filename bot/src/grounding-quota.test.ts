import assert from "node:assert/strict";
import test from "node:test";
import { isSearchGroundingEnabled } from "./grounding-quota.js";

test("search grounding is opt-in and disabled by default", () => {
  assert.equal(isSearchGroundingEnabled(undefined), false);
  assert.equal(isSearchGroundingEnabled("false"), false);
  assert.equal(isSearchGroundingEnabled("true"), true);
  assert.equal(isSearchGroundingEnabled("1"), true);
});

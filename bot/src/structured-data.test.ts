import assert from "node:assert/strict";
import test from "node:test";
import { getStructuredRealtimeContext } from "./structured-data.js";

test("routes weather questions to the structured weather provider", async () => {
  let received = "";
  const output = await getStructuredRealtimeContext("thời tiết ở Hà Nội ngày mai", {
    weather: async (location, date) => {
      received = `${location}|${date}`;
      return "Open-Meteo weather";
    },
    fetch: async () => new Response(null, { status: 404 }),
  });
  assert.equal(received, "Hà Nội|tomorrow");
  assert.match(output, /Open-Meteo weather/);
});

test("routes finance questions without calling unrelated weather", async () => {
  let weatherCalled = false;
  const output = await getStructuredRealtimeContext("giá BTC hiện tại", {
    weather: async () => { weatherCalled = true; return ""; },
    finance: async () => "BTC live from exchange",
    fetch: async () => new Response(null, { status: 404 }),
  });
  assert.equal(weatherCalled, false);
  assert.match(output, /BTC live from exchange/);
});

test("uses explicit npm package identifiers and official registry metadata", async () => {
  const output = await getStructuredRealtimeContext("npm package typescript mới nhất", {
    fetch: async (input) => {
      assert.match(String(input), /registry\.npmjs\.org\/typescript\/latest/);
      return new Response(JSON.stringify({ name: "typescript", version: "9.9.9", description: "compiler" }), { status: 200 });
    },
  });
  assert.match(output, /9\.9\.9/);
  assert.match(output, /npm Registry/);
});

test("does not guess a structured provider for an ambiguous general-news query", async () => {
  let fetchCalls = 0;
  const output = await getStructuredRealtimeContext("tin kinh tế mới nhất", {
    fetch: async () => { fetchCalls += 1; return new Response(null, { status: 404 }); },
    official: async () => "",
  });
  assert.equal(fetchCalls, 0);
  assert.equal(output, "");
});

test("combines official adapters with the existing structured gateway", async () => {
  const output = await getStructuredRealtimeContext("giá vàng hôm nay", {
    official: async () => "=== GIÁ VÀNG SJC ===\n- Nguồn chính thức: SJC",
    fetch: async () => new Response(null, { status: 404 }),
  });
  assert.match(output, /GIÁ VÀNG SJC/);
});

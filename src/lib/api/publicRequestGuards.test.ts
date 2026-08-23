import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_COMPARE_INPUT_CHARS,
  MAX_SHOPPING_REQUEST_CHARS,
  contentLengthExceeds,
  isProductionRuntime,
} from "./publicRequestGuards";

test("contentLengthExceeds only when header present and over max", () => {
  const over = new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-length": "100" },
  });
  const under = new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-length": "10" },
  });
  const missing = new Request("http://localhost/x", { method: "POST" });
  assert.equal(contentLengthExceeds(over, 50), true);
  assert.equal(contentLengthExceeds(under, 50), false);
  assert.equal(contentLengthExceeds(missing, 50), false);
});

test("omitting Content-Length does not disable size constants", () => {
  // contentLengthExceeds is advisory; parsed field caps remain authoritative.
  assert.equal(
    contentLengthExceeds(new Request("http://localhost/x", { method: "POST" }), 1),
    false
  );
  assert.ok(MAX_COMPARE_INPUT_CHARS > 0);
  assert.ok(MAX_SHOPPING_REQUEST_CHARS > 0);
});

test("request size constants are positive and bounded", () => {
  assert.ok(MAX_COMPARE_INPUT_CHARS >= 200);
  assert.ok(MAX_COMPARE_INPUT_CHARS <= 10_000);
  assert.ok(MAX_SHOPPING_REQUEST_CHARS >= 100);
  assert.ok(MAX_SHOPPING_REQUEST_CHARS <= 2_000);
});

test("isProductionRuntime reflects NODE_ENV", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assert.equal(isProductionRuntime(), true);
  process.env.NODE_ENV = "development";
  assert.equal(isProductionRuntime(), false);
  process.env.NODE_ENV = previous;
});

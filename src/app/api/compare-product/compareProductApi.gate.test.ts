import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";
import { REFERENCE_PRICE_REQUIRED_MESSAGE } from "@/lib/product/manualProductInput";

test("compare-product still rejects a natural-language request without department and price", async () => {
  const res = await POST(
    new Request("http://localhost/api/compare-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "I need AA batteries." }),
    })
  );
  assert.equal(res.status, 400);
  const json = (await res.json()) as { error?: string };
  assert.equal(json.error, REFERENCE_PRICE_REQUIRED_MESSAGE);
});

test("compare-product still requires a department after a valid reference price", async () => {
  const res = await POST(
    new Request("http://localhost/api/compare-product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "I need AA batteries.",
        pricePaid: "12.99",
      }),
    })
  );
  assert.equal(res.status, 400);
  const json = (await res.json()) as { error?: string };
  assert.equal(json.error, "Choose a department before comparing.");
});

import assert from "node:assert/strict";
import test from "node:test";
import { GUIDED_PLAYBOOKS, getGuidedPlaybook } from "./guidedPlaybooks";

test("guided playbooks keep bank statement analysis honest", () => {
  assert.equal(getGuidedPlaybook("save_this_month").available, true);
  assert.match(getGuidedPlaybook("save_this_month").response, /bank statement/i);
  assert.equal(getGuidedPlaybook("review_bill").available, false);
  assert.match(getGuidedPlaybook("review_bill").response, /does not yet/i);
});

test("guided shopping routes to a working Brainy surface", () => {
  const shopping = getGuidedPlaybook("find_better_price");
  assert.equal(shopping.href, "/shopping-assistant");
  assert.equal(new Set(GUIDED_PLAYBOOKS.map((item) => item.id)).size, GUIDED_PLAYBOOKS.length);
});

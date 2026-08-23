import assert from "node:assert/strict";
import test from "node:test";

import { getActionsForStatus } from "./registry";

test("tracked recommendations offer completion instead of tracking again", () => {
  const actions = getActionsForStatus("setup_balance_alerts", "tracked");

  assert.deepEqual(
    actions.map((action) => action.id),
    ["mark_completed", "dismiss"]
  );
  assert.equal(actions[0]?.label, "Mark completed");
  assert.equal(actions.some((action) => action.id === "track"), false);
});

test("completed recommendations have no remaining actions", () => {
  assert.deepEqual(getActionsForStatus("setup_balance_alerts", "completed"), []);
});

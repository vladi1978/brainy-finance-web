import assert from "node:assert/strict";
import test from "node:test";

import { getActionsForStatus, getActionsForType } from "./registry";

test("MVP recommendation actions only expose working outcomes", () => {
  assert.deepEqual(
    getActionsForType("setup_balance_alerts").map((action) => action.label),
    ["Learn how to avoid fees", "Add to checklist", "Ignore"]
  );
  assert.deepEqual(
    getActionsForType("review_subscription").map((action) => action.label),
    ["View details", "This is essential", "Ignore"]
  );
  assert.deepEqual(
    getActionsForType("compare_telecom").map((action) => action.label),
    ["This is essential", "Ignore"]
  );

  const exposedActions = [
    ...getActionsForType("setup_balance_alerts"),
    ...getActionsForType("review_subscription"),
    ...getActionsForType("compare_telecom"),
  ];
  assert.equal(
    exposedActions.every(
      (action) => action.opensModal === undefined || action.opensModal === "fee_education"
    ),
    true
  );
});

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

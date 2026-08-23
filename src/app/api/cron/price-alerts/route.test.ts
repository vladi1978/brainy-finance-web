import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

function restoreEnv(key: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

test("production cron refuses when CRON_SECRET is missing", async () => {
  const prevNode = process.env.NODE_ENV;
  const prevSecret = process.env.CRON_SECRET;
  const prevDisable = process.env.DISABLE_DEV_BACKGROUND_TASKS;
  process.env.NODE_ENV = "production";
  delete process.env.CRON_SECRET;
  delete process.env.DISABLE_DEV_BACKGROUND_TASKS;
  try {
    const res = await POST(
      new Request("http://localhost/api/cron/price-alerts", { method: "POST" })
    );
    assert.equal(res.status, 503);
    const json = (await res.json()) as { error?: string };
    assert.match(json.error ?? "", /not configured/i);
  } finally {
    restoreEnv("NODE_ENV", prevNode);
    restoreEnv("CRON_SECRET", prevSecret);
    restoreEnv("DISABLE_DEV_BACKGROUND_TASKS", prevDisable);
  }
});

test("production cron rejects invalid bearer", async () => {
  const prevNode = process.env.NODE_ENV;
  const prevSecret = process.env.CRON_SECRET;
  const prevDisable = process.env.DISABLE_DEV_BACKGROUND_TASKS;
  process.env.NODE_ENV = "production";
  process.env.CRON_SECRET = "unit-test-cron-secret";
  delete process.env.DISABLE_DEV_BACKGROUND_TASKS;
  try {
    const res = await POST(
      new Request("http://localhost/api/cron/price-alerts", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      })
    );
    assert.equal(res.status, 401);
  } finally {
    restoreEnv("NODE_ENV", prevNode);
    restoreEnv("CRON_SECRET", prevSecret);
    restoreEnv("DISABLE_DEV_BACKGROUND_TASKS", prevDisable);
  }
});

test("production cron accepts valid bearer", async () => {
  const prevNode = process.env.NODE_ENV;
  const prevSecret = process.env.CRON_SECRET;
  const prevDisable = process.env.DISABLE_DEV_BACKGROUND_TASKS;
  process.env.NODE_ENV = "production";
  process.env.CRON_SECRET = "unit-test-cron-secret";
  delete process.env.DISABLE_DEV_BACKGROUND_TASKS;
  try {
    const res = await POST(
      new Request("http://localhost/api/cron/price-alerts", {
        method: "POST",
        headers: { Authorization: "Bearer unit-test-cron-secret" },
      })
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok?: boolean };
    assert.equal(json.ok, true);
  } finally {
    restoreEnv("NODE_ENV", prevNode);
    restoreEnv("CRON_SECRET", prevSecret);
    restoreEnv("DISABLE_DEV_BACKGROUND_TASKS", prevDisable);
  }
});

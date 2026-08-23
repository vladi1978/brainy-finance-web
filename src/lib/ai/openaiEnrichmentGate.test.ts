import assert from "node:assert/strict";
import test from "node:test";
import {
  getOpenAiApiKeyIfEnabled,
  isOpenAiEnrichmentEnabled,
} from "./openaiEnrichmentGate";

function withEnv(
  values: Record<string, string | undefined>,
  fn: () => void
): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    const next = values[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(values)) {
      const prev = previous[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

test("OpenAI key alone does not enable enrichment", () => {
  withEnv(
    {
      OPENAI_API_KEY: "sk-test-should-not-enable",
      OPENAI_ENRICHMENT_ENABLED: undefined,
    },
    () => {
      assert.equal(isOpenAiEnrichmentEnabled(), false);
      assert.equal(getOpenAiApiKeyIfEnabled(), null);
    }
  );
});

test("OpenAI enrichment requires explicit opt-in plus key", () => {
  withEnv(
    {
      OPENAI_API_KEY: "sk-test-enabled",
      OPENAI_ENRICHMENT_ENABLED: "true",
    },
    () => {
      assert.equal(isOpenAiEnrichmentEnabled(), true);
      assert.equal(getOpenAiApiKeyIfEnabled(), "sk-test-enabled");
    }
  );
});

test("OpenAI opt-in without key stays disabled", () => {
  withEnv(
    {
      OPENAI_API_KEY: undefined,
      OPENAI_ENRICHMENT_ENABLED: "true",
    },
    () => {
      assert.equal(isOpenAiEnrichmentEnabled(), false);
      assert.equal(getOpenAiApiKeyIfEnabled(), null);
    }
  );
});

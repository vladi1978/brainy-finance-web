import assert from "node:assert/strict";
import test from "node:test";
import {
  getOpenAiApiKeyIfEnabled,
  isOpenAiEnrichmentEnabled,
} from "./openaiEnrichmentGate";
import {
  getOpenAiApiKeyForStatementExplanation,
  getStatementExplanationModel,
  getStatementExplanationTimeoutMs,
  isOpenAiStatementExplanationEnabled,
} from "./openaiExplanationGate";

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

test("explanation key alone does not enable explanation", () => {
  withEnv(
    {
      OPENAI_API_KEY: "sk-test-should-not-enable",
      OPENAI_STATEMENT_EXPLANATION_ENABLED: undefined,
      OPENAI_ENRICHMENT_ENABLED: undefined,
    },
    () => {
      assert.equal(isOpenAiStatementExplanationEnabled(), false);
      assert.equal(getOpenAiApiKeyForStatementExplanation(), null);
      assert.equal(isOpenAiEnrichmentEnabled(), false);
    }
  );
});

test("explanation requires explicit opt-in plus key", () => {
  withEnv(
    {
      OPENAI_API_KEY: "sk-explain",
      OPENAI_STATEMENT_EXPLANATION_ENABLED: "true",
      OPENAI_ENRICHMENT_ENABLED: undefined,
    },
    () => {
      assert.equal(isOpenAiStatementExplanationEnabled(), true);
      assert.equal(getOpenAiApiKeyForStatementExplanation(), "sk-explain");
      assert.equal(isOpenAiEnrichmentEnabled(), false);
      assert.equal(getOpenAiApiKeyIfEnabled(), null);
    }
  );
});

test("explanation flag does not enable enrichment", () => {
  withEnv(
    {
      OPENAI_API_KEY: "sk-both",
      OPENAI_STATEMENT_EXPLANATION_ENABLED: "true",
      OPENAI_ENRICHMENT_ENABLED: "false",
    },
    () => {
      assert.equal(isOpenAiStatementExplanationEnabled(), true);
      assert.equal(isOpenAiEnrichmentEnabled(), false);
    }
  );
});

test("enrichment flag does not enable explanation", () => {
  withEnv(
    {
      OPENAI_API_KEY: "sk-enrich",
      OPENAI_ENRICHMENT_ENABLED: "true",
      OPENAI_STATEMENT_EXPLANATION_ENABLED: undefined,
    },
    () => {
      assert.equal(isOpenAiEnrichmentEnabled(), true);
      assert.equal(isOpenAiStatementExplanationEnabled(), false);
      assert.equal(getOpenAiApiKeyForStatementExplanation(), null);
    }
  );
});

test("explanation opt-in without key stays disabled", () => {
  withEnv(
    {
      OPENAI_API_KEY: undefined,
      OPENAI_STATEMENT_EXPLANATION_ENABLED: "true",
    },
    () => {
      assert.equal(isOpenAiStatementExplanationEnabled(), false);
      assert.equal(getOpenAiApiKeyForStatementExplanation(), null);
    }
  );
});

test("explanation model and timeout defaults", () => {
  withEnv(
    {
      OPENAI_STATEMENT_EXPLANATION_MODEL: undefined,
      OPENAI_STATEMENT_EXPLANATION_TIMEOUT_MS: undefined,
    },
    () => {
      assert.equal(getStatementExplanationModel(), "gpt-4o-mini");
      assert.equal(getStatementExplanationTimeoutMs(), 12_000);
    }
  );
});

test("explanation timeout clamps invalid values to default", () => {
  withEnv({ OPENAI_STATEMENT_EXPLANATION_TIMEOUT_MS: "50" }, () => {
    assert.equal(getStatementExplanationTimeoutMs(), 12_000);
  });
  withEnv({ OPENAI_STATEMENT_EXPLANATION_TIMEOUT_MS: "15000" }, () => {
    assert.equal(getStatementExplanationTimeoutMs(), 15_000);
  });
});

/**
 * Statement AI explanation — educational rewrite of sanitized facts only.
 * Never calls parse/enrichment modules. Never mutates statement totals.
 */

import OpenAI from "openai";
import {
  getOpenAiApiKeyForStatementExplanation,
  getStatementExplanationModel,
  getStatementExplanationTimeoutMs,
  isOpenAiStatementExplanationEnabled,
} from "@/lib/ai/openaiExplanationGate";
import {
  EXPLANATION_OPENAI_MAX_OUTPUT_TOKENS,
  EXPLANATION_OPENAI_TEMPERATURE,
} from "./constants";
import type { ExplanationFactContract } from "./factContract";
import { buildDeterministicExplanationFallback } from "./deterministicFallback";
import {
  assertGroundedExplanation,
  toGroundingDiagnosticCode,
  type GroundingDiagnosticCode,
} from "./groundedGuards";
import {
  parseExplanationAiJson,
  type ExplanationAiResponse,
} from "./responseSchema";

export type ExplainFallbackReason =
  | "disabled"
  | "missing_key"
  | "timeout"
  | "provider_error"
  | "schema_invalid"
  | "grounding_failed"
  | "empty_response"
  | "rate_limited"
  | null;

export type ExplainStatementResult = {
  ok: true;
  source: "ai" | "deterministic";
  explanation: ExplanationAiResponse;
  fallbackReason: ExplainFallbackReason;
  model: string | null;
  latencyMs: number;
  /**
   * Server-only grounding diagnostic bucket. Never serialize to the browser.
   * Present only when fallbackReason is "grounding_failed".
   */
  groundingCode?: GroundingDiagnosticCode | null;
};

type ProviderCompletionFn = (args: {
  model: string;
  system: string;
  user: string;
  signal: AbortSignal;
  apiKey: string;
}) => Promise<string | null | undefined>;

/** Test-only provider override — never used in production paths unless set. */
let providerCompletionOverrideForTests: ProviderCompletionFn | null = null;

export function setExplanationProviderCompletionForTests(
  fn: ProviderCompletionFn | null
): void {
  providerCompletionOverrideForTests = fn;
}

export function buildExplanationSystemPrompt(
  contract: ExplanationFactContract
): string {
  return [
    "You are Brainy’s educational statement explainer.",
    "Explain ONLY the supplied verified facts.",
    "Repeat only numerical values that appear literally in the provided facts.",
    "Do not calculate or state differences, sums, subtotals, remaining balances, averages, ratios, percentages, estimates, projections, or conversions unless that exact numerical result is already present as its own fact.",
    'When a derived number is unavailable, use qualitative language (for example: "spending was lower than money received") instead of inventing a numerical difference.',
    "Reference only supplied fact IDs. Every observation must include factIds drawn from the supplied list.",
    "Do not spell numerical values as words.",
    "Do not invent transactions, balances, APRs, savings, eligibility, legal rights, cancellations, or provider offers.",
    "Do not add advice, cancellation instructions, guarantees, eligibility claims, APRs, tax/legal/accounting advice, or provider promises.",
    "Do not give financial, legal, tax, credit, debt-settlement, or accounting advice.",
    "Currency amounts and percentages in your text must match values present in the facts.",
    contract.isProvisional
      ? "Comparison or ledger confidence is provisional — use cautious wording; never claim definitive causes."
      : "Use clear educational wording grounded in the facts.",
    'Return ONLY JSON: {"headline":string,"summary":string,"observations":[{"factIds":string[],"explanation":string}],"questionsToConsider":string[]}',
    "Limits: headline ≤100 chars, summary ≤500 chars, ≤4 observations, ≤3 questions.",
  ].join(" ");
}

export function buildExplanationUserInstruction(): string {
  return [
    "Explain these Brainy-verified statement facts for the user.",
    "Do not add facts that are not listed.",
    "Do not calculate differences, sums, ratios, or percentages unless that exact number is already a supplied fact.",
    "Prefer qualitative wording when a derived result is not present as a fact.",
  ].join(" ");
}

function userPayload(contract: ExplanationFactContract): string {
  return JSON.stringify({
    mode: contract.mode,
    currency: contract.currency,
    periods: contract.periods,
    reconciliationStatus: contract.reconciliationStatus,
    analysisConfidence: contract.analysisConfidence,
    comparisonStatus: contract.comparisonStatus,
    isProvisional: contract.isProvisional,
    reliabilityNotices: contract.reliabilityNotices,
    facts: contract.facts,
  });
}

async function defaultProviderCompletion(args: {
  model: string;
  system: string;
  user: string;
  signal: AbortSignal;
  apiKey: string;
}): Promise<string | null | undefined> {
  const client = new OpenAI({ apiKey: args.apiKey });
  const completion = await client.chat.completions.create(
    {
      model: args.model,
      temperature: EXPLANATION_OPENAI_TEMPERATURE,
      max_tokens: EXPLANATION_OPENAI_MAX_OUTPUT_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    },
    { signal: args.signal }
  );
  return completion.choices[0]?.message?.content?.trim();
}

/** Parse + ground provider JSON without calling OpenAI (used by production path and tests). */
export function finalizeExplanationFromProviderContent(
  content: string | null | undefined,
  contract: ExplanationFactContract,
  opts: { model: string | null; started: number }
): ExplainStatementResult {
  const base = {
    model: opts.model,
    latencyMs: Date.now() - opts.started,
  };

  if (!content) {
    return {
      ok: true,
      source: "deterministic",
      explanation: buildDeterministicExplanationFallback(contract),
      fallbackReason: "empty_response",
      groundingCode: null,
      ...base,
    };
  }

  const parsed = parseExplanationAiJson(content);
  if (!parsed.ok) {
    return {
      ok: true,
      source: "deterministic",
      explanation: buildDeterministicExplanationFallback(contract),
      fallbackReason: "schema_invalid",
      groundingCode: null,
      ...base,
    };
  }

  const grounded = assertGroundedExplanation(parsed.value, contract);
  if (!grounded.ok) {
    return {
      ok: true,
      source: "deterministic",
      explanation: buildDeterministicExplanationFallback(contract),
      fallbackReason: "grounding_failed",
      groundingCode: toGroundingDiagnosticCode(grounded.reason),
      ...base,
    };
  }

  return {
    ok: true,
    source: "ai",
    explanation: parsed.value,
    fallbackReason: null,
    groundingCode: null,
    ...base,
  };
}

export async function explainStatementFacts(
  contract: ExplanationFactContract,
  opts?: { signal?: AbortSignal }
): Promise<ExplainStatementResult> {
  const started = Date.now();
  const fallback = (): ExplainStatementResult => ({
    ok: true,
    source: "deterministic",
    explanation: buildDeterministicExplanationFallback(contract),
    fallbackReason: "disabled",
    model: null,
    latencyMs: Date.now() - started,
    groundingCode: null,
  });

  if (!isOpenAiStatementExplanationEnabled()) {
    return { ...fallback(), fallbackReason: "disabled" };
  }

  const apiKey = getOpenAiApiKeyForStatementExplanation();
  if (!apiKey) {
    return { ...fallback(), fallbackReason: "missing_key" };
  }

  const model = getStatementExplanationModel();
  const timeoutMs = getStatementExplanationTimeoutMs();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts?.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const system = buildExplanationSystemPrompt(contract);
    const user = [
      buildExplanationUserInstruction(),
      userPayload(contract),
    ].join("\n");

    const create =
      providerCompletionOverrideForTests ?? defaultProviderCompletion;
    const content = await create({
      model,
      system,
      user,
      signal: controller.signal,
      apiKey,
    });

    return finalizeExplanationFromProviderContent(content, contract, {
      model,
      started,
    });
  } catch (error) {
    const aborted =
      (error instanceof Error && error.name === "AbortError") ||
      opts?.signal?.aborted ||
      controller.signal.aborted;
    return {
      ok: true,
      source: "deterministic",
      explanation: buildDeterministicExplanationFallback(contract),
      fallbackReason: aborted ? "timeout" : "provider_error",
      model,
      latencyMs: Date.now() - started,
      groundingCode: null,
    };
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}

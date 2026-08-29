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
import type { ExplanationFactContract } from "./factContract";
import { buildDeterministicExplanationFallback } from "./deterministicFallback";
import { assertGroundedExplanation } from "./groundedGuards";
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
};

function systemPrompt(contract: ExplanationFactContract): string {
  return [
    "You are Brainy’s educational statement explainer.",
    "Explain ONLY the supplied verified facts. Do not invent transactions, balances, APRs, savings, eligibility, legal rights, cancellations, or provider offers.",
    "Do not give financial, legal, tax, credit, debt-settlement, or accounting advice.",
    "Reference facts only by their fact IDs from the payload. Do not create new numerical facts.",
    "Every observation must include factIds drawn from the supplied list.",
    "Currency amounts and percentages in your text must match values present in the facts.",
    contract.isProvisional
      ? "Comparison or ledger confidence is provisional — use cautious wording; never claim definitive causes."
      : "Use clear educational wording grounded in the facts.",
    'Return ONLY JSON: {"headline":string,"summary":string,"observations":[{"factIds":string[],"explanation":string}],"questionsToConsider":string[]}',
    "Limits: headline ≤100 chars, summary ≤500 chars, ≤4 observations, ≤3 questions.",
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
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(contract) },
          {
            role: "user",
            content: [
              "Explain these Brainy-verified statement facts for the user.",
              "Do not add facts that are not listed.",
              userPayload(contract),
            ].join("\n"),
          },
        ],
      },
      { signal: controller.signal }
    );

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      return {
        ok: true,
        source: "deterministic",
        explanation: buildDeterministicExplanationFallback(contract),
        fallbackReason: "empty_response",
        model,
        latencyMs: Date.now() - started,
      };
    }

    const parsed = parseExplanationAiJson(content);
    if (!parsed.ok) {
      return {
        ok: true,
        source: "deterministic",
        explanation: buildDeterministicExplanationFallback(contract),
        fallbackReason: "schema_invalid",
        model,
        latencyMs: Date.now() - started,
      };
    }

    const grounded = assertGroundedExplanation(parsed.value, contract);
    if (!grounded.ok) {
      return {
        ok: true,
        source: "deterministic",
        explanation: buildDeterministicExplanationFallback(contract),
        fallbackReason: "grounding_failed",
        model,
        latencyMs: Date.now() - started,
      };
    }

    return {
      ok: true,
      source: "ai",
      explanation: parsed.value,
      fallbackReason: null,
      model,
      latencyMs: Date.now() - started,
    };
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
    };
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}

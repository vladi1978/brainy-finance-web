import OpenAI from "openai";
import { getOpenAiApiKeyIfEnabled } from "@/lib/ai/openaiEnrichmentGate";

/** LLM-assisted signals merged before SERP + universal matcher (matcher stays authoritative). */
export type AiCompareEnrichment = {
  shoppingQueries: string[];
  specTokens: string[];
  excludePhrases: string[];
  brandSubstitutable: boolean;
  summaryOneLine: string | null;
  usedAi: boolean;
};

const EMPTY: AiCompareEnrichment = {
  shoppingQueries: [],
  specTokens: [],
  excludePhrases: [],
  brandSubstitutable: true,
  summaryOneLine: null,
  usedAi: false,
};

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_QUERIES = 5;
const MAX_SPEC_TOKENS = 24;
const MAX_EXCLUSIONS = 12;

const AI_COMPARE_VERBOSE_LOGS = process.env.DEBUG_COMPARE === "true";

function parseJsonFromAssistant(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const payload = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(payload);
  } catch {
    const start = payload.indexOf("{");
    const end = payload.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(payload.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function coerceStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.replace(/\s+/g, " ").trim();
    if (t.length < 2) continue;
    out.push(t.slice(0, 120));
    if (out.length >= max) break;
  }
  return out;
}

function resolveTimeoutMs(): number {
  const raw = process.env.OPENAI_COMPARE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1000 && n <= 60_000 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * OpenAI JSON extraction for shopping query planning + spec hints.
 * Does not score matches — universal matcher remains authoritative.
 * No-op when `OPENAI_API_KEY` is unset or `skipAi` is true.
 */
export async function fetchAiCompareEnrichment(args: {
  primaryTitle: string;
  supplementaryText: string;
  sourceUrl: string | null;
  skipAi: boolean;
}): Promise<AiCompareEnrichment> {
  if (args.skipAi) {
    if (AI_COMPARE_VERBOSE_LOGS) {
      console.log("[AI_COMPARE]", { skipped: true, reason: "skipAi_flag" });
    }
    return { ...EMPTY };
  }

  const apiKey = getOpenAiApiKeyIfEnabled();
  if (!apiKey) {
    if (AI_COMPARE_VERBOSE_LOGS) {
      console.log("[AI_COMPARE]", {
        skipped: true,
        reason: "openai_enrichment_disabled",
      });
    }
    return { ...EMPTY };
  }

  const model = process.env.OPENAI_COMPARE_MODEL?.trim() || DEFAULT_MODEL;
  const timeoutMs = resolveTimeoutMs();

  const userBlob = [
    `title: ${args.primaryTitle.slice(0, 500)}`,
    args.supplementaryText.trim()
      ? `details: ${args.supplementaryText.slice(0, 1200)}`
      : "",
    args.sourceUrl ? `url: ${args.sourceUrl.slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `Brainy Finance product understanding for shopping search prep only.
Infer product type, critical specs (dimensions, display size/resolution tech, pool shape/installation, power style).
Brand/SKU are usually flexible for savings unless niche compatibility requires otherwise.
Output JSON only with keys: shoppingQueries (3-5 short English retailer-style strings), specTokens (compact tokens), excludePhrases (wrong-variant cues e.g. corded vs cordless, wired vs wireless), brandSubstitutable (boolean), summaryOneLine (<=240 chars, Spanish or English ok).
excludePhrases: only strong mismatches vs the reference.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (AI_COMPARE_VERBOSE_LOGS) {
    console.log("[AI_COMPARE]", {
      model,
      timeoutMs,
      titleChars: args.primaryTitle.length,
    });
  }

  try {
    const client = new OpenAI({
      apiKey,
      timeout: timeoutMs + 500,
      maxRetries: 0,
    });

    const resp = await client.chat.completions.create(
      {
        model,
        max_tokens: 700,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userBlob },
        ],
      },
      { signal: controller.signal }
    );

    const text = resp.choices[0]?.message?.content?.trim();
    if (!text) {
      console.warn("[AI_COMPARE]", { ok: false, reason: "empty_completion" });
      return { ...EMPTY };
    }

    const parsed = parseJsonFromAssistant(text);
    if (!parsed || typeof parsed !== "object") {
      console.warn("[AI_COMPARE]", { ok: false, reason: "json_parse_failed" });
      return { ...EMPTY };
    }

    const o = parsed as Record<string, unknown>;
    const shoppingQueries = coerceStringArray(o.shoppingQueries, MAX_QUERIES);
    const specTokens = coerceStringArray(o.specTokens, MAX_SPEC_TOKENS);
    const excludePhrases = coerceStringArray(o.excludePhrases, MAX_EXCLUSIONS);

    if (AI_COMPARE_VERBOSE_LOGS) {
      console.log("[AI_QUERY_PLAN]", {
        count: shoppingQueries.length,
        preview: shoppingQueries.map((q) => q.slice(0, 80)),
      });
      console.log("[AI_EXTRACTION]", {
        specTokens: specTokens.length,
        excludePhrases: excludePhrases.length,
        brandSubstitutable: o.brandSubstitutable !== false,
      });
    }

    return {
      shoppingQueries,
      specTokens,
      excludePhrases,
      brandSubstitutable: o.brandSubstitutable !== false,
      summaryOneLine:
        typeof o.summaryOneLine === "string"
          ? o.summaryOneLine.slice(0, 280).trim() || null
          : null,
      usedAi: true,
    };
  } catch (e) {
    const isAbort =
      (e instanceof Error && e.name === "AbortError") ||
      (typeof e === "object" &&
        e !== null &&
        String((e as { code?: unknown }).code) === "ECONNABORTED");
    if (isAbort || (e instanceof Error && /abort/i.test(e.message))) {
      console.warn("[AI_TIMEOUT_FALLBACK]", {
        timeoutMs,
        message: e instanceof Error ? e.message : String(e),
      });
    } else {
      console.warn("[AI_COMPARE]", {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return { ...EMPTY };
  } finally {
    clearTimeout(timer);
  }
}

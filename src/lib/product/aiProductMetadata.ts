import OpenAI from "openai";
import { getOpenAiApiKeyIfEnabled } from "@/lib/ai/openaiEnrichmentGate";
import {
  mergeExtraKeySpecsIntoUnderstanding,
  normalizeUnderstandingBlob,
  normTokenAlnum,
  type ProductUnderstanding,
} from "./aiExtractor";
import type { ProductCondition } from "./types";

/** Structured product identity from page/title signals — null when not evidenced in input. */
export type AiProductMetadata = {
  brand: string | null;
  model: string | null;
  category: string | null;
  subcategory: string | null;
  size: string | null;
  color: string | null;
  condition: string | null;
  packCount: number | null;
  keySpecs: string[] | null;
  cleanTitle: string | null;
  searchQueries: string[] | null;
  usedAi: boolean;
};

export type AiProductMetadataInput = {
  rawTitle: string;
  url: string;
  pageText?: string | null;
  metaDescription?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  skipAi?: boolean;
};

const EMPTY: AiProductMetadata = {
  brand: null,
  model: null,
  category: null,
  subcategory: null,
  size: null,
  color: null,
  condition: null,
  packCount: null,
  keySpecs: null,
  cleanTitle: null,
  searchQueries: null,
  usedAi: false,
};

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_KEY_SPECS = 16;
const MAX_SEARCH_QUERIES = 5;

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

function coerceNullableString(v: unknown, maxLen = 240): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, maxLen);
}

function coercePackCount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 999) {
    return v;
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,3})$/);
    if (m) {
      const n = Number.parseInt(m[1]!, 10);
      if (n >= 1 && n <= 999) return n;
    }
  }
  return null;
}

function coerceStringArrayOrNull(
  v: unknown,
  max: number,
  minLen = 2
): string[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.replace(/\s+/g, " ").trim();
    if (t.length < minLen) continue;
    out.push(t.slice(0, 120));
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : null;
}

function resolveTimeoutMs(): number {
  const raw = process.env.OPENAI_COMPARE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1000 && n <= 60_000 ? n : DEFAULT_TIMEOUT_MS;
}

function mapAiConditionToProductCondition(
  raw: string | null
): ProductCondition | null {
  if (!raw) return null;
  const n = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (n === "new") return "new";
  if (n === "renewed") return "renewed";
  if (n === "refurbished" || n === "refurb") return "refurbished";
  if (n === "used" || n === "pre-owned" || n === "preowned") return "used";
  if (n === "open_box" || n === "open box" || n === "open-box") return "open_box";
  if (n === "unknown") return "unknown";
  return null;
}

function normalizeBrandToken(raw: string): string {
  return normalizeUnderstandingBlob(raw).toLowerCase();
}

function parseMetadataObject(parsed: Record<string, unknown>): AiProductMetadata {
  return {
    brand: coerceNullableString(parsed.brand, 80),
    model: coerceNullableString(parsed.model, 120),
    category: coerceNullableString(parsed.category, 80),
    subcategory: coerceNullableString(parsed.subcategory, 80),
    size: coerceNullableString(parsed.size, 80),
    color: coerceNullableString(parsed.color, 60),
    condition: coerceNullableString(parsed.condition, 40),
    packCount: coercePackCount(parsed.packCount),
    keySpecs: coerceStringArrayOrNull(parsed.keySpecs, MAX_KEY_SPECS),
    cleanTitle: coerceNullableString(parsed.cleanTitle, 280),
    searchQueries: coerceStringArrayOrNull(
      parsed.searchQueries,
      MAX_SEARCH_QUERIES,
      4
    ),
    usedAi: true,
  };
}

function buildUserBlob(input: AiProductMetadataInput): string {
  const lines = [
    `rawTitle: ${input.rawTitle.slice(0, 500)}`,
    `url: ${input.url.slice(0, 400)}`,
  ];
  if (input.pageText?.trim()) {
    lines.push(`pageText: ${input.pageText.trim().slice(0, 2000)}`);
  }
  if (input.metaDescription?.trim()) {
    lines.push(`metaDescription: ${input.metaDescription.trim().slice(0, 800)}`);
  }
  if (input.ogTitle?.trim()) {
    lines.push(`ogTitle: ${input.ogTitle.trim().slice(0, 400)}`);
  }
  if (input.ogDescription?.trim()) {
    lines.push(`ogDescription: ${input.ogDescription.trim().slice(0, 800)}`);
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You extract universal product metadata for shopping search and identity matching.
Use ONLY facts explicitly supported by the provided rawTitle, url path segments, pageText, metaDescription, ogTitle, or ogDescription.
Rules:
- Never invent, guess, or assume missing attributes.
- For any field not clearly evidenced, return JSON null (not empty strings).
- keySpecs and searchQueries: return null when none are evidenced; otherwise arrays of short strings.
- searchQueries: 2-4 concise English retailer-style product search strings (brand/model/specs when known).
- cleanTitle: a shorter shopper-facing title using only evidenced tokens; null if unclear.
- condition: only when explicitly stated (e.g. new, used, refurbished, renewed, open_box); else null.
- packCount: integer only when an explicit pack/count is stated; else null.
- Do not infer retailer, marketplace, or store names as the brand unless they are the product manufacturer.
- Works for any product category (apparel, electronics, home, grocery, tools, etc.).
Output JSON only with keys: brand, model, category, subcategory, size, color, condition, packCount, keySpecs, cleanTitle, searchQueries.`;

/**
 * OpenAI JSON extraction for universal product metadata.
 * No-op when `OPENAI_API_KEY` is unset or `skipAi` is true.
 * Does not fetch pages or call SerpAPI — callers supply text signals.
 */
export async function fetchAiProductMetadata(
  input: AiProductMetadataInput
): Promise<AiProductMetadata> {
  const title = input.rawTitle.replace(/\s+/g, " ").trim();
  const url = input.url.replace(/\s+/g, " ").trim();

  if (AI_COMPARE_VERBOSE_LOGS) {
    console.log("[AI_METADATA_INPUT]", {
      rawTitle: title.slice(0, 200),
      url: url.slice(0, 200),
      hasPageText: Boolean(input.pageText?.trim()),
      hasMetaDescription: Boolean(input.metaDescription?.trim()),
      hasOgTitle: Boolean(input.ogTitle?.trim()),
      hasOgDescription: Boolean(input.ogDescription?.trim()),
    });
  }

  if (input.skipAi) {
    if (AI_COMPARE_VERBOSE_LOGS) {
      console.log("[AI_METADATA_RESULT]", { skipped: true, reason: "skipAi_flag" });
    }
    return { ...EMPTY };
  }

  if (!title && !url) {
    if (AI_COMPARE_VERBOSE_LOGS) {
      console.log("[AI_METADATA_RESULT]", { skipped: true, reason: "empty_input" });
    }
    return { ...EMPTY };
  }

  const apiKey = getOpenAiApiKeyIfEnabled();
  if (!apiKey) {
    if (AI_COMPARE_VERBOSE_LOGS) {
      console.log("[AI_METADATA_RESULT]", {
        skipped: true,
        reason: "openai_enrichment_disabled",
      });
    }
    return { ...EMPTY };
  }

  const model = process.env.OPENAI_COMPARE_MODEL?.trim() || DEFAULT_MODEL;
  const timeoutMs = resolveTimeoutMs();
  const userBlob = buildUserBlob({ ...input, rawTitle: title || url, url: url || title });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const client = new OpenAI({
      apiKey,
      timeout: timeoutMs + 500,
      maxRetries: 0,
    });

    const resp = await client.chat.completions.create(
      {
        model,
        max_tokens: 650,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userBlob },
        ],
      },
      { signal: controller.signal }
    );

    const text = resp.choices[0]?.message?.content?.trim();
    if (!text) {
      if (AI_COMPARE_VERBOSE_LOGS) {
        console.log("[AI_METADATA_RESULT]", { ok: false, reason: "empty_completion" });
      }
      return { ...EMPTY };
    }

    const parsed = parseJsonFromAssistant(text);
    if (!parsed || typeof parsed !== "object") {
      if (AI_COMPARE_VERBOSE_LOGS) {
        console.log("[AI_METADATA_RESULT]", { ok: false, reason: "json_parse_failed" });
      }
      return { ...EMPTY };
    }

    const metadata = parseMetadataObject(parsed as Record<string, unknown>);

    if (AI_COMPARE_VERBOSE_LOGS) {
      console.log("[AI_METADATA_RESULT]", {
        ok: true,
        hasBrand: Boolean(metadata.brand),
        hasModel: Boolean(metadata.model),
        keySpecsCount: metadata.keySpecs?.length ?? 0,
        searchQueriesCount: metadata.searchQueries?.length ?? 0,
      });
    }

    if (AI_COMPARE_VERBOSE_LOGS && metadata.searchQueries) {
      console.log("[AI_SEARCH_QUERIES]", {
        count: metadata.searchQueries.length,
        previews: metadata.searchQueries.map((q) => q.slice(0, 80)),
      });
    } else if (AI_COMPARE_VERBOSE_LOGS) {
      console.log("[AI_SEARCH_QUERIES]", { count: 0, previews: null });
    }

    return metadata;
  } catch (e) {
    const isAbort =
      (e instanceof Error && e.name === "AbortError") ||
      (typeof e === "object" &&
        e !== null &&
        String((e as { code?: unknown }).code) === "ECONNABORTED");
    if (AI_COMPARE_VERBOSE_LOGS) {
      console.warn("[AI_METADATA_RESULT]", {
        ok: false,
        reason: isAbort ? "timeout" : "error",
        message: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
    }
    return { ...EMPTY };
  } finally {
    clearTimeout(timer);
  }
}

/** Fill gaps in structured understanding — never overwrites existing deterministic fields. */
export function applyAiProductMetadataToUnderstanding(
  u: ProductUnderstanding,
  meta: AiProductMetadata
): ProductUnderstanding {
  if (!meta.usedAi) return u;

  let next = u;

  const brand = meta.brand ? normalizeBrandToken(meta.brand) : null;
  const model = meta.model ? normTokenAlnum(meta.model) : null;
  const category = meta.category
    ? normalizeUnderstandingBlob(meta.category).toLowerCase()
    : null;
  const subcategory = meta.subcategory
    ? normalizeUnderstandingBlob(meta.subcategory).toLowerCase()
    : null;
  const size = meta.size
    ? normalizeUnderstandingBlob(meta.size).toLowerCase()
    : null;
  const color = meta.color
    ? normalizeUnderstandingBlob(meta.color).toLowerCase()
    : null;
  const condition = mapAiConditionToProductCondition(meta.condition);

  const patch: Partial<ProductUnderstanding> = {};

  if (brand && !next.brandNorm) patch.brandNorm = brand;
  if (model && !next.modelFamilyNorm) patch.modelFamilyNorm = model;
  if (category && !next.categoryHintNorm) patch.categoryHintNorm = category;
  if (subcategory && !next.productTypeHintNorm) patch.productTypeHintNorm = subcategory;
  if (size && !next.dimensionsNorm) patch.dimensionsNorm = size;
  if (color && !next.colorNorm) patch.colorNorm = color;
  if (condition && !next.condition) patch.condition = condition;
  if (meta.packCount != null && next.quantityCount == null) {
    patch.quantityCount = meta.packCount;
  }

  if (Object.keys(patch).length > 0) {
    next = { ...next, ...patch };
    next = {
      ...next,
      extractionConfidence: Math.min(
        0.94,
        next.extractionConfidence + 0.06
      ),
    };
  }

  if (meta.keySpecs?.length) {
    next = mergeExtraKeySpecsIntoUnderstanding(next, meta.keySpecs);
  }

  return next;
}

/** Shopping query strings from metadata — empty when AI did not return queries. */
export function aiProductMetadataSearchQueries(
  meta: AiProductMetadata
): string[] {
  return meta.searchQueries ?? [];
}

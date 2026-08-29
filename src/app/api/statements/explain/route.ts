import { NextResponse } from "next/server";
import {
  MAX_STATEMENT_EXPLAIN_BODY_BYTES,
  contentLengthExceeds,
} from "@/lib/api/publicRequestGuards";
import { sanitizeIncomingFactContract } from "@/lib/statements/explanation/factContract";
import { explainStatementFacts } from "@/lib/statements/explanation/explainStatement";
import {
  AI_EXPLANATION_DISCLOSURE,
  AI_EXPLANATION_EDUCATIONAL_DISCLAIMER,
} from "@/lib/statements/explanation/constants";
import {
  checkExplanationRateLimit,
  clientKeyFromRequest,
} from "@/lib/statements/explanation/rateLimit";
import { bodyHasProhibitedKeys } from "@/lib/statements/explanation/redaction";
import {
  isAllowedExplainOrigin,
  isJsonContentType,
} from "@/lib/statements/explanation/requestGuards";
import { buildDeterministicExplanationFallback } from "@/lib/statements/explanation/deterministicFallback";

export const runtime = "nodejs";

function metaLog(payload: {
  ok: boolean;
  mode: string | null;
  latencyMs: number;
  model: string | null;
  fallbackReason: string | null;
}): void {
  // Metadata only — never log amounts, names, periods, or explanation text.
  console.log("[statements/explain]", {
    ok: payload.ok,
    mode: payload.mode,
    latencyMs: payload.latencyMs,
    model: payload.model,
    fallbackReason: payload.fallbackReason,
  });
}

export async function POST(req: Request) {
  const started = Date.now();

  try {
    if (!isAllowedExplainOrigin(req)) {
      metaLog({
        ok: false,
        mode: null,
        latencyMs: Date.now() - started,
        model: null,
        fallbackReason: "origin_rejected",
      });
      return NextResponse.json(
        { ok: false, error: "Request origin not allowed." },
        { status: 403 }
      );
    }

    if (!isJsonContentType(req)) {
      metaLog({
        ok: false,
        mode: null,
        latencyMs: Date.now() - started,
        model: null,
        fallbackReason: "non_json",
      });
      return NextResponse.json(
        { ok: false, error: "Content-Type must be application/json." },
        { status: 415 }
      );
    }

    if (contentLengthExceeds(req, MAX_STATEMENT_EXPLAIN_BODY_BYTES)) {
      metaLog({
        ok: false,
        mode: null,
        latencyMs: Date.now() - started,
        model: null,
        fallbackReason: "body_too_large",
      });
      return NextResponse.json(
        { ok: false, error: "Request body too large." },
        { status: 413 }
      );
    }

    const rawText = await req.text();
    if (rawText.length > MAX_STATEMENT_EXPLAIN_BODY_BYTES) {
      metaLog({
        ok: false,
        mode: null,
        latencyMs: Date.now() - started,
        model: null,
        fallbackReason: "body_too_large",
      });
      return NextResponse.json(
        { ok: false, error: "Request body too large." },
        { status: 413 }
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      metaLog({
        ok: false,
        mode: null,
        latencyMs: Date.now() - started,
        model: null,
        fallbackReason: "invalid_json",
      });
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const prohibited = bodyHasProhibitedKeys(body);
    if (prohibited) {
      metaLog({
        ok: false,
        mode: null,
        latencyMs: Date.now() - started,
        model: null,
        fallbackReason: "prohibited_field",
      });
      return NextResponse.json(
        { ok: false, error: "Request contains disallowed fields." },
        { status: 400 }
      );
    }

    if (body == null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const record = body as Record<string, unknown>;
    if ("file" in record || "pdf" in record || "buffer" in record) {
      return NextResponse.json(
        { ok: false, error: "PDF and file uploads are not accepted." },
        { status: 400 }
      );
    }

    const contractRaw =
      record.contract != null && typeof record.contract === "object"
        ? record.contract
        : body;

    const sanitized = sanitizeIncomingFactContract(contractRaw);
    if (!sanitized.ok) {
      metaLog({
        ok: false,
        mode: null,
        latencyMs: Date.now() - started,
        model: null,
        fallbackReason: "contract_invalid",
      });
      return NextResponse.json(
        { ok: false, error: "Invalid explanation fact contract." },
        { status: 400 }
      );
    }

    const rate = checkExplanationRateLimit(clientKeyFromRequest(req));
    if (!rate.allowed) {
      const explanation = buildDeterministicExplanationFallback(
        sanitized.contract
      );
      metaLog({
        ok: true,
        mode: sanitized.contract.mode,
        latencyMs: Date.now() - started,
        model: null,
        fallbackReason: "rate_limited",
      });
      return NextResponse.json(
        {
          ok: true,
          source: "deterministic",
          mode: sanitized.contract.mode,
          explanation,
          disclosure: AI_EXPLANATION_DISCLOSURE,
          educationalDisclaimer: AI_EXPLANATION_EDUCATIONAL_DISCLAIMER,
          fallback: true,
          fallbackReason: "rate_limited",
          latencyMs: Date.now() - started,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSec) },
        }
      );
    }

    const result = await explainStatementFacts(sanitized.contract);

    metaLog({
      ok: true,
      mode: sanitized.contract.mode,
      latencyMs: result.latencyMs,
      model: result.model,
      fallbackReason: result.fallbackReason,
    });

    return NextResponse.json({
      ok: true,
      source: result.source,
      mode: sanitized.contract.mode,
      explanation: result.explanation,
      disclosure: AI_EXPLANATION_DISCLOSURE,
      educationalDisclaimer: AI_EXPLANATION_EDUCATIONAL_DISCLAIMER,
      fallback: result.source !== "ai",
      fallbackReason: result.fallbackReason,
      latencyMs: result.latencyMs,
    });
  } catch {
    metaLog({
      ok: false,
      mode: null,
      latencyMs: Date.now() - started,
      model: null,
      fallbackReason: "unexpected",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Explanation is temporarily unavailable.",
      },
      { status: 500 }
    );
  }
}

"use client";

import { useEffect, useRef, useState } from "react";

import type { ExplanationFactContract } from "@/lib/statements/explanation/factContract";
import type { ExplanationAiResponse } from "@/lib/statements/explanation/responseSchema";
import {
  AI_EXPLANATION_DISABLED_SUMMARY_LABEL,
  AI_EXPLANATION_DISCLOSURE,
  AI_EXPLANATION_EDUCATIONAL_DISCLAIMER,
} from "@/lib/statements/explanation/constants";
import { buildDeterministicExplanationFallback } from "@/lib/statements/explanation/deterministicFallback";

type UiState =
  | "idle"
  | "explaining"
  | "ai"
  | "deterministic"
  | "unavailable";

type Props = {
  contract: ExplanationFactContract;
  periodLabel: string;
  /** Distinguishes single vs comparison control for tests/a11y */
  variant: "single" | "comparison";
};

type ApiOk = {
  ok: true;
  source: "ai" | "deterministic";
  explanation: ExplanationAiResponse;
  disclosure?: string;
  educationalDisclaimer?: string;
  fallback?: boolean;
  fallbackReason?: string | null;
};

export function ExplainWithAiPanel({
  contract,
  periodLabel,
  variant,
}: Props) {
  const [state, setState] = useState<UiState>("idle");
  const [explanation, setExplanation] = useState<ExplanationAiResponse | null>(
    null
  );
  const [disclosure, setDisclosure] = useState(AI_EXPLANATION_DISCLOSURE);
  const [disclaimer, setDisclaimer] = useState(
    AI_EXPLANATION_EDUCATIONAL_DISCLAIMER
  );
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      // Invalidate any in-flight response handlers.
      requestIdRef.current += 1;
    };
  }, []);

  async function onExplain() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;

    setState("explaining");
    setExplanation(null);
    setFallbackReason(null);
    try {
      const res = await fetch("/api/statements/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract }),
        signal: controller.signal,
      });

      if (requestId !== requestIdRef.current) return;

      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      if (requestId !== requestIdRef.current) return;

      if (
        json &&
        typeof json === "object" &&
        (json as ApiOk).ok === true &&
        (json as ApiOk).explanation
      ) {
        const body = json as ApiOk;
        setExplanation(body.explanation);
        if (body.disclosure) setDisclosure(body.disclosure);
        if (body.educationalDisclaimer) setDisclaimer(body.educationalDisclaimer);
        setFallbackReason(body.fallbackReason ?? null);
        setState(body.source === "ai" ? "ai" : "deterministic");
        return;
      }

      // Fail closed to local deterministic copy — never show provider errors.
      const local = buildDeterministicExplanationFallback(contract);
      setExplanation(local);
      setFallbackReason(null);
      setState(res.status >= 500 ? "unavailable" : "deterministic");
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setExplanation(buildDeterministicExplanationFallback(contract));
      setFallbackReason(null);
      setState("unavailable");
    }
  }

  const headingId =
    variant === "comparison"
      ? "ai-explain-comparison-heading"
      : "ai-explain-single-heading";

  const deterministicLabel =
    fallbackReason === "disabled"
      ? AI_EXPLANATION_DISABLED_SUMMARY_LABEL
      : "Verified summary (AI unavailable)";

  return (
    <div
      className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4"
      data-explain-variant={variant}
      data-explain-state={state}
      data-fallback-reason={fallbackReason ?? ""}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id={headingId}
            className="text-sm font-semibold text-white sm:text-base"
          >
            Explain with AI
          </h3>
          <p className="mt-1 text-xs text-white/45">
            {variant === "comparison"
              ? `Comparing ${periodLabel}`
              : `Explaining ${periodLabel}`}
          </p>
        </div>
        <button
          type="button"
          disabled={state === "explaining"}
          onClick={() => void onExplain()}
          className="rounded-full border border-sky-400/40 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-50 transition hover:bg-sky-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-wait disabled:opacity-60"
          aria-describedby={headingId}
        >
          {state === "explaining" ? "Explaining…" : "Explain with AI"}
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-white/40">{disclosure}</p>

      {state === "explaining" ? (
        <p className="mt-3 text-sm text-white/55" role="status">
          Preparing an educational explanation of Brainy’s verified facts…
        </p>
      ) : null}

      {explanation && (state === "ai" || state === "deterministic" || state === "unavailable") ? (
        <div className="mt-4 space-y-3">
          {state === "ai" ? (
            <p className="text-xs font-medium uppercase tracking-wider text-sky-300/80">
              AI explanation
            </p>
          ) : state === "unavailable" ? (
            <p className="text-xs font-medium uppercase tracking-wider text-amber-200/80">
              Unavailable — showing Brainy’s verified summary
            </p>
          ) : (
            <p className="text-xs font-medium uppercase tracking-wider text-white/50">
              {deterministicLabel}
            </p>
          )}
          <p className="text-base font-semibold text-white">{explanation.headline}</p>
          <p className="text-sm leading-relaxed text-white/70">
            {explanation.summary}
          </p>
          {explanation.observations.length ? (
            <ul className="space-y-2 text-sm text-white/65">
              {explanation.observations.map((obs) => (
                <li
                  key={`${obs.factIds.join(",")}:${obs.explanation.slice(0, 24)}`}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                >
                  {obs.explanation}
                </li>
              ))}
            </ul>
          ) : null}
          {explanation.questionsToConsider.length ? (
            <div>
              <p className="text-xs uppercase tracking-wider text-white/40">
                Questions to consider
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-white/60">
                {explanation.questionsToConsider.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs leading-relaxed text-white/40">{disclaimer}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Deterministic explanation fallback — no OpenAI.
 * Built only from the sanitized fact contract.
 */

import type { ExplanationFactContract } from "./factContract";
import type { ExplanationAiResponse } from "./responseSchema";
import {
  EXPLANATION_HEADLINE_MAX,
  EXPLANATION_SUMMARY_MAX,
} from "./constants";

function moneyFact(
  contract: ExplanationFactContract,
  id: string
): number | null {
  const f = contract.facts.find((x) => x.id === id);
  return typeof f?.value === "number" ? f.value : null;
}

function formatMoney(n: number, currency: string): string {
  try {
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function buildDeterministicExplanationFallback(
  contract: ExplanationFactContract
): ExplanationAiResponse {
  const currency = contract.currency || "USD";
  const received = moneyFact(contract, "cashflow.received");
  const spent = moneyFact(contract, "cashflow.spent");
  const essential = moneyFact(contract, "commitments.essential");
  const flexible = moneyFact(contract, "commitments.flexible");
  const debt = moneyFact(contract, "commitments.debt");

  const periodLabel = contract.periods
    .map((p) =>
      p.start && p.end ? `${p.start} → ${p.end}` : "this statement period"
    )
    .join(" vs ");

  let headline: string;
  let summary: string;

  if (contract.mode === "comparison") {
    const spentDelta = moneyFact(contract, "comparison.spent");
    headline = clip(
      contract.isProvisional
        ? "Observed differences between these statement periods"
        : "Verified differences between these statement periods",
      EXPLANATION_HEADLINE_MAX
    );
    summary = clip(
      [
        `Brainy compared ${periodLabel}.`,
        spentDelta != null
          ? `Money spent changed by ${formatMoney(spentDelta, currency)}.`
          : "Spending changes are listed in the verified category facts.",
        contract.isProvisional
          ? "These observations are provisional — not definitive causes."
          : "Figures come from Brainy’s verified comparison only.",
        ...contract.reliabilityNotices.slice(0, 2),
      ].join(" "),
      EXPLANATION_SUMMARY_MAX
    );
  } else {
    headline = clip(
      "What stood out in this statement period",
      EXPLANATION_HEADLINE_MAX
    );
    summary = clip(
      [
        `For ${periodLabel}:`,
        received != null
          ? `money received ${formatMoney(received, currency)},`
          : "",
        spent != null ? `money spent ${formatMoney(spent, currency)}.` : "",
        essential != null
          ? `Essential commitments ${formatMoney(essential, currency)}.`
          : "",
        flexible != null
          ? `Flexible spending ${formatMoney(flexible, currency)}.`
          : "",
        debt != null && debt > 0
          ? `Debt and financing ${formatMoney(debt, currency)}.`
          : "",
        ...contract.reliabilityNotices.slice(0, 2),
      ]
        .filter(Boolean)
        .join(" "),
      EXPLANATION_SUMMARY_MAX
    );
  }

  const observations: ExplanationAiResponse["observations"] = [];
  const pushObs = (factIds: string[], explanation: string) => {
    if (observations.length >= 4) return;
    const existing = factIds.filter((id) =>
      contract.facts.some((f) => f.id === id)
    );
    if (!existing.length) return;
    observations.push({ factIds: existing, explanation });
  };

  if (contract.mode === "single") {
    if (essential != null) {
      pushObs(
        ["commitments.essential"],
        `Essential commitments totaled ${formatMoney(essential, currency)}.`
      );
    }
    if (flexible != null) {
      pushObs(
        ["commitments.flexible"],
        `Flexible spending totaled ${formatMoney(flexible, currency)}.`
      );
    }
    if (spent != null && received != null) {
      pushObs(
        ["cashflow.received", "cashflow.spent"],
        `Money received was ${formatMoney(received, currency)} and money spent was ${formatMoney(spent, currency)}.`
      );
    }
  } else {
    const incomeDelta = moneyFact(contract, "comparison.income");
    if (incomeDelta != null) {
      pushObs(
        ["comparison.income"],
        `Money received changed by ${formatMoney(incomeDelta, currency)}.`
      );
    }
    const spentDelta = moneyFact(contract, "comparison.spent");
    if (spentDelta != null) {
      pushObs(
        ["comparison.spent"],
        `Money spent changed by ${formatMoney(spentDelta, currency)}.`
      );
    }
    const catFact = contract.facts.find((f) =>
      f.id.startsWith("comparison.category.")
    );
    if (catFact && typeof catFact.value === "number") {
      pushObs(
        [catFact.id],
        `${catFact.label}: ${formatMoney(catFact.value, currency)}.`
      );
    }
  }

  const questionsToConsider =
    contract.mode === "comparison"
      ? [
          "Which verified category change deserves a closer look first?",
          "Were any newly observed charges expected for this period?",
          "Do the provisional notes change how you read these differences?",
        ].slice(0, 3)
      : [
          "Which essential commitments look correct for this period?",
          "Which flexible spending areas do you want to review?",
          "What questions would you ask a service or debt provider?",
        ].slice(0, 3);

  return { headline, summary, observations, questionsToConsider };
}

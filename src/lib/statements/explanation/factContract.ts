/**
 * Sanitized fact contract for statement AI explanations.
 * Pure builders — no I/O, no OpenAI, no mutation of activity/comparison.
 */

import type { StatementPeriod } from "../types";
import type { StatementActivitySummary } from "../intelligence/statementActivity";
import type { StatementComparisonResult } from "../intelligence/statementComparison";
import {
  ESSENTIAL_CATEGORY_IDS,
  FINANCIAL_COMMITMENT_IDS,
  FLEXIBLE_SCENARIO_IDS,
  buildMonthlyExplanation,
} from "../intelligence/monthlyExplanation";
import { presentationMerchantDisplayName } from "../presentationMerchantDisplay";
import {
  EXPLANATION_MAX_CATEGORIES,
  EXPLANATION_MAX_FACT_ID_CHARS,
  EXPLANATION_MAX_FACTS,
  EXPLANATION_MAX_FINDINGS,
  EXPLANATION_MAX_LABEL_CHARS,
  EXPLANATION_MAX_NOTICE_CHARS,
  EXPLANATION_MAX_NOTICES,
  EXPLANATION_MAX_PROVIDER_CHARS,
  EXPLANATION_MAX_PROVIDERS,
} from "./constants";
import {
  containsProhibitedSensitiveResidue,
  redactExplanationText,
} from "./redaction";

export type ExplanationMode = "single" | "comparison";

export type ExplanationFactKind =
  | "money"
  | "count"
  | "percent"
  | "label"
  | "status"
  | "notice";

export type ExplanationFact = {
  id: string;
  kind: ExplanationFactKind;
  label: string;
  /** Numeric amounts/counts/percents only when kind allows. */
  value: number | string | boolean | null;
};

export type ExplanationPeriodSide = {
  role: "primary" | "earlier" | "later";
  start: string | null;
  end: string | null;
};

export type ExplanationFactContract = {
  mode: ExplanationMode;
  currency: string;
  periods: ExplanationPeriodSide[];
  reconciliationStatus: string;
  analysisConfidence: string;
  comparisonStatus: string | null;
  isProvisional: boolean;
  facts: ExplanationFact[];
  reliabilityNotices: string[];
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumCategoryTotals(
  activity: StatementActivitySummary,
  ids: readonly string[]
): number {
  let total = 0;
  for (const id of ids) {
    total += activity.categories.find((c) => c.id === id)?.total ?? 0;
  }
  return roundMoney(total);
}

function sanitizeLabel(raw: string, max = EXPLANATION_MAX_LABEL_CHARS): string {
  const redacted = redactExplanationText(raw, max);
  if (redacted.rejected || !redacted.text) return "Item";
  if (containsProhibitedSensitiveResidue(redacted.text)) return "Item";
  return redacted.text;
}

function pushFact(
  facts: ExplanationFact[],
  fact: ExplanationFact
): void {
  if (facts.length >= EXPLANATION_MAX_FACTS) return;
  if (!fact.id || fact.id.length > EXPLANATION_MAX_FACT_ID_CHARS) return;
  if (!/^[a-z][a-z0-9._-]*$/i.test(fact.id)) return;
  facts.push({
    id: fact.id,
    kind: fact.kind,
    label: sanitizeLabel(fact.label),
    value: fact.value,
  });
}

function periodSides(
  mode: ExplanationMode,
  period: StatementPeriod | null | undefined,
  comparison: StatementComparisonResult | null | undefined
): ExplanationPeriodSide[] {
  if (mode === "comparison" && comparison) {
    return [
      {
        role: "earlier",
        start: comparison.previousPeriod?.start ?? null,
        end: comparison.previousPeriod?.end ?? null,
      },
      {
        role: "later",
        start: comparison.currentPeriod?.start ?? null,
        end: comparison.currentPeriod?.end ?? null,
      },
    ];
  }
  return [
    {
      role: "primary",
      start: period?.start ?? null,
      end: period?.end ?? null,
    },
  ];
}

function confidenceFromActivity(activity: StatementActivitySummary): string {
  if (
    activity.ledger.status === "reconciled" &&
    activity.cashFlowReliable
  ) {
    return "high";
  }
  if (activity.ledger.status === "partially_reconciled") return "medium";
  return "low";
}

/**
 * Build a minimal, bounded fact contract from deterministic summaries only.
 * Never includes transactions, PDF text, or raw bank descriptors.
 */
export function buildExplanationFactContract(input: {
  mode: ExplanationMode;
  activity: StatementActivitySummary;
  statementPeriod?: StatementPeriod | null;
  comparison?: StatementComparisonResult | null;
}): ExplanationFactContract {
  const { mode, activity } = input;
  const comparison = input.comparison ?? null;
  const facts: ExplanationFact[] = [];
  const notices: string[] = [];

  const addNotice = (raw: string) => {
    if (notices.length >= EXPLANATION_MAX_NOTICES) return;
    const r = redactExplanationText(raw, EXPLANATION_MAX_NOTICE_CHARS);
    if (!r.rejected && r.text) notices.push(r.text);
  };

  pushFact(facts, {
    id: "cashflow.received",
    kind: "money",
    label: "Money received",
    value: roundMoney(activity.moneyIn),
  });
  pushFact(facts, {
    id: "cashflow.spent",
    kind: "money",
    label: "Money spent",
    value: roundMoney(activity.moneyOut),
  });

  if (activity.cashFlowReliable && activity.netCashFlow != null) {
    pushFact(facts, {
      id: "cashflow.net",
      kind: "money",
      label: "Net cash flow",
      value: roundMoney(activity.netCashFlow),
    });
  } else {
    addNotice(
      "Net cash flow is not treated as reliable for this explanation."
    );
  }

  pushFact(facts, {
    id: "commitments.essential",
    kind: "money",
    label: "Essential commitments",
    value: sumCategoryTotals(activity, ESSENTIAL_CATEGORY_IDS),
  });
  pushFact(facts, {
    id: "commitments.debt",
    kind: "money",
    label: "Debt and financing",
    value: sumCategoryTotals(activity, FINANCIAL_COMMITMENT_IDS),
  });
  pushFact(facts, {
    id: "commitments.flexible",
    kind: "money",
    label: "Flexible spending",
    value: sumCategoryTotals(activity, FLEXIBLE_SCENARIO_IDS),
  });

  const categories = [...activity.categories]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, EXPLANATION_MAX_CATEGORIES);

  for (const cat of categories) {
    pushFact(facts, {
      id: `category.${cat.id}`,
      kind: "money",
      label: cat.label,
      value: roundMoney(cat.total),
    });
  }

  const confirmed = activity.subscriptionCards.filter(
    (s) => s.status === "confirmed"
  ).length;
  const possible = activity.subscriptionCards.filter(
    (s) => s.status === "possible"
  ).length;
  pushFact(facts, {
    id: "subscriptions.confirmed_count",
    kind: "count",
    label: "Confirmed subscriptions",
    value: confirmed,
  });
  pushFact(facts, {
    id: "subscriptions.possible_count",
    kind: "count",
    label: "Possible subscriptions",
    value: possible,
  });

  // Sanitized provider display names only (no raw descriptors).
  const providers = activity.billProviderGroups
    .slice(0, EXPLANATION_MAX_PROVIDERS)
    .map((g) => {
      const name = presentationMerchantDisplayName(g.providerName);
      const clean = redactExplanationText(name, EXPLANATION_MAX_PROVIDER_CHARS);
      return clean.rejected ? null : clean.text;
    })
    .filter((n): n is string => Boolean(n));

  providers.forEach((name, i) => {
    pushFact(facts, {
      id: `bill.provider.${i + 1}`,
      kind: "label",
      label: "Bill provider",
      value: name,
    });
  });

  const monthly = buildMonthlyExplanation({
    activity,
    statementPeriod: input.statementPeriod ?? null,
  });
  for (const factor of monthly.topFactors.slice(0, EXPLANATION_MAX_FINDINGS)) {
    pushFact(facts, {
      id: `finding.${factor.id}`,
      kind: "money",
      label: factor.label,
      value: roundMoney(factor.total),
    });
  }

  pushFact(facts, {
    id: "ledger.status",
    kind: "status",
    label: "Ledger reconciliation",
    value: activity.ledger.status,
  });

  if (activity.ledger.status !== "reconciled") {
    addNotice(
      "Ledger reconciliation is incomplete — treat explanations carefully."
    );
  }

  let isProvisional = activity.ledger.status !== "reconciled";
  let comparisonStatus: string | null = null;
  let analysisConfidence = confidenceFromActivity(activity);

  if (mode === "comparison" && comparison) {
    comparisonStatus = comparison.status;
    analysisConfidence = comparison.confidence;
    isProvisional =
      comparison.status === "provisional" ||
      comparison.status === "unavailable" ||
      comparison.confidence === "low" ||
      comparison.confidence === "none" ||
      comparison.provisionalNotes.length > 0;

    pushFact(facts, {
      id: "comparison.income",
      kind: "money",
      label: "Money received change",
      value: roundMoney(comparison.moneyReceived.dollarDelta),
    });
    pushFact(facts, {
      id: "comparison.income.percent",
      kind: "percent",
      label: "Money received percent change",
      value: comparison.moneyReceived.percentDelta,
    });
    pushFact(facts, {
      id: "comparison.spent",
      kind: "money",
      label: "Money spent change",
      value: roundMoney(comparison.moneySpent.dollarDelta),
    });
    pushFact(facts, {
      id: "comparison.spent.percent",
      kind: "percent",
      label: "Money spent percent change",
      value: comparison.moneySpent.percentDelta,
    });

    if (comparison.netCashFlow.available && comparison.netCashFlow.dollarDelta != null) {
      pushFact(facts, {
        id: "comparison.net",
        kind: "money",
        label: "Net cash flow change",
        value: roundMoney(comparison.netCashFlow.dollarDelta),
      });
      if (comparison.netCashFlow.percentDelta != null) {
        pushFact(facts, {
          id: "comparison.net.percent",
          kind: "percent",
          label: "Net cash flow percent change",
          value: comparison.netCashFlow.percentDelta,
        });
      }
    } else if (comparison.netCashFlow.unavailableReason) {
      addNotice(comparison.netCashFlow.unavailableReason);
    }

    const catChanges = [...comparison.categories]
      .filter((c) => Math.abs(c.dollarDelta) > 0)
      .sort((a, b) => Math.abs(b.dollarDelta) - Math.abs(a.dollarDelta))
      .slice(0, EXPLANATION_MAX_CATEGORIES);

    for (const cat of catChanges) {
      pushFact(facts, {
        id: `comparison.category.${cat.id}`,
        kind: "money",
        label: `${cat.label} change`,
        value: roundMoney(cat.dollarDelta),
      });
      if (cat.percentDelta != null) {
        pushFact(facts, {
          id: `comparison.category.${cat.id}.percent`,
          kind: "percent",
          label: `${cat.label} percent change`,
          value: cat.percentDelta,
        });
      }
    }

    for (const finding of comparison.rankedFindings.slice(
      0,
      EXPLANATION_MAX_FINDINGS
    )) {
      pushFact(facts, {
        id: `comparison.finding.${finding.id}`,
        kind: "money",
        label: sanitizeLabel(finding.title),
        value:
          finding.dollarDelta != null ? roundMoney(finding.dollarDelta) : null,
      });
    }

    for (const note of comparison.provisionalNotes.slice(0, 3)) {
      addNotice(note);
    }
    addNotice(comparison.statusReason);
  }

  return {
    mode,
    currency: activity.currency || "USD",
    periods: periodSides(mode, input.statementPeriod, comparison),
    reconciliationStatus: activity.ledger.status,
    analysisConfidence,
    comparisonStatus,
    isProvisional,
    facts,
    reliabilityNotices: notices,
  };
}

const ALLOWED_FACT_KEYS = new Set(["id", "kind", "label", "value"]);
const ALLOWED_CONTRACT_KEYS = new Set([
  "mode",
  "currency",
  "periods",
  "reconciliationStatus",
  "analysisConfidence",
  "comparisonStatus",
  "isProvisional",
  "facts",
  "reliabilityNotices",
]);
const ALLOWED_KINDS = new Set<ExplanationFactKind>([
  "money",
  "count",
  "percent",
  "label",
  "status",
  "notice",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Re-validate and re-redact a client-supplied contract. Fail closed.
 */
export function sanitizeIncomingFactContract(
  raw: unknown
): { ok: true; contract: ExplanationFactContract } | { ok: false; reason: string } {
  if (!isPlainObject(raw)) return { ok: false, reason: "not_object" };

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_CONTRACT_KEYS.has(key)) {
      return { ok: false, reason: `unknown_field:${key}` };
    }
  }

  const mode = raw.mode;
  if (mode !== "single" && mode !== "comparison") {
    return { ok: false, reason: "bad_mode" };
  }

  const currency =
    typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency)
      ? raw.currency
      : "USD";

  if (!Array.isArray(raw.periods) || raw.periods.length < 1 || raw.periods.length > 2) {
    return { ok: false, reason: "bad_periods" };
  }

  const periods: ExplanationPeriodSide[] = [];
  for (const p of raw.periods) {
    if (!isPlainObject(p)) return { ok: false, reason: "bad_period" };
    const role = p.role;
    if (role !== "primary" && role !== "earlier" && role !== "later") {
      return { ok: false, reason: "bad_period_role" };
    }
    periods.push({
      role,
      start: typeof p.start === "string" ? p.start.slice(0, 32) : null,
      end: typeof p.end === "string" ? p.end.slice(0, 32) : null,
    });
  }

  if (!Array.isArray(raw.facts) || raw.facts.length > EXPLANATION_MAX_FACTS) {
    return { ok: false, reason: "bad_facts" };
  }

  const facts: ExplanationFact[] = [];
  for (const f of raw.facts) {
    if (!isPlainObject(f)) return { ok: false, reason: "bad_fact" };
    for (const key of Object.keys(f)) {
      if (!ALLOWED_FACT_KEYS.has(key)) {
        return { ok: false, reason: `unknown_fact_field:${key}` };
      }
    }
    if (typeof f.id !== "string" || !/^[a-z][a-z0-9._-]*$/i.test(f.id)) {
      return { ok: false, reason: "bad_fact_id" };
    }
    if (typeof f.kind !== "string" || !ALLOWED_KINDS.has(f.kind as ExplanationFactKind)) {
      return { ok: false, reason: "bad_fact_kind" };
    }
    const label = sanitizeLabel(
      typeof f.label === "string" ? f.label : "Item"
    );
    let value: ExplanationFact["value"] = null;
    if (
      typeof f.value === "number" ||
      typeof f.value === "string" ||
      typeof f.value === "boolean" ||
      f.value === null
    ) {
      if (typeof f.value === "string") {
        const r = redactExplanationText(f.value, EXPLANATION_MAX_LABEL_CHARS);
        if (r.rejected) continue;
        value = r.text;
      } else if (typeof f.value === "number") {
        if (!Number.isFinite(f.value)) return { ok: false, reason: "bad_number" };
        value = roundMoney(f.value);
      } else {
        value = f.value;
      }
    } else {
      return { ok: false, reason: "bad_fact_value" };
    }
    facts.push({
      id: f.id.slice(0, EXPLANATION_MAX_FACT_ID_CHARS),
      kind: f.kind as ExplanationFactKind,
      label,
      value,
    });
  }

  const notices: string[] = [];
  if (Array.isArray(raw.reliabilityNotices)) {
    for (const n of raw.reliabilityNotices.slice(0, EXPLANATION_MAX_NOTICES)) {
      if (typeof n !== "string") continue;
      const r = redactExplanationText(n, EXPLANATION_MAX_NOTICE_CHARS);
      if (!r.rejected && r.text) notices.push(r.text);
    }
  }

  const reconciliationStatus =
    typeof raw.reconciliationStatus === "string"
      ? sanitizeLabel(raw.reconciliationStatus, 40)
      : "unknown";
  const analysisConfidence =
    typeof raw.analysisConfidence === "string"
      ? sanitizeLabel(raw.analysisConfidence, 40)
      : "low";
  const comparisonStatus =
    typeof raw.comparisonStatus === "string"
      ? sanitizeLabel(raw.comparisonStatus, 40)
      : null;

  // Server-derived provisional: never lose caution when status fields say so.
  // Client `isProvisional: false` cannot clear derived provisional signals.
  const derivedProvisional = deriveProvisionalFlag({
    mode,
    reconciliationStatus,
    analysisConfidence,
    comparisonStatus,
    reliabilityNotices: notices,
  });
  const isProvisional = derivedProvisional || Boolean(raw.isProvisional);

  return {
    ok: true,
    contract: {
      mode,
      currency,
      periods,
      reconciliationStatus,
      analysisConfidence,
      comparisonStatus,
      isProvisional,
      facts,
      reliabilityNotices: notices,
    },
  };
}

/**
 * Derive provisional caution from contract status fields and notices.
 * Pure — does not trust client isProvisional alone.
 */
export function deriveProvisionalFlag(args: {
  mode: ExplanationMode;
  reconciliationStatus: string;
  analysisConfidence: string;
  comparisonStatus: string | null;
  reliabilityNotices: string[];
}): boolean {
  const recon = args.reconciliationStatus.toLowerCase();
  if (recon !== "reconciled") return true;

  const confidence = args.analysisConfidence.toLowerCase();
  if (confidence === "low" || confidence === "none") return true;
  if (args.mode === "comparison" && confidence === "medium") return true;

  const status = (args.comparisonStatus || "").toLowerCase();
  if (status === "provisional" || status === "unavailable") return true;

  for (const note of args.reliabilityNotices) {
    if (/provisional|not reliable|incomplete|unreconciled|carefully/i.test(note)) {
      return true;
    }
  }
  return false;
}

/** Collect numeric money/percent values allowed in model output. */
export function allowedNumericLiterals(
  contract: ExplanationFactContract
): { amounts: Set<string>; percents: Set<string> } {
  const amounts = new Set<string>();
  const percents = new Set<string>();

  const addMoney = (n: number) => {
    const r = roundMoney(n);
    amounts.add(r.toFixed(2));
    amounts.add(String(r));
    amounts.add(Math.abs(r).toFixed(2));
    amounts.add(String(Math.abs(r)));
    // Common display forms without trailing zeros
    amounts.add(String(Number(r.toFixed(2))));
    amounts.add(String(Number(Math.abs(r).toFixed(2))));
  };

  for (const fact of contract.facts) {
    if (typeof fact.value !== "number" || !Number.isFinite(fact.value)) continue;
    if (fact.kind === "percent") {
      const p = roundMoney(fact.value);
      percents.add(String(p));
      percents.add(p.toFixed(1));
      percents.add(p.toFixed(2));
      percents.add(String(Math.abs(p)));
    } else if (fact.kind === "money" || fact.kind === "count") {
      addMoney(fact.value);
    }
  }
  return { amounts, percents };
}

export function factIdSet(contract: ExplanationFactContract): Set<string> {
  return new Set(contract.facts.map((f) => f.id));
}

/**
 * Deterministic debit categorization and reconciliation for statement overview.
 * Every accepted debit belongs to exactly one presentation category.
 */
import { clusterMerchantPresentation } from "../merchantNormalization";
import type { MerchantNormalizationResult } from "../merchantNormalization";
import { normalizeMerchantKey } from "../clusters";
import { classifyInsurancePayment } from "../insuranceClassify";
import {
  isDebtFinancingText,
  isHousingPaymentText,
  isUtilityLikeMerchantText,
} from "../expectedBills";
import {
  hasRecurrenceEvidence,
  canPresentMonthlyCadence,
} from "../recurrenceEvidence";
import { inferSpendingInsightCategory } from "../spendingSignals";
import { isRideshareOrDeliveryMerchant } from "./presentationGroups";
import {
  classifyLedgerReconciliation,
  type LedgerReconciliationStatus,
} from "../pipeline/statementSummary";
import type {
  MerchantCluster,
  StatementPeriod,
  SubscriptionInsight,
  Transaction,
} from "../types";

export type StatementDebitCategoryId =
  | "housing"
  | "bills"
  | "insurance"
  | "debt_financing"
  | "subscriptions"
  | "shopping"
  | "dining"
  | "food_delivery_rideshare"
  | "fuel"
  | "software_services"
  | "fees"
  | "transfers_payments"
  | "other";

export type StatementActivityTransaction = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  merchant: string;
  normalizedName: string;
  clusterId: string;
  categoryId: StatementDebitCategoryId;
};

export type StatementActivityCategory = {
  id: StatementDebitCategoryId;
  label: string;
  total: number;
  transactionCount: number;
  percentOfDebits: number;
  topMerchants: Array<{ name: string; total: number; count: number }>;
  transactions: StatementActivityTransaction[];
};

export type StatementBillCard = {
  id: string;
  merchant: string;
  normalizedName: string;
  observedAmount: number;
  chargeCount: number;
  currency: string;
  dateRange: { start: string; end: string } | null;
  cadenceLabel: string | null;
  billKind:
    | "phone"
    | "internet"
    | "utility"
    | "insurance"
    | "housing"
    | "other";
  insuranceSubtype: string | null;
  /** Soft note when a single low charge should not be treated as a full bill. */
  observationNote: string | null;
};

export type StatementSubscriptionCard = {
  id: string;
  merchant: string;
  normalizedName: string;
  status: "confirmed" | "possible";
  chargeCount: number;
  periodTotal: number;
  latestCharge: number;
  currency: string;
  cadenceLabel: string | null;
};

export type StatementAttentionItem = {
  id: string;
  title: string;
  detail: string;
  tone: "fee" | "subscription" | "review" | "bill";
};

export type StatementCreditCategoryId =
  | "payroll"
  | "refunds"
  | "p2p_incoming"
  | "other_deposits";

export type StatementMoneyInTransaction = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  merchant: string;
  normalizedName: string;
  categoryId: StatementCreditCategoryId;
};

export type StatementMoneyInCategory = {
  id: StatementCreditCategoryId;
  label: string;
  total: number;
  transactionCount: number;
  topSources: Array<{ name: string; total: number; count: number }>;
  dateRange: { start: string; end: string } | null;
  transactions: StatementMoneyInTransaction[];
};

export type LedgerGapDiagnostics = {
  depositGapAbs: number | null;
  depositGapPct: number | null;
  withdrawalGapAbs: number | null;
  withdrawalGapPct: number | null;
  largestCredits: Array<{ amount: number; kind: StatementCreditCategoryId }>;
  largestDebits: Array<{ amount: number; kind: StatementDebitCategoryId }>;
  /** Sanitized hints only — no full descriptors. */
  suspiciousForDepositGap: string[];
  suspiciousForWithdrawalGap: string[];
};

export type StatementActivitySummary = {
  currency: string;
  moneyIn: number;
  moneyOut: number;
  netCashFlow: number | null;
  cashFlowReliable: boolean;
  transactionCount: number;
  debitCount: number;
  creditCount: number;
  categories: StatementActivityCategory[];
  moneyInCategories: StatementMoneyInCategory[];
  billCards: StatementBillCard[];
  subscriptionCards: StatementSubscriptionCard[];
  attentionItems: StatementAttentionItem[];
  uncategorized: StatementActivityTransaction[];
  reconciliation: {
    ok: boolean;
    categorySum: number;
    acceptedDebitTotal: number;
    delta: number;
    duplicateDebitKeys: number;
  };
  ledger: {
    status: LedgerReconciliationStatus;
    depositsStatus: LedgerReconciliationStatus;
    withdrawalsStatus: LedgerReconciliationStatus;
    reportedDeposits: number | null;
    reportedWithdrawals: number | null;
    depositsDelta: number | null;
    withdrawalsDelta: number | null;
    cashFlowReliable: boolean;
    diagnostics: LedgerGapDiagnostics;
  };
};

const CATEGORY_LABELS: Record<StatementDebitCategoryId, string> = {
  housing: "Housing",
  bills: "Bills & utilities",
  insurance: "Insurance",
  debt_financing: "Debt & financing",
  subscriptions: "Subscriptions",
  shopping: "Shopping",
  dining: "Dining",
  food_delivery_rideshare: "Delivery / rideshare",
  fuel: "Fuel",
  software_services: "Software / services",
  fees: "Fees",
  transfers_payments: "Transfers / payments",
  other: "Other",
};

/** Display order for overview hierarchy. */
export const STATEMENT_CATEGORY_ORDER: StatementDebitCategoryId[] = [
  "housing",
  "bills",
  "insurance",
  "debt_financing",
  "subscriptions",
  "shopping",
  "dining",
  "food_delivery_rideshare",
  "fuel",
  "software_services",
  "fees",
  "transfers_payments",
  "other",
];

function txnKey(t: Transaction): string {
  return `${t.date}|${t.description}|${t.amount}|${t.type}|${t.currency}`;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function billKindFromText(text: string): StatementBillCard["billKind"] {
  const u = text.toUpperCase();
  if (classifyInsurancePayment(u).isInsurance) return "insurance";
  if (isHousingPaymentText(u)) return "housing";
  if (
    /\b(VERIZON|AT\s*&\s*T|\bATT\b|T[-\s]*MOBILE|SPRINT|MOBILE|WIRELESS|PHONE)\b/u.test(
      u
    )
  ) {
    return "phone";
  }
  if (/\b(COMCAST|XFINITY|SPECTRUM|INTERNET|FIBER|COX\s+CABLE)\b/u.test(u)) {
    return "internet";
  }
  if (
    /\b(ELECTRIC|POWER|WATER|GAS\s+CO|UTILITY|UTILITIES|REPUBLIC\s+SERVICES|WASTE)\b/u.test(
      u
    )
  ) {
    return "utility";
  }
  return "other";
}

function isFeeText(text: string): boolean {
  return /\b(OVERDRAFT|OVERDR\.?|OD\s+F(?:EE|E)|MAINT(?:ENANCE)?\s+FEE|SERVICE\s+FEE|MONTHLY\s+FEE|ACCOUNT\s+FEE|NSF\b|NON[-\s]*SUF|INSUFFICIENT\s+FUNDS|TOTAL\s+OVERDRAFT\s+FEES|TOTAL\s+SERVICE\s+FEES)\b/u.test(
    text.toUpperCase()
  );
}

function isTransferText(text: string): boolean {
  const u = text.toUpperCase();
  if (
    isUtilityLikeMerchantText(u) ||
    classifyInsurancePayment(u).isInsurance ||
    isDebtFinancingText(u) ||
    isHousingPaymentText(u)
  ) {
    return false;
  }
  return (
    /\b(ZELLE|VENMO|CASH\s*APP|CASHAPP|PAYPAL|WIRE\s+TRANSFER|ACH\s+TRANSFER)\b/u.test(
      u
    ) ||
    (/\b(TRANSFER\b|PMNT\s+RCVD|PAYMENT\s+FROM|PAYMENT\s+TO)\b/u.test(u) &&
      !/\b(DES:PAYMENT|UTILITY|ELECTRIC|POWER|INSURANCE|PREM|MORTGAGE)\b/u.test(
        u
      ))
  );
}

function isShoppingText(text: string): boolean {
  return /\b(SAMS(?:'?S|\s)CLUB|SAMSCLUB|TARGET\b|WAL\s*-?\s*MART|WALMART|COSTCO|BEST\s+BUY|HOME\s+DEPOT|LOWE'?S\b|AMAZON\b|RETAIL|PURCHASE|CASH\s*SAVERS|CASHSAVERS|TOTAL\s*TRUCK|TOTALTRUCK|\bPARTS\b.*\b(AUTO|TRUCK)|TRUCK\s*PARTS)\b/ui.test(
    text
  );
}

function isMembershipCharge(text: string): boolean {
  return /\b(MEMBERSHIP|MEMBER\s+FEE|ANNUAL\s+FEE|CLUB\s+FEE|RENEWAL)\b/ui.test(
    text
  );
}

function isFuelText(text: string): boolean {
  return /\b(SHELL\b|EXXON|CHEVRON|\bBP\b|\bMOBIL\b|TEXACO|MARATHON|SPEEDWAY|WAWA\b|QT\b|QUIK\s+TRIP|LOVE'?S\b|\bRACETRAC\b|FUEL\b|GAS\s+STATION)\b/ui.test(
    text
  );
}

function isDiningText(text: string): boolean {
  return /\b(GOLDEN\s+CORRAL|MCDONALD|CHIPOTLE|TACO\s+BELL|SUBWAY|PANDA\s+EXPRESS|RESTAURANT|\bGRILL\b|\bDINER\b|WENDY'?S|BURGER\s+KING|CHILI'?S|APPLEBEE)\b/ui.test(
    text
  );
}

function isSoftwareServiceText(text: string): boolean {
  return /\b(DEEPGRAM|ELEVENLABS|ELEVEN\s*LABS|OPENAI|CHATGPT|ANTHROPIC|GITHUB|GITLAB|NOTION|FIGMA|ADOBE|ZOOM\.US|DROPBOX|HEROKU|VERCEL|AWS|DIGITALOCEAN)\b/ui.test(
    text
  );
}

function isPhoneBillText(text: string): boolean {
  return /\b(VERIZON|AT\s*&\s*T|\bATT\b|T[-\s]*MOBILE|SPRINT)\b/u.test(
    text.toUpperCase()
  );
}

const MONEY_IN_LABELS: Record<StatementCreditCategoryId, string> = {
  payroll: "Payroll",
  refunds: "Refunds",
  p2p_incoming: "Incoming transfers",
  other_deposits: "Other deposits",
};

export const MONEY_IN_CATEGORY_ORDER: StatementCreditCategoryId[] = [
  "payroll",
  "refunds",
  "p2p_incoming",
  "other_deposits",
];

export function classifyCredit(description: string): StatementCreditCategoryId {
  const u = description.toUpperCase();
  if (
    /\bDES:PAYROLL/u.test(u) ||
    /\bPAYROLL(?:\s*ID|\s+DEPOSIT|\b)/u.test(u) ||
    /\bDIRECT\s+DEP(?:OSIT)?\b/u.test(u) ||
    /\bDIR\s+DEP\b/u.test(u) ||
    /\bEMPLOYER\s+PAY\b/u.test(u) ||
    /\bSALARY\b/u.test(u)
  ) {
    return "payroll";
  }
  if (/\bREFUND\b/u.test(u)) return "refunds";
  if (
    /\b(ZELLE|VENMO|CASH\s*APP|CASHAPP|PAYPAL)\b/u.test(u) ||
    /\bPMNT\s+RCVD\b/u.test(u) ||
    /\bPAYMENT\s+FROM\b/u.test(u) ||
    /\bPAYMENT\s+RECEIVED\b/u.test(u)
  ) {
    return "p2p_incoming";
  }
  return "other_deposits";
}

function redactKindHint(description: string): string {
  const u = description.toUpperCase();
  if (/\bDES:PAYROLL/u.test(u)) return "ach-payroll";
  if (/\bDES:PAYMENT/u.test(u)) return "ach-payment";
  if (/\bCHECKCARD/u.test(u)) return "checkcard";
  if (/\bPMNT\s+RCVD/u.test(u)) return "pmnt-rcvd";
  if (/\bCASH\s*APP/u.test(u)) return "cash-app";
  if (/\bZELLE/u.test(u)) return "zelle";
  if (/\bMORT|MTG/u.test(u)) return "mortgage";
  if (/\bSYNCHRONY|AFFIRM|COMENITY/u.test(u)) return "debt-financing";
  if (/\bREFUND/u.test(u)) return "refund";
  return "other";
}

function gapPct(reported: number | null, parsed: number): number | null {
  if (reported == null || reported <= 0) return null;
  return Math.round((Math.abs(reported - parsed) / reported) * 1000) / 10;
}

export function classifyDebit(args: {
  txn: Transaction;
  cluster: MerchantCluster;
  normalizedName: string;
  subscriptionByCluster: Map<string, SubscriptionInsight>;
}): StatementDebitCategoryId {
  const blob = `${args.txn.description} ${args.cluster.key} ${args.normalizedName}`;
  const spendCat = inferSpendingInsightCategory(args.cluster);

  if (isFeeText(blob) || spendCat === "fees") return "fees";
  if (isDebtFinancingText(blob)) return "debt_financing";
  if (isHousingPaymentText(blob)) return "housing";
  if (isTransferText(blob) || spendCat === "transfers") {
    return "transfers_payments";
  }

  const insurance = classifyInsurancePayment(blob);
  if (insurance.isInsurance) return "insurance";

  if (
    (isUtilityLikeMerchantText(blob) || isPhoneBillText(blob)) &&
    !isShoppingText(blob)
  ) {
    return "bills";
  }

  if (isFuelText(blob) || spendCat === "gas") return "fuel";
  if (isDiningText(blob) || spendCat === "restaurants" || spendCat === "cafes") {
    return "dining";
  }

  if (isShoppingText(blob) || spendCat === "retail") {
    if (!isMembershipCharge(blob)) return "shopping";
  }

  if (isSoftwareServiceText(blob)) return "software_services";

  const sub = args.subscriptionByCluster.get(args.cluster.id);
  if (sub) {
    const chargeCount = args.cluster.charges.filter(
      (c) => c.type === "debit"
    ).length;
    const subBlob = `${sub.normalizedName} ${sub.merchant} ${sub.category}`;
    if (
      isDebtFinancingText(subBlob) ||
      isHousingPaymentText(subBlob) ||
      isUtilityLikeMerchantText(subBlob) ||
      isPhoneBillText(subBlob) ||
      classifyInsurancePayment(subBlob).isInsurance ||
      (isShoppingText(subBlob) && !isMembershipCharge(subBlob))
    ) {
      // fall through — never treat these as subscriptions
    } else {
      const confirmed =
        sub.flags.confirmed &&
        hasRecurrenceEvidence(chargeCount) &&
        canPresentMonthlyCadence({ frequency: sub.frequency, chargeCount });
      const possible =
        !confirmed &&
        chargeCount >= 1 &&
        !isShoppingText(blob) &&
        !isMembershipCharge(blob);
      if (confirmed || possible) return "subscriptions";
    }
  }

  if (
    isRideshareOrDeliveryMerchant(blob) ||
    spendCat === "convenience" ||
    spendCat === "groceries"
  ) {
    if (spendCat === "groceries") return "shopping";
    if (spendCat === "convenience") return "shopping";
    return "food_delivery_rideshare";
  }

  return "other";
}

export function buildStatementActivitySummary(input: {
  transactions: Transaction[];
  clusters: MerchantCluster[];
  subscriptions: SubscriptionInsight[];
  statementPeriod: StatementPeriod | null;
  merchantNormByClusterId?: Map<string, MerchantNormalizationResult>;
  statementSummary?: {
    depositsTotal: number | null;
    withdrawalsTotal: number | null;
  } | null;
}): StatementActivitySummary {
  const debits = input.transactions.filter((t) => t.type === "debit");
  const credits = input.transactions.filter((t) => t.type === "credit");
  const currency = debits[0]?.currency ?? credits[0]?.currency ?? "USD";

  const clusterByKey = new Map(input.clusters.map((c) => [c.key, c]));

  const subscriptionByCluster = new Map(
    input.subscriptions.map((s) => [s.clusterId, s])
  );

  function clusterForDebit(txn: Transaction): MerchantCluster | undefined {
    const key = normalizeMerchantKey(txn.description);
    const cluster = clusterByKey.get(key);
    if (!cluster) return undefined;
    const matched = cluster.charges.some(
      (c) =>
        c.date === txn.date &&
        c.type === txn.type &&
        Math.abs(c.amount - txn.amount) < 0.011
    );
    return matched ? cluster : undefined;
  }

  const classified: StatementActivityTransaction[] = [];
  const seenKeys = new Set<string>();
  let duplicateDebitKeys = 0;

  for (const txn of debits) {
    const key = txnKey(txn);
    if (seenKeys.has(key)) {
      duplicateDebitKeys++;
      continue;
    }
    seenKeys.add(key);

    const cluster = clusterForDebit(txn);
    if (!cluster) continue;

    const presentation = clusterMerchantPresentation(
      cluster,
      input.merchantNormByClusterId?.get(cluster.id)
    );

    classified.push({
      id: key,
      date: txn.date,
      amount: txn.amount,
      currency: txn.currency,
      merchant: presentation.merchant,
      normalizedName: presentation.normalizedName,
      clusterId: cluster.id,
      categoryId: classifyDebit({
        txn,
        cluster,
        normalizedName: presentation.normalizedName,
        subscriptionByCluster,
      }),
    });
  }

  const moneyOut = roundMoney(classified.reduce((s, t) => s + t.amount, 0));
  const moneyIn = roundMoney(credits.reduce((s, t) => s + t.amount, 0));

  const ledgerInfo = classifyLedgerReconciliation({
    reportedDeposits: input.statementSummary?.depositsTotal ?? null,
    reportedWithdrawals: input.statementSummary?.withdrawalsTotal ?? null,
    parsedCredits: moneyIn,
    parsedDebits: moneyOut,
  });

  // Money-in classification (credits only — mutually exclusive from debit categories)
  const moneyInRows: StatementMoneyInTransaction[] = credits.map((txn) => {
    const key = txnKey(txn);
    const clusterKey = normalizeMerchantKey(txn.description);
    const cluster = clusterByKey.get(clusterKey);
    const presentation = cluster
      ? clusterMerchantPresentation(
          cluster,
          input.merchantNormByClusterId?.get(cluster.id)
        )
      : {
          merchant: txn.description.slice(0, 48),
          normalizedName: txn.description.slice(0, 48),
        };
    return {
      id: key,
      date: txn.date,
      amount: txn.amount,
      currency: txn.currency,
      merchant: presentation.merchant,
      normalizedName: presentation.normalizedName,
      categoryId: classifyCredit(txn.description),
    };
  });

  const moneyInMap = new Map<
    StatementCreditCategoryId,
    StatementMoneyInTransaction[]
  >();
  for (const id of MONEY_IN_CATEGORY_ORDER) moneyInMap.set(id, []);
  for (const row of moneyInRows) {
    moneyInMap.get(row.categoryId)!.push(row);
  }

  const moneyInCategories: StatementMoneyInCategory[] =
    MONEY_IN_CATEGORY_ORDER.map((id) => {
      const rows = moneyInMap.get(id)!;
      const total = roundMoney(rows.reduce((s, r) => s + r.amount, 0));
      const sourceTotals = new Map<string, { total: number; count: number }>();
      for (const row of rows) {
        const name = row.normalizedName || row.merchant;
        const prev = sourceTotals.get(name) ?? { total: 0, count: 0 };
        sourceTotals.set(name, {
          total: prev.total + row.amount,
          count: prev.count + 1,
        });
      }
      const dates = rows.map((r) => r.date).sort();
      return {
        id,
        label: MONEY_IN_LABELS[id],
        total,
        transactionCount: rows.length,
        topSources: [...sourceTotals.entries()]
          .map(([name, v]) => ({ name, ...v, total: roundMoney(v.total) }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5),
        dateRange:
          dates.length > 0
            ? { start: dates[0]!, end: dates[dates.length - 1]! }
            : null,
        transactions: rows.sort((a, b) => a.date.localeCompare(b.date)),
      };
    });

  const categoryMap = new Map<
    StatementDebitCategoryId,
    StatementActivityTransaction[]
  >();
  for (const id of STATEMENT_CATEGORY_ORDER) {
    categoryMap.set(id, []);
  }
  for (const row of classified) {
    categoryMap.get(row.categoryId)!.push(row);
  }

  const categories: StatementActivityCategory[] = STATEMENT_CATEGORY_ORDER.map(
    (id) => {
      const rows = categoryMap.get(id)!;
      const total = roundMoney(rows.reduce((s, r) => s + r.amount, 0));
      const merchantTotals = new Map<string, { total: number; count: number }>();
      for (const row of rows) {
        const name = row.normalizedName || row.merchant;
        const prev = merchantTotals.get(name) ?? { total: 0, count: 0 };
        merchantTotals.set(name, {
          total: prev.total + row.amount,
          count: prev.count + 1,
        });
      }
      const topMerchants = [...merchantTotals.entries()]
        .map(([name, v]) => ({ name, ...v, total: roundMoney(v.total) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      return {
        id,
        label: CATEGORY_LABELS[id],
        total,
        transactionCount: rows.length,
        percentOfDebits: moneyOut > 0 ? roundMoney((total / moneyOut) * 100) : 0,
        topMerchants,
        transactions: rows.sort((a, b) => a.date.localeCompare(b.date)),
      };
    }
  );

  const billCards: StatementBillCard[] = [];
  const billClusterIds = new Set<string>();
  for (const row of [
    ...categoryMap.get("housing")!,
    ...categoryMap.get("bills")!,
    ...categoryMap.get("insurance")!,
  ]) {
    if (billClusterIds.has(row.clusterId)) continue;
    billClusterIds.add(row.clusterId);
    const cluster = input.clusters.find((c) => c.id === row.clusterId);
    if (!cluster) continue;
    const clusterDebits = cluster.charges.filter((c) => c.type === "debit");
    const dates = clusterDebits.map((c) => c.date).sort();
    const chargeCount = clusterDebits.length;
    const insurance = classifyInsurancePayment(
      `${row.normalizedName} ${row.merchant} ${cluster.key}`
    );
    const kind =
      row.categoryId === "housing"
        ? "housing"
        : billKindFromText(`${row.normalizedName} ${cluster.key}`);
    const sub = subscriptionByCluster.get(row.clusterId);
    const observedAmount = roundMoney(
      clusterDebits.reduce((s, c) => s + c.amount, 0)
    );
    let observationNote: string | null = null;
    if (kind === "insurance" && chargeCount === 1 && observedAmount < 50) {
      observationNote =
        "Single low-value insurance-related charge — not treated as a full premium.";
    }
    billCards.push({
      id: `bill:${row.clusterId}`,
      merchant: row.merchant,
      normalizedName: row.normalizedName,
      observedAmount,
      chargeCount,
      currency: row.currency,
      dateRange:
        dates.length > 0
          ? { start: dates[0]!, end: dates[dates.length - 1]! }
          : null,
      cadenceLabel:
        sub &&
        hasRecurrenceEvidence(chargeCount) &&
        canPresentMonthlyCadence({ frequency: sub.frequency, chargeCount })
          ? sub.frequency === "monthly"
            ? "Monthly"
            : sub.frequency === "annual"
              ? "Annual"
              : sub.frequency === "weekly"
                ? "Weekly"
                : null
          : null,
      billKind: kind,
      insuranceSubtype: insurance.isInsurance
        ? insurance.type === "unknown"
          ? "Insurance — type not confirmed"
          : insurance.type
        : null,
      observationNote,
    });
  }

  const billNameKeys = new Set(
    billCards.map((b) => b.normalizedName.trim().toUpperCase())
  );

  const subscriptionCards: StatementSubscriptionCard[] = input.subscriptions
    .filter((sub) => {
      const blob = `${sub.normalizedName} ${sub.merchant} ${sub.category}`;
      if (isShoppingText(blob) && !isMembershipCharge(blob)) return false;
      if (classifyInsurancePayment(blob).isInsurance) return false;
      if (isUtilityLikeMerchantText(blob) || isPhoneBillText(blob)) return false;
      if (isDebtFinancingText(blob) || isHousingPaymentText(blob)) return false;
      if (billNameKeys.has(sub.normalizedName.trim().toUpperCase())) return false;
      if (isTransferText(blob)) return false;
      return true;
    })
    .map((sub) => {
      const cluster = input.clusters.find((c) => c.id === sub.clusterId);
      const chargeCount =
        cluster?.charges.filter((c) => c.type === "debit").length ?? 1;
      const confirmed =
        sub.flags.confirmed &&
        hasRecurrenceEvidence(chargeCount) &&
        canPresentMonthlyCadence({ frequency: sub.frequency, chargeCount });
      return {
        id: `sub:${sub.clusterId}`,
        merchant: sub.merchant,
        normalizedName: sub.normalizedName,
        status: confirmed ? "confirmed" : "possible",
        chargeCount,
        periodTotal: sub.totalSpentInPeriod,
        latestCharge: sub.amount,
        currency: sub.currency,
        cadenceLabel: confirmed
          ? sub.frequency === "monthly"
            ? "Monthly"
            : sub.frequency === "annual"
              ? "Annual"
              : sub.frequency === "weekly"
                ? "Weekly"
                : null
          : null,
      };
    });

  const attentionItems: StatementAttentionItem[] = [];
  for (const cat of categories.filter((c) => c.id === "fees" && c.total > 0)) {
    attentionItems.push({
      id: "fees",
      title: "Observed bank fees",
      detail: `${cat.transactionCount} fee line${cat.transactionCount === 1 ? "" : "s"} totaling ${cat.total.toFixed(2)} ${currency} on this statement.`,
      tone: "fee",
    });
  }
  for (const sub of subscriptionCards.filter((s) => s.status === "possible")) {
    attentionItems.push({
      id: `possible-sub:${sub.id}`,
      title: `Possible subscription: ${sub.normalizedName}`,
      detail: `${sub.chargeCount} charge${sub.chargeCount === 1 ? "" : "s"} detected · recurrence not confirmed.`,
      tone: "subscription",
    });
  }
  for (const row of categoryMap.get("other")!.slice(0, 2)) {
    attentionItems.push({
      id: `other:${row.id}`,
      title: `Review: ${row.normalizedName}`,
      detail: `Observed ${row.amount.toFixed(2)} ${row.currency} — categorized as other activity.`,
      tone: "review",
    });
  }

  const categorySum = roundMoney(categories.reduce((s, c) => s + c.total, 0));
  const uncategorized = categoryMap.get("other")!;

  const reportedDep = input.statementSummary?.depositsTotal ?? null;
  const reportedWd = input.statementSummary?.withdrawalsTotal ?? null;
  const depositGapAbs =
    reportedDep == null ? null : roundMoney(Math.abs(moneyIn - reportedDep));
  const withdrawalGapAbs =
    reportedWd == null ? null : roundMoney(Math.abs(moneyOut - reportedWd));

  const diagnostics: LedgerGapDiagnostics = {
    depositGapAbs,
    depositGapPct: gapPct(reportedDep, moneyIn),
    withdrawalGapAbs,
    withdrawalGapPct: gapPct(reportedWd, moneyOut),
    largestCredits: [...moneyInRows]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((r) => ({ amount: r.amount, kind: r.categoryId })),
    largestDebits: [...classified]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((r) => ({ amount: r.amount, kind: r.categoryId })),
    suspiciousForDepositGap: [
      ...(depositGapAbs != null && depositGapAbs > 50
        ? ["deposit-gap-remaining-after-payroll-credits"]
        : []),
      ...credits
        .filter((c) => classifyCredit(c.description) === "other_deposits")
        .slice(0, 3)
        .map((c) => `credit:${redactKindHint(c.description)}`),
    ].slice(0, 6),
    suspiciousForWithdrawalGap: [
      ...(withdrawalGapAbs != null && moneyOut > (reportedWd ?? 0)
        ? ["parsed-debits-exceed-reported-withdrawals"]
        : []),
      ...classified
        .filter((r) => r.categoryId === "other" || r.amount >= 400)
        .slice(0, 5)
        .map((r) => `debit:${r.categoryId}:${redactKindHint(r.merchant)}`),
    ].slice(0, 8),
  };

  if (process.env.NODE_ENV !== "production") {
    console.log(
      "[statement-ledger]",
      JSON.stringify({
        parsedCredits: moneyIn,
        reportedDeposits: reportedDep,
        depositGapAbs,
        depositGapPct: diagnostics.depositGapPct,
        parsedDebits: moneyOut,
        reportedWithdrawals: reportedWd,
        withdrawalGapAbs,
        withdrawalGapPct: diagnostics.withdrawalGapPct,
        status: ledgerInfo.status,
        largestCredits: diagnostics.largestCredits,
        largestDebits: diagnostics.largestDebits,
        suspiciousForDepositGap: diagnostics.suspiciousForDepositGap,
        suspiciousForWithdrawalGap: diagnostics.suspiciousForWithdrawalGap,
      })
    );
  } else {
    console.log("[statement-ledger]", {
      status: ledgerInfo.status,
      depositGapAbs,
      withdrawalGapAbs,
      creditCount: credits.length,
      debitCount: classified.length,
    });
  }

  return {
    currency,
    moneyIn,
    moneyOut,
    netCashFlow: ledgerInfo.cashFlowReliable
      ? roundMoney(moneyIn - moneyOut)
      : null,
    cashFlowReliable: ledgerInfo.cashFlowReliable,
    transactionCount: input.transactions.length,
    debitCount: debits.length,
    creditCount: credits.length,
    categories,
    moneyInCategories,
    billCards,
    subscriptionCards,
    attentionItems: attentionItems.slice(0, 5),
    uncategorized,
    reconciliation: {
      ok: Math.abs(categorySum - moneyOut) < 0.01,
      categorySum,
      acceptedDebitTotal: moneyOut,
      delta: roundMoney(categorySum - moneyOut),
      duplicateDebitKeys,
    },
    ledger: {
      status: ledgerInfo.status,
      depositsStatus: ledgerInfo.depositsStatus,
      withdrawalsStatus: ledgerInfo.withdrawalsStatus,
      reportedDeposits: reportedDep,
      reportedWithdrawals: reportedWd,
      depositsDelta: ledgerInfo.depositsDelta,
      withdrawalsDelta: ledgerInfo.withdrawalsDelta,
      cashFlowReliable: ledgerInfo.cashFlowReliable,
      diagnostics,
    },
  };
}

export function reconcileStatementActivity(
  summary: StatementActivitySummary
): StatementActivitySummary["reconciliation"] {
  return summary.reconciliation;
}

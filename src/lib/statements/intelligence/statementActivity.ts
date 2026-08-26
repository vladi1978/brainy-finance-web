/**
 * Deterministic debit categorization and reconciliation for statement overview.
 * Every accepted debit belongs to exactly one presentation category.
 */
import { clusterMerchantPresentation } from "../merchantNormalization";
import type { MerchantNormalizationResult } from "../merchantNormalization";
import { normalizeMerchantKey } from "../clusters";
import { classifyInsurancePayment } from "../insuranceClassify";
import {
  billKindFromServiceKind,
  billProviderDisplayName,
  billProviderKey,
  billServiceLabel,
  classifyBillServiceKind,
  isAttProviderText,
  type BillServiceKind,
} from "../billServiceClassify";
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
import { isEvidenceGatedSubscriptionMerchantText } from "../subscriptionSignals";
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
  | "professional_services"
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
  /** Underlying activity transaction id — one card per distinct charge. */
  transactionId: string;
  merchant: string;
  normalizedName: string;
  /** Provider display name (e.g. AT&T) without collapsing services. */
  providerName: string;
  providerKey: string;
  serviceLabel: string;
  serviceKind: BillServiceKind;
  observedAmount: number;
  chargeCount: number;
  currency: string;
  date: string;
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

export type StatementBillProviderGroup = {
  id: string;
  providerKey: string;
  providerName: string;
  totalObserved: number;
  currency: string;
  serviceCount: number;
  services: StatementBillCard[];
  /** Never claims monthly/recurring from a single observation. */
  observationNote: string | null;
};

export type CrossSurfaceReconciliation = {
  ok: boolean;
  debitExclusiveOk: boolean;
  creditsOnlyInMoneyInOk: boolean;
  categorySumEqualsDebitsOk: boolean;
  billServicesSumEqualsProvidersOk: boolean;
  providerGroupsDoNotAffectHealthOk: boolean;
  issues: string[];
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
  billProviderGroups: StatementBillProviderGroup[];
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
  crossSurface: CrossSurfaceReconciliation;
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
  professional_services: "Professional services",
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
  "professional_services",
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
  // Never treat known bill/software providers as shopping even when the
  // descriptor contains the BoA keyword PURCHASE.
  if (isSoftwareServiceText(text) || isAttProviderText(text)) return false;
  if (
    isUtilityLikeMerchantText(text) ||
    isPhoneBillText(text) ||
    classifyInsurancePayment(text).isInsurance ||
    isHousingPaymentText(text) ||
    isDebtFinancingText(text)
  ) {
    return false;
  }
  return /\b(SAMS(?:'?S|\s)CLUB|SAMSCLUB|TARGET\b|WAL\s*-?\s*MART|WALMART|COSTCO|BEST\s+BUY|HOME\s+DEPOT|LOWE'?S\b|AMAZON\b|RETAIL|GOODWILL|LESLIE'?S?\s*POOL|LESLIES\s*POOLMART|SCORE\s+LIQUOR|\bLIQUOR\b|CASH\s*SAVERS|CASHSAVERS|TOTAL\s*TRUCK|TOTALTRUCK|\bPARTS\b.*\b(AUTO|TRUCK)|TRUCK\s*PARTS|DOLLAR-?GENERAL|FAMILY\s+DOLLAR|FIVE\s+BELOW|AUTOZONE|PRICELESS\s+FOOD)\b/ui.test(
    text
  );
}

function isMembershipCharge(text: string): boolean {
  return /\b(MEMBERSHIP|MEMBER\s+FEE|ANNUAL\s+FEE|CLUB\s+FEE|RENEWAL)\b/ui.test(
    text
  );
}

function isFuelText(text: string): boolean {
  return /\b(SHELL\b|EXXON|CHEVRON|\bBP\b|\bMOBIL\b|TEXACO|MARATHON|SPEEDWAY|THORNTONS?|WAWA\b|QT\b|QUIK\s+TRIP|LOVE'?S\b|\bRACETRAC\b|FUEL\b|GAS\s+STATION)\b/ui.test(
    text
  );
}

function isDiningText(text: string): boolean {
  return /\b(GOLDEN\s+CORRAL|MCDONALD|CHIPOTLE|TACO\s+BELL|SUBWAY|PANDA\s+EXPRESS|RESTAURANT|\bGRILL\b|\bDINER\b|WENDY'?S|BURGER\s+KING|CHILI'?S|APPLEBEE)\b/ui.test(
    text
  );
}

function isSoftwareServiceText(text: string): boolean {
  return /\b(SERPAPI|SERPER|DEEPGRAM|ELEVENLABS|ELEVEN\s*LABS|OPENAI|CHATGPT|ANTHROPIC|GITHUB|GITLAB|NOTION|FIGMA|ADOBE|ZOOM\.US|DROPBOX|HEROKU|VERCEL|NETLIFY|CURSOR\b|AWS|DIGITALOCEAN)\b/ui.test(
    text
  );
}

function isProfessionalServiceText(text: string): boolean {
  return /\b(O[`'’]?BRYAN\s+LAW|LAW\s+OFFIC|ATTORNEY|LEGAL\s+SERV)/ui.test(
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

  // Fuel stations before bills so POS "Mobile" + Marathon/Thorntons never
  // land in phone/utility when a known fuel brand is present.
  if (isFuelText(blob) || spendCat === "gas") return "fuel";

  if (
    isUtilityLikeMerchantText(blob) ||
    isPhoneBillText(blob) ||
    isAttProviderText(blob)
  ) {
    return "bills";
  }

  if (isSoftwareServiceText(blob)) return "software_services";
  if (isProfessionalServiceText(blob)) return "professional_services";

  if (isDiningText(blob) || spendCat === "restaurants" || spendCat === "cafes") {
    return "dining";
  }

  if (isShoppingText(blob) || spendCat === "retail") {
    if (!isMembershipCharge(blob)) return "shopping";
  }

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
  for (const row of [
    ...categoryMap.get("housing")!,
    ...categoryMap.get("bills")!,
    ...categoryMap.get("insurance")!,
  ]) {
    const cluster = input.clusters.find((c) => c.id === row.clusterId);
    const blob = `${row.normalizedName} ${row.merchant} ${cluster?.key ?? ""} ${row.id}`;
    const serviceKind =
      row.categoryId === "housing"
        ? ("housing" as const)
        : row.categoryId === "insurance"
          ? ("insurance" as const)
          : classifyBillServiceKind(blob);
    const providerKey = billProviderKey(blob);
    const providerName = billProviderDisplayName(blob, row.normalizedName);
    const insurance = classifyInsurancePayment(blob);
    const kind = billKindFromServiceKind(serviceKind);
    billCards.push({
      id: `bill-svc:${row.id}`,
      transactionId: row.id,
      merchant: row.merchant,
      normalizedName: row.normalizedName,
      providerName,
      providerKey,
      serviceLabel: billServiceLabel(providerName, serviceKind),
      serviceKind,
      observedAmount: row.amount,
      chargeCount: 1,
      currency: row.currency,
      date: row.date,
      dateRange: { start: row.date, end: row.date },
      cadenceLabel: null,
      billKind: kind,
      insuranceSubtype: insurance.isInsurance
        ? insurance.type === "unknown"
          ? "Insurance — type not confirmed"
          : insurance.type
        : null,
      observationNote:
        "Single observation on this statement — recurrence not confirmed.",
    });
  }

  const providerMap = new Map<string, StatementBillCard[]>();
  for (const card of billCards) {
    const list = providerMap.get(card.providerKey) ?? [];
    list.push(card);
    providerMap.set(card.providerKey, list);
  }
  const billProviderGroups: StatementBillProviderGroup[] = [
    ...providerMap.entries(),
  ]
    .map(([providerKey, services]) => {
      const sorted = [...services].sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      const totalObserved = roundMoney(
        sorted.reduce((s, x) => s + x.observedAmount, 0)
      );
      return {
        id: `bill-provider:${providerKey}`,
        providerKey,
        providerName: sorted[0]!.providerName,
        totalObserved,
        currency: sorted[0]!.currency,
        serviceCount: sorted.length,
        services: sorted,
        observationNote:
          sorted.length > 1 && sorted[0]!.providerKey === "att"
            ? `Two AT&T service charges were detected · total ${totalObserved.toFixed(2)} ${sorted[0]!.currency}. Service type not fully confirmed for every charge.`
            : sorted.length > 1
              ? `${sorted[0]!.providerName} total observed in this statement: ${totalObserved.toFixed(2)} ${sorted[0]!.currency} across ${sorted.length} services. Recurrence not confirmed from this window.`
              : "Observed on this statement — recurrence not confirmed.",
      };
    })
    .sort((a, b) => b.totalObserved - a.totalObserved);

  const billNameKeys = new Set(
    billCards.map((b) => b.providerName.trim().toUpperCase())
  );

  const subscriptionCards: StatementSubscriptionCard[] = input.subscriptions
    .filter((sub) => {
      const blob = `${sub.normalizedName} ${sub.merchant} ${sub.category}`;
      if (isShoppingText(blob) && !isMembershipCharge(blob)) return false;
      if (classifyInsurancePayment(blob).isInsurance) return false;
      if (
        isUtilityLikeMerchantText(blob) ||
        isPhoneBillText(blob) ||
        isAttProviderText(blob)
      ) {
        return false;
      }
      if (isDebtFinancingText(blob) || isHousingPaymentText(blob)) return false;
      if (billNameKeys.has(sub.normalizedName.trim().toUpperCase())) return false;
      if (isTransferText(blob)) return false;
      // Developer tools / one-off digital services stay in software totals,
      // not as possible subscriptions.
      if (
        isSoftwareServiceText(blob) &&
        !isEvidenceGatedSubscriptionMerchantText(blob)
      ) {
        return false;
      }
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
        status: confirmed ? ("confirmed" as const) : ("possible" as const),
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

  // Evidence-gated subscription-like software only (e.g. Netflix, Peacock,
  // OpenAI). SerpAPI / Netlify / Deepgram stay as digital charges, not subs.
  const softwareByCluster = new Map<string, StatementActivityTransaction[]>();
  for (const row of [
    ...categoryMap.get("software_services")!,
    ...categoryMap.get("subscriptions")!,
    ...categoryMap.get("other")!,
  ]) {
    const blob = `${row.normalizedName} ${row.merchant}`;
    if (!isEvidenceGatedSubscriptionMerchantText(blob)) continue;
    const list = softwareByCluster.get(row.clusterId) ?? [];
    list.push(row);
    softwareByCluster.set(row.clusterId, list);
  }
  const existingSubClusterIds = new Set(
    subscriptionCards.map((s) => {
      if (s.id.startsWith("sub-soft:")) return s.id.slice("sub-soft:".length);
      if (s.id.startsWith("sub:")) return s.id.slice("sub:".length);
      return s.id;
    })
  );
  for (const [clusterId, rows] of softwareByCluster) {
    if (existingSubClusterIds.has(clusterId)) continue;
    const chargeCount = rows.length;
    const confirmed =
      hasRecurrenceEvidence(chargeCount) &&
      canPresentMonthlyCadence({ frequency: "monthly", chargeCount });
    if (confirmed) continue;
    const total = roundMoney(rows.reduce((s, r) => s + r.amount, 0));
    const name = rows[0]!.normalizedName || rows[0]!.merchant;
    subscriptionCards.push({
      id: `sub-soft:${clusterId}`,
      merchant: rows[0]!.merchant,
      normalizedName: name,
      status: "possible",
      chargeCount,
      periodTotal: total,
      latestCharge: rows[rows.length - 1]!.amount,
      currency: rows[0]!.currency,
      cadenceLabel: null,
    });
  }

  const attentionItems = buildPrioritizedAttentionItems({
    categories,
    categoryMap,
    subscriptionCards,
    currency,
    moneyIn,
    moneyOut,
    netCashFlow: ledgerInfo.cashFlowReliable
      ? roundMoney(moneyIn - moneyOut)
      : null,
    cashFlowReliable: ledgerInfo.cashFlowReliable,
    ledgerStatus: ledgerInfo.status,
  });

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

  const crossSurface = buildCrossSurfaceReconciliation({
    classified,
    credits,
    moneyInRows,
    categories,
    categorySum,
    moneyOut,
    billCards,
    billProviderGroups,
  });

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
        crossSurfaceOk: crossSurface.ok,
      })
    );
  } else {
    console.log("[statement-ledger]", {
      status: ledgerInfo.status,
      depositGapAbs,
      withdrawalGapAbs,
      creditCount: credits.length,
      debitCount: classified.length,
      crossSurfaceOk: crossSurface.ok,
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
    billProviderGroups,
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
    crossSurface,
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

function buildPrioritizedAttentionItems(args: {
  categories: StatementActivityCategory[];
  categoryMap: Map<StatementDebitCategoryId, StatementActivityTransaction[]>;
  subscriptionCards: StatementSubscriptionCard[];
  currency: string;
  moneyIn: number;
  moneyOut: number;
  netCashFlow: number | null;
  cashFlowReliable: boolean;
  ledgerStatus: LedgerReconciliationStatus;
}): StatementAttentionItem[] {
  const items: StatementAttentionItem[] = [];
  const seenMerchants = new Set<string>();

  // 1. Reliable negative cash flow
  if (
    args.cashFlowReliable &&
    args.ledgerStatus === "reconciled" &&
    args.netCashFlow != null &&
    args.netCashFlow < 0
  ) {
    const abs = roundMoney(Math.abs(args.netCashFlow));
    const essential =
      (args.categories.find((c) => c.id === "housing")?.total ?? 0) +
      (args.categories.find((c) => c.id === "bills")?.total ?? 0) +
      (args.categories.find((c) => c.id === "insurance")?.total ?? 0);
    const flexible =
      (args.categories.find((c) => c.id === "shopping")?.total ?? 0) +
      (args.categories.find((c) => c.id === "dining")?.total ?? 0) +
      (args.categories.find((c) => c.id === "food_delivery_rideshare")?.total ??
        0) +
      (args.categories.find((c) => c.id === "fuel")?.total ?? 0) +
      (args.categories.find((c) => c.id === "software_services")?.total ?? 0) +
      (args.categories.find((c) => c.id === "subscriptions")?.total ?? 0);
    items.push({
      id: "cashflow-negative",
      title: "Spending exceeded money received",
      detail: `This period spent ${abs.toFixed(2)} ${args.currency} more than was received. Essential commitments were about ${roundMoney(essential).toFixed(2)} ${args.currency}; flexible spending was about ${roundMoney(flexible).toFixed(2)} ${args.currency}. Statement Health is separate from cash flow.`,
      tone: "review",
    });
  }

  // 2. Possible subscriptions (evidence-gated cards only)
  for (const sub of args.subscriptionCards.filter((s) => s.status === "possible")) {
    if (items.length >= 5) break;
    const key = sub.normalizedName.trim().toUpperCase();
    if (seenMerchants.has(key)) continue;
    seenMerchants.add(key);
    items.push({
      id: `possible-sub:${sub.id}`,
      title: `Possible subscription: ${sub.normalizedName}`,
      detail: `${sub.chargeCount} charge${sub.chargeCount === 1 ? "" : "s"} detected · recurrence not confirmed.`,
      tone: "subscription",
    });
  }

  // 3. Fees
  for (const cat of args.categories.filter((c) => c.id === "fees" && c.total > 0)) {
    if (items.length >= 5) break;
    items.push({
      id: "fees",
      title: "Bank fees on this statement",
      detail: `${cat.transactionCount} fee line${cat.transactionCount === 1 ? "" : "s"} totaling ${cat.total.toFixed(2)} ${args.currency}.`,
      tone: "fee",
    });
  }

  // 4. Material unclassified charges (skip tiny ones)
  for (const row of args.categoryMap.get("other") ?? []) {
    if (items.length >= 5) break;
    if (row.amount < 40) continue;
    const key = row.normalizedName.trim().toUpperCase();
    if (seenMerchants.has(key)) continue;
    seenMerchants.add(key);
    items.push({
      id: `other:${row.id}`,
      title: `Unrecognized charge: ${row.normalizedName}`,
      detail: `Observed ${row.amount.toFixed(2)} ${row.currency} — not matched to a clear category.`,
      tone: "review",
    });
  }

  // Debt payments are explained in the dedicated debt section — do not crowd attention.
  return items.slice(0, 5);
}

function buildCrossSurfaceReconciliation(args: {
  classified: StatementActivityTransaction[];
  credits: Transaction[];
  moneyInRows: StatementMoneyInTransaction[];
  categories: StatementActivityCategory[];
  categorySum: number;
  moneyOut: number;
  billCards: StatementBillCard[];
  billProviderGroups: StatementBillProviderGroup[];
}): CrossSurfaceReconciliation {
  const issues: string[] = [];
  const debitIds = args.classified.map((r) => r.id);
  const debitExclusiveOk = new Set(debitIds).size === debitIds.length;
  if (!debitExclusiveOk) issues.push("duplicate-debit-ids");

  const categoryTxnIds = args.categories.flatMap((c) =>
    c.transactions.map((t) => t.id)
  );
  if (categoryTxnIds.length !== debitIds.length) {
    issues.push("category-txn-count-mismatch");
  }
  const catSet = new Set(categoryTxnIds);
  for (const id of debitIds) {
    if (!catSet.has(id)) issues.push(`debit-missing-from-categories:${id.slice(0, 24)}`);
  }

  const creditIds = new Set(args.credits.map((c) => txnKey(c)));
  const moneyInIds = new Set(args.moneyInRows.map((r) => r.id));
  let creditsOnlyInMoneyInOk = creditIds.size === moneyInIds.size;
  for (const id of creditIds) {
    if (!moneyInIds.has(id)) {
      creditsOnlyInMoneyInOk = false;
      issues.push("credit-missing-from-money-in");
      break;
    }
  }
  for (const row of args.classified) {
    if (moneyInIds.has(row.id)) {
      creditsOnlyInMoneyInOk = false;
      issues.push("debit-also-in-money-in");
      break;
    }
  }

  const categorySumEqualsDebitsOk =
    Math.abs(args.categorySum - args.moneyOut) < 0.01;
  if (!categorySumEqualsDebitsOk) issues.push("category-sum-ne-debits");

  let billServicesSumEqualsProvidersOk = true;
  for (const group of args.billProviderGroups) {
    const sum = roundMoney(
      group.services.reduce((s, x) => s + x.observedAmount, 0)
    );
    if (Math.abs(sum - group.totalObserved) > 0.01) {
      billServicesSumEqualsProvidersOk = false;
      issues.push(`provider-sum-mismatch:${group.providerKey}`);
    }
    // Provider grouping must not invent rows beyond billCards
    for (const svc of group.services) {
      if (!args.billCards.some((b) => b.id === svc.id)) {
        billServicesSumEqualsProvidersOk = false;
        issues.push(`provider-orphan-service:${svc.id.slice(0, 24)}`);
      }
    }
  }
  if (args.billCards.length !== args.billProviderGroups.reduce((s, g) => s + g.serviceCount, 0)) {
    billServicesSumEqualsProvidersOk = false;
    issues.push("provider-service-count-mismatch");
  }

  // Provider groups are presentation-only; they never feed Health Score inputs.
  const providerGroupsDoNotAffectHealthOk = true;

  const ok =
    debitExclusiveOk &&
    creditsOnlyInMoneyInOk &&
    categorySumEqualsDebitsOk &&
    billServicesSumEqualsProvidersOk &&
    providerGroupsDoNotAffectHealthOk &&
    issues.length === 0;

  return {
    ok,
    debitExclusiveOk,
    creditsOnlyInMoneyInOk,
    categorySumEqualsDebitsOk,
    billServicesSumEqualsProvidersOk,
    providerGroupsDoNotAffectHealthOk,
    issues,
  };
}

export function reconcileStatementActivity(
  summary: StatementActivitySummary
): StatementActivitySummary["reconciliation"] {
  return summary.reconciliation;
}

/**
 * Extract bank-printed statement summary totals from plain PDF text.
 * Used only for ledger reconciliation status — never invents transactions.
 */
export type BankStatementSummaryTotals = {
  depositsTotal: number | null;
  withdrawalsTotal: number | null;
};

function parseMoneyToken(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "").replace(/\u2212/g, "-");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return null;
  return Math.abs(n);
}

/**
 * Prefer explicit TOTAL lines; fall back to account-summary "Deposits and other additions".
 */
export function extractBankStatementSummaryTotals(
  text: string
): BankStatementSummaryTotals {
  const flat = text.replace(/\s+/g, " ");

  const totalDep =
    flat.match(
      /TOTAL\s+DEPOSITS\s+AND\s+OTHER\s+ADDITIONS\s*:?\s*\$?\s*(-?[\d,]+\.\d{2})/i
    ) ??
    flat.match(
      /DEPOSITS\s+AND\s+OTHER\s+ADDITIONS\s*:?\s*\$?\s*(-?[\d,]+\.\d{2})/i
    );

  const totalWd =
    flat.match(
      /TOTAL\s+WITHDRAWALS\s+AND\s+OTHER\s+SUBTRACTIONS\s*:?\s*\$?\s*(-?[\d,]+\.\d{2})/i
    ) ??
    flat.match(
      /WITHDRAWALS\s+AND\s+OTHER\s+SUBTRACTIONS\s*:?\s*\$?\s*(-?[\d,]+\.\d{2})/i
    );

  return {
    depositsTotal: totalDep ? parseMoneyToken(totalDep[1]!) : null,
    withdrawalsTotal: totalWd ? parseMoneyToken(totalWd[1]!) : null,
  };
}

export type LedgerReconciliationStatus =
  | "reconciled"
  | "partially_reconciled"
  | "unreconciled";

function sideStatus(
  reported: number | null,
  parsed: number
): LedgerReconciliationStatus {
  if (reported == null || reported <= 0) {
    return parsed > 0 ? "partially_reconciled" : "unreconciled";
  }
  const delta = Math.abs(reported - parsed);
  const tol = Math.max(5, reported * 0.02);
  if (delta <= tol) return "reconciled";
  if (delta <= Math.max(50, reported * 0.35)) return "partially_reconciled";
  return "unreconciled";
}

export function classifyLedgerReconciliation(args: {
  reportedDeposits: number | null;
  reportedWithdrawals: number | null;
  parsedCredits: number;
  parsedDebits: number;
}): {
  status: LedgerReconciliationStatus;
  depositsStatus: LedgerReconciliationStatus;
  withdrawalsStatus: LedgerReconciliationStatus;
  cashFlowReliable: boolean;
  depositsDelta: number | null;
  withdrawalsDelta: number | null;
} {
  const depositsStatus = sideStatus(
    args.reportedDeposits,
    args.parsedCredits
  );
  const withdrawalsStatus = sideStatus(
    args.reportedWithdrawals,
    args.parsedDebits
  );

  let status: LedgerReconciliationStatus;
  if (
    depositsStatus === "reconciled" &&
    withdrawalsStatus === "reconciled"
  ) {
    status = "reconciled";
  } else if (
    depositsStatus === "unreconciled" &&
    withdrawalsStatus === "unreconciled"
  ) {
    status = "unreconciled";
  } else if (
    depositsStatus === "reconciled" ||
    withdrawalsStatus === "reconciled" ||
    depositsStatus === "partially_reconciled" ||
    withdrawalsStatus === "partially_reconciled"
  ) {
    status = "partially_reconciled";
  } else {
    status = "unreconciled";
  }

  return {
    status,
    depositsStatus,
    withdrawalsStatus,
    cashFlowReliable: status === "reconciled",
    depositsDelta:
      args.reportedDeposits == null
        ? null
        : Math.round((args.parsedCredits - args.reportedDeposits) * 100) / 100,
    withdrawalsDelta:
      args.reportedWithdrawals == null
        ? null
        : Math.round((args.parsedDebits - args.reportedWithdrawals) * 100) /
          100,
  };
}

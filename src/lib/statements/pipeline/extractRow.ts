import type { Transaction } from "../types";
import { AMOUNT_TOKEN } from "./constants";
import {
  parseAmountFragment,
  peelTrailingAmounts,
  peelTrailingAmountsTight,
} from "./amounts";
import {
  matchDateSubstring,
  stripLeadingDateRuns,
  stripLeadingNoise,
} from "./dates";
import { NOISE_DESCRIPTION } from "./noise";

export type ParsedRow = Transaction & { strategy: string };

function debitCreditFromDescription(
  description: string,
  amountRaw: string
): { type: "debit" | "credit"; signedValue: number; parsed: NonNullable<ReturnType<typeof parseAmountFragment>> } | null {
  const parsed = parseAmountFragment(amountRaw);
  if (!parsed || parsed.value === 0) return null;

  const upper = description.toUpperCase();
  const creditHints =
    /\b(CR|CREDIT|CREDITS|DEPOSIT|PAYMENT RECEIVED|REFUND|ABONO)\b/u.test(
      upper
    ) || /\bCR$/u.test(amountRaw.trim());
  const debitHints =
    /\b(DR|DEBIT|DEBITS|PURCHASE|PAYMENT|WITHDRAWAL|CHARGE|ATM|COMPRA)\b/u.test(
      upper
    ) || /\bDR$/u.test(amountRaw.trim());

  let type: "debit" | "credit";
  if (creditHints && !debitHints) type = "credit";
  else if (debitHints && !creditHints) type = "debit";
  else type = "debit";

  return { type, signedValue: parsed.value, parsed };
}

function tryLeadingDateTailAmount(
  block: string,
  defaultYear: number,
  strategyBase: string
): ParsedRow | null {
  const hit = matchDateSubstring(block.trim(), defaultYear);
  if (!hit) return null;

  let afterDate = (block.slice(0, hit.start) + block.slice(hit.end)).trim();
  afterDate = afterDate.replace(/\s{2,}/gu, " ");
  afterDate = stripLeadingDateRuns(afterDate, defaultYear);
  if (afterDate.length < 2) return null;

  let peeled = peelTrailingAmounts(afterDate, 2);
  if (peeled.amounts.length === 0) peeled = peelTrailingAmountsTight(afterDate);

  if (peeled.amounts.length === 0) return null;

  let primaryRaw = peeled.amounts[peeled.amounts.length - 1];
  let primaryParsed = parseAmountFragment(primaryRaw);
  if (
    (!primaryParsed || primaryParsed.value === 0) &&
    peeled.amounts.length >= 2
  ) {
    primaryRaw = peeled.amounts[peeled.amounts.length - 2];
    primaryParsed = parseAmountFragment(primaryRaw);
  }
  if (!primaryParsed || primaryParsed.value === 0) return null;

  const descCore = peeled.prefix.trim();

  if (NOISE_DESCRIPTION.test(descCore)) return null;

  const dc = debitCreditFromDescription(descCore, primaryRaw);
  if (!dc) return null;

  let strategy = strategyBase;
  if (peeled.amounts.length === 2) strategy = `${strategyBase}+dual-peel`;

  return {
    date: hit.iso,
    description: descCore.replace(/\s{2,}/gu, " "),
    amount: Math.abs(dc.signedValue),
    type: dc.type,
    currency: primaryParsed.currency,
    strategy,
  };
}

function tryDualColumnDebitCredit(
  block: string,
  defaultYear: number
): ParsedRow | null {
  const hit = matchDateSubstring(block.trim(), defaultYear);
  if (!hit) return null;

  let afterDate = (block.slice(0, hit.start) + block.slice(hit.end)).trim();
  afterDate = afterDate.replace(/\s{2,}/gu, " ");
  afterDate = stripLeadingDateRuns(afterDate, defaultYear);
  const peeled = peelTrailingAmounts(afterDate, 2);

  if (peeled.amounts.length < 2) return null;

  const a0 = parseAmountFragment(peeled.amounts[0]);
  const a1 = parseAmountFragment(peeled.amounts[1]);
  if (!a0 || !a1) return null;

  const desc = peeled.prefix.trim();
  if (NOISE_DESCRIPTION.test(desc) || desc.length < 2) return null;

  const z0 = Math.abs(a0.value) < 1e-9;
  const z1 = Math.abs(a1.value) < 1e-9;
  if (z0 && z1) return null;

  const debitUpper = /\b(DEBIT|DR|WITHDRAWAL|CHARGE|PURCHASE|ATM)\b/u.test(
    block.toUpperCase()
  );
  const creditUpper = /\b(CREDIT|CR|DEPOSIT|REFUND)\b/u.test(
    block.toUpperCase()
  );

  let chosen: typeof a0;
  let type: "debit" | "credit";

  if (!z0 && z1) {
    chosen = a0;
    type =
      debitUpper && !creditUpper ? "debit" : a0.value < 0 ? "credit" : "debit";
  } else if (z0 && !z1) {
    chosen = a1;
    type =
      creditUpper && !debitUpper ? "credit" : a1.value < 0 ? "credit" : "debit";
  } else {
    const ad = Math.abs(a0.value);
    const ac = Math.abs(a1.value);
    if (ad >= ac) {
      chosen = a0;
      type = "debit";
    } else {
      chosen = a1;
      type = "credit";
    }
  }

  const signed = chosen.value;
  return {
    date: hit.iso,
    description: desc.replace(/\s{2,}/gu, " "),
    amount: Math.abs(signed),
    type,
    currency: chosen.currency,
    strategy: "dual-column",
  };
}

function tryLabeledAmountColumns(
  block: string,
  defaultYear: number
): ParsedRow | null {
  const hit = matchDateSubstring(block.trim(), defaultYear);
  if (!hit) return null;

  let mid = (block.slice(0, hit.start) + block.slice(hit.end)).trim();
  mid = stripLeadingDateRuns(mid.replace(/\s{2,}/gu, " "), defaultYear);

  const debitLab = mid.match(
    /\b(?:debit|withdrawals?|payments?)\b\s*([\u2212+-]?\(?[\p{Sc}]?\s*[\d,]+\.?\d*\)?)/iu
  );
  const creditLab = mid.match(
    /\b(?:credit|deposits?)\b\s*([\u2212+-]?\(?[\p{Sc}]?\s*[\d,]+\.?\d*\)?)/iu
  );

  if (!debitLab && !creditLab) return null;

  let amountRaw: string | undefined;
  let type: "debit" | "credit";

  if (debitLab && creditLab) {
    const d = parseAmountFragment(debitLab[1]);
    const c = parseAmountFragment(creditLab[1]);
    if (!d || !c) return null;
    const dz = Math.abs(d.value) < 1e-9;
    const cz = Math.abs(c.value) < 1e-9;
    if (!dz && cz) {
      amountRaw = debitLab[1];
      type = "debit";
    } else if (dz && !cz) {
      amountRaw = creditLab[1];
      type = "credit";
    } else {
      return null;
    }
  } else if (debitLab) {
    amountRaw = debitLab[1];
    type = "debit";
  } else {
    amountRaw = creditLab![1];
    type = "credit";
  }

  const description = mid
    .replace(debitLab?.[0] ?? "", "")
    .replace(creditLab?.[0] ?? "", "")
    .replace(/\s{2,}/gu, " ")
    .trim();

  const dc = debitCreditFromDescription(description, amountRaw!);
  if (!dc || !description || NOISE_DESCRIPTION.test(description)) return null;

  return {
    date: hit.iso,
    description,
    amount: Math.abs(dc.signedValue),
    type,
    currency: dc.parsed.currency,
    strategy: "labeled-columns",
  };
}

function tryFallbackAmountScan(
  block: string,
  defaultYear: number
): ParsedRow | null {
  const hit = matchDateSubstring(block.trim(), defaultYear);
  if (!hit) return null;

  let withoutDate = (block.slice(0, hit.start) + block.slice(hit.end)).trim();
  withoutDate = stripLeadingDateRuns(withoutDate, defaultYear);

  AMOUNT_TOKEN.lastIndex = 0;
  const rawMatches = [...withoutDate.matchAll(AMOUNT_TOKEN)].map((x) =>
    x[0].trim()
  );
  const parsedList = rawMatches
    .map((r) => ({ r, p: parseAmountFragment(r) }))
    .filter(
      (
        x
      ): x is {
        r: string;
        p: NonNullable<ReturnType<typeof parseAmountFragment>>;
      } => Boolean(x.p && Math.abs(x.p.value) > 1e-9)
    );

  if (!parsedList.length) return null;

  const last = parsedList[parsedList.length - 1];
  const amountIdx = withoutDate.lastIndexOf(last.r);
  if (amountIdx < 0) return null;

  const description = withoutDate
    .slice(0, amountIdx)
    .trim()
    .replace(/\s{2,}/gu, " ");
  if (description.length < 2 || NOISE_DESCRIPTION.test(description))
    return null;

  const dc = debitCreditFromDescription(description, last.r);
  if (!dc) return null;

  return {
    date: hit.iso,
    description,
    amount: Math.abs(dc.signedValue),
    type: dc.type,
    currency: dc.parsed.currency,
    strategy: "fallback-amount-scan",
  };
}

export function parseBlockWithStrategies(
  block: string,
  defaultYear: number
): ParsedRow | null {
  let trimB = block.trim();
  trimB = trimB
    .replace(/\bcontinued on the next page\b/giu, " ")
    .replace(/\d{12,}(-\d+\.\d{2})\s*$/u, " $1")
    .replace(/\s{2,}/gu, " ")
    .trim();
  if (trimB.length < 8) return null;

  const strategies: Array<() => ParsedRow | null> = [
    () => tryLeadingDateTailAmount(trimB, defaultYear, "leading-date-tail"),
    () =>
      tryLeadingDateTailAmount(
        stripLeadingNoise(trimB.replace(/^[^\dA-Za-z]{1,12}\s*/u, "")),
        defaultYear,
        "leading-date-skipped-prefix"
      ),
    () => tryLabeledAmountColumns(trimB, defaultYear),
    () => tryFallbackAmountScan(trimB, defaultYear),
    () => tryDualColumnDebitCredit(trimB, defaultYear),
  ];

  for (const run of strategies) {
    const row = run();
    if (row) return row;
  }
  return null;
}

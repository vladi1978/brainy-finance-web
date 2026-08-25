import type { Transaction } from "../types";
import { AMOUNT_TOKEN } from "./constants";
import {
  parseAmountFragment,
  peelTrailingAmounts,
  peelTrailingAmountsTight,
  isPlausibleMoneyToken,
} from "./amounts";
import {
  matchDateSubstring,
  stripLeadingDateRuns,
  stripLeadingNoise,
} from "./dates";
import { NOISE_DESCRIPTION } from "./noise";

export type ParsedRow = Transaction & { strategy: string };

/**
 * Strong incoming-money phrases win over the generic word PAYMENT.
 * No global amount-sign fallback — unknown rows stay debit (conservative).
 */
function hasStrongIncomingCredit(upper: string, amountRaw: string): boolean {
  if (/\bCR$/u.test(amountRaw.trim())) return true;
  if (
    /\b(?:CR|CREDITS?|DEPOSIT|REFUND|ABONO)\b/u.test(upper) &&
    !/\b(?:CREDIT\s+CARD|CREDITS?\s+(?:CARD|LIMIT|AVAILABLE))\b/u.test(upper)
  ) {
    return true;
  }
  if (/\bPMNT\s+RCVD\b/u.test(upper)) return true;
  if (/\bPAYMENT\s+RECEIVED\b/u.test(upper)) return true;
  if (/\bPAYMENT\s+FROM\b/u.test(upper)) return true;
  // Incoming Zelle: "ZELLE FROM …" / "ZELLE PAYMENT FROM …" (not "ZELLE TO …")
  if (
    /\bZELLE\b/u.test(upper) &&
    /\bFROM\b/u.test(upper) &&
    !/\bZELLE\b[\s\S]{0,48}\bTO\b/u.test(upper)
  ) {
    return true;
  }
  return false;
}

function hasOutgoingDebitHint(upper: string, amountRaw: string): boolean {
  if (/\bDR$/u.test(amountRaw.trim())) return true;
  if (/\bDES:PAYMENT\b/u.test(upper)) return true;
  if (
    /\b(?:DR|DEBITS?|PURCHASE|WITHDRAWAL|CHARGE|ATM|COMPRA|CHECKCARD|DEBIT\s+CARD)\b/u.test(
      upper
    )
  ) {
    return true;
  }
  // Generic PAYMENT / PAYMENTS — not the strong incoming phrases above
  if (
    /\bPAYMENTS?\b/u.test(upper) &&
    !/\bPAYMENT\s+(?:RECEIVED|FROM)\b/u.test(upper) &&
    !/\bPMNT\s+RCVD\b/u.test(upper)
  ) {
    return true;
  }
  return false;
}

function debitCreditFromDescription(
  description: string,
  amountRaw: string
): { type: "debit" | "credit"; signedValue: number; parsed: NonNullable<ReturnType<typeof parseAmountFragment>> } | null {
  const parsed = parseAmountFragment(amountRaw);
  if (!parsed || parsed.value === 0) return null;

  const upper = description.toUpperCase();
  // Precedence: explicit incoming phrases beat isolated PAYMENT.
  if (hasStrongIncomingCredit(upper, amountRaw)) {
    return { type: "credit", signedValue: parsed.value, parsed };
  }
  if (hasOutgoingDebitHint(upper, amountRaw)) {
    return { type: "debit", signedValue: parsed.value, parsed };
  }
  // Conservative default for unknown direction — do not manufacture credits.
  return { type: "debit", signedValue: parsed.value, parsed };
}

function isAchDescriptorBody(text: string): boolean {
  return /\bDES:/iu.test(text) || /\bINDN:/iu.test(text);
}

function amountHasCents(raw: string): boolean {
  return /[.,]\d{1,2}\b/u.test(raw.trim());
}

/**
 * Reject integer tokens that are clearly ID/INDN field fragments, not money.
 */
function amountLooksLikeEmbeddedRef(amountRaw: string, surrounding: string): boolean {
  if (amountHasCents(amountRaw)) return false;
  const digits = amountRaw.replace(/[^\d]/g, "");
  if (digits.length < 3) return false;
  const u = surrounding.toUpperCase().replace(/\s+/g, " ");
  if (new RegExp(String.raw`\b(?:ID|INDN|CO ID):\s*[^ ]*${digits}`, "u").test(u)) {
    return true;
  }
  // ACH bodies without any xx.xx money must not invent an integer amount.
  if (isAchDescriptorBody(u) && !/\d+[.,]\d{2}/.test(u)) {
    return true;
  }
  return false;
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
  if (!isPlausibleMoneyToken(primaryRaw)) return null;
  if (amountLooksLikeEmbeddedRef(primaryRaw, afterDate)) return null;
  // ACH DES:/INDN: rows require a real cents amount (prevents ID→$7419).
  if (isAchDescriptorBody(peeled.prefix) && !amountHasCents(primaryRaw)) {
    return null;
  }

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

function isCheckcardPostingDateCode(token: string, surrounding: string): boolean {
  const bare = token.trim().replace(/^[+\-(\u2212$€£]*/u, "").replace(/[)]*$/u, "");
  if (!/^\d{4}$/u.test(bare)) return false;
  const u = surrounding.toUpperCase();
  return new RegExp(
    String.raw`\b(?:CHECKCARD|DEBIT\s+CARD|POS|PURCHASE)\s+${bare}\b`,
    "u"
  ).test(u);
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
      } =>
        Boolean(
          x.p &&
            Math.abs(x.p.value) > 1e-9 &&
            isPlausibleMoneyToken(x.r) &&
            !isCheckcardPostingDateCode(x.r, withoutDate)
        )
    );

  if (!parsedList.length) return null;

  // Prefer a true money token with cents when present.
  const withCents = parsedList.filter((x) => amountHasCents(x.r));
  // ACH DES:/INDN: bodies must use cents — never invent from ID integers.
  if (isAchDescriptorBody(withoutDate) && !withCents.length) return null;
  const pool = withCents.length ? withCents : parsedList;
  const last = pool[pool.length - 1];
  if (amountLooksLikeEmbeddedRef(last.r, withoutDate)) return null;
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
    // Bare trailing auth/ID refs are not amounts.
    .replace(/\s+\d{12,}\s*$/u, "")
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

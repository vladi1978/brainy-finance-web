import type { CopilotAssistantContext, CopilotIntent } from "./types";
import type { CopilotFeedItem } from "../timeline/types";

function formatAmount(n: number, currency: string): string {
  const rounded = Math.round(n * 100) / 100;
  return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`;
}

function pickVariant(seed: string, variants: string[]): string {
  if (variants.length === 0) return "";
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return variants[Math.abs(hash) % variants.length] ?? variants[0];
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase();
}

export function classifyCopilotIntent(prompt: string): CopilotIntent {
  const p = normalizePrompt(prompt);
  if (!p) return "general";

  if (
    /\b(cancel|cut|drop|remove|unsubscribe)\b/u.test(p) &&
    /\b(first|start|priority|which)\b/u.test(p)
  ) {
    return "cancel_first";
  }
  if (p.includes("cancel first") || p.includes("what should i cancel")) {
    return "cancel_first";
  }

  if (
    /\b(score|health|rating)\b/u.test(p) &&
    /\b(low|why|explain|drop|down)\b/u.test(p)
  ) {
    return "score_low";
  }
  if (p.includes("financial score") || p.includes("why is my score")) {
    return "score_low";
  }

  if (
    /\b(trend|pattern|behavior|habit)\b/u.test(p) &&
    /\b(worr|concern|risk|watch|flag)\b/u.test(p)
  ) {
    return "trend_worry";
  }
  if (p.includes("spending trend") || p.includes("worries you")) {
    return "trend_worry";
  }

  if (
    /\b(bill|bills|monthly|recurring|fixed)\b/u.test(p) &&
    /\b(reduce|lower|cut|save|trim)\b/u.test(p)
  ) {
    return "reduce_bills";
  }
  if (p.includes("reduce my monthly") || p.includes("monthly bills")) {
    return "reduce_bills";
  }

  if (/\b(overdraft|nsf|negative balance)\b/u.test(p)) return "overdraft";
  if (/\b(fee|fees|bank fee|service charge)\b/u.test(p)) return "fees";
  if (/\b(telecom|phone|internet|utility|utilities|carrier)\b/u.test(p)) {
    return "telecom";
  }
  if (/\b(subscription|streaming|recurring sub)\b/u.test(p)) {
    return "subscriptions";
  }
  if (/\b(save|saving|optimize|opportunity)\b/u.test(p)) return "savings";

  if (/\b(first|start|priority|urgent|fix)\b/u.test(p) || p.includes("what should")) {
    return "cancel_first";
  }

  return "general";
}

function feedByTag(
  ctx: CopilotAssistantContext,
  tag: CopilotFeedItem["tags"][number]
): CopilotFeedItem[] {
  return ctx.copilot.feed.filter((i) => i.tags.includes(tag));
}

function topNegativeFactors(ctx: CopilotAssistantContext): string[] {
  return ctx.healthScore.factors
    .filter((f) => f.impact < 0)
    .sort((a, b) => a.impact - b.impact)
    .map((f) => f.label);
}

function joinNames(items: Array<{ name: string }>, max = 3): string {
  const names = items.slice(0, max).map((i) => i.name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function replyCancelFirst(ctx: CopilotAssistantContext, seed: string): string {
  const { currency } = ctx.copilot;
  const feeItems = feedByTag(ctx, "fee");
  const subItems = feedByTag(ctx, "subscription");
  const lines: string[] = [];

  const opener = pickVariant(seed, [
    "Reviewing your statement in urgency order — here's what I'd tackle first.",
    "I ranked cancellations by impact and how fast they improve cash flow.",
    "From an analyst lens, these cuts have the clearest payoff this cycle.",
  ]);
  lines.push(opener);

  let rank = 1;

  if (ctx.fees.overdraftCount > 0) {
    const feeItem = feeItems.find((i) => i.signalId.includes("overdraft")) ?? feeItems[0];
    const amt = ctx.fees.total;
    lines.push(
      `${rank}. Stop overdraft bleed first — ${ctx.fees.overdraftCount} NSF/overdraft-style charge(s) cost about ${formatAmount(amt, currency)} this period. That's pure leakage, not lifestyle spend.${feeItem ? ` ${feeItem.recommendation}` : " Enable low-balance alerts and a small buffer before touching subscriptions."}`
    );
    rank++;
  } else if (ctx.fees.total > 0) {
    lines.push(
      `${rank}. Bank fees (${formatAmount(ctx.fees.total, currency)}) — address these before discretionary cuts; they're fully avoidable with the right account tier.`
    );
    rank++;
  }

  if (ctx.subscriptions.flagged.length > 0) {
    const names = joinNames(ctx.subscriptions.flagged);
    const monthly = ctx.subscriptions.flagged.reduce((s, x) => s + x.monthly, 0);
    lines.push(
      `${rank}. Flagged subscriptions (${names}) — roughly ${formatAmount(monthly, currency)}/mo combined. Duplicates and price hikes are the fastest wins because they're already on your radar.`
    );
    rank++;
  }

  if (ctx.subscriptions.streaming.length >= 2) {
    const names = joinNames(ctx.subscriptions.streaming);
    const monthly = ctx.subscriptions.streaming.reduce((s, x) => s + x.monthly, 0);
    const subFeed = subItems.find((i) => i.signalId.includes("streaming"));
    lines.push(
      `${rank}. Streaming stack (${names}) at ~${formatAmount(monthly, currency)}/mo — overlap is likely.${subFeed ? ` ${subFeed.insight}` : " Rotate one tier off for 30 days and measure usage."}`
    );
    rank++;
  }

  const top = ctx.copilot.topPriorities[0];
  if (rank === 1 && top) {
    lines.push(
      `1. ${top.title} — ${top.insight} Next step: ${top.recommendation}`
    );
  } else if (top && rank <= 4) {
    lines.push(
      `Also on my watchlist: ${top.title}. ${top.recommendation}`
    );
  }

  if (lines.length === 1) {
    lines.push(
      "No high-confidence cancellation targets yet — upload a fuller statement window so recurring merchants can be scored."
    );
  }

  return lines.join("\n\n");
}

function replyScoreLow(ctx: CopilotAssistantContext, seed: string): string {
  const { score, label, factors } = ctx.healthScore;
  const negatives = topNegativeFactors(ctx);

  if (score >= 85) {
    return pickVariant(seed, [
      `Your financial score is ${score} (${label}) — that's strong for this statement. The main drag, if any, is minor: ${negatives[0] ?? "nothing material stood out"}. I'd still verify recurring merchants quarterly.`,
      `At ${score}, you're in solid territory. I don't see a score crisis — focus on optimization (${formatAmount(ctx.copilot.optimizationPotential.yearlyHigh, ctx.copilot.currency)}/yr potential range) rather than damage control.`,
    ]);
  }

  const opener = pickVariant(seed, [
    `Your score is ${score} (${label}). Here's what's pulling it down, in order of impact:`,
    `I put this statement at ${score}/100 — "${label}." The score isn't arbitrary; it's driven by these detected factors:`,
  ]);

  const factorLines =
    negatives.length > 0
      ? negatives
          .slice(0, 4)
          .map((label, i) => {
            const f = factors.find((x) => x.label === label);
            return `${i + 1}. ${label}${f ? ` (${f.impact} pts)` : ""}`;
          })
          .join("\n")
      : "No single dominant penalty — several moderate signals stacked.";

  const feeNote =
    ctx.fees.overdraftCount > 0
      ? `\n\nOverdraft activity is the heaviest weight — fees compound faster than subscription creep.`
      : ctx.fees.total > 0
        ? `\n\nFees are a quick win: they're confirmed on this statement and don't require lifestyle tradeoffs.`
        : "";

  const subNote =
    ctx.subscriptions.monthlyTotal > 250
      ? ` Subscription load (~${formatAmount(ctx.subscriptions.monthlyTotal, ctx.copilot.currency)}/mo) is elevated relative to a lean baseline.`
      : "";

  return `${opener}\n${factorLines}${feeNote}${subNote}`;
}

function replyTrendWorry(ctx: CopilotAssistantContext, seed: string): string {
  const trends = ctx.copilot.behaviorTrends.length
    ? ctx.copilot.behaviorTrends
    : feedByTag(ctx, "trend");

  if (trends.length === 0) {
    return pickVariant(seed, [
      "I don't see a behavior trend that crosses my worry threshold on this statement — spending pace looks relatively stable week to week.",
      "No sharp trend breaks flagged. I'd still scan for one-off spikes in the feed below before calling this period clean.",
    ]);
  }

  const primary = [...trends].sort(
    (a, b) => b.priority.urgency - a.priority.urgency
  )[0];
  const secondary = trends.find((t) => t.id !== primary?.id);

  const opener = pickVariant(seed, [
    "The trend I'd flag first for a follow-up conversation:",
    "If I had to pick one pattern that could compound:",
    "Highest-risk behavior shift on this statement:",
  ]);

  let body = `${opener} ${primary.title} — ${primary.insight}`;
  if (primary.priority.urgency >= 55) {
    body += ` Urgency score ${primary.priority.urgency}/100.`;
  }
  body += ` ${primary.recommendation}`;

  if (secondary) {
    body += `\n\nRunner-up: ${secondary.title} — ${secondary.insight}`;
  }

  return body;
}

function replyReduceBills(ctx: CopilotAssistantContext, seed: string): string {
  const { currency } = ctx.copilot;
  const { financialSummary } = ctx;
  const lines: string[] = [];

  lines.push(
    pickVariant(seed, [
      "Fixed-cost reduction plan based on what this statement actually shows:",
      "Here's how I'd attack monthly bills using detected recurring lines:",
    ])
  );

  if (ctx.subscriptions.telecom.length > 0) {
    const monthly = ctx.subscriptions.telecom.reduce((s, x) => s + x.monthly, 0);
    const names = joinNames(ctx.subscriptions.telecom);
    const telecomFeed = ctx.copilot.feed.find((i) =>
      i.signalId.includes("telecom")
    );
    lines.push(
      `• Telecom (${names}): ~${formatAmount(monthly, currency)}/mo — compare plan tiers at renewal.${telecomFeed ? ` ${telecomFeed.recommendation}` : ""}`
    );
  }

  if (ctx.subscriptions.streaming.length > 0) {
    const monthly = ctx.subscriptions.streaming.reduce((s, x) => s + x.monthly, 0);
    lines.push(
      `• Streaming: ${ctx.subscriptions.streaming.length} services, ~${formatAmount(monthly, currency)}/mo — rotate or downgrade one tier; savings are immediate if usage is low.`
    );
  }

  if (ctx.recurringMerchants.length > 0) {
    const top = ctx.recurringMerchants[0];
    lines.push(
      `• Recurring merchant load: ${top.name} and similar patterns — confirm each charge is intentional; consolidate accidental weekly cadences.`
    );
  }

  const actionable = financialSummary.actionableYearly;
  const optLow = financialSummary.optimization.yearlyLow;
  const optHigh = financialSummary.optimization.yearlyHigh;

  if (actionable > 0) {
    lines.push(
      `• Confirmed + avoidable fees: about ${formatAmount(actionable, currency)}/yr actionable without guessing.`
    );
  }
  if (optHigh > 0) {
    lines.push(
      `• Negotiation upside (telecom, insurance, bundles): roughly ${formatAmount(optLow, currency)}–${formatAmount(optHigh, currency)}/yr — not guaranteed, but worth quoting.`
    );
  }

  if (lines.length === 1) {
    lines.push(
      "Recurring bill volume looks modest on this window — extend the analysis period or add another account for richer comparisons."
    );
  }

  return lines.join("\n\n");
}

function replyFees(ctx: CopilotAssistantContext): string {
  const { currency } = ctx.copilot;
  const feeFeed = feedByTag(ctx, "fee");

  if (ctx.fees.total <= 0) {
    return "I didn't detect material bank or service fees on this statement — that's a positive signal for your score.";
  }

  const feeItem = feeFeed[0];
  const avoidable = ctx.financialSummary.avoidableFees.yearlyHigh;

  let text = `Fees totaled ${formatAmount(ctx.fees.total, currency)} this period`;
  if (ctx.fees.overdraftCount > 0) {
    text += `, including ${ctx.fees.overdraftCount} overdraft/NSF-style hit(s). These are urgent — they often repeat monthly until balance mechanics change.`;
  } else {
    text += ". They're likely avoidable with balance alerts or a fee-free account tier.";
  }

  if (avoidable > 0) {
    text += ` Estimated recoverable: ~${formatAmount(avoidable, currency)}/yr.`;
  }
  if (feeItem) {
    text += ` ${feeItem.recommendation}`;
  }

  return text;
}

function replyOverdraft(ctx: CopilotAssistantContext): string {
  if (ctx.fees.overdraftCount === 0) {
    return "No overdraft or NSF pattern on this statement — keep low-balance alerts on anyway; one surprise debit can change that quickly.";
  }

  const item =
    ctx.copilot.feed.find((i) => i.signalId.includes("overdraft")) ??
    feedByTag(ctx, "fee")[0];

  const amt = formatAmount(ctx.fees.total, ctx.copilot.currency);
  let text = `Overdraft/NSF activity showed up ${ctx.fees.overdraftCount} time(s) for ${amt} in fees this window. That's the highest-urgency item — it hits before any subscription trim.`;

  if (item) {
    text += ` ${item.insight} ${item.recommendation}`;
  }

  return text;
}

function replyTelecom(ctx: CopilotAssistantContext): string {
  if (ctx.subscriptions.telecom.length === 0) {
    const item = ctx.copilot.feed.find((i) => i.signalId.includes("telecom"));
    if (item) {
      return `${item.insight} ${item.recommendation}`;
    }
    return "I didn't isolate telecom/utility subscriptions on this statement — they may be bundled or labeled inconsistently.";
  }

  const monthly = ctx.subscriptions.telecom.reduce((s, x) => s + x.monthly, 0);
  const names = joinNames(ctx.subscriptions.telecom);
  const item = ctx.copilot.feed.find((i) => i.signalId.includes("telecom"));

  let text = `Telecom/utilities (${names}) run about ${formatAmount(monthly, ctx.copilot.currency)}/mo — among your heavier fixed lines. Shop quotes before renewal; loyalty discounts often unlock only when you ask.`;
  if (item) {
    text += ` ${item.recommendation}`;
  }
  return text;
}

function replySubscriptions(ctx: CopilotAssistantContext): string {
  const { currency } = ctx.copilot;
  const { count, monthlyTotal, streaming, flagged } = ctx.subscriptions;

  if (count === 0) {
    return "No confirmed subscriptions in this window — recurring merchants may still appear under expenses if cadence wasn't strong enough to classify.";
  }

  let text = `${count} subscription(s) detected, ~${formatAmount(monthlyTotal, currency)}/mo combined.`;

  if (flagged.length > 0) {
    text += ` ${flagged.length} flagged (${joinNames(flagged)}) — review those before anything else.`;
  }

  if (streaming.length >= 2) {
    const sm = streaming.reduce((s, x) => s + x.monthly, 0);
    text += ` Streaming (${joinNames(streaming)}) accounts for ~${formatAmount(sm, currency)}/mo; overlap is the usual culprit.`;
  }

  const subFeed = feedByTag(ctx, "subscription")[0];
  if (subFeed) {
    text += ` ${subFeed.recommendation}`;
  }

  return text;
}

function replySavings(ctx: CopilotAssistantContext): string {
  const { currency } = ctx.copilot;
  const actionable = ctx.copilot.actionableYearlySavings;
  const { yearlyLow, yearlyHigh } = ctx.copilot.optimizationPotential;

  if (actionable <= 0 && yearlyHigh <= 0) {
    return "Savings levers look limited on this statement — focus on fee avoidance and trend control rather than large recurring cuts.";
  }

  let text = "";
  if (actionable > 0) {
    text += `Confirmed actionable savings (fees + high-confidence recurring cuts): ~${formatAmount(actionable, currency)}/yr.`;
  }
  if (yearlyHigh > 0) {
    text += `${text ? " " : ""}Optimization band (telecom, bundles, habits): ${formatAmount(yearlyLow, currency)}–${formatAmount(yearlyHigh, currency)}/yr — treat as negotiation targets, not guaranteed.`;
  }

  const top = ctx.copilot.topPriorities.find(
    (p) => (p.estimatedYearlySavings ?? 0) > 0
  );
  if (top) {
    text += ` Start with ${top.title.toLowerCase()} — ${top.recommendation}`;
  }

  return text.trim();
}

function replyGeneral(ctx: CopilotAssistantContext, seed: string): string {
  const top = ctx.copilot.topPriorities[0];
  if (!top) {
    return "Upload a statement to unlock statement-specific analysis — I'll rank fees, recurring merchants, and trends from your actual debits.";
  }

  return pickVariant(seed, [
    `Headline from this statement: ${top.title}. ${top.insight} I'd move next on: ${top.recommendation}`,
    `Top priority right now — ${top.title}. ${top.insight} Reasoning: urgency ${top.priority.urgency}/100 with meaningful savings potential. ${top.recommendation}`,
    `If we only fix one thing this cycle: ${top.title}. ${top.insight} ${top.recommendation}`,
  ]);
}

export function generateCopilotReply(
  prompt: string,
  ctx: CopilotAssistantContext | undefined
): string {
  if (!ctx || !ctx.hasStatement) {
    return "Upload a statement and I'll analyze subscriptions, fees, spending trends, and recurring merchants from your actual debits — not generic advice.";
  }

  const intent = classifyCopilotIntent(prompt);
  const seed = `${intent}:${prompt}:${ctx.copilot.generatedAt}`;

  switch (intent) {
    case "cancel_first":
      return replyCancelFirst(ctx, seed);
    case "score_low":
      return replyScoreLow(ctx, seed);
    case "trend_worry":
      return replyTrendWorry(ctx, seed);
    case "reduce_bills":
      return replyReduceBills(ctx, seed);
    case "fees":
      return replyFees(ctx);
    case "overdraft":
      return replyOverdraft(ctx);
    case "telecom":
      return replyTelecom(ctx);
    case "subscriptions":
      return replySubscriptions(ctx);
    case "savings":
      return replySavings(ctx);
    default:
      return replyGeneral(ctx, seed);
  }
}

export function generateCopilotOpening(ctx: CopilotAssistantContext | undefined): string {
  if (!ctx || !ctx.hasStatement) {
    return generateCopilotReply("", ctx);
  }

  const { score, label } = ctx.healthScore;
  const top = ctx.copilot.topPriorities[0];
  const trend = ctx.copilot.behaviorTrends[0];
  const parts: string[] = [];

  parts.push(
    `I've reviewed this statement — score ${score} (${label}).`
  );

  if (top) {
    parts.push(
      `First priority: ${top.title.toLowerCase()}. ${top.insight}`
    );
  }

  if (trend && trend.id !== top?.id) {
    parts.push(`Behavior watch: ${trend.title.toLowerCase()}.`);
  }

  if (ctx.subscriptions.count > 0) {
    parts.push(
      `${ctx.subscriptions.count} recurring subscription(s) (~${formatAmount(ctx.subscriptions.monthlyTotal, ctx.copilot.currency)}/mo) on file.`
    );
  }

  parts.push("Ask about cancellations, your score, trends, or monthly bills.");

  return parts.join(" ");
}

const PROMPT_POOL: Array<{
  text: string;
  when: (ctx: CopilotAssistantContext) => boolean;
  weight: number;
}> = [
  {
    text: "What should I cancel first?",
    when: (ctx) =>
      ctx.subscriptions.flagged.length > 0 ||
      ctx.subscriptions.streaming.length >= 2 ||
      ctx.subscriptions.count >= 3,
    weight: 10,
  },
  {
    text: "Why is my financial score low?",
    when: (ctx) => ctx.healthScore.score < 85,
    weight: 9,
  },
  {
    text: "What spending trend worries you most?",
    when: (ctx) => ctx.copilot.behaviorTrends.length > 0,
    weight: 9,
  },
  {
    text: "How can I reduce my monthly bills?",
    when: (ctx) =>
      ctx.subscriptions.telecom.length > 0 ||
      ctx.subscriptions.monthlyTotal > 120 ||
      ctx.recurringMerchants.length > 0,
    weight: 8,
  },
  {
    text: "Are my bank fees avoidable?",
    when: (ctx) => ctx.fees.total > 0,
    weight: 8,
  },
  {
    text: "What's driving overdraft risk?",
    when: (ctx) => ctx.fees.overdraftCount > 0,
    weight: 10,
  },
  {
    text: "Which subscriptions overlap?",
    when: (ctx) => ctx.subscriptions.streaming.length >= 2,
    weight: 7,
  },
  {
    text: "Where can I save this year?",
    when: (ctx) =>
      ctx.copilot.actionableYearlySavings > 0 ||
      ctx.copilot.optimizationPotential.yearlyHigh > 0,
    weight: 7,
  },
  {
    text: "What should I fix first?",
    when: (ctx) => ctx.copilot.topPriorities.length > 0,
    weight: 6,
  },
];

export function buildSuggestedPrompts(
  ctx: CopilotAssistantContext | undefined,
  max = 4
): string[] {
  if (!ctx?.hasStatement) {
    return [
      "What should I cancel first?",
      "Why is my financial score low?",
      "What spending trend worries you most?",
      "How can I reduce my monthly bills?",
    ];
  }

  const eligible = PROMPT_POOL.filter((p) => p.when(ctx)).sort(
    (a, b) => b.weight - a.weight
  );

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of eligible) {
    if (seen.has(p.text)) continue;
    seen.add(p.text);
    out.push(p.text);
    if (out.length >= max) break;
  }

  if (out.length < max) {
    for (const p of PROMPT_POOL) {
      if (out.length >= max) break;
      if (!seen.has(p.text)) {
        seen.add(p.text);
        out.push(p.text);
      }
    }
  }

  return out.slice(0, max);
}

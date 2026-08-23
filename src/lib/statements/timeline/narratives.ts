import type { TimelineSignal } from "./types";

export type NarrativeCopy = {
  title: string;
  insight: string;
  recommendation: string;
};

export function narrativeForSignal(signal: TimelineSignal): NarrativeCopy {
  const pct =
    signal.deltaPct != null ? `${Math.round(signal.deltaPct)}%` : null;

  switch (signal.kind) {
    case "spending_increase":
      if (signal.id === "weekend-dining-up") {
        return {
          title: "Weekend dining is rising",
          insight: pct
            ? `Weekend dining activity is increasing — up about ${pct} in the latter part of this period.`
            : "Weekend dining activity looks higher later in this period.",
          recommendation:
            "Set a weekend dining cap or plan one meal out to keep discretionary spend predictable.",
        };
      }
      if (signal.categoryKey === "streaming") {
        return {
          title: "Streaming spend trending up",
          insight: pct
            ? `Your streaming costs increased ${pct} this period.`
            : "Streaming-related recurring spend is elevated this period.",
          recommendation:
            "Audit overlapping services and pause one tier you use least often.",
        };
      }
      if (signal.categoryKey === "convenience") {
        return {
          title: "Convenience spending pattern",
          insight:
            "Frequent convenience-store purchases add up across the statement window.",
          recommendation:
            "Batch errands or use a weekly cash envelope for impulse convenience buys.",
        };
      }
      if (signal.categoryKey === "restaurants" || signal.categoryKey === "cafes") {
        return {
          title: "Dining spend trending up",
          insight: pct
            ? `Food and dining activity is up about ${pct} this period.`
            : "Restaurant and cafe merchants show repeat activity this period.",
          recommendation:
            "Try a two-week delivery pause or cap to test how much you can redirect to savings.",
        };
      }
      return {
        title: "Spending was higher in the second half",
        insight: pct
          ? `Overall debit activity rose about ${pct} in the second half of this statement.`
          : "Spending was higher in the second half of the detected weeks.",
        recommendation:
          "Review the largest new merchants from the second half and set alerts before the next cycle.",
      };

    case "spending_decrease":
      return {
        title: "Spending pace eased",
        insight: pct
          ? `Debit activity declined about ${pct} in the second half of this period.`
          : "Overall spending declined compared with earlier weeks on this statement.",
        recommendation:
          "Keep the habits that drove the slowdown — consider moving the difference to savings.",
      };

    case "recurring_weekly":
      return {
        title: "Weekly spending rhythm",
        insight:
          "Several merchants show weekly or high-frequency purchase patterns in this window.",
        recommendation:
          "Confirm each weekly charge is intentional; consolidate where the cadence is accidental.",
      };

    case "recurring_monthly":
      if (signal.id === "telecom-recurring-high") {
        return {
          title: "Telecom remains a top recurring cost",
          insight:
            "Telecom spending remains one of your highest recurring expenses this period.",
          recommendation:
            "Compare plan tiers or bundle phone and internet — loyalty discounts often unlock at renewal.",
        };
      }
      return {
        title: "Monthly recurring load",
        insight:
          "Multiple monthly bills and recurring merchants anchor your fixed cash outflows.",
        recommendation:
          "List due dates on one calendar and negotiate or downgrade one tier per quarter.",
      };

    case "overdraft_pattern":
      return {
        title: "Overdraft pattern detected",
        insight:
          "Repeated overdraft or NSF-style fees appeared — these are urgent to address.",
        recommendation:
          "Enable low-balance alerts and link a small buffer account to avoid the next fee cycle.",
      };

    case "fee_escalation":
      return {
        title: "Bank fees on the rise",
        insight:
          signal.id === "fee-escalation"
            ? "Multiple fee charges suggest escalating account costs this period."
            : "Account or service fees were identified on this statement.",
        recommendation:
          "Ask your bank about fee-free tiers or switch to an account that waives maintenance fees.",
      };

    case "subscription_growth":
      if (signal.categoryKey === "streaming") {
        return {
          title: "Streaming stack growing",
          insight: pct
            ? `Your streaming costs increased ${pct} this period.`
            : `${signal.evidence}`,
          recommendation:
            "Rotate one service monthly or downgrade to ad-supported tiers where available.",
        };
      }
      return {
        title: "Subscription footprint expanded",
        insight:
          "Recurring subscriptions and repeat merchants increased versus a lean baseline.",
        recommendation:
          "Cancel one redundant service this week and set a 30-day review for trials.",
      };

    case "unusual_spike":
      return {
        title: "Unusual charge spike",
        insight:
          signal.merchantReference
            ? `An unusually large charge at ${signal.merchantReference} stands out vs typical activity.`
            : "A single debit is much larger than usual for its merchant cluster.",
        recommendation:
          "Verify the charge wasn't duplicated and dispute if it doesn't match your records.",
      };

    default:
      return {
        title: "Financial pattern detected",
        insight: signal.evidence,
        recommendation: "Review this pattern in your statement detail below.",
      };
  }
}

import type { InsightSeverity } from "@/lib/statements/intelligence/types";

export const copilotSeverityStyles: Record<
  InsightSeverity,
  { border: string; bg: string; text: string; badge: string }
> = {
  positive: {
    border: "border-emerald-400/25",
    bg: "from-emerald-500/[0.08]",
    text: "text-emerald-100",
    badge: "border-emerald-400/30 bg-emerald-500/15 text-emerald-100",
  },
  moderate: {
    border: "border-amber-400/25",
    bg: "from-amber-500/[0.08]",
    text: "text-amber-100",
    badge: "border-amber-400/30 bg-amber-500/15 text-amber-100",
  },
  important: {
    border: "border-red-400/25",
    bg: "from-red-500/[0.08]",
    text: "text-red-100",
    badge: "border-red-400/30 bg-red-500/15 text-red-100",
  },
  informational: {
    border: "border-sky-400/20",
    bg: "from-sky-500/[0.07]",
    text: "text-sky-100",
    badge: "border-sky-400/25 bg-sky-500/10 text-sky-100",
  },
};

export const copilotSeverityLabel: Record<InsightSeverity, string> = {
  positive: "Positive",
  moderate: "Moderate",
  important: "Important",
  informational: "Info",
};

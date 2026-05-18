import type { CopilotTimelineResult } from "./types";

const STATIC_REPLIES: Record<string, string> = {
  default:
    "Upload a statement to see personalized priorities and trend narratives.",
  "what-first":
    "Start with overdraft and fee patterns — they have the highest urgency and are often fully avoidable.",
  streaming:
    "You may have overlapping streaming services. Rotating or downgrading one tier often frees meaningful monthly cash.",
  savings:
    "Focus on recurring bills with the highest annual impact first — telecom, insurance, and duplicate subscriptions.",
  trends:
    "Behavior trends show where habits shifted this period. Small caps on dining or convenience often compound quickly.",
};

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase();
}

export function mockAssistantReply(
  prompt: string,
  copilot: CopilotTimelineResult | undefined
): string {
  const p = normalizePrompt(prompt);
  if (!copilot || copilot.feed.length === 0) {
    return STATIC_REPLIES.default;
  }

  if (
    /\b(first|start|priority|urgent|fix)\b/u.test(p) ||
    p.includes("what should")
  ) {
    const top = copilot.topPriorities[0];
    if (top) {
      return `${STATIC_REPLIES["what-first"]} Right now: **${top.title}** — ${top.insight} Recommendation: ${top.recommendation}`;
    }
    return STATIC_REPLIES["what-first"];
  }

  if (/\b(stream|netflix|hulu|disney)\b/u.test(p)) {
    const streaming = copilot.feed.find((i) =>
      i.signalId.includes("streaming")
    );
    if (streaming) {
      return `${streaming.insight} ${streaming.recommendation}`;
    }
    return STATIC_REPLIES.streaming;
  }

  if (/\b(save|saving|optimize|cut)\b/u.test(p)) {
    const yr = copilot.yearlyOptimizationPotential;
    return `${STATIC_REPLIES.savings} Estimated yearly optimization potential on this statement is about ${yr.toFixed(0)} ${copilot.currency}.`;
  }

  if (/\b(trend|pattern|behavior|weekend|dining)\b/u.test(p)) {
    const trend = copilot.behaviorTrends[0];
    if (trend) {
      return `${trend.insight} ${trend.recommendation}`;
    }
    return STATIC_REPLIES.trends;
  }

  const top = copilot.topPriorities[0];
  if (top) {
    return `Based on this statement: ${top.insight} Try this next: ${top.recommendation}`;
  }

  return STATIC_REPLIES.default;
}

export const MOCK_SUGGESTED_PROMPTS = [
  "What should I fix first?",
  "How can I save on streaming?",
  "What behavior trends do you see?",
] as const;

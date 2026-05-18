import type { CopilotAssistantContext } from "../copilot/types";
import {
  buildSuggestedPrompts,
  generateCopilotOpening,
  generateCopilotReply,
} from "../copilot/contextualAssistant";
import type { CopilotTimelineResult } from "./types";

/** @deprecated Pass CopilotAssistantContext — timeline-only fallback */
export function mockAssistantReply(
  prompt: string,
  copilot: CopilotTimelineResult | undefined,
  assistant?: CopilotAssistantContext
): string {
  const ctx =
    assistant ??
    (copilot
      ? ({
          copilot,
          hasStatement: copilot.feed.length > 0,
        } as CopilotAssistantContext)
      : undefined);

  if (!prompt.trim()) {
    return generateCopilotOpening(ctx);
  }
  return generateCopilotReply(prompt, ctx);
}

export function getSuggestedCopilotPrompts(
  assistant?: CopilotAssistantContext
): string[] {
  return buildSuggestedPrompts(assistant);
}

/** @deprecated Use getSuggestedCopilotPrompts(assistant) */
export const MOCK_SUGGESTED_PROMPTS = [
  "What should I cancel first?",
  "Why is my financial score low?",
  "What spending trend worries you most?",
  "How can I reduce my monthly bills?",
] as const;

export type {
  CopilotAssistantContext,
  CopilotIntent,
  SubscriptionHighlight,
} from "./types";
export { buildCopilotAssistantContext } from "./buildAssistantContext";
export {
  buildSuggestedPrompts,
  classifyCopilotIntent,
  generateCopilotOpening,
  generateCopilotReply,
} from "./contextualAssistant";

export type {
  CopilotFeedItem,
  CopilotTimelineResult,
  PriorityScores,
  TimelineSignal,
  TimelineSignalKind,
} from "./types";
export { buildCopilotTimeline } from "./buildTimeline";
export { detectTimelineSignals, signalSeverity } from "./detectSignals";
export { narrativeForSignal } from "./narratives";
export {
  estimateYearlyPotential,
  scoreCopilotPriority,
  toCopilotFeedItem,
} from "./scorePriority";
export {
  getSuggestedCopilotPrompts,
  MOCK_SUGGESTED_PROMPTS,
  mockAssistantReply,
} from "./mockAssistant";

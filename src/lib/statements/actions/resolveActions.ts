import { getActionsForStatus } from "./registry";
import type {
  EnrichedRecommendation,
  RecommendationInput,
  RecommendationStatus,
  StoredRecommendationState,
} from "./types";

export function resolveRecommendation(
  rec: RecommendationInput,
  stored?: StoredRecommendationState
): EnrichedRecommendation {
  const status: RecommendationStatus = stored?.status ?? "pending";
  return {
    ...rec,
    merchant: rec.merchantReference,
    status,
    actions: getActionsForStatus(rec.actionType, status),
  };
}

export function enrichRecommendations(
  items: RecommendationInput[],
  states: Record<string, StoredRecommendationState>
): EnrichedRecommendation[] {
  return items.map((rec) => resolveRecommendation(rec, states[rec.id]));
}

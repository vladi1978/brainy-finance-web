import type { StoredRecommendationState } from "./types";

const STORAGE_KEY = "brainy_finance_recommendation_actions";

export function loadRecommendationStates(): Record<
  string,
  StoredRecommendationState
> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredRecommendationState>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveRecommendationState(
  recommendationId: string,
  patch: Pick<StoredRecommendationState, "status" | "lastActionId">
): StoredRecommendationState {
  const all = loadRecommendationStates();
  const next: StoredRecommendationState = {
    recommendationId,
    status: patch.status,
    lastActionId: patch.lastActionId,
    updatedAt: new Date().toISOString(),
  };
  all[recommendationId] = next;
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }
  return next;
}

export type MatchType = "exact" | "strong" | "weak" | "none";

export type MatchEvaluation = {
  matchType: MatchType;
  score: number;
  /** Human-readable factors for logs */
  reasons: string[];
};

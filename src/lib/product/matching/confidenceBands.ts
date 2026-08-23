import type { CompareFlowDepartment } from "../compareFlowDepartment";
import type { AttributeMatchResult } from "../attributeMatch";
import {
  isDepartmentPipelineStrict,
  STRICT_SEARCH_URL_DISPLAY_SCORE_CAP,
} from "../department/departmentPipelineStrict";
import {
  isCategoryUrl,
  isProductDetailStoreKey,
  isProductPageUrl,
  isSearchUrl,
} from "../productDetailUrl";
import type { CompareApiCandidate, CompareProductDeal } from "../types";
import type { ProductIdentityResult } from "./productIdentity";

/** User-facing confidence bands for compare results (0–100 display score). */
export type MatchConfidenceBand =
  | "exact_match"
  | "high_confidence"
  | "similar_specs"
  | "possible_alternative"
  | "below_threshold";

export const BAND_EXACT_MIN = 90;
export const BAND_HIGH_CONFIDENCE_MIN = 75;
export const BAND_POSSIBLE_MIN = 55;

export const FALLBACK_POSSIBLE_COUNT = 3;

/** Shown above Possible Alternatives when only moderate-confidence rows qualify. */
export const POSSIBLE_ALTERNATIVES_EXPLANATION =
  "Brainy found possible alternatives, but some specs were missing or only partially matched.";

/** Headline when no 75+ band matches but 55–74 alternatives are shown. */
export const NO_EXACT_WITH_ALTERNATIVES_MESSAGE =
  "No exact matches found yet, but Brainy found possible alternatives.";

export type MatchResultGroupKey =
  | "exactMatches"
  | "highConfidenceMatches"
  | "possibleAlternatives";

export type MatchResultGroups<T> = Record<MatchResultGroupKey, T[]>;

/** Primary display score — prefer structured/department blend over identity-only. */
export function displayMatchScore(args: {
  relevanceScore: number;
  identityScore: number;
  departmentScore?: number | null;
  /**
   * When set (TV OEM/model conflict), identity and department must not inflate the
   * UI score above this cap — only blended relevance is used.
   */
  tvScoreCap?: number | null;
}): number {
  if (args.tvScoreCap != null) {
    return Math.min(args.relevanceScore, args.tvScoreCap);
  }
  const dept = args.departmentScore ?? 0;
  return Math.max(args.relevanceScore, args.identityScore, dept);
}

export function classifyConfidenceBand(score: number): MatchConfidenceBand {
  if (score >= BAND_EXACT_MIN) return "exact_match";
  if (score >= BAND_HIGH_CONFIDENCE_MIN) return "high_confidence";
  if (score >= BAND_POSSIBLE_MIN) {
    return "possible_alternative";
  }
  return "below_threshold";
}

/** Badge within the 55–74 band: similar_specs vs possible_alternative. */
export function refinePossibleBandBadge(
  baseBand: MatchConfidenceBand,
  hints: {
    departmentTier?: string | null;
    scoreReasons?: string[];
    identityReasons?: string[];
  }
): MatchConfidenceBand {
  if (baseBand !== "possible_alternative") return baseBand;
  const blob = [
    ...(hints.scoreReasons ?? []),
    ...(hints.identityReasons ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (hints.departmentTier === "similar_specs") return "similar_specs";

  const similarSignals = [
    "dimensions_close",
    "dimensions_partial",
    "model_family",
    "model_substring",
    "size_close",
    "partial_match",
    "candidate_missing",
    "source_missing",
    "both_unknown",
    "dept_penalties",
    "soft_penalty",
    "frame type",
  ];
  if (similarSignals.some((s) => blob.includes(s))) {
    return "similar_specs";
  }
  return "possible_alternative";
}

/**
 * Align display confidence bands with product-identity tiers.
 * Prevents brand+size / department score inflation from labeling Exact or High
 * when identity is only an alternative (e.g. missing strong model).
 */
export function applyIdentityMatchTypeToConfidenceBand(
  band: MatchConfidenceBand,
  identity: Pick<ProductIdentityResult, "matchType" | "identityReasons">
): MatchConfidenceBand {
  let next = band;
  if (next === "exact_match" && identity.matchType !== "exact_match") {
    next =
      identity.matchType === "close_match" ? "high_confidence" : "possible_alternative";
  }
  if (next === "high_confidence" && identity.matchType === "alternative") {
    next = "possible_alternative";
  }
  if (
    (next === "exact_match" || next === "high_confidence") &&
    identity.identityReasons.some((r) =>
      /missing_or_unconfirmed_model|different_model/i.test(r)
    )
  ) {
    next = "possible_alternative";
  }
  return next;
}

export function confidenceBandBadgeLabel(band: MatchConfidenceBand): string {
  switch (band) {
    case "exact_match":
      return "Exact Match";
    case "high_confidence":
      return "High Confidence";
    case "similar_specs":
      return "Similar Specs";
    case "possible_alternative":
      return "Possible Alternative";
    default:
      return "Low Match";
  }
}

export function confidenceBandToResultGroup(
  band: MatchConfidenceBand
): MatchResultGroupKey | null {
  if (band === "exact_match") return "exactMatches";
  if (band === "high_confidence") return "highConfidenceMatches";
  if (band === "similar_specs" || band === "possible_alternative") {
    return "possibleAlternatives";
  }
  return null;
}

type ReasonPattern = { test: RegExp; message: string };

const SHARED_REASON_PATTERNS: ReasonPattern[] = [
  {
    test: /candidate_missing|source_missing|both_unknown|missing.*spec|unconfirmed|soft_penalty|confidence_capped_missing_data/i,
    message: "Some specs missing",
  },
  {
    test: /tier:exact_match/i,
    message: "Confirmed same product identity",
  },
  {
    test: /same_product_line|tier:close/i,
    message: "Same product line or close variant",
  },
];

const ELECTRONICS_REASON_PATTERNS: ReasonPattern[] = [
  {
    test: /model_family|model_substring|model_fuzzy|similar.*model/i,
    message: "Model family matched",
  },
  {
    test: /screen_size_exact|diagonal_exact|size_exact/i,
    message: "Exact screen size matched",
  },
  {
    test: /screen_size_mismatch|screen_size_close_strong|screen_size_close_moderate/i,
    message: "Screen size mismatch",
  },
  {
    test: /display_ok|display_panel.*exact/i,
    message: "Same panel type",
  },
  {
    test: /size_close_moderate|screen.*close.*moderate/i,
    message: "Screen size is close to your product",
  },
];

const POOLS_REASON_PATTERNS: ReasonPattern[] = [
  {
    test: /pool.*shape|shape.*match|shape_match|same_shape/i,
    message: "Pool shape matched",
  },
  {
    test: /dimensions_close|dimensions_partial|dimensions.*partial/i,
    message: "Dimensions partially matched",
  },
  {
    test: /frame.*compatible|frame_type|inflatable|steel\s*frame/i,
    message: "Frame type compatible",
  },
];

const TOOLS_REASON_PATTERNS: ReasonPattern[] = [
  {
    test: /model_family|model_substring|model_fuzzy|similar.*model/i,
    message: "Model family matched",
  },
];

/** Legacy global patterns — used when strict pipeline is off. */
const LEGACY_REASON_PATTERNS: ReasonPattern[] = [
  ...POOLS_REASON_PATTERNS,
  ...SHARED_REASON_PATTERNS,
  ...ELECTRONICS_REASON_PATTERNS,
  {
    test: /screen_size_mismatch|size_mismatch/i,
    message: "Screen size mismatch",
  },
  {
    test: /voltage|battery.*platform/i,
    message: "Tool platform appears compatible",
  },
];

function technicalMentionsVoltage(technical: string): boolean {
  return /\bvoltage\b|\d+\s*v\b|\d+vmax|battery.*platform/i.test(technical);
}

function reasonPatternsForDepartment(
  department: CompareFlowDepartment | null | undefined
): ReasonPattern[] {
  if (!department) {
    return LEGACY_REASON_PATTERNS;
  }

  const patterns: ReasonPattern[] = [...SHARED_REASON_PATTERNS];
  switch (department) {
    case "electronics":
      patterns.push(...ELECTRONICS_REASON_PATTERNS);
      break;
    case "pools_outdoor":
      patterns.push(...POOLS_REASON_PATTERNS);
      break;
    case "tools":
      patterns.push(...TOOLS_REASON_PATTERNS);
      break;
  }
  return patterns;
}

/** Strict mode: any non-PDP outbound URL (search/category/homepage/non-product path). */
function isNonProductOutboundUrlForStrictCap(candidate: {
  store?: CompareApiCandidate["store"] | CompareProductDeal["store"];
  outboundUrl?: string | null;
  affiliateUrl?: string | null;
  productUrl?: string | null;
  urlType?: CompareApiCandidate["urlType"];
  outboundIsStoreSearch?: boolean;
}): boolean {
  if (candidate.outboundIsStoreSearch === true) return true;
  if (candidate.urlType === "search") return true;

  const store = candidate.store;
  const outbound =
    candidate.outboundUrl?.trim() ||
    candidate.affiliateUrl?.trim() ||
    candidate.productUrl?.trim() ||
    "";
  if (!store || !outbound || !isProductDetailStoreKey(store)) return false;

  if (isProductPageUrl(store, outbound)) return false;
  if (isSearchUrl(store, outbound)) return true;
  if (isCategoryUrl(store, outbound)) return true;
  // Final safety net: mapped retailer outbound that is not a verified PDP.
  return true;
}

/** Strict mode: retailer search/category/homepage/other non-PDP outbound URL. */
export function isStrictSearchFallbackOutbound(candidate: {
  store?: CompareApiCandidate["store"] | CompareProductDeal["store"];
  outboundUrl?: string | null;
  affiliateUrl?: string | null;
  productUrl?: string | null;
  urlType?: CompareApiCandidate["urlType"];
  outboundIsStoreSearch?: boolean;
}): boolean {
  return isNonProductOutboundUrlForStrictCap(candidate);
}

/** Demote Exact Match for search/category/non-PDP outbound URLs (always). */
export function capConfidenceBandForSearchUrl(
  band: MatchConfidenceBand
): MatchConfidenceBand {
  // Product-identity safety: never label a search/category URL as Exact Match.
  if (band === "exact_match") {
    return "possible_alternative";
  }
  if (!isDepartmentPipelineStrict()) return band;
  if (band === "high_confidence") {
    return "possible_alternative";
  }
  return band;
}

function capNumericScore(value: number): number {
  return Math.min(value, STRICT_SEARCH_URL_DISPLAY_SCORE_CAP);
}

export type StrictSearchUrlScoreCapInput = {
  displayMatchScore: number;
  relevanceScore: number;
  identityScore: number;
  departmentScore?: number | null;
  confidence: number;
  confidenceBand: MatchConfidenceBand;
};

export type StrictSearchUrlScoreCapResult = StrictSearchUrlScoreCapInput & {
  capped: boolean;
};

/**
 * Strict mode: cap all visible/sort scores for retailer search outbound URLs.
 * Runs after final score calculation; legacy mode returns inputs unchanged.
 */
export function applyStrictSearchUrlScoreCap(
  input: StrictSearchUrlScoreCapInput
): StrictSearchUrlScoreCapResult {
  if (!isDepartmentPipelineStrict()) {
    return { ...input, capped: false };
  }

  const displayMatchScore = capNumericScore(input.displayMatchScore);
  const relevanceScore = capNumericScore(input.relevanceScore);
  const identityScore = capNumericScore(input.identityScore);
  const departmentScore =
    input.departmentScore != null
      ? capNumericScore(input.departmentScore)
      : input.departmentScore;
  const confidence = Math.min(input.confidence, STRICT_SEARCH_URL_DISPLAY_SCORE_CAP / 100);

  let confidenceBand = classifyConfidenceBand(displayMatchScore);
  confidenceBand = capConfidenceBandForSearchUrl(confidenceBand);

  const capped =
    displayMatchScore !== input.displayMatchScore ||
    relevanceScore !== input.relevanceScore ||
    identityScore !== input.identityScore ||
    confidence !== input.confidence ||
    confidenceBand !== input.confidenceBand ||
    departmentScore !== input.departmentScore;

  return {
    displayMatchScore,
    relevanceScore,
    identityScore,
    departmentScore,
    confidence,
    confidenceBand,
    capped,
  };
}

/** Apply search URL score cap to a serialized API candidate. */
export function applyStrictSearchUrlCapToCandidate(
  c: CompareApiCandidate
): CompareApiCandidate {
  const isSearchOutbound = isStrictSearchFallbackOutbound(c);

  // Always demote Exact Match on search/category URLs (product-identity safety).
  if (isSearchOutbound && !isDepartmentPipelineStrict()) {
    if (c.confidenceBand === "exact_match") {
      const band = capConfidenceBandForSearchUrl("exact_match");
      return {
        ...c,
        confidenceBand: band,
        confidenceBandLabel: confidenceBandBadgeLabel(band),
        matchType:
          c.matchType === "exact_match" ? "close_match" : c.matchType,
      };
    }
    if (c.confidenceBandLabel) return c;
    const displayBefore =
      c.displayMatchScore ??
      displayMatchScore({
        relevanceScore: c.relevanceScore,
        identityScore: c.identityScore,
        departmentScore: c.departmentScore,
      });
    const band = c.confidenceBand ?? classifyConfidenceBand(displayBefore);
    return {
      ...c,
      confidenceBand: band,
      confidenceBandLabel: confidenceBandBadgeLabel(band),
    };
  }

  if (!isDepartmentPipelineStrict() || !isSearchOutbound) {
    if (c.confidenceBandLabel) return c;
    const displayBefore =
      c.displayMatchScore ??
      displayMatchScore({
        relevanceScore: c.relevanceScore,
        identityScore: c.identityScore,
        departmentScore: c.departmentScore,
      });
    const band = c.confidenceBand ?? classifyConfidenceBand(displayBefore);
    return {
      ...c,
      confidenceBand: band,
      confidenceBandLabel: confidenceBandBadgeLabel(band),
    };
  }

  const displayBefore =
    c.displayMatchScore ??
    displayMatchScore({
      relevanceScore: c.relevanceScore,
      identityScore: c.identityScore,
      departmentScore: c.departmentScore,
    });

  const capped = applyStrictSearchUrlScoreCap({
    displayMatchScore: displayBefore,
    relevanceScore: c.relevanceScore,
    identityScore: c.identityScore,
    departmentScore: c.departmentScore ?? null,
    confidence: c.confidence,
    confidenceBand: c.confidenceBand ?? classifyConfidenceBand(displayBefore),
  });

  const searchLabel =
    searchUrlConfidenceBandLabel() ?? confidenceBandBadgeLabel(capped.confidenceBand);

  return {
    ...c,
    displayMatchScore: capped.displayMatchScore,
    relevanceScore: capped.relevanceScore,
    identityScore: capped.identityScore,
    departmentScore: capped.departmentScore,
    confidence: capped.confidence,
    confidenceBand: capped.confidenceBand,
    confidenceBandLabel: searchLabel,
    score: capped.displayMatchScore,
    matchConfidenceLabel:
      capped.confidenceBand === "exact_match" || capped.confidenceBand === "high_confidence"
        ? "high"
        : capped.confidenceBand === "below_threshold"
          ? "low"
          : "medium",
  };
}

/** Partition capped display candidates into UI match groups (strict search cap safe). */
export function partitionCandidatesIntoMatchGroups(
  candidates: CompareApiCandidate[]
): MatchResultGroups<CompareApiCandidate> {
  const capped = applyStrictSearchUrlCapsToCandidates(candidates);
  const groups: MatchResultGroups<CompareApiCandidate> = {
    exactMatches: [],
    highConfidenceMatches: [],
    possibleAlternatives: [],
  };
  for (const c of capped) {
    const key = confidenceBandToResultGroup(c.confidenceBand ?? "below_threshold");
    if (key) groups[key].push(c);
  }
  const sortByDisplayScore = (a: CompareApiCandidate, b: CompareApiCandidate) => {
    const scoreA =
      a.displayMatchScore ??
      displayMatchScore({
        relevanceScore: a.relevanceScore,
        identityScore: a.identityScore,
        departmentScore: a.departmentScore,
      });
    const scoreB =
      b.displayMatchScore ??
      displayMatchScore({
        relevanceScore: b.relevanceScore,
        identityScore: b.identityScore,
        departmentScore: b.departmentScore,
      });
    return scoreB - scoreA;
  };
  groups.exactMatches.sort(sortByDisplayScore);
  groups.highConfidenceMatches.sort(sortByDisplayScore);
  groups.possibleAlternatives.sort(sortByDisplayScore);
  return groups;
}

export function applyStrictSearchUrlCapsToCandidates(
  candidates: CompareApiCandidate[]
): CompareApiCandidate[] {
  return candidates.map(applyStrictSearchUrlCapToCandidate);
}

/** Apply search URL score cap to best-deal / alternative rows. */
export function applyStrictSearchUrlCapToDeal(
  deal: CompareProductDeal
): CompareProductDeal {
  if (!isStrictSearchFallbackOutbound(deal)) return deal;
  if (!isDepartmentPipelineStrict()) {
    if (deal.confidenceBand !== "exact_match") return deal;
    const band = capConfidenceBandForSearchUrl("exact_match");
    return {
      ...deal,
      confidenceBand: band,
      confidenceBandLabel: confidenceBandBadgeLabel(band),
      matchType:
        deal.matchType === "exact_match" ? "close_match" : deal.matchType,
    };
  }

  const displayBefore =
    deal.displayMatchScore ??
    displayMatchScore({
      relevanceScore: deal.relevanceScore,
      identityScore: deal.identityScore,
      departmentScore: deal.departmentScore,
    });

  const capped = applyStrictSearchUrlScoreCap({
    displayMatchScore: displayBefore,
    relevanceScore: deal.relevanceScore,
    identityScore: deal.identityScore,
    departmentScore: deal.departmentScore ?? null,
    confidence: deal.confidence,
    confidenceBand: deal.confidenceBand ?? classifyConfidenceBand(displayBefore),
  });

  const searchLabel =
    searchUrlConfidenceBandLabel() ?? confidenceBandBadgeLabel(capped.confidenceBand);

  return {
    ...deal,
    displayMatchScore: capped.displayMatchScore,
    relevanceScore: capped.relevanceScore,
    identityScore: capped.identityScore,
    departmentScore: capped.departmentScore,
    confidence: capped.confidence,
    confidenceBand: capped.confidenceBand,
    confidenceBandLabel: searchLabel,
    score: capped.displayMatchScore,
  };
}

/**
 * Response-layer dedupe: UI renders POSSIBLE_ALTERNATIVES_EXPLANATION when only
 * possible-alternative bands qualify — do not also send it in `message`.
 */
export function dedupeCompareResponseMessages(args: {
  comparisonMessage: string | null;
  message: string | null;
  hasPossibleAlternativesOnly: boolean;
}): { comparisonMessage: string | null; message: string | null } {
  let { comparisonMessage, message } = args;
  if (!args.hasPossibleAlternativesOnly) {
    return { comparisonMessage, message };
  }

  if (message === POSSIBLE_ALTERNATIVES_EXPLANATION) {
    message = null;
  }

  if (comparisonMessage === POSSIBLE_ALTERNATIVES_EXPLANATION) {
    comparisonMessage = NO_EXACT_WITH_ALTERNATIVES_MESSAGE;
  }

  if (
    message === NO_EXACT_WITH_ALTERNATIVES_MESSAGE &&
    comparisonMessage === NO_EXACT_WITH_ALTERNATIVES_MESSAGE
  ) {
    message = null;
  }

  return { comparisonMessage, message };
}

/** Badge override for retailer search outbound URLs (strict pipeline only). */
export function searchUrlConfidenceBandLabel(): string | null {
  if (!isDepartmentPipelineStrict()) return null;
  return "Search Result — Verify Product";
}

/** User-facing reasoning lines shown under each result card. */
export function buildUserMatchReasons(args: {
  rel: AttributeMatchResult;
  identity: ProductIdentityResult;
  displayScore: number;
  confidenceBand: MatchConfidenceBand;
  selectedDepartment?: CompareFlowDepartment | null;
}): string[] {
  const lines: string[] = [];
  const explanation = args.rel.matchExplanation?.trim();
  if (
    explanation &&
    !/^Rejected:/i.test(explanation) &&
    !lines.includes(explanation)
  ) {
    lines.push(explanation);
  }

  const technical = [
    ...args.rel.reasons,
    ...args.identity.identityReasons,
  ].join(" ");

  const patterns = reasonPatternsForDepartment(args.selectedDepartment);
  const strictTools = isDepartmentPipelineStrict() && args.selectedDepartment === "tools";
  const voltageMentioned = technicalMentionsVoltage(technical);

  for (const { test, message } of patterns) {
    if (strictTools && message === "Tool platform appears compatible" && !voltageMentioned) {
      continue;
    }
    // Never show "close variant" copy under Exact Match.
    if (
      args.confidenceBand === "exact_match" &&
      message === "Same product line or close variant"
    ) {
      continue;
    }
    if (test.test(technical) && !lines.includes(message)) {
      lines.push(message);
    }
  }

  if (
    isDepartmentPipelineStrict() &&
    args.selectedDepartment === "tools" &&
    voltageMentioned &&
    /\bvoltage|battery.*platform/i.test(technical) &&
    !lines.includes("Tool platform appears compatible")
  ) {
    lines.push("Tool platform appears compatible");
  }

  if (args.identity.missingCriticalAttributes.length > 0) {
    const missing = "Some specs missing";
    if (!lines.includes(missing)) lines.push(missing);
  }

  if (lines.length === 0) {
    if (args.confidenceBand === "exact_match") {
      lines.push("Structured attributes align closely with your product");
    } else if (args.confidenceBand === "high_confidence") {
      lines.push("Key specs match — suitable for price comparison");
    } else if (args.confidenceBand === "similar_specs") {
      lines.push("Related listing with similar specs — verify before buying");
    } else if (args.confidenceBand === "possible_alternative") {
      lines.push("Possible alternative — confirm size, model, and accessories");
    } else {
      lines.push(`Match strength ${args.displayScore}/100 — verify listing details`);
    }
  }

  return lines.slice(0, 4);
}

export function isHardAttributeRejection(rejectionReason: string | null): boolean {
  if (!rejectionReason) return false;
  const r = rejectionReason.toLowerCase();
  if (r.startsWith("below_minimum_relevance")) return false;
  if (r.startsWith("below_department_score")) return false;
  if (r.startsWith("below_structured_threshold")) return false;
  if (r.includes("department_reject") && r.includes("below")) return false;
  return true;
}

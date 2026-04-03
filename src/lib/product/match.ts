import type { CandidateProduct, MatchTier, NormalizedProduct } from "./types";

/** Weak tier must meet at least this score to count as “trustworthy”. */
export const WEAK_MATCH_MIN_SCORE = 58;

const TV_SIZE_TOLERANCE_INCH = 0;

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function modelOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sb = new Set(b);
  let hit = 0;
  for (const t of a) {
    if (sb.has(t)) hit += 1;
  }
  return hit / Math.max(a.length, b.length);
}

export type HardGateResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Brand: never treat a different explicit brand as the same product for “best deal”.
 */
export function checkBrandGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (!source.brand || !candidate.brand) return { ok: true };
  if (source.brand === candidate.brand) return { ok: true };
  return {
    ok: false,
    reason: `brand_mismatch(source=${source.brand},candidate=${candidate.brand})`,
  };
}

/**
 * When both sides express a pack count, mismatches are not comparable.
 */
export function checkPackGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.packCount == null || candidate.packCount == null) {
    return { ok: true };
  }
  if (source.packCount === candidate.packCount) return { ok: true };
  return {
    ok: false,
    reason: `pack_count_mismatch(source=${source.packCount},candidate=${candidate.packCount})`,
  };
}

/**
 * TVs: reject clearly different screen sizes.
 */
export function checkTvSizeGate(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  if (source.category !== "tv" || candidate.category !== "tv") {
    return { ok: true };
  }
  if (source.sizeInches == null || candidate.sizeInches == null) {
    return { ok: true };
  }
  const diff = Math.abs(source.sizeInches - candidate.sizeInches);
  if (diff <= TV_SIZE_TOLERANCE_INCH) return { ok: true };
  return {
    ok: false,
    reason: `tv_size_mismatch(source=${source.sizeInches}",candidate=${candidate.sizeInches}")`,
  };
}

export function runHardGates(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): HardGateResult {
  const b = checkBrandGate(source, candidate);
  if (!b.ok) return b;
  const p = checkPackGate(source, candidate);
  if (!p.ok) return p;
  return checkTvSizeGate(source, candidate);
}

export function scoreMatch(
  source: NormalizedProduct,
  candidate: NormalizedProduct
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  const srcTokens = source.titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  const candTokens = candidate.titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  const jac = jaccard(srcTokens, candTokens);
  const jacScore = jac * 45;
  reasons.push(`title_jaccard=${jac.toFixed(2)}`);

  let brandScore = 0;
  if (source.brand && candidate.brand) {
    brandScore = source.brand === candidate.brand ? 25 : 0;
    reasons.push(`brand_match=${source.brand === candidate.brand}`);
  }

  const mo = modelOverlap(source.modelTokens, candidate.modelTokens);
  const modelScore = mo * 20;
  reasons.push(`model_overlap=${mo.toFixed(2)}`);

  let sizeScore = 0;
  if (source.category === "tv" && candidate.category === "tv") {
    if (
      source.sizeInches != null &&
      candidate.sizeInches != null &&
      source.sizeInches === candidate.sizeInches
    ) {
      sizeScore = 10;
      reasons.push(`tv_size_match=${source.sizeInches}`);
    }
  }

  const score = Math.min(
    100,
    Math.round(jacScore + brandScore + modelScore + sizeScore)
  );
  reasons.push(`raw_total≈${score}`);

  return { score, reasons };
}

export function classifyMatchTier(score: number): MatchTier {
  if (score >= 88) return "exact";
  if (score >= 75) return "strong";
  if (score >= 55) return "weak";
  return "none";
}

/**
 * “Trustworthy” for the ≥2 comparable requirement: exact/strong, or weak above floor.
 */
export function isTrustworthyTier(tier: MatchTier, score: number): boolean {
  if (tier === "exact" || tier === "strong") return true;
  if (tier === "weak" && score >= WEAK_MATCH_MIN_SCORE) return true;
  return false;
}

export function evaluateCandidate(
  source: NormalizedProduct,
  candidate: CandidateProduct
): {
  score: number;
  tier: MatchTier;
  reasons: string[];
  rejected: boolean;
  rejectionDetail: string | null;
} {
  const gate = runHardGates(source, candidate.normalized);
  if (!gate.ok) {
    return {
      score: 0,
      tier: "none",
      reasons: [gate.reason],
      rejected: true,
      rejectionDetail: gate.reason,
    };
  }

  const { score, reasons } = scoreMatch(source, candidate.normalized);
  const tier = classifyMatchTier(score);

  if (tier === "none" || !isTrustworthyTier(tier, score)) {
    return {
      score,
      tier,
      reasons,
      rejected: false,
      rejectionDetail: `below_trustworthy_threshold(tier=${tier},score=${score},weak_min=${WEAK_MATCH_MIN_SCORE})`,
    };
  }

  return {
    score,
    tier,
    reasons,
    rejected: false,
    rejectionDetail: null,
  };
}

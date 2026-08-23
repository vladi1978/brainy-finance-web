import {
  candidateTitleMentionsSourceOemBrand,
  isSmartTvPlatformToken,
  normalizeTitle,
  toComparisonCategory,
  tokenizeSignificant,
} from "../normalize";
import type {
  NormalizedProduct,
  ProductCategory,
  ProductCondition,
  ProductIdentityMatchType,
  SourceScrapedHints,
} from "../types";
import {
  buildUniversalMatchSnapshot,
  modelNeedlesFromSnapshot,
  snapshotSearchBlob,
  type UniversalMatchSnapshot,
} from "./snapshot";

export type UniversalProductIdentity = {
  brand: string | null;
  modelIdentifiers: string[];
  productLine: string | null;
  sizeInches: number | null;
  sizeLabel: string | null;
  dimensionSignatures: string[];
  color: string | null;
  material: string | null;
  packCount: number | null;
  capacity: string | null;
  condition: ProductCondition;
  category: ProductCategory;
  technicalSpecs: string[];
};

export type ProductIdentityResult = {
  matchType: ProductIdentityMatchType;
  /** 0–100 — higher means stronger same-product identity */
  identityScore: number;
  identityReasons: string[];
  missingCriticalAttributes: string[];
};

/** Marketing / filler tokens — low weight in title overlap. */
const GENERIC_MARKETING_TOKENS = new Set([
  "smart",
  "premium",
  "new",
  "best",
  "kit",
  "set",
  "pro",
  "plus",
  "compatible",
  "original",
  "authentic",
  "quality",
  "deluxe",
  "ultra",
  "super",
  "ultimate",
  "official",
  "genuine",
  "universal",
  "multi",
  "value",
  "bundle",
  "edition",
  "series",
  "with",
  "for",
  "and",
  "the",
]);

const MATERIAL_RE =
  /\b(cotton|polyester|wool|leather|nylon|spandex|linen|silk|denim|canvas|steel|aluminum|aluminium|wood|plastic|rubber|glass|ceramic|stainless|brass|copper|vinyl|bamboo|carbon|fiberglass|resin|acrylic|foam|memory foam)\b/i;

const CAPACITY_RE =
  /\b(\d+(?:\.\d+)?)\s*(gal|gallon|gallons|liters?|l|ml|oz|ounce|ounces|lb|lbs|pound|pounds|cu\.?\s*ft|cubic\s*feet|quart|qt|kg|g|gram|grams)\b/i;

const DIMENSION_RE =
  /\b(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?\s*(?:in|inch|inches|cm|ft|feet)?\b/gi;

function normAlnum(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normSku(s: string | null | undefined): string {
  if (!s) return "";
  return normAlnum(s);
}

function extractMaterial(title: string): string | null {
  const m = normalizeTitle(title).match(MATERIAL_RE);
  return m ? m[1]!.toLowerCase() : null;
}

function extractCapacity(title: string): string | null {
  const m = normalizeTitle(title).match(CAPACITY_RE);
  if (!m) return null;
  const unit = m[2]!.toLowerCase().replace(/\s+/g, "");
  const val = m[1]!;
  return `${val}${unit}`;
}

function extractDimensionSignatures(title: string, critical?: string[]): string[] {
  const out = new Set<string>();
  for (const sig of critical ?? []) {
    const s = sig.replace(/\s+/g, "").toLowerCase();
    if (s.length >= 2) out.add(s);
  }
  const norm = normalizeTitle(title);
  for (const m of norm.matchAll(DIMENSION_RE)) {
    const parts = [m[1], m[2], m[3]].filter(Boolean).join("x");
    if (parts.length >= 3) out.add(parts.replace(/\s+/g, ""));
  }
  const inchSig = norm.match(/\b(\d{1,3})\s*(?:inch|inches|in|")\b/);
  if (inchSig) out.add(`${inchSig[1]}inch`);
  return [...out].slice(0, 12);
}

function technicalSpecTags(snap: UniversalMatchSnapshot, title: string): string[] {
  const tags = new Set<string>();
  if (snap.resolutionTier) tags.add(`resolution:${snap.resolutionTier}`);
  if (snap.displayPanel) tags.add(`panel:${snap.displayPanel}`);
  if (snap.smartTv === true) tags.add("smart:true");
  if (snap.smartTv === false) tags.add("smart:false");
  if (snap.gender) tags.add(`gender:${snap.gender}`);
  const n = normalizeTitle(title);
  for (const m of n.matchAll(
    /\b(wifi|bluetooth|usb[\s-]?c|hdmi|rechargeable|cordless|wireless|waterproof|energy star|hepa|variable speed|brushless|stainless steel)\b/gi
  )) {
    tags.add(m[0]!.toLowerCase().replace(/\s+/g, "_"));
  }
  return [...tags].slice(0, 16);
}

export function extractUniversalProductIdentity(
  norm: NormalizedProduct,
  title: string,
  hints?: SourceScrapedHints | null
): UniversalProductIdentity {
  const snap = buildUniversalMatchSnapshot(norm);
  const st = norm.structured;
  const modelIds = new Set<string>();
  for (const n of modelNeedlesFromSnapshot(snap)) modelIds.add(n);
  if (hints?.retailerSku) modelIds.add(normSku(hints.retailerSku));
  if (hints?.modelOrMpn) modelIds.add(normSku(hints.modelOrMpn));
  for (const t of norm.modelTokens) {
    const u = normSku(t);
    if (u.length >= 4) modelIds.add(u);
  }

  return {
    brand: hints?.brand?.trim().toLowerCase() ?? norm.brand ?? st.brand,
    modelIdentifiers: [...modelIds],
    productLine: st.modelFamily ? normSku(st.modelFamily) : null,
    sizeInches: snap.diagonalInches,
    sizeLabel: snap.sizeLabel,
    dimensionSignatures: extractDimensionSignatures(
      title,
      norm.critical?.dimensionSignatures
    ),
    color: snap.color,
    material: extractMaterial(title),
    packCount: snap.packCount,
    capacity: extractCapacity(title),
    condition: snap.condition,
    category: norm.category,
    technicalSpecs: technicalSpecTags(snap, title),
  };
}

function needleFuzzyInBlob(needle: string, blob: string): boolean {
  if (needle.length < 4) return false;
  if (blob.includes(needle)) return true;
  const n = needle.length;
  for (let i = 0; i + n <= blob.length; i++) {
    let diff = 0;
    for (let j = 0; j < n; j++) {
      if (blob[i + j] !== needle[j]) diff++;
      if (diff > 1) break;
    }
    if (diff <= 1) return true;
  }
  return false;
}

function modelOverlap(
  source: UniversalProductIdentity,
  candidate: UniversalProductIdentity,
  candBlob: string
): { matched: boolean; partial: boolean; reason: string } {
  if (source.modelIdentifiers.length === 0) {
    return { matched: false, partial: false, reason: "model:source_unknown" };
  }
  const srcNeedles = source.modelIdentifiers.filter((n) => n.length >= 4);
  if (srcNeedles.length === 0) {
    return { matched: false, partial: false, reason: "model:no_source_needles" };
  }
  for (const n of srcNeedles) {
    if (needleFuzzyInBlob(n, candBlob)) {
      return { matched: true, partial: false, reason: `model:needle_hit(${n})` };
    }
  }
  const candSet = new Set(candidate.modelIdentifiers);
  const inter = srcNeedles.filter((n) => candSet.has(n));
  if (inter.length > 0) {
    return {
      matched: true,
      partial: false,
      reason: `model:token_overlap(${inter[0]})`,
    };
  }
  if (source.productLine && candidate.productLine) {
    if (
      source.productLine === candidate.productLine ||
      needleFuzzyInBlob(source.productLine, candBlob)
    ) {
      return {
        matched: false,
        partial: true,
        reason: `model_line:partial(${source.productLine})`,
      };
    }
  }
  return { matched: false, partial: false, reason: "model:miss" };
}

function significantTitleTokens(title: string): string[] {
  return tokenizeSignificant(title).filter((t) => !GENERIC_MARKETING_TOKENS.has(t));
}

function titleIdentityBonus(sourceTitle: string, candidateTitle: string): {
  points: number;
  reason: string;
} {
  const a = new Set(significantTitleTokens(sourceTitle));
  const b = new Set(significantTitleTokens(candidateTitle));
  if (a.size === 0 || b.size === 0) {
    return { points: 0, reason: "title:no_significant_tokens" };
  }
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const ratio = inter / Math.min(a.size, b.size);
  const points = Math.round(Math.min(8, ratio * 10));
  return {
    points,
    reason: `title:significant_overlap(${inter}/${Math.min(a.size, b.size)})`,
  };
}

type AxisOutcome = "match" | "partial" | "miss" | "na";

function scoreAxis(
  key: string,
  weight: number,
  outcome: AxisOutcome
): { points: number; reason: string } {
  if (outcome === "na") return { points: 0, reason: `${key}:na` };
  if (outcome === "match") return { points: weight, reason: `${key}:match(+${weight})` };
  if (outcome === "partial") {
    const p = Math.round(weight * 0.55);
    return { points: p, reason: `${key}:partial(+${p})` };
  }
  return { points: -Math.round(weight * 0.85), reason: `${key}:miss(-${Math.round(weight * 0.85)})` };
}

function brandPartialMatchViaCandidate(
  sourceBrand: string,
  candidateBrand: string | null,
  candidateTitle: string,
  candBlob: string
): boolean {
  if (
    isSmartTvPlatformToken(sourceBrand) &&
    candidateBrand &&
    candidateBrand !== sourceBrand
  ) {
    return false;
  }
  return (
    candBlob.includes(normAlnum(sourceBrand)) ||
    candidateTitleMentionsSourceOemBrand({
      sourceBrand,
      candidateBrand,
      candidateTitle,
    })
  );
}

export function scoreProductIdentity(
  sourceNorm: NormalizedProduct,
  candidateNorm: NormalizedProduct,
  candidateTitle: string,
  options?: { sourceTitle?: string; sourceHints?: SourceScrapedHints | null }
): ProductIdentityResult {
  const sourceTitle = options?.sourceTitle ?? sourceNorm.structured.title;
  const source = extractUniversalProductIdentity(
    sourceNorm,
    sourceTitle,
    options?.sourceHints
  );
  const candidate = extractUniversalProductIdentity(candidateNorm, candidateTitle);
  const candSnap = buildUniversalMatchSnapshot(candidateNorm);
  const candBlob = snapshotSearchBlob(candSnap);

  const reasons: string[] = [];
  const missingCritical: string[] = [];
  let rawScore = 0;
  let maxPossible = 0;

  const srcCat = toComparisonCategory(source.category);
  const candCat = toComparisonCategory(candidate.category);
  const categoryOutcome: AxisOutcome =
    srcCat === candCat || candCat === "generic" ? "match" : "miss";
  if (categoryOutcome === "miss") {
    missingCritical.push("category");
  }
  const catW = 10;
  maxPossible += catW;
  const catR = scoreAxis("category", catW, categoryOutcome);
  rawScore += catR.points;
  reasons.push(catR.reason);

  if (source.brand) {
    const brandW = 14;
    maxPossible += brandW;
    let outcome: AxisOutcome = "miss";
    if (!candidate.brand) {
      missingCritical.push("brand");
      outcome = "partial";
    } else if (source.brand === candidate.brand) {
      outcome = "match";
    } else if (
      brandPartialMatchViaCandidate(
        source.brand,
        candidate.brand,
        candidateTitle,
        candBlob
      )
    ) {
      outcome = "partial";
    } else {
      missingCritical.push("brand");
    }
    const br = scoreAxis("brand", brandW, outcome);
    rawScore += br.points;
    reasons.push(br.reason);
  }

  if (source.modelIdentifiers.length > 0) {
    const modelW = 28;
    maxPossible += modelW;
    const mo = modelOverlap(source, candidate, candBlob);
    let outcome: AxisOutcome = "miss";
    if (mo.matched) outcome = "match";
    else if (mo.partial) outcome = "partial";
    else missingCritical.push("model_number");
    const mr = scoreAxis("model", modelW, outcome);
    rawScore += mr.points;
    reasons.push(mr.reason);
    reasons.push(mo.reason);
  }

  if (source.productLine) {
    const lineW = 12;
    maxPossible += lineW;
    let outcome: AxisOutcome = "na";
    if (!candidate.productLine && !moLineHit(source.productLine, candBlob)) {
      missingCritical.push("product_line");
      outcome = "partial";
    } else if (
      candidate.productLine === source.productLine ||
      moLineHit(source.productLine, candBlob)
    ) {
      outcome = "match";
    } else {
      outcome = "miss";
      missingCritical.push("product_line");
    }
    const lr = scoreAxis("product_line", lineW, outcome);
    rawScore += lr.points;
    reasons.push(lr.reason);
  }

  if (source.sizeInches != null) {
    const sizeW = 18;
    maxPossible += sizeW;
    let outcome: AxisOutcome = "miss";
    if (candidate.sizeInches == null) {
      missingCritical.push("size");
      outcome = "partial";
    } else if (Math.abs(source.sizeInches - candidate.sizeInches) <= 1) {
      outcome = "match";
    } else if (Math.abs(source.sizeInches - candidate.sizeInches) <= 3) {
      outcome = "partial";
      missingCritical.push("size");
    } else {
      missingCritical.push("size");
    }
    const sr = scoreAxis("size", sizeW, outcome);
    rawScore += sr.points;
    reasons.push(sr.reason);
  } else if (source.sizeLabel) {
    const sizeW = 14;
    maxPossible += sizeW;
    const outcome: AxisOutcome =
      candidate.sizeLabel === source.sizeLabel
        ? "match"
        : candidate.sizeLabel
          ? "miss"
          : "partial";
    if (outcome !== "match") missingCritical.push("size_label");
    const sr = scoreAxis("size_label", sizeW, outcome);
    rawScore += sr.points;
    reasons.push(sr.reason);
  }

  if (source.dimensionSignatures.length > 0) {
    const dimW = 16;
    maxPossible += dimW;
    const candDims = new Set(candidate.dimensionSignatures);
    const hits = source.dimensionSignatures.filter((d) => candDims.has(d));
    let outcome: AxisOutcome = "miss";
    if (hits.length === source.dimensionSignatures.length && hits.length > 0) {
      outcome = "match";
    } else if (hits.length > 0) {
      outcome = "partial";
      missingCritical.push("dimensions");
    } else {
      missingCritical.push("dimensions");
    }
    const dr = scoreAxis("dimensions", dimW, outcome);
    rawScore += dr.points;
    reasons.push(dr.reason);
  }

  if (source.packCount != null && source.packCount > 0) {
    const packW = 12;
    maxPossible += packW;
    let outcome: AxisOutcome = "miss";
    if (candidate.packCount == null) {
      missingCritical.push("pack_count");
      outcome = "partial";
    } else if (candidate.packCount === source.packCount) {
      outcome = "match";
    } else if (
      Math.max(source.packCount, candidate.packCount) /
        Math.min(source.packCount, candidate.packCount) <=
      1.5
    ) {
      outcome = "partial";
      missingCritical.push("pack_count");
    } else {
      missingCritical.push("pack_count");
    }
    const pr = scoreAxis("pack_count", packW, outcome);
    rawScore += pr.points;
    reasons.push(pr.reason);
  }

  if (source.capacity) {
    const capW = 10;
    maxPossible += capW;
    const outcome: AxisOutcome =
      candidate.capacity === source.capacity
        ? "match"
        : candidate.capacity
          ? "miss"
          : "partial";
    if (outcome !== "match") missingCritical.push("capacity");
    const cr = scoreAxis("capacity", capW, outcome);
    rawScore += cr.points;
    reasons.push(cr.reason);
  }

  if (source.color) {
    const colorW = 8;
    maxPossible += colorW;
    const outcome: AxisOutcome =
      candidate.color === source.color
        ? "match"
        : candidate.color
          ? "miss"
          : "partial";
    if (outcome !== "match") missingCritical.push("color");
    const clr = scoreAxis("color", colorW, outcome);
    rawScore += clr.points;
    reasons.push(clr.reason);
  }

  if (source.material) {
    const matW = 6;
    maxPossible += matW;
    const outcome: AxisOutcome =
      candidate.material === source.material
        ? "match"
        : candidate.material
          ? "miss"
          : "partial";
    if (outcome !== "match") missingCritical.push("material");
    const matr = scoreAxis("material", matW, outcome);
    rawScore += matr.points;
    reasons.push(matr.reason);
  }

  if (source.condition !== "unknown" && source.condition !== "new") {
    const condW = 10;
    maxPossible += condW;
    const outcome: AxisOutcome =
      candidate.condition === source.condition
        ? "match"
        : candidate.condition === "unknown"
          ? "partial"
          : "miss";
    if (outcome !== "match") missingCritical.push("condition");
    const cr = scoreAxis("condition", condW, outcome);
    rawScore += cr.points;
    reasons.push(cr.reason);
  } else if (source.condition === "new" && candidate.condition !== "new") {
    const condW = 10;
    maxPossible += condW;
    const outcome: AxisOutcome = "miss";
    missingCritical.push("condition");
    const cr = scoreAxis("condition", condW, outcome);
    rawScore += cr.points;
    reasons.push(cr.reason);
  }

  if (source.technicalSpecs.length > 0) {
    const specW = 10;
    maxPossible += specW;
    const candSet = new Set(candidate.technicalSpecs);
    const hits = source.technicalSpecs.filter((s) => candSet.has(s));
    const ratio = hits.length / source.technicalSpecs.length;
    let outcome: AxisOutcome = "miss";
    if (ratio >= 0.85) outcome = "match";
    else if (ratio >= 0.4) outcome = "partial";
    else missingCritical.push("technical_specs");
    const sr = scoreAxis("technical_specs", specW, outcome);
    rawScore += sr.points;
    reasons.push(sr.reason);
  }

  const titleBonus = titleIdentityBonus(sourceTitle, candidateTitle);
  rawScore += titleBonus.points;
  reasons.push(titleBonus.reason);

  const identityScore =
    maxPossible > 0
      ? Math.max(0, Math.min(100, Math.round((rawScore / maxPossible) * 100)))
      : Math.max(0, Math.min(100, 40 + titleBonus.points * 3));

  const modelHit =
    source.modelIdentifiers.length === 0 ||
    modelOverlap(source, candidate, candBlob).matched;
  const hasHardConflict =
    categoryOutcome === "miss" ||
    (source.brand &&
      candidate.brand &&
      source.brand !== candidate.brand &&
      !brandPartialMatchViaCandidate(
        source.brand,
        candidate.brand,
        candidateTitle,
        candBlob
      )) ||
    (source.sizeInches != null &&
      candidate.sizeInches != null &&
      Math.abs(source.sizeInches - candidate.sizeInches) > 4);

  let matchType: ProductIdentityMatchType;
  if (hasHardConflict) {
    matchType = "alternative";
    reasons.push("tier:hard_conflict→alternative");
  } else if (
    identityScore >= 82 &&
    modelHit &&
    (source.modelIdentifiers.length > 0 ||
      (source.brand && source.sizeInches != null) ||
      (source.brand && source.packCount != null))
  ) {
    matchType = "exact_match";
    reasons.push("tier:exact_match");
  } else if (identityScore >= 58 || (modelHit && identityScore >= 48)) {
    matchType = "close_match";
    reasons.push("tier:close_match");
  } else {
    matchType = "alternative";
    reasons.push("tier:alternative");
  }

  return {
    matchType,
    identityScore,
    identityReasons: reasons,
    missingCriticalAttributes: [...new Set(missingCritical)],
  };
}

function moLineHit(line: string, blob: string): boolean {
  return line.length >= 4 && needleFuzzyInBlob(line, blob);
}

export function rankIdentityMatchTypes(
  a: ProductIdentityMatchType,
  b: ProductIdentityMatchType
): number {
  const order: Record<ProductIdentityMatchType, number> = {
    exact_match: 0,
    close_match: 1,
    alternative: 2,
  };
  return order[a] - order[b];
}

export function identityMatchLabel(type: ProductIdentityMatchType): string {
  switch (type) {
    case "exact_match":
      return "Best Deal";
    case "close_match":
      return "Similar Product";
    case "alternative":
      return "Alternative Option";
  }
}

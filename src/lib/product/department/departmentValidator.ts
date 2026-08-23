import { candidateTitleMentionsSourceOemBrand, normalizeTitle } from "../normalize";
import type { NormalizedProduct } from "../types";
import type { CompareFlowDepartment } from "../compareFlowDepartment";
import { getDepartmentConfig } from "./departmentConfig";
import {
  extractDepartmentAttributes,
} from "./attributeExtractor";
import {
  parseDimensionPairs,
  poolDimensionsDrasticallyDifferent,
  poolShapesIncompatible,
} from "../matching/criticalSpecs";
import { screenSizeShouldHardReject } from "../matching/displayDimensions";
import { buildUniversalMatchSnapshot } from "../matching/snapshot";
import type {
  DepartmentConfig,
  DepartmentRejectRuleId,
  DepartmentValidationResult,
  ExtractedDepartmentAttributes,
} from "./types";

const ACCESSORY_ONLY_RE =
  /\b(replacement\s*part|parts?\s*only|accessory\s*only|compatible\s*with|for\s+use\s+with|remote\s*only|stand\s*only|mount\s*only|case\s*only|screen\s*protector|hdmi\s*cable|power\s*cord\s*only|filter\s*cartridge|pump\s*only|cover\s*only|liner\s*only|battery\s*only|charger\s*only|blade\s*only|bit\s*set\s*only|attachment\s*only)\b/i;

const POOL_CHEMICAL_RE =
  /\b(chlorine|shock|algaecide|pool\s*chemical|water\s*balanc|ph\s*increaser|ph\s*decreaser|clarifier|sanitizer\s*tablet|bromine)\b/i;

const COVER_LINER_ONLY_RE =
  /\b(pool\s*cover|winter\s*cover|solar\s*cover|ground\s*cloth|pool\s*liner|beaded\s*liner|overlap\s*liner)\b/i;

const FULL_POOL_RE =
  /\b(above\s*ground\s*pool|swimming\s*pool|pool\s*set|pool\s*kit|pool\s*with\s*pump|complete\s*pool)\b/i;

const ELECTRONICS_CORE_RE =
  /\b(tv|television|monitor|laptop|tablet|phone|smartphone|headphone|speaker|camera|console|gpu|processor|ssd|hard\s*drive)\b/i;

const REFURBISHED_RE =
  /\b(refurbished|renewed|open\s*box|open-box|pre\s*owned|pre-owned|used\s*condition)\b/i;

const INFLATABLE_RE = /\b(inflatable|blow\s*up|pop\s*up)\b/i;
const STEEL_FRAME_RE = /\b(steel\s*frame|metal\s*frame|hard\s*sided|hardside)\b/i;

function dimensionsClose(a: string, b: string): boolean {
  const parsePair = (s: string): [number, number] | null => {
    const parts = s.replace(/\s+/g, "").split("x");
    if (parts.length !== 2) return null;
    const x = parseFloat(parts[0]!);
    const y = parseFloat(parts[1]!);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return [x, y];
  };
  const pa = parsePair(a);
  const pb = parsePair(b);
  if (!pa || !pb) return a === b;
  const close = (x: number, y: number) =>
    x === y || Math.abs(x - y) / Math.max(x, y, 1) <= 0.03;
  return close(pa[0], pb[0]) && close(pa[1], pb[1]);
}

function modelSeriesOverlap(
  sourceModel: string | null | undefined,
  candidateModel: string | null | undefined
): boolean {
  if (!sourceModel || !candidateModel) return true;
  const a = sourceModel.replace(/[^a-z0-9]/g, "");
  const b = candidateModel.replace(/[^a-z0-9]/g, "");
  if (a.length < 4 || b.length < 4) return true;
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  const prefix = a.slice(0, Math.min(5, minLen));
  return b.startsWith(prefix) || a.startsWith(b.slice(0, Math.min(5, minLen)));
}

function batteryPlatformsCompatible(
  source: string | null | undefined,
  candidate: string | null | undefined
): boolean {
  if (!source || !candidate) return true;
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const a = norm(source);
  const b = norm(candidate);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const dewalt = /dewalt|20vmax|20v/;
  const milwaukee = /milwaukee|m18|m12/;
  if (dewalt.test(a) && dewalt.test(b)) return true;
  if (milwaukee.test(a) && milwaukee.test(b)) return true;
  return false;
}

function isAccessoryOnly(title: string): boolean {
  return ACCESSORY_ONLY_RE.test(normalizeTitle(title));
}

function applyRejectRule(
  ruleId: DepartmentRejectRuleId,
  config: DepartmentConfig,
  sourceAttrs: ExtractedDepartmentAttributes,
  candidateAttrs: ExtractedDepartmentAttributes,
  sourceNorm: NormalizedProduct,
  candidateNorm: NormalizedProduct,
  sourceTitle: string,
  candidateTitle: string
): string | null {
  const rule = config.rejectRules.find((r) => r.id === ruleId);
  if (!rule) return null;

  const candBlob = normalizeTitle(`${candidateTitle} ${candidateNorm.structured.title}`);
  const srcBlob = normalizeTitle(`${sourceTitle} ${sourceNorm.structured.title}`);

  switch (ruleId) {
    case "wrong_screen_size": {
      const srcSnap = buildUniversalMatchSnapshot(sourceNorm);
      const candSnap = buildUniversalMatchSnapshot(candidateNorm);
      if (
        srcSnap.diagonalInches != null &&
        candSnap.diagonalInches != null &&
        screenSizeShouldHardReject(srcSnap.diagonalInches, candSnap.diagonalInches)
      ) {
        return rule.label;
      }
      const src = sourceAttrs.screenSize;
      const cand = candidateAttrs.screenSize;
      if (src && cand) {
        const na = parseInt(src.replace(/[^0-9]/g, ""), 10);
        const nb = parseInt(cand.replace(/[^0-9]/g, ""), 10);
        if (
          Number.isFinite(na) &&
          Number.isFinite(nb) &&
          screenSizeShouldHardReject(na, nb)
        ) {
          return rule.label;
        }
      }
      return null;
    }
    case "different_model_series": {
      if (
        !modelSeriesOverlap(sourceAttrs.modelNumber, candidateAttrs.modelNumber)
      ) {
        return rule.label;
      }
      return null;
    }
    case "accessory_only": {
      if (isAccessoryOnly(candidateTitle)) return rule.label;
      return null;
    }
    case "refurbished_unlabeled": {
      const srcCond = sourceNorm.structured.condition;
      const candCond = candidateNorm.structured.condition;
      const secondhand = (c: string) =>
        c === "renewed" || c === "refurbished" || c === "used" || c === "open_box";
      if (
        !secondhand(srcCond) &&
        secondhand(candCond) &&
        !REFURBISHED_RE.test(candBlob)
      ) {
        return rule.label;
      }
      return null;
    }
    case "unrelated_product": {
      if (
        ELECTRONICS_CORE_RE.test(srcBlob) &&
        !ELECTRONICS_CORE_RE.test(candBlob) &&
        !sourceNorm.brand
      ) {
        return rule.label;
      }
      if (
        sourceNorm.brand &&
        candidateNorm.brand &&
        sourceNorm.brand !== candidateNorm.brand &&
        !candidateTitleMentionsSourceOemBrand({
          sourceBrand: sourceNorm.brand,
          candidateBrand: candidateNorm.brand,
          candidateTitle,
        })
      ) {
        const srcSize = sourceAttrs.screenSize;
        const candSize = candidateAttrs.screenSize;
        if (srcSize && !candSize) return rule.label;
      }
      return null;
    }
    case "pool_chemicals": {
      if (POOL_CHEMICAL_RE.test(candBlob)) return rule.label;
      return null;
    }
    case "cover_liner_only": {
      if (FULL_POOL_RE.test(srcBlob) && COVER_LINER_ONLY_RE.test(candBlob)) {
        return rule.label;
      }
      return null;
    }
    case "wrong_dimensions": {
      if (
        poolShapesIncompatible(sourceAttrs.shape, candidateAttrs.shape)
      ) {
        return rule.label;
      }
      const srcDim = sourceAttrs.dimensions;
      const candDim = candidateAttrs.dimensions;
      if (
        srcDim &&
        candDim &&
        poolDimensionsDrasticallyDifferent(srcDim, candDim)
      ) {
        return rule.label;
      }
      if (srcDim && !candDim) {
        const pairs = parseDimensionPairs(candBlob);
        if (
          pairs.length > 0 &&
          poolDimensionsDrasticallyDifferent(srcDim, pairs[0]!.key)
        ) {
          return rule.label;
        }
      }
      return null;
    }
    case "frame_type_mismatch": {
      const srcFrame = sourceAttrs.frameType;
      const candFrame = candidateAttrs.frameType;
      if (!srcFrame || !candFrame) return null;
      const srcInflatable = INFLATABLE_RE.test(srcFrame) || INFLATABLE_RE.test(srcBlob);
      const candSteel = STEEL_FRAME_RE.test(candFrame) || STEEL_FRAME_RE.test(candBlob);
      const srcSteel = STEEL_FRAME_RE.test(srcFrame) || STEEL_FRAME_RE.test(srcBlob);
      const candInflatable = INFLATABLE_RE.test(candFrame) || INFLATABLE_RE.test(candBlob);
      if (srcSteel && candInflatable) return rule.label;
      if (srcInflatable && candSteel) return rule.label;
      return null;
    }
    case "wrong_voltage": {
      const sv = sourceAttrs.voltage ?? sourceNorm.structured.toolVoltage;
      const cv = candidateAttrs.voltage ?? candidateNorm.structured.toolVoltage;
      if (sv && cv && sv.toLowerCase() !== cv.toLowerCase()) return rule.label;
      return null;
    }
    case "incompatible_battery_platform": {
      if (
        !batteryPlatformsCompatible(
          sourceAttrs.batteryPlatform,
          candidateAttrs.batteryPlatform
        )
      ) {
        if (sourceAttrs.batteryPlatform && candidateAttrs.batteryPlatform) {
          return rule.label;
        }
      }
      return null;
    }
    case "different_tool_type": {
      const st = sourceAttrs.toolType;
      const ct = candidateAttrs.toolType;
      if (st && ct && st !== ct && !ct.includes(st) && !st.includes(ct)) {
        return rule.label;
      }
      return null;
    }
    case "bare_tool_when_kit_expected": {
      if (sourceAttrs.kitVsBare === "kit" && candidateAttrs.kitVsBare === "bare") {
        if (!/\bbare\b/i.test(candBlob)) return rule.label;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Run department-specific reject rules against a source/candidate pair. */
export function validateDepartmentMatch(
  departmentId: CompareFlowDepartment,
  sourceNorm: NormalizedProduct,
  candidateNorm: NormalizedProduct,
  sourceTitle: string,
  candidateTitle: string
): DepartmentValidationResult {
  const config = getDepartmentConfig(departmentId);
  const sourceAttrs = extractDepartmentAttributes(
    departmentId,
    sourceNorm,
    sourceTitle
  );
  const candidateAttrs = extractDepartmentAttributes(
    departmentId,
    candidateNorm,
    candidateTitle
  );

  const rejectionReasons: string[] = [];
  const penalties: string[] = [];
  let penaltyFactor = 1;

  for (const rule of config.rejectRules) {
    const hit = applyRejectRule(
      rule.id,
      config,
      sourceAttrs,
      candidateAttrs,
      sourceNorm,
      candidateNorm,
      sourceTitle,
      candidateTitle
    );
    if (!hit) continue;
    if (rule.hardReject) {
      rejectionReasons.push(hit);
    } else {
      penalties.push(hit);
      penaltyFactor *= rule.penaltyWeight;
    }
  }

  return {
    rejected: rejectionReasons.length > 0,
    rejectionReasons,
    penalties,
    penaltyFactor,
  };
}

import { normalizeTitle } from "../normalize";
import type { NormalizedProduct } from "../types";
import {
  buildCriticalSpecsSnapshot,
  parseDimensionPairs,
} from "../matching/criticalSpecs";
import { buildUniversalMatchSnapshot } from "../matching/snapshot";
import type { CompareFlowDepartment } from "../compareFlowDepartment";
import { getDepartmentConfig } from "./departmentConfig";
import type {
  DepartmentAttributeKey,
  ExtractedDepartmentAttributes,
} from "./types";

const STORAGE_RE =
  /\b(\d+)\s*(?:gb|tb|gigabyte|terabyte)\b/i;
const REFRESH_RE = /\b(\d+)\s*hz\b/i;

const POOL_SHAPE_RE =
  /\b(round|oval|rectangular|rectangle|square|octagon)\b/i;
const POOL_DEPTH_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:deep|depth|tall|high)\b/i;
const FRAME_TYPE_RE =
  /\b(steel\s*frame|metal\s*frame|hard\s*sided|hardside|inflatable|soft\s*side|softside|above\s*ground|pop\s*up)\b/i;
const LINER_RE = /\b(liner|beaded|overlap|unibead|j\s*hook|j\s*bead)\b/i;
const POOL_TYPE_RE =
  /\b(above\s*ground|in\s*ground|inground|portable|kiddie|splash\s*pad|hot\s*tub|spa)\b/i;

const BATTERY_PLATFORM_RE =
  /\b(dewalt\s*20v|20v\s*max|milwaukee\s*m18|m18|m12|ryobi\s*18v|18v\s*one\+|makita\s*lxt|lxt|bosch\s*18v|flexvolt|60v\s*max|40v)\b/i;

const TOOL_TYPE_RE =
  /\b(drill|driver|impact|saw|circular\s*saw|jigsaw|reciprocating|grinder|sander|router|multitool|multi\s*tool|blower|trimmer|mower|chainsaw|hammer\s*drill|rotary\s*hammer|nailer|stapler|wrench|ratchet)\b/i;

const BRUSHLESS_RE = /\b(brushless|brushed|brush\s*less)\b/i;

const KIT_RE =
  /\b(kit|combo|bundle|with\s*battery|with\s*charger|battery\s*and\s*charger|2\s*tool|3\s*tool|4\s*tool|5\s*tool)\b/i;
const BARE_TOOL_RE =
  /\b(bare\s*tool|tool\s*only|no\s*battery|without\s*battery|skin\s*only)\b/i;

function extractStorage(title: string): string | null {
  const m = normalizeTitle(title).match(STORAGE_RE);
  return m ? `${m[1]}${m[0]!.toLowerCase().includes("tb") ? "tb" : "gb"}` : null;
}

function extractRefreshRate(title: string): string | null {
  const m = normalizeTitle(title).match(REFRESH_RE);
  return m ? `${m[1]}hz` : null;
}

function extractDimensions(title: string, norm: NormalizedProduct): string | null {
  const pairs = parseDimensionPairs(`${title} ${norm.structured.title}`);
  if (pairs.length > 0) return pairs[0]!.key;
  for (const sig of norm.critical?.dimensionSignatures ?? []) {
    if (sig.includes("x")) return sig.replace(/\s+/g, "").toLowerCase();
  }
  return null;
}

function extractCapacity(title: string, norm: NormalizedProduct): string | null {
  const snap = buildCriticalSpecsSnapshot(norm, title);
  return snap.capacity;
}

function extractFrameType(title: string): string | null {
  const m = normalizeTitle(title).match(FRAME_TYPE_RE);
  return m ? m[1]!.replace(/\s+/g, " ").trim().toLowerCase() : null;
}

function extractPoolType(title: string): string | null {
  const m = normalizeTitle(title).match(POOL_TYPE_RE);
  return m ? m[1]!.replace(/\s+/g, " ").trim().toLowerCase() : null;
}

function extractBatteryPlatform(title: string): string | null {
  const m = normalizeTitle(title).match(BATTERY_PLATFORM_RE);
  return m ? m[0]!.replace(/\s+/g, " ").trim().toLowerCase() : null;
}

function extractToolType(title: string, norm: NormalizedProduct): string | null {
  const fromStructured = norm.structured.productType;
  if (fromStructured) return fromStructured.toLowerCase();
  const m = normalizeTitle(title).match(TOOL_TYPE_RE);
  return m ? m[1]!.replace(/\s+/g, " ").trim().toLowerCase() : null;
}

function extractKitVsBare(title: string, norm: NormalizedProduct): string | null {
  if (norm.structured.toolBatteryKit === true) return "kit";
  if (norm.structured.toolBatteryKit === false) return "bare";
  const n = normalizeTitle(title);
  if (BARE_TOOL_RE.test(n)) return "bare";
  if (KIT_RE.test(n)) return "kit";
  return null;
}

function extractBrushless(title: string): string | null {
  const m = normalizeTitle(title).match(BRUSHLESS_RE);
  if (!m) return null;
  return m[0]!.includes("brushless") || m[0]!.includes("brush less")
    ? "brushless"
    : "brushed";
}

function extractElectronicsAttributes(
  norm: NormalizedProduct,
  title: string
): ExtractedDepartmentAttributes {
  const snap = buildUniversalMatchSnapshot(norm);
  const st = norm.structured;
  return {
    brand: snap.brand?.toLowerCase() ?? null,
    modelNumber:
      snap.fullModelNorm?.toLowerCase() ??
      snap.modelFamilyNorm?.toLowerCase() ??
      snap.modelTokensNorm[0] ??
      null,
    screenSize:
      snap.diagonalInches != null ? `${snap.diagonalInches}inch` : null,
    storage: extractStorage(title),
    refreshRate: extractRefreshRate(title),
    smartTvPlatform: st.smartTvPlatform?.toLowerCase() ?? norm.tv?.platform?.toLowerCase() ?? null,
    productType: st.productType?.toLowerCase() ?? snap.category,
  };
}

function extractPoolsAttributes(
  norm: NormalizedProduct,
  title: string
): ExtractedDepartmentAttributes {
  const raw = `${title} ${norm.structured.title}`;
  const n = normalizeTitle(raw);
  const shapeM = n.match(POOL_SHAPE_RE);
  const depthM = n.match(POOL_DEPTH_RE);
  const linerM = n.match(LINER_RE);
  return {
    dimensions: extractDimensions(title, norm),
    shape: shapeM ? shapeM[1]!.toLowerCase() : null,
    depth: depthM ? `${depthM[1]}ft` : null,
    capacity: extractCapacity(title, norm),
    frameType: extractFrameType(raw),
    linerCompatibility: linerM ? linerM[1]!.toLowerCase() : null,
    poolType: extractPoolType(raw),
  };
}

function extractToolsAttributes(
  norm: NormalizedProduct,
  title: string
): ExtractedDepartmentAttributes {
  const snap = buildUniversalMatchSnapshot(norm);
  return {
    brand: snap.brand?.toLowerCase() ?? null,
    voltage: snap.toolVoltage?.toLowerCase() ?? null,
    batteryPlatform: extractBatteryPlatform(title),
    toolType: extractToolType(title, norm),
    modelNumber:
      snap.fullModelNorm?.toLowerCase() ??
      snap.modelFamilyNorm?.toLowerCase() ??
      snap.modelTokensNorm[0] ??
      null,
    kitVsBare: extractKitVsBare(title, norm),
    brushlessVsBrushed: extractBrushless(title),
  };
}

/** Extract department-specific attributes from a normalized product + title. */
export function extractDepartmentAttributes(
  departmentId: CompareFlowDepartment,
  norm: NormalizedProduct,
  title: string
): ExtractedDepartmentAttributes {
  switch (departmentId) {
    case "electronics":
      return extractElectronicsAttributes(norm, title);
    case "pools_outdoor":
      return extractPoolsAttributes(norm, title);
    case "tools":
      return extractToolsAttributes(norm, title);
  }
}

/** Log-friendly subset of extracted attributes for a department config. */
export function summarizeExtractedAttributes(
  departmentId: CompareFlowDepartment,
  attrs: ExtractedDepartmentAttributes
): Record<string, string | null> {
  const config = getDepartmentConfig(departmentId);
  const keys = [
    ...config.requiredAttributes,
    ...config.importantAttributes,
  ];
  const unique = [...new Set(keys)];
  const out: Record<string, string | null> = {};
  for (const key of unique) {
    out[key] = attrs[key] ?? null;
  }
  return out;
}

export function attributeKeyLabel(key: DepartmentAttributeKey): string {
  const labels: Record<DepartmentAttributeKey, string> = {
    brand: "brand",
    modelNumber: "model number",
    screenSize: "screen size",
    storage: "storage",
    refreshRate: "refresh rate",
    smartTvPlatform: "smart TV platform",
    productType: "product type",
    dimensions: "dimensions",
    shape: "shape",
    depth: "depth",
    capacity: "capacity",
    frameType: "frame type",
    linerCompatibility: "liner compatibility",
    poolType: "pool type",
    voltage: "voltage",
    batteryPlatform: "battery platform",
    toolType: "tool type",
    kitVsBare: "kit vs bare tool",
    brushlessVsBrushed: "motor type",
  };
  return labels[key];
}

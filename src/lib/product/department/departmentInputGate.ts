import {
  COMPARE_FLOW_DEPARTMENTS,
  type CompareFlowDepartment,
} from "../compareFlowDepartment";
import { isDepartmentHardGatesV2 } from "../matching/gates/env";
import { normalizeTitle } from "../normalize";
import type { NormalizedProduct, ProductCategory } from "../types";

/** Detected department for pasted source input (includes non-flow apparel). */
export type DetectedInputDepartment = CompareFlowDepartment | "apparel";

export type DepartmentInputGateResult =
  | { ok: true; detectedDepartment: DetectedInputDepartment | null }
  | {
      ok: false;
      selectedDepartment: CompareFlowDepartment;
      detectedDepartment: DetectedInputDepartment;
      sourceTitle: string;
      message: string;
    };

const ELECTRONICS_CATEGORIES = new Set<ProductCategory>(["tv", "monitor", "audio"]);

const POOL_TITLE_RE =
  /\b(swimming\s+pool|above[\s-]+ground\s+pool|in[\s-]?ground\s+pool|pool\s+(pump|liner|cover|filter|skimmer|ladder)|pool\s+set|pool\s+kit|pool\s+with\s+pump)\b/i;

const TOOLS_TITLE_RE =
  /\b(drill|driver|impact\s+driver|saw|grinder|sander|nailer|compressor|multitool|bare\s+tool|tool\s+only|power\s+tool)\b/i;

const ELECTRONICS_TITLE_RE =
  /\b(smart\s+tv|television|\btv\b|monitor|laptop|tablet|phone|smartphone|headphone|earbud|airpods|speaker|soundbar|subwoofer|camera|gpu|processor|ssd|console|oled|qled|uhd)\b/i;

const APPAREL_TITLE_RE =
  /\b(shirt|tee|t-shirt|hoodie|sweatshirt|jacket|coat|pants|jeans|shorts|dress|skirt|underwear|bra|legging)\b/i;

const FOOTWEAR_TITLE_RE =
  /\b(shoe|sneaker|boot|sandal|cleat|loafer|slip-on)\b/i;

const SOCKS_TITLE_RE = /\b(sock|socks|crew sock|ankle sock)\b/i;

function isPoolCategory(category: ProductCategory): boolean {
  return (
    category === "pool" ||
    category === "outdoor_pool" ||
    category === "swimming_pool"
  );
}

function departmentDisplayLabel(
  id: DetectedInputDepartment | CompareFlowDepartment
): string {
  if (id === "apparel") return "Apparel";
  const opt = COMPARE_FLOW_DEPARTMENTS.find((d) => d.id === id);
  return opt?.label ?? id;
}

/**
 * Infer which compare-flow department the source product belongs to from category + title.
 * Returns null when ambiguous (no hard gate).
 */
export function detectInputDepartmentFromSource(
  normalized: NormalizedProduct,
  sourceTitle: string,
  supplementalDescription?: string | null
): DetectedInputDepartment | null {
  const category = normalized.category;
  const titleBlob = normalizeTitle(
    `${sourceTitle} ${normalized.structured.title} ${supplementalDescription ?? ""}`
  );

  if (
    category === "apparel" ||
    category === "footwear" ||
    category === "socks" ||
    APPAREL_TITLE_RE.test(titleBlob) ||
    FOOTWEAR_TITLE_RE.test(titleBlob) ||
    SOCKS_TITLE_RE.test(titleBlob)
  ) {
    return "apparel";
  }

  if (isPoolCategory(category) || POOL_TITLE_RE.test(titleBlob)) {
    return "pools_outdoor";
  }

  if (category === "tools" || TOOLS_TITLE_RE.test(titleBlob)) {
    return "tools";
  }

  if (ELECTRONICS_CATEGORIES.has(category) || ELECTRONICS_TITLE_RE.test(titleBlob)) {
    return "electronics";
  }

  return null;
}

export function buildDepartmentInputMismatchMessage(
  selectedDepartment: CompareFlowDepartment,
  detectedDepartment: DetectedInputDepartment
): string {
  const detectedLabel = departmentDisplayLabel(detectedDepartment);
  const selectedLabel = departmentDisplayLabel(selectedDepartment);
  return `This product appears to belong to ${detectedLabel}. Please switch to ${detectedLabel} or paste a product from ${selectedLabel}.`;
}

function isDepartmentMismatch(
  selected: CompareFlowDepartment,
  detected: DetectedInputDepartment
): boolean {
  if (detected === "apparel") return true;
  return detected !== selected;
}

/**
 * When DEPARTMENT_HARD_GATES_V2=true, block compare/search when pasted source
 * product category does not match the user-selected department.
 */
export function validateDepartmentInputGate(
  selectedDepartment: CompareFlowDepartment,
  normalized: NormalizedProduct,
  sourceTitle: string,
  supplementalDescription?: string | null
): DepartmentInputGateResult {
  if (!isDepartmentHardGatesV2()) {
    return { ok: true, detectedDepartment: null };
  }

  const detectedDepartment = detectInputDepartmentFromSource(
    normalized,
    sourceTitle,
    supplementalDescription
  );
  if (detectedDepartment == null) {
    return { ok: true, detectedDepartment: null };
  }

  if (!isDepartmentMismatch(selectedDepartment, detectedDepartment)) {
    return { ok: true, detectedDepartment };
  }

  const trimmedTitle = sourceTitle.trim();
  const message = buildDepartmentInputMismatchMessage(
    selectedDepartment,
    detectedDepartment
  );

  console.log(
    "[DEPARTMENT_INPUT_MISMATCH]",
    JSON.stringify({
      selectedDepartment,
      detectedDepartment,
      sourceTitle: trimmedTitle.slice(0, 200),
      action: "blocked_before_search",
    })
  );

  return {
    ok: false,
    selectedDepartment,
    detectedDepartment,
    sourceTitle: trimmedTitle,
    message,
  };
}

/**
 * Always-on guard: blocks compare before any provider/search call when detected
 * source department conflicts with user-selected department.
 */
export function validateDepartmentPreSearchGuard(
  selectedDepartment: CompareFlowDepartment,
  normalized: NormalizedProduct,
  sourceTitle: string,
  supplementalDescription?: string | null
): DepartmentInputGateResult {
  const detectedDepartment = detectInputDepartmentFromSource(
    normalized,
    sourceTitle,
    supplementalDescription
  );
  const trimmedTitle = sourceTitle.trim();
  const summary = {
    selectedDepartment,
    detectedDepartment,
    sourceTitle: trimmedTitle.slice(0, 200),
    hasSupplementalDescription: Boolean(
      supplementalDescription && supplementalDescription.trim().length > 0
    ),
  };

  console.log("[DEPARTMENT_GUARD_CHECK]", JSON.stringify(summary));

  if (detectedDepartment == null || !isDepartmentMismatch(selectedDepartment, detectedDepartment)) {
    console.log("[DEPARTMENT_GUARD_ALLOWED]", JSON.stringify(summary));
    return { ok: true, detectedDepartment };
  }

  const message = buildDepartmentInputMismatchMessage(
    selectedDepartment,
    detectedDepartment
  );

  console.log(
    "[DEPARTMENT_GUARD_BLOCKED]",
    JSON.stringify({
      ...summary,
      action: "blocked_before_search",
      message,
    })
  );

  return {
    ok: false,
    selectedDepartment,
    detectedDepartment,
    sourceTitle: trimmedTitle,
    message,
  };
}

import type { DepartmentAttributeKey, DepartmentConfig, ExtractedDepartmentAttributes } from "./types";

/** Required fields absent on reference, or present on reference but missing on candidate. */
export function listMissingCriticalAttributes(
  config: DepartmentConfig,
  sourceAttrs: ExtractedDepartmentAttributes,
  candidateAttrs: ExtractedDepartmentAttributes
): DepartmentAttributeKey[] {
  const missing: DepartmentAttributeKey[] = [];
  for (const key of config.requiredAttributes) {
    const sourceVal = sourceAttrs[key]?.trim();
    const candidateVal = candidateAttrs[key]?.trim();
    if (!sourceVal) {
      missing.push(key);
      continue;
    }
    if (!candidateVal) {
      missing.push(key);
    }
  }
  return missing;
}

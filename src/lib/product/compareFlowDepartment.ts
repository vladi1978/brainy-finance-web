import type { ProductDepartment } from "./types";

/** User-selected department in the compare flow (before product input). */
export type CompareFlowDepartment = "electronics" | "pools_outdoor" | "tools";

export type CompareFlowDepartmentOption = {
  id: CompareFlowDepartment;
  label: string;
  headline: string;
  description: string;
  examples: string[];
  /** Maps to pipeline `ProductDepartment` for department-specific matching. */
  productDepartment: ProductDepartment;
};

export const COMPARE_FLOW_DEPARTMENTS: CompareFlowDepartmentOption[] = [
  {
    id: "electronics",
    label: "Electronics",
    headline: "Model-specific tech products",
    description:
      "Best for items where screen size, model number, or exact specs matter when comparing across stores.",
    examples: ["TVs & monitors", "Headphones & speakers", "Laptops & tablets"],
    productDepartment: "screen",
  },
  {
    id: "pools_outdoor",
    label: "Pools & Outdoor",
    headline: "Sized outdoor & pool gear",
    description:
      "Best for pool liners, covers, pumps, and outdoor equipment where dimensions and capacity must match.",
    examples: ["Pool liners & covers", "Pumps & filters", "Outdoor furniture"],
    productDepartment: "pool",
  },
  {
    id: "tools",
    label: "Tools",
    headline: "Power tools & equipment",
    description:
      "Best for drills, saws, and kits where voltage, battery platform, and model numbers drive a safe match.",
    examples: ["Cordless drills", "Tool kits & combos", "Outdoor power equipment"],
    productDepartment: "tools",
  },
];

export function isValidCompareFlowDepartment(
  value: unknown
): value is CompareFlowDepartment {
  return (
    value === "electronics" ||
    value === "pools_outdoor" ||
    value === "tools"
  );
}

export function parseCompareFlowDepartment(
  value: unknown
): CompareFlowDepartment | null {
  return isValidCompareFlowDepartment(value) ? value : null;
}

export function compareFlowDepartmentToProductDepartment(
  department: CompareFlowDepartment
): ProductDepartment {
  const match = COMPARE_FLOW_DEPARTMENTS.find((d) => d.id === department);
  return match?.productDepartment ?? "generic";
}

import type { HouseholdPlanType } from "../types";

const LABELS: Record<HouseholdPlanType, string> = {
  free: "Free",
  pro: "Pro",
  premium: "Premium",
  household_pro: "Household Pro",
};

export function planTypeLabel(plan: HouseholdPlanType): string {
  return LABELS[plan];
}

/**
 * Server-controlled insurance partner allowlist foundation.
 * All partners ship inactive until approved. No live affiliate URLs.
 *
 * Fail-closed: referrals require BOTH
 *   INSURANCE_REFERRALS_ENABLED=true
 *   and at least one partner with active=true and a non-empty urlTemplate.
 * Enabling the flag alone never exposes a CTA.
 */

import type { InsuranceProductType } from "../statements/insuranceClassify";

export type InsuranceCompensationModel =
  | "ppc"
  | "ppl"
  | "ppq"
  | "pay_per_call"
  | "pay_per_policy"
  | "none";

export type InsurancePartner = {
  id: string;
  displayName: string;
  /** Approved destination hosts only (no user-supplied URLs). */
  allowedHosts: readonly string[];
  /**
   * Affiliate URL template. Must remain null while inactive.
   * Placeholders like {ref} may be added later — never statement/PII fields.
   */
  urlTemplate: string | null;
  products: readonly InsuranceProductType[];
  /** US state codes, or ["*"] when nationally eligible (confirm per contract). */
  eligibleStates: readonly string[];
  compensationModel: InsuranceCompensationModel;
  disclosureVersion: string;
  /** Hard gate — inactive partners must never redirect. */
  active: boolean;
  /** Consumer-relevance order only — never commission amount. */
  relevancePriority: number;
};

/**
 * Placeholder registry. Empty active set by design for Foundation Step 1.
 * Do not activate partners or add real affiliate URLs in this step.
 */
export const INSURANCE_PARTNER_REGISTRY: readonly InsurancePartner[] = [
  {
    id: "example-inactive",
    displayName: "Example Insurance Marketplace (inactive)",
    allowedHosts: [],
    urlTemplate: null,
    products: ["auto", "home", "renters", "unknown"],
    eligibleStates: ["KY"],
    compensationModel: "none",
    disclosureVersion: "2026-08-23.v1",
    active: false,
    relevancePriority: 100,
  },
];

/** Feature flag — defaults false / unset. Never sufficient alone. */
export function isInsuranceReferralsFlagEnabled(): boolean {
  const flag = process.env.INSURANCE_REFERRALS_ENABLED?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function listInsurancePartners(): readonly InsurancePartner[] {
  return INSURANCE_PARTNER_REGISTRY;
}

export function getInsurancePartnerById(
  id: string
): InsurancePartner | undefined {
  return INSURANCE_PARTNER_REGISTRY.find((p) => p.id === id);
}

/** Partners that may power a future referral CTA. */
export function getActiveInsurancePartners(): InsurancePartner[] {
  return INSURANCE_PARTNER_REGISTRY.filter(
    (p) =>
      p.active === true &&
      typeof p.urlTemplate === "string" &&
      p.urlTemplate.length > 0 &&
      p.allowedHosts.length > 0
  );
}

/**
 * True only when the env flag is on AND a valid active partner exists.
 * Fail closed in all other cases.
 */
export function insuranceReferralsEnabled(): boolean {
  if (!isInsuranceReferralsFlagEnabled()) return false;
  return getActiveInsurancePartners().length > 0;
}

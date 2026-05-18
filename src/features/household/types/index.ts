export type HouseholdRole = "owner" | "member" | "viewer";

export type HouseholdPlanType =
  | "free"
  | "pro"
  | "premium"
  | "household_pro";

export type HouseholdPermission =
  | "view_household_insights"
  | "manage_members"
  | "manage_billing"
  | "invite_members";

export type HouseholdMember = {
  id: string;
  displayName: string;
  email: string;
  role: HouseholdRole;
  joinedAt: string;
  /** Initial for avatar placeholder — no PII beyond what the member chooses to share. */
  avatarInitial: string;
};

export type HouseholdSharedInsight = {
  id: string;
  title: string;
  description: string;
  /** Household-level opportunity only — not tied to any individual’s statements. */
  estimatedMonthlySavingCents: number;
  category: string;
  updatedAt: string;
};

export type HouseholdPlanLimits = {
  maxMembers: number;
  maxSharedInsightsTracked: number;
  /** Whether household-level insight sharing is enabled for this plan tier. */
  sharedInsightsEnabled: boolean;
};

export type Household = {
  id: string;
  name: string;
  planType: HouseholdPlanType;
  members: HouseholdMember[];
  sharedInsights: HouseholdSharedInsight[];
  /** Aggregated household-level estimate from shared insights — not anyone’s private spend. */
  potentialMonthlySavingsCents: number;
  planLimits: HouseholdPlanLimits;
  createdAt: string;
};

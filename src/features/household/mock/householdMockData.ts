import type { Household } from "../types";

/**
 * Phase 1 static seed: 1 owner, 2 members, 3 shared insights, plan limits.
 * Replaced by API / persistence in Phase 2.
 */
export const MOCK_HOUSEHOLD: Household = {
  id: "hh_mock_brainy_01",
  name: "Patel household",
  planType: "household_pro",
  createdAt: "2025-11-02T12:00:00.000Z",
  potentialMonthlySavingsCents: 18750, // $187.50
  planLimits: {
    maxMembers: 6,
    maxSharedInsightsTracked: 25,
    sharedInsightsEnabled: true,
  },
  members: [
    {
      id: "m_owner_01",
      displayName: "Alex Patel",
      email: "alex.patel@example.com",
      role: "owner",
      joinedAt: "2025-11-02T12:00:00.000Z",
      avatarInitial: "A",
    },
    {
      id: "m_member_02",
      displayName: "Jordan Lee",
      email: "jordan.lee@example.com",
      role: "member",
      joinedAt: "2025-11-10T09:15:00.000Z",
      avatarInitial: "J",
    },
    {
      id: "m_member_03",
      displayName: "Sam Rivera",
      email: "sam.rivera@example.com",
      role: "member",
      joinedAt: "2025-12-01T16:40:00.000Z",
      avatarInitial: "S",
    },
  ],
  sharedInsights: [
    {
      id: "ins_01",
      title: "Bundle home internet + mobile",
      description:
        "Household-level note: many carriers discount when lines and broadband are combined. Compare against your current posted rates (each member reviews their own bill privately).",
      estimatedMonthlySavingCents: 4200,
      category: "Utilities & connectivity",
      updatedAt: "2026-05-10T10:00:00.000Z",
    },
    {
      id: "ins_02",
      title: "Review recurring software seats",
      description:
        "Shared workspace tools often have overlapping seats across family businesses. Audit seat counts on your own accounts — Brainy only surfaces the opportunity, not individual charges.",
      estimatedMonthlySavingCents: 6500,
      category: "Software",
      updatedAt: "2026-05-08T14:30:00.000Z",
    },
    {
      id: "ins_03",
      title: "Cashback card alignment",
      description:
        "Align category bonuses with where the household already spends (groceries, gas). Each person opts in to their own card strategy; nothing is shared at the transaction level.",
      estimatedMonthlySavingCents: 8050,
      category: "Rewards",
      updatedAt: "2026-05-05T11:20:00.000Z",
    },
  ],
};

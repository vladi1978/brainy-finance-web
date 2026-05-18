import type { RecommendationActionType } from "../recommendations/types";
import type { FinancialActionDefinition } from "./types";

const DEFAULT_ACTIONS: FinancialActionDefinition[] = [
  {
    id: "accept_savings",
    label: "Accept savings",
    kind: "primary",
    resolvesTo: "accepted",
  },
  {
    id: "track",
    label: "Track this",
    kind: "secondary",
    resolvesTo: "tracked",
  },
  {
    id: "dismiss",
    label: "Dismiss",
    kind: "ghost",
    resolvesTo: "dismissed",
  },
];

const REGISTRY: Partial<
  Record<RecommendationActionType, FinancialActionDefinition[]>
> = {
  reduce_streaming: [
    {
      id: "compare_plans",
      label: "Compare plans",
      kind: "primary",
      opensModal: "provider_compare",
    },
    {
      id: "keep",
      label: "Keep",
      kind: "secondary",
      resolvesTo: "accepted",
    },
    {
      id: "dismiss",
      label: "Dismiss",
      kind: "ghost",
      resolvesTo: "dismissed",
    },
  ],
  compare_telecom: [
    {
      id: "find_alternatives",
      label: "Find alternatives",
      kind: "primary",
      opensModal: "provider_compare",
    },
    {
      id: "compare_providers",
      label: "Compare providers",
      kind: "secondary",
      opensModal: "provider_compare",
    },
    {
      id: "keep_plan",
      label: "Keep current plan",
      kind: "ghost",
      resolvesTo: "accepted",
    },
  ],
  setup_balance_alerts: [
    {
      id: "learn_fees",
      label: "Learn how to avoid fees",
      kind: "primary",
      opensModal: "fee_education",
    },
    {
      id: "track",
      label: "Track this",
      kind: "secondary",
      resolvesTo: "tracked",
    },
    {
      id: "dismiss",
      label: "Dismiss",
      kind: "ghost",
      resolvesTo: "dismissed",
    },
  ],
  switch_banking: [
    {
      id: "learn_fees",
      label: "Learn how to avoid fees",
      kind: "primary",
      opensModal: "fee_education",
    },
    {
      id: "track",
      label: "Track this",
      kind: "secondary",
      resolvesTo: "tracked",
    },
    {
      id: "dismiss",
      label: "Dismiss",
      kind: "ghost",
      resolvesTo: "dismissed",
    },
  ],
  review_recurring: [
    {
      id: "review_merchant",
      label: "Review merchant",
      kind: "primary",
      resolvesTo: "tracked",
    },
    {
      id: "mark_essential",
      label: "Mark essential",
      kind: "secondary",
      resolvesTo: "essential",
    },
    {
      id: "ignore",
      label: "Ignore",
      kind: "ghost",
      resolvesTo: "dismissed",
    },
  ],
  review_merchant_group: [
    {
      id: "review_merchant",
      label: "Review merchant",
      kind: "primary",
      resolvesTo: "tracked",
    },
    {
      id: "mark_essential",
      label: "Mark essential",
      kind: "secondary",
      resolvesTo: "essential",
    },
    {
      id: "ignore",
      label: "Ignore",
      kind: "ghost",
      resolvesTo: "dismissed",
    },
  ],
  review_subscription: [
    {
      id: "review_merchant",
      label: "Review subscription",
      kind: "primary",
      resolvesTo: "tracked",
    },
    {
      id: "mark_essential",
      label: "Mark essential",
      kind: "secondary",
      resolvesTo: "essential",
    },
    {
      id: "ignore",
      label: "Ignore",
      kind: "ghost",
      resolvesTo: "dismissed",
    },
  ],
};

export function getActionsForType(
  actionType: RecommendationActionType
): FinancialActionDefinition[] {
  return REGISTRY[actionType] ?? DEFAULT_ACTIONS;
}

export function getActionDefinition(
  actionType: RecommendationActionType,
  actionId: FinancialActionDefinition["id"]
): FinancialActionDefinition | undefined {
  return getActionsForType(actionType).find((a) => a.id === actionId);
}

import type { RecommendationActionType } from "../recommendations/types";
import type { FinancialActionDefinition } from "./types";

const DEFAULT_ACTIONS: FinancialActionDefinition[] = [
  {
    id: "accept_savings",
    label: "Add to my plan",
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
      resolvesTo: "essential",
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
      resolvesTo: "essential",
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

const COMPLETE_ACTION: FinancialActionDefinition = {
  id: "mark_completed",
  label: "Mark completed",
  kind: "primary",
  resolvesTo: "completed",
};

export function getActionsForType(
  actionType: RecommendationActionType
): FinancialActionDefinition[] {
  return REGISTRY[actionType] ?? DEFAULT_ACTIONS;
}

export function getActionsForStatus(
  actionType: RecommendationActionType,
  status: string
): FinancialActionDefinition[] {
  if (status === "accepted" || status === "tracked") {
    return [
      COMPLETE_ACTION,
      ...getActionsForType(actionType).filter((action) => action.id === "dismiss"),
    ];
  }
  if (status === "completed") return [];
  return getActionsForType(actionType);
}

export function getActionDefinition(
  actionType: RecommendationActionType,
  actionId: FinancialActionDefinition["id"]
): FinancialActionDefinition | undefined {
  if (actionId === COMPLETE_ACTION.id) return COMPLETE_ACTION;
  return getActionsForType(actionType).find((a) => a.id === actionId);
}

export type BrainyGoal =
  | "save_this_month"
  | "understand_spending"
  | "review_subscriptions"
  | "review_bill"
  | "find_better_price";

export type GuidedPlaybook = {
  id: BrainyGoal;
  label: string;
  response: string;
  href?: string;
  actionLabel?: string;
  available: boolean;
};

export const GUIDED_PLAYBOOKS: GuidedPlaybook[] = [
  {
    id: "save_this_month",
    label: "Help me save this month",
    response:
      "Upload a text-based bank statement. Brainy will look for fees, confirmed subscriptions, repeated discretionary activity, and bills worth reviewing. You choose what to change.",
    available: true,
  },
  {
    id: "understand_spending",
    label: "Help me understand my spending",
    response:
      "Upload your statement and Brainy will organize detected activity into expected bills, subscriptions, repeated spending, fees, and items to review—without telling you what you are allowed to buy.",
    available: true,
  },
  {
    id: "review_subscriptions",
    label: "Review my subscriptions",
    response:
      "Upload a statement and Brainy will separate confirmed recurring evidence from possible subscriptions. One charge alone is not treated as confirmed recurrence.",
    available: true,
  },
  {
    id: "review_bill",
    label: "Explain a phone or utility bill",
    response:
      "Detailed bill review is being prepared. Today, this uploader analyzes bank-statement PDFs only; it does not yet verify line items from phone, internet, gas, or electric bills.",
    available: false,
  },
  {
    id: "find_better_price",
    label: "Find a better product price",
    response:
      "Use Brainy Compare or the Shopping Assistant to find compatible listings across stores. Brainy shows evidence and price differences; you decide what to buy.",
    href: "/shopping-assistant",
    actionLabel: "Open Shopping Assistant",
    available: true,
  },
];

export function getGuidedPlaybook(goal: BrainyGoal): GuidedPlaybook {
  const playbook = GUIDED_PLAYBOOKS.find((item) => item.id === goal);
  if (!playbook) throw new Error(`Unknown Brainy goal: ${goal}`);
  return playbook;
}

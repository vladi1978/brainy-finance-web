import { MOCK_HOUSEHOLD } from "../mock/householdMockData";
import type {
  Household,
  HouseholdMember,
  HouseholdRole,
  HouseholdSharedInsight,
} from "../types";

function cloneHousehold(h: Household): Household {
  return structuredClone(h);
}

/**
 * On the server, always return the static mock (read-only semantics).
 * In the browser, optional mutable copy for Phase 1 UI demos — isolated per tab, not persisted.
 */
let browserHousehold: Household | null = null;

function resolveStore(): Household {
  if (typeof window === "undefined") {
    return cloneHousehold(MOCK_HOUSEHOLD);
  }
  if (!browserHousehold) {
    browserHousehold = cloneHousehold(MOCK_HOUSEHOLD);
  }
  return browserHousehold;
}

function persistStore(next: Household): void {
  if (typeof window === "undefined") return;
  browserHousehold = next;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getCurrentHousehold(): Promise<Household> {
  await delay(0);
  return cloneHousehold(resolveStore());
}

export async function getHouseholdMembers(): Promise<HouseholdMember[]> {
  const h = await getCurrentHousehold();
  return h.members;
}

export async function getHouseholdSharedInsights(): Promise<
  HouseholdSharedInsight[]
> {
  const h = await getCurrentHousehold();
  return h.sharedInsights;
}

export async function createHousehold(name: string): Promise<Household> {
  await delay(0);
  const base = cloneHousehold(MOCK_HOUSEHOLD);
  const next: Household = {
    ...base,
    id: `hh_${crypto.randomUUID?.() ?? String(Date.now())}`,
    name: name.trim() || "My household",
    createdAt: new Date().toISOString(),
    members: base.members.slice(0, 1),
    sharedInsights: [],
    potentialMonthlySavingsCents: 0,
  };
  persistStore(next);
  return cloneHousehold(next);
}

export async function addHouseholdMember(input: {
  displayName: string;
  email: string;
  role: Exclude<HouseholdRole, "owner">;
}): Promise<Household> {
  await delay(0);
  const current = resolveStore();
  if (current.members.length >= current.planLimits.maxMembers) {
    throw new Error("Household member limit reached for this plan.");
  }
  const id = `m_${crypto.randomUUID?.() ?? String(Date.now())}`;
  const initial = input.displayName.trim().slice(0, 1).toUpperCase() || "?";
  const member: HouseholdMember = {
    id,
    displayName: input.displayName.trim(),
    email: input.email.trim(),
    role: input.role,
    joinedAt: new Date().toISOString(),
    avatarInitial: initial,
  };
  const next: Household = {
    ...current,
    members: [...current.members, member],
  };
  persistStore(next);
  return cloneHousehold(next);
}

export async function removeHouseholdMember(memberId: string): Promise<Household> {
  await delay(0);
  const current = resolveStore();
  const target = current.members.find((m) => m.id === memberId);
  if (target?.role === "owner") {
    throw new Error("Cannot remove the household owner.");
  }
  const next: Household = {
    ...current,
    members: current.members.filter((m) => m.id !== memberId),
  };
  persistStore(next);
  return cloneHousehold(next);
}

/** Test / reset helper — browser only. */
export function resetHouseholdMockForTests(): void {
  if (typeof window === "undefined") return;
  browserHousehold = null;
}

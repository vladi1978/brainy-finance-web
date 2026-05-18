import type { HouseholdPermission, HouseholdRole } from "../types";

const ROLE_PERMISSIONS: Record<HouseholdRole, HouseholdPermission[]> = {
  owner: [
    "view_household_insights",
    "manage_members",
    "manage_billing",
    "invite_members",
  ],
  member: ["view_household_insights", "invite_members"],
  viewer: ["view_household_insights"],
};

export function permissionsForRole(role: HouseholdRole): HouseholdPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function roleHasPermission(
  role: HouseholdRole,
  permission: HouseholdPermission
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

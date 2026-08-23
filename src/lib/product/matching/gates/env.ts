/** Phase 2 department hard gates — opt-in via env. Default off preserves Phase 1 behavior. */
export function isDepartmentHardGatesV2(): boolean {
  return process.env.DEPARTMENT_HARD_GATES_V2 === "true";
}

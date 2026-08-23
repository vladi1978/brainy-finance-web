import type { DeptHardRejectLogPayload } from "./types";

export function logDeptHardReject(payload: DeptHardRejectLogPayload): void {
  console.log("[DEPT_HARD_REJECT]", JSON.stringify(payload));
}

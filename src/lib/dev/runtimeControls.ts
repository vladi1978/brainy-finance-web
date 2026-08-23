function parseTriStateEnv(
  value: string | undefined,
  defaultWhenUnset: boolean
): boolean {
  if (value == null || value.trim() === "") return defaultWhenUnset;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return defaultWhenUnset;
}

/**
 * When true, cron routes, price-alert sweeps, and client-side alert polling should no-op.
 * Defaults to on in development so compare calibration is not competing with background work.
 * Set `DISABLE_DEV_BACKGROUND_TASKS=false` to re-enable.
 */
export function isDevBackgroundTasksDisabled(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return parseTriStateEnv(process.env.DISABLE_DEV_BACKGROUND_TASKS, true);
}

/** Client bundle mirror of {@link isDevBackgroundTasksDisabled}. */
export function isClientDevBackgroundTasksDisabled(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return parseTriStateEnv(
    process.env.NEXT_PUBLIC_DISABLE_DEV_BACKGROUND_TASKS,
    true
  );
}

export const DEV_BACKGROUND_TASKS_DISABLED_REASON =
  "dev_background_tasks_disabled";

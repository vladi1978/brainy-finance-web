const PREFIX = "[brainy:compare]";

/** `debug: true` on the API body, or `COMPARISON_DEBUG=1` in the environment. */
export function isVerboseCompareEnabled(explicitDebug?: boolean): boolean {
  if (explicitDebug) return true;
  return process.env.COMPARISON_DEBUG === "1";
}

export function compareLogInfo(message: string, data?: Record<string, unknown>) {
  if (data) {
    console.info(PREFIX, message, data);
  } else {
    console.info(PREFIX, message);
  }
}

export function compareLogVerbose(
  enabled: boolean,
  message: string,
  data?: Record<string, unknown>
) {
  if (!enabled) return;
  compareLogInfo(message, data);
}

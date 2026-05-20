/**
 * Phase 1 outbound redirect gateway — builds internal `/redirect` URLs so every
 * visible retailer click can later be wrapped with affiliate programs without
 * changing compare UI call sites again.
 */

export { isOutboundRedirectTargetValid } from "./outboundUrlValidation";

export type BuildBrainyRedirectUrlInput = {
  targetUrl: string;
  store: string;
  title?: string | null;
  source?: string | null;
};

/**
 * Internal hop URL consumed by `/redirect`. Always use this for visible
 * retailer buttons instead of raw `https://…` targets.
 */
export function buildBrainyRedirectUrl(input: BuildBrainyRedirectUrlInput): string {
  const targetUrl = input.targetUrl.replace(/\s+/g, " ").trim();
  const store = input.store.replace(/\s+/g, " ").trim();
  const q = new URLSearchParams();
  q.set("target", targetUrl);
  q.set("store", store);
  const title = input.title?.replace(/\s+/g, " ").trim();
  if (title) q.set("title", title);
  const source = input.source?.replace(/\s+/g, " ").trim();
  if (source) q.set("source", source);
  return `/redirect?${q.toString()}`;
}

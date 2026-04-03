import { STORE_DOMAINS } from "./stores";
import { SupportedStore } from "./types";

export function detectStore(input: string): SupportedStore {
  const value = input.toLowerCase();

  for (const [store, domains] of Object.entries(STORE_DOMAINS)) {
    for (const domain of domains) {
      if (value.includes(domain)) {
        return store as SupportedStore;
      }
    }
  }

  if (value.includes("amazon")) return "amazon";
  if (value.includes("walmart")) return "walmart";
  if (value.includes("target")) return "target";
  if (value.includes("temu")) return "temu";

  return "unknown";
}
/**
 * TEMPORARY audit runner — AquaDoc pool compare with outbound URL logs.
 * Usage: node scripts/audit-aquadoc-compare.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");

function loadEnvFile(name) {
  const p = resolve(root, name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");
process.env.DEBUG_COMPARE = "true";

const { compareProduct } = await import("../src/lib/product/compareEngine.ts");

const result = await compareProduct("", {
  pricePaid: "24.99",
  manualProduct: {
    brand: "AquaDoc",
    productNameOrModel: "Pool Clarifier and Flocculant",
    category: "pool",
    sizeDimensionsCapacity: "32 oz",
    keyFeatures: "clears cloudy pool water fast",
    pricePaid: "24.99",
  },
});

const rows = [
  ...(result.candidates ?? []),
  ...(result.similarButNotCheaper ?? []),
];

console.log("\n=== AUDIT SUMMARY (displayed candidates) ===\n");
for (const c of rows.slice(0, 20)) {
  console.log({
    store: c.store,
    storeLabel: c.storeLabel,
    title: c.title?.slice(0, 90),
    urlType: c.urlType,
    urlResolutionReason: c.urlResolutionReason,
    productUrl: c.productUrl?.slice(0, 200),
    outboundUrl: c.outboundUrl?.slice(0, 200),
  });
}

console.log("\nCounts:", {
  candidates: result.candidates?.length ?? 0,
  similarButNotCheaper: result.similarButNotCheaper?.length ?? 0,
});

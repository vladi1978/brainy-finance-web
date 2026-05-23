import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.local", ".env"]) {
  const p = resolve(root, name);
  if (!existsSync(p)) continue;
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

const apiKey = process.env.SERPER_API_KEY?.trim();
const endpoint =
  process.env.PRODUCT_SERPER_SHOPPING_URL?.trim() ??
  "https://google.serper.dev/shopping";
const res = await fetch(endpoint, {
  method: "POST",
  headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({ q: "AquaDoc Pool Clarifier 32 oz", gl: "us", hl: "en" }),
});
const payload = await res.json();
const items = payload.shopping ?? payload.shoppingResults ?? [];
console.log("status", res.status, "items", items.length);
const first = items[0];
if (!first) process.exit(0);
console.log("first_keys", Object.keys(first));
for (const k of [
  "link",
  "product_link",
  "merchant_link",
  "productUrl",
  "merchantUrl",
  "source",
  "title",
]) {
  const v = first[k];
  if (typeof v === "string") console.log(k, v.slice(0, 280));
}
if (Array.isArray(first.shoppingResults) && first.shoppingResults[0]) {
  const n = first.shoppingResults[0];
  console.log("nested0_keys", Object.keys(n));
  if (typeof n.link === "string") console.log("nested0.link", n.link.slice(0, 280));
}
// Count link host patterns
let google = 0,
  retailer = 0,
  other = 0;
for (const it of items.slice(0, 40)) {
  const link = typeof it.link === "string" ? it.link : "";
  if (link.includes("google.com")) google++;
  else if (/walmart|amazon|homedepot|bestbuy|tractorsupply|target/i.test(link))
    retailer++;
  else other++;
}
console.log("link_hosts_sample40", { google, retailer, other });

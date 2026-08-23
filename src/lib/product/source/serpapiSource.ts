/** SerpAPI Google Shopping engine — fallback when Serper is unavailable. */

import type { ShoppingApiJsonOk } from "./serperSource";

function shoppingLog(payload: Record<string, unknown>): void {
  if (process.env.PRODUCT_SHOPPING_DEBUG !== "1") return;
  console.log("[google-shopping]", payload);
}

export async function fetchSerpApiShoppingJson(
  query: string,
): Promise<ShoppingApiJsonOk | null> {
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) return null;

  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google_shopping");
  u.searchParams.set("q", query);
  u.searchParams.set("api_key", apiKey);
  u.searchParams.set("gl", process.env.PRODUCT_SHOPPING_GL?.trim() ?? "us");
  u.searchParams.set("hl", process.env.PRODUCT_SHOPPING_HL?.trim() ?? "en");

  const res = await fetch(u.toString());
  const httpStatus = res.status;
  const text = await res.text();
  shoppingLog({
    provider: "serpapi",
    httpStatus,
    queryPreview: query.slice(0, 120),
    byteLength: text.length,
  });

  if (!res.ok) return null;
  try {
    const payload = JSON.parse(text) as unknown;
    return { payload, rawTextLength: text.length };
  } catch {
    return null;
  }
}

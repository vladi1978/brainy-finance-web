/** Serper Google Shopping API — discovery adapter (no retailer HTML scrape). */

export type ShoppingApiJsonOk = { payload: unknown; rawTextLength: number };

export type ShoppingSourceAdapterId = "serper" | "serpapi";

function shoppingLog(payload: Record<string, unknown>): void {
  if (process.env.PRODUCT_SHOPPING_DEBUG !== "1") return;
  console.log("[google-shopping]", payload);
}

export async function fetchSerperShoppingJson(
  query: string,
): Promise<ShoppingApiJsonOk | null> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return null;

  const endpoint =
    process.env.PRODUCT_SERPER_SHOPPING_URL?.trim() ??
    "https://google.serper.dev/shopping";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: process.env.PRODUCT_SHOPPING_GL?.trim() ?? "us",
      hl: process.env.PRODUCT_SHOPPING_HL?.trim() ?? "en",
    }),
  });

  const httpStatus = res.status;
  const text = await res.text();
  shoppingLog({
    provider: "serper",
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

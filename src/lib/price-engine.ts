/**
 * @deprecated Legacy stub — not used by the app. Live compare uses
 * `compareProduct` from `@/lib/product/engine` (see `src/lib/product/LEGACY.md`).
 * Scheduled for removal in Phase 2; do not import from new code.
 */
// Price Engine - BrainyFinance

export type ProductData = {
    name: string;
    price: number;
    currency: string;
    source: string;
    inputType: "url" | "name" | "description";
  };
  
  function detectInputType(input: string): "url" | "name" | "description" {
    const trimmed = input.trim().toLowerCase();
  
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.includes("amazon.com") ||
      trimmed.includes("walmart.com") ||
      trimmed.includes("target.com")
    ) {
      return "url";
    }
  
    if (trimmed.split(" ").length <= 5) {
      return "name";
    }
  
    return "description";
  }
  
  function cleanProductName(input: string): string {
    return input
      .replace(/https?:\/\/[^\s]+/g, "")
      .replace(/[^\w\s\-.,]/g, "")
      .trim();
  }
  
  // Accepts a link, short name, or longer description.
  export async function extractProductFromURL(input: string): Promise<ProductData> {
    const cleaned = input.trim();
    const inputType = detectInputType(cleaned);
  
    let productName = "Unknown Product";
    let source = "Brainy Search";
    const price = 60;
  
    if (inputType === "url") {
      productName = "Product from URL";
      source = cleaned.includes("amazon")
        ? "Amazon"
        : cleaned.includes("walmart")
        ? "Walmart"
        : cleaned.includes("target")
        ? "Target"
        : "Online Store";
    }
  
    if (inputType === "name") {
      productName = cleaned;
      source = "User Search";
    }
  
    if (inputType === "description") {
      productName = cleanProductName(cleaned);
      source = "AI Description Match";
    }
  
    return {
      name: productName || "Unknown Product",
      price,
      currency: "USD",
      source,
      inputType,
    };
  }
  
  // Placeholder affiliate link for now
  export function generateAffiliateLink(input: string): string {
    const encoded = encodeURIComponent(input.trim());
    return `https://brainyfinance.app/deal?query=${encoded}&ref=brainyfinance`;
  }
  
  /** @deprecated Use `compareProduct` from `@/lib/product/engine`. */
  export async function comparePrices() {
    throw new Error(
      "comparePrices is not implemented; use compareProduct from @/lib/product/engine"
    );
  }
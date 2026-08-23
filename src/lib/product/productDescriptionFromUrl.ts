/**
 * Universal product title/description extraction from a canonical retailer URL.
 * Used when URL slug text is empty (e.g. Amazon /dp/ASIN) or PDP scrape is blocked.
 */
import { fetchAiProductMetadata } from "./aiProductMetadata";
import {
  buildNormalizedProduct,
  detectStoreFromProductUrl,
  extractAmazonAsinFromUrl,
} from "./normalize";
import {
  isProductDetailStoreKey,
  isProductLikeRetailerUrl,
  isStrictProductDetailUrl,
} from "./productDetailUrl";
import { findProductProviderForUrl } from "./registry";
import {
  fetchProductPageTitleSignals,
  scrapeProduct,
  selectPdpTitleFromPageSignals,
  toSourceScrapedHints,
  type ProductPageTitleSignals,
  type ScrapedProduct,
} from "./scrapeProduct";
import { isServerRetailScrapeBlocked } from "./source/serverScrapePolicy";
import type { SourceProduct } from "./types";
import { isAsinPlaceholderTitle, isUsablePdpTitle } from "./usablePdpTitle";
import {
  extractProductQueryFromRetailUrl,
  isGenericRetailProductQuery,
  pathnameSlugShoppingFallback,
} from "./urlProductQuery";

export type InitialProductExtractionResult = {
  sourceProduct: SourceProduct;
  attemptedExtract: boolean;
  priceSource: string | null;
  fallbackReason: string | null;
};

function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function storeLabelFromHostname(host: string): string {
  const bare = host.replace(/^www\./i, "").toLowerCase();
  const label = bare.split(".")[0] ?? bare;
  if (!label) return "Store";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** True when the canonical URL looks like a product detail page on any retailer. */
export function canonicalUrlLooksLikeProductPage(url: string): boolean {
  const trimmed = url.trim();
  if (!isValidHttpUrl(trimmed)) return false;

  const store = detectStoreFromProductUrl(trimmed);
  if (store && isProductDetailStoreKey(store)) {
    return (
      isStrictProductDetailUrl(store, trimmed) ||
      isProductLikeRetailerUrl(store, trimmed)
    );
  }

  if (extractAmazonAsinFromUrl(trimmed)) return true;

  try {
    const u = new URL(trimmed);
    if (/\/(product|products|p|pd|item|items|sku|dp|ip|site)\//i.test(u.pathname)) {
      return true;
    }
    const leaf = u.pathname.split("/").filter(Boolean).pop() ?? "";
    if (/\.html?$/i.test(leaf) && leaf.length >= 8) return true;
    return u.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function pickTitleFromPageSignals(signals: ProductPageTitleSignals): string {
  const selection = selectPdpTitleFromPageSignals(signals);
  const selected = selection.selectedTitle?.replace(/\s+/g, " ").trim() ?? "";
  if (selected && !isGenericRetailProductQuery(selected)) return selected;
  return selected;
}

function pickTitleFromScrape(scraped: ScrapedProduct | null): string {
  if (!scraped) return "";
  const name = scraped.productName?.replace(/\s+/g, " ").trim() ?? "";
  if (name && !isGenericRetailProductQuery(name)) return name;
  const salvage = [scraped.brand, scraped.model, scraped.sku]
    .map((s) => s?.trim() ?? "")
    .filter((s) => s.length >= 2)
    .join(" ")
    .trim();
  if (salvage.length >= 6 && !isGenericRetailProductQuery(salvage)) return salvage;
  return name;
}

function slugTitleFromCanonicalUrl(url: string): string {
  const fromExtract = extractProductQueryFromRetailUrl(url).productQuery
    .replace(/\s+/g, " ")
    .trim();
  if (fromExtract && !isGenericRetailProductQuery(fromExtract)) return fromExtract;
  return pathnameSlugShoppingFallback(url).replace(/\s+/g, " ").trim();
}

export function buildMinimalTitleForCanonicalUrl(url: string): string {
  const slug = slugTitleFromCanonicalUrl(url);
  if (slug && !isGenericRetailProductQuery(slug)) return slug;

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  const store = storeLabelFromHostname(host || "store");
  return `Product from ${store}`;
}

function buildSourceProduct(
  canonicalProductUrl: string,
  title: string,
  scraped: ScrapedProduct | null,
  userPrice: number | null
): SourceProduct {
  const store = detectStoreFromProductUrl(canonicalProductUrl) ?? "unknown";
  const price =
    userPrice ??
    scraped?.price ??
    null;
  const currency = scraped?.currency ?? "USD";

  return {
    sourceUrl: canonicalProductUrl,
    store,
    title: title.replace(/\s+/g, " ").trim(),
    originalPrice: price,
    currency,
    imageUrl: scraped?.imageUrl ?? null,
    normalized: buildNormalizedProduct(title, {
      price,
      currency,
      productUrl: canonicalProductUrl,
    }),
    scrapedHints: toSourceScrapedHints(scraped) ?? null,
  };
}

function logDescriptionScrapeResult(
  success: boolean,
  source: SourceProduct | null,
  canonicalProductUrl: string
): void {
  console.log(
    "[DESCRIPTION_SCRAPE_RESULT]",
    JSON.stringify({
      success,
      title: source?.title?.slice(0, 200) ?? null,
      store: source?.store ?? null,
      url: canonicalProductUrl.slice(0, 220),
    })
  );
}

function logDescriptionFallback(
  reason: string,
  product: SourceProduct
): void {
  console.log(
    "[DESCRIPTION_FALLBACK_USED]",
    JSON.stringify({
      reason,
      productObject: {
        store: product.store,
        url: (product.sourceUrl ?? "").slice(0, 220),
        title: product.title.slice(0, 200),
        price: product.originalPrice,
      },
    })
  );
}

/**
 * Derive an initial {@link SourceProduct} from a resolved canonical retailer URL.
 * Provider PDP extract runs even when generic server scrape is blocked (e.g. Amazon).
 */
export async function extractInitialProductFromCanonicalUrl(opts: {
  canonicalProductUrl: string;
  originalInputUrl?: string;
  slugFallbackQuery?: string;
  userPrice?: number | null;
  demoMode?: boolean;
}): Promise<InitialProductExtractionResult | null> {
  const canonicalProductUrl = opts.canonicalProductUrl.trim();
  if (!isValidHttpUrl(canonicalProductUrl)) return null;

  console.log(
    "[DESCRIPTION_INPUT]",
    JSON.stringify({
      originalInput: (opts.originalInputUrl ?? "").slice(0, 220),
      canonicalProductUrl: canonicalProductUrl.slice(0, 220),
    })
  );

  let scraped: ScrapedProduct | null = null;
  let attemptedExtract = false;
  let priceSource: string | null = null;
  let title = "";
  let fallbackReason: string | null = null;
  let providerPartial: SourceProduct | null = null;

  const urlProvider = findProductProviderForUrl(canonicalProductUrl);
  if (urlProvider) {
    attemptedExtract = true;
    try {
      const fromProvider =
        await urlProvider.extractSourceProduct(canonicalProductUrl);
      if (fromProvider?.title?.trim()) {
        const providerTitle = fromProvider.title.trim();
        if (
          !isAsinPlaceholderTitle(providerTitle) &&
          isUsablePdpTitle(providerTitle)
        ) {
          title = providerTitle;
          priceSource =
            fromProvider.originalPrice != null ? "provider_pdp" : null;
          logDescriptionScrapeResult(true, fromProvider, canonicalProductUrl);
          return {
            sourceProduct: { ...fromProvider, sourceUrl: canonicalProductUrl },
            attemptedExtract,
            priceSource,
            fallbackReason: null,
          };
        }
        providerPartial = fromProvider;
        if (fromProvider.originalPrice != null) {
          priceSource = "provider_pdp";
        }
      }
    } catch (err) {
      console.log(
        "[DESCRIPTION_SCRAPE_RESULT]",
        JSON.stringify({
          success: false,
          title: null,
          store: urlProvider.id,
          url: canonicalProductUrl.slice(0, 220),
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  const genericScrapeBlocked = isServerRetailScrapeBlocked(canonicalProductUrl);
  if (!genericScrapeBlocked) {
    attemptedExtract = true;
    try {
      scraped = await scrapeProduct(canonicalProductUrl);
      const scrapedTitle = pickTitleFromScrape(scraped);
      if (scraped && scrapedTitle) {
        title = scrapedTitle;
        priceSource = scraped.priceSource ?? "generic_pdp_scrape";
        const product = buildSourceProduct(
          canonicalProductUrl,
          title,
          scraped,
          opts.userPrice ?? null
        );
        logDescriptionScrapeResult(true, product, canonicalProductUrl);
        return {
          sourceProduct: product,
          attemptedExtract,
          priceSource,
          fallbackReason: null,
        };
      }
    } catch {
      /* fall through to metadata */
    }
  }

  let pageSignals: ProductPageTitleSignals | null = null;
  if (!title) {
    attemptedExtract = true;
    pageSignals = await fetchProductPageTitleSignals(canonicalProductUrl);
    if (pageSignals) {
      const metaTitle = pickTitleFromPageSignals(pageSignals);
      if (metaTitle) {
        title = metaTitle;
        fallbackReason = "html_metadata";
      }
    }
  }

  if (!title && !opts.demoMode) {
    const slug = slugTitleFromCanonicalUrl(canonicalProductUrl);
    const rawForAi =
      (pageSignals ? pickTitleFromPageSignals(pageSignals) : "") || slug;
    const aiMeta = await fetchAiProductMetadata({
      rawTitle: rawForAi || buildMinimalTitleForCanonicalUrl(canonicalProductUrl),
      url: canonicalProductUrl,
      ogTitle: pageSignals?.ogTitle ?? null,
      metaDescription:
        pageSignals?.metaDescription ?? pageSignals?.ogDescription ?? null,
      ogDescription: pageSignals?.ogDescription ?? null,
      skipAi: false,
    });
    const aiTitle = aiMeta.cleanTitle?.trim();
    if (
      aiTitle &&
      aiTitle.length >= 4 &&
      !isAsinPlaceholderTitle(aiTitle) &&
      isUsablePdpTitle(aiTitle)
    ) {
      title = aiTitle;
      fallbackReason = "openai_metadata";
    }
  }

  if (!title && canonicalUrlLooksLikeProductPage(canonicalProductUrl)) {
    const minimal = buildMinimalTitleForCanonicalUrl(canonicalProductUrl);
    if (
      minimal &&
      !isAsinPlaceholderTitle(minimal) &&
      isUsablePdpTitle(minimal)
    ) {
      title = minimal;
      fallbackReason = fallbackReason ?? "canonical_pdp_minimal";
    }
  }

  if (!title) {
    const slug =
      opts.slugFallbackQuery?.replace(/\s+/g, " ").trim() ||
      slugTitleFromCanonicalUrl(canonicalProductUrl);
    if (
      slug &&
      !isGenericRetailProductQuery(slug) &&
      !isAsinPlaceholderTitle(slug) &&
      isUsablePdpTitle(slug)
    ) {
      title = slug;
      fallbackReason = "url_slug";
    }
  }

  if (!title || isAsinPlaceholderTitle(title) || !isUsablePdpTitle(title)) {
    logDescriptionScrapeResult(false, null, canonicalProductUrl);
    return null;
  }

  if (!scraped && !genericScrapeBlocked) {
    scraped = await scrapeProduct(canonicalProductUrl).catch(() => null);
  }

  const product = buildSourceProduct(
    canonicalProductUrl,
    title,
    scraped,
    opts.userPrice ?? providerPartial?.originalPrice ?? null
  );

  if (providerPartial?.scrapedHints && !product.scrapedHints) {
    product.scrapedHints = providerPartial.scrapedHints;
  }
  if (
    product.originalPrice == null &&
    providerPartial?.originalPrice != null
  ) {
    product.originalPrice = providerPartial.originalPrice;
  }

  if (fallbackReason) {
    logDescriptionFallback(fallbackReason, product);
  }

  logDescriptionScrapeResult(
    isUsablePdpTitle(title) || Boolean(fallbackReason),
    product,
    canonicalProductUrl
  );

  return {
    sourceProduct: product,
    attemptedExtract,
    priceSource,
    fallbackReason,
  };
}

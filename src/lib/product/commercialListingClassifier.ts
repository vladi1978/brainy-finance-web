/**
 * Commercial listing / purchase-price intent classification for compare candidates.
 * Prevents rental, lease, RTO, installment, and subscription prices from being
 * treated as full retail purchase prices.
 */
import type {
  CommercialListingClassification,
  CommercialListingType,
  CommercialPriceIntent,
  ProductCategory,
} from "./types";
import { hostFromUrl } from "./source/storeDomains";

export type {
  CommercialListingClassification,
  CommercialListingType,
  CommercialPriceIntent,
} from "./types";

export type ClassifyCommercialListingInput = {
  title: string;
  rawPrice?: string | null;
  extractedPrice?: unknown;
  installment?: unknown;
  alternativePrice?: string | null;
  url?: string | null;
  hostname?: string | null;
  storeLabel?: string | null;
};

/** Domains associated with rent-to-own / rental merchants — hard reject. */
const RENTAL_MERCHANT_HOST_PATTERNS: RegExp[] = [
  /\bmyrentking\b/i,
  /\brentacenter\b/i,
  /\brent-a-center\b/i,
  /\baarons\b/i,
  /\baaron['']?s\b/i,
  /\bflexshopper\b/i,
  /\brent2own\b/i,
  /\brto\b/i,
  /\bleaseville\b/i,
  /\bprogressive\s*leasing\b/i,
  /\bacima\b/i,
  /\bkafene\b/i,
  /\brentdelite\b/i,
  /\bwhyrrent\b/i,
];

const TITLE_NON_PURCHASE_RE =
  /\b(rent[\s-]?to[\s-]?own|rent2own|\brto\b|rental|for\s+rent|\blease\b|leasing|installment|financing|finance\s+plan|payment\s+plan|monthly\s+payment|weekly\s+payment|per\s+month|per\s+week|\/\s*mo\b|\/\s*month\b|\/\s*wk\b|\/\s*week\b|subscription|membership\s+fee|down\s+payment|deposit\s+only|security\s+deposit|pay\s+weekly|pay\s+monthly)\b/i;

const PAYMENT_PERIOD_PRICE_RE =
  /\$\s*[\d,.]+\s*(?:\/|\s*per\s*)(?:mo|month|wk|week|yr|year)\b|\b(?:weekly|monthly)\b[\s\S]{0,24}\$\s*[\d,.]+/i;

const PAYMENT_PERIOD_ONLY_RE =
  /(?:\/|\s*per\s*)(?:mo|month|wk|week|yr|year)\b|\b(?:weekly|monthly)\s+(?:payment|rate|price|rent|lease|installment)\b/i;

export const PRICE_RATIO_SUSPICIOUS_THRESHOLD = 0.15;

const DURABLE_GOODS_CATEGORIES = new Set<ProductCategory>([
  "tv",
  "monitor",
  "tools",
  "pool",
  "outdoor_pool",
  "swimming_pool",
  "audio",
  "household",
]);

export function isDurableGoodsCategory(category: ProductCategory): boolean {
  return DURABLE_GOODS_CATEGORIES.has(category);
}

export function isPaymentPeriodPriceString(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  return PAYMENT_PERIOD_ONLY_RE.test(raw.trim());
}

function coercePriceToString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  if (typeof val === "string" && val.trim()) return val.trim();
  if (typeof val === "object") {
    const o = val as Record<string, unknown>;
    const v =
      typeof o.value === "number"
        ? o.value
        : typeof o.extracted_value === "number"
          ? o.extracted_value
          : typeof o.price === "number"
            ? o.price
            : NaN;
    if (Number.isFinite(v)) return String(v);
    const ps = typeof o.price === "string" ? o.price.trim() : null;
    if (ps) return ps;
  }
  return null;
}

export function parsePurchasePriceNumber(
  raw: string | null | undefined,
): number | null {
  if (raw == null || raw === "") return null;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hostFromInput(url: string | null | undefined, hostname: string | null | undefined): string {
  const fromHost = hostname?.trim().toLowerCase().replace(/^www\./, "");
  if (fromHost) return fromHost;
  const fromUrl = url ? hostFromUrl(url) : null;
  return fromUrl ?? "";
}

function blobFromInput(input: ClassifyCommercialListingInput): string {
  const host = hostFromInput(input.url, input.hostname);
  return [
    input.title,
    input.rawPrice,
    input.alternativePrice,
    coercePriceToString(input.extractedPrice),
    coercePriceToString(input.installment),
    input.url,
    host,
    input.storeLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchRentalMerchantHost(host: string, blob: string): string | null {
  const target = `${host} ${blob}`;
  for (const re of RENTAL_MERCHANT_HOST_PATTERNS) {
    if (re.test(target)) return re.source;
  }
  return null;
}

function inferListingTypeFromSignals(
  signals: string[],
  rawPrice: string | null,
  blob: string,
): CommercialListingType {
  if (signals.some((s) => s.startsWith("domain:"))) return "rental";
  if (/\b(subscription|membership)\b/i.test(blob)) return "subscription";
  if (/\b(down\s+payment|deposit)\b/i.test(blob)) return "deposit";
  if (/\b(lease|leasing)\b/i.test(blob)) return "lease";
  if (
    /\b(rent[\s-]?to[\s-]?own|rent2own|\brto\b|rental|for\s+rent)\b/i.test(blob)
  ) {
    return "rental";
  }
  if (
    /\b(installment|financing|finance\s+plan|payment\s+plan|monthly\s+payment|weekly\s+payment)\b/i.test(
      blob,
    ) ||
    isPaymentPeriodPriceString(rawPrice)
  ) {
    return "installment";
  }
  if (signals.includes("installment_field_only")) return "unknown_non_purchase";
  if (signals.includes("payment_period_price_only")) return "unknown_non_purchase";
  return "full_purchase";
}

/**
 * Classify commercial listing type and price intent from shopping row metadata.
 */
export function classifyCommercialListing(
  input: ClassifyCommercialListingInput,
): CommercialListingClassification {
  const signals: string[] = [];
  const rawPrice = input.rawPrice?.trim() || null;
  const hasFullPurchaseRaw =
    Boolean(rawPrice) && !isPaymentPeriodPriceString(rawPrice);

  const blob = blobFromInput({
    ...input,
    /** When a full purchase price is present, ignore installment metadata for intent. */
    installment: hasFullPurchaseRaw ? null : input.installment,
  });
  const host = hostFromInput(input.url, input.hostname);

  const rentalHost = matchRentalMerchantHost(host, blob);
  if (rentalHost) signals.push(`domain:${rentalHost}`);

  if (rawPrice && isPaymentPeriodPriceString(rawPrice)) {
    signals.push("payment_period_raw_price");
  }
  if (rawPrice && PAYMENT_PERIOD_PRICE_RE.test(rawPrice)) {
    signals.push("payment_period_price_pattern");
  }
  if (TITLE_NON_PURCHASE_RE.test(blob)) {
    signals.push("title_or_blob_non_purchase_keyword");
  }
  if (
    !hasFullPurchaseRaw &&
    input.installment != null &&
    coercePriceToString(input.installment)
  ) {
    signals.push("installment_field_present");
  }

  let listingType = inferListingTypeFromSignals(signals, rawPrice, blob);
  let priceIntent: CommercialPriceIntent = "unknown";
  let confidence = 0.55;

  if (rentalHost) {
    priceIntent = "not_purchase_price";
    confidence = 0.96;
  } else if (
    signals.includes("payment_period_raw_price") ||
    signals.includes("payment_period_price_pattern")
  ) {
    priceIntent = "payment_amount";
    confidence = 0.92;
    if (listingType === "full_purchase") listingType = "installment";
  } else if (signals.includes("title_or_blob_non_purchase_keyword")) {
    priceIntent = "not_purchase_price";
    confidence = 0.88;
    if (listingType === "full_purchase") {
      listingType = inferListingTypeFromSignals(
        [...signals, "keyword_fallback"],
        rawPrice,
        blob,
      );
    }
  } else if (signals.includes("installment_field_only")) {
    priceIntent = "not_purchase_price";
    confidence = 0.9;
  } else if (listingType === "full_purchase" && rawPrice) {
    priceIntent = "purchase_price";
    confidence = 0.78;
  } else if (listingType === "full_purchase") {
    priceIntent = "purchase_price";
    confidence = 0.65;
  }

  if (
    listingType === "full_purchase" &&
    priceIntent === "purchase_price" &&
    !rentalHost &&
    !signals.includes("payment_period_raw_price")
  ) {
    confidence = Math.max(confidence, 0.72);
  }

  if (hasFullPurchaseRaw && !rentalHost) {
    listingType = "full_purchase";
    priceIntent = "purchase_price";
    confidence = Math.max(confidence, 0.8);
  }

  return { listingType, priceIntent, confidence, signals };
}

export function shouldRejectCommercialListing(
  classification: CommercialListingClassification,
): boolean {
  if (classification.priceIntent !== "purchase_price") return true;
  return (
    classification.listingType === "rental" ||
    classification.listingType === "lease" ||
    classification.listingType === "installment" ||
    classification.listingType === "subscription" ||
    classification.listingType === "deposit" ||
    classification.listingType === "unknown_non_purchase"
  );
}

export function commercialListingDisplayLabel(
  classification: CommercialListingClassification,
): string | null {
  switch (classification.listingType) {
    case "rental":
      return "Rental / rent-to-own";
    case "lease":
      return "Lease offer";
    case "installment":
      return "Payment plan";
    case "subscription":
      return "Subscription";
    case "deposit":
      return "Deposit / down payment";
    case "unknown_non_purchase":
      return "Non-purchase offer";
    default:
      if (classification.priceIntent === "payment_amount") return "Payment amount";
      return null;
  }
}

export function isSuspiciousPurchasePriceRatio(
  candidatePrice: number,
  referencePrice: number,
): boolean {
  if (!Number.isFinite(candidatePrice) || !Number.isFinite(referencePrice)) return false;
  if (referencePrice <= 0 || candidatePrice <= 0) return false;
  return candidatePrice / referencePrice < PRICE_RATIO_SUSPICIOUS_THRESHOLD;
}

export function hasCommercialNonPurchaseSignals(
  classification: CommercialListingClassification,
): boolean {
  return (
    shouldRejectCommercialListing(classification) ||
    classification.signals.some((s) =>
      s.startsWith("domain:") ||
      s.includes("non_purchase") ||
      s.includes("payment_period"),
    )
  );
}

export type ResolveShoppingPurchasePriceInput = {
  title: string;
  price?: unknown;
  extracted_price?: unknown;
  installment?: unknown;
  alternative_price?: unknown;
  url?: string | null;
  hostname?: string | null;
  storeLabel?: string | null;
};

export type ResolveShoppingPurchasePriceResult = {
  rawPriceText: string | null;
  purchasePrice: number | null;
  classification: CommercialListingClassification;
  rejected: boolean;
  rejectReason?: string;
};

/**
 * Resolve a full purchase price from a Google Shopping row.
 * Never uses installment-only prices as purchase prices.
 */
export function resolveShoppingPurchasePrice(
  input: ResolveShoppingPurchasePriceInput,
): ResolveShoppingPurchasePriceResult {
  const fullPriceCandidates: string[] = [];

  if (typeof input.price === "string" && input.price.trim()) {
    fullPriceCandidates.push(input.price.trim());
  }
  const extracted = coercePriceToString(input.extracted_price);
  if (extracted) fullPriceCandidates.push(extracted);
  if (typeof input.alternative_price === "string" && input.alternative_price.trim()) {
    fullPriceCandidates.push(input.alternative_price.trim());
  }

  let rawPriceText: string | null = null;
  for (const candidate of fullPriceCandidates) {
    if (!isPaymentPeriodPriceString(candidate)) {
      rawPriceText = candidate;
      break;
    }
  }

  const installmentRaw = coercePriceToString(input.installment);
  const hostname =
    input.hostname ??
    (input.url ? hostFromUrl(input.url) : null);

  const classification = classifyCommercialListing({
    title: input.title,
    rawPrice: rawPriceText ?? fullPriceCandidates[0] ?? installmentRaw,
    extractedPrice: input.extracted_price,
    installment: input.installment,
    alternativePrice:
      typeof input.alternative_price === "string" ? input.alternative_price : null,
    url: input.url,
    hostname,
    storeLabel: input.storeLabel,
  });

  if (!rawPriceText) {
    if (installmentRaw && fullPriceCandidates.length === 0) {
      return {
        rawPriceText: installmentRaw,
        purchasePrice: null,
        classification: {
          ...classification,
          listingType: "installment",
          priceIntent: "payment_amount",
          signals: [...classification.signals, "installment_field_only"],
        },
        rejected: true,
        rejectReason: "installment_only_no_full_purchase_price",
      };
    }
    if (fullPriceCandidates.length > 0 && fullPriceCandidates.every(isPaymentPeriodPriceString)) {
      return {
        rawPriceText: fullPriceCandidates[0] ?? null,
        purchasePrice: null,
        classification: {
          ...classification,
          listingType: "installment",
          priceIntent: "payment_amount",
          signals: [...classification.signals, "payment_period_price_only"],
        },
        rejected: true,
        rejectReason: "payment_period_price_only",
      };
    }
    return {
      rawPriceText: null,
      purchasePrice: null,
      classification,
      rejected: true,
      rejectReason: "missing_parseable_purchase_price",
    };
  }

  const purchasePrice = parsePurchasePriceNumber(rawPriceText);
  if (purchasePrice == null) {
    return {
      rawPriceText,
      purchasePrice: null,
      classification,
      rejected: true,
      rejectReason: "missing_parseable_purchase_price",
    };
  }

  const rejected = shouldRejectCommercialListing(classification);
  return {
    rawPriceText,
    purchasePrice,
    classification,
    rejected,
    rejectReason: rejected ? "commercial_listing_not_purchase" : undefined,
  };
}

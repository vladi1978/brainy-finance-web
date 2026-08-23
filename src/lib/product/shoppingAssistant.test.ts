import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShoppingAssistantView,
  interpretShoppingRequest,
  isNonOutrightPurchaseShoppingOffer,
} from "./shoppingAssistant";
import type { CompareApiCandidate, CompareProductResponse } from "./types";

test("interprets AA batteries without forcing a compare department", () => {
  const parsed = interpretShoppingRequest("I need AA batteries.");
  assert.equal(parsed.productQuery, "AA batteries");
  assert.equal(parsed.category, "batteries");
  assert.equal(parsed.department, null);
  assert.equal(parsed.attributes.batterySize, "AA");
});

test("interprets a 65 inch TV into electronics", () => {
  const parsed = interpretShoppingRequest("I need a 65 inch TV.");
  assert.equal(parsed.productQuery, "65 inch TV");
  assert.equal(parsed.department, "electronics");
  assert.equal(parsed.attributes.screenSizeInches, "65");
  assert.equal(parsed.category, "televisions");
});

test("interprets a cordless drill into tools", () => {
  const parsed = interpretShoppingRequest("I need a cordless drill.");
  assert.equal(parsed.productQuery, "cordless drill");
  assert.equal(parsed.department, "tools");
  assert.equal(parsed.attributes.cordless, "true");
  assert.equal(parsed.attributes.toolType, "drill");
});

function baseCandidate(args: {
  title: string;
  packCount: number | null;
  price: number;
  store?: string;
  storeLabel?: string;
  productUrl?: string;
  sizeLabel?: string | null;
  rating?: number | null;
  identityScore?: number;
}): CompareApiCandidate {
  const productUrl = args.productUrl ?? "https://www.walmart.com/ip/aa";
  return {
    store: args.store ?? "walmart",
    storeLabel: args.storeLabel ?? "Walmart",
    title: args.title,
    price: args.price,
    currency: "USD",
    productUrl,
    affiliateUrl: productUrl,
    imageUrl: null,
    rating: args.rating ?? null,
    normalized: {
      structured: {
        title: args.title,
        brand: null,
        category: "household",
        price: args.price,
        currency: "USD",
        productUrl,
        condition: "new",
        sizeInches: null,
        modelFamily: null,
        fullModel: null,
        displayType: null,
        resolution: null,
        smartTv: null,
        smartTvPlatform: null,
        productType: null,
        toolVoltage: null,
        toolBatteryKit: null,
        gender: null,
        packCount: args.packCount,
        sizeLabel: args.sizeLabel === undefined ? "AA" : args.sizeLabel,
        color: null,
      },
      titleNorm: args.title.toLowerCase(),
      brand: null,
      modelTokens: [],
      sizeInches: null,
      category: "household",
      packCount: args.packCount,
      gender: null,
    },
    confidence: 0.8,
    matchConfidenceLabel: "high",
    matchType: "close_match",
    identityScore: args.identityScore ?? 100,
    identityReasons: ["title tokens"],
    missingCriticalAttributes: [],
    relevanceScore: 80,
    relevanceReason: "AA batteries",
    matchReasons: ["AA size"],
    outboundUrl: productUrl,
    urlType: "product",
    urlConfidence: "high",
  };
}

function viewFor(candidates: CompareApiCandidate[], request = "I need AA batteries.") {
  const compare: CompareProductResponse = {
    query: "AA batteries",
    normalizedQuery: "aa batteries",
    candidates,
    resultsByStore: [],
    bestDeal: null,
    showBestDeal: false,
    confidence: "high",
    message: null,
    sourceProduct: null,
    alternatives: [],
    savings: null,
  };
  return buildShoppingAssistantView(
    request,
    interpretShoppingRequest(request),
    compare
  );
}

test("AA 24-pack beats a cheaper AA 2-pack on shopping value, not sticker price", () => {
  const view = viewFor([
    baseCandidate({
      title: "Monster Power AA Alkaline Batteries 2 pack",
      packCount: 2,
      price: 0.98,
      identityScore: 100,
      productUrl: "https://www.walmart.com/ip/aa-2",
    }),
    baseCandidate({
      title: "Duracell Coppertop AA Alkaline Batteries 24 Count",
      packCount: 24,
      price: 6.97,
      identityScore: 80,
      productUrl: "https://www.walmart.com/ip/aa-24",
    }),
  ]);
  assert.match(view.recommendation?.title ?? "", /24/i);
  assert.doesNotMatch(view.recommendation?.title ?? "", /2 pack/i);
  assert.equal(view.options[0]?.packCount, 24);
  assert.ok((view.options[0]?.pricePerUnit ?? 1) < 0.4);
  assert.ok(
    !view.recommendation?.factualReasons.some((reason) =>
      /identity score 100/i.test(reason)
    )
  );
});

test("explicit AA request does not recommend AAA over AA", () => {
  const view = viewFor([
    baseCandidate({
      title: "Energizer Max AAA Alkaline Batteries 24 Count",
      packCount: 24,
      price: 5.5,
      sizeLabel: "AAA",
      productUrl: "https://www.walmart.com/ip/aaa-24",
    }),
    baseCandidate({
      title: "Energizer Max AA Alkaline Batteries 20 Count",
      packCount: 20,
      price: 7.5,
      sizeLabel: "AA",
      productUrl: "https://www.walmart.com/ip/aa-20",
    }),
  ]);
  assert.match(view.recommendation?.title ?? "", /\bAA\b/);
  assert.doesNotMatch(view.recommendation?.title ?? "", /\bAAA\b/);
  assert.equal(view.options[0]?.compatibility, "match");
});

test("missing pack count does not invent a pack or unit price", () => {
  const view = viewFor([
    baseCandidate({
      title: "Generic AA Alkaline Batteries",
      packCount: null,
      price: 4.99,
    }),
  ]);
  assert.equal(view.options[0]?.packCount, null);
  assert.equal(view.options[0]?.pricePerUnit, null);
  assert.ok(
    view.options[0]?.dataNotes.some((note) => /Pack count: unavailable/i.test(note))
  );
});

test("missing rating is labeled unavailable and does not block a recommendation", () => {
  const view = viewFor([
    baseCandidate({
      title: "Duracell AA Alkaline Batteries 24 Count",
      packCount: 24,
      price: 6.97,
      rating: null,
    }),
  ]);
  assert.ok(view.recommendation);
  assert.equal(view.options[0]?.rating, null);
  assert.ok(
    view.options[0]?.dataNotes.some((note) => /Rating: unavailable/i.test(note))
  );
});

test("unrequested rechargeable AA does not beat alkaline AA household pack", () => {
  const view = viewFor([
    baseCandidate({
      title: "EBL Rechargeable AA NiMH Batteries 16 pack",
      packCount: 16,
      price: 12.99,
      productUrl: "https://www.walmart.com/ip/aa-nimh",
    }),
    baseCandidate({
      title: "Duracell Coppertop AA Alkaline Batteries 24 Count",
      packCount: 24,
      price: 6.97,
      productUrl: "https://www.walmart.com/ip/aa-alk",
    }),
  ]);
  assert.match(view.recommendation?.title ?? "", /alkaline/i);
  assert.doesNotMatch(view.recommendation?.title ?? "", /rechargeable|nimh/i);
});

test("Amazon wins among comparable household AA packs when actually returned", () => {
  const view = viewFor([
    baseCandidate({
      title: "Duracell Coppertop AA Alkaline Batteries 24 Count",
      packCount: 24,
      price: 6.97,
      productUrl: "https://www.walmart.com/ip/aa-24",
    }),
    baseCandidate({
      store: "amazon",
      storeLabel: "Amazon.com",
      title: "Amazon Basics AA Performance Alkaline Batteries 24 Count",
      packCount: 24,
      price: 7.49,
      productUrl: "https://www.amazon.com/dp/B00LH3DMUO",
    }),
  ]);
  assert.equal(view.recommendation?.amazonListing, true);
  assert.match(view.recommendation?.retailer ?? "", /amazon/i);
  assert.equal(view.amazonPreferred, true);
});

test("Amazon 2-pack does not beat a non-Amazon household AA 24-pack", () => {
  const view = viewFor([
    baseCandidate({
      store: "amazon",
      storeLabel: "Amazon.com",
      title: "Amazon Basics AA Alkaline Batteries 2 pack",
      packCount: 2,
      price: 1.29,
      productUrl: "https://www.amazon.com/dp/TINY",
    }),
    baseCandidate({
      title: "Duracell Coppertop AA Alkaline Batteries 24 Count",
      packCount: 24,
      price: 6.97,
      productUrl: "https://www.walmart.com/ip/aa-24",
    }),
  ]);
  assert.equal(view.recommendation?.amazonListing, false);
  assert.match(view.recommendation?.title ?? "", /24/i);
});

test("when no Amazon candidate is returned, the actual retailer is recommended", () => {
  const view = viewFor([
    baseCandidate({
      title: "Duracell Coppertop AA Alkaline Batteries 24 Count",
      packCount: 24,
      price: 6.97,
    }),
  ]);
  assert.equal(view.recommendation?.amazonListing, false);
  assert.equal(view.amazonPreferred, false);
  assert.match(view.recommendation?.retailer ?? "", /walmart/i);
});

test("household AA 24-pack beats a bulk 400-count lot on generic battery ranking", () => {
  const valueUrl = "https://www.walmart.com/ip/great-value-aa-24";
  const view = viewFor([
    baseCandidate({
      title: "Voniko Lot AA Alkaline Batteries Bulk 400 Pack",
      packCount: 400,
      price: 10,
      rating: 4.9,
      store: "ebay",
      storeLabel: "eBay",
      productUrl: "https://www.ebay.com/itm/voniko-400",
    }),
    baseCandidate({
      title: "Great Value AA Alkaline Batteries 24 Count",
      packCount: 24,
      price: 9.97,
      rating: 4.5,
      productUrl: valueUrl,
    }),
  ]);
  assert.match(view.recommendation?.title ?? "", /great value/i);
  assert.doesNotMatch(view.recommendation?.title ?? "", /400/i);
  assert.equal(view.recommendation?.productUrl, valueUrl);
});

test("household AA 24-pack with stronger unit value beats a higher-rated premium 24-pack", () => {
  const valueUrl = "https://www.walmart.com/ip/great-value-aa-24";
  const view = viewFor([
    baseCandidate({
      title: "Duracell Coppertop AA Alkaline Batteries 24 Count",
      packCount: 24,
      price: 15.92,
      rating: 4.8,
      productUrl: "https://www.walmart.com/ip/duracell-aa-24",
    }),
    baseCandidate({
      title: "Great Value AA Alkaline Batteries 24 Count",
      packCount: 24,
      price: 8.44,
      rating: 4.2,
      productUrl: valueUrl,
    }),
  ]);
  assert.match(view.recommendation?.title ?? "", /great value/i);
  assert.doesNotMatch(view.recommendation?.title ?? "", /duracell/i);
  assert.equal(view.recommendation?.productUrl, valueUrl);
  assert.equal(view.options[0]?.productUrl, valueUrl);
});

function tvView(candidates: CompareApiCandidate[]) {
  return viewFor(candidates, "I need a 65 inch TV.");
}

test("65-inch television survives a generic shopping-assistant TV need", () => {
  const view = tvView([
    baseCandidate({
      title: "Samsung 65 Inch Class Crystal UHD 4K Smart TV",
      packCount: null,
      price: 548,
      productUrl: "https://www.bestbuy.com/site/samsung-65",
    }),
  ]);
  assert.ok(view.options.length >= 1);
  assert.match(view.recommendation?.title ?? "", /65/i);
  assert.match(view.recommendation?.title ?? "", /tv/i);
  assert.equal(view.options[0]?.compatibility, "match");
});

test("known 55-inch TV does not outrank a known 65-inch TV", () => {
  const view = tvView([
    baseCandidate({
      title: "Hisense 55 Inch Class 4K Smart TV",
      packCount: null,
      price: 248,
      productUrl: "https://www.walmart.com/ip/55tv",
    }),
    baseCandidate({
      title: "TCL 65 Inch Class 4K UHD Smart TV",
      packCount: null,
      price: 398,
      productUrl: "https://www.walmart.com/ip/65tv",
    }),
  ]);
  assert.match(view.recommendation?.title ?? "", /65/i);
  assert.doesNotMatch(view.recommendation?.title ?? "", /55 Inch/i);
});

test("TV wall mount is rejected for a 65-inch TV shopping need", () => {
  const view = tvView([
    baseCandidate({
      title: "SANUS Advanced Tilt 65 Inch TV Wall Mount",
      packCount: null,
      price: 79,
      productUrl: "https://www.homedepot.com/p/tv-mount",
    }),
    baseCandidate({
      title: "LG 65 Inch Class OLED evo 4K Smart TV",
      packCount: null,
      price: 1299,
      productUrl: "https://www.bestbuy.com/site/lg-65",
    }),
  ]);
  assert.ok(!view.options.some((row) => /wall mount/i.test(row.title)));
  assert.match(view.recommendation?.title ?? "", /oled/i);
});

test("TV stand is rejected for a 65-inch TV shopping need", () => {
  const view = tvView([
    baseCandidate({
      title: "Walker Edison 65 Inch TV Stand with Storage",
      packCount: null,
      price: 189,
      productUrl: "https://www.walmart.com/ip/tv-stand",
    }),
    baseCandidate({
      title: "Sony 65 Inch Class 4K HDR LED Smart TV",
      packCount: null,
      price: 798,
      productUrl: "https://www.bestbuy.com/site/sony-65",
    }),
  ]);
  assert.ok(!view.options.some((row) => /tv stand/i.test(row.title)));
  assert.match(view.recommendation?.title ?? "", /sony/i);
});

test("confirmed cheaper 65-inch TV beats a higher-rated premium 65-inch listing", () => {
  const valueUrl = "https://www.walmart.com/ip/vizio-v4k65m";
  const view = tvView([
    baseCandidate({
      title: 'Samsung S95H 65" 4K OLED Vision AI Smart TV',
      packCount: null,
      price: 2999.99,
      rating: 4.8,
      store: "nfm",
      storeLabel: "NFM",
      productUrl: "https://www.nfm.com/samsung-s95h-65",
    }),
    baseCandidate({
      title: 'Vizio V4K65M-0804 65" 4K HDR Smart TV',
      packCount: null,
      price: 348,
      rating: 4,
      store: "walmart",
      storeLabel: "Walmart",
      productUrl: valueUrl,
    }),
  ]);
  assert.match(view.recommendation?.title ?? "", /vizio/i);
  assert.doesNotMatch(view.recommendation?.title ?? "", /samsung|oled/i);
  assert.match(view.recommendation?.retailer ?? "", /walmart/i);
  assert.equal(view.recommendation?.productUrl, valueUrl);
  assert.equal(view.options[0]?.productUrl, valueUrl);
  assert.equal(view.options[0]?.compatibility, "match");
  assert.ok(
    view.options.some((row) => /samsung/i.test(row.title) && row.compatibility === "match")
  );
  assert.ok(
    view.recommendation?.factualReasons.some((reason) =>
      /matches the requested 65-inch screen size/i.test(reason)
    )
  );
  assert.ok(
    view.recommendation?.factualReasons.some((reason) =>
      /4k\/uhd/i.test(reason)
    )
  );
  assert.ok(
    view.recommendation?.factualReasons.some((reason) =>
      /\$348\.00/i.test(reason)
    )
  );
  assert.ok(
    !view.recommendation?.factualReasons.some((reason) =>
      /prime|delivery|in stock|oled/i.test(reason)
    )
  );
});

test("confirmed 65-inch TV beats an unknown-size premium OLED", () => {
  const view = tvView([
    baseCandidate({
      title: "LG C6 OLED evo AI Smart 4K TV",
      packCount: null,
      price: 1799.99,
      productUrl: "https://www.bestbuy.com/site/lg-c6",
    }),
    baseCandidate({
      title: "TCL 65 Inch Class 4K UHD Smart TV",
      packCount: null,
      price: 398,
      productUrl: "https://www.walmart.com/ip/65tv",
    }),
  ]);
  assert.match(view.recommendation?.title ?? "", /65/i);
  assert.doesNotMatch(view.recommendation?.title ?? "", /C6 OLED/i);
  assert.ok(
    view.recommendation?.factualReasons.some((reason) =>
      /matches the requested 65-inch screen size/i.test(reason)
    )
  );
  assert.ok(view.options.some((row) => /C6 OLED/i.test(row.title)));
});

test("58-inch TV is rejected for a 65-inch request", () => {
  const view = tvView([
    baseCandidate({
      title: "Westinghouse 58-In. 4K UHD Roku TV",
      packCount: null,
      price: 198,
      productUrl: "https://www.walmart.com/ip/58tv",
    }),
    baseCandidate({
      title: "Samsung 65 Inch Class 4K Smart TV",
      packCount: null,
      price: 548,
      productUrl: "https://www.bestbuy.com/site/samsung-65",
    }),
  ]);
  assert.ok(!view.options.some((row) => /58/i.test(row.title)));
  assert.match(view.recommendation?.title ?? "", /65/i);
});

test("100-inch TV is rejected for a 65-inch request", () => {
  const view = tvView([
    baseCandidate({
      title: "Hisense 100 Inch Class 4K Smart TV",
      packCount: null,
      price: 1298,
      productUrl: "https://www.bestbuy.com/site/hisense-100",
    }),
    baseCandidate({
      title: "TCL 65 Inch Class 4K UHD Smart TV",
      packCount: null,
      price: 398,
      productUrl: "https://www.walmart.com/ip/65tv",
    }),
  ]);
  assert.ok(!view.options.some((row) => /100 Inch/i.test(row.title)));
  assert.match(view.recommendation?.title ?? "", /65/i);
});

test("55-inch and 75-inch TVs are rejected for a 65-inch request", () => {
  const view = tvView([
    baseCandidate({
      title: "Hisense 55 Inch Class 4K Smart TV",
      packCount: null,
      price: 248,
      productUrl: "https://www.walmart.com/ip/55tv",
    }),
    baseCandidate({
      title: "Samsung 75 Inch Class 4K Smart TV",
      packCount: null,
      price: 798,
      productUrl: "https://www.bestbuy.com/site/samsung-75",
    }),
    baseCandidate({
      title: "TCL 65 Inch Class 4K UHD Smart TV",
      packCount: null,
      price: 398,
      productUrl: "https://www.walmart.com/ip/65tv",
    }),
  ]);
  assert.ok(!view.options.some((row) => /55 Inch|75 Inch/i.test(row.title)));
  assert.match(view.recommendation?.title ?? "", /65/i);
});

test("64-inch and 66-inch remain compatible under ±1 inch tolerance", () => {
  const view = tvView([
    baseCandidate({
      title: "Sony 64 Inch Class 4K Smart TV",
      packCount: null,
      price: 498,
      productUrl: "https://www.bestbuy.com/site/sony-64",
    }),
  ]);
  assert.equal(view.options[0]?.compatibility, "match");
  const view66 = tvView([
    baseCandidate({
      title: "LG 66 Inch Class OLED Smart TV",
      packCount: null,
      price: 998,
      productUrl: "https://www.bestbuy.com/site/lg-66",
    }),
  ]);
  assert.equal(view66.options[0]?.compatibility, "match");
});

test("confirmed 65-inch products are displayed before unknown-size TVs", () => {
  const view = tvView([
    baseCandidate({
      title: "TCL 4K UHD Smart Android Television HDR",
      packCount: null,
      price: 329,
      productUrl: "https://www.target.com/p/tcl-uhd",
    }),
    baseCandidate({
      title: "Samsung 65 Inch Class 4K Smart TV",
      packCount: null,
      price: 548,
      productUrl: "https://www.bestbuy.com/site/samsung-65",
    }),
  ]);
  assert.match(view.options[0]?.title ?? "", /65/i);
  assert.ok(view.options.some((row) => /android television/i.test(row.title)));
  const unknownIndex = view.options.findIndex((row) =>
    /android television/i.test(row.title)
  );
  const confirmedIndex = view.options.findIndex((row) => /65 Inch/i.test(row.title));
  assert.ok(confirmedIndex >= 0 && unknownIndex > confirmedIndex);
});

test("unknown-size TV cannot win recommendation when a confirmed 65-inch listing exists", () => {
  const view = tvView([
    baseCandidate({
      title: "TCL 4K UHD Smart Android Television HDR",
      packCount: null,
      price: 329,
      productUrl: "https://www.target.com/p/tcl-uhd",
    }),
    baseCandidate({
      title: "Samsung 65 Inch Class 4K Smart TV",
      packCount: null,
      price: 548,
      productUrl: "https://www.bestbuy.com/site/samsung-65",
    }),
  ]);
  assert.match(view.recommendation?.title ?? "", /65/i);
  assert.doesNotMatch(view.recommendation?.title ?? "", /android television/i);
});

test("unknown-size TV can win only when no confirmed 65-inch listing exists", () => {
  const view = tvView([
    baseCandidate({
      title: "LG C6 OLED evo AI Smart 4K TV",
      packCount: null,
      price: 1799.99,
      productUrl: "https://www.bestbuy.com/site/lg-c6",
    }),
  ]);
  assert.match(view.recommendation?.title ?? "", /C6 OLED/i);
  assert.ok(
    view.recommendation?.factualReasons.some((reason) =>
      /fallback because no confirmed 65-inch listing was available/i.test(reason)
    )
  );
});

test("Rent-A-Center payment listing is excluded from shopping candidates", () => {
  const view = tvView([
    baseCandidate({
      title: 'LG 65" 4K UHD UA77 Series Smart TV',
      packCount: null,
      price: 23.99,
      store: "other",
      storeLabel: "Rent-A-Center",
      productUrl: "https://www.rentacenter.com/p/lg-65",
    }),
    baseCandidate({
      title: "Samsung 65 Inch Class Crystal UHD 4K Smart TV",
      packCount: null,
      price: 348,
      store: "bestbuy",
      storeLabel: "Best Buy",
      productUrl: "https://www.bestbuy.com/site/samsung-65",
    }),
  ]);
  assert.ok(!view.options.some((row) => /rent-a-center/i.test(row.retailer)));
  assert.match(view.recommendation?.title ?? "", /samsung/i);
  assert.match(view.recommendation?.retailer ?? "", /best buy/i);
});

test("explicit rent-to-own listing is excluded", () => {
  const view = tvView([
    baseCandidate({
      title: "LG 65 Inch 4K Smart TV rent-to-own weekly",
      packCount: null,
      price: 19.99,
      store: "other",
      storeLabel: "Local RTO",
      productUrl: "https://example.com/rto-tv",
    }),
    baseCandidate({
      title: "TCL 65 Inch Class 4K UHD Smart TV",
      packCount: null,
      price: 398,
      productUrl: "https://www.walmart.com/ip/65tv",
    }),
  ]);
  assert.ok(!view.options.some((row) => /rent-to-own/i.test(row.title)));
  assert.match(view.recommendation?.title ?? "", /TCL 65/i);
});

test("explicit per-month payment listing is excluded", () => {
  const view = tvView([
    baseCandidate({
      title: "Sony 65 Inch 4K Smart TV $23.99/month",
      packCount: null,
      price: 23.99,
      store: "other",
      storeLabel: "Lease Mart",
      productUrl: "https://example.com/sony-65-month",
    }),
    baseCandidate({
      title: "TCL 65 Inch Class 4K UHD Smart TV",
      packCount: null,
      price: 398,
      productUrl: "https://www.walmart.com/ip/65tv",
    }),
  ]);
  assert.ok(!view.options.some((row) => /\/month/i.test(row.title)));
  assert.match(view.recommendation?.title ?? "", /TCL 65/i);
});

test("Vision Optique listing is excluded from display and recommendation", () => {
  const view = tvView([
    baseCandidate({
      title: '65" Class Nano LED 4K UHD Smart TV',
      packCount: null,
      price: 70,
      store: "other",
      storeLabel: "Vision Optique",
      productUrl: "https://www.visionoptique.com/p/65-nano-led",
    }),
    baseCandidate({
      title: "Samsung 65 Inch Class Crystal UHD 4K Smart TV",
      packCount: null,
      price: 348,
      store: "walmart",
      storeLabel: "Walmart",
      productUrl: "https://www.walmart.com/ip/samsung-65",
    }),
  ]);
  assert.ok(!view.options.some((row) => /vision\s*optique/i.test(row.retailer)));
  assert.ok(!view.options.some((row) => /nano led/i.test(row.title)));
  assert.match(view.recommendation?.title ?? "", /samsung/i);
  assert.match(view.recommendation?.retailer ?? "", /walmart/i);
});

test("visionoptique domain variant is excluded", () => {
  const view = tvView([
    baseCandidate({
      title: "65 Inch Class Nano LED 4K UHD Smart TV",
      packCount: null,
      price: 70,
      store: "other",
      storeLabel: "VisionOptique",
      productUrl: "https://vision-optique.com/tv/65",
    }),
  ]);
  assert.equal(view.options.length, 0);
  assert.equal(view.recommendation, null);
});

test("normal Best Buy outright purchase listing is not excluded", () => {
  assert.equal(
    isNonOutrightPurchaseShoppingOffer({
      title: "LG 65 Inch OLED evo 4K Smart TV",
      store: "bestbuy",
      storeLabel: "Best Buy",
      productUrl: "https://www.bestbuy.com/site/lg-65-oled",
    }),
    false
  );
  const view = tvView([
    baseCandidate({
      title: "LG 65 Inch OLED evo 4K Smart TV",
      packCount: null,
      price: 1799.99,
      store: "bestbuy",
      storeLabel: "Best Buy",
      productUrl: "https://www.bestbuy.com/site/lg-65-oled",
    }),
  ]);
  assert.equal(view.options.length, 1);
  assert.match(view.recommendation?.retailer ?? "", /best buy/i);
});

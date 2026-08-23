import assert from "node:assert/strict";
import test from "node:test";
import type { Mock } from "node:test";
import { withCriticalAttributes } from "../criticalAttributes";
import { buildNormalizedProduct, toProductDepartment } from "../normalize";
import { resolveOutboundUrl } from "../source";
import { checkDepartmentCriticalSpecsGate } from "./criticalSpecs";

function normWithCritical(title: string) {
  return withCriticalAttributes(title, buildNormalizedProduct(title));
}

test("pool dimensions: 18x52 allows close alternatives but rejects drastic size", () => {
  const source = normWithCritical("Intex above ground pool 18x52 with pump");
  const closeAlternatives = [
    "Intex above ground pool 15x52 with pump",
    "Intex above ground pool 20x48 with pump",
  ];
  for (const title of closeAlternatives) {
    const candidate = normWithCritical(title);
    const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title);
    assert.ok(gate, `expected non-null pool gate for ${title}`);
    assert.equal(gate.ok, true, `expected close pool size to pass gate for ${title}`);
  }

  const drastic = normWithCritical("Intex above ground pool 24x52 with pump");
  const gateDrastic = checkDepartmentCriticalSpecsGate(
    source,
    drastic,
    drastic.structured.title
  );
  assert.ok(gateDrastic);
  assert.equal(gateDrastic.ok, false);
});

test("pool dimensions: round vs rectangular is hard rejected", () => {
  const source = normWithCritical("Intex 15 ft round above ground pool 52 inch");
  const candidate = normWithCritical("Intex rectangular pool 32x16 ft with pump");
  const gate = checkDepartmentCriticalSpecsGate(
    source,
    candidate,
    candidate.structured.title,
    { selectedDepartment: "pools_outdoor" }
  );
  assert.ok(gate);
  assert.equal(gate.ok, false);
});

test("tv screen size: 65 inch rejects 55, 50, and 75", () => {
  const source = normWithCritical("Samsung 65 inch smart tv DU7200");
  const mismatches = [
    "Samsung 55 inch smart tv DU7200",
    "Samsung 50 inch smart tv DU7200",
    "Samsung 75 inch smart tv DU7200",
  ];

  for (const title of mismatches) {
    const candidate = normWithCritical(title);
    const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title);
    assert.ok(gate, `expected non-null screen gate for ${title}`);
    assert.equal(gate.ok, false, `expected size mismatch to reject ${title}`);
  }
});

test("department routing maps pool, tv/screen, apparel, and tools correctly", () => {
  assert.equal(toProductDepartment("pool"), "pool");
  assert.equal(toProductDepartment("outdoor_pool"), "pool");
  assert.equal(toProductDepartment("swimming_pool"), "pool");
  assert.equal(toProductDepartment("tv"), "screen");
  assert.equal(toProductDepartment("monitor"), "screen");
  assert.equal(toProductDepartment("apparel"), "apparel");
  assert.equal(toProductDepartment("footwear"), "apparel");
  assert.equal(toProductDepartment("tools"), "tools");
  assert.equal(toProductDepartment("general"), "generic");
});

test("same size different brand can pass department gate for TVs", () => {
  const source = normWithCritical("Samsung 65 inch smart tv DU7200");
  const candidate = normWithCritical("LG 65 inch smart tv UQ7590");
  const gate = checkDepartmentCriticalSpecsGate(source, candidate, candidate.structured.title);
  assert.ok(gate, "expected non-null department gate");
  assert.equal(gate.ok, true);
});

test("direct merchant PDP URL is preserved as product outbound", async () => {
  const merchantPdp = "https://www.amazon.com/dp/B0CHX1W1XY";
  const resolution = await resolveOutboundUrl({
    store: "amazon",
    title: "Samsung 65 inch smart tv DU7200",
    shoppingHintUrl: merchantPdp,
    demoMode: true,
  });

  assert.equal(resolution.urlType, "product");
  assert.equal(resolution.urlResolutionReason, "merchant_product_url");
  assert.equal(resolution.outboundUrlRaw, merchantPdp);
  assert.equal(resolution.resolvedProductUrl, merchantPdp);
});

test("search fallback is marked fallback (not product) when PDP is missing", async () => {
  const resolution = await resolveOutboundUrl({
    store: "amazon",
    title: "Samsung 65 inch smart tv DU7200",
    shoppingHintUrl: null,
    demoMode: true,
  });

  assert.equal(resolution.urlType, "search");
  assert.equal(resolution.urlResolutionReason, "generated_search_fallback_from_title");
  assert.equal(resolution.adapterTier, "search_fallback");
  assert.equal(resolution.resolvedProductUrl, undefined);
  assert.match(resolution.outboundUrlRaw, /amazon\.com\/s\?k=/i);
});

test("search fallback is used when hint is non-PDP search URL", async () => {
  const nonPdpHint = "https://www.amazon.com/s?k=samsung+65+inch+tv";
  const resolution = await resolveOutboundUrl({
    store: "amazon",
    title: "Samsung 65 inch smart tv DU7200",
    shoppingHintUrl: nonPdpHint,
    demoMode: true,
  });

  assert.equal(resolution.urlType, "search");
  assert.equal(resolution.urlResolutionReason, "generated_search_fallback_from_title");
  assert.equal(resolution.adapterTier, "search_fallback");
  assert.equal(resolution.resolvedProductUrl, undefined);
});

function withMockedFetch(
  fn: (calls: { count: number; mockFetch: Mock<(input: string | URL | Request) => Promise<Response>> }) => Promise<void>
) {
  return async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = test.mock.fn(async (_input: string | URL | Request) => {
      throw new Error("unexpected_fetch");
    });
    let count = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      count += 1;
      return mockFetch(input);
    }) as typeof fetch;
    try {
      await fn({ count, mockFetch });
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.PRODUCT_ENABLE_SEARCH_TO_PDP_UPGRADE;
      delete process.env.PRODUCT_SEARCH_TO_PDP_TIMEOUT_MS;
    }
  };
}

test(
  "search->PDP upgrade disabled by default keeps search fallback",
  withMockedFetch(async ({ mockFetch }) => {
    const resolution = await resolveOutboundUrl({
      store: "walmart",
      title: "Samsung 65 inch smart tv DU7200",
      shoppingHintUrl: null,
      demoMode: true,
    });
    assert.equal(resolution.urlType, "search");
    assert.equal(resolution.urlResolutionReason, "generated_search_fallback_from_title");
    assert.equal(mockFetch.mock.calls.length, 0);
  })
);

test(
  "search->PDP upgrade for Walmart uses one fetch and upgrades to product",
  withMockedFetch(async ({ mockFetch }) => {
    process.env.PRODUCT_ENABLE_SEARCH_TO_PDP_UPGRADE = "true";
    mockFetch.mock.mockImplementationOnce(async () => {
      const html = `
        <html><body>
          <a href="https://www.walmart.com/ip/Samsung-65-Class-DU7200-Crystal-UHD-4K-Smart-TV/5123456789">
            Samsung 65 inch DU7200 Crystal UHD 4K Smart TV
          </a>
        </body></html>
      `;
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    });

    const resolution = await resolveOutboundUrl({
      store: "walmart",
      title: "Samsung 65 inch smart tv DU7200",
      shoppingHintUrl: null,
      normalized: buildNormalizedProduct("Samsung 65 inch smart tv DU7200"),
      demoMode: true,
    });
    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(resolution.urlType, "product");
    assert.equal(resolution.urlResolutionReason, "search_url_pdp_upgrade");
    assert.match(resolution.outboundUrlRaw, /walmart\.com\/ip\//i);
  })
);

test(
  "search->PDP upgrade for Best Buy uses one fetch and upgrades to product",
  withMockedFetch(async ({ mockFetch }) => {
    process.env.PRODUCT_ENABLE_SEARCH_TO_PDP_UPGRADE = "true";
    mockFetch.mock.mockImplementationOnce(async () => {
      const html = `
        <html><body>
          <a href="/site/samsung-65-class-du7200-series-led-4k-uhd-smart-tizen-tv/6577318.p?skuId=6577318">
            Samsung 65" Class DU7200 Series LED 4K UHD Smart Tizen TV
          </a>
        </body></html>
      `;
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    });

    const resolution = await resolveOutboundUrl({
      store: "bestbuy",
      title: "Samsung 65 inch smart tv DU7200",
      shoppingHintUrl: null,
      normalized: buildNormalizedProduct("Samsung 65 inch smart tv DU7200"),
      demoMode: true,
    });
    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(resolution.urlType, "product");
    assert.equal(resolution.urlResolutionReason, "search_url_pdp_upgrade");
    assert.match(resolution.outboundUrlRaw, /bestbuy\.com\/site\//i);
  })
);

test(
  "search->PDP upgrade for Home Depot upgrades from search HTML candidate",
  withMockedFetch(async ({ mockFetch }) => {
    process.env.PRODUCT_ENABLE_SEARCH_TO_PDP_UPGRADE = "true";
    mockFetch.mock.mockImplementationOnce(async () => {
      const html = `
        <html><body>
          <a href="https://www.homedepot.com/p/DEWALT-20V-MAX-Cordless-Drill-Driver-Kit-DCD771C2/204279858">
            DEWALT 20V MAX Cordless Drill Driver Kit DCD771C2
          </a>
        </body></html>
      `;
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    });

    const resolution = await resolveOutboundUrl({
      store: "homedepot",
      title: "DEWALT 20V MAX Cordless Drill Driver Kit DCD771C2",
      shoppingHintUrl: null,
      normalized: buildNormalizedProduct("DEWALT 20V MAX Cordless Drill Driver Kit DCD771C2"),
      demoMode: true,
    });
    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(resolution.urlType, "product");
    assert.equal(resolution.urlResolutionReason, "search_url_pdp_upgrade");
    assert.match(resolution.outboundUrlRaw, /homedepot\.com\/p\//i);
  })
);

test(
  "search->PDP upgrade rejects accessory links and keeps fallback",
  withMockedFetch(async ({ mockFetch }) => {
    process.env.PRODUCT_ENABLE_SEARCH_TO_PDP_UPGRADE = "true";
    mockFetch.mock.mockImplementationOnce(async () => {
      const html = `
        <html><body>
          <a href="https://www.bestbuy.com/site/tv-wall-mount/999999.p">TV Wall Mount Accessory</a>
        </body></html>
      `;
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    });

    const resolution = await resolveOutboundUrl({
      store: "bestbuy",
      title: "LG 55 inch UHD TV UQ7590",
      shoppingHintUrl: null,
      normalized: buildNormalizedProduct("LG 55 inch UHD TV UQ7590"),
      demoMode: true,
    });
    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(resolution.urlType, "search");
    assert.equal(resolution.urlResolutionReason, "generated_search_fallback_from_title");
  })
);

test(
  "search->PDP upgrade allows accessory PDP when source is accessory",
  withMockedFetch(async ({ mockFetch }) => {
    process.env.PRODUCT_ENABLE_SEARCH_TO_PDP_UPGRADE = "true";
    mockFetch.mock.mockImplementationOnce(async () => {
      const html = `
        <html><body>
          <a href="https://www.bestbuy.com/site/tv-wall-mount/999999.p">
            TV Wall Mount Accessory for 55-85 Inch TVs
          </a>
        </body></html>
      `;
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    });

    const resolution = await resolveOutboundUrl({
      store: "bestbuy",
      title: "TV wall mount accessory for 55 to 85 inch TVs",
      shoppingHintUrl: null,
      normalized: buildNormalizedProduct("TV wall mount accessory for 55 to 85 inch TVs"),
      demoMode: true,
    });
    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(resolution.urlType, "product");
    assert.equal(resolution.urlResolutionReason, "search_url_pdp_upgrade");
    assert.match(resolution.outboundUrlRaw, /bestbuy\.com\/site\//i);
  })
);

test(
  "search->PDP upgrade rejects ambiguous weak matches and keeps fallback",
  withMockedFetch(async ({ mockFetch }) => {
    process.env.PRODUCT_ENABLE_SEARCH_TO_PDP_UPGRADE = "true";
    mockFetch.mock.mockImplementationOnce(async () => {
      const html = `
        <html><body>
          <a href="https://www.walmart.com/ip/Household-Microfiber-Cleaning-Cloth-Set/1234567890">
            Household Microfiber Cleaning Cloth Set
          </a>
          <a href="https://www.walmart.com/ip/Kitchen-Storage-Bin-Organizer/2234567890">
            Kitchen Storage Bin Organizer
          </a>
        </body></html>
      `;
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    });

    const resolution = await resolveOutboundUrl({
      store: "walmart",
      title: "Samsung 65 inch smart tv DU7200",
      shoppingHintUrl: null,
      normalized: buildNormalizedProduct("Samsung 65 inch smart tv DU7200"),
      demoMode: true,
    });
    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(resolution.urlType, "search");
    assert.equal(resolution.urlResolutionReason, "generated_search_fallback_from_title");
  })
);

test(
  "search->PDP upgrade rejects cross retailer links and keeps fallback",
  withMockedFetch(async ({ mockFetch }) => {
    process.env.PRODUCT_ENABLE_SEARCH_TO_PDP_UPGRADE = "true";
    mockFetch.mock.mockImplementationOnce(async () => {
      const html = `
        <html><body>
          <a href="https://www.walmart.com/ip/Samsung-65-DU7200/5123456789">
            Samsung 65 inch DU7200 Crystal UHD 4K Smart TV
          </a>
        </body></html>
      `;
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    });

    const resolution = await resolveOutboundUrl({
      store: "homedepot",
      title: "Samsung 65 inch smart tv DU7200",
      shoppingHintUrl: null,
      normalized: buildNormalizedProduct("Samsung 65 inch smart tv DU7200"),
      demoMode: true,
    });
    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(resolution.urlType, "search");
    assert.equal(resolution.urlResolutionReason, "generated_search_fallback_from_title");
  })
);

test(
  "search->PDP upgrade fetch failure fails closed to fallback",
  withMockedFetch(async ({ mockFetch }) => {
    process.env.PRODUCT_ENABLE_SEARCH_TO_PDP_UPGRADE = "true";
    mockFetch.mock.mockImplementationOnce(async () => {
      throw new Error("network_down");
    });

    const resolution = await resolveOutboundUrl({
      store: "walmart",
      title: "Samsung 65 inch smart tv DU7200",
      shoppingHintUrl: null,
      normalized: buildNormalizedProduct("Samsung 65 inch smart tv DU7200"),
      demoMode: true,
    });
    assert.equal(mockFetch.mock.calls.length, 1);
    assert.equal(resolution.urlType, "search");
    assert.equal(resolution.urlResolutionReason, "generated_search_fallback_from_title");
  })
);
